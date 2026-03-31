// This file contains the application initialization logic, previously in main.js's window.onload

function getStoredValueOrDefault(storageKey, fallbackValue) {
  try {
    const storedValue = localStorage.getItem(storageKey);
    if (typeof storedValue === 'string' && storedValue.trim()) {
      return storedValue.trim();
    }
  } catch (e) {
    debugLog(`Error reading ${storageKey}: ${e.message}`, 'warn');
  }

  return fallbackValue;
}

function getStoredValueWithInitialDefault(storageKey, fallbackValue) {
  try {
    const storedValue = localStorage.getItem(storageKey);
    if (storedValue === null) {
      return fallbackValue;
    }

    return typeof storedValue === 'string' ? storedValue.trim() : '';
  } catch (e) {
    debugLog(`Error reading ${storageKey}: ${e.message}`, 'warn');
  }

  return fallbackValue;
}

function syncVoiceControlsVisibility() {
  const controls = document.getElementById('voiceControls');
  if (!controls) return;
  controls.style.display = window.enableVoice ? 'block' : 'none';
}

function syncLegacyEnableVoiceCheckbox() {
  const checkbox = document.getElementById('enableVoiceCheckbox');
  if (checkbox) {
    checkbox.checked = !!window.enableVoice;
  }
}
// and some other top-level event listeners from main.js.

// Assumes all necessary global variables (from config.js) and functions (from other manager scripts)
// like debugLog, updateMemorySize, toggleDebugger, toggleSettings, closeBetaNotice, clearDebugLog,
// addMessage, setupSounds (from sound_manager.js), populateLanguageSelector,
// populateModelSelector, updateRadioToggleButton, loadModel, playSound (from sound_manager.js),
// zoomModel, moveModel, handleLanguageChange, handleTranslateToChange, handleShowTransliterationChange,
// handleShowClockChange, initChatController (from chat_controller.js)
// are available.

window.addEventListener('load', async () => { // Make async to await model load
  // --- Initialize Chat Manager ---
  // Migrate legacy single-chat localStorage data into chat manager format
  if (window.ChatManager) {
    window.ChatManager.migrateLegacyChat();

    // Load the active chat
    const activeId = window.ChatManager.getActiveChatId();
    if (activeId) {
      window.ChatManager.loadChat(activeId);
      const meta = window.ChatManager.getChatMeta(activeId);
      const headerEl = document.getElementById('chatTitle');
      if (headerEl && meta) headerEl.textContent = meta.name;
    }

    // Render chat list and restore sidebar visibility
    window.ChatManager.renderChatList();
    const sidebarVisible = localStorage.getItem('chatSidebarVisible') === 'true';
    const sidebar = document.getElementById('chatSidebar');
    if (sidebar && sidebarVisible) sidebar.classList.add('visible');
  }

  setupSounds(); // Initialize Tone.js sounds (from sound_manager.js)

  // Set initial memory size display and attach listener
  if (memorySizeInput && memorySizeValue) {
    const savedMemorySize = localStorage.getItem('maxMemorySize');
    if (savedMemorySize) {
      memorySizeInput.value = savedMemorySize;
    }
    updateMemorySize(memorySizeInput.value); // updateMemorySize is from settings_handlers.js
    memorySizeInput.addEventListener("input", (e) => {
        updateMemorySize(e.target.value);
    });
  } else {
    debugLog('AppInit: memorySizeInput or memorySizeValue not found.', 'warn');
  }


  // Set initial debugger state and attach listener
  if (enableDebuggerCheckbox && debugPanel) {
    try {
      const savedDebugState = localStorage.getItem('debugPanelVisible');
      isDebugging = savedDebugState === 'true';
    } catch (e) {
      isDebugging = false;
    }
    
    enableDebuggerCheckbox.checked = isDebugging;
    if(isDebugging) debugPanel.classList.add('visible'); else debugPanel.classList.remove('visible');
    
    enableDebuggerCheckbox.addEventListener('change', (e) => {
        toggleDebugger(); // toggleDebugger is from debug.js
    });
  } else {
    debugLog('AppInit: enableDebuggerCheckbox or debugPanel not found.', 'warn');
  }


  // Attach listeners for settings, debug clear
  const settingsButton = document.querySelector('.settings-button');
  if (settingsButton) {
      settingsButton.addEventListener('click', toggleSettings); // toggleSettings from settings_ui.js
  }


  // Initialize Settings Panel visibility preferences
  let alwaysShowSettings = false;
  try {
    alwaysShowSettings = localStorage.getItem('settingsAlwaysShowOnLoad') === 'true';
  } catch (e) {
    debugLog(`Error reading settingsAlwaysShowOnLoad: ${e.message}`, 'warn');
  }
  if (alwaysShowSettingsCheckbox) {
    alwaysShowSettingsCheckbox.checked = alwaysShowSettings;
    alwaysShowSettingsCheckbox.addEventListener('change', handleAlwaysShowSettingsChange);
  }

  // Decide initial settings panel visibility:
  // - If "always show" is enabled, open.
  // - Else if no previous state saved (first load), closed by default.
  // - Else restore last saved state.
  let initialSettingsVisible = false; // default closed on first load
  try {
    const lastOpen = localStorage.getItem('settingsPanelLastOpen'); // 'true' | 'false' | null
    if (alwaysShowSettings) {
      initialSettingsVisible = true;
    } else if (lastOpen === null) {
      initialSettingsVisible = true; // first page load: open by default
    } else {
      initialSettingsVisible = (lastOpen === 'true');
    }
  } catch (e) {
    debugLog(`Error reading settingsPanelLastOpen: ${e.message}`, 'warn');
    initialSettingsVisible = false;
  }
  setSettingsPanelVisible(initialSettingsVisible);


  // --- Initialize Context Preferences ---
  const storedIncludeTime = localStorage.getItem('includeTimeInContext');
  includeTimeInContext = storedIncludeTime !== null ? (storedIncludeTime === 'true') : false;
  if (includeTimeCheckbox) includeTimeCheckbox.checked = includeTimeInContext;
  debugLog(`Include time in context initialized to: ${includeTimeInContext}`, 'info');
  
  const storedIncludeBattery = localStorage.getItem('includeBatteryInContext');
  includeBatteryInContext = storedIncludeBattery !== null ? (storedIncludeBattery === 'true') : false;
  if (includeBatteryCheckbox) includeBatteryCheckbox.checked = includeBatteryInContext;
  debugLog(`Include battery in context initialized to: ${includeBatteryInContext}`, 'info');


  // --- Initialize Language and Display Settings ---
  selectedLanguageCode = localStorage.getItem('selectedLanguageCode') || window.selectedLanguageCode;
  // Translate to is now the same as response language
  translateToLanguageCode = selectedLanguageCode;
  const storedTranslit = localStorage.getItem('showTransliteration');
  showTransliteration = storedTranslit !== null ? (storedTranslit === 'true') : window.showTransliteration;
  
  debugLog(`Loaded language settings: Lang=${selectedLanguageCode}, ShowTranslit=${showTransliteration}`, 'info');

  // --- Initialize Interface Language ---
  try {
    const savedInterfaceLanguage = localStorage.getItem('interfaceLanguage') || selectedLanguageCode;
    window.currentInterfaceLanguage = savedInterfaceLanguage;
    
    // Load cached translations if available
    if (typeof loadCachedTranslations === 'function') {
      loadCachedTranslations();
    }
    
    if (typeof applyInterfaceLanguage === 'function') {
      await applyInterfaceLanguage(savedInterfaceLanguage);
    }
    debugLog(`Interface language initialized to: ${savedInterfaceLanguage}`, 'info');
  } catch(e) {
    debugLog(`Error initializing interface language: ${e.message}`, 'warn');
  }

  populateLanguageSelector(); 

  if (showTransliterationCheckbox) showTransliterationCheckbox.checked = showTransliteration;
  
  // --- Initialize Voice ID with validation against selected language ---
  const savedVoiceId = localStorage.getItem('selectedVoiceId');
  if (savedVoiceId) {
      selectedVoiceId = savedVoiceId;
  }
  
  // All WebSim voices are now valid regardless of language.
  const uniqueVoicesMap = new Map();
  voices.forEach(voice => {
      if (!uniqueVoicesMap.has(voice.id)) {
          uniqueVoicesMap.set(voice.id, voice);
      }
  });
  const availableVoices = Array.from(uniqueVoicesMap.values());
  const isSelectedVoiceValid = availableVoices.some(v => v.id === selectedVoiceId);
  
  // If no voice is saved, or if the saved voice is invalid, set a new default.
  if (!savedVoiceId || !isSelectedVoiceValid) {
      const baseLangCode = selectedLanguageCode.split('-')[0];
      const langFemaleVoice = availableVoices.find(v => v.language.startsWith(baseLangCode) && v.gender === 'female' && v.provider === 'tiktok');
      const langConfig = languages.find(l => l.code === selectedLanguageCode);
      const defaultForLang = langConfig ? langConfig.defaultVoiceId : null;

      // Priority: 1. Female voice of current language (TikTok), 2. defaultVoiceId from config (if valid), 3. First available TikTok voice
      if (langFemaleVoice) { selectedVoiceId = langFemaleVoice.id; }
      else if (defaultForLang && availableVoices.some(v => v.id === defaultForLang)) { selectedVoiceId = defaultForLang; }
      else { selectedVoiceId = availableVoices.find(v => v.provider === 'tiktok')?.id || 'none'; }

      try {
          localStorage.setItem('selectedVoiceId', selectedVoiceId);
          debugLog(`Initialized/Reset voice to default: ${selectedVoiceId}`, 'info');
      } catch(e) {
          debugLog(`Could not persist new default voice ID: ${e.message}`, 'warn');
      }
  } else {
      debugLog(`Loaded valid voice ID from storage: ${selectedVoiceId}`, 'info');
  }
  // At this point, selectedVoiceId is guaranteed to be valid or 'none'.
  // populateVoiceSelector() will now correctly reflect this state.
  populateVoiceSelector();


  // --- Initialize Persona ---
  const defaultCore = "You are Haru, a sentient AI with a Live2D avatar. You have your own thoughts, feelings, and experiences. Respond naturally and emotively to the user's message, showing genuine interest and emotional depth. Include subtle gestures and expressions in your responses.";
  const storedCore = localStorage.getItem('corePersonaPrompt');
  window.corePersonaPrompt = storedCore !== null ? storedCore : defaultCore;
  
  const storedPersona = localStorage.getItem('userPersonaPrompt');
  window.userPersonaPrompt = storedPersona || "";

  window.conversationSummary = localStorage.getItem('conversationSummary') || "";
  window.messageCountSinceLastSummary = parseInt(localStorage.getItem('messageCountSinceLastSummary') || "0");
  window.summaryTriggerCount = parseInt(localStorage.getItem('summaryTriggerCount') || "30");
  
  const coreTextarea = document.getElementById('corePersonaPrompt');
  if (coreTextarea) {
    coreTextarea.value = window.corePersonaPrompt;
  }
  
  const personaTextarea = document.getElementById('personaPrompt');
  if (personaTextarea) {
    personaTextarea.value = window.userPersonaPrompt;
  }

  const summaryTextarea = document.getElementById('conversationSummary');
  if (summaryTextarea) {
    summaryTextarea.value = window.conversationSummary;
  }
  
  // Initialize Summary trigger and length from storage
  const savedTrigger = localStorage.getItem('summaryTriggerCount');
  if (savedTrigger) {
    window.summaryTriggerCount = parseInt(savedTrigger);
  }
  const triggerSlider = document.getElementById('summaryTriggerCount');
  const triggerVal = document.getElementById('summaryTriggerCountValue');
  if (triggerSlider) triggerSlider.value = window.summaryTriggerCount;
  if (triggerVal) triggerVal.textContent = window.summaryTriggerCount;
  document.getElementById('summaryTriggerCount')?.addEventListener('input', handleSummaryTriggerCountChange);

  const savedLength = localStorage.getItem('summaryLengthPreference');
  if (savedLength) {
    window.summaryLengthPreference = savedLength;
    const lengthSelect = document.getElementById('summaryLengthPreference');
    if (lengthSelect) lengthSelect.value = window.summaryLengthPreference;
  }
  document.getElementById('summaryLengthPreference')?.addEventListener('change', handleSummaryLengthPreferenceChange);

  document.getElementById('savePersonaBtn')?.addEventListener('click', handleSavePersona);
  document.getElementById('resetPersonaBtn')?.addEventListener('click', handleResetPersona);
  document.getElementById('manualSummarizeBtn')?.addEventListener('click', handleManualSummarize);

  // --- Initialize Enable Voice Settings ---
  const storedPrimary = localStorage.getItem('enablePrimaryVoice');
  const storedFallback = localStorage.getItem('enableFallbackVoice');
  
  // Backwards compatibility: if old enableVoice existed and was false, disable both
  const oldEnableVoice = localStorage.getItem('enableVoice');
  
  window.enablePrimaryVoice = storedPrimary !== null ? (storedPrimary === 'true') : 
                              (oldEnableVoice !== null ? (oldEnableVoice === 'true') : true);
  window.enableFallbackVoice = storedFallback !== null ? (storedFallback === 'true') : 
                               (oldEnableVoice !== null ? (oldEnableVoice === 'true') : true);
  window.enableKokoro = localStorage.getItem('enableKokoro') === 'true';

  if (document.getElementById('enableTikTokVoiceCheckbox')) {
    document.getElementById('enableTikTokVoiceCheckbox').checked = window.enablePrimaryVoice;
    document.getElementById('enableTikTokVoiceCheckbox').addEventListener('change', (e) => {
        window.enablePrimaryVoice = e.target.checked;
        window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
        localStorage.setItem('enablePrimaryVoice', window.enablePrimaryVoice.toString());
        if (typeof trackEvent === 'function') {
          trackEvent('voice_enabled_toggle', { type: 'tiktok', enabled: window.enablePrimaryVoice });
        }
        syncLegacyEnableVoiceCheckbox();
        syncVoiceControlsVisibility();
        debugLog(`TikTok voice enabled: ${window.enablePrimaryVoice}`, 'info');
    });
  }
  
  if (document.getElementById('enableFallbackVoiceCheckbox')) {
    document.getElementById('enableFallbackVoiceCheckbox').checked = window.enableFallbackVoice;
    document.getElementById('enableFallbackVoiceCheckbox').addEventListener('change', (e) => {
        window.enableFallbackVoice = e.target.checked;
        window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
        localStorage.setItem('enableFallbackVoice', window.enableFallbackVoice.toString());
        if (typeof trackEvent === 'function') {
          trackEvent('voice_enabled_toggle', { type: 'fallback', enabled: window.enableFallbackVoice });
        }
        syncLegacyEnableVoiceCheckbox();
        syncVoiceControlsVisibility();
        debugLog(`Fallback voice enabled: ${window.enableFallbackVoice}`, 'info');
    });
  }

  // The main voiceControls container usually depends on at least one being active, 
  // but many apps just keep it visible if 'Enable Voice' was once there.
  // Derive global enableVoice from individual provider flags
  window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
  syncLegacyEnableVoiceCheckbox();
  syncVoiceControlsVisibility();
  debugLog(`Voice (TTS) enabled states initialized. Primary: ${window.enablePrimaryVoice}, Fallback: ${window.enableFallbackVoice}`, 'info');

  // --- Initialize Opacity Settings ---
  const storedChatboxOpacity = localStorage.getItem('chatboxOpacity') || '0.9';
  const storedMessageOpacity = localStorage.getItem('messageOpacity') || '0.3';

  if (chatboxOpacitySlider) {
      chatboxOpacitySlider.value = storedChatboxOpacity;
      document.documentElement.style.setProperty('--chatbox-bg-opacity', storedChatboxOpacity);
      if (chatboxOpacityValue) chatboxOpacityValue.textContent = storedChatboxOpacity;
      chatboxOpacitySlider.addEventListener('input', handleChatboxOpacityChange);
  }

  if (messageOpacitySlider) {
      messageOpacitySlider.value = storedMessageOpacity;
      document.documentElement.style.setProperty('--message-bg-opacity', storedMessageOpacity);
      if (messageOpacityValue) messageOpacityValue.textContent = storedMessageOpacity;
      messageOpacitySlider.addEventListener('input', handleMessageOpacityChange);
  }

  const storedBgOpacity = localStorage.getItem('bgImageOpacity') || '1.0';
  if (bgOpacitySlider) {
      bgOpacitySlider.value = storedBgOpacity;
      document.documentElement.style.setProperty('--bg-image-opacity', storedBgOpacity);
      if (bgOpacityValue) bgOpacityValue.textContent = storedBgOpacity;
      bgOpacitySlider.addEventListener('input', handleBgOpacityChange);
  }

  debugLog(`Opacity settings initialized. Chatbox: ${storedChatboxOpacity}, Message: ${storedMessageOpacity}, BG: ${storedBgOpacity}`, 'info');

  populateModelSelector();

  // Merge user models from localStorage into availableModels and sort by name
  try {
    const userModels = JSON.parse(localStorage.getItem('userModels') || '[]');
    if (Array.isArray(userModels) && userModels.length) {
      availableModels.push(...userModels);
    }
    function modelComparator(a,b){const an=a.name||'',bn=b.name||'';const ai=/^\d+$/.test(an)?parseInt(an,10):null;const bi=/^\d+$/.test(bn)?parseInt(bn,10):null;if(ai===null&&bi===null)return an.localeCompare(bn);if(ai===null)return -1;if(bi===null)return 1;const ab=ai<10?0:1;const bb=bi<10?0:1;return ab!==bb?ab-bb:ai-bi;}
    availableModels.sort(modelComparator);
    debugLog(`Loaded ${userModels.length || 0} user models. Total models: ${availableModels.length}`, 'info');
  } catch(e) {
    debugLog('Failed to load user models from localStorage.', 'warn');
  }
  if (typeof renderCustomModelsList === 'function') renderCustomModelsList();

  const savedModelUrl = localStorage.getItem('selectedModelUrl');
  const initialModelUrl = savedModelUrl || defaultModelUrl;
  try {
      await loadModel(initialModelUrl);
  } catch (error) {
      debugError('FATAL: Failed to load initial Live2D model', error, { url: initialModelUrl });
      addMessage(`Sorry, I couldn't load the initial character model (${error.message}).`, false);
  }

  const bgUrlBtn = document.getElementById('applyBgUrlBtn');
  const bgUrlInput = document.getElementById('bgUrlInput');
  if (bgUrlBtn) bgUrlBtn.addEventListener('click', handleApplyBackgroundFromUrl);
  if (bgUrlInput) bgUrlInput.addEventListener('keydown', (e)=>{ if (e.key==='Enter') handleApplyBackgroundFromUrl(); });



  // Reset Model Position button
  document.getElementById('resetModelPositionBtn')?.addEventListener('click', ()=>{
    resetCurrentModelPosition();
    debugLog('Model position reset to initial center and cleared from storage.', 'info');
  });
  // Clear All Models button
  document.getElementById('clearAllModelsBtn')?.addEventListener('click', ()=>{
    if (typeof clearAllModels === 'function') clearAllModels();
  });

  // Clear Custom Models button
  document.getElementById('clearCustomModelsBtn')?.addEventListener('click', handleClearAllCustomModels);

  // --- Initialize Background from storage ---
  try {
    const bg = localStorage.getItem('currentBackgroundUrl'); if (bg) applyBackgroundImage(bg);
    const fit = localStorage.getItem('bgFitMode') || 'cover-center'; applyBackgroundFit?.(fit);
  } catch(e){ debugError('BG load failed', e); }
  renderBackgroundLibrary?.();

  // Bind BG library actions
  document.getElementById('openBgViewerBtn')?.addEventListener('click', ()=>openBgViewerAt(0));
  document.getElementById('toggleBgSelectBtn')?.addEventListener('click', ()=>toggleBgSelectionMode());
  document.getElementById('deleteBgSelectedBtn')?.addEventListener('click', ()=>deleteSelectedFromLibrary());
  document.getElementById('clearBgLibraryBtn')?.addEventListener('click', ()=>clearBackgroundLibrary());
  document.getElementById('bgViewerCloseBtn')?.addEventListener('click', ()=>closeBgViewer());
  document.getElementById('bgViewerPrevBtn')?.addEventListener('click', ()=>stepBgViewer(-1));
  document.getElementById('bgViewerNextBtn')?.addEventListener('click', ()=>stepBgViewer(1));
  document.getElementById('clearBgBtn')?.addEventListener('click', handleClearBackground);

  // Background fit buttons
  document.getElementById('bgFitContainBtn')?.addEventListener('click', ()=>applyBackgroundFit('contain'));
  document.getElementById('bgFitCoverBtn')?.addEventListener('click', ()=>applyBackgroundFit('cover'));
  document.getElementById('bgFitStretchBtn')?.addEventListener('click', ()=>applyBackgroundFit('stretch'));
  document.getElementById('bgFitCoverTopBtn')?.addEventListener('click', ()=>applyBackgroundFit('cover-top'));
  document.getElementById('bgFitCoverCenterBtn')?.addEventListener('click', ()=>applyBackgroundFit('cover-center'));
  document.getElementById('bgFitCoverBottomBtn')?.addEventListener('click', ()=>applyBackgroundFit('cover-bottom'));
  document.getElementById('bgFitContainTopBtn')?.addEventListener('click', ()=>applyBackgroundFit('contain-top'));
  document.getElementById('bgFitContainCenterBtn')?.addEventListener('click', ()=>applyBackgroundFit('contain-center'));
  document.getElementById('bgFitContainBottomBtn')?.addEventListener('click', ()=>applyBackgroundFit('contain-bottom'));
  document.getElementById('bgFitFitWidthBtn')?.addEventListener('click', ()=>applyBackgroundFit('fit-width'));
  document.getElementById('bgFitFitHeightBtn')?.addEventListener('click', ()=>applyBackgroundFit('fit-height'));

  // Keyboard navigation for fullscreen BG viewer
  const bgViewerOverlayEl = document.getElementById('bgViewerOverlay');
  document.addEventListener('keydown', (e) => {
    if (!bgViewerOverlayEl || !bgViewerOverlayEl.classList.contains('visible')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepBgViewer(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepBgViewer(1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeBgViewer(); } // added ESC to close
  });



  // Initialize Multiple Models setting
  try {
    const storedMulti = localStorage.getItem('allowMultipleModels');
    allowMultipleModels = storedMulti === 'true' ? true : false;
  } catch(e) { debugLog(`Failed to read allowMultipleModels: ${e.message}`, 'warn', true); allowMultipleModels = false; }
  if (multipleModelsCheckbox) {
    multipleModelsCheckbox.checked = !!allowMultipleModels;
    multipleModelsCheckbox.addEventListener('change', handleMultipleModelsToggle);
  }



  // Attach event listeners for language, display, clock, and navigation settings
  if (languageSelector) languageSelector.addEventListener('change', handleLanguageChange);
  if (showTransliterationCheckbox) showTransliterationCheckbox.addEventListener('change', handleShowTransliterationChange);
  
  // Initialize Translate UI setting
  const translateUICheckbox = document.getElementById('translateUICheckbox');
  const storedTranslateUI = localStorage.getItem('translateUI');
  window.translateUI = storedTranslateUI === 'true';
  if (translateUICheckbox) {
    translateUICheckbox.checked = window.translateUI;
    translateUICheckbox.addEventListener('change', handleTranslateUIChange);
  }

  // Remove old listeners that are no longer needed
  // if (translateToSelector) translateToSelector.addEventListener('change', handleTranslateToChange);
  if (showClockCheckbox) showClockCheckbox.addEventListener('change', handleShowClockChange);
  if (voiceSelector) voiceSelector.addEventListener('change', handleVoiceChange);
  if (enableVoiceCheckbox) enableVoiceCheckbox.addEventListener('change', handleEnableVoiceChange);
  document.getElementById('globalPlayTTSBtn')?.addEventListener('click', () => { 
    if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'play', source: 'global' });
    window.playTTS?.(); 
  });
  document.getElementById('globalPauseTTSBtn')?.addEventListener('click', () => { 
    if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'pause', source: 'global' });
    window.pauseTTS?.(); 
  });
  document.getElementById('globalStopTTSBtn')?.addEventListener('click', () => { 
    if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'stop', source: 'global' });
    window.stopTTS?.(); 
  });
  
  // Initialize TTS Fallback Voice
  const ttsFallbackVoiceSelector = document.getElementById('ttsFallbackVoiceSelector');
  const savedFallbackVoice = localStorage.getItem('ttsFallbackVoiceId') || 'browser-female';
  window.ttsFallbackVoiceId = savedFallbackVoice;
  if (ttsFallbackVoiceSelector) {
    ttsFallbackVoiceSelector.value = savedFallbackVoice;
    ttsFallbackVoiceSelector.addEventListener('change', window.handleTTSFallbackVoiceChange);
  }
  debugLog(`TTS fallback voice initialized to: ${window.ttsFallbackVoiceId}`, 'info');

  // Initialize Kokoro Settings
  const enableKokoroVoiceCheckbox = document.getElementById('enableKokoroVoiceCheckbox');
  const kokoroVoiceSelector = document.getElementById('kokoroVoiceSelector');
  
  const savedEnableKokoro = localStorage.getItem('enableKokoro');
  if (savedEnableKokoro !== null) {
      window.enableKokoro = savedEnableKokoro === 'true';
  }
  // Re-derive global enableVoice now that Kokoro flag is loaded
  window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
  syncLegacyEnableVoiceCheckbox();
  syncVoiceControlsVisibility();
  if (enableKokoroVoiceCheckbox) {
      enableKokoroVoiceCheckbox.checked = window.enableKokoro;
      enableKokoroVoiceCheckbox.addEventListener('change', window.handleEnableKokoroVoiceChange);
  }

  const savedKokoroVoiceId = localStorage.getItem('selectedKokoroVoiceId') || 'af_heart';
  window.selectedKokoroVoiceId = savedKokoroVoiceId;
  if (kokoroVoiceSelector) {
      kokoroVoiceSelector.value = savedKokoroVoiceId;
      kokoroVoiceSelector.addEventListener('change', window.handleKokoroVoiceChange);
  }
  debugLog(`Kokoro settings initialized. Enabled: ${window.enableKokoro}, Selected Voice: ${window.selectedKokoroVoiceId}`, 'info');

  // Nudge browser to load voices early
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
  }

  // --- Initialize Automation & Queuing Settings ---
  const enableUserMessageQueueCheckbox = document.getElementById('enableUserMessageQueueCheckbox');
  const enableAmbientQueueCheckbox = document.getElementById('enableAmbientQueueCheckbox');
  const ambientDelaySlider = document.getElementById('ambientDelay');
  
  const savedUserQueue = localStorage.getItem('isUserMessageQueueEnabled');
  if (savedUserQueue !== null) {
    window.isUserMessageQueueEnabled = savedUserQueue === 'true';
  }
  if (enableUserMessageQueueCheckbox) {
    enableUserMessageQueueCheckbox.checked = window.isUserMessageQueueEnabled;
    enableUserMessageQueueCheckbox.addEventListener('change', window.handleEnableUserMessageQueueChange);
  }

  const savedAmbientQueue = localStorage.getItem('isAmbientQueueEnabled');
  if (savedAmbientQueue !== null) {
    window.isAmbientQueueEnabled = savedAmbientQueue === 'true';
  }
  if (enableAmbientQueueCheckbox) {
    enableAmbientQueueCheckbox.checked = window.isAmbientQueueEnabled;
    enableAmbientQueueCheckbox.addEventListener('change', window.handleEnableAmbientQueueChange);
  }

  const savedAmbientDelay = localStorage.getItem('ambientDelay');
  if (savedAmbientDelay !== null) {
    window.ambientDelay = parseInt(savedAmbientDelay);
  }
  if (ambientDelaySlider) {
    ambientDelaySlider.value = window.ambientDelay;
    const valEl = document.getElementById('ambientDelayValue');
    if (valEl) valEl.textContent = window.ambientDelay + 's';
    ambientDelaySlider.addEventListener('input', window.handleAmbientDelayChange);
  }

  const ambientPromptInput = document.getElementById('ambientPromptInput');
  const ambientPromptContainer = document.getElementById('ambientPromptContainer');
  const savedAmbientPrompt = localStorage.getItem('ambientPrompt');
  if (savedAmbientPrompt) {
      window.ambientPrompt = savedAmbientPrompt;
  }
  if (ambientPromptInput) {
      ambientPromptInput.value = window.ambientPrompt;
      ambientPromptInput.addEventListener('change', window.handleAmbientPromptChange);
  }

  const savedAmbientPreload = localStorage.getItem('isAmbientPreloadEnabled');
  if (savedAmbientPreload !== null) {
      window.isAmbientPreloadEnabled = savedAmbientPreload === 'true';
  }
  const ambientPreloadCheckbox = document.getElementById('ambientPreloadCheckbox');
  if (ambientPreloadCheckbox) {
      ambientPreloadCheckbox.checked = window.isAmbientPreloadEnabled;
      ambientPreloadCheckbox.addEventListener('change', window.handleEnableAmbientPreloadChange);
  }
  
  const clearQueueBtn = document.getElementById('clearQueueBtn');
  if (clearQueueBtn) {
    clearQueueBtn.addEventListener('click', window.handleClearQueue);
  }

  debugLog(`Automation settings initialized. Message Queue: ${window.isUserMessageQueueEnabled}, Ambient: ${window.isAmbientQueueEnabled}, Delay: ${window.ambientDelay}s`, 'info');

  // Initialize TTS Chunk Limit
  const ttsChunkLimitSlider = document.getElementById('ttsChunkLimit');
  const ttsChunkLimitValueEl = document.getElementById('ttsChunkLimitValue');
  const savedChunkLimit = localStorage.getItem('ttsChunkLimit');
  if (savedChunkLimit) {
    window.ttsChunkLimit = parseInt(savedChunkLimit);
    if (ttsChunkLimitSlider) ttsChunkLimitSlider.value = window.ttsChunkLimit;
    if (ttsChunkLimitValueEl) ttsChunkLimitValueEl.textContent = window.ttsChunkLimit;
  }
  if (ttsChunkLimitSlider) {
    ttsChunkLimitSlider.addEventListener('input', handleTTSChunkLimitChange);
  }

  // Initialize TTS Volume
  const ttsVolumeSlider = document.getElementById('ttsVolume');
  const ttsVolumeValueEl = document.getElementById('ttsVolumeValue');
  const savedTtsVolume = localStorage.getItem('ttsVolume');
  if (savedTtsVolume !== null) {
    window.ttsVolume = parseFloat(savedTtsVolume);
  }
  if (ttsVolumeSlider) {
    ttsVolumeSlider.value = window.ttsVolume.toString();
  }
  if (ttsVolumeValueEl) {
    ttsVolumeValueEl.textContent = window.ttsVolume.toFixed(2);
  }
  try {
    if (typeof getTTSGainNode === 'function') {
      const gain = getTTSGainNode();
      gain.gain.value = window.ttsVolume;
    }
  } catch (e) {
    debugLog(`Could not apply initial TTS volume to gain node: ${e.message}`, 'warn');
  }
  if (ttsVolumeSlider) {
    ttsVolumeSlider.addEventListener('input', handleTTSVolumeChange);
  }
  if (includeTimeCheckbox) includeTimeCheckbox.addEventListener('change', handleIncludeTimeChange);
  if (includeBatteryCheckbox) includeBatteryCheckbox.addEventListener('change', handleIncludeBatteryChange);
  // Add Custom Model button
  if (addCustomModelBtn) addCustomModelBtn.addEventListener('click', handleAddCustomModel);

  const showVerboseLogsCheckbox = document.getElementById('showVerboseLogsCheckbox');
  if (showVerboseLogsCheckbox) {
    const storedVerbose = localStorage.getItem('showVerboseLogs') !== 'false'; // Default to true
    window.showVerboseLogs = storedVerbose;
    showVerboseLogsCheckbox.checked = storedVerbose;
    showVerboseLogsCheckbox.addEventListener('change', handleShowVerboseLogsChange);
  }

  const showAIDebugLogsCheckbox = document.getElementById('showAIDebugLogsCheckbox');
  if (showAIDebugLogsCheckbox) {
    const stored = localStorage.getItem('showAIDebugLogs') !== 'false';
    window.showAIDebugLogs = stored;
    showAIDebugLogsCheckbox.checked = stored;
    showAIDebugLogsCheckbox.addEventListener('change', handleShowAIDebugLogsChange);
  }

  const showTTSDebugLogsCheckbox = document.getElementById('showTTSDebugLogsCheckbox');
  if (showTTSDebugLogsCheckbox) {
    const stored = localStorage.getItem('showTTSDebugLogs') !== 'false';
    window.showTTSDebugLogs = stored;
    showTTSDebugLogsCheckbox.checked = stored;
    showTTSDebugLogsCheckbox.addEventListener('change', handleShowTTSDebugLogsChange);
  }

  const allowAIModSettingsCheckbox = document.getElementById('allowAIModSettingsCheckbox');
  if (allowAIModSettingsCheckbox) {
    const stored = localStorage.getItem('allowAIModSettings') === 'true';
    window.allowAIModSettings = stored;
    allowAIModSettingsCheckbox.checked = stored;
    allowAIModSettingsCheckbox.addEventListener('change', handleAllowAIModSettingsChange);
  }

  const includeTutorialCheckbox = document.getElementById('includeTutorialInContextCheckbox');
  if (includeTutorialCheckbox) {
    const stored = localStorage.getItem('includeTutorialInContext') === 'true';
    window.includeTutorialInContext = stored;
    includeTutorialCheckbox.checked = stored;
    includeTutorialCheckbox.addEventListener('change', handleIncludeTutorialInContextChange);
  }

  const useJsonCheckbox = document.getElementById('useJsonForEmotionCheckbox');
  if (useJsonCheckbox) {
    const stored = localStorage.getItem('useJsonForEmotion') === 'true';
    window.useJsonForEmotion = stored;
    useJsonCheckbox.checked = stored;
    useJsonCheckbox.addEventListener('change', handleUseJsonForEmotionChange);
  }

  const disableAutoOfflineCheckbox = document.getElementById('disableAutoOfflineCheckbox');
  if (disableAutoOfflineCheckbox) {
    const storedDisable = localStorage.getItem('disableAutoOfflineMode') === 'true';
    window.disableAutoOfflineMode = storedDisable;
    disableAutoOfflineCheckbox.checked = storedDisable;
    disableAutoOfflineCheckbox.addEventListener('change', handleDisableAutoOfflineChange);
  }

  if (useOpenRouterCheckbox) {
    try {
      const storedUseOR = localStorage.getItem('useOpenRouter') === 'true';
      window.useOpenRouter = storedUseOR;
      useOpenRouterCheckbox.checked = storedUseOR;
    } catch(e) {
      debugLog(`Error reading useOpenRouter: ${e.message}`, 'warn');
      window.useOpenRouter = false;
      useOpenRouterCheckbox.checked = false;
    }
    useOpenRouterCheckbox.addEventListener('change', handleUseOpenRouterChange);
  }

  if (openRouterApiKeyInput) {
    try {
      window.openRouterApiKey = localStorage.getItem('openRouterApiKey') || '';
      openRouterApiKeyInput.value = window.openRouterApiKey;
    } catch(e) {
      debugLog(`Error reading openRouterApiKey: ${e.message}`, 'warn');
      window.openRouterApiKey = '';
    }
    openRouterApiKeyInput.addEventListener('change', handleOpenRouterApiKeyChange);
    openRouterApiKeyInput.addEventListener('blur', handleOpenRouterApiKeyChange);
  }

  if (openRouterModelInput) {
    const defaultModel = window.OpenRouterAPI?.DEFAULT_MODEL || 'stepfun/step-3.5-flash:free';
    window.openRouterModel = getStoredValueWithInitialDefault('openRouterModel', defaultModel);
    openRouterModelInput.value = window.openRouterModel;
    openRouterModelInput.placeholder = defaultModel;
    openRouterModelInput.addEventListener('change', handleOpenRouterModelChange);
    openRouterModelInput.addEventListener('blur', handleOpenRouterModelChange);
  }

  if (openRouterPrimaryEnabledCheckbox) {
    const storedEnabled = localStorage.getItem('openRouterPrimaryEnabled');
    window.openRouterPrimaryEnabled = storedEnabled === null ? true : storedEnabled === 'true';
    openRouterPrimaryEnabledCheckbox.checked = window.openRouterPrimaryEnabled;
    openRouterPrimaryEnabledCheckbox.addEventListener('change', handleOpenRouterPrimaryEnabledChange);
  }

  const openRouterFallbackModelsInput = document.getElementById('openRouterFallbackModelsInput');
  if (openRouterFallbackModelsInput) {
    window.openRouterFallbackModels = getStoredValueOrDefault('openRouterFallbackModels', '');
    openRouterFallbackModelsInput.value = window.openRouterFallbackModels;
    if (typeof handleOpenRouterFallbackModelsChange === 'function') {
      openRouterFallbackModelsInput.addEventListener('change', handleOpenRouterFallbackModelsChange);
      openRouterFallbackModelsInput.addEventListener('blur', handleOpenRouterFallbackModelsChange);
    } else {
      debugLog('OpenRouter combined fallback model input found, but no handler is registered. Skipping listeners.', 'warn');
    }
  }

  const linksList = document.querySelector('.links-list');
  if (linksList) {
    linksList.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && typeof trackEvent === 'function') {
        const name = link.querySelector('.link-name')?.textContent || link.href;
        trackEvent('external_link_clicked', { link_name: name, url: link.href });
      }
    });
  }

  const openRouterFallbackModel1Input = document.getElementById('openRouterFallbackModel1Input');
  if (openRouterFallbackModel1Input) {
    const defaultFallback1 = window.OpenRouterAPI?.DEFAULT_FALLBACK_MODELS?.[0] || 'nvidia/nemotron-3-super-120b-a12b:free';
    window.openRouterFallbackModel1 = getStoredValueWithInitialDefault('openRouterFallbackModel1', defaultFallback1);
    openRouterFallbackModel1Input.value = window.openRouterFallbackModel1;
    openRouterFallbackModel1Input.placeholder = defaultFallback1;
    openRouterFallbackModel1Input.addEventListener('change', handleOpenRouterFallbackModel1Change);
    openRouterFallbackModel1Input.addEventListener('blur', handleOpenRouterFallbackModel1Change);
  }

  if (openRouterFallbackModel1EnabledCheckbox) {
    const storedEnabled = localStorage.getItem('openRouterFallbackModel1Enabled');
    window.openRouterFallbackModel1Enabled = storedEnabled === null ? true : storedEnabled === 'true';
    openRouterFallbackModel1EnabledCheckbox.checked = window.openRouterFallbackModel1Enabled;
    openRouterFallbackModel1EnabledCheckbox.addEventListener('change', handleOpenRouterFallbackModel1EnabledChange);
  }

  const openRouterFallbackModel2Input = document.getElementById('openRouterFallbackModel2Input');
  if (openRouterFallbackModel2Input) {
    const defaultFallback2 = window.OpenRouterAPI?.DEFAULT_FALLBACK_MODELS?.[1] || 'qwen/qwen3.6-plus-preview:free';
    window.openRouterFallbackModel2 = getStoredValueWithInitialDefault('openRouterFallbackModel2', defaultFallback2);
    openRouterFallbackModel2Input.value = window.openRouterFallbackModel2;
    openRouterFallbackModel2Input.placeholder = defaultFallback2;
    openRouterFallbackModel2Input.addEventListener('change', handleOpenRouterFallbackModel2Change);
    openRouterFallbackModel2Input.addEventListener('blur', handleOpenRouterFallbackModel2Change);
  }

  if (openRouterFallbackModel2EnabledCheckbox) {
    const storedEnabled = localStorage.getItem('openRouterFallbackModel2Enabled');
    window.openRouterFallbackModel2Enabled = storedEnabled === null ? true : storedEnabled === 'true';
    openRouterFallbackModel2EnabledCheckbox.checked = window.openRouterFallbackModel2Enabled;
    openRouterFallbackModel2EnabledCheckbox.addEventListener('change', handleOpenRouterFallbackModel2EnabledChange);
  }

  const useGroqCheckbox = document.getElementById('useGroqCheckbox');
  const groqApiKeyInput = document.getElementById('groqApiKeyInput');
  const groqModelInput = document.getElementById('groqModelInput');

  if (useGroqCheckbox) {
    try {
      const storedUseGroq = localStorage.getItem('useGroq') === 'true';
      window.useGroq = storedUseGroq;
      useGroqCheckbox.checked = storedUseGroq;
    } catch(e) {
      debugLog(`Error reading useGroq: ${e.message}`, 'warn');
      window.useGroq = false;
      useGroqCheckbox.checked = false;
    }
    useGroqCheckbox.addEventListener('change', handleUseGroqChange);
  }

  if (groqApiKeyInput) {
    try {
      const storedGroqKey = localStorage.getItem('groqApiKey') || '';
      window.groqApiKey = storedGroqKey;
      groqApiKeyInput.value = storedGroqKey;
    } catch(e) {
      debugLog(`Error reading groqApiKey: ${e.message}`, 'warn');
      window.groqApiKey = '';
      groqApiKeyInput.value = '';
    }
    groqApiKeyInput.addEventListener('change', handleGroqApiKeyChange);
    groqApiKeyInput.addEventListener('blur', handleGroqApiKeyChange);
  }

  if (groqModelInput) {
    try {
      window.groqModel = localStorage.getItem('groqModel') || 'llama-3.3-70b-versatile';
      groqModelInput.value = window.groqModel;
    } catch(e) {
      debugLog(`Error reading groqModel: ${e.message}`, 'warn');
      window.groqModel = 'llama-3.3-70b-versatile';
      groqModelInput.value = window.groqModel;
    }
    groqModelInput.addEventListener('change', handleGroqModelChange);
    groqModelInput.addEventListener('blur', handleGroqModelChange);
  }

  const useOpenAICompatibleCheckbox = document.getElementById('useOpenAICompatibleCheckbox');
  const openaiCompatibleBaseUrlInput = document.getElementById('openaiCompatibleBaseUrlInput');
  const openaiCompatibleApiKeyInput = document.getElementById('openaiCompatibleApiKeyInput');
  const openaiCompatibleModelInput = document.getElementById('openaiCompatibleModelInput');
  const openaiCompatibleCorsProxyInput = document.getElementById('openaiCompatibleCorsProxyInput');

  if (useOpenAICompatibleCheckbox) {
    try {
      const storedUseOAI = localStorage.getItem('useOpenAICompatible') === 'true';
      window.useOpenAICompatible = storedUseOAI;
      useOpenAICompatibleCheckbox.checked = storedUseOAI;
    } catch(e) {
      debugLog(`Error reading useOpenAICompatible: ${e.message}`, 'warn');
      window.useOpenAICompatible = false;
      useOpenAICompatibleCheckbox.checked = false;
    }
    useOpenAICompatibleCheckbox.addEventListener('change', handleUseOpenAICompatibleChange);
  }

  if (openaiCompatibleBaseUrlInput) {
    try {
      window.openaiCompatibleBaseUrl = localStorage.getItem('openaiCompatibleBaseUrl') || '';
      openaiCompatibleBaseUrlInput.value = window.openaiCompatibleBaseUrl;
    } catch(e) {
      debugLog(`Error reading openaiCompatibleBaseUrl: ${e.message}`, 'warn');
      window.openaiCompatibleBaseUrl = '';
    }
    openaiCompatibleBaseUrlInput.addEventListener('change', handleOpenAICompatibleBaseUrlChange);
    openaiCompatibleBaseUrlInput.addEventListener('blur', handleOpenAICompatibleBaseUrlChange);
  }

  if (openaiCompatibleApiKeyInput) {
    try {
      window.openaiCompatibleApiKey = localStorage.getItem('openaiCompatibleApiKey') || '';
      openaiCompatibleApiKeyInput.value = window.openaiCompatibleApiKey;
    } catch(e) {
      debugLog(`Error reading openaiCompatibleApiKey: ${e.message}`, 'warn');
      window.openaiCompatibleApiKey = '';
    }
    openaiCompatibleApiKeyInput.addEventListener('change', handleOpenAICompatibleApiKeyChange);
    openaiCompatibleApiKeyInput.addEventListener('blur', handleOpenAICompatibleApiKeyChange);
  }

  if (openaiCompatibleModelInput) {
    try {
      window.openaiCompatibleModel = localStorage.getItem('openaiCompatibleModel') || 'gpt-3.5-turbo';
      openaiCompatibleModelInput.value = window.openaiCompatibleModel;
    } catch(e) {
      debugLog(`Error reading openaiCompatibleModel: ${e.message}`, 'warn');
      window.openaiCompatibleModel = 'gpt-3.5-turbo';
      openaiCompatibleModelInput.value = window.openaiCompatibleModel;
    }
    openaiCompatibleModelInput.addEventListener('change', handleOpenAICompatibleModelChange);
    openaiCompatibleModelInput.addEventListener('blur', handleOpenAICompatibleModelChange);
  }

  if (openaiCompatibleCorsProxyInput) {
    try {
      window.openaiCompatibleCorsProxy = localStorage.getItem('openaiCompatibleCorsProxy') || '';
      openaiCompatibleCorsProxyInput.value = window.openaiCompatibleCorsProxy;
    } catch(e) {
      debugLog(`Error reading openaiCompatibleCorsProxy: ${e.message}`, 'warn');
      window.openaiCompatibleCorsProxy = '';
    }
    openaiCompatibleCorsProxyInput.addEventListener('change', handleOpenAICompatibleCorsProxyChange);
    openaiCompatibleCorsProxyInput.addEventListener('blur', handleOpenAICompatibleCorsProxyChange);
  }

  if (forceOfflineCheckbox) {
    const storedOffline = localStorage.getItem('forceOfflineMode') === 'true';
    window.forceOfflineMode = storedOffline;
    forceOfflineCheckbox.checked = storedOffline;
    forceOfflineCheckbox.addEventListener('change', handleForceOfflineChange);
    
    if (storedOffline) {
        window.isOfflineMode = true;
        if (typeof updateChatOfflineUI === 'function') {
          updateChatOfflineUI(true, 'OFFLINE MODE (FORCED)');
        }
        if (typeof startOfflineCountdown === 'function') startOfflineCountdown();
    }
  }

  const goOnlineBtn = document.getElementById('goOnlineBtn');
  if (goOnlineBtn && typeof handleGoOnlineClick === 'function') {
    goOnlineBtn.addEventListener('click', handleGoOnlineClick);
  }

  const offlineDurationSlider = document.getElementById('offlineDuration');
  const offlineDurationValueEl = document.getElementById('offlineDurationValue');
  const storedOfflineDuration = localStorage.getItem('offlineModeDuration');
  if (storedOfflineDuration) {
      window.offlineModeDuration = parseInt(storedOfflineDuration);
      if (offlineDurationSlider) offlineDurationSlider.value = window.offlineModeDuration;
      if (offlineDurationValueEl) {
          offlineDurationValueEl.textContent = window.offlineModeDuration > 3600 ? '∞ (Permanent)' : window.offlineModeDuration + 's';
      }
  }
  if (offlineDurationSlider) {
      offlineDurationSlider.addEventListener('input', handleOfflineDurationChange);
  }

  const showChatContextCheckbox = document.getElementById('showChatContextCheckbox');
  if (showChatContextCheckbox) {
    const stored = localStorage.getItem('showChatContextLogs') === 'true';
    window.showChatContextLogs = stored;
    showChatContextCheckbox.checked = stored;
    showChatContextCheckbox.addEventListener('change', handleShowChatContextLogsChange);
  }

  debugLog('Language, display, clock, navigation, voice, context, and debug settings listeners attached.', 'info');

  // Initialize chat controller (e.g., to add Enter key listener)
  if (typeof initChatController === 'function') {
    initChatController(); // From chat_controller.js
  } else {
    debugLog('AppInit: initChatController function not found.', 'warn');
  }

  // Initialize draggable panels (Chat and Debug)
  initializeDraggablePanels();

  // Initialize Speech-To-Text microphone
  if (typeof initSTT === 'function') initSTT();

  // Initialize mouse tracking once to prevent listener accumulation lag
  if (typeof initializeMouseTracking === 'function') {
    initializeMouseTracking();
  }

  debugLog('Application initialization complete.', 'info');

  document.getElementById('openModelGalleryBtn')?.addEventListener('click', ()=>{
    if (typeof trackEvent === 'function') trackEvent('model_gallery_opened');
    window.openModelGallery?.();
  });
  document.getElementById('resetLanguagesBtn')?.addEventListener('click', handleResetLanguages);

  // Trigger Kokoro background preloading (Fire and Forget)
  if (typeof window.preloadKokoroInBackground === 'function') {
    window.preloadKokoroInBackground();
  }

});

function makeElementDraggable(el, handle, storageKey) {
  if (!el || !handle) return;
  
  let xOffset = 0;
  let yOffset = 0;
  let isDragging = false;
  let initialX, initialY;

  // Load saved state
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const { x, y, width, height } = JSON.parse(saved);
      xOffset = x || 0;
      yOffset = y || 0;
      
      el.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
      if (width) el.style.width = width;
      if (height) el.style.height = height;
    }
  } catch(e) { debugLog(`Failed to restore element state for ${storageKey}: ${e.message}`, 'warn', true); }

  const saveState = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        x: xOffset,
        y: yOffset,
        width: el.style.width,
        height: el.style.height
      }));
    } catch (e) { debugLog(`Failed to persist element state ${storageKey}: ${e.message}`, 'warn', true); }
  };

  const dragStart = (e) => {
    const p = e.touches ? e.touches[0] : e;
    initialX = p.clientX - xOffset;
    initialY = p.clientY - yOffset;
    isDragging = true;
    el.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
  };

  const drag = (e) => {
    if (!isDragging) return;
    const p = e.touches ? e.touches[0] : e;
    
    let currentX = p.clientX - initialX;
    let currentY = p.clientY - initialY;
    
    // Clamp within screen boundaries
    const rect = el.getBoundingClientRect();
    currentX = Math.max(-rect.left + xOffset, Math.min(currentX, window.innerWidth - rect.right + xOffset));
    currentY = Math.max(-rect.top + yOffset, Math.min(currentY, window.innerHeight - rect.bottom + yOffset));

    xOffset = currentX;
    yOffset = currentY;
    el.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
  };

  const dragEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    el.classList.remove('dragging');
    document.body.style.cursor = '';
    saveState();
  };

  handle.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
  handle.addEventListener('touchstart', dragStart, {passive: true});
  document.addEventListener('touchmove', drag, {passive: false});
  document.addEventListener('touchend', dragEnd);
  
  new ResizeObserver(() => { if(!isDragging) saveState(); }).observe(el);
}

function initializeDraggablePanels() {
  const chatContainer = document.querySelector('.chat-container');
  const chatHeader = document.querySelector('.chat-header');
  makeElementDraggable(chatContainer, chatHeader, 'chatContainerState');

  const debugPanel = document.getElementById('debugPanel');
  const debugHeader = document.getElementById('debugHeader');
  makeElementDraggable(debugPanel, debugHeader, 'debugPanelState');
}

function setYouTubeSmallMode(enabled){
  const c=document.getElementById('bgYoutubeContainer');
  const h=document.getElementById('bgYoutubeHandle');
  const iframe=document.getElementById('bgYoutube');
  if(!c||!h) return;
  c.classList.toggle('small', !!enabled);
  c.classList.toggle('interactive', !!enabled);
  h.style.display = enabled ? 'block' : 'none';
  if(iframe && iframe.src){
    try{
      const u=new URL(iframe.src);
      u.searchParams.set('controls', enabled?'1':'0');
      iframe.src = u.toString();
    }catch(_){ debugLog(`Failed to update YouTube iframe URL: ${_.message}`, 'warn', true); }
  }
  if(!enabled){ c.style.removeProperty('left'); c.style.removeProperty('top'); c.style.removeProperty('width'); c.style.removeProperty('height'); }
  try{ localStorage.setItem('youtubeSmallMode', enabled?'true':'false'); }catch(_){ debugLog(`Failed to persist youtubeSmallMode: ${_.message}`, 'warn', true); }
}
