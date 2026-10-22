"""Companion lifecycle checks using delayed local transports, never live inference."""
import base64
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlparse
import test_player_card as fixtures


class LifecycleTests(unittest.TestCase):
    assets = {}
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    fulfill_decision = fixtures.PlayerCardTests.fulfill_decision
    open_app = fixtures.PlayerCardTests.open_app

    def setUp(self):
        fixtures.PlayerCardTests.setUp(self)
        self.image_count = 0
        self.image_mode = 'success'
        self.display_fails = False

    def tearDown(self):
        fixtures.PlayerCardTests.tearDown(self)

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path == '/image':
            self.image_count += 1
            headers = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Image-Url'}
            if self.image_mode != 'success':
                route.fulfill(status={'failed':503, 'blocked':400, 'auth':403, 'rate':429}[self.image_mode],
                    headers=headers,content_type='application/json',body=json.dumps({'error':'Mock failure','blocked':self.image_mode=='blocked'}))
            else:
                route.fulfill(headers={**headers,'X-Image-Url':'https://companion.test/picture.png'},body='')
        elif url.path == '/picture.png':
            route.fulfill(status=404 if self.display_fails else 200, content_type='image/png',
                body=b'not an image' if self.display_fails else base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ3cAAAAASUVORK5CYII='))
        else:
            fixtures.PlayerCardTests.route(self, route)

    def open(self, width=1100, embed=False):
        self.page.set_viewport_size({'width':max(width+30,650),'height':850})
        frame = self.open_app(width=width,height=760 if not embed else 480,embed=embed)
        frame.evaluate('window.enableVoice=false;window.isUserMessageQueueEnabled=true;window.isAmbientQueueEnabled=false;')
        return frame

    def delayed(self, f):
        f.evaluate("""() => {
            window.pendingChats=[]; window.chatBodies=[]; window.streamControllers=[];
            const original=fetch;
            window.fetch=(url,options) => {
                if (String(url).endsWith('/chat/completions') && JSON.parse(options.body).stream) {
                    chatBodies.push(JSON.parse(options.body));
                    return new Promise(resolve => pendingChats.push(resolve));
                }
                return original(url,options);
            };
            window.startStream=(index=0) => {
                const body=new ReadableStream({start(c){streamControllers[index]=c;}});
                pendingChats[index](new Response(body,{headers:{'Content-Type':'text/event-stream'}}));
            };
            window.chunk=(text,index=0) => streamControllers[index].enqueue(new TextEncoder().encode(
                'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\\n\\n'));
            window.end=(index=0) => {streamControllers[index].enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));streamControllers[index].close();};
        }""")

    def send(self, f, text='Question'):
        f.locator('#messageInput').fill(text)
        f.locator('#messageInput').press('Enter')

    def test_duplicate_stop_partial_retry_queue_desktop_mobile_embed(self):
        for width,embed in [(1200,False),(390,False),(480,True)]:
            with self.subTest(width=width,embed=embed):
                self.calls.clear()
                f=self.open(width,embed)
                self.delayed(f)
                f.locator('#messageInput').fill('Question')
                f.locator('#sendMessageBtn').dblclick()
                f.wait_for_function('chatBodies.length === 1')
                self.assertEqual(f.locator('#sendMessageBtn').get_attribute('aria-label'),'Stop')
                self.send(f,' Question  ')
                f.evaluate('sendMessage()')
                self.assertEqual(f.evaluate('chatBodies.length'),1)
                self.assertEqual(f.locator('.user-message').count(),1)
                f.evaluate('startStream();chunk("Partial response")')
                f.wait_for_function('conversationContext[1].content === "Partial response"')
                self.send(f,'distinct next')
                self.send(f,'distinct   next')
                self.assertEqual(f.evaluate('userMessageQueue.length'),1)
                f.locator('#sendMessageBtn').click()
                f.locator('.turn-result').filter(has_text='Stopped').wait_for()
                self.assertIn('Partial response',f.locator('.model-message').first.inner_text())
                self.assertIn('Queue paused',f.locator('#queueStatusContainer').inner_text())
                shots=Path(tempfile.gettempdir())/'companion-lifecycle';shots.mkdir(exist_ok=True)
                self.page.screenshot(path=str(shots/f'stopped-{width}.png'))
                retry=f.locator('.turn-retry');retry.focus();retry.press('Enter')
                f.wait_for_function('chatBodies.length === 2')
                self.assertEqual(f.locator('.user-message').count(),1)
                self.assertNotIn('Partial response',json.dumps(f.evaluate('chatBodies[1].messages')))
                f.evaluate('startStream(1);chunk("Fresh response",1);end(1)')
                f.wait_for_function('!isProcessing')
                self.assertEqual(f.evaluate('chatBodies.length'),2)
                f.locator('.queue-resume').click()
                f.wait_for_function('chatBodies.length === 3')
                self.assertTrue(retry.is_disabled())
                f.evaluate('ChatManager.handleNewChat()')
                f.evaluate('startStream(2)')
                f.wait_for_function('!isProcessing')
                self.assertEqual(f.evaluate('conversationContext.length'),0)
                self.assertFalse(self.errors,self.errors)
                self.context.unroute_all(behavior='wait')
                self.context.close()
                fixtures.PlayerCardTests.setUp(self)

    def test_status_timers_and_locale_clear_on_text_and_stop(self):
        f=self.open();self.delayed(f);self.page.clock.install()
        self.send(f);f.wait_for_function('chatBodies.length === 1')
        self.page.clock.fast_forward(8000)
        self.assertEqual(f.locator('.turn-wait').inner_text(),'Still working…')
        self.page.clock.fast_forward(12000)
        self.assertIn('Taking longer',f.locator('.turn-wait').inner_text())
        f.evaluate("WaifuI18n.setLocale('ja')")
        f.wait_for_function("document.documentElement.lang === 'ja'")
        self.assertNotIn('Taking longer',f.locator('.turn-wait').inner_text())
        f.evaluate('startStream();chunk("Usable reply")')
        f.wait_for_function('conversationContext[1].content === "Usable reply"')
        self.assertEqual(f.locator('.turn-wait').count(),0)
        f.evaluate('stopActiveTurn()');self.page.clock.fast_forward(120000)
        self.assertEqual(f.locator('.turn-wait').count(),0)
        self.assertEqual(f.evaluate('chatBodies.length'),1)
        self.assertEqual(f.evaluate('conversationContext[1].attemptStatus'),'stopped')

    def test_stop_before_headers_reload_and_switch_reject_late_results(self):
        f=self.open();self.delayed(f);self.send(f);f.wait_for_function('chatBodies.length === 1')
        f.locator('#sendMessageBtn').click()
        self.assertEqual(f.evaluate('conversationContext[1].attemptStatus'),'stopped')
        self.send(f,'new turn');f.wait_for_function('chatBodies.length === 2')
        f.evaluate('startStream(0)')
        self.assertTrue(f.evaluate('isProcessing'))
        f.evaluate('ChatManager.handleNewChat()');f.evaluate('startStream(1)')
        self.assertEqual(f.evaluate('conversationContext.length'),0)
        self.calls.clear();self.page.reload();f=self.page.frames[1]
        f.wait_for_function('waifuBootComplete')
        self.assertEqual(len(self.calls),0)
        self.assertFalse(f.evaluate('isProcessing'))

    def test_image_generation_failure_manual_recovery_and_display_only_reload(self):
        f=self.open(embed=True);self.image_mode='failed';self.send(f,'/image cozy room square')
        f.locator('.image-status').filter(has_text='Generation failed').wait_for()
        self.assertEqual(self.image_count,1)
        entry=f.evaluate('conversationContext.at(-1).id')
        self.image_mode='success';self.display_fails=True
        f.get_by_role('button',name='Generate again',exact=True).click()
        f.locator('.image-status').filter(has_text='Display failed').wait_for()
        self.assertEqual(self.image_count,2)
        self.assertEqual(f.evaluate('conversationContext.at(-1).id'),entry)
        self.display_fails=False
        f.get_by_role('button',name='Reload image',exact=True).click()
        f.locator('.image-status').filter(has_text='Loaded in this browser').wait_for()
        self.assertEqual(self.image_count,2)
        self.assertIn('browser display loaded',f.evaluate('contextForModel(conversationContext).at(-1).content'))
        self.send(f,'Next question')
        f.wait_for_function('!isProcessing')
        self.assertTrue(f.locator('.chat-image').is_visible())
        self.assertTrue(f.locator('.chat-image').evaluate('(img) => img.complete && img.naturalWidth > 0'))
        self.assertEqual(self.image_count,2)
        self.calls.clear();self.page.reload();f=self.page.frames[1]
        f.wait_for_function('waifuBootComplete')
        f.locator('.image-status').filter(has_text='Loaded in this browser').wait_for()
        self.assertEqual(self.image_count,2)

    def test_blocked_auth_rate_have_no_generate_again(self):
        f=self.open(embed=True)
        for mode in ['blocked','auth','rate']:
            self.image_mode=mode;self.send(f,'/image scene '+mode)
            f.wait_for_function('!isProcessing && getActiveTurn().effects === 0')
            self.assertEqual(f.get_by_role('button',name='Generate again',exact=True).count(),0)
        self.assertEqual(self.image_count,3)

    def test_missing_corrupt_rejected_blobs_and_abandoned_display_callbacks(self):
        f=self.open(embed=True)
        f.evaluate("""() => {
            window.finishResolve=null;
            ImageStore.resolve=()=>new Promise(resolve=>finishResolve=resolve);
            const id=addMessage('',false);
            window.entry={id,role:'assistant',content:'',imageUrl:'idb:missing',imageOperation:{generation:'generated',display:'unknown',prompt:'scene'}};
            conversationContext.push(entry);renderImageOperation(entry);
            window.oldImage=document.querySelector('.chat-image');
        }""")
        f.evaluate('ChatManager.handleNewChat();finishResolve("https://companion.test/picture.png");oldImage.dispatchEvent(new Event("load"))')
        self.assertEqual(f.evaluate('conversationContext.length'),0)
        for mode in ['missing','reject','corrupt']:
            f.evaluate("""mode => {
                ImageStore.resolve=mode==='reject' ? ()=>Promise.reject(new Error('corrupt store')) : ()=>Promise.resolve(mode==='corrupt' ? 'data:image/png;base64,AAA' : null);
                const id=addMessage('',false);
                const m={id,role:'assistant',content:'',imageUrl:'idb:missing',imageOperation:{generation:'generated',display:'unknown',prompt:'scene'}};
                conversationContext.push(m);renderImageOperation(m);
            }""",mode)
            f.locator('.image-status').last.filter(has_text='Display failed').wait_for()
        self.assertEqual(self.image_count,0)
        self.assertFalse(self.errors,self.errors)

    def test_pending_saved_operations_recover_without_inference(self):
        f=self.open(embed=True)
        f.evaluate("""() => {
            conversationContext=[{id:'saved-user',role:'user',content:'hello'},{id:'saved-text',role:'assistant',content:'partial',attemptStatus:'pending',userId:'saved-user'},
                {id:'saved-image',role:'assistant',content:'',imageOperation:{generation:'pending',display:'unknown',prompt:'room'}}];
            ChatManager.saveCurrentChat(ChatManager.getActiveChatId());
        }""")
        self.calls.clear();self.page.reload();f=self.page.frames[1];f.wait_for_function('waifuBootComplete')
        self.assertEqual(f.locator('.turn-result').inner_text(),'Interrupted')
        self.assertEqual(f.locator('.image-status').inner_text(),'Interrupted')
        self.assertEqual(self.image_count,0);self.assertFalse(self.calls)

    def test_starters_localized_same_send_guard(self):
        f=self.open(embed=True);self.delayed(f)
        self.assertEqual(f.locator('.chat-starters button').all_text_contents(),['Ask me about my day','Let’s play would you rather.','Send me a selfie','Help me focus'])
        f.locator('.chat-starters button').first.click();f.wait_for_function('chatBodies.length === 1')
        self.assertEqual(f.evaluate('chatBodies[0].messages.at(-1).content'),'Ask me about my day')
        f.evaluate('stopActiveTurn()')
        self.assertEqual(f.locator('.user-message').count(),1)


if __name__ == '__main__':
    unittest.main()
