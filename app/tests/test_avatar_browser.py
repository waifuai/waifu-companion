"""Avatar availability: real PIXI/Hiyori plus controlled failures; no live inference.
Run: python -m unittest discover -s app/tests -p test_avatar_browser.py
"""
from pathlib import Path
import tempfile
import json
import unittest
import test_player_card as fixtures


class AvatarTests(unittest.TestCase):
    assets = {}
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    setUp = fixtures.PlayerCardTests.setUp
    tearDown = fixtures.PlayerCardTests.tearDown
    route = fixtures.PlayerCardTests.route
    fulfill_decision = fixtures.PlayerCardTests.fulfill_decision

    def open_empty(self, width=1280, height=800):
        self.page.set_viewport_size({'width': width, 'height': height})
        self.context.add_init_script("if (localStorage.getItem('selectedModelUrl') === null) localStorage.setItem('selectedModelUrl', ''); localStorage.setItem('settingsAlwaysShowOnLoad', 'false');")
        self.page.goto(fixtures.APP)
        self.page.wait_for_function('window.waifuBootComplete === true')
        self.state('empty')
        self.assertEqual(self.page.evaluate('window.currentModel'), None)
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), '')
        self.assertFalse(self.errors, self.errors)

    def state(self, kind):
        self.page.wait_for_function('(kind) => AvatarRecovery.state.kind === kind', arg=kind, timeout=45000)

    def default(self):
        self.page.locator('#avatarDefault').click()
        self.state('ready')
        self.assertTrue(self.page.locator('#avatarRecovery').is_hidden())
        self.assertEqual(self.page.evaluate('currentModelUrl'), self.page.evaluate('defaultModelUrl'))
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), self.page.evaluate('defaultModelUrl'))

    def no_errors(self):
        self.assertFalse(self.errors, self.errors)
        self.assertFalse(self.boot_errors, self.boot_errors)
        self.assertFalse(self.calls)

    def test_empty_keyboard_default_success_and_hidden_recovery(self):
        self.open_empty()
        self.assertEqual(self.page.locator('#avatarStatus').get_attribute('role'), 'status')
        self.page.locator('#avatarChoice').focus()
        self.page.keyboard.press('Tab')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'avatarDefault')
        self.page.keyboard.press('Enter')
        self.state('ready')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'messageInput')
        self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'companion-avatar-desktop.png'))
        saved = self.page.evaluate("AppStorage.getItem('selectedModelUrl')")
        for hide in ["currentModel.position.set(-100000,-100000)", "app.view.style.display='none'", "currentModel.visible=false", "app.stage.renderable=false", "app.view.style.width=\"0px\"", "app.view.style.transform=\"translateX(-10000px)\""]:
            self.page.evaluate(hide)
            self.state('hidden')
            self.page.locator('#avatarRestore').focus()
            self.page.keyboard.press('Enter')
            self.state('ready')
            self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), saved)
        self.page.evaluate('clearAllModels()')
        self.state('hidden')
        self.page.locator('#avatarRestore').click()
        self.state('ready')
        self.no_errors()

    def install_controls(self):
        self.page.evaluate('''() => {
            window.avatarJobs = [];
            const factory = PIXI.live2d.Live2DFactory;
            const real = factory.setupLive2DModel.bind(factory);
            factory.setupLive2DModel = (model, url, options) => {
                if (url.startsWith('https://fixture.test/')) {
                    return new Promise((resolve, reject) => avatarJobs.push({model, url, options, resolve, reject,
                        success: () => real(model, defaultModelUrl, options).then(resolve, reject)}));
                }
                return real(model, url, options);
            };
            availableModels.push({name:'Fixture A',url:'https://fixture.test/a'}, {name:'Fixture B',url:'https://fixture.test/b'});
        }''')

    def test_failure_retry_rapid_switch_and_stale_completion(self):
        self.open_empty()
        self.default()
        self.install_controls()
        self.page.evaluate("window.oldAvatar=currentModel; void loadModel('https://fixture.test/a').catch(()=>{})")
        self.state('loading')
        self.page.evaluate("avatarJobs[0].reject(new Error('Fixture failure'))")
        self.state('failed')
        self.assertTrue(self.page.evaluate('currentModel === oldAvatar && !oldAvatar._destroyed'))
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), self.page.evaluate('defaultModelUrl'))
        self.page.locator('#avatarRetry').click()
        self.state('loading')
        self.assertEqual(self.page.evaluate('avatarJobs[1].url'), 'https://fixture.test/a')
        self.page.evaluate('avatarJobs[1].success()')
        self.state('ready')
        self.assertEqual(self.page.evaluate('currentModelUrl'), 'https://fixture.test/a')
        self.page.evaluate("void loadModel('https://fixture.test/a').catch(()=>{}); void loadModel('https://fixture.test/b').catch(()=>{})")
        self.assertTrue(self.page.evaluate('avatarJobs[2].model._destroyed'))
        self.page.evaluate('avatarJobs[3].success()')
        self.state('ready')
        self.page.evaluate('avatarJobs[2].resolve()')
        self.assertEqual(self.page.evaluate('currentModelUrl'), 'https://fixture.test/b')
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), 'https://fixture.test/b')
        self.assertEqual(self.page.evaluate('app.stage.children.filter(m=>m.__modelUrl).length'), 1)
        self.no_errors()

    def test_stall_mobile_and_explicit_default_recovery(self):
        self.open_empty(360, 740)
        self.install_controls()
        self.page.clock.install()
        self.page.evaluate("void loadModel('https://fixture.test/a').catch(()=>{})")
        self.state('loading')
        self.page.clock.fast_forward(30001)
        self.state('stalled')
        self.assertEqual(self.page.evaluate('avatarJobs.length'), 1)
        self.assertTrue(self.page.evaluate('avatarJobs[0].model._destroyed'))
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), '')
        for selector in ['#avatarRecovery', '#avatarChoice', '#avatarRetry', '#avatarDefault']:
            box = self.page.locator(selector).bounding_box()
            self.assertGreaterEqual(box['x'], 0)
            self.assertLessEqual(box['x']+box['width'], 360)
            self.assertGreaterEqual(box['y'], 0)
            self.assertLessEqual(box['y']+box['height'], 740)
        self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'companion-avatar-mobile-stall.png'))
        self.page.clock.resume()
        self.default()
        self.page.evaluate('avatarJobs[0].resolve()')
        self.assertEqual(self.page.evaluate('currentModelUrl'), self.page.evaluate('defaultModelUrl'))
        self.page.set_viewport_size({'width': 740, 'height': 360})
        self.page.evaluate("app.view.hidden=true")
        self.state('hidden')
        self.page.locator('#avatarRestore').click()
        self.state('ready')
        self.no_errors()

    def test_real_settings_failure_and_localized_recovery(self):
        self.context.add_init_script("localStorage.setItem('selectedModelUrl','https://companion.test/broken.model3.json'); localStorage.setItem('interfaceLanguage','ja');")
        self.page.goto(fixtures.APP)
        self.page.wait_for_function('window.waifuBootComplete === true')
        self.state('failed')
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), 'https://companion.test/broken.model3.json')
        self.assertIn('\u30ad\u30e3\u30e9\u30af\u30bf\u30fc', self.page.locator('#avatarStatus').inner_text())
        self.page.locator('#avatarChoice').select_option(self.page.evaluate('defaultModelUrl'))
        self.state('ready')
        self.no_errors()

    def test_real_texture_failure_releases_partial_resources_and_preserves_selection(self):
        self.open_empty()
        self.default()
        default_url = self.page.evaluate('defaultModelUrl')
        body = json.loads(self.assets[default_url][2])
        base = default_url.rsplit('/', 1)[0] + '/'
        body['FileReferences']['Moc'] = base + body['FileReferences']['Moc']
        body['FileReferences']['Textures'] = [base + body['FileReferences']['Textures'][0], 'https://companion.test/missing-texture.png']
        # Keep this fixture focused on required moc/textures, with no optional motions.
        body['FileReferences'] = {k: body['FileReferences'][k] for k in ['Moc', 'Textures']}
        self.context.route('https://companion.test/texture-failure.model3.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(body)))
        self.page.evaluate("""() => {
            window.failedOwner = null;
            const factory = PIXI.live2d.Live2DFactory, real = factory.setupLive2DModel.bind(factory);
            factory.setupLive2DModel = (m,u,o) => { window.failedOwner=o.avatarAttempt; return real(m,u,o); };
            window.oldAvatar=currentModel;
            void loadModel('https://companion.test/texture-failure.model3.json').catch(()=>{});
        }""")
        self.state('failed')
        self.assertTrue(self.page.evaluate('failedOwner.model._destroyed && failedOwner.textures.length === 2 && failedOwner.textures.every(t => t.baseTexture === null)'))
        self.assertTrue(self.page.evaluate('currentModel === oldAvatar && !oldAvatar._destroyed'))
        self.assertEqual(self.page.evaluate("AppStorage.getItem('selectedModelUrl')"), default_url)
        self.page.reload()
        self.state('ready')
        self.assertEqual(self.page.evaluate('currentModelUrl'), default_url)
        self.no_errors()

    def test_embedded_empty_and_hidden_chat_recovery_keep_storage_isolated(self):
        self.page.set_viewport_size({'width': 480, 'height': 480})
        self.context.add_init_script("localStorage.setItem('waifu_x_selectedModelUrl',''); localStorage.setItem('selectedModelUrl','full-app-choice');")
        self.page.goto(fixtures.APP + '?embed=x')
        self.page.wait_for_function('window.waifuBootComplete === true')
        self.state('empty')
        self.default()
        self.assertEqual(self.page.evaluate("localStorage.getItem('selectedModelUrl')"), 'full-app-choice')
        self.page.locator('#embedChatBtn').click()
        self.page.evaluate('currentModel.visible=false')
        self.state('hidden')
        self.page.locator('#avatarRestore').focus()
        self.page.keyboard.press('Enter')
        self.state('ready')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'embedChatBtn')
        self.no_errors()


if __name__ == '__main__':
    unittest.main()
