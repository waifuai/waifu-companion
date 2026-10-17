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
  // Text the input already held when dictation started; recogniser output is
  // always rebuilt on top of it, never merged into it.
  let sttPresetText = '';

  let proxyCapture = null;

  // A press shorter than this is a tap (toggle); longer is push-to-talk.
  const HOLD_THRESHOLD_MS = 300;

  // 'idle' | 'starting' | 'listening' | 'transcribing'
  let micState = 'idle';
  // 'hold' while the button is held down, 'tap' once it's latched on
  let micMode = 'tap';
  let restingPlaceholder = null;

  // Dictionary key plus the pre-existing English text, so the controller still
  // reads correctly when the i18n runtime is not loaded.
  const FALLBACK_STRINGS = {
    micIdleTitle: ['composer.micTitle', 'Voice input: hold to talk, or tap to start/stop'],
    micStartingPlaceholder: ['composer.micStarting', 'Starting microphone...'],
    micHoldPlaceholder: ['composer.micHold', 'Listening... release to stop'],
    micTapPlaceholder: ['composer.micTap', 'Listening... tap the mic again to stop'],
    micTranscribingPlaceholder: ['composer.micTranscribing', 'Transcribing...']
  };

  const tr = (key, fallback) => {
    const api = typeof window !== 'undefined' && window.WaifuI18n;
    try { return api && api.has(key) ? api.t(key) : fallback; } catch (e) { return fallback; }
  };

  function uiString(key) {
    const entry = FALLBACK_STRINGS[key];
    return entry ? tr(entry[0], entry[1]) : '';
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
        switchEnginePreference('proxy');
        debugLog('STT: Web Speech API not supported; WaifuAI Cloud will be used.', 'info');
      }
      return false;
    }

    recognition.onstart = () => {
      setMicState('listening');
      // Keep text typed before dictation as a fixed prefix; everything the
      // recogniser produces is rebuilt from its results snapshot (onresult).
      sttPresetText = window.messageInput.value ? window.messageInput.value + ' ' : '';
      window.sttFinalTranscript = sttPresetText;
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
        addMessage(tr('voice.permissionDenied', 'Microphone permission denied. Enable it in your browser settings to use voice input.'), false);
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
      // Rebuild from the full results snapshot on every event: browsers can
      // re-deliver results from index 0 or revise earlier ones, and the old
      // accumulate-from-resultIndex logic duplicated that text (2026-10-11).
      let final_transcript = '';
      let interim_transcript = '';
      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final_transcript += event.results[i][0].transcript;
        } else {
          interim_transcript += event.results[i][0].transcript;
        }
      }
      // The unfinalized tail is kept too, so stopping mid-word does not
      // drop the last few words.
      window.sttFinalTranscript = sttPresetText + final_transcript + interim_transcript;

      if (window.messageInput) {
        window.messageInput.value = window.sttFinalTranscript.trim();
      }
    };
    return true;
  }

  // ---------------- Proxy WaifuAI Cloud (MediaRecorder -> /transcribe) ----------------
  function startProxy() {
    if (!window.MicCapture || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      addMessage(tr('error.micUnsupported', 'Microphone recording is not supported in this browser.'), false);
      return;
    }
    if (!proxyCapture) proxyCapture = window.MicCapture.create({
      onState: setMicState,
      onLevel(level) {
        const button = document.getElementById('micBtn');
        if (!button) return;
        button.dataset.inputMonitor = String(level !== null);
        button.style.setProperty('--mic-input-level', String(level || 0));
      },
      onError(message) {
        debugLog('STT: ' + message, 'warn');
        addMessage(message, false);
      },
      async onAudio(blob) {
        const ext = blob.type.includes('ogg') ? 'ogg' : (blob.type.includes('mp4') ? 'mp4' : (blob.type.includes('mpeg') ? 'mp3' : 'webm'));
        const lang = (window.selectedLanguageCode || 'en-US').split('-')[0];
        let result;
        try {
          result = await window.WaifuProxyAPI.transcribeAudio(blob, { language: lang, filename: 'audio.' + ext });
        } catch (error) {
          debugError('STT: Cloud transcription failed', error, { status: error?.status });
          throw new Error(error?.status === 429
            ? tr('voice.rateLimited', 'Voice input is rate limited right now. Please try again in a moment.')
            : tr('voice.transcribeFailed', 'Voice input failed: %{message}').replace('%{message}', error?.message || 'transcription error'));
        }
        const text = (result?.text || '').trim();
        if (!text) {
          addMessage(tr('voice.heardNothing', "I couldn't hear anything in that recording. Check your microphone and try again."), false);
          return;
        }
        appendToInput(text);
        if (typeof trackEvent === 'function') trackEvent('voice_input_used', { engine: 'proxy' });
      }
    });
    if (proxyCapture.state === 'idle' && typeof trackEvent === 'function') {
      trackEvent('voice_input_used', { engine: 'proxy', phase: 'start' });
    }
    proxyCapture.start();
  }

  window.initSTT = function() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    // A stored proxy preference is only usable when the proxy client exists
    if (getSttEngine() === 'proxy' && !isProxyConfigured()) window.sttEngine = 'webspeech';

    const hasWebSpeech = initWebSpeech(micBtn);

    function startListening() {
      // Settings can select browser speech again after initialization. Resolve
      // an unavailable engine before starting so the visible mic stays usable.
      if (!recognition && isProxyConfigured() && getSttEngine() !== 'proxy') {
        switchEnginePreference('proxy');
      }
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
      if (proxyCapture?.recording || getSttEngine() === 'proxy') {
        proxyCapture?.stop();
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
