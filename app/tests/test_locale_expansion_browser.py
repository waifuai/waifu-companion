"""Full interface locale loading and picker checks; inference is mocked."""
import unittest
import test_player_card as fixtures

EXPANDED = ['bn', 'ko', 'hi', 'tr', 'vi', 'uk', 'cs', 'th', 'nl', 'el', 'ro', 'hu', 'fi', 'my', 'ur', 'fil', 'ta', 'uz', 'si']


class LocaleExpansionTests(unittest.TestCase):
    assets = {}
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    setUp = fixtures.PlayerCardTests.setUp
    tearDown = fixtures.PlayerCardTests.tearDown
    route = fixtures.PlayerCardTests.route
    fulfill_decision = fixtures.PlayerCardTests.fulfill_decision
    open_app = fixtures.PlayerCardTests.open_app
    set_browser_languages = fixtures.PlayerCardTests.set_browser_languages

    def test_new_browser_locale_is_ready_when_the_interface_initializes(self):
        self.set_browser_languages('ko-KR')
        self.context.add_init_script("document.addEventListener('DOMContentLoaded', () => window.__langAtReady = document.documentElement.lang, {once:true})")
        requests = []
        self.context.on('request', lambda r: requests.append(r.url))
        frame = self.open_app(width=390, height=760, embed=False)
        self.assertEqual(frame.evaluate('window.__langAtReady'), 'ko')
        self.assertEqual(frame.evaluate('WaifuI18n.locale'), 'ko')
        loaded = {url.split('/i18n/locales/')[1].split('?')[0] for url in requests if '/i18n/locales/' in url}
        self.assertEqual(loaded, {'en.js', 'ko.js'}, 'startup loads only English and the matched dictionary')
        # The preload scanner may request app modules before the parser reaches
        # document.write; readiness and rendered copy establish execution order.
        self.assertTrue(any('/i18n/locales/ko.js' in url for url in requests))
        self.assertEqual(frame.get_attribute('#messageInput', 'placeholder'),
                         frame.evaluate("WaifuI18n.dictionary('ko')['chat.inputPlaceholder']"))
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)

    def test_every_new_locale_switches_and_persists_in_full_app_and_embed(self):
        for embed in [False, True]:
            with self.subTest(embed=embed):
                frame = self.open_app(width=480 if embed else 390, height=760, embed=embed)
                frame.locator('.settings-button').click()
                frame.locator('[data-submenu="group-language"]').click()
                frame.locator('#languageSelector').select_option('es-ES')
                values = frame.locator('#interfaceLanguageSelector option').evaluate_all('els => els.map(el => el.value)')
                self.assertEqual(len(values), 34)
                for code in ['it', *EXPANDED]:
                    with self.subTest(locale=code):
                        self.assertIn(code, values)
                        frame.locator('#interfaceLanguageSelector').select_option(code)
                        frame.wait_for_function('code => WaifuI18n.locale === code', arg=code)
                        self.assertEqual(frame.get_attribute('#messageInput', 'placeholder'),
                                         frame.evaluate("code => WaifuI18n.dictionary(code)['chat.inputPlaceholder']", code))
                        self.assertEqual(frame.locator('#languageSelector').input_value(), 'es-ES')
                        self.assertEqual(frame.evaluate('window.selectedLanguageCode'), 'es-ES')
                        self.assertEqual(frame.evaluate('document.documentElement.dir'), 'rtl' if code == 'ur' else 'ltr')
                        self.assertTrue(frame.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                key = 'waifu_x_interfaceLanguage' if embed else 'interfaceLanguage'
                self.assertEqual(frame.evaluate('key => localStorage.getItem(key)', key), 'si')
                frame.goto(fixtures.APP + ('?embed=x' if embed else ''))
                frame.wait_for_function('window.waifuBootComplete === true', timeout=60000)
                self.assertEqual(frame.evaluate('WaifuI18n.locale'), 'si')
                self.assertEqual(frame.get_attribute('#messageInput', 'placeholder'),
                                 frame.evaluate("WaifuI18n.dictionary('si')['chat.inputPlaceholder']"))
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)

    def test_tagalog_browser_locale_starts_as_filipino(self):
        self.set_browser_languages('tl-PH')
        self.context.add_init_script("document.addEventListener('DOMContentLoaded', () => window.__langAtReady = document.documentElement.lang, {once:true})")
        frame = self.open_app(width=390, height=760, embed=False)
        self.assertEqual(frame.evaluate('window.__langAtReady'), 'fil')
        self.assertEqual(frame.evaluate('WaifuI18n.locale'), 'fil')
        self.assertEqual(frame.evaluate('document.documentElement.dir'), 'ltr')
        self.assertEqual(frame.get_attribute('#messageInput', 'placeholder'),
                         frame.evaluate("WaifuI18n.dictionary('fil')['chat.inputPlaceholder']"))
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)

    def test_device_language_loads_after_a_saved_choice(self):
        self.set_browser_languages('bn-BD')
        self.context.add_init_script("localStorage.setItem('interfaceLanguage', 'fr')")
        frame = self.open_app(width=390, height=760, embed=False)
        self.assertEqual(frame.evaluate('WaifuI18n.locale'), 'fr')
        self.assertIsNone(frame.evaluate("WaifuI18n.dictionary('bn')"))
        frame.locator('.settings-button').click()
        frame.locator('[data-submenu="group-language"]').click()
        frame.locator('#interfaceLanguageSelector').select_option('auto')
        frame.wait_for_function("WaifuI18n.locale === 'bn'")
        self.assertEqual(frame.get_attribute('#messageInput', 'placeholder'),
                         frame.evaluate("WaifuI18n.dictionary('bn')['chat.inputPlaceholder']"))
        self.assertEqual(frame.evaluate("localStorage.getItem('interfaceLanguage')"), 'auto')
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
