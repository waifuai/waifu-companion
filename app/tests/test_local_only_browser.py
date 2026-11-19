"""Browser checks for the local-only default: no network, local fallback reply."""
import unittest
import test_player_card as fixtures


class LocalOnlyBrowserTests(unittest.TestCase):
    assets = {}
    setUpClass = classmethod(fixtures.PlayerCardTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.PlayerCardTests.tearDownClass.__func__)
    route = fixtures.PlayerCardTests.route
    open_app = fixtures.PlayerCardTests.open_app
    setUp = fixtures.PlayerCardTests.setUp
    tearDown = fixtures.PlayerCardTests.tearDown

    def test_no_byo_key_chats_locally_without_network(self):
        frame = self.open_app(embed=False)
        # Clear the test-only BYO key fixture: this is the shipped default.
        frame.evaluate("""() => {
            window.useGroq = false; window.groqApiKey = '';
            window.useOpenRouter = false; window.useOpenAICompatible = false;
            window.enableVoice = false;
        }""")
        frame.locator('#messageInput').fill('hello there')
        frame.locator('#messageInput').press('Enter')
        frame.wait_for_function('!window.isProcessing && conversationContext.some(m => m.role === "assistant")')
        reply = frame.evaluate('conversationContext.filter(m => m.role === "assistant").at(-1).content')
        self.assertIn("glad you're here", reply)
        self.assertFalse(self.calls, 'No inference request without a BYO key')
        self.assertFalse(self.decision_requests, 'No decision request')
        self.assertFalse(self.tts_calls, 'No speech request')
        self.assertFalse(self.transcriptions, 'No transcription upload')
        self.assertFalse(self.errors, self.errors)

    def test_offline_fallback_event_has_metadata_only(self):
        frame = self.open_app(embed=False)
        frame.evaluate("""() => {
            window.useGroq = false; window.groqApiKey = '';
            window.useOpenRouter = false; window.useOpenAICompatible = false;
            window.enableVoice = false;
        }""")
        frame.locator('#messageInput').fill('I am so sad today')
        frame.locator('#messageInput').press('Enter')
        frame.wait_for_function('dataLayer.some(e => e[0] === "event" && e[1] === "offline_fallback_reply")')
        event = frame.evaluate('Array.from(dataLayer.find(e => e[0] === "event" && e[1] === "offline_fallback_reply"))[2]')
        self.assertEqual(event['engine'], 'local-template-v3')
        self.assertEqual(event['emotion'], 'sad')
        self.assertEqual(event['pattern'], 'offline.distress')
        self.assertEqual(event['persona'], 'assistant')
        self.assertIn('reply_length', event)
        self.assertNotIn('reply', event)
        self.assertNotIn('message', event)
        self.assertFalse(self.calls)
        self.assertFalse(self.errors, self.errors)


if __name__ == '__main__':
    unittest.main(verbosity=2)
