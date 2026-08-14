// --- TTS Queue and State ---
let ttsQueue = [];
let isCurrentlySpeaking = false; // a processNextTTSInQueue loop is currently running
let ttsPaused = false;           // user paused; do not auto-advance the queue
let ttsRunToken = 0;             // bumped by pause/stop to invalidate in-flight loops

// Set when a queued item belongs to an AI response, so we know to release
// isProcessing when the queue drains. Manual per-message playback must NOT
// release it — that used to advance the user message queue out of turn.
let pendingResponseCompletion = false;

// Releases the chat pipeline exactly once per AI response.
function releaseResponseCompletion() {
  if (!pendingResponseCompletion) return;
  pendingResponseCompletion = false;
  if (typeof window.onAIResponseFullyFinished === 'function') {
    window.onAIResponseFullyFinished();
  }
}

async function playTTS(fullText, languageCode, messageId = null, startIndex = 0, preloadedBuffer = null, notifyOnComplete = false) {
  if (!window.enableVoice) {
    debugLog('TTS: Ignoring playback request because voice is disabled.', 'info');
    if (notifyOnComplete && typeof window.onAIResponseFullyFinished === 'function') {
      window.onAIResponseFullyFinished();
    }
    return;
  }

  if (fullText) {
    debugLog(`TTS: Queuing request for language ${languageCode || 'default_en-US'}: "${fullText.toString().substring(0, 50)}..."`, 'info');
    ttsQueue.push({ fullText: fullText.toString(), languageCode: languageCode || 'en-US', messageId, startIndex, preloadedBuffer, notifyOnComplete });
  } else if (messageId) {
    // Retry/Resume flow: re-queue the existing message content
    const msgDiv = document.getElementById(messageId);
    if (!msgDiv) return;
    const textEl = msgDiv.querySelector('.message-original-text');
    if (!textEl) {
      debugLog(`TTS: Cannot resume ${messageId} — message text element not found.`, 'warn');
      return;
    }
    debugLog(`TTS: Resuming playback for message ${messageId} from index ${startIndex}`, 'info');
    ttsQueue.push({ fullText: textEl.textContent, languageCode: languageCode || 'en-US', messageId, startIndex, notifyOnComplete: false });
  } else {
    // Resume global queue if paused
    debugLog('TTS: Global resume triggered', 'info');
  }

  ttsPaused = false;
  processNextTTSInQueue();
}

// sequential processing
async function processNextTTSInQueue() {
  if (isCurrentlySpeaking || ttsPaused || ttsQueue.length === 0) return;

  if (!window.enableVoice) {
    debugLog('TTS: Clearing queued playback because voice is disabled.', 'info');
    ttsQueue = [];
    releaseResponseCompletion();
    return;
  }

  isCurrentlySpeaking = true;
  const myToken = ttsRunToken;
  const cancelled = () => myToken !== ttsRunToken;

  const currentTask = ttsQueue.shift();
  const { fullText, languageCode, messageId, startIndex, preloadedBuffer, notifyOnComplete } = currentTask;
  if (notifyOnComplete) pendingResponseCompletion = true;

  try {
    const langs = Array.isArray(window.languages) ? window.languages : [{ code: 'en-US', englishName: 'English (US)', defaultVoiceId: 'en_us_001' }];
    const langConfig = langs.find(l => l.code === languageCode) || langs.find(l => l.code === 'en-US') || langs[0];
    const voiceId = (typeof window.selectedVoiceId === 'string' && window.selectedVoiceId) || langConfig.defaultVoiceId || 'en_us_001';

    const cleanText = (typeof stripForTTS === 'function') ? stripForTTS(fullText) : String(fullText || '').trim();
    const sentences = (typeof splitIntoSentences === 'function') ? splitIntoSentences(cleanText) : [cleanText];

    // Group sentences into chunks based on window.ttsChunkLimit
    const chunks = [];
    let currentChunk = { text: '', indices: [] };
    const limit = window.ttsChunkLimit || 300;

    sentences.forEach((s, idx) => {
      if (idx < startIndex) return; // Skip if we are resuming from a specific sentence

      const sTrim = s.trim();
      if (!sTrim) return;

      if (currentChunk.text.length + sTrim.length > limit && currentChunk.text.length > 0) {
        chunks.push(currentChunk);
        currentChunk = { text: sTrim, indices: [idx] };
      } else {
        currentChunk.text += (currentChunk.text ? ' ' : '') + sTrim;
        currentChunk.indices.push(idx);
      }
    });
    if (currentChunk.text) chunks.push(currentChunk);

    debugLog(`TTS: Grouped ${sentences.length} sentences into ${chunks.length} chunks (limit: ${limit})`, 'info');

    let nextChunkPromise = null; // Look-ahead resolver (fetches only, never speaks)

    // Reported once per message rather than per chunk: a long reply is many
    // chunks, and per-chunk events would multiply analytics volume for no
    // extra insight.
    const providersUsed = new Set();
    let anyFellBack = false;

    for (let i = 0; i < chunks.length; i++) {
      if (cancelled()) break;

      const chunk = chunks[i];
      const chunkText = chunk.text;

      // Visual feedback: highlight all sentences in this chunk
      if (messageId) {
        chunk.indices.forEach(idx => highlightSentence(messageId, idx, true));
      }

      try {
        // Handle trigger for next ambient TTS preload on the last chunk
        if (i === chunks.length - 1 && window.isAmbientPreloadEnabled && window.ambientPreloadBuffer && !window.ambientPreloadTTSBuffer) {
          if (typeof window.preloadAmbientTTS === 'function') {
            window.preloadAmbientTTS(window.ambientPreloadBuffer.reply);
          }
        }

        // Use the descriptor resolved during the previous iteration, or the initial call
        let resolved = null;
        if (i === 0 && preloadedBuffer) {
          resolved = preloadedBuffer;
        } else if (nextChunkPromise) {
          try {
            resolved = await nextChunkPromise;
          } catch (e) {
            debugLog(`TTS: Preloaded chunk failed, will resolve on demand: ${e.message}`, 'warn');
            resolved = null;
          }
          nextChunkPromise = null;
        }

        // Kick off resolving the NEXT chunk before we start playing the current one.
        // fetchTTSBuffer never plays audio, so this cannot overlap with playback.
        if (i + 1 < chunks.length && !cancelled()) {
          debugLog(`TTS: Resolving next chunk [${i + 2}/${chunks.length}] in background...`, 'info');
          nextChunkPromise = fetchTTSBuffer(chunks[i + 1].text, voiceId);
          nextChunkPromise.catch(() => { /* handled at await; avoid unhandled rejection */ });
        }

        const used = await tryPlaySingleChunk(chunkText, voiceId, 0, resolved);
        if (used && used.provider) {
          providersUsed.add(used.provider);
          if (used.fellBack) anyFellBack = true;
        }
      } catch (err) {
        nextChunkPromise = null; // Discard any in-flight resolve on error
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
        debugError('TTS chunk playback failed', err, {
          chunkIndex: i,
          totalChunks: chunks.length,
          isRateLimit: isRateLimit,
          voiceId: voiceId,
          textPreview: chunkText.substring(0, 50)
        });

        // Show retry button on the UI to allow manual resumption
        if (messageId) {
          showRetryTTSButton(messageId, chunk.indices[0], languageCode);
        }

        if (typeof trackError === 'function') trackError('tts', err.status);

        if (isRateLimit) {
          debugLog('TTS: Rate limit hit. Pausing playback sequence. Click Resume to continue.', 'warn');
          ttsPaused = true;
          isCurrentlySpeaking = false;
          // Release the chat pipeline even though playback stopped early —
          // leaving isProcessing set here used to wedge the app permanently.
          releaseResponseCompletion();
          return;
        }
        break; // Non-rate-limit error: stop this message, let the queue continue
      }

      // Small pause between chunks for natural flow
      if (i < chunks.length - 1 && !cancelled()) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // Clear highlight when done
    if (messageId) highlightSentence(messageId, null);

    // One event per message. 'mixed' covers a reply that changed provider
    // partway through, which itself signals the primary going down mid-stream.
    if (providersUsed.size > 0 && typeof trackEvent === 'function') {
      const provider = providersUsed.size === 1 ? [...providersUsed][0] : 'mixed';
      trackEvent('tts_played', { provider, fell_back: anyFellBack });
    }

  } catch (e) {
    debugError('TTS Queue fatal error', e, { queueRemaining: ttsQueue.length, messageId: messageId });
  }

  isCurrentlySpeaking = false;

  if (ttsPaused) return;

  if (ttsQueue.length > 0) {
    processNextTTSInQueue();
  } else {
    releaseResponseCompletion();
  }
}

function pauseTTS() {
  debugLog('TTS: Pausing playback (stopping current audio, keeping queue)', 'info');
  ttsPaused = true;
  ttsRunToken++;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (window.currentAudio) {
    try { window.currentAudio.stop(); } catch (e) { /* already stopped */ }
    window.currentAudio = null;
  }
}

function stopTTS() {
  debugLog('TTS: Stopping all playback and clearing queue', 'info');
  ttsPaused = false;
  ttsRunToken++;
  ttsQueue = [];
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (window.currentAudio) {
    try {
      window.currentAudio.stop();
    } catch (e) {
      debugLog('TTS: Error stopping current audio source: ' + e.message, 'warn', true);
    }
    window.currentAudio = null;
  }
  // Clear any active highlights
  document.querySelectorAll('.sentence-highlight').forEach(el => el.classList.remove('sentence-highlight'));

  // A stopped response still has to release the chat pipeline.
  releaseResponseCompletion();
}

// Export functions to window for global access
window.playTTS = playTTS;
window.pauseTTS = pauseTTS;
window.stopTTS = stopTTS;
window.processNextTTSInQueue = processNextTTSInQueue;
