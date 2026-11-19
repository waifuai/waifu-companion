/**
 * speech.js: reads her replies aloud.
 *
 * Speech is read aloud by the browser's own SpeechSynthesis voice. The
 * WaifuAI Cloud speech endpoint was retired; no request leaves this page for
 * audio. Failed or unavailable speech stays silent. Replies are cleaned for
 * speech (no *actions*, no emoji), split into sentences and grouped into
 * chunks of up to CHUNK_LIMIT characters. While one chunk plays, the next is
 * prepared locally.
 *
 * Language routing: a reply in Japanese, Korean, German, Indonesian and so on
 * is spoken in that language when an installed browser voice supports it.
 */
const Speech = (() => {
  const CHUNK_LIMIT = 300;
  const CHUNK_GAP_MS = 150;

  // [id, name, language, gender, group]
  const VOICES = [
    // Optional external voices. Selecting one is an explicit opt-in; the
    // default browser voices below never send text anywhere.
    ...(window.TikTokTTS ? window.TikTokTTS.VOICES.map(v => [v.id, v.name, v.language, v.gender, 'TikTok (external)', 'tiktok']) : []),
    ['browser-female', 'Browser voice (female)', 'en-US', 'female', 'Browser'],
    ['browser-male', 'Browser voice (male)', 'en-US', 'male', 'Browser'],
  ].map(([id, name, language, gender, group, provider = 'browser']) => ({ id, name, language, gender, group, provider }));

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
  // TikTok US English (F1) is the default when the catalog is loaded. An
  // unknown saved id falls back to a local browser voice, never to the first
  // catalog entry.
  const defaultVoiceId = window.TikTokTTS ? 'en_us_001' : 'browser-female';
  const settings = { enabled: true, voiceId: defaultVoiceId, volume: 1 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  if (!byId(settings.voiceId)) settings.voiceId = byId('browser-female') ? 'browser-female' : VOICES[0].id;
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

  // Resolves a chunk to a local browser voice without making a sound, so the
  // next chunk can be prepared while this one plays. No audio bytes are
  // fetched: speechSynthesis owns playback and language selection.
  async function resolve(text, plan = null, preview=false) {
    const voice = byId(settings.voiceId) || byId('browser-female') || VOICES[0];
    const target = (plan && plan.lang) || (window.TTSLanguageRouter ? window.TTSLanguageRouter.analyze(stripForTTS(text)).lang : null) || voice.language;

    // A TikTok voice is opt-in by selection. Only this branch sends reply
    // text to an external speech service; browser voices stay local.
    if (voice.provider === 'tiktok' && window.TikTokTTS) {
      try {
        const audio = await window.TikTokTTS.synthesize(text, voice.id);
        const decoded = await window.TikTokTTS.decode(audio, ctx);
        ctx = decoded.context;
        return { kind: 'buffer', buffer: decoded.buffer, text, voiceId: voice.id,
          gender: voice.gender, lang: (plan && plan.lang) || voice.language, provider: 'tiktok' };
      } catch (e) {
        reportEvent('tts_provider_error', { provider: 'tiktok', voice_id: voice.id });
        // Fall through to the installed browser voice for the same language.
      }
    }

    const installed = window.speechSynthesis ? browserVoice(target, voice.gender) : null;
    if (!installed) return { kind: 'silent' };
    return { kind: 'browser', text, gender: voice.gender, lang: installed.lang };
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

  async function speakBrowser(text, lang, gender,onStart) {
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
      u.onstart=()=>onStart?.();
      u.onend = u.onerror = () => { clearTimeout(watchdog); done(); };
      speechSynthesis.speak(u);
    });
  }

  // Plays audio returned by an explicitly chosen external voice. The bytes
  // are already local; this function only owns playback and lip-sync-free
  // timing. Browser voices use speakBrowser instead.
  function playBuffer(buffer,onStart) {
    const context = ctx || new (window.AudioContext || window.webkitAudioContext)();
    ctx = context;
    return new Promise(done => {
      const node = context.createBufferSource();
      source = node;
      node.buffer = buffer;
      node.connect(context.destination);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (source === node) source = null;
        done();
      };
      const timer = setTimeout(() => { try { node.stop(); } catch (e) {} finish(); }, buffer.duration * 1000 + 4000);
      node.onended = finish;
      node.start();
      onStart?.();
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
      let next = resolve(chunks[0], plan,!!hooks.sample);
      let reportedPlay=false;
      for (let i = 0; i < chunks.length && live(); i++) {
        const current = await next;
        if (!valid()) break;
        if (i + 1 < chunks.length) next = resolve(chunks[i + 1], plan,!!hooks.sample);
        const onStarted=()=>{
          if(!valid())return;
          const info={voice_id:settings.voiceId||'default',served_voice:current.voiceId||settings.voiceId||'default',
            provider:current.provider||'browser',fell_back:false,
            voice_lang:current.lang||'',requested_voice_lang:plan?.lang||'',routing_source:plan?.source||'local',
            routing_cache_hit:!!plan?.cacheHit,decision_requested:!!plan?.decisionRequested,routing_wait_ms:plan?.waitMs||0,preview:!!hooks.sample};
          if(!hooks.sample){reportEvent('tts_chunk_played',info);hooks.onChunk?.(info);}
          if(!reportedPlay){reportedPlay=true;if(!hooks.sample){reportEvent('tts_played',info);hooks.onPlay?.(info);}}
        };
        if (current.kind === 'browser') await speakBrowser(current.text, current.lang, current.gender,onStarted);
        if (current.kind === 'buffer') await playBuffer(current.buffer,onStarted);
        if (i + 1 < chunks.length && live()) await new Promise(r => setTimeout(r, CHUNK_GAP_MS));
      }
      if (live() && hooks.onEnd) hooks.onEnd();
    } finally {
      if (token === runToken) preparing = false;
    }
  }

  function showStatus(message){const el=typeof document!=='undefined'?document.getElementById('voiceChoiceStatus'):null;if(el)el.textContent=message;}
  // Telemetry used to POST to a public speech service. Local speech has no
  // service to report to; events are now page-local only.
  function reportEvent(event,info={}){
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
      try { window.dispatchEvent(new window.CustomEvent('waifu-speech', { detail: { event, ...info } })); } catch (e) {}
    }
  }
  async function loadVoices(){ return VOICES.slice(); }
  const speaking = () => preparing || !!source || (window.speechSynthesis && speechSynthesis.speaking);

  return { VOICES, settings, save, speak,loadVoices,reportEvent, stop, unlock, prepareRouting, finishRouting, get speaking() { return speaking(); } };
})();
