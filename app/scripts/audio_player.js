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

function playAudioBuffer(audioBuffer, label = '', onStart = () => {}) {
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
    onStart();
    debugLog(`TTS: Playback started (${audioDurationMs.toFixed(0)}ms)${label ? `: "${label}"` : ''}`, 'info');
  });

  return playback.finally(() => {
    if (currentAudio === source) currentAudio = null;
    try { source.disconnect(); } catch (e) { /* ignore */ }
  });
}
window.playAudioBuffer = playAudioBuffer;

// One language plan for a completed spoken reply, shared by all its chunks.
const ttsLanguageState = window.TTSLanguageRouter ? window.TTSLanguageRouter.create() : null;
function ttsConversationKey() {
  return window.ChatManager ? window.ChatManager.getActiveChatId() || 'default' : 'default';
}
function ttsRoutingFingerprint() {
  return JSON.stringify([window.enablePrimaryVoice !== false, !!window.enableKokoro, window.enableFallbackVoice !== false, window.selectedKokoroVoiceId || '', window.ttsFallbackVoiceId || '']);
}
function ttsRoutingAuto(){return window.enableAutoTtsLang!==false;}
function prepareTTSRouting(text, force = false) {
  if (!ttsLanguageState) return null;
  const speech = typeof stripForTTS === 'function' ? stripForTTS(text) : text;
  return ttsLanguageState.prepare(speech, { key: ttsConversationKey(), voiceId: window.selectedVoiceId || 'cloud', voices,
    auto: ttsRoutingAuto(), enabled: window.selectedVoiceId!=='none' && (force || !!window.enableVoice), fingerprint: ttsRoutingFingerprint() });
}
function finishTTSRouting(plan, request, valid = () => true) {
  return plan && ttsLanguageState ? ttsLanguageState.settle(plan, request, 'live2d_tts_language_v1', valid) : Promise.resolve(plan);
}
async function getTTSRouting(text, provided = null, valid = () => true) {
  let plan = provided ? await provided : prepareTTSRouting(text);
  const voiceId = window.selectedVoiceId || 'cloud';
  const signature = JSON.stringify([ttsConversationKey(), voiceId, ttsRoutingAuto(), ttsRoutingFingerprint()]);
  if (plan && plan.signature !== signature) plan = prepareTTSRouting(text);
  if (plan && plan.needsDecision && !plan.finished && !plan.pending && valid()) {
    // The retired decision service is gone: settle with no request so the
    // router keeps its locally detected language. No network attempt.
    plan = await finishTTSRouting(plan, null, valid);
  } else if (plan && plan.pending && !plan.finished) plan = await plan.pending;
  return plan;
}
function detectVoiceLang(text) {
  const a = window.TTSLanguageRouter && window.TTSLanguageRouter.analyze(text);
  return a && a.reason === 'dominant-script' ? window.TTSLanguageRouter.base(a.lang) : null;
}
function detectLatinVoiceLang(text) {
  const a = window.TTSLanguageRouter && window.TTSLanguageRouter.analyze(text);
  return a && a.strong && a.reason !== 'dominant-script' ? window.TTSLanguageRouter.base(a.lang) : null;
}
function resolveVoiceForText(text, voiceId, plan = null) {
  if (!window.TTSLanguageRouter) return { voiceId, lang: null };
  const a = plan || window.TTSLanguageRouter.analyze(text);
  const routed = window.TTSLanguageRouter.selectVoice(voices, voiceId, a.lang, window.enableAutoTtsLang !== false);
  return { voiceId: routed.voiceId, lang: routed.lang };
}
window.detectVoiceLang = detectVoiceLang;
window.detectLatinVoiceLang = detectLatinVoiceLang;
window.resolveVoiceForText = resolveVoiceForText;
window.prepareTTSRouting = prepareTTSRouting;
window.finishTTSRouting = finishTTSRouting;
window.getTTSRouting = getTTSRouting;

// Picks a concrete SpeechSynthesisVoice for the requested voice config.
// langOverride (BCP47) wins over the voice config's own language when a reply's script was detected.
function selectBrowserVoice(voiceId, langOverride) {
  const available = speechSynthesis.getVoices();
  const voiceConfig = voices.find(v => v.id === voiceId);
  let targetLang = langOverride || (voiceConfig && voiceConfig.language) || 'en-US';
  const targetGender = (voiceConfig && voiceConfig.gender) || 'female';

  const baseLang = targetLang.split('-')[0];
  let langVoices = available.filter(v => v.lang.toLowerCase().split('-')[0] === baseLang.toLowerCase());
  if (!langVoices.length && voiceConfig && langOverride) {
    targetLang = voiceConfig.language;
    langVoices = available.filter(v => v.lang.toLowerCase().split('-')[0] === targetLang.split('-')[0].toLowerCase());
  }

  if (langVoices.length > 0) {
    const voice = window.TTSLanguageRouter.browserVoiceForGender(langVoices, targetGender);
    return { voice, lang: targetLang, unsupported: !voice };
  }
  return { voice: null, lang: targetLang, unsupported: true };
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
async function speakViaBrowser(textChunk, voiceId, langOverride, valid = () => true, onStart = () => {}) {
  if (!valid()) return { played: false };
  if (!window.speechSynthesis) {
    debugLog('TTS: Browser SpeechSynthesis not available', 'error');
    return;
  }
  if (window.enableFallbackVoice === false) {
    debugLog('TTS: Browser SpeechSynthesis blocked because fallback voice is disabled', 'info');
    return;
  }

  await waitForBrowserVoices();
  if (!valid()) return { played: false };
  const selectedBrowserVoice = selectBrowserVoice(voiceId, langOverride);
  if (selectedBrowserVoice.unsupported) return { lang: null, played: false };
  debugLog(`TTS: Speaking via browser SpeechSynthesis: "${textChunk.substring(0, 50)}..."`, 'info');

  await new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(textChunk);
    const { voice, lang } = selectedBrowserVoice;
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
    utterance.onstart = () => { if(valid()) onStart(); };
    utterance.onerror = (e) => done(`error: ${e.error}`);

    speechSynthesis.speak(utterance);
  });
  return { lang: selectedBrowserVoice.lang, played: true };
}
window.speakViaBrowser = speakViaBrowser;

// Resolves a chunk to a playable descriptor WITHOUT producing any sound.
// Returns {kind:'buffer', buffer} | {kind:'browser', text, voiceId} | null.
// Throws on primary-provider errors (with err.status set where known) so the
// queue manager can see rate limits and pause instead of silently dropping
// the chunk.
async function fetchTTSBuffer(textChunk, voiceId, routingPlan = null) {
  if (voiceId==='none' || !textChunk.trim()) return null;

  debugLog(`TTS: === fetchTTSBuffer START ===`, 'info');
  debugLog(`TTS: Input text: "${textChunk.substring(0, 100)}..."`, 'info');
  debugLog(`TTS: Input voiceId: "${voiceId}"`, 'info');

  const voiceConfig = voices.find(v => v.id === voiceId);
  // Cloud voices are retired. A saved 'cloud' or 'cloud:<id>' choice now
  // resolves to the browser voice for the reply's language.
  const legacyCloudId = voiceId === 'cloud' || /^cloud:/.test(voiceId);
  const provider = voiceConfig ? voiceConfig.provider : 'browser';
  let routingLang = routingPlan ? routingPlan.lang
    : (window.TTSLanguageRouter ? window.TTSLanguageRouter.analyze(textChunk).lang : null);
  // A pinned voice keeps its identity. Detect the text language independently,
  // without adding a decision when automatic routing is disabled.
  if (!routingLang && legacyCloudId && window.TTSLanguageRouter) routingLang = window.TTSLanguageRouter.analyze(textChunk).lang;

  let routed = null;
  if (provider !== 'kokoro' && window.TTSLanguageRouter) {
    routed = window.TTSLanguageRouter.selectVoice(voices, voiceId, routingLang, window.enableAutoTtsLang !== false);
    if (routed.unsupportedPrimary && !legacyCloudId) return null;
  }

  const explicitBrowser = provider === 'browser' && voiceId !== 'cloud' && !legacyCloudId;
  if (explicitBrowser) {
    return { kind: 'browser', text: textChunk, voiceId, lang: routed ? routed.lang : routingLang,
      provider: 'browser', fellBack: false, routingSignature: routingPlan && routingPlan.signature };
  }

  // A saved legacy cloud id follows the primary/fallback toggles: with both
  // off the user is muted; with only the primary off the chosen fallback voice
  // speaks. An explicit browser choice above ignores the primary checkbox.
  let manualFallbackVoice = null;
  if (window.enablePrimaryVoice === false) {
    if (window.enableFallbackVoice === false) return null;
    manualFallbackVoice = window.ttsFallbackVoiceId || 'browser-female';
  }

  if (provider === 'browser') {
    return { kind: 'browser', text: textChunk, voiceId: manualFallbackVoice || voiceId,
      lang: routed ? routed.lang : routingLang, provider: 'browser', fellBack: !!manualFallbackVoice,
      routingSignature: routingPlan && routingPlan.signature };
  }

  // Local Kokoro (ONNX). No request leaves the device.
  if ((!routingLang || routingLang.split('-')[0] === 'en') && window.enableKokoro && window.isKokoroReady && typeof window.generateKokoroAudioBuffer === 'function') {
    try {
      const kokoroVoice = provider === 'kokoro' ? voiceId : window.selectedKokoroVoiceId || 'af_heart';
      const kokoroBuffer = await window.generateKokoroAudioBuffer(textChunk, kokoroVoice);
      if (kokoroBuffer) return { kind: 'buffer', buffer: kokoroBuffer, voiceId: kokoroVoice, lang: (voices.find(v => v.id === kokoroVoice) || {}).language || 'en-US', provider: 'kokoro', fellBack: false, routingSignature: routingPlan && routingPlan.signature };
    } catch (kokoroErr) {
      debugLog(`TTS: Local Kokoro generation failed: ${kokoroErr.message}`, 'error');
    }
  } else if (window.enableKokoro && !window.isKokoroReady) {
    debugLog('TTS: Local Kokoro still preloading. Skipping speech.', 'info');
  }

  if (manualFallbackVoice) {
    return { kind: 'browser', text: textChunk, voiceId: manualFallbackVoice, lang: routingLang, provider: 'browser', fellBack: false, routingSignature: routingPlan && routingPlan.signature };
  }
  // A saved Kokoro selection that is not ready falls back to browser speech
  // when the fallback voice is enabled, instead of leaving the reply silent.
  if (provider === 'kokoro' && window.enableFallbackVoice !== false) {
    return { kind: 'browser', text: textChunk, voiceId: window.ttsFallbackVoiceId || 'browser-female', lang: routingLang, provider: 'browser', fellBack: true, routingSignature: routingPlan && routingPlan.signature };
  }
  return null;
}
window.fetchTTSBuffer = fetchTTSBuffer;

// Plays an already-resolved chunk descriptor.
async function playResolvedChunk(resolved, label = '', valid = () => true, onStart = () => {}) {
  if (!valid()) return;
  if (!resolved) {
    debugLog(`TTS: Nothing to play, skipping chunk: "${label.substring(0, 30)}..."`, 'warn');
    return;
  }
  if (resolved.kind === 'browser') {
    const played = await speakViaBrowser(resolved.text, resolved.voiceId, resolved.lang, valid, () => onStart(resolved));
    resolved.skipped = !played || !played.played;
    if (played && played.lang) resolved.lang = played.lang;
    return;
  }
  await playAudioBuffer(resolved.buffer, label, () => onStart(resolved));
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
async function tryPlaySingleChunk(textChunk, voiceId, attempt = 0, preloaded = null, routingPlan = null, valid = () => true, onStart = () => {}) {
  const MAX_SPLIT_ATTEMPTS = 5;
  if (attempt > MAX_SPLIT_ATTEMPTS) {
    debugLog(`TTS: Chunk too long after splits: "${textChunk.substring(0, 30)}..."`, 'error');
    return null;
  }
  if (!textChunk.trim()) return null;

  debugLog(`TTS: Playing chunk (attempt ${attempt + 1}): "${textChunk.substring(0, 100)}..." with voice ${voiceId}`, 'info');

  try {
    const resolved = preloaded || await fetchTTSBuffer(textChunk, voiceId, routingPlan);
    if (!valid()) return null;
    await playResolvedChunk(resolved, textChunk.substring(0, 30), valid, onStart);
    if (!valid()) return null;
    return resolved;
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('text too long') && attempt < MAX_SPLIT_ATTEMPTS) {
      debugLog(`TTS: 'Text too long' — splitting chunk. Attempt ${attempt + 1}`, 'warn');
      const halfPoint = Math.floor(textChunk.length / 2);
      let splitPoint = textChunk.lastIndexOf(' ', halfPoint);
      if (splitPoint <= 0) splitPoint = halfPoint;

      const firstHalf = textChunk.substring(0, splitPoint);
      const secondHalf = textChunk.substring(splitPoint).trim();
      const a = firstHalf && valid() ? await tryPlaySingleChunk(firstHalf, voiceId, attempt + 1, null, routingPlan, valid, onStart) : null;
      const b = secondHalf && valid() ? await tryPlaySingleChunk(secondHalf, voiceId, attempt + 1, null, routingPlan, valid, onStart) : null;
      return a || b;
    }
    debugError('TTS: Error playing chunk', err, { textPreview: textChunk.substring(0, 80), voiceId, attempt });
    throw err;
  }
}
window.tryPlaySingleChunk = tryPlaySingleChunk;
