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
function playAudioBuffer(audioBuffer, label = '') {
  const audioContext = getTTSAudioContext();
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  currentAudio = source;

  let animationFrameId = null;

  const resetMouth = () => {
    const core = currentModel && currentModel.internalModel && currentModel.internalModel.coreModel;
    if (!core) return;
    core.setParameterValueById("ParamMouthOpenY", 0);
    core.setParameterValueById("ParamMouthForm", 0);
  };

  if (currentModel) {
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
      const normalizedVolume = Math.min(lastVolume / 128, 1);

      currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", normalizedVolume * 1.5);
      currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", normalizedVolume * 0.5 - 0.25);
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

// Picks a concrete SpeechSynthesisVoice for the requested voice config.
function selectBrowserVoice(voiceId) {
  const available = speechSynthesis.getVoices();
  const voiceConfig = voices.find(v => v.id === voiceId);
  const targetLang = (voiceConfig && voiceConfig.language) || 'en-US';
  const targetGender = (voiceConfig && voiceConfig.gender) || 'female';

  const baseLang = targetLang.split('-')[0];
  const langVoices = available.filter(v => v.lang.startsWith(baseLang));

  if (langVoices.length > 0) {
    const femaleKeywords = ['female', 'woman', 'girl', 'zira', 'hazel', 'susan', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'kate', 'victoria', 'princess', 'alice'];
    const maleKeywords = ['male', 'man', 'boy', 'david', 'mark', 'james', 'daniel', 'thomas', 'george', 'alex', 'fred', 'ralph'];
    const keywords = targetGender === 'female' ? femaleKeywords : maleKeywords;
    const genderMatch = langVoices.find(v => keywords.some(kw => v.name.toLowerCase().includes(kw)));
    return { voice: genderMatch || langVoices[0], lang: targetLang };
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
async function speakViaBrowser(textChunk, voiceId) {
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
    const { voice, lang } = selectBrowserVoice(voiceId);
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
        body: JSON.stringify({ text: textChunk, voice: voiceId })
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
    return { kind: 'browser', text: textChunk, voiceId, provider: 'browser', fellBack: false };
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
    await speakViaBrowser(resolved.text, resolved.voiceId);
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
