"""Shipped prompt selection and real Send gestures; all inference is mocked."""
import unittest
from urllib.parse import urlparse
import test_player_card as fixtures


class ChatPromptTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    setUp = fixtures.PlayerCardTests.setUp
    tearDown = fixtures.PlayerCardTests.tearDown

    def route(self, route):
        path = urlparse(route.request.url).path
        if getattr(self, 'missing_bundles', False) and path.endswith(('/chat_prompts.js', '/prompt_translations.js')):
            route.abort('failed')
        else:
            fixtures.PlayerCardTests.route(self, route)

    def open(self, embed=False, width=390):
        self.page.set_viewport_size({'width':width, 'height':760})
        self.page.goto(fixtures.APP + ('?embed=x' if embed else ''))
        # Prompt construction is still tested through a BYO provider; the
        # default built-in provider answers locally without a request.
        self.page.evaluate("Object.assign(Chat.settings, {provider:'custom', customBaseUrl:'https://provider.test/v1', models:{custom:'test-model'}}); Chat.settings.autoTitles=false; Chat.settings.ambient=false; Speech.settings.enabled=false;")

    def send(self, text):
        n = len(self.calls)
        self.page.locator('#msgInput').fill(text)
        self.page.locator('#msgInput').press('Enter')
        self.page.wait_for_function('!Chat.busy && Chat.messages.some(m => m.role === "assistant" && m.content)')
        self.assertEqual(len(self.calls), n+1)
        return self.calls[-1]['messages'][0]['content']

    def test_mobile_reply_choice_persona_and_emotion_protocol(self):
        self.open()
        self.page.evaluate("WaifuI18n.setLocale('ar')")
        self.page.evaluate("Chat.settings.language='Spanish'; Chat.settings.persona='tsundere'")
        self.reply_text = '[curious] Hola, ¿cómo estás?'
        sys = self.send('Hola')
        self.assertTrue(sys.startswith('Responde en Español'))
        self.assertIn('Eres una chica de anime tsundere', sys)
        self.assertIn(self.page.evaluate('Sprites.EMOTIONS.join(", ")'), sys)
        self.assertIn('Empieza cada respuesta', sys)
        self.assertEqual(self.page.evaluate('WaifuI18n.locale'), 'ar')
        self.assertEqual(self.page.evaluate('document.getElementById(\"stage\").dir'), 'rtl')
        shown = self.page.locator('.msg.assistant:not(.typing)').last.inner_text()
        self.assertIn('Hola', shown)
        self.assertNotIn('[curious]', shown)
        self.assertEqual(self.page.evaluate('Chat.messages.at(-1).emotion'), 'curious')
        self.assertFalse(self.errors, self.errors)

    def test_embedded_auto_and_bengali_custom_text(self):
        self.open(embed=True, width=480)
        self.page.evaluate("WaifuI18n.setLocale('pt')")
        sys = self.send('Bonjour, comment vas-tu ?')
        self.assertTrue(sys.startswith('Responda no idioma da mensagem mais recente'))
        self.assertEqual(self.page.evaluate('Chat.settings.language'), '')
        self.page.evaluate("Object.assign(Chat.settings, {language:'Bengali',persona:'custom',customPrompt:'CUSTOM PERSONA',extraPrompt:'EXTRA TEXT',aboutUser:'BACKGROUND TEXT'}); Chat.setSummary('SAVED MEMORY')")
        sys = self.send('আজ একটু গল্প করি।')
        self.assertTrue(sys.startswith('ব্যবহারকারী অন্য ভাষায়'))
        for value in ['CUSTOM PERSONA', 'EXTRA TEXT', 'BACKGROUND TEXT', 'SAVED MEMORY']:
            self.assertIn(value, sys)
        self.assertEqual(self.page.evaluate('WaifuI18n.locale'), 'pt')
        self.assertTrue(self.page.evaluate('Chat.ambientPrompt()').startswith('(ব্যবহারকারী'))
        self.assertFalse(self.errors, self.errors)

    def test_blocked_bundles_keep_send_usable(self):
        self.missing_bundles = True
        self.open()
        self.page.evaluate("Chat.settings.language='Spanish'")
        sys = self.send('Hola')
        self.assertTrue(sys.startswith('Reply in Español'))
        self.assertIn('You are Aurora', sys)
        self.assertIn('Start every reply with exactly one emotion tag', sys)
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
