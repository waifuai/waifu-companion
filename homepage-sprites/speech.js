/**
 * speech.js: reads her replies aloud.
 *
 * The WaifuAI Cloud speech endpoint turns each chunk into audio; the client
 * only supplies the reply's language — never a voice or a provider. Browser
 * SpeechSynthesis is used only when a browser voice is explicitly picked.
 * Failed or unavailable speech stays silent. Replies are cleaned for speech
 * (no *actions*, no emoji), split into sentences and grouped into chunks of
 * up to CHUNK_LIMIT characters. While one chunk plays, the next is fetched.
 *
 * Language routing: a reply in Japanese, Korean, German, Indonesian and so on
 * is spoken in that language.
 */
const Speech = (() => {
  const TTS_URL = 'https://waifu-companion-proxy.thewaifuai.workers.dev/tts';
  const CLOUD_TIMEOUT_MS = 10000;
  const CHUNK_LIMIT = 300;
  const CHUNK_GAP_MS = 150;

  // [id, name, language, gender, group]
  const VOICES = [
    ['browser-female', 'Browser voice (female)', 'en-US', 'female', 'Browser'],
    ['browser-male', 'Browser voice (male)', 'en-US', 'male', 'Browser'],
  ].map(([id, name, language, gender, group]) => ({ id, name, language, gender, group, provider: 'browser' }));

  const byId = id => VOICES.find(v => v.id === id);

  // ── Text preparation (waifu-companion sentence_processor.js) ──
  // Drops whole *multi-word action* spans, keeps single-word emphasis, strips emoji.
  function stripForTTS(text) {
    const emoji = new RegExp('([\\u2700-\\u27BF]|[\\uE000-\\uF8FF]|\\uD83C[\\uDC00-\\uDFFF]|\\uD83D[\\uDC00-\\uDFFF]|[\\u2000-\\u2FFF]|\\uD83E[\\uDD00-\\uDFFF])', 'g');
    return (window.TTSLanguageRouter ? window.TTSLanguageRouter.clean(text) : String(text || ''))
      .replace(/\*\s*[^*\n]*\s[^*\n]*\s*\*/g, ' ')
      .replace(/\*\s*\*/g, ' ')
      .replace(/\*/g, '')
      .replace(emoji, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function splitIntoSentences(text) {
    if (!text) return [];
    const sentences = text.match(/[^.!?…。？！]+[.!?…。？！]?\s*|[^.!?…。？！]+$/g);
    return sentences ? sentences.map(s => s.trim()).filter(Boolean) : [text.trim()];
  }

  function chunksOf(text) {
    const chunks = [];
    let current = '';
    for (const s of splitIntoSentences(stripForTTS(text))) {
      if (current && current.length + s.length > CHUNK_LIMIT) { chunks.push(current); current = s; }
      else current += (current ? ' ' : '') + s;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  // Reply-level language plans; the voice inventory remains local.
  const languageState = window.TTSLanguageRouter ? window.TTSLanguageRouter.create() : null;
  function conversationKey() { return typeof Chat !== 'undefined' ? Chat.convId || 'default' : 'default'; }
  function fingerprint() { return JSON.stringify([settings.voiceId]); }
  function prepareRouting(text, force = false, sample = false) {
    return languageState ? languageState.prepare(stripForTTS(text), { key: conversationKey(), voiceId: settings.voiceId, voices: VOICES,
      auto: !sample, enabled: settings.enabled || force || sample, fingerprint: fingerprint() }) : null;
  }
  function finishRouting(plan, request, valid = () => true) {
    return plan && languageState ? languageState.settle(plan, request, 'sprites_tts_language_v1', valid) : Promise.resolve(plan);
  }

  // ── Settings ──
  const KEY = window.WaifuSpritesEmbed ? 'ws_embed_speech' : 'ws_speech';
  const settings = { enabled: true, voiceId: '', volume: 1 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  // An empty voiceId means the cloud voice for the reply's language; saved
  // values from the removed on-client voice catalog fall back to it.
  if (!byId(settings.voiceId)) settings.voiceId = '';
  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }

  // ── Audio ──
  let ctx = null;
  let source = null;
  let runToken = 0;
  let preparing = false;

  // Browsers only allow sound after a user gesture, so the page calls this on clicks and keys.
  function unlock() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }

  // One speech request per chunk; the endpoint picks voice and provider from
  // the language. 204 means speech is unavailable right now, not an error to
  // retry; other failures leave the chunk silent.
  async function fetchCloud(text, lang) {
    const params = new URLSearchParams({ text });
    if (lang) params.set('lang', lang);
    const res = await fetch(`${TTS_URL}?${params}`, { signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) });
    if (res.status === 204) throw new Error('speech unavailable');
    if (!res.ok) throw new Error('speech HTTP ' + res.status);
    const bytes = await res.arrayBuffer();
    if (!bytes.byteLength) throw new Error('speech returned no audio');
    unlock();
    return { buffer: await ctx.decodeAudioData(bytes), provider: res.headers.get('X-Tts-Provider') || 'cloud' };
  }

  // Resolves a chunk to something playable without making a sound, so the next
  // chunk can be fetched while this one plays.
  async function resolve(text, plan = null) {
    const voice = byId(settings.voiceId);
    if (voice) {
      const target = (plan && plan.lang) || voice.language;
      const installed = window.speechSynthesis ? browserVoice(target, voice.gender) : null;
      if (!installed) return { kind: 'silent' };
      return { kind: 'browser', text, gender: voice.gender, lang: installed.lang };
    }
    const lang = (plan && plan.lang) || (window.TTSLanguageRouter ? window.TTSLanguageRouter.analyze(stripForTTS(text)).lang : null) || 'en-US';
    try {
      const { buffer, provider } = await fetchCloud(text, lang);
      return { kind: 'buffer', buffer, lang, voiceId: '', provider, fell_back: false };
    } catch (e) {
      // Unavailable speech, rate limits and invalid audio leave this chunk silent.
      return { kind: 'silent' };
    }
  }

  function playBuffer(buffer) {
    return new Promise(done => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = settings.volume;
      src.connect(gain).connect(ctx.destination);
      source = src;
      const watchdog = setTimeout(() => { try { src.stop(); } catch (e) {} done(); }, buffer.duration * 1000 + 4000);
      src.onended = () => { clearTimeout(watchdog); if (source === src) source = null; done(); };
      src.start();
    });
  }

  function browserVoice(lang, gender) {
    const all = speechSynthesis.getVoices();
    let local = all.filter(v => v.lang.split('-')[0].toLowerCase() === lang.split('-')[0].toLowerCase());
    if (!local.length) {
      const fallbackLang = (byId(settings.voiceId) || { language: 'en-US' }).language;
      local = all.filter(v => v.lang.split('-')[0].toLowerCase() === fallbackLang.split('-')[0].toLowerCase());
    }
    if (!local.length) return null;
    return window.TTSLanguageRouter.browserVoiceForGender(local, gender);
  }

  async function speakBrowser(text, lang, gender) {
    if (!window.speechSynthesis) return;
    if (!speechSynthesis.getVoices().length) {
      await new Promise(ok => {
        const t = setTimeout(ok, 2000);
        speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); ok(); }, { once: true });
      });
    }
    const selected = browserVoice(lang, gender);
    if (!selected) return;
    await new Promise(done => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.volume = settings.volume;
      const v = selected;
      if (v) u.voice = v;
      // A stalled utterance (a known Chrome behaviour) must not hang the queue.
      const watchdog = setTimeout(() => { speechSynthesis.cancel(); done(); }, Math.max(10000, text.length / 12 * 1000 + 8000));
      u.onend = u.onerror = () => { clearTimeout(watchdog); done(); };
      speechSynthesis.speak(u);
    });
  }

  function stop() {
    runToken++;
    preparing = false;
    if (source) { try { source.stop(); } catch (e) {} source = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  /**
   * Reads text aloud, replacing anything already playing. Resolves when it ends or is stopped.
   * hooks.onStart() fires at once, hooks.onPlay({provider, fell_back}) when the sound starts,
   * hooks.onEnd() when it finishes without being stopped. hooks.force plays it
   * even while her voice is muted (the replay button on a message).
   */
  async function speak(text, hooks = {}) {
    if (hooks.valid && !hooks.valid()) return;
    stop();
    if (!settings.enabled && !hooks.force) return;
    const chunks = chunksOf(text);
    if (!chunks.length) return;
    const token = runToken;
    const live = () => token === runToken && (!hooks.valid || hooks.valid());
    preparing = true;
    try {
      unlock();
      if (hooks.onStart) hooks.onStart();
      const key = conversationKey();
      const valid = () => live() && conversationKey() === key && (settings.enabled || hooks.force || hooks.sample);
      let plan = hooks.routingPlan ? await hooks.routingPlan : prepareRouting(text, hooks.force, hooks.sample);
      if (!valid()) return;
      const signature = JSON.stringify([key, settings.voiceId, !hooks.sample, fingerprint()]);
      if (plan && plan.signature !== signature) plan = prepareRouting(text, hooks.force, hooks.sample);
      if (plan && plan.needsDecision && !plan.finished && !plan.pending) {
        const recent = typeof Chat !== 'undefined' && Chat.recentContext ? Chat.recentContext().filter(m => m.text !== text) : [];
        const request = typeof Chat !== 'undefined' && typeof Chat.askDecisions === 'function'
          ? Chat.askDecisions(['sprites_tts_language_v1'], { reply: plan.text, conversation_language: plan.previousLang, recent_context: recent }, hooks.owner) : null;
        plan = await finishRouting(plan, request, valid);
      } else if (plan && plan.pending && !plan.finished) plan = await plan.pending;
      if (!valid()) return;
      let next = resolve(chunks[0], plan);
      for (let i = 0; i < chunks.length && live(); i++) {
        const current = await next;
        if (!valid()) break;
        if (i + 1 < chunks.length) next = resolve(chunks[i + 1], plan);
        if (i === 0 && hooks.onPlay) {
          if (current.kind !== 'silent') hooks.onPlay({ provider: current.provider || (current.kind === 'buffer' ? 'cloud' : 'browser'), fell_back: !!current.fell_back, voice_lang: current.lang || '', requested_voice_lang: plan && plan.lang || '', routing_source: plan && plan.source || 'local', routing_cache_hit: !!(plan && plan.cacheHit), decision_requested: !!(plan && plan.decisionRequested), routing_wait_ms: plan && plan.waitMs || 0 });
        }
        if (current.kind === 'buffer') await playBuffer(current.buffer);
        else if (current.kind === 'browser') await speakBrowser(current.text, current.lang, current.gender);
        if (i + 1 < chunks.length && live()) await new Promise(r => setTimeout(r, CHUNK_GAP_MS));
      }
      if (live() && hooks.onEnd) hooks.onEnd();
    } finally {
      if (token === runToken) preparing = false;
    }
  }

  const speaking = () => preparing || !!source || (window.speechSynthesis && speechSynthesis.speaking);

  return { VOICES, settings, save, speak, stop, unlock, prepareRouting, finishRouting, get speaking() { return speaking(); } };
})();
