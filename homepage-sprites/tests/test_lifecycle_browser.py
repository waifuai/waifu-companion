"""Deterministic local browser checks: no live inference, speech or analytics.

Run: python -m unittest discover -s homepage-sprites/tests -p test_lifecycle_browser.py
"""
import base64
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse
import test_player_card as fixtures
APP = fixtures.APP


class LifecycleTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)

    def setUp(self):
        fixtures.PlayerCardTests.setUp(self)
        self.image_mode = 'success'
        self.display_fails = False
        self.image_count = 0
        self.context.add_init_script("""
            try {
                localStorage.setItem('ws_speech',JSON.stringify({enabled:false}));
                localStorage.setItem('ws_embed_speech',JSON.stringify({enabled:false}));
                localStorage.setItem('ws_settings',JSON.stringify({autoTitles:false,ambient:true,ambientDelay:15,queue:true}));
            } catch (_) {}
        """)

    def tearDown(self):
        fixtures.PlayerCardTests.tearDown(self)

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path == '/image':
            self.image_count += 1
            if self.image_mode != 'success':
                code = {'failed':503,'blocked':400,'auth':403,'rate':429}[self.image_mode]
                route.fulfill(status=code, content_type='application/json',
                              body=json.dumps({'error':'Mock image failure','blocked':self.image_mode=='blocked'}))
            else:
                route.fulfill(headers={'X-Image-Url':'https://sprites.test/picture.png',
                              'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-Image-Url'},body='')
        elif url.path == '/picture.png' and self.display_fails:
            route.fulfill(status=404)
        else:
            fixtures.PlayerCardTests.route(self, route)

    def open(self, width=1100, embed=False):
        self.page.set_viewport_size({'width':width,'height':760 if not embed else 600})
        self.page.goto(APP + ('?embed=x' if embed else ''))
        # Turn transport and error handling are still exercised through a BYO
        # provider; the default built-in provider makes no network request.
        self.page.evaluate("Object.assign(Chat.settings, {provider:'custom', customBaseUrl:'https://provider.test/v1', models:{custom:'test-model'}});")

    def delayed(self):
        self.page.evaluate("""() => {
            window.pendingChats=[];
            window.chatBodies=[];
            const original=fetch;
            window.fetch=(url,options) => {
                if (String(url).endsWith('/chat/completions') && JSON.parse(options.body).stream) {
                    chatBodies.push(JSON.parse(options.body));
                    return new Promise(resolve => pendingChats.push(resolve));
                }
                return original(url,options);
            };
            window.startStream=(index=0) => {
                window.streamControllers ||= [];
                const body=new ReadableStream({start(c){streamControllers[index]=c;}});
                pendingChats[index](new Response(body,{headers:{'Content-Type':'text/event-stream'}}));
            };
            window.chunk=(text,index=0) => streamControllers[index].enqueue(new TextEncoder().encode(
                'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\\n\\n'));
            window.end=(index=0) => {
                streamControllers[index].enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));
                streamControllers[index].close();
            };
        }""")

    def send(self, text='Question'):
        self.page.locator('#msgInput').fill(text)
        self.page.locator('#msgInput').press('Enter')
        self.page.wait_for_function('chatBodies.length > 0')

    def test_duplicate_paths_stop_partial_retry_and_paused_queue_at_three_sizes(self):
        for width, embed in [(1200,False),(390,False),(480,True)]:
            with self.subTest(width=width,embed=embed):
                self.open(width,embed)
                self.page.locator('#newBtn').click()
                self.delayed()
                self.page.locator('#msgInput').fill('Question')
                self.page.locator('#sendBtn').dblclick()
                self.page.wait_for_function('chatBodies.length === 1')
                self.assertEqual(self.page.locator('#sendBtn').get_attribute('aria-label'),'Stop')
                self.page.locator('#msgInput').fill('  Question  ')
                self.page.locator('#msgInput').press('Enter')
                self.page.locator('#composer').dispatch_event('submit')
                self.assertEqual(self.page.evaluate('chatBodies.length'),1)
                self.assertEqual(self.page.locator('.msg.user').count(),1)
                self.page.evaluate('startStream(); chunk("[happy] Partial")')
                self.page.wait_for_function("Chat.messages[1].content === 'Partial'")
                self.page.locator('#msgInput').fill('Next distinct message')
                self.page.locator('#msgInput').press('Enter')
                self.assertEqual(self.page.locator('.queued').count(),1)
                self.page.locator('#sendBtn').click()
                self.page.locator('.attempt-status').filter(has_text='Stopped').wait_for()
                self.assertEqual(self.page.evaluate('chatBodies.length'),1)
                self.assertIn('Partial',self.page.locator('.msg.assistant').first.inner_text())
                self.assertIn('Queue paused',self.page.locator('.queued').inner_text())
                shots = Path(tempfile.gettempdir()) / 'homepage-sprites-test-artifacts'
                shots.mkdir(exist_ok=True)
                self.page.screenshot(path=str(shots / f'stopped-{width}.png'))
                self.page.locator('.retry').focus()
                self.page.locator('.retry').press('Enter')
                self.page.wait_for_function('chatBodies.length === 2')
                self.assertEqual(self.page.evaluate("Chat.messages.filter(m=>m.role==='user').length"),1)
                self.assertNotIn('Partial',json.dumps(self.page.evaluate('chatBodies[1].messages')))
                self.page.evaluate('startStream(1); chunk("[happy] Retried",1); end(1)')
                self.page.wait_for_function('!Chat.busy')
                self.assertEqual(self.page.evaluate('chatBodies.length'),2)
                self.page.get_by_role('button',name='Resume queue',exact=True).click()
                self.page.wait_for_function('chatBodies.length === 3')
                self.assertTrue(self.page.locator('.retry').is_disabled())
                self.page.locator('#newBtn').click()
                self.assertEqual(self.page.evaluate('Chat.messages.length'),0)
                self.assertFalse(self.errors,self.errors)

    def test_owned_wait_status_and_locale_switching_with_virtual_time(self):
        self.open(390)
        self.page.clock.install()
        self.page.clock.pause_at(self.page.evaluate("Date.now() + 100"))
        self.delayed(); self.send()
        self.page.clock.fast_forward(7999)
        self.assertEqual(self.page.locator('.wait-status').count(),0)
        self.page.clock.fast_forward(1)
        self.assertEqual(self.page.locator('.wait-status').inner_text(),'Still working…')
        self.page.clock.fast_forward(12000)
        self.assertIn('Taking longer',self.page.locator('.wait-status').inner_text())
        self.page.evaluate("WaifuI18n.setLocale('ja')")
        self.page.wait_for_function("document.getElementById(\"stage\").lang === 'ja'")
        self.assertEqual(self.page.locator('#sendBtn').get_attribute('aria-label'),'停止')
        self.assertIn('通常より',self.page.locator('.wait-status').inner_text())
        self.page.evaluate('startStream(); chunk("[happy] Visible")')
        self.page.wait_for_function("Chat.messages[1].content === 'Visible'")
        self.assertEqual(self.page.locator('.wait-status').count(),0)
        self.page.locator('#sendBtn').click()
        self.page.clock.fast_forward(60000)
        self.assertEqual(self.page.evaluate('chatBodies.length'),1)
        self.assertEqual(self.page.locator('.wait-status').count(),0)
        self.assertFalse(self.errors,self.errors)

    def test_stop_before_headers_and_reload_never_resends(self):
        self.open(); self.delayed(); self.send()
        self.page.locator('#sendBtn').click()
        self.page.reload()
        self.assertEqual(self.page.locator('.msg.user').count(),1)
        self.assertEqual(self.page.locator('.attempt-status').inner_text(),'Stopped')
        self.assertEqual(len(self.calls),0)
        self.assertEqual(self.page.locator('#sendBtn').get_attribute('aria-label'),'Send')
        self.assertFalse(self.errors,self.errors)

    def test_image_command_is_ordinary_local_chat_with_no_generation_request(self):
        self.open(390)
        self.image_mode='failed'
        self.page.locator('#msgInput').fill('/image a garden square')
        self.page.locator('#msgInput').press('Enter')
        self.page.wait_for_function('!Chat.busy && Chat.messages.some(m => m.role === "assistant" && m.content)')
        self.assertEqual(self.image_count,0)
        self.assertEqual(self.page.evaluate("Chat.messages.some(Chat.isPicture)"),False)
        self.assertEqual(self.page.evaluate("Chat.messages.at(-1).status"),'completed')
        self.page.reload()
        self.assertEqual(self.image_count,0)
        self.assertEqual(self.page.evaluate("Chat.messages.some(Chat.isPicture)"),False)
        self.assertFalse(self.errors,self.errors)

    def test_image_prompt_hints_never_offer_a_generate_again_control(self):
        for text in ['/image a garden', 'draw yourself at the beach']:
            self.open(); self.image_mode='success'
            self.page.locator('#newBtn').click()
            self.page.locator('#msgInput').fill(text)
            self.page.locator('#msgInput').press('Enter')
            self.page.wait_for_function('!Chat.busy && Chat.messages.some(m => m.role === "assistant" && m.content)')
            self.assertEqual(self.page.get_by_role('button',name='Generate again',exact=True).count(),0)
            self.assertEqual(self.image_count,0)
        self.assertFalse(self.errors,self.errors)

    def test_missing_corrupt_blobs_and_rejected_resolution_only_offer_reload(self):
        self.open()
        for ref in ['idb:missing','idb:corrupt','idb:rejected']:
            self.page.evaluate("""ref => {
                const owner=Chat.beginTurn('draw',{kind:'image'});
                const m=Chat.createPicture(owner,'garden','1:1');
                Chat.updatePicture(owner,m,{generation:'generated',image:ref}); Chat.finishTurn(owner);
                const original=Pictures.resolve;
                Pictures.resolve=r=>r==='idb:rejected'?Promise.reject(Error('storage failure')):r==='idb:corrupt'?Promise.resolve('data:image/png;base64,bm90IGFuIGltYWdl'):original(r);
            }""",ref)
            # Reopen through the real history UI to exercise resolution in a fresh view.
            self.page.locator('#historyBtn').click()
            self.page.locator('.history-open').first.click()
            self.page.locator('.picture-status').last.filter(has_text='Display failed').wait_for()
        self.assertEqual(self.image_count,0)
        self.assertFalse(self.errors,self.errors)

    def test_abandoned_image_resolution_and_load_events_cannot_change_saved_state(self):
        self.open()
        self.page.evaluate("""() => {
            const owner=Chat.beginTurn('draw',{kind:'image'});
            const image=Chat.createPicture(owner,'garden','1:1');
            Chat.updatePicture(owner,image,{generation:'generated',image:'idb:delayed'}); Chat.finishTurn(owner);
            window.savedChat=Chat.convId;
            window.savedImage=image;
            Pictures.resolve=()=>new Promise(resolve=>window.resolveImage=resolve);
        }""")
        self.page.locator('#historyBtn').click()
        self.page.locator('.history-open').first.click()
        self.page.wait_for_function("typeof resolveImage === 'function'")
        self.page.evaluate("window.abandonedImage=document.querySelector('.pic img')")
        self.page.locator('#newBtn').click()
        self.page.evaluate("""() => {
            resolveImage('data:image/png;base64,bm90IGFuIGltYWdl');
            abandonedImage.dispatchEvent(new Event('load'));
            abandonedImage.dispatchEvent(new Event('error'));
        }""")
        self.assertEqual(self.page.evaluate('Chat.messages.length'),0)
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('ws_conv_'+savedChat)).find(m=>m.kind==='image').display"),'unknown')
        self.assertIsNone(self.page.evaluate("abandonedImage.getAttribute('src')"))
        self.assertFalse(self.errors,self.errors)

    def test_reloading_saved_drawing_marks_interrupted_without_requests(self):
        self.open()
        self.page.evaluate("""() => {
            const owner=Chat.beginTurn('draw',{kind:'image'});
            Chat.createPicture(owner,'garden','1:1');
        }""")
        self.page.reload()
        self.page.locator('.picture-status').filter(has_text='Interrupted').wait_for()
        self.assertEqual(self.image_count,0)
        self.assertEqual(len(self.calls),0)
        self.assertEqual(self.page.locator('#sendBtn').get_attribute('aria-label'),'Send')
        self.assertFalse(self.errors,self.errors)


if __name__ == '__main__':
    unittest.main()
