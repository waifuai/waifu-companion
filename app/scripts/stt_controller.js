/**
 * Speech-to-text controller for the chat mic button.
 *
 * Two engines are supported and selectable in Settings > Voice:
 *  - 'webspeech': browser Web Speech API (continuous dictation, interim results).
 *  - 'proxy'    : records the mic with MediaRecorder and transcribes through the
 *                 WaifuAI Cloud. Works in browsers
 *                 and embedded environments that lack the
 *                 Web Speech API.
 */
(function(){
  let recognition = null;
  let recognizing = false;
  window.sttFinalTranscript = '';

  // Proxy recording state
  let mediaStream = null;
  let mediaRecorder = null;
  let mediaChunks = [];
  let proxyRecording = false;

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

  function setMicActive(active) {
    const micBtn = document.getElementById('micBtn');
    if (micBtn) micBtn.classList.toggle('active', active);
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
  function handleWebSpeechClick() {
    if (recognizing) {
      recognition.stop();
      return;
    }

    if (!recognition) {
      debugLog('STT: Recognition not available.', 'error');
      return;
    }

    try {
      recognition.lang = (window.selectedLanguageCode || 'en-US');
    } catch (e) { /* noop */ }

    try {
      recognition.start();
      if (typeof trackEvent === 'function') trackEvent('voice_input_used');
    } catch (e) {
      debugError('STT failed to start recognition', e, { lang: recognition?.lang });
    }
  }

  function initWebSpeech(micBtn) {
    recognition = getRecognition();
    if (!recognition) {
      // Web Speech unavailable: WaifuAI Cloud can still take over, so only
      // hide the button when the proxy path is not usable either.
      if (!isProxyConfigured()) {
        micBtn.style.display = 'none';
        debugLog('STT: Web Speech API not supported in this browser. Hiding mic button.', 'info');
      } else {
        debugLog('STT: Web Speech API not supported; WaifuAI Cloud will be used.', 'info');
      }
      return false;
    }

    recognition.onstart = () => {
      recognizing = true;
      setMicActive(true);
      // Initialize with current input value but don't double up
      window.sttFinalTranscript = window.messageInput.value ? window.messageInput.value + ' ' : '';
      debugLog('STT: Recognition started.', 'info');
    };
    recognition.onerror = (e) => {
      recognizing = false;
      setMicActive(false);
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
          micBtn.style.display = 'none';
          debugLog('STT: Service not allowed / unavailable. Hiding mic button.', 'warn');
        }
      }
    };
    recognition.onend = () => {
      recognizing = false;
      setMicActive(false);
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
      setMicActive(false);

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
      }
    };

    mediaRecorder.start();
    proxyRecording = true;
    setMicActive(true);
    debugLog('STT: Proxy recording started.', 'info');
  }

  function stopProxyRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      proxyRecording = false;
      setMicActive(false);
    }
  }

  async function handleProxyClick() {
    if (proxyRecording) {
      stopProxyRecording();
      return;
    }
    try {
      if (typeof trackEvent === 'function') trackEvent('voice_input_used', { engine: 'proxy', phase: 'start' });
      await startProxyRecording();
    } catch (err) {
      proxyRecording = false;
      setMicActive(false);
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

    micBtn.addEventListener('click', () => {
      const engine = getSttEngine();
      if (engine === 'proxy') {
        if (!isProxyConfigured()) {
          debugLog('STT: Proxy engine selected but WaifuProxyAPI.transcribeAudio is unavailable.', 'error');
          return;
        }
        handleProxyClick();
        return;
      }
      handleWebSpeechClick();
    });

    debugLog(`STT initialized (engine=${getSttEngine()}, webspeechAvailable=${hasWebSpeech}).`, 'info');
  };
})()
