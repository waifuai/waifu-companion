// Modified to play from cached buffer
async function playCachedAudioBuffer(audioBuffer, text) {
  if (!audioBuffer || !text) return;
  
  debugLog(`TTS: Playing cached audio for: "${text.substring(0, 50)}..."`, 'info');

  const audioContext = getTTSAudioContext();
  let source = null;

  try {
    source = audioContext.createBufferSource();
    currentAudio = source; // Store current source for external stop capability

    const audioBufferSource = source;
    audioBufferSource.buffer = audioBuffer;

    let animationFrameId = null;
    if (currentModel) {
      const analyserNode = getTTSAnalyser(); 
      audioBufferSource.connect(analyserNode); 

      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let lastVolume = 0;
      const smoothingFactor = 0.3; 

      const updateMouth = () => {
        if (currentAudio !== source || !currentModel) { 
          cancelAnimationFrame(animationFrameId);
          if (currentModel && source.buffer) {
            if (!currentAudio || currentAudio.context.state === 'closed') {
              currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
              currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", 0);
            }
          }
          return;
        }
        analyserNode.getByteFrequencyData(dataArray);
        const vocalRange = dataArray.slice(10, 100); 
        const volume = vocalRange.reduce((acc, val) => acc + val, 0) / vocalRange.length;
        const smoothedVolume = lastVolume + (volume - lastVolume) * smoothingFactor;
        lastVolume = smoothedVolume;
        const normalizedVolume = Math.min(smoothedVolume / 128, 1); 

        currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", normalizedVolume * 1.5);
        currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", normalizedVolume * 0.5 - 0.25);
        animationFrameId = requestAnimationFrame(updateMouth);
      };
      updateMouth(); 
    } else {
      const gain = typeof getTTSGainNode === 'function' ? getTTSGainNode() : audioContext.destination;
      audioBufferSource.connect(gain);
    }
    
    await new Promise((resolve, reject) => {
      const audioDurationMs = audioBuffer.duration * 1000;
      const timeoutMs = Math.max(8000, audioDurationMs + 4000); 

      const timeoutId = setTimeout(() => {
        debugLog(`TTS: Playback timeout for cached audio after ${timeoutMs.toFixed(0)}ms`, 'warn');
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        
        if (currentModel && currentAudio === source) { 
          currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
          currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", 0);
        }
        try {
          if (source && (source.playbackState === source.PLAYING_STATE || source.playbackState === source.SCHEDULED_STATE)) {
            source.stop();
          }
        } catch(e) {
          debugLog("TTS: Error stopping source on timeout: " + e, "warn");
        }
        source.onended = null;
        reject(new Error(`TTS playback timeout for cached audio`));
      }, timeoutMs);

      audioBufferSource.onended = () => {
        clearTimeout(timeoutId);
        debugLog(`TTS: Cached audio playback finished`, 'info');
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        if (currentModel && currentAudio === source) { 
          currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
          currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", 0);
        }
        resolve();
      };
      audioBufferSource.start();
      debugLog(`TTS: Cached audio playback started. Duration: ${audioDurationMs.toFixed(0)}ms`, 'info');
    });

  } catch (err) {
    debugLog(`TTS: Error playing cached audio: ${err.message}`, 'error');
  } finally {
    if (currentAudio === source) { 
      currentAudio = null; 
    }
    if (source) {
      try { source.disconnect(); } catch (e) { /* ignore */ }
    }
  }
}

// Browser SpeechSynthesis provider - uses built-in browser TTS
// Plays audio directly through speakers (cannot capture as AudioBuffer)
async function browserSpeechSynthesisPlay(textChunk, voiceId) {
  if (!window.speechSynthesis) {
    debugLog('TTS: Browser SpeechSynthesis not available', 'error');
    return null;
  }

  // Ensure voices are loaded
  let availableVoices = speechSynthesis.getVoices();
  if (availableVoices.length === 0) {
    debugLog('TTS: Waiting for browser voices to load...', 'info');
    await new Promise((resolve) => {
      const wait = () => {
        availableVoices = speechSynthesis.getVoices();
        if (availableVoices.length > 0) {
          resolve();
        } else {
          setTimeout(wait, 100);
        }
      };
      wait();
      // Safety timeout
      setTimeout(resolve, 3000);
    });
  }

  debugLog(`TTS: Using browser SpeechSynthesis for: "${textChunk.substring(0, 50)}..."`, 'info');

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(textChunk);

    // Determine language and gender from voice config
    const voiceConfig = voices.find(v => v.id === voiceId);
    const targetLang = voiceConfig ? (voiceConfig.language || 'en-US') : 'en-US';
    const targetGender = voiceConfig ? (voiceConfig.gender || 'female') : 'female';
    utterance.lang = targetLang;

    // Refresh voices after potential wait
    availableVoices = speechSynthesis.getVoices();
    const baseLang = targetLang.split('-')[0];
    
    // Filter voices matching the language
    const langVoices = availableVoices.filter(v => v.lang.startsWith(baseLang));
    
    if (langVoices.length > 0) {
      // Try to find a voice matching the requested gender by checking name keywords
      const femaleKeywords = ['female', 'woman', 'girl', 'zira', 'hazel', 'susan', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'kate', 'victoria', 'princess', 'alice'];
      const maleKeywords = ['male', 'man', 'boy', 'david', 'mark', 'james', 'daniel', 'thomas', 'george', 'alex', 'fred', 'ralph'];
      
      const keywords = targetGender === 'female' ? femaleKeywords : maleKeywords;
      const genderMatch = langVoices.find(v => 
        keywords.some(kw => v.name.toLowerCase().includes(kw))
      );
      
      utterance.voice = genderMatch || langVoices[0];
      debugLog(`TTS: Selected browser voice: "${utterance.voice.name}" (lang: ${utterance.voice.lang})`, 'info');
    } else if (availableVoices.length > 0) {
      // No language match, just use first available
      utterance.voice = availableVoices[0];
      debugLog(`TTS: No lang match, using default browser voice: "${utterance.voice.name}"`, 'warn');
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      debugLog('TTS: Browser SpeechSynthesis playback finished', 'info');
      resolve('__SPEECH_SYNTHESIS_PLAYED__');
    };
    utterance.onerror = (e) => {
      debugLog(`TTS: Browser SpeechSynthesis error: ${e.error}`, 'error');
      resolve(null);
    };

    speechSynthesis.speak(utterance);
  });
}

async function fetchTTSBuffer(textChunk, voiceId) {
  if (!textChunk.trim()) return null;

  debugLog(`TTS: === fetchTTSBuffer START ===`, 'info');
  debugLog(`TTS: Input text: "${textChunk.substring(0, 100)}..."`, 'info');
  debugLog(`TTS: Input voiceId: "${voiceId}"`, 'info');

  const voiceConfig = voices.find(v => v.id === voiceId);
  const provider = voiceConfig ? voiceConfig.provider : 'tiktok';
  debugLog(`TTS: Resolved provider: "${provider}" for voiceId: "${voiceId}"`, 'info');
  debugLog(`TTS: Voice config found: ${voiceConfig ? JSON.stringify(voiceConfig) : 'NOT FOUND'}`, 'info');
  
  const audioContext = getTTSAudioContext();
  debugLog(`TTS: AudioContext state: ${audioContext.state}`, 'info');

  const CORS_PROXY = 'https://corsproxy.io/?';
  
  async function fetchWithProxy(apiUrl, options) {
    try {
      const url = CORS_PROXY + encodeURIComponent(apiUrl);
      debugLog(`TTS: Using proxy: ${CORS_PROXY}`, 'info');
      const response = await fetch(url, options);
      debugLog(`TTS: Proxy responded with status: ${response.status}`, 'info');
      return response;
    } catch (err) {
      debugLog(`TTS: Proxy failed: ${err.name} - ${err.message}`, 'warn');
      throw err;
    }
  }

  if (provider === 'tiktok') {
    const apiUrl = "https://ottsy.weilbyte.dev/api/generation";
    debugLog(`TTS: === TikTok TTS Flow START ===`, 'info');
    debugLog(`TTS: API URL: ${apiUrl}`, 'info');
    
    let response;
    try {
      const fetchOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textChunk, voice: voiceId })
      };
      debugLog(`TTS: Request options: method=${fetchOptions.method}, body=${JSON.stringify(fetchOptions.body).substring(0, 100)}...`, 'info');
      response = await fetchWithProxy(apiUrl, fetchOptions);
    } catch (fetchErr) {
      debugLog(`TTS: Proxy failed: ${fetchErr.message}`, 'error');
      return null;
    }
    
    debugLog(`TTS: Response status: ${response.status}`, 'info');
    debugLog(`TTS: Response headers: ${JSON.stringify([...response.headers.entries()].reduce((acc, [k,v]) => {acc[k]=v; return acc;}, {}))}`, 'info');
    
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(`TikTok TTS error ${response.status}: ${errorText.slice(0, 200)}`);
      err.status = response.status;
      debugLog(`TTS: TikTok TTS error response: ${errorText.slice(0, 200)}`, 'error');
      return null;
    }
    
    const json = await response.json();
    debugLog(`TTS: TikTok TTS response JSON: ${JSON.stringify(json).substring(0, 200)}`, 'info');
    if (json.success === false) {
      debugLog(`TTS: TikTok API returned error: ${json.error || 'Unknown error'}`, 'warn');
      return null;
    }
    
    const audioData = json.data || json.audio || json;
    if (!audioData) {
      debugLog(`TTS: TikTok TTS returned no audio data`, 'error');
      return null;
    }
    
    let audioBuffer;
    try {
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
      debugLog(`TTS: TikTok TTS audio decoded successfully, duration: ${audioBuffer.duration.toFixed(2)}s`, 'info');
      return audioBuffer;
    } catch (decodeErr) {
      debugLog(`TTS: TikTok TTS audio decode failed: ${decodeErr.message}`, 'error');
      return null;
    }
  }

  let primaryFailed = false;

  // 1. Try Primary Voice if Enabled
  if (window.enablePrimaryVoice !== false) {
    try {
      if (provider === 'browser') {
        return await browserSpeechSynthesisPlay(textChunk, voiceId);
      }

      // Use the TikTok TTS API
      debugLog(`TTS: Attempting Primary TTS for voice: ${voiceId}`, 'info');
      
      // Already handled above for tiktok, handle browser here
      if (provider === 'tiktok') {
        // This should have been handled above, but just in case
        throw new Error('TikTok TTS should have been handled above');
      }
      
      primaryFailed = true;
    } catch (err) {
      debugLog(`TTS: Primary API failed or rate limit: ${err.message}.`, 'warn');
      primaryFailed = true;
    }
  } else {
    debugLog(`TTS: Primary voice disabled.`, 'info');
    primaryFailed = true;
  }

  // 2. Try Kokoro if primary failed or was disabled
  if (primaryFailed) {
    if (window.enableKokoro && window.isKokoroReady && typeof window.generateKokoroAudioBuffer === 'function') {
      try {
        debugLog(`TTS: Local Kokoro taking over for: "${textChunk.substring(0, 50)}..."`, 'info');
        const kokoroBuffer = await window.generateKokoroAudioBuffer(textChunk, window.selectedKokoroVoiceId || "af_heart");
        if (kokoroBuffer) return kokoroBuffer;
      } catch (kokoroErr) {
        debugLog(`TTS: Local Kokoro generation failed: ${kokoroErr.message}`, 'error');
      }
    } else if (window.enableKokoro && !window.isKokoroReady) {
      debugLog("TTS: Local Kokoro is still preloading in the background. Skipping to browser TTS safety net.", "info");
    }

    // 3. Fallback if Kokoro failed, wasn't ready, or was disabled
    if (window.enableFallbackVoice === false) {
      debugLog(`TTS: Fallback voice disabled. Skipping playback.`, 'warn');
      return null;
    }

    debugLog(`TTS: Falling back to browser SpeechSynthesis...`, 'info');
    const fallbackId = window.ttsFallbackVoiceId || 'browser-female';
    return await browserSpeechSynthesisPlay(textChunk, fallbackId);
  }
  
  return null;
}
window.fetchTTSBuffer = fetchTTSBuffer;

async function tryPlaySingleChunk(textChunk, voiceId, attempt = 0, preloadedBuffer = null) {
    const MAX_SPLIT_ATTEMPTS = 5;
    if (attempt > MAX_SPLIT_ATTEMPTS) {
        debugLog(`TTS: Chunk too long after splits: "${textChunk.substring(0,30)}..."`, 'error');
        return;
    }

    if (!textChunk.trim()) return;
    
    debugLog(`TTS: Attempting to play chunk (attempt ${attempt + 1}): "${textChunk.substring(0, 100)}..." with voice ${voiceId}`, 'info');

    const audioContext = getTTSAudioContext();
    let source = null; 

    try {
        let audioBuffer = preloadedBuffer;
        
        if (!audioBuffer) {
            audioBuffer = await fetchTTSBuffer(textChunk, voiceId);
        }

        // If browser SpeechSynthesis was used as fallback, it already played directly
        if (audioBuffer === '__SPEECH_SYNTHESIS_PLAYED__') {
            debugLog(`TTS: Chunk played via browser SpeechSynthesis, skipping AudioBuffer playback`, 'info');
            return;
        }

        if (!audioBuffer) {
            debugLog(`TTS: fetchTTSBuffer returned null, skipping chunk: "${textChunk.substring(0,30)}..."`, 'warn');
            return;
        }

        source = audioContext.createBufferSource();
        currentAudio = source; // Store current source for external stop capability

        const audioBufferSource = source;
        audioBufferSource.buffer = audioBuffer;

        let animationFrameId = null;
        if (currentModel) {
            const analyserNode = getTTSAnalyser(); 
            audioBufferSource.connect(analyserNode); 
            // analyserNode is already connected to destination by getTTSAnalyser if it was (re)created.

            const bufferLength = analyserNode.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            let lastVolume = 0;
            const smoothingFactor = 0.3; 

            const updateMouth = () => {
                // Check if this specific source is still the one playing AND the model exists
                if (currentAudio !== source || !currentModel) { 
                    cancelAnimationFrame(animationFrameId);
                    // Optionally reset mouth here if this was the active source
                    if (currentModel && source.buffer) { // Check source.buffer to ensure it was a playing source
                         // Check if this was the last playing audio for this model instance
                        if (!currentAudio || currentAudio.context.state === 'closed') {
                           currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
                           currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", 0);
                        }
                    }
                    return;
                }
                analyserNode.getByteFrequencyData(dataArray);
                const vocalRange = dataArray.slice(10, 100); 
                const volume = vocalRange.reduce((acc, val) => acc + val, 0) / vocalRange.length;
                const smoothedVolume = lastVolume + (volume - lastVolume) * smoothingFactor;
                lastVolume = smoothedVolume;
                const normalizedVolume = Math.min(smoothedVolume / 128, 1); 

                currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", normalizedVolume * 1.5);
                currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", normalizedVolume * 0.5 - 0.25);
                animationFrameId = requestAnimationFrame(updateMouth);
            };
            updateMouth(); 
        } else {
            audioBufferSource.connect(audioContext.destination); // Connect directly if no model for analysis
        }
        
        await new Promise((resolve, reject) => {
            const audioDurationMs = audioBuffer.duration * 1000; // duration is in seconds
            const timeoutMs = Math.max(8000, audioDurationMs + 4000); 

            const timeoutId = setTimeout(() => {
                debugLog(`TTS: Playback timeout for chunk after ${timeoutMs.toFixed(0)}ms. Stopping source. Chunk: "${textChunk.substring(0,30)}..."`, 'warn');
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                
                if (currentModel && currentAudio === source) { 
                    currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
                    currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", 0);
                }
                try {
                  if (source && (source.playbackState === source.PLAYING_STATE || source.playbackState === source.SCHEDULED_STATE)) {
                    source.stop();
                  }
                } catch(e) {
                  debugLog("TTS: Error stopping source on timeout: " + e, "warn");
                }
                source.onended = null; // Prevent late firing of onended
                // currentAudio is cleared in finally
                reject(new Error(`TTS playback timeout for chunk: ${textChunk.substring(0,30)}...`));
            }, timeoutMs);

            audioBufferSource.onended = () => {
                clearTimeout(timeoutId);
                debugLog(`TTS: Playback of chunk finished (onended): "${textChunk.substring(0,30)}..."`, 'info');
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                if (currentModel && currentAudio === source) { 
                    currentModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
                    currentModel.internalModel.coreModel.setParameterValueById("ParamMouthForm", 0);
                }
                // currentAudio is cleared in the finally block after this promise resolves
                resolve();
            };
            audioBufferSource.start();
            debugLog(`TTS: Playback of chunk started. Estimated duration: ${audioDurationMs.toFixed(0)}ms. Timeout set for ${timeoutMs.toFixed(0)}ms. Chunk: "${textChunk.substring(0,30)}..."`, 'info');
        });

    } catch (err) {
        debugLog(`TTS: Error playing chunk "${textChunk.substring(0,50)}...": ${err.message}`, 'error');
        // Check if error is due to text length and we haven't exhausted attempts
        // This specific check for "text too long" in err.message is a fallback, 
        // primary check is via API response status 500 earlier.
        if (err.message && err.message.toLowerCase().includes("text too long") && attempt < MAX_SPLIT_ATTEMPTS) {
            debugLog(`TTS: Caught 'Text too long' error during processing. Splitting chunk. Attempt ${attempt + 1}`, 'warn');
            const halfPoint = Math.floor(textChunk.length / 2);
            let splitPoint = textChunk.lastIndexOf(' ', halfPoint);
            if (splitPoint === -1 || splitPoint === 0) splitPoint = halfPoint;

            const firstHalf = textChunk.substring(0, splitPoint);
            const secondHalf = textChunk.substring(splitPoint).trim();
            
            // Clean up current source before recursive call if it exists
            if (source) { try { source.disconnect(); } catch(e){} }
            if (currentAudio === source) currentAudio = null;


            if (firstHalf) await tryPlaySingleChunk(firstHalf, voiceId, attempt + 1);
            if (secondHalf) await tryPlaySingleChunk(secondHalf, voiceId, attempt + 1);
            return;
        }
        // For other errors or if max attempts reached, the error propagates up allowing playTTS to continue
    } finally {
        if (currentAudio === source) { 
            currentAudio = null; 
        }
        if (source) { // Disconnect the source node as it's one-time use
            try { source.disconnect(); } catch (e) { /* ignore */ }
        }
        // Do not close the shared audioContext here
    }
}

// Export functions to window for global access
window.playCachedAudioBuffer = playCachedAudioBuffer;
window.tryPlaySingleChunk = tryPlaySingleChunk;