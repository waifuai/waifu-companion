"""Real browser checks for the Live2D Player Card, with inference mocked.

Run from the repo root: python app/tests/test_player_card.py
Requires Playwright + Chromium. CDN renderer/model assets are read and cached;
analytics, inference, image decisions, speech and radio never reach production.
"""
import json
import mimetypes
from pathlib import Path
import unittest
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP = 'https://companion.test/app/'


class PlayerCardTests(unittest.TestCase):
    assets = {}

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 650, 'height': 650})
        self.context.set_default_timeout(10000)
        self.calls, self.errors, self.boot_errors = [], [], []
        self.context.route('**/*', self.route)
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('console', lambda m: self.boot_errors.append(m.text) if 'Boot module' in m.text else None)

    def tearDown(self):
        self.context.unroute_all(behavior='wait')
        self.context.close()

    def route(self, route):
        url = urlparse(route.request.url)
        cors = {'access-control-allow-origin': '*'}
        if url.hostname == 'companion.test':
            file = (ROOT / unquote(url.path).lstrip('/')).resolve()
            if file.is_dir():
                file /= 'index.html'
            if file.is_relative_to(ROOT) and file.is_file():
                route.fulfill(headers=cors, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())
            else:
                route.fulfill(status=404, headers=cors)
        elif route.request.method == 'OPTIONS':
            route.fulfill(status=204, headers={**cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS'})
        elif 'workers.dev' in (url.hostname or '') or url.path.endswith('/chat/completions'):
            if route.request.method != 'POST':
                route.fulfill(status=404, headers=cors)
                return
            request = route.request.post_data_json
            request['_purpose'] = route.request.headers.get('x-waifu-purpose', 'chat')
            self.calls.append(request)
            content = 'NO_IMAGE' if request['_purpose'] == 'image_decision' else 'Mock reply received.'
            if request.get('stream'):
                event = {'choices': [{'delta': {'content': content}}]}
                route.fulfill(headers=cors, content_type='text/event-stream', body='data: ' + json.dumps(event) + '\n\ndata: [DONE]\n\n')
            else:
                route.fulfill(headers=cors, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': content}}]}))
        elif url.hostname in ('cdn.jsdelivr.net', 'cdnjs.cloudflare.com'):
            # These are the app's real PIXI/Cubism libraries and default model.
            key = route.request.url
            if key not in self.assets:
                response = route.fetch(timeout=45000)
                self.assets[key] = (response.status, response.headers.get('content-type', 'application/octet-stream'), response.body())
            status, content_type, body = self.assets[key]
            route.fulfill(status=status, headers=cors, content_type=content_type, body=body)
        else:
            route.fulfill(headers=cors, content_type='application/javascript', body='')

    def open_app(self, width=480, height=480, sandbox='allow-scripts allow-same-origin', blocked=False, embed=True):
        if blocked:
            self.context.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Blocked', 'SecurityError')}})")
        source = APP + ('?embed=x' if embed else '')
        self.context.route('https://host.test/', lambda r: r.fulfill(content_type='text/html', body=f'<iframe title="App" src="{source}" sandbox="{sandbox}" style="border:0;width:{width}px;height:{height}px"></iframe>'))
        self.page.goto('https://host.test/')
        frame = self.page.frames[1]
        frame.wait_for_function('window.waifuBootComplete === true', timeout=60000)
        frame.wait_for_function('window.currentModel && window.currentModel.internalModel', timeout=60000)
        self.assertFalse(self.errors, self.errors)
        self.assertFalse(self.boot_errors, self.boot_errors)
        self.assertFalse(self.calls, 'Loading a card must not make inference requests')
        return frame

    def check_chat(self, **kwargs):
        frame = self.open_app(**kwargs)
        field = frame.locator('#messageInput')
        self.assertFalse(frame.evaluate('window.enableVoice'))
        field.click()
        field.press_sequentially('Send with button')
        frame.locator('#sendMessageBtn').click()
        frame.locator('.message.model-message').filter(has_text='Mock reply received.').wait_for()
        frame.wait_for_function('!window.isProcessing')
        chats = [c for c in self.calls if c['_purpose'] == 'chat']
        self.assertEqual(len(chats), 1, self.calls)
        self.assertEqual(chats[-1]['messages'][-1]['content'], 'Send with button')
        self.assertEqual(field.input_value(), '')
        field.fill('Send with Enter')
        before = len(self.calls)
        field.dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
        field.dispatch_event('keydown', {'key': 'Enter', 'keyCode': 229})
        self.assertEqual(len(self.calls), before)
        field.press('Enter')
        frame.locator('.message.model-message').filter(has_text='Mock reply received.').nth(1).wait_for()
        frame.wait_for_function('!window.isProcessing')
        chats = [c for c in self.calls if c['_purpose'] == 'chat']
        self.assertEqual(len(chats), 2, self.calls)
        frame.locator('#sendMessageBtn').click()
        field.press('Enter')
        self.assertEqual(len([c for c in self.calls if c['_purpose'] == 'chat']), 2)
        self.assertFalse(any(c['_purpose'] == 'title' for c in self.calls))
        self.assertEqual(frame.evaluate('ChatManager.getAllChats()[0].messageCount'), 4)
        frame.locator('.message.model-message').first.focus()
        self.assertTrue(frame.locator('.message.model-message').first.locator('.message-actions').is_visible())
        frame.locator('.settings-button').click()
        self.assertTrue(frame.locator('#settingsPanel').is_visible())
        frame.locator('.settings-button').click()
        frame.locator('#embedVoiceBtn').click()
        self.assertTrue(frame.evaluate('window.enableVoice'))
        frame.locator('#embedVoiceBtn').click()
        self.assertFalse(frame.evaluate('window.enableVoice'))
        self.assertFalse(self.errors, self.errors)

    def test_sandbox_without_forms(self):
        self.check_chat()

    def test_opaque_sandbox_and_blocked_storage(self):
        self.check_chat(sandbox='allow-scripts', blocked=True)

    def test_sizes_and_resize(self):
        frame = self.open_app()
        for width, height in [(480, 480), (320, 480), (280, 360), (480, 320)]:
            self.page.locator('iframe').evaluate('(el, size) => {el.style.width = size[0] + "px"; el.style.height = size[1] + "px"}', [width, height])
            frame.wait_for_function('(width) => window.innerWidth === width && app.renderer.width === width', arg=width)
            for selector in ('#messageInput', '#sendMessageBtn', '.embed-toolbar', '.chat-container'):
                box = frame.locator(selector).bounding_box()
                self.assertGreater(box['width'], 0)
                self.assertLessEqual(box['x'] + box['width'], width + 10)
                self.assertLessEqual(box['y'] + box['height'], height + 10)
            bounds = frame.evaluate('(() => {const b = currentModel.getBounds(); return {x:b.x, y:b.y, width:b.width, height:b.height}})()')
            self.assertGreater(bounds['height'], 50)
            self.assertGreaterEqual(bounds['y'], 35)
            chat_top = frame.locator('.chat-container').evaluate('(el) => el.getBoundingClientRect().top')
            self.assertGreater(bounds['height'], height * .70, 'Avatar should have portrait prominence')
            self.assertGreater(chat_top - bounds['y'], height * .40, 'Keep upper portrait clear of chat')
            frame.locator('#messageInput').fill('Keep this draft')
            frame.locator('#embedChatBtn').click()
            self.assertFalse(frame.locator('.chat-container').is_visible())
            frame.locator('#embedChatBtn').click()
            self.assertTrue(frame.locator('#messageInput').is_visible())
            self.assertEqual(frame.locator('#messageInput').input_value(), 'Keep this draft')

    def test_storage_isolation_and_full_app(self):
        self.context.add_init_script("if (location.hostname === 'companion.test') { localStorage.setItem('openRouterApiKey','full-app-test-key'); localStorage.setItem('conversationContext', '[{\"role\":\"user\",\"content\":\"Private full app chat\"}]'); }")
        frame = self.open_app()
        self.assertEqual(frame.evaluate("AppStorage.getItem('openRouterApiKey')"), None)
        self.assertNotIn('Private full app chat', frame.locator('#chatHistory').inner_text())
        frame.evaluate("AppStorage.setItem('openRouterApiKey', 'embed-test-key')")
        self.assertEqual(frame.evaluate("localStorage.getItem('openRouterApiKey')"), 'full-app-test-key')
        self.assertEqual(frame.evaluate("localStorage.getItem('waifu_x_openRouterApiKey')"), 'embed-test-key')
        frame.goto(APP)
        frame.wait_for_function('window.waifuBootComplete === true')
        self.assertFalse(frame.evaluate('window.WaifuEmbed'))
        self.assertEqual(frame.evaluate("AppStorage.getItem('openRouterApiKey')"), 'full-app-test-key')
        self.assertFalse(frame.locator('.embed-toolbar').is_visible())

    def test_full_app_chat_regression(self):
        frame = self.open_app(embed=False)
        frame.evaluate('window.enableVoice = false')
        frame.locator('#messageInput').fill('Normal full app chat')
        frame.locator('#messageInput').press('Enter')
        frame.locator('.message.model-message').filter(has_text='Mock reply received.').wait_for()
        frame.wait_for_function('!window.isProcessing')
        chats = [c for c in self.calls if c['_purpose'] == 'chat']
        self.assertEqual(len(chats), 1)
        self.assertEqual(chats[0]['messages'][-1]['content'], 'Normal full app chat')
        self.assertEqual(frame.evaluate('ChatManager.getAllChats()[0].messageCount'), 2)
        self.assertFalse(self.errors, self.errors)

    def test_blocked_picture_storage(self):
        frame = self.open_app(sandbox='allow-scripts', blocked=True)
        image = frame.evaluate('''async () => {
            const key = await ImageStore.put('test-picture', new Blob(['picture'], {type:'image/png'}));
            const url = await ImageStore.resolve(key);
            return {key, content: await (await fetch(url)).text()};
        }''')
        self.assertEqual(image, {'key': 'idb:test-picture', 'content': 'picture'})

    def test_restored_card_starts_quietly(self):
        self.context.add_init_script('''if (location.hostname === 'companion.test') {
            localStorage.setItem('waifu_x_enablePrimaryVoice', 'true');
            localStorage.setItem('waifu_x_enableKokoro', 'true');
            localStorage.setItem('waifu_x_isAmbientQueueEnabled', 'true');
            localStorage.setItem('waifu_x_interfaceLanguage', 'zz-test');
            localStorage.setItem('waifu_x_openRouterApiKey', 'embed-test-key');
        }''')
        frame = self.open_app()
        self.assertFalse(frame.evaluate('window.enableVoice || window.isAmbientQueueEnabled || window.enableKokoro'))
        self.assertFalse(self.calls)

    def test_fresh_share_page(self):
        self.page.goto(APP + '?card=player-v1')
        self.assertEqual(self.page.url, APP + '?card=player-v1')
        for name, value in [('twitter:card', 'player'),
                            ('twitter:player', 'https://waifuai.com/app/?embed=x'),
                            ('twitter:player:width', '480'),
                            ('twitter:player:height', '480')]:
            self.assertEqual(self.page.locator(f'meta[name="{name}"]').get_attribute('content'), value)
        self.assertEqual(self.page.locator('link[rel="canonical"]').get_attribute('href'), 'https://waifuai.com/app/')
        self.page.wait_for_function('window.waifuBootComplete && window.currentModel', timeout=60000)
        self.assertTrue(self.page.evaluate('window.WaifuEmbed'))
        self.assertTrue(self.page.locator('#sendMessageBtn').is_visible())
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
