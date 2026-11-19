// Per-turn local chat replies for the main app.
//
// Chat is local-only by default now that the public inference service is
// retired: every turn is answered here, with no network attempt. Visitors with
// their own Groq / OpenRouter / OpenAI-compatible key still use that provider
// normally (BYO stays opt-in).
//
// Patterns are word-anchored with Unicode letter lookarounds: plain \b is
// ASCII-only, so /hi/ used to fire inside "this" and "thinking". Each pattern
// maps to one of the six animation emotions in ai_interface.js and to one of
// the authored offline.* keys in the shared ChatPrompts bundle. The inline
// strings are a safety net when that bundle has not loaded. Persona *tone* is
// read from the free-form persona fields by inferTone() below; no persona text
// is ever sent to analytics.
(function () {
  const word = (source) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, 'iu');

  const EMOTIONS = ['happy', 'sad', 'surprised', 'thoughtful', 'excited', 'neutral'];
  const TONES = ['assistant', 'tsundere', 'study', 'cheerful'];
  const ENGINE = 'local-template-v3';

  // Ordered from the most specific intent to the broad ones. `pattern` in the
  // returned metadata is the offline key that supplied the reply.
  const PATTERNS = [
    {
      emotion: 'excited',
      key: 'offline.greeting',
      regex: word('wow|amazing|awesome|incredible|fantastic|congrats|congratulations|excited|great news|finally|yay|すごい|太棒了|와우|정말 좋아'),
      responses: [
        "Wow, that's wonderful — tell me everything!",
        'I am so excited for you! This is great news.',
        'Yay! That really made my day. What happened next?'
      ]
    },
    {
      emotion: 'surprised',
      key: 'offline.greeting',
      regex: word('whoa|no way|unbelievable|astonished|stunned|surprised|shocked|seriously\\?|really\\?|omg| wow\\?!|真的吗|不會吧|わお|와우'),
      responses: [
        'Wait, really? I did not see that coming — tell me more!',
        'Whoa, you surprised me. What happened?',
        "I'm genuinely surprised. Go on, I'm listening."
      ]
    },
    {
      emotion: 'sad',
      key: 'offline.distress',
      regex: word('sad|lonely|cry|crying|tired|unhappy|depressed|hurt|miss you|sorry|悲しい|슬퍼|triste'),
      responses: [
        "I'm sorry you're feeling this way. I'm right here with you — tell me what happened?",
        "You don't have to carry it alone. I'm listening, and I'm not going anywhere.",
        "That sounds really hard. Take your time; I'll stay with you as long as you need."
      ]
    },
    {
      emotion: 'neutral',
      key: 'offline.generic',
      regex: word('ok|okay|sure|fine|alright|got it|understood|yes|no|嗯|好的|了解|알겠어'),
      responses: [
        'Okay, I understand. What would you like to do next?',
        'Got it. I am here whenever you want to talk.',
        'Sure thing. Tell me more when you are ready.'
      ]
    },
    {
      emotion: 'happy',
      key: 'offline.greeting',
      regex: word('hi|hello|hey|greetings|good morning|morning|你好|こんにちは|안녕|hola|bonjour|ciao|halo|สวัสดี'),
      responses: [
        "Hey! I'm really glad you're here. What's on your mind?",
        "Hi there! It feels good to hear from you again.",
        "Hello~ I was hoping you'd come talk to me. How are you?"
      ]
    },
    {
      emotion: 'happy',
      key: 'offline.howAreYou',
      regex: word("how are you|how's it going|how are you doing|what's up|お元気ですか|¿cómo estás|comment ça va"),
      responses: [
        "I'm doing well, especially now that we're talking. How about you?",
        'Pretty good! I kept thinking you might message me soon. What about you?',
        "I'm here and happy to see you. Tell me how your day has been!"
      ]
    },
    {
      emotion: 'happy',
      key: 'offline.affection',
      regex: word("love|love you|kiss|hug|care about you|sweetheart|大好き|사랑해|te amo|je t'aime"),
      responses: [
        'That means a lot to me. I care about you too, more than I can say.',
        "You always make me feel warm inside. I'm glad you're mine to talk to.",
        "I feel the same way. You're the person I look forward to hearing from."
      ]
    },
    {
      emotion: 'happy',
      key: 'offline.thanks',
      regex: word('thank you|thanks|thankyou|appreciate it|gracias|merci|ありがとう|감사해요|ขอบคุณ'),
      responses: [
        "Of course! It makes me happy that I could help.",
        "You're very welcome. I'm always here when you need me.",
        'Anytime! I like being useful to you.'
      ]
    },
    {
      emotion: 'thoughtful',
      key: 'offline.identity',
      regex: word('who are you|what are you|your name|robot|bot|human|real|あなたは誰|你是谁|qui es-tu'),
      responses: [
        "I'm Haru, the companion who lives on this page. I may be made of code, but our conversations matter to me.",
        "I'm your digital companion. My origins don't change how much I value talking with you.",
        "Call me Haru. I'm here to listen, chat and keep you company whenever you stop by."
      ]
    },
    {
      emotion: 'thoughtful',
      key: 'offline.generic',
      regex: word("why|how|what if|think|thinking|wonder|maybe|plan|planning|tomorrow|decide|let's|lets|hmm|\\?|？"),
      responses: [
        "Mm, let me think about that. What do you think would work best?",
        "That's worth thinking through. Where would you like to start?",
        'I see what you mean. Tell me a little more so I can follow.'
      ]
    },
    {
      emotion: 'happy',
      key: 'offline.farewell',
      regex: word('bye|goodbye|goodnight|see you|later|gtg|おやすみ|さようなら|再见|hasta luego'),
      responses: [
        "I'll miss you! Come back and talk to me soon, okay?",
        "Goodnight~ Rest well. I'll be right here when you return.",
        "Take care of yourself. I'll be waiting for your next message."
      ]
    }
  ];

  const GENERIC_KEY = 'offline.generic';
  const GENERIC = [
    "I hear you, and I'm glad you shared that with me. Tell me more?",
    "That's interesting! I like hearing the way you think about things.",
    "I'm here with you. What would you like to talk about next?",
    'You always have something worth saying. I am listening.',
    "I don't have a clever answer right now, but I'm happy we're talking."
  ];

  // Tone detection reads only saved persona text, never the incoming message.
  // The built-in core persona is skipped so the default character is not
  // misclassified as 'cheerful' by words like "playful".
  const TONE_PATTERNS = [
    ['tsundere', /(?:tsundere|tsun|aloof|reluctant|secretly|acts? cold|pride|brat|傲嬌|傲娇|ツンデレ)/i],
    ['study', /(?:teacher|tutor|study|studies|homework|lesson|student|study buddy|study session|教|老师|先生|勉強|家庭教師)/i],
    ['cheerful', /(?:cheerful|bright|sunny|energetic|upbeat|optimistic|lively|活泼|開朗|明るい)/i]
  ];
  const TONE_FLAIR = {
    tsundere: 'offline.tsundereFlair',
    study: 'offline.studyFlair',
    cheerful: 'offline.cheerfulFlair'
  };

  function pick(list, message) {
    let hash = 0;
    for (let i = 0; i < message.length; i++) hash = (hash * 31 + message.charCodeAt(i)) | 0;
    return list[Math.abs(hash) % list.length];
  }

  function resolveLanguage(language) {
    try { return window.ChatPrompts && window.ChatPrompts.forLanguage(language || null); }
    catch (e) { return null; }
  }

  function responseFor(key, fallbackList, text, language) {
    const t = resolveLanguage(language);
    let localized = '';
    try {
      const value = t ? t(key) : '';
      if (typeof value === 'string' && value.trim() && value.trim() !== key) localized = value;
    } catch (e) { /* use the inline fallback */ }
    return localized || pick(fallbackList, text);
  }

  function flairFor(tone, language) {
    const key = TONE_FLAIR[tone];
    if (!key) return ['', ''];
    const t = resolveLanguage(language);
    let value = '';
    try { value = t ? t(key) : ''; } catch (e) { /* no flair */ }
    if (typeof value !== 'string' || !value.includes('|')) return ['', ''];
    const parts = value.split('|');
    return [parts[0].trim(), parts.slice(1).join('|').trim()];
  }

  function applyTone(reply, tone, language) {
    if (tone === 'assistant') return reply;
    const [lead, tail] = flairFor(tone, language);
    return [lead, reply, tail].filter(Boolean).join(' ').trim();
  }

  function savedPersonaText() {
    const parts = [];
    const core = String(window.corePersonaPrompt || '');
    const custom = String(window.userPersonaPrompt || '');
    const bundle = window.ChatPrompts;
    const isDefault = core && bundle && typeof bundle.isDefaultPersona === 'function' && bundle.isDefaultPersona(core);
    if (core && !isDefault) parts.push(core);
    if (custom) parts.push(custom);
    return parts.join(' ');
  }

  function inferTone(explicit) {
    if (TONES.includes(explicit)) return explicit;
    const text = savedPersonaText();
    for (const [tone, pattern] of TONE_PATTERNS) {
      if (pattern.test(text)) return tone;
    }
    return 'assistant';
  }

  window.LocalFallbackEngine = {
    EMOTIONS,
    TONES,
    ENGINE,
    getResponse(message, language, persona) {
      const text = String(message || '').trim();
      const tone = inferTone(persona);
      const match = PATTERNS.find(pattern => pattern.regex.test(text));
      const chosen = match || { key: GENERIC_KEY, emotion: 'neutral', responses: GENERIC };
      const base = responseFor(chosen.key, chosen.responses, text, language);
      return {
        reply: applyTone(base, tone, language),
        emotion: chosen.emotion,
        isFallback: true,
        pattern: chosen.key,
        persona: tone,
        engine: ENGINE
      };
    }
  };
})();
