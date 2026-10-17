"""Real browser checks for the Live2D Player Card, with inference mocked.

Run from the repo root: python app/tests/test_player_card.py
Requires Playwright + Chromium. CDN renderer/model assets are read and cached;
analytics, inference, image decisions, speech and radio never reach production.
"""
import base64
import io
import json
import mimetypes
from pathlib import Path
import unittest
import wave
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
        self.calls, self.errors, self.boot_errors, self.tts_calls = [], [], [], []
        self.transcriptions = []
        self.transport_failure = None
        self.transport_downloads = 0
        self.reply = 'Mock reply received.'
        self.tts_fail = False
        self.decision_requests = []
        self.language_answer = {'choice_id': 'en-US', 'confidence': 0.95}
        self.action_answers = {}
        self.writer_replies = {}
        self.hold_decisions = False
        self.pending_decision = None
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
            if url.path.endswith('/llm_provider_base.js'):
                self.transport_downloads += 1
                if self.transport_failure == 'always' or self.transport_failure == 'initial' and self.transport_downloads == 1:
                    route.abort('failed')
                    return
            file = (ROOT / unquote(url.path).lstrip('/')).resolve()
            if file.is_dir():
                file /= 'index.html'
            if file.is_relative_to(ROOT) and file.is_file():
                route.fulfill(headers=cors, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())
            else:
                route.fulfill(status=404, headers=cors)
        elif route.request.method == 'OPTIONS':
            route.fulfill(status=204, headers={**cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS'})
        elif url.path == '/transcribe':
            self.transcriptions.append(route.request.post_data_buffer)
            route.fulfill(headers=cors, content_type='application/json',
                          body=json.dumps({'text': "Okay, that's nice."}))
        elif url.path == '/decisions':
            request = route.request.post_data_json
            self.decision_requests.append(request)
            if self.hold_decisions and 'live2d_tts_language_v1' in request['tasks']:
                self.pending_decision = route
            else:
                self.fulfill_decision(route)
        elif 'workers.dev' in (url.hostname or '') or url.path.endswith('/chat/completions'):
            if route.request.method != 'POST':
                route.fulfill(status=404, headers=cors)
                return
            request = route.request.post_data_json
            request['_purpose'] = route.request.headers.get('x-waifu-purpose', 'chat')
            self.calls.append(request)
            content = self.writer_replies.get(request['_purpose'], 'NO_IMAGE' if request['_purpose'] == 'image_decision' else self.reply)
            if request.get('stream'):
                event = {'choices': [{'delta': {'content': content}}]}
                route.fulfill(headers=cors, content_type='text/event-stream', body='data: ' + json.dumps(event) + '\n\ndata: [DONE]\n\n')
            else:
                route.fulfill(headers=cors, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': content}}]}))
        elif url.hostname == 'ottsy.weilbyte.dev':
            self.tts_calls.append(route.request.post_data_json)
            if self.tts_fail:
                route.fulfill(status=503, headers=cors, body='Mock speech outage')
                return
            audio = io.BytesIO()
            with wave.open(audio, 'wb') as wav:
                wav.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
                wav.writeframes(b'\0\0' * 5512)
            route.fulfill(headers=cors, content_type='application/json', body=json.dumps({'success': True, 'data': base64.b64encode(audio.getvalue()).decode()}))
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

    def fulfill_decision(self, route):
        answers = {task: self.language_answer if task == 'live2d_tts_language_v1'
                   else self.action_answers.get(task, {'choice_id': 'happy' if task == 'live2d_emotion_v1' else 'none', 'confidence': 0.95})
                   for task in route.request.post_data_json['tasks']}
        route.fulfill(headers={'access-control-allow-origin': '*'}, content_type='application/json',
                      body=json.dumps({'status': 'ok', 'answers': answers}))

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
        self.assertFalse(self.tts_calls, 'Loading a card must not request speech')
        return frame

    def check_chat(self, **kwargs):
        frame = self.open_app(**kwargs)
        field = frame.locator('#messageInput')
        self.assertTrue(frame.evaluate('window.enableVoice && window.enablePrimaryVoice'))
        self.assertEqual(frame.evaluate('window.selectedVoiceId'), 'en_us_001')
        frame.locator('#embedVoiceBtn').click()
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

    def test_memory_checkpoint_survives_real_chat_reload(self):
        frame = self.open_app(embed=False)
        self.reply = 'Compact names and promises.'
        frame.evaluate('''() => {
            conversationContext = [{ id: 'long-source', role: 'user', content: '日本語😀\\n'.repeat(12000) },
                ...Array.from({length: 9}, (_, i) => ({id: 'tail-' + i, role: i % 2 ? 'user' : 'assistant', content: 'Tail ' + i}))];
            conversationSummary = ''; summaryProgress = null;
            persistConversationMemory();
            ChatManager.loadChat(ChatManager.getActiveChatId());
        }''')
        self.assertTrue(frame.evaluate('maybeSummarizeConversation(true)'))
        self.assertEqual(frame.evaluate('summaryProgress.partial.id'), 'long-source')
        self.assertEqual(frame.evaluate('conversationContext[0].id'), 'long-source')
        frame.goto(APP)
        frame.wait_for_function('window.waifuBootComplete === true')
        self.assertEqual(frame.evaluate('summaryProgress.partial.id'), 'long-source')
        self.assertEqual(frame.locator('#long-source').count(), 1)
        for _ in range(8):
            if not frame.evaluate('Boolean(summaryProgress)'):
                break
            self.assertTrue(frame.evaluate('maybeSummarizeConversation(true)'))
        self.assertFalse(frame.evaluate('Boolean(summaryProgress)'))
        self.assertFalse(frame.evaluate('conversationContext.some(m => m.id === "long-source")'))
        self.assertEqual(frame.evaluate('conversationContext.at(-1).id'), 'tail-8')
        summaries = [c for c in self.calls if c['_purpose'] == 'summary']
        self.assertGreater(len(summaries), 1)
        for request in summaries:
            body = {k: v for k, v in request.items() if k != '_purpose'}
            self.assertLessEqual(len(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()), 262144)
            self.assertEqual(body['context_budget_version'], 1)
        self.assertFalse(self.errors, self.errors)

    def test_manual_memory_validation_and_clear_remove_checkpoint(self):
        frame = self.open_app(embed=False)
        frame.evaluate('''() => {
            conversationSummary = 'Original notes'; persistConversationMemory();
            document.getElementById('conversationSummary').value = '😀'.repeat(9000);
            handleSavePersona();
        }''')
        self.assertEqual(frame.evaluate('conversationSummary'), 'Original notes')
        self.assertIn('32 KiB', frame.locator('#summarySizeStatus').inner_text())
        frame.evaluate('''() => {
            summaryProgress = {partial: {id: 'old', offset: 2}}; summaryBackup = 'Original backup';
            persistConversationMemory();
            const createURL = URL.createObjectURL;
            URL.createObjectURL = blob => { window.memoryExport = blob; return createURL(blob); };
            ChatManager.exportAllChats();
        }''')
        exported = json.loads(frame.evaluate('memoryExport.text()'))
        self.assertEqual(exported['chats'][0]['summaryBackup'], 'Original backup')
        frame.evaluate('handleResetPersona()')
        data = frame.evaluate('ChatManager.getChatData(ChatManager.getActiveChatId())')
        self.assertIsNone(data['summaryProgress'])
        self.assertEqual(data['summaryBackup'], '')
        frame.evaluate('clearChatHistory()')
        self.assertIsNone(frame.evaluate('summaryProgress'))
        self.assertEqual(frame.evaluate('summaryBackup'), '')
        data = frame.evaluate('ChatManager.getChatData(ChatManager.getActiveChatId())')
        self.assertIsNone(data['summaryProgress'])
        self.assertEqual(data['summaryBackup'], '')
        self.assertEqual(data['conversationContext'], [])
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

    def test_full_app_mic_then_chat(self):
        self.check_full_app_mic_then_chat()

    def test_missing_chat_transport_recovers_after_recording(self):
        self.transport_failure = 'initial'
        self.check_full_app_mic_then_chat()
        self.assertEqual(self.transport_downloads, 2)

    def check_full_app_mic_then_chat(self):
        frame = self.open_app(embed=False)
        if self.transport_failure:
            self.assertEqual(frame.evaluate('typeof window.performLLMRequest'), 'undefined')
        frame.evaluate('''() => {
            window.enableVoice = false;
            window.sttEngine = 'proxy';
            const input = new AudioContext();
            const tone = input.createOscillator();
            const output = input.createMediaStreamDestination();
            tone.connect(output);
            tone.start();
            window.testMicInput = input;
            navigator.mediaDevices.getUserMedia = async () => {
                await input.resume();
                window.testMicStream = output.stream.clone();
                return window.testMicStream;
            };
        }''')
        mic = frame.locator('#micBtn')
        mic.focus()
        mic.press('Enter')
        frame.wait_for_function("document.querySelector('#micBtn').classList.contains('active')")
        self.page.wait_for_timeout(650)
        mic.press('Enter')
        frame.wait_for_function('messageInput.value === "Okay, that\'s nice."')
        self.assertEqual(len(self.transcriptions), 1)
        self.assertTrue(frame.evaluate("testMicStream.getTracks().every(track => track.readyState === 'ended')"))

        frame.locator('#sendMessageBtn').click()
        frame.locator('.message.model-message').filter(has_text=self.reply).wait_for()
        frame.wait_for_function('!window.isProcessing')
        frame.locator('#messageInput').fill('Typed after microphone')
        frame.locator('#messageInput').press('Enter')
        frame.wait_for_function('!window.isProcessing')
        chats = [c for c in self.calls if c['_purpose'] == 'chat']
        self.assertEqual([c['messages'][-1]['content'] for c in chats],
                         ["Okay, that's nice.", 'Typed after microphone'])
        self.assertEqual(frame.locator('.message.model-message').filter(has_text=self.reply).count(), 2)
        self.assertFalse(frame.evaluate("debugHistory.some(entry => /AI streaming response failed|AI response .* failed/.test(entry.message))"))
        self.assertFalse(self.errors, self.errors)
        frame.evaluate('testMicInput.close()')

    def test_missing_chat_transport_reports_load_error_and_allows_retry(self):
        self.transport_failure = 'always'
        frame = self.open_app(embed=False)
        frame.evaluate('window.enableVoice = false')
        frame.locator('#messageInput').fill('Keep this message')
        frame.locator('#messageInput').press('Enter')
        frame.locator('.message.model-message').filter(has_text='Chat support could not load.').wait_for()
        frame.wait_for_function('!window.isProcessing')
        self.assertFalse(self.calls, 'Missing transport must not send inference requests')
        self.assertEqual(frame.evaluate('conversationContext.filter(m => m.role === "user").at(-1).content'), 'Keep this message')
        self.assertFalse(frame.evaluate('conversationContext.some(m => m.role === "assistant" && m.content.includes("Chat support could not load"))'))
        self.assertEqual(self.transport_downloads, 2)

        self.transport_failure = None
        frame.locator('#messageInput').fill('Retry after script is available')
        frame.locator('#messageInput').press('Enter')
        frame.locator('.message.model-message').filter(has_text=self.reply).wait_for()
        frame.wait_for_function('!window.isProcessing')
        self.assertEqual(len([c for c in self.calls if c['_purpose'] == 'chat']), 1)
        self.assertEqual(self.transport_downloads, 3)
        self.assertFalse(self.errors, self.errors)

    def test_missing_transport_nonstreaming_and_shared_deadline(self):
        self.transport_failure = 'initial'
        frame = self.open_app(embed=False)
        result = frame.evaluate('''async () => {
            const append = document.head.appendChild.bind(document.head);
            const timeout = window.setTimeout;
            let scripts = 0;
            document.head.appendChild = script => { scripts++; return script; };
            window.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 8000 ? 25 : ms, ...args);
            try {
                const first = ensureLLMTransport();
                const second = ensureLLMTransport();
                const shared = first === second;
                const errors = await Promise.allSettled([first, second]);
                await ensureLLMTransport().catch(() => {});
                return {shared, scripts, codes: errors.map(result => result.reason.code)};
            } finally {
                document.head.appendChild = append;
                window.setTimeout = timeout;
            }
        }''')
        self.assertEqual(result, {'shared': True, 'scripts': 2,
                                  'codes': ['chat_script_unavailable', 'chat_script_unavailable']})
        reply = frame.evaluate('callConfiguredLLM([{role:"user", content:"Nonstreaming recovery"}])')
        self.assertEqual(reply['content'], self.reply)
        self.assertEqual(self.transport_downloads, 2)
        self.assertEqual(len(self.calls), 1)
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
            localStorage.setItem('waifu_x_enablePrimaryVoice', 'false');
            localStorage.setItem('waifu_x_enableFallbackVoice', 'false');
            localStorage.setItem('waifu_x_enableKokoro', 'false');
            localStorage.setItem('waifu_x_selectedVoiceId', 'en_us_002');
            localStorage.setItem('waifu_x_isAmbientQueueEnabled', 'true');
            localStorage.setItem('waifu_x_interfaceLanguage', 'zz-test');
            localStorage.setItem('waifu_x_openRouterApiKey', 'embed-test-key');
        }''')
        frame = self.open_app()
        self.assertFalse(frame.evaluate('window.enableVoice || window.isAmbientQueueEnabled || window.enableKokoro'))
        self.assertEqual(frame.evaluate('window.selectedVoiceId'), 'en_us_002')
        self.assertFalse(self.calls)

    def test_default_voice_plays_after_send(self):
        frame = self.open_app()
        self.assertTrue(frame.evaluate('window.enablePrimaryVoice && window.enableVoice'))
        self.assertEqual(frame.locator('#embedVoiceBtn').inner_text(), 'Voice on')
        frame.locator('#messageInput').fill('Hi!')
        frame.locator('#sendMessageBtn').click()
        frame.wait_for_function('dataLayer.some(e => e[0] === "event" && e[1] === "tts_played")')
        self.assertEqual(len(self.tts_calls), 1)
        self.assertEqual(self.tts_calls[0]['voice'], 'en_us_001')
        self.assertEqual(self.tts_calls[0]['text'], 'Mock reply received.')
        played = frame.evaluate('Array.from(dataLayer.find(e => e[0] === "event" && e[1] === "tts_played"))[2]')
        self.assertEqual(played['provider'], 'tiktok')
        self.assertFalse(played['fell_back'])
        self.assertEqual(played['voice_lang'], 'en-US')
        self.assertEqual(frame.evaluate('getTTSAudioContext().state'), 'running')
        self.assertFalse(self.errors, self.errors)

    def test_browser_language_and_japanese_reply(self):
        self.context.add_init_script("Object.defineProperty(navigator, 'language', {value: 'ja-JP'})")
        frame = self.open_app()
        self.assertEqual(frame.evaluate('window.selectedVoiceId'), 'jp_001')
        self.assertEqual(frame.evaluate('window.selectedLanguageCode'), 'en-US')
        self.assertTrue(frame.evaluate('window.enableAutoTtsLang && window.enableFallbackVoice'))
        self.reply = 'こんにちは。'
        frame.locator('#messageInput').fill('Say hello in Japanese')
        frame.locator('#sendMessageBtn').click()
        frame.wait_for_function('dataLayer.some(e => e[0] === "event" && e[1] === "tts_played")')
        self.assertEqual(self.tts_calls[0]['voice'], 'jp_001')  # Compatible selected voice is preserved.
        self.assertEqual(self.tts_calls[0]['text'], self.reply)
        self.assertEqual(frame.evaluate('AppStorage.getString(AppStorage.KEYS.SELECTED_VOICE_ID)'), 'jp_001')
        self.assertFalse(self.errors, self.errors)

    def test_browser_language_without_female_tiktok_voice(self):
        self.context.add_init_script("Object.defineProperty(navigator, 'language', {value: 'fr-FR'})")
        frame = self.open_app()
        self.assertEqual(frame.evaluate('window.selectedVoiceId'), 'en_us_001')

    def set_browser_languages(self, *tags):
        """Pin navigator.languages/language before any document runs, so the
        interface-language detection is deterministic."""
        self.context.add_init_script(
            "Object.defineProperty(navigator, 'languages', {value: %s});"
            "Object.defineProperty(navigator, 'language', {value: %s});"
            % (json.dumps(list(tags)), json.dumps(tags[0])))

    def test_interface_language_follows_the_browser(self):
        self.set_browser_languages('de-DE')
        frame = self.open_app()
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'de')
        self.assertEqual(frame.evaluate('document.documentElement.dir'), 'ltr')
        frame.locator('.settings-button').click()
        self.assertEqual(frame.locator('.settings-menu-item[data-submenu="group-language"] [data-i18n="menu.language"]').inner_text(), 'Sprache')
        frame.locator('[data-submenu="group-language"]').click()
        self.assertEqual(frame.locator('label[for="interfaceLanguageSelector"]').inner_text(), 'Oberflächensprache')
        # The picker offers native names, not English exonyms.
        self.assertEqual(frame.locator('#interfaceLanguageSelector').input_value(), 'auto')
        options = frame.evaluate("Array.from(document.getElementById('interfaceLanguageSelector').options).map(o => o.textContent)")
        self.assertIn('Deutsch', options)
        self.assertIn('日本語', options)
        self.assertIn('العربية', options)
        self.assertNotIn('German', options)
        self.assertNotIn('Japanese', options)
        self.assertFalse(self.errors, self.errors)

    def test_arabic_interface_is_right_to_left_and_mirrors_the_layout(self):
        self.set_browser_languages('ar-EG')
        frame = self.open_app(embed=False)
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'ar')
        self.assertEqual(frame.evaluate('document.documentElement.dir'), 'rtl')
        width = frame.evaluate('window.innerWidth')
        button = frame.locator('.settings-button').bounding_box()
        chat = frame.locator('.chat-container').bounding_box()
        # Pinned to inline-end and inline-start respectively, the settings control
        # moves to the left edge and the chat follows it instead of the LTR sides.
        self.assertLess(button['x'] + button['width'], width / 2)
        self.assertGreater(chat['x'], button['x'])
        # The [dir="rtl"] pass mirrors what logical properties cannot: the menu
        # chevron (scaleX(-1)) and the off-canvas drawer's slide direction.
        frame.locator('.settings-button').click()
        self.assertEqual(frame.evaluate("getComputedStyle(document.querySelector('.settings-menu-item .chevron')).transform"), 'matrix(-1, 0, 0, 1, 0, 0)')
        drawer_x = frame.evaluate("(() => {const m = getComputedStyle(document.querySelector('.chat-sidebar')).transform.match(/matrix\\(([^)]+)\\)/); return m ? parseFloat(m[1].split(',')[4]) : 0})()")
        self.assertGreater(drawer_x, 0)
        self.assertFalse(self.errors, self.errors)

    def test_saved_interface_language_beats_the_browser(self):
        self.set_browser_languages('ja-JP')
        self.context.add_init_script("if (location.hostname === 'companion.test') localStorage.setItem('waifu_x_interfaceLanguage', 'fr');")
        frame = self.open_app()
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'fr')
        frame.locator('.settings-button').click()
        self.assertEqual(frame.locator('.settings-menu-item[data-submenu="group-language"] [data-i18n="menu.language"]').inner_text(), 'Langue')
        frame.locator('[data-submenu="group-language"]').click()
        self.assertEqual(frame.locator('#interfaceLanguageSelector').input_value(), 'fr')
        self.assertFalse(self.errors, self.errors)

    def test_interface_language_choice_persists_across_a_reload(self):
        frame = self.open_app()
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'en')
        frame.locator('.settings-button').click()
        frame.locator('[data-submenu="group-language"]').click()
        frame.locator('#interfaceLanguageSelector').select_option('de')
        frame.wait_for_function("document.documentElement.lang === 'de'")
        self.assertEqual(frame.evaluate("localStorage.getItem('waifu_x_interfaceLanguage')"), 'de')
        frame.goto(APP + '?embed=x')
        frame.wait_for_function('window.waifuBootComplete === true', timeout=60000)
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'de')
        frame.locator('.settings-button').click()
        frame.locator('[data-submenu="group-language"]').click()
        self.assertEqual(frame.locator('#interfaceLanguageSelector').input_value(), 'de')
        self.assertFalse(self.errors, self.errors)

    def test_interface_language_is_independent_of_reply_language(self):
        frame = self.open_app()
        reply_before = frame.evaluate("document.getElementById('languageSelector').value")
        stored_before = frame.evaluate("AppStorage.getString(AppStorage.KEYS.SELECTED_LANGUAGE_CODE) || ''")
        self.assertEqual(frame.evaluate('window.selectedLanguageCode'), 'en-US')
        frame.locator('.settings-button').click()
        frame.locator('[data-submenu="group-language"]').click()
        frame.locator('#interfaceLanguageSelector').select_option('de')
        frame.wait_for_function("document.documentElement.lang === 'de'")
        # Switching the interface language leaves the response language, its
        # English-valued dropdown and its stored preference untouched.
        self.assertEqual(frame.evaluate('window.selectedLanguageCode'), 'en-US')
        self.assertEqual(frame.evaluate("document.getElementById('languageSelector').value"), reply_before)
        self.assertEqual(frame.evaluate("AppStorage.getString(AppStorage.KEYS.SELECTED_LANGUAGE_CODE) || ''"), stored_before)
        self.assertTrue(reply_before.startswith('en'), reply_before)
        self.assertEqual(frame.locator('#interfaceLanguageSelector').evaluate('el => el.selectedOptions[0].textContent'), 'Deutsch')
        self.assertFalse(self.errors, self.errors)

    def test_regional_tags_reduce_and_switching_is_immediate(self):
        self.set_browser_languages('pt-BR')
        frame = self.open_app()
        # The regional tag reduces to the base locale; <html lang> keeps the tag.
        self.assertEqual(frame.evaluate('document.documentElement.dataset.locale'), 'pt')
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'pt-BR')
        self.assertEqual(frame.evaluate('document.documentElement.dir'), 'ltr')
        # A key with no entry falls back to the key itself, never to blank text.
        self.assertEqual(frame.evaluate("WaifuI18n.t('no.such.key')"), 'no.such.key')
        # Switching locale repaints the live document with no reload, loading a
        # dictionary that the first paint did not need.
        frame.evaluate("WaifuI18n.setLocale('fa')")
        frame.wait_for_function("document.documentElement.dir === 'rtl'")
        self.assertEqual(frame.evaluate('document.documentElement.lang'), 'fa')
        frame.locator('.settings-button').click()
        label = frame.locator('.settings-menu-item[data-submenu="group-language"] [data-i18n="menu.language"]').inner_text()
        self.assertEqual(label, frame.evaluate("WaifuI18n.t('menu.language')"))
        self.assertNotEqual(label, 'Language')
        self.assertFalse(self.errors, self.errors)

    def test_mixed_direction_message_stays_inside_its_bubble(self):
        self.set_browser_languages('ar-EG')
        frame = self.open_app()
        chat = frame.locator('.chat-container').bounding_box()
        for text in ['Hello (123) — an English line inside an Arabic interface!', 'مرحبا! هل أنت بخير اليوم؟']:
            with self.subTest(text=text):
                before = frame.locator('.message.user-message').count()
                frame.locator('#messageInput').fill(text)
                frame.locator('#sendMessageBtn').click()
                frame.wait_for_function('!window.isProcessing')
                bubble = frame.locator('.message.user-message').nth(before)
                # Each run reads its own base direction instead of the bubble's,
                # so mixed-direction text cannot push the bubble out of the chat.
                self.assertEqual(bubble.locator('.message-original-text').evaluate('el => getComputedStyle(el).unicodeBidi'), 'plaintext')
                box = bubble.bounding_box()
                self.assertGreaterEqual(box['x'], chat['x'] - 1)
                self.assertLessEqual(box['x'] + box['width'], chat['x'] + chat['width'] + 1)
        self.assertFalse(self.errors, self.errors)

    def test_auto_routing_and_manual_voice_lock(self):
        frame = self.open_app()
        frame.locator('.settings-button').click()
        frame.locator('[data-submenu="group-voice"]').click()
        frame.locator('#voiceSelector').select_option('en_us_002')
        self.assertTrue(frame.locator('#enableAutoTtsLangCheckbox').is_checked())
        samples = [('こんにちは。', 'jp_003'), ('Hallo, ich bin hier und ich liebe dich.', 'de_001'),
                   ('Aku sayang kamu dan ingin tahu kabar kamu.', 'id_001'),
                   ('Eu gosto muito de você e estou aqui.', 'br_001'),
                   ('Hello, I am here for you.', 'en_us_002'), ('OK', 'en_us_002')]
        for text, expected in samples:
            with self.subTest(text=text):
                frame.evaluate('text => fetchTTSBuffer(text, window.selectedVoiceId)', text)
                self.assertEqual(self.tts_calls[-1]['voice'], expected)
                self.assertEqual(frame.evaluate('window.selectedVoiceId'), 'en_us_002')
        frame.locator('#enableAutoTtsLangCheckbox').uncheck()
        frame.evaluate('fetchTTSBuffer("こんにちは。", window.selectedVoiceId)')
        self.assertEqual(self.tts_calls[-1]['voice'], 'en_us_002')
        frame.goto(APP + '?embed=x')
        frame.wait_for_function('window.waifuBootComplete === true', timeout=60000)
        self.assertFalse(frame.evaluate('window.enableAutoTtsLang'))
        self.assertEqual(frame.evaluate('window.selectedVoiceId'), 'en_us_002')
        self.assertFalse(self.errors, self.errors)

    def test_language_aware_browser_fallback_and_mute(self):
        frame = self.open_app()
        frame.locator('#embedVoiceBtn').click()
        self.assertFalse(frame.evaluate('window.enableVoice'))
        frame.locator('#embedVoiceBtn').click()
        self.assertTrue(frame.evaluate('window.enableFallbackVoice'))
        self.tts_fail = True
        resolved = frame.evaluate('fetchTTSBuffer("こんにちは。", window.selectedVoiceId)')
        self.assertEqual(resolved, {'kind': 'browser', 'text': 'こんにちは。', 'voiceId': 'browser-female',
                                    'lang': 'ja-JP', 'provider': 'browser', 'fellBack': True, 'routingSignature': None})
        self.assertEqual(self.tts_calls[-1]['voice'], 'jp_003')
        before = len(self.tts_calls)
        browser = frame.evaluate('fetchTTSBuffer("こんにちは。", "browser-male")')
        self.assertEqual(browser['voiceId'], 'browser-male')
        self.assertEqual(browser['lang'], 'ja-JP')
        self.assertFalse(browser['fellBack'])
        self.assertEqual(len(self.tts_calls), before)
        # Explicit fallback-off continues to be respected during an outage.
        frame.evaluate('window.enableFallbackVoice = false')
        self.assertIsNone(frame.evaluate('fetchTTSBuffer("Hallo, ich bin hier.", window.selectedVoiceId)'))
        self.assertFalse(self.errors, self.errors)

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


    def test_zero_confidence_media_actions_honor_choices(self):
        frame = self.open_app()
        frame.evaluate("conversationContext = [{role: 'assistant', content: 'Want a picture at the beach?'}, {role: 'user', content: 'Yes please'}]")
        self.action_answers = {
            'picture_action_v1': {'choice_id': 'none', 'confidence': 0},
            'background_action_v1': {'choice_id': 'keep', 'confidence': 0},
        }
        self.assertIsNone(frame.evaluate("getImageDecision('Yes please')"))
        self.assertIsNone(frame.evaluate('getBackgroundScene()'))
        self.assertFalse(self.calls)
        self.action_answers = {
            'picture_action_v1': {'choice_id': 'draw', 'confidence': 0},
            'background_action_v1': {'choice_id': 'change', 'confidence': 0},
        }
        self.writer_replies = {
            'image_prompt': 'DRAW: An anime companion smiling on a beach at sunset',
            'background_prompt': 'SCENE: A quiet beach at sunset, warm light and gentle waves',
        }
        self.assertIn('beach', frame.evaluate("getImageDecision('Yes please')")['prompt'])
        self.assertIn('beach', frame.evaluate('getBackgroundScene()'))
        self.assertEqual([r['_purpose'] for r in self.calls], ['image_prompt', 'background_prompt'])
        self.assertIn('approved picture request', self.calls[0]['messages'][0]['content'])
        self.assertNotIn('NONE', self.calls[0]['messages'][0]['content'])
        self.assertNotIn('SAME', self.calls[1]['messages'][0]['content'])
        self.assertFalse(self.errors, self.errors)

    def test_tts_clear_french_and_spanish_are_local(self):
        frame = self.open_app()
        for text, voice in [('Bonjour, je suis contente de te voir.', 'fr_001'), ('Hola, gracias!', 'es_002')]:
            self.reply = text
            before = len(self.tts_calls)
            frame.locator('#messageInput').fill('Read this reply: ' + voice)
            frame.locator('#sendMessageBtn').click()
            frame.wait_for_function('n => dataLayer.filter(e => e[0] === "event" && e[1] === "tts_played").length > n', arg=before)
            self.assertEqual(self.tts_calls[-1]['voice'], voice)
        self.assertFalse(any('live2d_tts_language_v1' in r['tasks'] for r in self.decision_requests))
        self.assertFalse(self.errors, self.errors)

    def test_tts_uncertain_reply_shares_emotion_request(self):
        frame = self.open_app()
        self.reply = '*waves gently* Kimi no koe ga yasashikute kokoro ga atatakai.'
        self.language_answer = {'choice_id': 'ja-JP', 'confidence': 0}
        frame.locator('#messageInput').fill('Please read this')
        frame.locator('#sendMessageBtn').click()
        frame.wait_for_function('dataLayer.some(e => e[0] === "event" && e[1] === "tts_played")')
        requests = [r for r in self.decision_requests if 'live2d_tts_language_v1' in r['tasks']]
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]['tasks'], ['live2d_emotion_v1', 'live2d_tts_language_v1'])
        self.assertTrue(requests[0]['state']['reply'].startswith('*waves gently*'))
        self.assertFalse(requests[0]['state']['spoken_reply'].startswith('*'))
        self.assertEqual(self.tts_calls[0]['voice'], 'jp_003')
        before = len(self.decision_requests)
        frame.evaluate('text => playTTS(text, "en-US")', self.reply)
        frame.wait_for_function('dataLayer.filter(e => e[0] === "event" && e[1] === "tts_played").length >= 2')
        self.assertEqual(len(self.decision_requests), before)
        self.assertFalse(self.errors, self.errors)

    def test_tts_stop_rejects_pending_audio(self):
        frame = self.open_app()
        self.reply = 'Kimi no koe ga yasashikute kokoro ga atatakai.'
        self.hold_decisions = True
        frame.locator('#messageInput').fill('Please read this')
        frame.locator('#sendMessageBtn').click()
        frame.wait_for_function('isTTSBusy() && !window.isWaitingForAIResponse')
        self.assertIsNotNone(self.pending_decision)
        frame.evaluate('stopTTS()')
        self.fulfill_decision(self.pending_decision)
        frame.wait_for_timeout(80)
        self.assertFalse(self.tts_calls)
        self.assertFalse(frame.evaluate('isTTSBusy()'))
        self.assertFalse(self.errors, self.errors)

    def test_tts_available_browser_language_bypasses_primary(self):
        frame = self.open_app()
        frame.evaluate("speechSynthesis.getVoices = () => [{name: 'Arabic Female', lang: 'ar-SA'}]")
        result = frame.evaluate('fetchTTSBuffer("مرحبا كيف حالك اليوم؟", "en_us_001")')
        self.assertEqual(result['provider'], 'browser')
        self.assertEqual(result['lang'], 'ar-SA')
        self.assertFalse(self.tts_calls)



    def test_long_reply_preserves_emotional_ending_in_decision_request(self):
        self.reply = 'Opening. ' + 'x' * 5000 + ' I am thrilled!'
        frame = self.open_app()
        frame.evaluate('window.enableVoice = false')
        frame.locator('#messageInput').fill('Hello')
        with self.page.expect_request('**/decisions') as captured:
            frame.locator('#sendMessageBtn').click()
        state = captured.value.post_data_json['state']
        self.assertLessEqual(len(state['reply']), 4096)
        self.assertTrue(state['reply'].startswith('Opening. '))
        self.assertTrue(state['reply'].endswith('I am thrilled!'))
        self.assertIn('[...]', state['reply'])
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
