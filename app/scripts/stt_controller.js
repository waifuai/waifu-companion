/**
 * Speech-to-text controller for the chat mic button.
 *
 * Voice input uses the browser Web Speech API only. The retired public
 * transcription endpoint is gone: there is no audio upload, no MediaRecorder
 * capture and no engine selection. Browsers without Web Speech simply do not
 * offer the mic button.
 *
 * Gestures (unchanged):
 *  - press and hold: records while held, stops on release (push-to-talk).
 *  - quick tap: starts and keeps recording until the next tap.
 *  - keyboard (Enter/Space): toggles, same as a tap.
 * The button and the message box placeholder show the current state:
 * starting (waiting on mic permission / the recognizer) and listening.
 */
(function () {
  let recognition = null;
  window.sttFinalTranscript = '';
  // Text the input already held when dictation started; recogniser output is
  // always rebuilt on top of it, never merged into it.
  let sttPresetText = '';

  // A press shorter than this is a tap (toggle); longer is push-to-talk.
  const HOLD_THRESHOLD_MS = 300;

  // 'idle' | 'starting' | 'listening'
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
    micTapPlaceholder: ['composer.micTap', 'Listening... tap the mic again to stop']
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

  // Single place that reflects the recording state in the UI.
  function setMicState(state) {
    micState = state;
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.classList.toggle('starting', state === 'starting');
      micBtn.classList.toggle('active', state === 'listening');
      micBtn.setAttribute('aria-pressed', String(state === 'starting' || state === 'listening'));
      micBtn.title = state === 'idle' ? uiString('micIdleTitle') : listeningPlaceholder();
    }

    const input = window.messageInput;
    if (!input) return;
    if (state === 'idle') {
      if (restingPlaceholder !== null) input.placeholder = restingPlaceholder;
      restingPlaceholder = null;
      return;
    }
    if (restingPlaceholder === null) restingPlaceholder = input.placeholder;
    input.placeholder = state === 'starting' ? uiString('micStartingPlaceholder') : listeningPlaceholder();
  }

  // The UI translator rewrote the message box placeholder: that's the new
  // resting text, and the live mic state goes back on top of it.
  window.onMessageInputPlaceholderChanged = function () {
    if (micState === 'idle' || !window.messageInput) return;
    restingPlaceholder = window.messageInput.placeholder;
    setMicState(micState);
  };

  function hideMicButton(micBtn) {
    micBtn.style.display = 'none';
    // The welcome hint shouldn't advertise a mic that isn't there.
    document.querySelectorAll('.welcome-hint-mic').forEach(el => el.remove());
  }

  let voiceGeneration = 0;
  let webSpeechValid = false;
  window.cancelVoiceInput = () => {
    voiceGeneration++; webSpeechValid = false;
    try { recognition?.abort(); } catch (_) { /* ignore */ }
    window.sttFinalTranscript = ''; sttPresetText = ''; setMicState('idle');
  };

  function stopWebSpeech() {
    if (!recognition) return;
    // Still spinning up: abort, since there's nothing to finalize yet.
    if (micState === 'starting') recognition.abort();
    else recognition.stop();
  }

  function startWebSpeech() {
    // Each capture keeps its recognition identity, including delayed native callbacks.
    initWebSpeech(document.getElementById('micBtn'));
    if (!recognition) {
      debugLog('STT: Web Speech API is not available in this browser.', 'error');
      return;
    }

    try {
      recognition.lang = (window.selectedLanguageCode || 'en-US');
    } catch (e) { /* noop */ }

    try {
      webSpeechValid = true;
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
      hideMicButton(micBtn);
      debugLog('STT: Web Speech API not supported in this browser. Hiding mic button.', 'info');
      return false;
    }

    const session = recognition;
    const generation = voiceGeneration;
    const current = () => webSpeechValid && recognition === session && voiceGeneration === generation;
    recognition.onstart = () => {
      if (!current()) return;
      setMicState('listening');
      // Keep text typed before dictation as a fixed prefix; everything the
      // recogniser produces is rebuilt from its results snapshot (onresult).
      sttPresetText = window.messageInput.value ? window.messageInput.value + ' ' : '';
      window.sttFinalTranscript = sttPresetText;
      debugLog('STT: Recognition started.', 'info');
    };
    recognition.onerror = (e) => {
      if (!current()) return;
      setMicState('idle');
      debugError('STT error', e, {
        errorCode: e.error,
        errorMessage: e.message || 'N/A',
        lang: recognition?.lang
      });
      if (e.error === 'service-not-allowed') {
        hideMicButton(micBtn);
        debugLog('STT: Speech service not allowed / unavailable. Hiding mic button.', 'warn');
      } else if (e.error === 'not-allowed') {
        addMessage(tr('voice.permissionDenied', 'Microphone permission denied. Enable it in your browser settings to use voice input.'), false);
      }
    };
    recognition.onend = () => {
      if (!current()) return;
      setMicState('idle');
      // Final text is already in the input field, just ensure it's set
      if (window.messageInput && window.sttFinalTranscript) {
        window.messageInput.value = window.sttFinalTranscript.trim();
      }
      debugLog('STT: Recognition ended.', 'info');
    };
    recognition.onresult = (event) => {
      if (!current()) return;
      // Rebuild from the full results snapshot on every event: browsers can
      // re-deliver results from index 0 or revise earlier ones, and the old
      // accumulate-from-resultIndex logic duplicated that text.
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

  window.initSTT = function () {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    // Legacy settings may still hold a retired 'proxy' preference.
    window.sttEngine = 'webspeech';
    const sel = document.getElementById('sttEngineSelector');
    if (sel) sel.value = 'webspeech';

    const hasWebSpeech = initWebSpeech(micBtn);

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
      if (isRecording()) {
        pressAction = 'stop';
        return;
      }
      pressAction = 'start';
      pressStartedAt = Date.now();
      micMode = 'hold';
      try { micBtn.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      startWebSpeech();
    });

    const onPressEnd = () => {
      const action = pressAction;
      pressAction = null;
      if (action === 'stop') {
        stopWebSpeech();
      } else if (action === 'start') {
        const held = Date.now() - pressStartedAt;
        if (held >= HOLD_THRESHOLD_MS && micState === 'listening') {
          stopWebSpeech(); // push-to-talk release
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
      if (isRecording()) {
        stopWebSpeech();
      } else {
        micMode = 'tap';
        startWebSpeech();
      }
    });

    setMicState('idle');

    debugLog(`STT initialized (webspeechAvailable=${hasWebSpeech}).`, 'info');
  };
})()
