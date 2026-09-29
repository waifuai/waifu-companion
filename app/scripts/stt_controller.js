/**
 * Speech-to-text controller for the chat mic button.
 *
 * Two engines are supported and selectable in Settings > Voice:
 *  - 'webspeech': browser Web Speech API (continuous dictation, interim results).
 *  - 'proxy'    : records the mic with MediaRecorder and transcribes through the
 *                 WaifuAI Cloud. Works in browsers
 *                 and embedded environments that lack the
 *                 Web Speech API.
 *
 * Mic button gestures (both engines):
 *  - press and hold: records while held, stops on release (push-to-talk).
 *  - quick tap: starts and keeps recording until the next tap.
 *  - keyboard (Enter/Space): toggles, same as a tap.
 * The button and the message box placeholder show which state it is in:
 * starting (waiting on mic permission / the recognizer), listening, and
 * transcribing (cloud engine only).
 */
(function(){
  let recognition = null;
  window.sttFinalTranscript = '';

  // Proxy recording state
  let mediaStream = null;
  let mediaRecorder = null;
  let mediaChunks = [];
  let proxyRecording = false;
  let proxyStartedAt = 0;
  let discardProxyRecording = false; // stopped before it really began: don't transcribe

  // A press shorter than this is a tap (toggle); longer is push-to-talk.
  const HOLD_THRESHOLD_MS = 300;
  // Cloud recordings shorter than this are accidental and never uploaded.
  const MIN_PROXY_RECORDING_MS = 400;

  // 'idle' | 'starting' | 'listening' | 'transcribing'
  let micState = 'idle';
  // 'hold' while the button is held down, 'tap' once it's latched on
  let micMode = 'tap';
  let restingPlaceholder = null;

  const FALLBACK_STRINGS = {
    micIdleTitle: 'Voice input: hold to talk, or tap to start/stop',
    micStartingPlaceholder: 'Starting microphone...',
    micHoldPlaceholder: 'Listening... release to stop',
    micTapPlaceholder: 'Listening... tap the mic again to stop',
    micTranscribingPlaceholder: 'Transcribing...'
  };

  function uiString(key) {
    return (typeof window.getUIString === 'function' && window.getUIString(key)) || FALLBACK_STRINGS[key] || '';
  }

  function listeningPlaceholder() {
    return uiString(micMode === 'hold' ? 'micHoldPlaceholder' : 'micTapPlaceholder');
  }

  function getRecognition() {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return null;
      const rec = new SR();
      rec.continuous = true; // Enable continuous mode for longer inputs
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      return rec;
    } catch (e) {
      return null;
    }
  }

  function getSttEngine() {
    return window.sttEngine === 'proxy' ? 'proxy' : 'webspeech';
  }

  function isProxyConfigured() {
    return typeof window.WaifuProxyAPI?.transcribeAudio === 'function';
  }

  // Single place that reflects the recording state in the UI.
  function setMicState(state) {
    micState = state;
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.classList.toggle('starting', state === 'starting');
      micBtn.classList.toggle('active', state === 'listening');
      micBtn.classList.toggle('transcribing', state === 'transcribing');
      micBtn.setAttribute('aria-pressed', String(state === 'starting' || state === 'listening'));
      micBtn.title = state === 'idle' ? uiString('micIdleTitle')
        : state === 'transcribing' ? uiString('micTranscribingPlaceholder')
        : listeningPlaceholder();
    }

    const input = window.messageInput;
    if (!input) return;
    if (state === 'idle') {
      if (restingPlaceholder !== null) input.placeholder = restingPlaceholder;
      restingPlaceholder = null;
      return;
    }
    if (restingPlaceholder === null) restingPlaceholder = input.placeholder;
    input.placeholder = state === 'starting' ? uiString('micStartingPlaceholder')
      : state === 'transcribing' ? uiString('micTranscribingPlaceholder')
      : listeningPlaceholder();
  }

  // The UI translator rewrote the message box placeholder: that's the new
  // resting text, and the live mic state goes back on top of it.
  window.onMessageInputPlaceholderChanged = function() {
    if (micState === 'idle' || !window.messageInput) return;
    restingPlaceholder = window.messageInput.placeholder;
    setMicState(micState);
  };

  function hideMicButton(micBtn) {
    micBtn.style.display = 'none';
    // The welcome hint shouldn't advertise a mic that isn't there.
    document.querySelectorAll('.welcome-hint-mic').forEach(el => el.remove());
  }

  function appendToInput(text) {
    if (!window.messageInput) return;
    const current = window.messageInput.value ? window.messageInput.value + ' ' : '';
    window.messageInput.value = (current + text).trim();
  }

  function switchEnginePreference(engine) {
    window.sttEngine = engine;
    const sel = document.getElementById('sttEngineSelector');
    if (sel) sel.value = engine;
    if (typeof handleSttEngineChange === 'function') handleSttEngineChange({ target: { value: engine } });
  }

  // ---------------- Web Speech API engine ----------------
  function stopWebSpeech() {
    if (!recognition) return;
    // Still spinning up: abort, since there's nothing to finalize yet.
    if (micState === 'starting') recognition.abort();
    else recognition.stop();
  }

  function startWebSpeech() {
    if (!recognition) {
      debugLog('STT: Recognition not available.', 'error');
      return;
    }

    try {
      recognition.lang = (window.selectedLanguageCode || 'en-US');
    } catch (e) { /* noop */ }

    try {
      setMicState('starting');
      recognition.start();
      if (typeof trackEvent === 'function') trackEvent('voice_input_used');
    } catch (e) {
      setMicState('idle');
      debugError('STT failed to start recognition', e, { lang: recognition?.lang });
    }
  }

  function initWebSpeech(micBtn) {
    recognition = getRecognition();
    if (!recognition) {
      // Web Speech unavailable: WaifuAI Cloud can still take over, so only
      // hide the button when the proxy path is not usable either.
      if (!isProxyConfigured()) {
        hideMicButton(micBtn);
        debugLog('STT: Web Speech API not supported in this browser. Hiding mic button.', 'info');
      } else {
        debugLog('STT: Web Speech API not supported; WaifuAI Cloud will be used.', 'info');
      }
      return false;
    }

    recognition.onstart = () => {
      setMicState('listening');
      // Initialize with current input value but don't double up
      window.sttFinalTranscript = window.messageInput.value ? window.messageInput.value + ' ' : '';
      debugLog('STT: Recognition started.', 'info');
    };
    recognition.onerror = (e) => {
      setMicState('idle');
      debugError('STT error', e, {
        errorCode: e.error,
        errorMessage: e.message || 'N/A',
        lang: recognition?.lang
      });
      // If the browser lacks the speech backend,
      // fall back to the proxy engine instead of leaving a dead button.
      if (e.error === 'service-not-allowed') {
        if (isProxyConfigured()) {
          switchEnginePreference('proxy');
          debugLog('STT: Web Speech service unavailable. Switching to WaifuAI Cloud.', 'warn');
        } else {
          hideMicButton(micBtn);
          debugLog('STT: Service not allowed / unavailable. Hiding mic button.', 'warn');
        }
      } else if (e.error === 'not-allowed') {
        addMessage('Microphone permission denied. Enable it in your browser settings to use voice input.', false);
      }
    };
    recognition.onend = () => {
      setMicState('idle');
      // Final text is already in the input field, just ensure it's set
      if (window.messageInput && window.sttFinalTranscript) {
          window.messageInput.value = window.sttFinalTranscript.trim();
      }
      debugLog('STT: Recognition ended.', 'info');
    };
    recognition.onresult = (event) => {
      let interim_transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          window.sttFinalTranscript += event.results[i][0].transcript;
        } else {
          interim_transcript += event.results[i][0].transcript;
        }
      }
      
      if (window.messageInput) {
        // Show interim results being appended to the final transcript
        window.messageInput.value = (window.sttFinalTranscript + interim_transcript).trim();
      }
    };
    return true;
  }

  // ---------------- Proxy WaifuAI Cloud (MediaRecorder -> /transcribe) ----------------
  async function startProxyRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture (MediaRecorder) is not supported in this browser.');
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const CANDIDATE_MIME_TYPES = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/mpeg'
    ];
    const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported)
      ? CANDIDATE_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t))
      : undefined;

    mediaChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) mediaChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      // Release the mic immediately
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;

      const blob = new Blob(mediaChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      mediaRecorder = null;
      proxyRecording = false;

      const durationMs = Date.now() - proxyStartedAt;
      if (discardProxyRecording || durationMs < MIN_PROXY_RECORDING_MS) {
        discardProxyRecording = false;
        setMicState('idle');
        debugLog(`STT: Discarded ${durationMs}ms recording without transcribing.`, 'info');
        return;
      }
      setMicState('transcribing');

      const ext = blob.type.includes('ogg') ? 'ogg' : (blob.type.includes('mp4') ? 'mp4' : (blob.type.includes('mpeg') ? 'mp3' : 'webm'));
      const lang = (window.selectedLanguageCode || 'en-US').split('-')[0];

      try {
        debugLog(`STT: Sending ${(blob.size / 1024).toFixed(1)}KB audio to WaifuAI Cloud...`, 'info');
        const result = await window.WaifuProxyAPI.transcribeAudio(blob, { language: lang, filename: 'audio.' + ext });
        const text = (result?.text || '').trim();
        if (!text) {
          debugLog('STT: Proxy transcription returned empty text.', 'warn');
          addMessage('I couldn\'t hear anything in that recording. Try holding the mic closer?', false);
          return;
        }
        appendToInput(text);
        debugLog('STT: Proxy transcription received.', 'info');
        if (typeof trackEvent === 'function') trackEvent('voice_input_used', { engine: 'proxy' });
      } catch (err) {
        debugError('STT: Proxy transcription failed', err, { status: err?.status });
        const msg = err?.status === 429
          ? 'Voice input is rate limited right now. Please try again in a moment.'
          : 'Voice input failed: ' + (err?.message || 'transcription error');
        addMessage(msg, false);
      } finally {
        setMicState('idle');
      }
    };

    mediaRecorder.start();
    proxyStartedAt = Date.now();
    proxyRecording = true;
    setMicState('listening');
    debugLog('STT: Proxy recording started.', 'info');
  }

  function stopProxyRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      proxyRecording = false;
      setMicState('idle');
    }
  }

  async function startProxy() {
    try {
      discardProxyRecording = false;
      setMicState('starting');
      if (typeof trackEvent === 'function') trackEvent('voice_input_used', { engine: 'proxy', phase: 'start' });
      await startProxyRecording();
      // Stopped while the permission prompt / device was still opening.
      if (discardProxyRecording) stopProxyRecording();
    } catch (err) {
      proxyRecording = false;
      setMicState('idle');
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
      debugError('STT: Could not start proxy recording', err, { name: err?.name });
      const msg = (err?.name === 'NotAllowedError' || err?.name === 'SecurityError')
        ? 'Microphone permission denied. Enable it in your browser settings to use voice input.'
        : 'Could not start voice input: ' + (err?.message || 'unknown error');
      addMessage(msg, false);
    }
  }

  window.initSTT = function() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    // A stored proxy preference is only usable when the proxy client exists
    if (getSttEngine() === 'proxy' && !isProxyConfigured()) window.sttEngine = 'webspeech';

    const hasWebSpeech = initWebSpeech(micBtn);

    function startListening() {
      if (getSttEngine() === 'proxy') {
        if (!isProxyConfigured()) {
          debugLog('STT: Proxy engine selected but WaifuProxyAPI.transcribeAudio is unavailable.', 'error');
          return;
        }
        startProxy();
        return;
      }
      startWebSpeech();
    }

    function stopListening() {
      if (proxyRecording || getSttEngine() === 'proxy') {
        if (micState === 'starting') discardProxyRecording = true;
        else stopProxyRecording();
        return;
      }
      stopWebSpeech();
    }

    const isRecording = () => micState === 'starting' || micState === 'listening';

    // What the current press does on release: 'start' (this press began
    // recording) or 'stop' (a tap that ends a latched recording).
    let pressAction = null;
    let pressStartedAt = 0;

    micBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Keep focus (and the mobile keyboard) on the text box, and stop the
      // long-press from selecting text or opening a menu.
      e.preventDefault();
      if (micState === 'transcribing') return;
      if (isRecording()) {
        pressAction = 'stop';
        return;
      }
      pressAction = 'start';
      pressStartedAt = Date.now();
      micMode = 'hold';
      try { micBtn.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      startListening();
    });

    const onPressEnd = () => {
      const action = pressAction;
      pressAction = null;
      if (action === 'stop') {
        stopListening();
      } else if (action === 'start') {
        const held = Date.now() - pressStartedAt;
        if (held >= HOLD_THRESHOLD_MS && micState === 'listening') {
          stopListening(); // push-to-talk release
        } else if (isRecording()) {
          // Quick tap, or released while still waiting on permission:
          // latch on until the next tap.
          micMode = 'tap';
          setMicState(micState);
        }
      }
    };
    micBtn.addEventListener('pointerup', onPressEnd);
    micBtn.addEventListener('pointercancel', onPressEnd);
    micBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    // Pointer presses are handled above; keyboard activation (Enter/Space)
    // arrives as a click with detail 0 and toggles like a tap.
    micBtn.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      if (micState === 'transcribing') return;
      if (isRecording()) {
        stopListening();
      } else {
        micMode = 'tap';
        startListening();
      }
    });

    setMicState('idle');

    debugLog(`STT initialized (engine=${getSttEngine()}, webspeechAvailable=${hasWebSpeech}).`, 'info');
  };
})()
