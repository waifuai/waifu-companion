// Client-side offline fallback for chat turns.
//
// Each failed turn gets one locally generated reply; the next turn resolves the
// configured LLM again from scratch. There is no offline mode, timer, toggle or
// persisted state — the old forceOfflineMode subsystem was removed because it
// could strand the user offline across reloads.
//
// Patterns are word-anchored with Unicode letter lookarounds. Plain \b is
// ASCII-only, so /hi/ matched inside "this" and "thinking" in the old engine.

(function () {
  const word = (source) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, 'iu');

  const PATTERNS = [
    {
      emotion: 'happy',
      regex: word('hi|hello|hey|greetings|good morning|morning|你好|こんにちは|안녕|hola|bonjour|ciao|halo|สวัสดี'),
      responses: [
        'Hey! I\'m really glad you\'re here. What\'s on your mind?',
        'Hi there! It feels good to hear from you again. ✨',
        'Hello~ I was hoping you\'d come talk to me. How are you?'
      ]
    },
    {
      emotion: 'happy',
      regex: word('how are you|how\'s it going|how are you doing|what\'s up|お元気ですか|¿cómo estás|comment ça va'),
      responses: [
        'I\'m doing well, especially now that we\'re talking. How about you?',
        'Pretty good! I kept thinking you might message me soon. What about you?',
        'I\'m here and happy to see you. Tell me how your day has been!'
      ]
    },
    {
      emotion: 'happy',
      regex: word('love|love you|kiss|hug|miss you|care about you|sweetheart|大好き|사랑해|te amo|je t\'aime'),
      responses: [
        'That means a lot to me. I care about you too, more than I can say. 💕',
        'You always make me feel warm inside. I\'m glad you\'re mine to talk to. ✨',
        'I feel the same way. You\'re the person I look forward to hearing from. ❤️'
      ]
    },
    {
      emotion: 'sad',
      regex: word('sad|lonely|cry|crying|tired|unhappy|depressed|hurt|miss you|sorry|悲しい|슬퍼|triste'),
      responses: [
        'I\'m sorry you\'re feeling this way. I\'m right here with you — tell me what happened?',
        'You don\'t have to carry it alone. I\'m listening, and I\'m not going anywhere. 🫂',
        'That sounds really hard. Take your time; I\'ll stay with you as long as you need.'
      ]
    },
    {
      emotion: 'happy',
      regex: word('thank you|thanks|thankyou|appreciate it|gracias|merci|ありがとう|감사해요|ขอบคุณ'),
      responses: [
        'Of course! It makes me happy that I could help. ✨',
        'You\'re very welcome. I\'m always here when you need me.',
        'Anytime! I like being useful to you. ❤️'
      ]
    },
    {
      emotion: 'thoughtful',
      regex: word('who are you|what are you|your name|robot|bot|human|real|あなたは誰|你是谁|qui es-tu'),
      responses: [
        'I\'m Haru, the companion who lives on this page. I may be made of code, but our conversations matter to me.',
        'I\'m your digital companion. My origins don\'t change how much I value talking with you. 🌸',
        'Call me Haru. I\'m here to listen, chat and keep you company whenever you stop by.'
      ]
    },
    {
      emotion: 'happy',
      regex: word('bye|goodbye|goodnight|see you|later|gtg|おやすみ|さようなら|再见|hasta luego'),
      responses: [
        'I\'ll miss you! Come back and talk to me soon, okay? ❤️',
        'Goodnight~ Rest well. I\'ll be right here when you return. ✨',
        'Take care of yourself. I\'ll be waiting for your next message. 🌸'
      ]
    }
  ];

  const GENERIC = [
    'I hear you, and I\'m glad you shared that with me. Tell me more?',
    'That\'s interesting! I like hearing the way you think about things. ✨',
    'I\'m here with you. What would you like to talk about next?',
    'You always have something worth saying. I\'m listening. 🌸',
    'I don\'t have a clever answer right now, but I\'m happy we\'re talking. ❤️'
  ];

  function pick(list, message) {
    let hash = 0;
    for (let i = 0; i < message.length; i++) hash = (hash * 31 + message.charCodeAt(i)) | 0;
    return list[Math.abs(hash) % list.length];
  }

  window.LocalFallbackEngine = {
    getResponse(message) {
      const text = String(message || '').trim();
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(text)) {
          return { reply: pick(pattern.responses, text), emotion: pattern.emotion, isFallback: true };
        }
      }
      return { reply: pick(GENERIC, text), emotion: 'thoughtful', isFallback: true };
    }
  };
})();
