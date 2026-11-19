"""Full interface locale loading and picker checks; all network is mocked."""
import unittest
import test_player_card as fixtures

EXPANDED = ['bn', 'ko', 'hi', 'tr', 'vi', 'uk', 'cs', 'th', 'nl', 'el', 'ro', 'hu', 'fi', 'my', 'ur', 'fil', 'ta', 'uz', 'si']


class LocaleExpansionTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    setUp = fixtures.PlayerCardTests.setUp
    tearDown = fixtures.PlayerCardTests.tearDown
    route = fixtures.PlayerCardTests.route
    open_with_locale = fixtures.PlayerCardTests.open_with_locale

    def test_new_browser_locale_loads_before_app_scripts(self):
        page = self.open_with_locale('ko-KR')
        requests = []
        page.on('request', lambda r: requests.append(r.url))
        page.goto(fixtures.APP)
        self.assertEqual(page.evaluate('window.__langAtReady'), 'ko')
        self.assertEqual(page.evaluate('WaifuI18n.locale'), 'ko')
        loaded = {url.split('/i18n/locales/')[1].split('?')[0] for url in requests if '/i18n/locales/' in url}
        self.assertEqual(loaded, {'en.js', 'ko.js'}, 'startup loads only English and the matched dictionary')
        index = lambda fragment: next(i for i, url in enumerate(requests) if fragment in url)
        self.assertLess(index('/i18n/locales/ko.js'), index('/homepage-sprites/app.js'))
        self.assertEqual(page.get_attribute('#msgInput', 'placeholder'),
                         page.evaluate("WaifuI18n.dictionary('ko')['composer.placeholder']"))
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)

    def test_every_new_locale_switches_and_persists_in_full_app_and_embed(self):
        for embed in [False, True]:
            with self.subTest(embed=embed):
                self.page.set_viewport_size({'width': 480 if embed else 390, 'height': 760})
                self.page.goto(fixtures.APP + ('?embed=x' if embed else ''))
                self.page.locator('#settingsBtn').click()
                self.page.locator('#replyLanguage').select_option('Spanish')
                values = self.page.locator('#interfaceLanguage option').evaluate_all('els => els.map(el => el.value)')
                self.assertEqual(len(values), 34)  # 33 locales and device language.
                for code in ['it', *EXPANDED]:
                    with self.subTest(locale=code):
                        self.assertIn(code, values)
                        self.page.locator('#interfaceLanguage').select_option(code)
                        self.page.wait_for_function('code => WaifuI18n.locale === code', arg=code)
                        self.assertEqual(self.page.get_attribute('#msgInput', 'placeholder'),
                                         self.page.evaluate("code => WaifuI18n.dictionary(code)['composer.placeholder']", code))
                        self.assertEqual(self.page.locator('#replyLanguage').input_value(), 'Spanish')
                        self.assertEqual(self.page.evaluate('Chat.settings.language'), 'Spanish')
                        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").dir'), 'rtl' if code == 'ur' else 'ltr')
                        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                key = 'ws_locale'
                self.assertEqual(self.page.evaluate('key => localStorage.getItem(key)', key), 'si')
                self.page.reload()
                self.assertEqual(self.page.evaluate('WaifuI18n.locale'), 'si')
                self.assertEqual(self.page.get_attribute('#msgInput', 'placeholder'),
                                 self.page.evaluate("WaifuI18n.dictionary('si')['composer.placeholder']"))
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)

    def test_new_urdu_and_tagalog_browser_locales_start_correctly(self):
        for tag, code, direction in [('ur-PK', 'ur', 'rtl'), ('tl-PH', 'fil', 'ltr')]:
            with self.subTest(tag=tag):
                page = self.open_with_locale(tag)
                page.goto(fixtures.APP)
                self.assertEqual(page.evaluate('window.__langAtReady'), code)
                self.assertEqual(page.evaluate('WaifuI18n.locale'), code)
                self.assertEqual(page.evaluate('document.getElementById(\"stage\").dir'), direction)
                self.assertEqual(page.get_attribute('#msgInput', 'placeholder'),
                                 page.evaluate("code => WaifuI18n.dictionary(code)['composer.placeholder']", code))
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)

    def test_device_language_loads_after_a_saved_choice(self):
        page = self.open_with_locale('bn-BD')
        page.add_init_script("localStorage.setItem('ws_locale', 'fr')")
        page.goto(fixtures.APP)
        self.assertEqual(page.evaluate('WaifuI18n.locale'), 'fr')
        self.assertIsNone(page.evaluate("WaifuI18n.dictionary('bn')"))
        page.locator('#settingsBtn').click()
        page.locator('#interfaceLanguage').select_option('auto')
        page.wait_for_function("WaifuI18n.locale === 'bn'")
        self.assertEqual(page.get_attribute('#msgInput', 'placeholder'),
                         page.evaluate("WaifuI18n.dictionary('bn')['composer.placeholder']"))
        self.assertEqual(page.evaluate("localStorage.getItem('ws_locale')"), 'auto')
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
