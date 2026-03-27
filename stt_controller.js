(function(){
  let recognition = null;
  let recognizing = false;
  window.sttFinalTranscript = '';

  function getRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = true; // Enable continuous mode for longer inputs
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    return rec;
  }

  window.initSTT = function() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    recognition = getRecognition();
    if (!recognition) {
      micBtn.disabled = true;
      micBtn.title = 'Voice input not supported in this browser';
      debugLog('STT: Web Speech API not supported.', 'warn');
      return;
    }

    const updateLang = () => {
      try {
        if (recognition) recognition.lang = (window.selectedLanguageCode || 'en-US');
      } catch(e) { /* noop */ }
    };
    updateLang();

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add('active');
      // Initialize with current input value but don't double up
      window.sttFinalTranscript = window.messageInput.value ? window.messageInput.value + ' ' : '';
      debugLog('STT: Recognition started.', 'info');
    };
    recognition.onerror = (e) => {
      debugError('STT error', e, {
        errorCode: e.error,
        errorMessage: e.message || 'N/A',
        lang: recognition?.lang,
        wasRecognizing: recognizing
      });
    };
    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove('active');
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

    micBtn.addEventListener('click', () => {
      if (recognizing) {
        recognition.stop();
        return;
      }
      
      if (!recognition) {
        debugLog('STT: Recognition not available.', 'error');
        return;
      }
      
      updateLang();
      try {
        // Just start; onstart handler handles initialization
        recognition.start();

        if (typeof trackEvent === 'function') {
          trackEvent('voice_input_used');
        }
      } catch (e) {
        debugError('STT failed to start recognition', e, { lang: recognition?.lang });
      }
    });

    // Keep language in sync when user changes it
    document.getElementById('languageSelector')?.addEventListener('change', updateLang);
  };
})()