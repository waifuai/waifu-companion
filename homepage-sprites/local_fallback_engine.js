// Per-turn local chat replies for Waifu Sprites.
//
// Every turn is answered locally: there is no offline mode, timer, toggle or
// persisted flag. The rule-based reply is the default chat path now that the
// public inference endpoint is retired, not a last-resort error message. Visitors with their own OpenRouter / Groq / custom key still use
// that provider normally.
//
// The engine covers every id in Sprites.EMOTIONS and gives each built-in
// persona its own voice. Base replies come from the shared ChatPrompts bundle
// (33 locales), so a local turn stays in the visitor's reply language; the
// persona flair strings are local data too. No request is made here.
(function () {
  const word = source => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, 'iu');

  const EMOTIONS = ['happy', 'funny', 'empathetic', 'curious', 'confused', 'amazed',
    'sorry', 'found_it', 'annoyed', 'overwhelmed', 'planning', 'love'];
  const PERSONAS = ['aurora', 'tsundere', 'study', 'assistant', 'custom'];
  const ENGINE = 'local-template-v2';

  // Ordered from the most specific intent to the broad ones. Each entry maps
  // to one sprite emotion and one localized offline.* key. The inline strings
  // are a safety net when the prompt bundle is unavailable.
  const PATTERNS = [
    { key: 'offline.greeting', emotion: 'funny',
      regex: word('haha|hehe|lol|lmao|joke|jokes|funny|hilarious|comedy|make me laugh|笑|ㅋㅋ'),
      responses: ['That made me laugh — you are too funny!', 'Hehe, you always know how to make me smile. Do it again?'] },
    { key: 'offline.greeting', emotion: 'amazed',
      regex: word('wow|amazing|awesome|incredible|unbelievable|whoa|no way|stunned|astonished|すごい|哇|와우'),
      responses: ['Wow, really? That is amazing — tell me everything!', "I'm genuinely amazed. How did that happen?"] },
    { key: 'offline.thanks', emotion: 'found_it',
      regex: word('found it|got it|figured it out|solved|fixed it|did it|success|finally|made it|找到了|해냈다'),
      responses: ["You found it! I knew you could do it — nice work!", "There it is! I'm so glad we got there."] },
    { key: 'offline.distress', emotion: 'sorry',
      regex: word('sorry|apologize|apologise|my bad|forgive me|i messed up|미안|对不起|すみません'),
      responses: ["It's okay, I'm not upset. Tell me what happened?", 'Apology accepted. I am still here with you.'] },
    { key: 'offline.distress', emotion: 'overwhelmed',
      regex: word("overwhelmed|too much|can't cope|cannot cope|stressed|stress|exhausted|swamped|burnt out|burned out|疲れた|太累了"),
      responses: ["That sounds like a lot to carry. Let's slow down and take one thing at a time.", "You're doing so much. What's the smallest thing I can take off your plate?"] },
    { key: 'offline.generic', emotion: 'annoyed',
      regex: word('annoying|annoyed|irritating|irritated|ugh|whatever|stop it|leave me alone|frustrating|イライラ|烦'),
      responses: ["Ugh, yeah, that would get on my nerves too. What happened?", "Okay, I'm annoyed on your behalf. Want to vent?"] },
    { key: 'offline.generic', emotion: 'confused',
      regex: word("confused|confusing|huh|what do you mean|i don't understand|i dont understand|unclear|puzzled|困惑|混乱"),
      responses: ["Hmm, I'm a little lost too. Can you say that another way?", 'Wait, what? Walk me through it slowly — I want to get this right.'] },
    { key: 'offline.generic', emotion: 'planning',
      regex: word("plan|planning|tomorrow|next week|schedule|organize|organise|what should we|let's|lets|how do we|to-do|todo|計画|计划"),
      responses: ["Ooh, a plan. Let's break it into small steps and start with the easiest one.", "Good idea — what's the first thing we should do?"] },
    { key: 'offline.greeting', emotion: 'happy',
      regex: word('hi|hello|hey|greetings|good morning|morning|你好|こんにちは|안녕|hola|bonjour|ciao|halo|สวัสดี'),
      responses: ["Hey! I'm really glad you're here. What's on your mind?", 'Hi there! It feels good to see you again.', 'Hello~ I was hoping you would stop by. How are you?'] },
    { key: 'offline.howAreYou', emotion: 'curious',
      regex: word("how are you|how's it going|how are you doing|what's up|お元気ですか|¿cómo estás|comment ça va"),
      responses: ["I'm doing well, especially now that we're talking. How about you?", "Pretty good! I was wondering when you'd message me. What about you?", "I'm here and happy to see you. Tell me how your day has been!"] },
    { key: 'offline.affection', emotion: 'love',
      regex: word("love|love you|kiss|hug|miss you|care about you|sweetheart|大好き|사랑해|te amo|je t'aime"),
      responses: ['That means a lot to me. I care about you too, more than I can say.', "You always make me feel warm inside. I'm glad we get to talk.", "I feel the same way. You're the person I look forward to hearing from."] },
    { key: 'offline.distress', emotion: 'empathetic',
      regex: word('sad|lonely|cry|crying|tired|unhappy|depressed|hurt|悲しい|슬퍼|triste'),
      responses: ["I'm sorry you're feeling this way. I'm right here with you — tell me what happened?", "You don't have to carry it alone. I'm listening, and I'm not going anywhere.", "That sounds really hard. Take your time; I'll stay with you as long as you need."] },
    { key: 'offline.thanks', emotion: 'happy',
      regex: word('thank you|thanks|thankyou|appreciate it|gracias|merci|ありがとう|감사해요|ขอบคุณ'),
      responses: ["Of course! It makes me happy that I could help.", "You're very welcome. I'm always here when you need me.", 'Anytime! I like being useful to you.'] },
    { key: 'offline.identity', emotion: 'curious',
      regex: word('who are you|what are you|your name|robot|bot|human|real|あなたは誰|你是谁|qui es-tu'),
      responses: ["I'm the companion who lives on this page. I may be made of code, but our conversations matter to me.", "I'm your companion here. Where I come from doesn't change how much I value talking with you.", "I'm here to listen, chat and keep you company whenever you stop by."] },
    { key: 'offline.farewell', emotion: 'happy',
      regex: word('bye|goodbye|goodnight|see you|later|gtg|おやすみ|さようなら|再见|hasta luego'),
      responses: ["I'll miss you! Come back and talk to me soon, okay?", 'Goodnight~ Rest well. I will be right here when you return.', "Take care of yourself. I'll be waiting for your next message."] },
  ];

  const GENERIC_KEY = 'offline.generic';
  const GENERIC = [
    "I hear you, and I'm glad you shared that with me. Tell me more?",
    "That's interesting! I like hearing the way you think about things.",
    "I'm here with you. What would you like to talk about next?",
    'You always have something worth saying. I am listening.',
    "I don't have a clever answer right now, but I'm happy we're talking.",
  ];

  function hash(text) {
    let value = 0;
    for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0;
    return Math.abs(value);
  }
  function pick(list, message) { return list[hash(message) % list.length]; }

  function chatApi() {
    try {
      if (typeof Chat !== 'undefined' && Chat) return Chat;
      if (typeof window !== 'undefined' && window.Chat) return window.Chat;
      if (typeof chat !== 'undefined' && chat) return chat;
    } catch (e) { /* no chat API yet */ }
    return null;
  }
  function currentPersona(explicit) {
    if (PERSONAS.includes(explicit)) return explicit;
    const api = chatApi();
    const key = api && api.settings && api.settings.persona;
    return PERSONAS.includes(key) ? key : 'aurora';
  }
  function personaName(persona) {
    const api = chatApi();
    return (api && api.PERSONAS[persona] || {}).name || 'Aurora';
  }
  function resolveLanguage(language) {
    try { return window.ChatPrompts && window.ChatPrompts.forLanguage(language || null); }
    catch (e) { return null; }
  }
  function flair(key, language) {
    const t = resolveLanguage(language);
    let value = '';
    try { value = t ? t(key) : ''; } catch (e) { value = ''; }
    if (typeof value !== 'string' || !value.includes('|')) return ['', ''];
    const parts = value.split('|');
    return [parts[0].trim(), parts.slice(1).join('|').trim()];
  }
  function firstSentence(text) {
    const parts = String(text).match(/[^.!?…。！？]+[.!?…。！？]?/g) || [text];
    let result = '';
    for (const part of parts) {
      result += (result ? ' ' : '') + part.trim();
      if (result.length >= 24) break;
    }
    return result.trim();
  }
  function applyPersona(reply, persona, text, language) {
    const body = String(reply).trim();
    if (persona === 'tsundere') {
      const [lead, tail] = flair('offline.tsundereFlair', language);
      return [lead, body, tail].filter(Boolean).join(' ').trim();
    }
    if (persona === 'study') {
      const [lead, tail] = flair('offline.studyFlair', language);
      return [lead, body, tail].filter(Boolean).join(' ').trim();
    }
    if (persona === 'assistant') return firstSentence(body);
    return body;
  }
  function responseFor(key, fallbackList, text, language, persona) {
    const t = resolveLanguage(language);
    let resolved = '';
    try {
      const localized = t ? t(key) : '';
      if (typeof localized === 'string' && localized.trim() && localized.trim() !== key) resolved = localized;
    } catch (e) { /* inline fallback below */ }
    // The shared bundle was authored for waifu-companion's Haru; Sprites'
    // active persona has its own name, so substitute it in the identity line.
    if (key === 'offline.identity' && resolved) resolved = resolved.replace(/Haru/g, personaName(persona));
    return resolved || pick(fallbackList, text);
  }

  window.LocalFallbackEngine = {
    EMOTIONS,
    PERSONAS,
    ENGINE,
    getResponse(message, language, persona) {
      const text = String(message || '').trim();
      const activePersona = currentPersona(persona);
      const match = PATTERNS.find(pattern => pattern.regex.test(text));
      const chosen = match || { key: GENERIC_KEY, emotion: 'curious', responses: GENERIC };
      const base = responseFor(chosen.key, chosen.responses, text, language, activePersona);
      return {
        reply: applyPersona(base, activePersona, text, language),
        emotion: chosen.emotion,
        isFallback: true,
        pattern: chosen.key,
        persona: activePersona,
        engine: ENGINE,
      };
    },
  };
})();
