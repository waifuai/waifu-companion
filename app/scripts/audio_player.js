// TTS playback.
//
// Provider resolution and playback are kept strictly separate:
//   fetchTTSBuffer()  decides the provider and fetches audio, but NEVER plays.
//                     It returns a descriptor: {kind:'buffer'} or {kind:'browser'}.
//   playResolvedChunk() is the only thing that makes noise.
// This split matters for the look-ahead preload in tts_queue_manager.js:
// preloading a browser-TTS chunk used to speak it immediately, over the top
// of the chunk that was already playing, because fetchTTSBuffer used to both
// resolve AND play for the browser provider.

// Connects an AudioBuffer to the TTS graph, drives the Live2D mouth from the
// analyser, and resolves when playback ends. Rejects on playback timeout.

// Target mouth shape computed by the analyser loop in playAudioBuffer and
// applied to the model by attachMouthDriver.
const mouthState = { open: 0, form: 0, active: false, needsReset: false };

// Writing mouth parameters from requestAnimationFrame does not stick: the
// framework's own per-frame update (motions, idle expressions) re-writes the
// mouth parameters afterwards and renders those, so the rAF values are never
// seen by the renderer. Hooking the model's motionManager.update lets us
// re-apply the mouth shape AFTER motions are applied and BEFORE the frame is
// rendered, which is the only point where the analyser-driven values win.
function attachMouthDriver(model) {
  const internalModel = model && model.internalModel;
  const motionManager = internalModel && internalModel.motionManager;
  if (!motionManager || motionManager.__mouthDriver) return;
  motionManager.__mouthDriver = true;
  const originalUpdate = motionManager.update.bind(motionManager);
  motionManager.update = function (coreModel, now) {
    const result = originalUpdate(coreModel, now);
    const target = coreModel || internalModel.coreModel;
    if (target && typeof target.setParameterValueById === 'function') {
      if (mouthState.active) {
        target.setParameterValueById('ParamMouthOpenY', mouthState.open);
        target.setParameterValueById('ParamMouthForm', mouthState.form);
      } else if (mouthState.needsReset) {
        target.setParameterValueById('ParamMouthOpenY', 0);
        target.setParameterValueById('ParamMouthForm', 0);
        mouthState.needsReset = false;
      }
    }
    return result;
  };
}

function playAudioBuffer(audioBuffer, label = '') {
  const audioContext = getTTSAudioContext();
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  currentAudio = source;

  let animationFrameId = null;

  const resetMouth = () => {
    mouthState.open = 0;
    mouthState.form = 0;
    mouthState.active = false;
    mouthState.needsReset = true;
  };

  if (currentModel) {
    attachMouthDriver(currentModel);
    const analyserNode = getTTSAnalyser();
    source.connect(analyserNode);

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    let lastVolume = 0;
    const smoothingFactor = 0.3;

    const updateMouth = () => {
      // Stop as soon as this source is no longer the active one.
      if (currentAudio !== source || !currentModel) {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        resetMouth();
        return;
      }
      analyserNode.getByteFrequencyData(dataArray);
      const vocalRange = dataArray.slice(10, 100);
      const volume = vocalRange.reduce((acc, val) => acc + val, 0) / vocalRange.length;
      lastVolume = lastVolume + (volume - lastVolume) * smoothingFactor;
      // /128 saturated the curve at full-open for normal speech levels.
      const normalizedVolume = Math.min(lastVolume / 190, 1);

      mouthState.open = normalizedVolume * 1.5;
      mouthState.form = normalizedVolume * 0.5 - 0.25;
      mouthState.active = true;
      animationFrameId = requestAnimationFrame(updateMouth);
    };
    updateMouth();
  } else {
    const gain = typeof getTTSGainNode === 'function' ? getTTSGainNode() : audioContext.destination;
    source.connect(gain);
  }

  const playback = new Promise((resolve, reject) => {
    const audioDurationMs = audioBuffer.duration * 1000;
    const timeoutMs = Math.max(8000, audioDurationMs + 4000);

    const timeoutId = setTimeout(() => {
      debugLog(`TTS: Playback timeout after ${timeoutMs.toFixed(0)}ms${label ? ` for "${label}"` : ''}`, 'warn');
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (currentAudio === source) resetMouth();
      source.onended = null; // prevent a late onended from resolving after we reject
      try { source.stop(); } catch (e) { /* already stopped */ }
      reject(new Error(`TTS playback timeout${label ? `: ${label}` : ''}`));
    }, timeoutMs);

    source.onended = () => {
      clearTimeout(timeoutId);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (currentAudio === source) resetMouth();
      resolve();
    };

    source.start();
    debugLog(`TTS: Playback started (${audioDurationMs.toFixed(0)}ms)${label ? `: "${label}"` : ''}`, 'info');
  });

  return playback.finally(() => {
    if (currentAudio === source) currentAudio = null;
    try { source.disconnect(); } catch (e) { /* ignore */ }
  });
}
window.playAudioBuffer = playAudioBuffer;

// --- Language routing: route TTS voice by the reply's script ---
// Short code -> BCP47 lang tag. Script-range detection for non-Latin scripts;
// Latin-script stopword hints are handled by detectLatinVoiceLang below.
// null means "keep the user's chosen voice".
const DETECTED_VOICE_LANG_TAGS = {
  ru: 'ru-RU', ar: 'ar-SA', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN',
  th: 'th-TH', hi: 'hi-IN', he: 'he-IL', el: 'el-GR',
  id: 'id-ID', de: 'de-DE', pt: 'pt-BR'
};

// Japanese female voice pinned by the design doc (jp_003 = F2).
const PREFERRED_LANG_VOICE_IDS = { ja: 'jp_003' };

function detectVoiceLang(text) {
  if (!text) return null;
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'; // Kana BEFORE Han, else ja reads as zh
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  if (/[\u0370-\u03FF]/.test(text)) return 'el';
  return null;
}

// Resolves { voiceId, lang } for a chunk. lang = BCP47 tag when a script or
// Latin-script hint was detected (null otherwise). voiceId = best matching
// configured voice (female
// first, or the pinned id), or the input voiceId when no configured voice matches.
function resolveVoiceForText(text, voiceId) {
  const scriptLang = detectVoiceLang(text);
  const lang = scriptLang || detectLatinVoiceLang(text);
  if (!lang) return { voiceId, lang: null };
  const base = lang.split('-')[0].toLowerCase();
  const matches = (v) => v.language === lang || (v.language || '').split('-')[0].toLowerCase() === base;
  const pinnedId = PREFERRED_LANG_VOICE_IDS[lang];
  const pinned = pinnedId ? voices.find(v => v.id === pinnedId && matches(v)) : null;
  const female = voices.find(v => matches(v) && v.gender === 'female');
  const any = voices.find(matches);
  const chosen = pinned || female || any;
  return { voiceId: chosen ? chosen.id : voiceId, lang: DETECTED_VOICE_LANG_TAGS[lang] || null };
}
window.detectVoiceLang = detectVoiceLang;
window.resolveVoiceForText = resolveVoiceForText;

// --- Latin-script language hints (stopword scoring) ---
// Latin scripts carry no script signal, so score function words for the
// Latin-script languages that have a matching TikTok voice. English is
// tracked only as an ambiguity guard; if nothing wins clearly, the user's
// voice is kept. Both accented and accentless spellings are included, and
// the id set also covers Malay and Filipino: no tl voice exists, so the phonetically closest voice is Indonesian.
const LATIN_LANG_HINTS = {
  en: ['the','and','you','that','have','for','not','with','this','but','what','your','just','like','how','are','was','can','it','is','to','of','in','my','me','we','so','do','if','on','or','at','be','as','an','his','her','they','them','their','would','could','should','there','here','from','about','when','then','than','some','one','all','out','up','who','why','will','well','yeah','okay','ok','love','want','know','think','feel','really','very','much','good','happy','sad','please','thanks','thank','sorry','hello','hey','cute','pretty','beautiful','little','big','day','night','morning','time','right','back','down','over','again','still','only','even','more','most','too','oh','ooh','haha','lol','yes'],
  id: ['yang','dan','itu','ini','dari','apa','siapa','kenapa','bagaimana','kapan','dimana','mana','tidak','tak','bukan','jangan','aku','kamu','kau','saya','anda','awak','dia','kita','kami','mereka','orang','dengan','untuk','pada','dalam','akan','sudah','udah','belum','pernah','selalu','sering','kadang','bisa','dapat','boleh','harus','mau','ingin','suka','sayang','cinta','hati','senang','sedih','takut','marah','lucu','cantik','manis','baik','jelek','besar','kecil','banyak','sedikit','semua','juga','tapi','tetapi','karena','kalau','jika','kalo','jadi','adalah','ada','tinggal','bicara','ngomong','bilang','kata','tahu','tau','ngerti','paham','lihat','dengar','kasih','beri','buat','buatkan','bikin','makan','gambar','untukmu','untuk','minum','tidur','bangun','jalan','rumah','kerja','sekolah','uang','belajar','teman','keluarga','nama','kabar','halo','terima','maaf','tolong','selamat','banget','nggak','gak','nih','dong','sih','deh','kok','lah','yuk','ayo','mari','oke','nunggu','santai','bantu','sekedar','memang','ternyata','sekarang','nanti','besok','kemarin','pagi','siang','sore','malam','hari',
    // Filipino/Tagalog (no tl voice upstream; phonetic map -> Indonesian voice)
    'ang','mga','ako','ikaw','niya','natin','namin','nila','tayo','kayo','sila','ito','iyan','iyon','yun','yan','dito','diyan','doon','sino','saan','paano','bakit','kailan','opo','oo','hindi','wala','meron','dahil','kasi','naman','lang','talaga','grabe','sobra','salamat','kamusta','kumusta','mahal','puso','buhay','ganda','gwapo','asawa','anak','kuya','lola','lolo','tito','tita','pare','kaibigan','mabait','masaya','malungkot','galit','pagod','naku','galing','lahat','tulong','ingat','palagi','muna',
    // Malay spelling variants (same Indonesian target)
    'khabar','mahu','jom'],
  de: ['der','die','das','dem','den','und','oder','aber','ich','wir','ihr','mich','dich','sich','uns','dein','sein','ihre','nicht','kein','keine','ein','eine','einem','einen','ist','bin','bist','sind','war','waren','wird','werden','kann','kannst','können','konnen','muss','will','willst','möchte','mochte','habe','hast','hat','haben','für','fur','auf','von','bei','nach','über','uber','unter','vor','durch','gegen','ohne','um','wie','was','wer','warum','wo','wann','jetzt','dann','wenn','weil','dass','doch','mal','schon','nur','auch','noch','immer','wieder','sehr','gut','schlecht','ja','nein','danke','bitte','hallo','liebe','liebling','schatz','herz','tag','nacht','morgen','gern','gerne'],
  pt: ['não','nao','sim','você','voce','vocês','voces','sou','eu','ele','ela','nós','mas','com','para','isso','isto','aqui','muito','bem','tudo','nada','bom','boa','dia','noite','tarde','olá','ola','oi','obrigado','obrigada','desculpa','amor','querido','querida','saudade','saudades','coração','coracao','beijo','beijos','gosto','gostei','gente','então','entao','também','tambem','quando','onde','tá','né','acho','certeza','vou','vai','está','esta','estão','estao',
    // Spanish words fold into the pt bucket on purpose: no es voice exists and
    // br_001 is the closest female Romance voice (female-first policy).
    'hola','gracias','muy','señor','señora','señorita','usted','ustedes','eres','del','ellos','ellas','nosotros','tambien','también','puedo','puedes','quiero','quieres','tengo','tienes','dime','dónde','donde','cuando','quién','quien','mío','mía','tuyo','tuya','bueno','buena','buenas','buenos','unos','unas','esto','eso','aquello','allá','luego','entonces','siempre','nunca','mañana','noche','semana','mundo','grande','pequeño','pequeña','malo','feliz','triste','gusto','encanta','corazón','corazon','beso','besos','guapo','guapa','lindo','linda','hermana','hermano','amiga','amigo','casa','vida','tiempo','español','espanol','inglés','ingles','perdón','perdon','favor','adiós','adios','cariño','carino','estoy','estás','estan','están','somos','son','estaba','hablas','hablo','mucho','aunque','hermosa','hermoso','juntos','juntas','sabes','amo','cómo','aquí','dias','día','días','qué','siento','contigo','necesitas','dios','alegra'],
};
const LATIN_LANG_HINT_SETS = {};
for (const hintLang of Object.keys(LATIN_LANG_HINTS)) LATIN_LANG_HINT_SETS[hintLang] = new Set(LATIN_LANG_HINTS[hintLang]);

// Returns a routed language ('id' | 'de' | 'pt') when a Latin-script text
// clearly matches a supported language, else null (keep the user's voice).
function detectLatinVoiceLang(text) {
  const tokens = String(text || '').toLowerCase().split(/[^a-z\u00E0-\u00F6\u00F8-\u00FF0-9']+/).filter(t => t.length >= 2);
  if (!tokens.length) return null;
  const scores = {};
  for (const hintLang of Object.keys(LATIN_LANG_HINT_SETS)) scores[hintLang] = 0;
  for (const token of tokens) {
    for (const hintLang of Object.keys(scores)) {
      if (LATIN_LANG_HINT_SETS[hintLang].has(token)) scores[hintLang]++;
    }
  }
  let best = null, bestScore = 0, tied = false;
  for (const [hintLang, score] of Object.entries(scores)) {
    if (score > bestScore) { best = hintLang; bestScore = score; tied = false; }
    else if (score === bestScore && score > 0) tied = true;
  }
  if (!best || best === 'en' || tied) return null;
  if (bestScore < 2) return null; // needs at least two distinct hits
  // Short texts may also route with two hits when they cover >=25% of the words
  // (calibrated on the live corpus: zero false positives; long texts still need three).
  if (bestScore < 3 && bestScore * 4 < tokens.length) return null;
  if (bestScore - scores.en < 1) return null; // must clearly beat the English guard
  return best;
}
window.detectLatinVoiceLang = detectLatinVoiceLang;

// Picks a concrete SpeechSynthesisVoice for the requested voice config.
// langOverride (BCP47) wins over the voice config's own language when a reply's script was detected.
function selectBrowserVoice(voiceId, langOverride) {
  const available = speechSynthesis.getVoices();
  const voiceConfig = voices.find(v => v.id === voiceId);
  const targetLang = langOverride || (voiceConfig && voiceConfig.language) || 'en-US';
  const targetGender = (voiceConfig && voiceConfig.gender) || 'female';

  const baseLang = targetLang.split('-')[0];
  const langVoices = available.filter(v => v.lang.startsWith(baseLang));

  if (langVoices.length > 0) {
    const femaleKeywords = ['female', 'woman', 'girl', 'zira', 'hazel', 'susan', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'kate', 'victoria', 'princess', 'alice'];
    const maleKeywords = ['male', 'man', 'boy', 'david', 'mark', 'james', 'daniel', 'thomas', 'george', 'alex', 'fred', 'ralph'];
    const keywords = targetGender === 'female' ? femaleKeywords : maleKeywords;
    const oppositeKeywords = targetGender === 'female' ? maleKeywords : femaleKeywords;
    // Fallback chain: keyword match, then any voice not matching the opposite
    // gender's keywords, then whatever is first - langVoices[0] is often a
    // male system voice (the known robotic man voice defect).
    const keywordMatch = langVoices.find(v => keywords.some(kw => v.name.toLowerCase().includes(kw)));
    const notOpposite = langVoices.find(v => !oppositeKeywords.some(kw => v.name.toLowerCase().includes(kw)));
    return { voice: keywordMatch || notOpposite || langVoices[0], lang: targetLang };
  }
  return { voice: available[0] || null, lang: targetLang };
}

// Waits (bounded) for the browser to populate its voice list.
async function waitForBrowserVoices(timeoutMs = 3000) {
  if (speechSynthesis.getVoices().length > 0) return;
  debugLog('TTS: Waiting for browser voices to load...', 'info');
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
      resolve();
    };
    const pollId = setInterval(() => {
      if (speechSynthesis.getVoices().length > 0) done();
    }, 100);
    const timeoutId = setTimeout(done, timeoutMs);
  });
}

// Speaks text through the browser's SpeechSynthesis and resolves when done.
// Always resolves within a bounded time: previously there was no timeout at
// all, only utterance.onend/onerror — a stalled utterance (a known Chrome
// behaviour on long text) hung the whole TTS pipeline forever.
async function speakViaBrowser(textChunk, voiceId, langOverride) {
  if (!window.speechSynthesis) {
    debugLog('TTS: Browser SpeechSynthesis not available', 'error');
    return;
  }
  if (window.enableFallbackVoice === false) {
    debugLog('TTS: Browser SpeechSynthesis blocked because fallback voice is disabled', 'info');
    return;
  }

  await waitForBrowserVoices();
  debugLog(`TTS: Speaking via browser SpeechSynthesis: "${textChunk.substring(0, 50)}..."`, 'info');

  await new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(textChunk);
    const { voice, lang } = selectBrowserVoice(voiceId, langOverride);
    utterance.lang = lang;
    if (voice) {
      utterance.voice = voice;
      debugLog(`TTS: Selected browser voice: "${voice.name}" (lang: ${voice.lang})`, 'info');
    }
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    let settled = false;
    const done = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdogId);
      if (reason) debugLog(`TTS: Browser SpeechSynthesis ${reason}`, reason === 'finished' ? 'info' : 'warn');
      resolve();
    };

    // ~12 chars/sec is a conservative floor for speech rate; pad generously.
    const estimatedMs = (textChunk.length / 12) * 1000;
    const watchdogId = setTimeout(() => {
      try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      done('timed out');
    }, Math.max(10000, estimatedMs + 8000));

    utterance.onend = () => done('finished');
    utterance.onerror = (e) => done(`error: ${e.error}`);

    speechSynthesis.speak(utterance);
  });
}
window.speakViaBrowser = speakViaBrowser;

// Resolves a chunk to a playable descriptor WITHOUT producing any sound.
// Returns {kind:'buffer', buffer} | {kind:'browser', text, voiceId} | null.
// Throws on primary-provider errors (with err.status set where known) so the
// queue manager can see rate limits and pause instead of silently dropping
// the chunk.
async function fetchTTSBuffer(textChunk, voiceId) {
  if (!textChunk.trim()) return null;

  debugLog(`TTS: === fetchTTSBuffer START ===`, 'info');
  debugLog(`TTS: Input text: "${textChunk.substring(0, 100)}..."`, 'info');
  debugLog(`TTS: Input voiceId: "${voiceId}"`, 'info');

  const voiceConfig = voices.find(v => v.id === voiceId);
  const provider = voiceConfig ? voiceConfig.provider : 'tiktok';
  debugLog(`TTS: Resolved provider: "${provider}" for voiceId: "${voiceId}"`, 'info');
  const routed = (window.enableAutoTtsLang !== false) ? resolveVoiceForText(textChunk, voiceId) : { voiceId, lang: null };
  if (routed.lang) debugLog(`TTS: Language routing: ${routed.lang} -> voice ${routed.voiceId} (user setting: ${voiceId})`, 'info');

  const audioContext = getTTSAudioContext();
  let primaryError = null;
  // True once the primary provider was tried and failed, so analytics/logging
  // can tell "user chose browser TTS" apart from "primary is down".
  let fellBack = false;

  // 1. TikTok TTS (primary provider by default). Called directly — the API
  // sends Access-Control-Allow-Origin: * on its own, no proxy needed.
  if (provider === 'tiktok' && window.enablePrimaryVoice !== false) {
    const apiUrl = "https://ottsy.weilbyte.dev/api/generation";
    debugLog(`TTS: === TikTok TTS Flow START ===`, 'info');
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textChunk, voice: routed.voiceId })
      });
      debugLog(`TTS: Response status: ${response.status}`, 'info');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const err = new Error(`TikTok TTS HTTP ${response.status}: ${errorText.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }

      const json = await response.json();
      if (json.success === false) {
        throw new Error(`TikTok TTS API error: ${json.error || 'Unknown error'}`);
      }
      const audioData = json.data || json.audio || json;
      if (!audioData) throw new Error('TikTok TTS returned no audio data');

      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      const buffer = await audioContext.decodeAudioData(bytes.buffer);
      debugLog(`TTS: TikTok TTS audio decoded successfully, duration: ${buffer.duration.toFixed(2)}s`, 'info');
      return { kind: 'buffer', buffer, provider: 'tiktok', fellBack: false };
    } catch (err) {
      debugError('TTS: TikTok TTS failed', err, { voiceId, textLen: textChunk.length });
      primaryError = err;
      fellBack = true;
    }
  } else if (provider === 'browser' && window.enablePrimaryVoice !== false) {
    return { kind: 'browser', text: textChunk, voiceId: routed.voiceId, lang: routed.lang, provider: 'browser', fellBack: false };
  } else if (window.enablePrimaryVoice === false) {
    debugLog('TTS: Primary voice disabled.', 'info');
    fellBack = true;
  }

  // 2. Local Kokoro.
  if (window.enableKokoro && window.isKokoroReady && typeof window.generateKokoroAudioBuffer === 'function') {
    try {
      const kokoroBuffer = await window.generateKokoroAudioBuffer(textChunk, window.selectedKokoroVoiceId || 'af_heart');
      if (kokoroBuffer) return { kind: 'buffer', buffer: kokoroBuffer, provider: 'kokoro', fellBack };
    } catch (kokoroErr) {
      debugLog(`TTS: Local Kokoro generation failed: ${kokoroErr.message}`, 'error');
      fellBack = true;
    }
  } else if (window.enableKokoro && !window.isKokoroReady) {
    debugLog('TTS: Local Kokoro still preloading. Falling through to browser TTS.', 'info');
  }

  // 3. Browser fallback.
  if (window.enableFallbackVoice === false) {
    debugLog('TTS: Fallback voice disabled.', 'warn');
    // Surface a rate limit rather than silently going quiet, so the queue can pause.
    if (primaryError && primaryError.status === 429) throw primaryError;
    return null;
  }

  debugLog('TTS: Falling back to browser SpeechSynthesis.', 'info');
  return {
    kind: 'browser',
    text: textChunk,
    voiceId: window.ttsFallbackVoiceId || 'browser-female',
    lang: routed.lang,
    provider: 'browser',
    fellBack
  };
}
window.fetchTTSBuffer = fetchTTSBuffer;

// Plays an already-resolved chunk descriptor.
async function playResolvedChunk(resolved, label = '') {
  if (!resolved) {
    debugLog(`TTS: Nothing to play, skipping chunk: "${label.substring(0, 30)}..."`, 'warn');
    return;
  }
  if (resolved.kind === 'browser') {
    await speakViaBrowser(resolved.text, resolved.voiceId, resolved.lang);
    return;
  }
  await playAudioBuffer(resolved.buffer, label);
}
window.playResolvedChunk = playResolvedChunk;

// Fetches (if needed) and plays a single chunk. Returns the descriptor that
// actually served the audio, so the caller can report which provider was used
// without having to resolve the chunk itself.
//
// Errors propagate so the queue manager can handle 429s and show the retry
// button; the one exception is the "text too long" split-and-retry path.
// Previously every error here was swallowed (caught, logged, then the
// function just fell into `finally` and returned undefined), so the 429
// handling in tts_queue_manager.js was unreachable dead code.
async function tryPlaySingleChunk(textChunk, voiceId, attempt = 0, preloaded = null) {
  const MAX_SPLIT_ATTEMPTS = 5;
  if (attempt > MAX_SPLIT_ATTEMPTS) {
    debugLog(`TTS: Chunk too long after splits: "${textChunk.substring(0, 30)}..."`, 'error');
    return null;
  }
  if (!textChunk.trim()) return null;

  debugLog(`TTS: Playing chunk (attempt ${attempt + 1}): "${textChunk.substring(0, 100)}..." with voice ${voiceId}`, 'info');

  try {
    const resolved = preloaded || await fetchTTSBuffer(textChunk, voiceId);
    await playResolvedChunk(resolved, textChunk.substring(0, 30));
    return resolved;
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('text too long') && attempt < MAX_SPLIT_ATTEMPTS) {
      debugLog(`TTS: 'Text too long' — splitting chunk. Attempt ${attempt + 1}`, 'warn');
      const halfPoint = Math.floor(textChunk.length / 2);
      let splitPoint = textChunk.lastIndexOf(' ', halfPoint);
      if (splitPoint <= 0) splitPoint = halfPoint;

      const firstHalf = textChunk.substring(0, splitPoint);
      const secondHalf = textChunk.substring(splitPoint).trim();
      const a = firstHalf ? await tryPlaySingleChunk(firstHalf, voiceId, attempt + 1) : null;
      const b = secondHalf ? await tryPlaySingleChunk(secondHalf, voiceId, attempt + 1) : null;
      return a || b;
    }
    debugError('TTS: Error playing chunk', err, { textPreview: textChunk.substring(0, 80), voiceId, attempt });
    throw err;
  }
}
window.tryPlaySingleChunk = tryPlaySingleChunk;
