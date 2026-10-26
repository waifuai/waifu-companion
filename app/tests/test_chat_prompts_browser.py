"""Verify shipped prompt selection and Send requests; inference remains mocked."""
import unittest
from urllib.parse import urlparse
import test_player_card as fixtures


class ChatPromptTests(unittest.TestCase):
    assets = {}
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    fulfill_decision = fixtures.PlayerCardTests.fulfill_decision
    open_app = fixtures.PlayerCardTests.open_app
    setUp = fixtures.PlayerCardTests.setUp
    tearDown = fixtures.PlayerCardTests.tearDown

    def route(self, route):
        if getattr(self, 'missing_bundle', False) and urlparse(route.request.url).path.endswith('/chat_prompts.js'):
            route.abort('failed')
        else:
            fixtures.PlayerCardTests.route(self, route)

    def send(self, frame, text):
        frame.evaluate('window.enableVoice=false; window.isAmbientQueueEnabled=false;')
        field = frame.locator('#messageInput')
        field.fill(text)
        field.press('Enter')
        frame.wait_for_function('!window.isProcessing && conversationContext.some(m => m.role === "assistant")')
        return [c for c in self.calls if c['_purpose'] == 'chat'][-1]['messages'][0]['content']

    def test_reply_locale_ui_locale_and_saved_persona_are_independent(self):
        frame = self.open_app(width=390, height=760, embed=False)
        frame.evaluate("WaifuI18n.setLocale('ar')")
        frame.evaluate("window.selectedLanguageCode='es-ES'")
        sys = self.send(frame, 'Hola, ¿cómo estás?')
        self.assertTrue(sys.startswith('Responde en Español (es-ES)'))
        self.assertIn('Eres Haru', sys)
        self.assertEqual(frame.evaluate('WaifuI18n.locale'), 'ar')
        self.assertEqual(frame.evaluate('document.documentElement.dir'), 'rtl')
        self.assertEqual(frame.evaluate('window.selectedLanguageCode'), 'es-ES')
        frame.evaluate("window.corePersonaPrompt='CUSTOM PERSONA — keep exactly'; window.userPersonaPrompt='MY EXTRA TEXT'; window.selectedLanguageCode='bn'")
        sys = self.send(frame, 'আজ একটু গল্প করি।')
        self.assertTrue(sys.startswith('ব্যবহারকারী অন্য ভাষায়'))
        self.assertIn('CUSTOM PERSONA — keep exactly', sys)
        self.assertIn('MY EXTRA TEXT', sys)
        self.assertNotIn('তুমি Haru', sys)
        self.assertFalse(self.errors, self.errors)

    def test_embedded_auto_follows_user_and_blocked_bundle_keeps_chat_usable(self):
        frame = self.open_app()
        frame.evaluate("WaifuI18n.setLocale('pt')")
        self.assertEqual(frame.evaluate('window.selectedLanguageCode'), 'en-US')
        sys = self.send(frame, 'Bonjour, comment vas-tu ?')
        self.assertTrue(sys.startswith('Responda no idioma da mensagem mais recente'))
        self.assertEqual(frame.evaluate('WaifuI18n.locale'), 'pt')
        self.calls.clear()
        self.tts_calls.clear()
        self.missing_bundle = True
        frame = self.open_app()
        frame.evaluate("window.selectedLanguageCode='es-ES'")
        sys = self.send(frame, 'Hola')
        self.assertTrue(sys.startswith('Reply in Español (es-ES)'))
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
