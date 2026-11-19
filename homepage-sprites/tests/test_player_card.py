"""Browser regression checks for real chat gestures inside sandboxed cards.

Run: python homepage-sprites/tests/test_player_card.py
Requires Playwright and its Chromium browser. All network requests are mocked.
"""
import json
import mimetypes
from pathlib import Path
import unittest
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP = 'https://sprites.test/'


class PlayerCardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 600, 'height': 600})
        self.context.set_default_timeout(6000)
        self.calls = []
        self.cloud_requests = []
        self.retired_requests = []
        self.errors = []
        self.reply_text = '[happy] Mock reply received.'
        self.context.route('**/*', self.route)
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))

    def tearDown(self):
        self.context.close()

    def seed_byo_provider(self, page=None):
        """Opt a page into a mock bring-your-own-key provider for transport tests."""
        target = page or self.page
        target.evaluate("""() => {
            Chat.settings.provider = 'custom';
            Chat.settings.customBaseUrl = 'https://provider.test/v1';
            Chat.settings.keys.custom = 'test-key';
            Chat.settings.models.custom = 'test-model';
            Chat.saveSettings();
        }""")

    def use_local_provider(self, page=None):
        """Restore the retired-endpoint-free default after a BYO transport test."""
        target = page or self.page
        target.evaluate("() => { Chat.settings.provider = 'cloud'; Chat.saveSettings(); }")

    def route(self, route):
        url = urlparse(route.request.url)
        if url.hostname == 'sprites.test':
            file = (ROOT / unquote(url.path).lstrip('/')).resolve()
            if file.is_dir():
                file = file / 'index.html'
            if file.is_relative_to(ROOT) and file.is_file():
                route.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())
            else:
                route.fulfill(status=404)
        elif url.path.endswith('/chat/completions'):
            request = route.request.post_data_json
            self.cloud_requests.append({'path': url.path, 'headers': route.request.all_headers(), 'body': request})
            if request.get('stream'):
                self.calls.append(request)
                event = {'choices': [{'delta': {'content': self.reply_text}}]}
                route.fulfill(content_type='text/event-stream', body='data: ' + json.dumps(event) + '\n\ndata: [DONE]\n\n')
            else:
                route.fulfill(content_type='application/json', body=json.dumps({'choices': [{'message': {'content': 'Test chat'}}]}))
        elif any(marker in url.path for marker in ('/decisions', '/tts', '/image', '/transcribe')):
            # Any attempt to reach a retired endpoint fails loudly in the suite.
            self.retired_requests.append(route.request.url)
            route.fulfill(status=404)
        else:
            # Analytics and other external services never reach production.
            route.fulfill(content_type='application/javascript', body='')

    def test_local_reply_sets_emotion_without_decision_requests(self):
        cases = [('hi', 'happy'), ('Explain this', 'curious'),
                 ('I love you', 'love'), ('I am sad', 'empathetic')]
        for text, emotion in cases:
            with self.subTest(text=text):
                self.page.goto(APP)
                self.page.evaluate("""() => {
                    window.emotionCalls = [];
                    const original = Sprites.setEmotion;
                    Sprites.setEmotion = name => { emotionCalls.push(name); return original(name); };
                }""")
                expected = self.page.evaluate('(text) => LocalFallbackEngine.getResponse(text).reply', text)
                self.page.locator('#msgInput').fill(text)
                self.page.locator('#sendBtn').click()
                self.page.wait_for_function('() => !Chat.busy')
                self.assertEqual(self.page.evaluate('emotionCalls'), [emotion])
                self.assertIn(expected, self.page.locator('.msg.assistant:not(.typing)').last.inner_text())
                self.assertFalse(self.calls)
                self.assertFalse(self.retired_requests)
                self.assertFalse(self.errors, self.errors)

    def test_decision_api_is_a_local_noop(self):
        self.page.goto(APP)
        answer = self.page.evaluate("""async () =>
            await Chat.askDecisions(['sprites_emotion_v1', 'sprites_tts_language_v1'], {})""")
        self.assertIsNone(answer)
        self.assertFalse(self.calls, 'Decisions must never create an inference request')
        self.assertFalse(self.retired_requests, 'Decisions must never call /decisions')
        self.assertFalse(self.errors, self.errors)

    def test_local_fallback_sends_ga4_insights(self):
        self.page.goto(APP)
        self.page.evaluate("""() => {
            window.gtagCalls = [];
            window.gtag = (...args) => { gtagCalls.push(args); };
        }""")
        self.page.locator('#msgInput').fill('hello')
        self.page.locator('#sendBtn').click()
        self.page.wait_for_function('() => !Chat.busy')
        events = self.page.evaluate("() => gtagCalls.filter(call => call[0] === 'event')")
        names = [event[1] for event in events]
        self.assertIn('chat_message_sent', names)
        self.assertIn('llm_stream_completed', names)
        fallback = next(event for event in events if event[1] == 'offline_fallback_reply')
        params = fallback[2]
        self.assertEqual(params['app_source'], 'homepage-sprites')
        self.assertEqual(params['engine'], 'local-template-v2')
        self.assertEqual(params['persona'], 'aurora')
        self.assertEqual(params['emotion'], 'happy')
        self.assertEqual(params['pattern'], 'offline.greeting')
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def test_persona_change_changes_local_reply(self):
        self.page.goto(APP)
        self.page.evaluate("() => { Chat.settings.persona = 'tsundere'; Chat.saveSettings(); }")
        self.page.locator('#msgInput').fill('hello')
        self.page.locator('#sendBtn').click()
        self.page.wait_for_function('() => !Chat.busy')
        reply = self.page.locator('.msg.assistant:not(.typing)').last.inner_text()
        self.assertTrue(reply.startswith('Hmph—'), reply)
        self.assertIn('Not that I care or anything.', reply)
        self.assertFalse(self.calls)
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def check_chat(self, sandbox=None, blocked_storage=False):
        if blocked_storage:
            self.context.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Blocked', 'SecurityError')}})")
        if sandbox is None:
            self.page.goto(APP)
            app = self.page
        else:
            self.context.route('https://host.test/', lambda r: r.fulfill(content_type='text/html', body=f'<iframe title="App" src="{APP}?embed=x" sandbox="{sandbox}" style="width:480px;height:480px"></iframe>'))
            self.page.goto('https://host.test/')
            app = self.page.frame_locator('iframe')
        field = app.locator('#msgInput')
        field.wait_for()
        replies = app.locator('.msg.assistant:not(.typing)')
        self.assertEqual(replies.count(), 0, 'No reply until a user sends a message')
        app.locator('#speakToggle').click()
        # A starter button is the known working path reported by the user.
        app.locator('.starters button').first.click()
        replies.nth(0).wait_for()
        self.assertTrue(replies.nth(0).inner_text().strip())

        # Physical input and click: do not dispatch submit or call requestSubmit.
        field.click()
        field.press_sequentially('Send with button')
        self.assertEqual(field.input_value(), 'Send with button')
        app.locator('#sendBtn').click()
        replies.nth(1).wait_for()
        self.assertEqual(field.input_value(), '')

        # Enter while an IME is composing must not prematurely send the text.
        field.fill('Send with Enter')
        field.dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
        field.dispatch_event('keydown', {'key': 'Enter', 'keyCode': 229})
        self.assertEqual(field.input_value(), 'Send with Enter')
        self.assertEqual(replies.count(), 2)
        field.press('Enter')
        replies.nth(2).wait_for()
        self.assertEqual(replies.count(), 3, 'Enter must send exactly once')
        self.assertEqual(field.input_value(), '')
        app.locator('#sendBtn').click()
        field.press('Enter')
        self.assertEqual(replies.count(), 3, 'Empty messages must not send')

        # Sandboxed cards must work with the built-in provider alone.
        self.assertFalse(self.calls, 'Local replies must not create inference requests')
        self.assertFalse(self.cloud_requests)
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def test_memory_checkpoint_and_archive_survive_reload(self):
        self.page.goto(APP)
        # Memory compression still works for visitors who opt into a BYO key;
        # the built-in provider deliberately keeps every message instead.
        self.seed_byo_provider()
        conversation = self.page.evaluate('''() => {
            Chat.newConversation();
            Chat.messages.push({id: 'long-source', role: 'user', content: '日本語😀\\n'.repeat(12000)},
                ...Array.from({length: 9}, (_, i) => ({id: 'tail-' + i, role: i % 2 ? 'user' : 'assistant', content: 'Tail ' + i})));
            localStorage.setItem('ws_conv_' + Chat.convId, JSON.stringify(Chat.messages));
            return Chat.convId;
        }''')
        self.assertTrue(self.page.evaluate('Chat.summarize(true)'))
        self.assertTrue(self.page.evaluate('Chat.memoryPending'))
        self.page.reload()
        self.page.evaluate('(id) => Chat.openConversation(id)', conversation)
        self.assertTrue(self.page.evaluate('Chat.memoryPending'))
        for _ in range(8):
            if not self.page.evaluate('Chat.memoryPending'):
                break
            self.assertTrue(self.page.evaluate('Chat.summarize(true)'))
        self.assertFalse(self.page.evaluate('Chat.memoryPending'))
        self.assertEqual(self.page.evaluate('Chat.messages.length'), 10)
        self.assertEqual(self.page.evaluate('Chat.messages[0].id'), 'long-source')
        self.assertEqual(self.page.evaluate('Chat.unsummarizedStart()'), 6)
        summaries = [c['body'] for c in self.cloud_requests
                     if any('memory compression engine' in m.get('content', '')
                            for m in c['body']['messages'])]
        self.assertGreater(len(summaries), 1)
        for request in summaries:
            self.assertLessEqual(len(json.dumps(request, ensure_ascii=False, separators=(',', ':')).encode()), 262144)
            self.assertFalse(request['stream'])
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def test_manual_summary_size_feedback_keeps_saved_memory(self):
        self.page.goto(APP)
        self.page.evaluate("Chat.newConversation(); Chat.setSummary('Original notes')")
        self.page.locator('#settingsBtn').click()
        field = self.page.locator('#summaryText')
        self.assertIn('14 / 32768 bytes', self.page.locator('#summarySizeStatus').inner_text())
        field.fill('😀' * 9000)
        self.assertIn('36000 / 32768 bytes', self.page.locator('#summarySizeStatus').inner_text())
        field.dispatch_event('change')
        self.assertEqual(self.page.evaluate('Chat.summary'), 'Original notes')
        self.assertEqual(field.input_value(), 'Original notes')
        self.assertIn('32 KiB', self.page.locator('#summarySizeStatus').inner_text())
        self.assertFalse(self.errors, self.errors)

    def test_full_app(self):
        self.check_chat()

    def test_iframe_with_forms(self):
        self.check_chat('allow-scripts allow-same-origin allow-forms')

    def test_iframe_without_forms(self):
        self.check_chat('allow-scripts allow-same-origin')

    def test_iframe_without_forms_or_storage(self):
        self.check_chat('allow-scripts', blocked_storage=True)

    def check_picture_unavailable(self, sandbox=None):
        if sandbox is None:
            self.page.goto(APP)
            app = self.page
        else:
            self.context.route('https://host.test/', lambda r: r.fulfill(content_type='text/html', body=f'<iframe src="{APP}?embed=x" sandbox="{sandbox}"></iframe>'))
            self.page.goto('https://host.test/')
            app = self.page.frame_locator('iframe')
        app.locator('#speakToggle').click()
        app.locator('#msgInput').fill('Send me a selfie')
        app.locator('#sendBtn').click()
        app.locator('.msg.assistant:not(.typing)').first.wait_for()
        self.assertEqual(app.locator('.msg img').count(), 0, 'Picture generation is disabled')
        self.assertFalse(self.calls)
        self.assertFalse(self.cloud_requests)
        self.assertFalse(self.retired_requests, 'Pictures must not call /decisions or /image')
        self.assertFalse(self.errors, self.errors)

    def test_picture_api_is_a_local_noop(self):
        self.page.goto(APP)
        decision = self.page.evaluate("async () => await Pictures.decide('Send me a selfie', '')")
        self.assertIsNone(decision)
        outcome = self.page.evaluate("""async () => {
            try { await Pictures.draw('a prompt', 'square', []); return 'drawn'; }
            catch (e) { return e.unavailable ? 'unavailable' : 'other'; }
        }""")
        self.assertEqual(outcome, 'unavailable')
        self.assertFalse(self.calls)
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def test_picture_requests_are_ignored_in_full_app(self):
        self.check_picture_unavailable()

    def test_picture_requests_are_ignored_in_embedded_card(self):
        self.check_picture_unavailable('allow-scripts allow-same-origin')


    def instrument_browser_speech(self, languages=('en-US',)):
        self.page.evaluate("""(langs) => {
            window.spokenLanguages = [];
            window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
            speechSynthesis.getVoices = () => langs.map(lang => ({name: 'Test Female', lang}));
            speechSynthesis.speak = u => { spokenLanguages.push(u.lang); queueMicrotask(() => u.onend?.()); };
        }""", list(languages))

    def test_tts_uses_browser_voice_without_cloud_requests(self):
        self.page.goto(APP)
        self.page.evaluate("() => { Speech.settings.voiceId = 'browser-female'; Speech.save(); }")
        self.instrument_browser_speech()
        self.page.locator('#msgInput').fill('hello')
        self.page.locator('#sendBtn').click()
        self.page.wait_for_function('() => !Chat.busy && !Speech.speaking')
        self.assertEqual(len(self.page.evaluate('spokenLanguages')), 1)
        self.assertFalse(self.calls)
        self.assertFalse(self.cloud_requests)
        self.assertFalse(self.retired_requests, 'Speech must not call /tts or /decisions')
        self.assertFalse(self.errors, self.errors)

    def test_tts_clear_french_and_spanish_use_picked_browser_voice(self):
        self.page.goto(APP)
        self.seed_byo_provider()
        # With a browser voice explicitly picked, replies stay on the browser
        # path and the cloud speech endpoint is never called.
        self.page.evaluate("() => { Speech.settings.voiceId = 'browser-female'; Speech.save(); }")
        self.instrument_browser_speech(('fr-FR', 'es-ES'))
        for text, language in [('Bonjour, je suis contente de te voir.', 'fr-FR'), ('Hola, gracias!', 'es-ES')]:
            self.reply_text = '[happy] ' + text
            self.page.locator('#msgInput').fill('Read this reply')
            self.page.locator('#sendBtn').click()
            self.page.wait_for_function('!Chat.busy && !Speech.speaking')
            self.assertEqual(self.page.evaluate('spokenLanguages.at(-1)'), language)
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def test_tts_mute_toggle_suppresses_browser_speech(self):
        self.page.goto(APP)
        self.instrument_browser_speech()
        self.page.locator('#speakToggle').click()
        self.page.locator('#msgInput').fill('hello')
        self.page.locator('#sendBtn').click()
        self.page.wait_for_function('() => !Chat.busy')
        self.assertEqual(self.page.evaluate('spokenLanguages'), [])
        self.page.locator('#speakToggle').click()
        self.page.locator('#msgInput').fill('hi again')
        self.page.locator('#sendBtn').click()
        self.page.wait_for_function('() => !Chat.busy && !Speech.speaking')
        self.assertEqual(len(self.page.evaluate('spokenLanguages')), 1)
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    def test_long_input_never_reaches_a_retired_endpoint(self):
        self.page.goto(APP)
        self.page.locator('#speakToggle').click()
        self.page.locator('#msgInput').fill('x' * 5000)
        self.page.locator('#sendBtn').click()
        self.page.wait_for_function('() => !Chat.busy')
        self.assertTrue(self.page.locator('.msg.assistant:not(.typing)').count() >= 1)
        self.assertFalse(self.calls)
        self.assertFalse(self.retired_requests)
        self.assertFalse(self.errors, self.errors)

    # ── Interface localization ──
    def open_with_locale(self, locale):
        """A fresh context whose browser reports `locale`, so detection runs."""
        context = self.browser.new_context(viewport={'width': 600, 'height': 600}, locale=locale)
        context.set_default_timeout(6000)
        context.route('**/*', self.route)
        context.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { window.__langAtReady = document.getElementById(\"stage\").lang; }, { once: true })")
        self.addCleanup(context.close)
        page = context.new_page()
        page.on('pageerror', lambda e: self.errors.append(str(e)))
        return page

    def test_first_visit_uses_browser_language_without_an_english_flash(self):
        page = self.open_with_locale('ja-JP')
        requests = []
        page.on('request', lambda r: requests.append(r.url))
        page.goto(APP)
        page.wait_for_selector('#msgInput')
        index = lambda fragment: next(i for i, url in enumerate(requests) if fragment in url)
        # The matched dictionary is parsed before the app scripts, so no English
        # ever paints.
        self.assertLess(index('/homepage-sprites/i18n/locales/ja.js'), index('/homepage-sprites/app.js'))
        self.assertLess(index('/homepage-sprites/i18n/locales/ja.js'), index('/homepage-sprites/chat.js'))
        self.assertEqual(page.evaluate('window.__langAtReady'), 'ja')
        self.assertEqual(page.evaluate('document.getElementById(\"stage\").lang'), 'ja')
        self.assertEqual(page.evaluate('document.getElementById(\"stage\").dir'), 'ltr')
        self.assertEqual(page.evaluate('WaifuI18n.locale'), 'ja')
        self.assertNotEqual(page.get_attribute('#msgInput', 'placeholder'), 'Say something...')
        self.assertEqual(page.locator('#spriteLabel').inner_text(), page.evaluate("WaifuI18n.t('sprite.state.idle')"))
        saved = page.evaluate("localStorage.getItem('ws_locale')")
        self.assertIsNone(saved, 'detection must not write a choice')
        self.assertFalse(self.errors, self.errors)

    def test_switching_language_is_instant_and_persists(self):
        self.page.goto(APP)
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").lang'), 'en')
        self.page.evaluate("window.__noReloadMarker = true; WaifuI18n.setLocale('ar')")
        self.page.wait_for_function("document.getElementById(\"stage\").lang === 'ar'")
        # No reload: the same document, and Arabic applied in place.
        self.assertTrue(self.page.evaluate('window.__noReloadMarker === true'))
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").dir'), 'rtl')
        self.assertEqual(self.page.evaluate("localStorage.getItem('ws_locale')"), 'ar')
        self.assertEqual(self.page.get_attribute('#msgInput', 'placeholder'),
                         self.page.evaluate("WaifuI18n.t('composer.placeholder')"))
        self.page.reload()
        self.page.wait_for_selector('#msgInput')
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").lang'), 'ar')
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").dir'), 'rtl')
        self.assertFalse(self.errors, self.errors)

    def test_device_language_choice_is_remembered_as_auto(self):
        self.page.goto(APP)
        self.page.evaluate("WaifuI18n.setLocale('de')")
        self.page.wait_for_function("document.getElementById(\"stage\").lang === 'de'")
        self.page.evaluate("WaifuI18n.setLocale('auto')")
        self.page.wait_for_function("document.getElementById(\"stage\").lang === 'en'")
        self.assertEqual(self.page.evaluate("localStorage.getItem('ws_locale')"), 'auto')
        self.assertFalse(self.errors, self.errors)

    def test_settings_language_picker_lists_native_names_and_switches(self):
        self.page.goto(APP)
        self.page.locator('#settingsBtn').click()
        options = self.page.locator('#interfaceLanguage option').all_inner_texts()
        self.assertTrue(options[0].startswith('Use device language'))
        self.assertIn('日本語', options)
        self.assertIn('العربية', options)
        self.page.select_option('#interfaceLanguage', 'fr')
        self.page.wait_for_function("document.getElementById(\"stage\").lang === 'fr'")
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").dir'), 'ltr')
        self.assertEqual(self.page.evaluate("localStorage.getItem('ws_locale')"), 'fr')
        # Reply-language values stay English; only the labels become native names.
        self.assertEqual(self.page.evaluate("Chat.LANGUAGES.includes('Japanese')"), True)
        self.assertIn('日本語', self.page.locator('#replyLanguage option').all_inner_texts())
        self.assertFalse(self.errors, self.errors)

    def test_rtl_layout_and_mixed_direction_content(self):
        self.page.goto(APP)
        self.page.evaluate("WaifuI18n.setLocale('fa')")
        self.page.wait_for_function("document.getElementById(\"stage\").dir === 'rtl'")
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").lang'), 'fa')
        # Panels mirror to the logical edges.
        self.page.locator('#settingsBtn').click()
        self.assertEqual(self.page.evaluate(
            "getComputedStyle(document.getElementById('settingsPanel')).insetInlineStart"), '0px')
        self.page.locator('#settingsPanel [data-close]').click()
        self.page.locator('#historyBtn').click()
        self.assertEqual(self.page.evaluate(
            "getComputedStyle(document.getElementById('historyPanel')).insetInlineEnd"), '0px')
        # Chat bubbles and the composer stay direction-safe for mixed text.
        self.assertEqual(self.page.get_attribute('#msgInput', 'dir'), 'auto')
        self.assertEqual(self.page.evaluate("document.querySelector('.msg .text').getAttribute('dir')"), 'auto')
        self.assertFalse(self.errors, self.errors)

    def test_english_fallback_and_long_strings_do_not_overflow(self):
        self.page.goto(APP)
        self.assertEqual(self.page.evaluate("WaifuI18n.t('no.such.key')"), 'no.such.key')
        self.assertEqual(self.page.evaluate("WaifuI18n.t('app.retry')"),
                         self.page.evaluate("WaifuI18n.dictionary('en')['app.retry']"))
        self.page.evaluate("WaifuI18n.setLocale('de')")
        self.page.wait_for_function("document.getElementById(\"stage\").lang === 'de'")
        self.page.locator('#settingsBtn').click()
        overflow = self.page.evaluate("""() => {
            const selector = '#settingsPanel .row > span, #settingsPanel .option span, #settingsPanel .option small,'
                + ' #settingsPanel .note, #settingsPanel .field-label, #settingsPanel h3';
            const bad = [];
            for (const el of document.querySelectorAll(selector)) {
                if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) bad.push(el.textContent.trim().slice(0, 40));
            }
            return bad;
        }""")
        self.assertEqual(overflow, [])
        self.assertFalse(self.errors, self.errors)

    def test_embed_keeps_its_own_language_choice(self):
        context = self.browser.new_context(viewport={'width': 480, 'height': 480}, locale='fr-FR')
        context.set_default_timeout(6000)
        context.route('**/*', self.route)
        self.addCleanup(context.close)
        page = context.new_page()
        page.on('pageerror', lambda e: self.errors.append(str(e)))
        page.goto(APP + '?embed=x')
        page.wait_for_selector('#msgInput')
        self.assertEqual(page.evaluate('document.getElementById(\"stage\").lang'), 'fr')
        page.evaluate("WaifuI18n.setLocale('es')")
        page.wait_for_function("document.getElementById(\"stage\").lang === 'es'")
        self.assertEqual(page.evaluate("localStorage.getItem('ws_locale')"), 'es')
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main()
