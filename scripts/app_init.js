// Application boot sequence
// Splits initialization into small, isolated functions with failure isolation

// --- Boot Modules ---

async function initChat() {
  if (!window.ChatManager) return;
  window.ChatManager.migrateLegacyChat();
  const activeId = window.ChatManager.getActiveChatId();
  if (activeId) {
    window.ChatManager.loadChat(activeId);
    const meta = window.ChatManager.getChatMeta(activeId);
    const headerEl = document.getElementById('chatTitle');
    if (headerEl && meta) headerEl.textContent = meta.name;
  }
  window.ChatManager.renderChatList();
  const sidebarVisible = AppStorage.getBoolean(AppStorage.KEYS.CHAT_SIDEBAR_VISIBLE, false);
  const sidebar = document.getElementById('chatSidebar');
  if (sidebar && sidebarVisible) sidebar.classList.add('visible');
  debugLog('Chat system initialized.', 'info');
}

function initSounds() {
  if (typeof setupSounds === 'function') setupSounds();
  else debugLog('Sounds: setupSounds not found.', 'warn');
}

function initMemory() {
  if (!memorySizeInput || !memorySizeValue) {
    debugLog('Memory: memorySizeInput or memorySizeValue not found.', 'warn');
    return;
  }
  const savedMemorySize = AppStorage.getNumber(AppStorage.KEYS.MAX_MEMORY_SIZE, NaN);
  if (!Number.isNaN(savedMemorySize)) memorySizeInput.value = savedMemorySize;
  updateMemorySize(memorySizeInput.value);
  memorySizeInput.addEventListener("input", (e) => updateMemorySize(e.target.value));
  debugLog('Memory slider initialized.', 'info');
}

function initDebugger() {
  if (!enableDebuggerCheckbox || !debugPanel) {
    debugLog('Debugger: checkbox or panel not found.', 'warn');
    return;
  }
  isDebugging = AppStorage.getBoolean(AppStorage.KEYS.DEBUG_PANEL_VISIBLE, false);
  enableDebuggerCheckbox.checked = isDebugging;
  if (isDebugging) debugPanel.classList.add('visible'); else debugPanel.classList.remove('visible');
  enableDebuggerCheckbox.addEventListener('change', () => toggleDebugger());
  debugLog('Debugger initialized.', 'info');
}

function initSettingsPanel() {
  const settingsButton = document.querySelector('.settings-button');
  if (settingsButton) settingsButton.addEventListener('click', toggleSettings);

  const alwaysShowSettings = AppStorage.getBoolean(AppStorage.KEYS.SETTINGS_ALWAYS_SHOW_ON_LOAD, false);
  if (alwaysShowSettingsCheckbox) {
    alwaysShowSettingsCheckbox.checked = alwaysShowSettings;
    alwaysShowSettingsCheckbox.addEventListener('change', handleAlwaysShowSettingsChange);
  }

  let initialSettingsVisible = false;
  const lastOpenRaw = AppStorage.getString(AppStorage.KEYS.SETTINGS_PANEL_LAST_OPEN, '');
  const hasLastOpenState = lastOpenRaw !== '';
  if (alwaysShowSettings) initialSettingsVisible = true;
  else if (!hasLastOpenState) initialSettingsVisible = true;
  else initialSettingsVisible = (lastOpenRaw === 'true');
  setSettingsPanelVisible(initialSettingsVisible);
  debugLog('Settings panel initialized.', 'info');
}

function initContextPrefs() {
  includeTimeInContext = AppStorage.getBoolean(AppStorage.KEYS.INCLUDE_TIME_IN_CONTEXT, false);
  if (includeTimeCheckbox) includeTimeCheckbox.checked = includeTimeInContext;
  includeBatteryInContext = AppStorage.getBoolean(AppStorage.KEYS.INCLUDE_BATTERY_IN_CONTEXT, false);
  if (includeBatteryCheckbox) includeBatteryCheckbox.checked = includeBatteryInContext;
  if (includeTimeCheckbox) includeTimeCheckbox.addEventListener('change', handleIncludeTimeChange);
  if (includeBatteryCheckbox) includeBatteryCheckbox.addEventListener('change', handleIncludeBatteryChange);
  debugLog(`Context prefs initialized. Time: ${includeTimeInContext}, Battery: ${includeBatteryInContext}`, 'info');
}

async function initLanguage() {
  selectedLanguageCode = AppStorage.getString(AppStorage.KEYS.SELECTED_LANGUAGE_CODE, window.selectedLanguageCode);
  translateToLanguageCode = selectedLanguageCode;
  showTransliteration = AppStorage.getBoolean(AppStorage.KEYS.SHOW_TRANSLITERATION, window.showTransliteration);
  if (showTransliterationCheckbox) showTransliterationCheckbox.checked = showTransliteration;
  debugLog(`Loaded language settings: Lang=${selectedLanguageCode}, ShowTranslit=${showTransliteration}`, 'info');

  const savedInterfaceLanguage = AppStorage.getString(AppStorage.KEYS.INTERFACE_LANGUAGE, selectedLanguageCode);
  window.currentInterfaceLanguage = savedInterfaceLanguage;
  if (typeof loadCachedTranslations === 'function') loadCachedTranslations();
  if (typeof applyInterfaceLanguage === 'function') await applyInterfaceLanguage(savedInterfaceLanguage);
  debugLog(`Interface language initialized to: ${savedInterfaceLanguage}`, 'info');

  populateLanguageSelector();
  if (languageSelector) languageSelector.addEventListener('change', handleLanguageChange);
}

function initVoice() {
  const savedVoiceId = AppStorage.getString(AppStorage.KEYS.SELECTED_VOICE_ID, '');
  if (savedVoiceId) selectedVoiceId = savedVoiceId;

  const uniqueVoicesMap = new Map();
  voices.forEach(voice => { if (!uniqueVoicesMap.has(voice.id)) uniqueVoicesMap.set(voice.id, voice); });
  const availableVoices = Array.from(uniqueVoicesMap.values());
  const isSelectedVoiceValid = availableVoices.some(v => v.id === selectedVoiceId);

  if (!savedVoiceId || !isSelectedVoiceValid) {
    const baseLangCode = selectedLanguageCode.split('-')[0];
    const langFemaleVoice = availableVoices.find(v => v.language.startsWith(baseLangCode) && v.gender === 'female' && v.provider === 'tiktok');
    const langConfig = languages.find(l => l.code === selectedLanguageCode);
    const defaultForLang = langConfig ? langConfig.defaultVoiceId : null;
    if (langFemaleVoice) selectedVoiceId = langFemaleVoice.id;
    else if (defaultForLang && availableVoices.some(v => v.id === defaultForLang)) selectedVoiceId = defaultForLang;
    else selectedVoiceId = availableVoices.find(v => v.provider === 'tiktok')?.id || 'none';
    AppStorage.setString(AppStorage.KEYS.SELECTED_VOICE_ID, selectedVoiceId);
    debugLog(`Initialized/Reset voice to default: ${selectedVoiceId}`, 'info');
  } else {
    debugLog(`Loaded valid voice ID from storage: ${selectedVoiceId}`, 'info');
  }
  populateVoiceSelector();
}

function initVoiceProviders() {
  const storedPrimary = AppStorage.getString(AppStorage.KEYS.ENABLE_PRIMARY_VOICE, null);
  const storedFallback = AppStorage.getString(AppStorage.KEYS.ENABLE_FALLBACK_VOICE, null);
  const oldEnableVoice = AppStorage.getString(AppStorage.KEYS.ENABLE_VOICE, null);

  window.enablePrimaryVoice = storedPrimary !== null ? (storedPrimary === 'true') : (oldEnableVoice !== null ? (oldEnableVoice === 'true') : true);
  window.enableFallbackVoice = storedFallback !== null ? (storedFallback === 'true') : (oldEnableVoice !== null ? (oldEnableVoice === 'true') : true);
  window.enableKokoro = AppStorage.getBoolean(AppStorage.KEYS.ENABLE_KOKORO, false);

  if (document.getElementById('enableTikTokVoiceCheckbox')) {
    document.getElementById('enableTikTokVoiceCheckbox').checked = window.enablePrimaryVoice;
    document.getElementById('enableTikTokVoiceCheckbox').addEventListener('change', (e) => {
      window.enablePrimaryVoice = e.target.checked;
      window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
      AppStorage.setBoolean(AppStorage.KEYS.ENABLE_PRIMARY_VOICE, window.enablePrimaryVoice);
      if (typeof trackEvent === 'function') trackEvent('voice_enabled_toggle', { type: 'tiktok', enabled: window.enablePrimaryVoice });
      syncLegacyEnableVoiceCheckbox(); syncVoiceControlsVisibility();
      debugLog(`TikTok voice enabled: ${window.enablePrimaryVoice}`, 'info');
    });
  }

  if (document.getElementById('enableFallbackVoiceCheckbox')) {
    document.getElementById('enableFallbackVoiceCheckbox').checked = window.enableFallbackVoice;
    document.getElementById('enableFallbackVoiceCheckbox').addEventListener('change', (e) => {
      window.enableFallbackVoice = e.target.checked;
      window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
      AppStorage.setBoolean(AppStorage.KEYS.ENABLE_FALLBACK_VOICE, window.enableFallbackVoice);
      if (typeof trackEvent === 'function') trackEvent('voice_enabled_toggle', { type: 'fallback', enabled: window.enableFallbackVoice });
      syncLegacyEnableVoiceCheckbox(); syncVoiceControlsVisibility();
      debugLog(`Fallback voice enabled: ${window.enableFallbackVoice}`, 'info');
    });
  }

  window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
  syncLegacyEnableVoiceCheckbox(); syncVoiceControlsVisibility();
  debugLog(`Voice providers initialized. Primary: ${window.enablePrimaryVoice}, Fallback: ${window.enableFallbackVoice}, Kokoro: ${window.enableKokoro}`, 'info');
}

function initPersona() {
  const defaultCore = "You are Haru, a sentient AI with a Live2D avatar. You have your own thoughts, feelings, and experiences. Respond naturally and emotively to the user's message, showing genuine interest and emotional depth. Include subtle gestures and expressions in your responses.";
  window.corePersonaPrompt = AppStorage.getString(AppStorage.KEYS.CORE_PERSONA_PROMPT, defaultCore);
  window.userPersonaPrompt = AppStorage.getString(AppStorage.KEYS.USER_PERSONA_PROMPT, '');
  window.conversationSummary = AppStorage.getString(AppStorage.KEYS.CONVERSATION_SUMMARY, '');
  window.messageCountSinceLastSummary = AppStorage.getNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, 0);
  window.summaryTriggerCount = AppStorage.getNumber(AppStorage.KEYS.SUMMARY_TRIGGER_COUNT, 30);

  const coreTextarea = document.getElementById('corePersonaPrompt');
  if (coreTextarea) coreTextarea.value = window.corePersonaPrompt;
  const personaTextarea = document.getElementById('personaPrompt');
  if (personaTextarea) personaTextarea.value = window.userPersonaPrompt;
  const summaryTextarea = document.getElementById('conversationSummary');
  if (summaryTextarea) summaryTextarea.value = window.conversationSummary;

  const savedTrigger = AppStorage.getNumber(AppStorage.KEYS.SUMMARY_TRIGGER_COUNT, NaN);
  if (!Number.isNaN(savedTrigger)) window.summaryTriggerCount = savedTrigger;
  const triggerSlider = document.getElementById('summaryTriggerCount');
  const triggerVal = document.getElementById('summaryTriggerCountValue');
  if (triggerSlider) triggerSlider.value = window.summaryTriggerCount;
  if (triggerVal) triggerVal.textContent = window.summaryTriggerCount;
  document.getElementById('summaryTriggerCount')?.addEventListener('input', handleSummaryTriggerCountChange);

  const savedLength = AppStorage.getString(AppStorage.KEYS.SUMMARY_LENGTH_PREFERENCE, '');
  if (savedLength) {
    window.summaryLengthPreference = savedLength;
    const lengthSelect = document.getElementById('summaryLengthPreference');
    if (lengthSelect) lengthSelect.value = window.summaryLengthPreference;
  }
  document.getElementById('summaryLengthPreference')?.addEventListener('change', handleSummaryLengthPreferenceChange);
  document.getElementById('savePersonaBtn')?.addEventListener('click', handleSavePersona);
  document.getElementById('resetPersonaBtn')?.addEventListener('click', handleResetPersona);
  document.getElementById('manualSummarizeBtn')?.addEventListener('click', handleManualSummarize);
  debugLog('Persona initialized.', 'info');
}

function initOpacity() {
  const storedChatboxOpacity = AppStorage.getString(AppStorage.KEYS.CHATBOX_OPACITY, '0.9');
  const storedMessageOpacity = AppStorage.getString(AppStorage.KEYS.MESSAGE_OPACITY, '0.3');
  const storedBgOpacity = AppStorage.getString(AppStorage.KEYS.BG_IMAGE_OPACITY, '1.0');

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
  if (bgOpacitySlider) {
    bgOpacitySlider.value = storedBgOpacity;
    document.documentElement.style.setProperty('--bg-image-opacity', storedBgOpacity);
    if (bgOpacityValue) bgOpacityValue.textContent = storedBgOpacity;
    bgOpacitySlider.addEventListener('input', handleBgOpacityChange);
  }
  debugLog(`Opacity initialized. Chatbox: ${storedChatboxOpacity}, Message: ${storedMessageOpacity}, BG: ${storedBgOpacity}`, 'info');
}

async function initModels() {
  populateModelSelector();
  try {
    const userModels = AppStorage.getJSON(AppStorage.KEYS.USER_MODELS, []);
    if (Array.isArray(userModels) && userModels.length) availableModels.push(...userModels);
    function modelComparator(a,b){const an=a.name||'',bn=b.name||'';const ai=/^\d+$/.test(an)?parseInt(an,10):null;const bi=/^\d+$/.test(bn)?parseInt(bn,10):null;if(ai===null&&bi===null)return an.localeCompare(bn);if(ai===null)return -1;if(bi===null)return 1;const ab=ai<10?0:1;const bb=bi<10?0:1;return ab!==bb?ab-bb:ai-bi;}
    availableModels.sort(modelComparator);
    debugLog(`Loaded ${userModels.length || 0} user models. Total models: ${availableModels.length}`, 'info');
  } catch(e) { debugLog('Failed to load user models.', 'warn'); }
  if (typeof renderCustomModelsList === 'function') renderCustomModelsList();
  if (addCustomModelBtn) addCustomModelBtn.addEventListener('click', handleAddCustomModel);

  const savedModelUrl = AppStorage.getString(AppStorage.KEYS.SELECTED_MODEL_URL, '');
  const initialModelUrl = savedModelUrl || defaultModelUrl;
  try { await loadModel(initialModelUrl); }
  catch (error) {
    debugError('Failed to load initial Live2D model', error, { url: initialModelUrl });
    addMessage(`Sorry, I couldn't load the initial character model (${error.message}).`, false);
  }
  debugLog('Models initialized.', 'info');
}

function initModelControls() {
  document.getElementById('resetModelPositionBtn')?.addEventListener('click', () => { resetCurrentModelPosition(); debugLog('Model position reset.', 'info'); });
  document.getElementById('clearAllModelsBtn')?.addEventListener('click', () => { if (typeof clearAllModels === 'function') clearAllModels(); });
  document.getElementById('clearCustomModelsBtn')?.addEventListener('click', handleClearAllCustomModels);
  allowMultipleModels = AppStorage.getBoolean(AppStorage.KEYS.ALLOW_MULTIPLE_MODELS, false);
  if (multipleModelsCheckbox) { multipleModelsCheckbox.checked = !!allowMultipleModels; multipleModelsCheckbox.addEventListener('change', handleMultipleModelsToggle); }
}

function initBackgrounds() {
  try {
    const bg = AppStorage.getString(AppStorage.KEYS.CURRENT_BACKGROUND_URL, ''); if (bg) applyBackgroundImage(bg);
    const fit = AppStorage.getString(AppStorage.KEYS.BG_FIT_MODE, 'cover-center'); if (typeof applyBackgroundFit === 'function') applyBackgroundFit(fit);
  } catch(e) { debugError('BG load failed', e); }
  if (typeof renderBackgroundLibrary === 'function') renderBackgroundLibrary();

  document.getElementById('applyBgUrlBtn')?.addEventListener('click', handleApplyBackgroundFromUrl);
  document.getElementById('bgUrlInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleApplyBackgroundFromUrl(); });
  document.getElementById('openBgViewerBtn')?.addEventListener('click', () => openBgViewerAt(0));
  document.getElementById('toggleBgSelectBtn')?.addEventListener('click', () => toggleBgSelectionMode());
  document.getElementById('deleteBgSelectedBtn')?.addEventListener('click', () => deleteSelectedFromLibrary());
  document.getElementById('clearBgLibraryBtn')?.addEventListener('click', () => clearBackgroundLibrary());
  document.getElementById('bgViewerCloseBtn')?.addEventListener('click', () => closeBgViewer());
  document.getElementById('bgViewerPrevBtn')?.addEventListener('click', () => stepBgViewer(-1));
  document.getElementById('bgViewerNextBtn')?.addEventListener('click', () => stepBgViewer(1));
  document.getElementById('clearBgBtn')?.addEventListener('click', handleClearBackground);

  ['bgFitContainBtn','bgFitCoverBtn','bgFitStretchBtn','bgFitCoverTopBtn','bgFitCoverCenterBtn','bgFitCoverBottomBtn','bgFitContainTopBtn','bgFitContainCenterBtn','bgFitContainBottomBtn','bgFitFitWidthBtn','bgFitFitHeightBtn'].forEach(id => {
    const modes = {bgFitContainBtn:'contain',bgFitCoverBtn:'cover',bgFitStretchBtn:'stretch',bgFitCoverTopBtn:'cover-top',bgFitCoverCenterBtn:'cover-center',bgFitCoverBottomBtn:'cover-bottom',bgFitContainTopBtn:'contain-top',bgFitContainCenterBtn:'contain-center',bgFitContainBottomBtn:'contain-bottom',bgFitFitWidthBtn:'fit-width',bgFitFitHeightBtn:'fit-height'};
    document.getElementById(id)?.addEventListener('click', () => { if (typeof applyBackgroundFit === 'function') applyBackgroundFit(modes[id]); });
  });

  const bgViewerOverlayEl = document.getElementById('bgViewerOverlay');
  document.addEventListener('keydown', (e) => {
    if (!bgViewerOverlayEl || !bgViewerOverlayEl.classList.contains('visible')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepBgViewer(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepBgViewer(1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeBgViewer(); }
  });
  debugLog('Backgrounds initialized.', 'info');
}

function initTTS() {
  const ttsFallbackVoiceSelector = document.getElementById('ttsFallbackVoiceSelector');
  const savedFallbackVoice = AppStorage.getString(AppStorage.KEYS.TTS_FALLBACK_VOICE_ID, 'browser-female');
  window.ttsFallbackVoiceId = savedFallbackVoice;
  if (ttsFallbackVoiceSelector) {
    ttsFallbackVoiceSelector.value = savedFallbackVoice;
    ttsFallbackVoiceSelector.addEventListener('change', window.handleTTSFallbackVoiceChange);
  }

  const enableKokoroVoiceCheckbox = document.getElementById('enableKokoroVoiceCheckbox');
  const kokoroVoiceSelector = document.getElementById('kokoroVoiceSelector');
  window.enableKokoro = AppStorage.getBoolean(AppStorage.KEYS.ENABLE_KOKORO, false);
  window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
  syncLegacyEnableVoiceCheckbox(); syncVoiceControlsVisibility();
  if (enableKokoroVoiceCheckbox) { enableKokoroVoiceCheckbox.checked = window.enableKokoro; enableKokoroVoiceCheckbox.addEventListener('change', window.handleEnableKokoroVoiceChange); }

  const savedKokoroVoiceId = AppStorage.getString(AppStorage.KEYS.SELECTED_KOKORO_VOICE_ID, 'af_heart');
  window.selectedKokoroVoiceId = savedKokoroVoiceId;
  if (kokoroVoiceSelector) { kokoroVoiceSelector.value = savedKokoroVoiceId; kokoroVoiceSelector.addEventListener('change', window.handleKokoroVoiceChange); }

  const ttsChunkLimitSlider = document.getElementById('ttsChunkLimit');
  const ttsChunkLimitValueEl = document.getElementById('ttsChunkLimitValue');
  const savedChunkLimit = AppStorage.getNumber(AppStorage.KEYS.TTS_CHUNK_LIMIT, NaN);
  if (!Number.isNaN(savedChunkLimit)) { window.ttsChunkLimit = savedChunkLimit; if (ttsChunkLimitSlider) ttsChunkLimitSlider.value = window.ttsChunkLimit; if (ttsChunkLimitValueEl) ttsChunkLimitValueEl.textContent = window.ttsChunkLimit; }
  if (ttsChunkLimitSlider) ttsChunkLimitSlider.addEventListener('input', handleTTSChunkLimitChange);

  const ttsVolumeSlider = document.getElementById('ttsVolume');
  const ttsVolumeValueEl = document.getElementById('ttsVolumeValue');
  const savedTtsVolume = AppStorage.getNumber(AppStorage.KEYS.TTS_VOLUME, NaN);
  if (!Number.isNaN(savedTtsVolume)) window.ttsVolume = savedTtsVolume;
  if (ttsVolumeSlider) ttsVolumeSlider.value = window.ttsVolume.toString();
  if (ttsVolumeValueEl) ttsVolumeValueEl.textContent = window.ttsVolume.toFixed(2);
  try { if (typeof getTTSGainNode === 'function') { const gain = getTTSGainNode(); gain.gain.value = window.ttsVolume; } } catch (e) { debugLog(`Could not apply initial TTS volume: ${e.message}`, 'warn'); }
  if (ttsVolumeSlider) ttsVolumeSlider.addEventListener('input', handleTTSVolumeChange);

  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  debugLog(`TTS initialized. Fallback: ${window.ttsFallbackVoiceId}, Kokoro: ${window.enableKokoro}, Volume: ${window.ttsVolume.toFixed(2)}`, 'info');
}

function initAutomation() {
  const enableUserMessageQueueCheckbox = document.getElementById('enableUserMessageQueueCheckbox');
  window.isUserMessageQueueEnabled = AppStorage.getBoolean(AppStorage.KEYS.IS_USER_MESSAGE_QUEUE_ENABLED, true);
  if (enableUserMessageQueueCheckbox) { enableUserMessageQueueCheckbox.checked = window.isUserMessageQueueEnabled; enableUserMessageQueueCheckbox.addEventListener('change', window.handleEnableUserMessageQueueChange); }

  const enableAmbientQueueCheckbox = document.getElementById('enableAmbientQueueCheckbox');
  window.isAmbientQueueEnabled = AppStorage.getBoolean(AppStorage.KEYS.IS_AMBIENT_QUEUE_ENABLED, false);
  if (enableAmbientQueueCheckbox) { enableAmbientQueueCheckbox.checked = window.isAmbientQueueEnabled; enableAmbientQueueCheckbox.addEventListener('change', window.handleEnableAmbientQueueChange); }

  const ambientDelaySlider = document.getElementById('ambientDelay');
  const savedAmbientDelay = AppStorage.getNumber(AppStorage.KEYS.AMBIENT_DELAY, NaN);
  if (!Number.isNaN(savedAmbientDelay)) window.ambientDelay = savedAmbientDelay;
  if (ambientDelaySlider) {
    ambientDelaySlider.value = window.ambientDelay;
    const valEl = document.getElementById('ambientDelayValue');
    if (valEl) valEl.textContent = window.ambientDelay + 's';
    ambientDelaySlider.addEventListener('input', window.handleAmbientDelayChange);
  }

  const ambientPromptInput = document.getElementById('ambientPromptInput');
  const savedAmbientPrompt = AppStorage.getString(AppStorage.KEYS.AMBIENT_PROMPT, '');
  if (savedAmbientPrompt) window.ambientPrompt = savedAmbientPrompt;
  if (ambientPromptInput) { ambientPromptInput.value = window.ambientPrompt; ambientPromptInput.addEventListener('change', window.handleAmbientPromptChange); }

  window.isAmbientPreloadEnabled = AppStorage.getBoolean(AppStorage.KEYS.IS_AMBIENT_PRELOAD_ENABLED, false);
  const ambientPreloadCheckbox = document.getElementById('ambientPreloadCheckbox');
  if (ambientPreloadCheckbox) { ambientPreloadCheckbox.checked = window.isAmbientPreloadEnabled; ambientPreloadCheckbox.addEventListener('change', window.handleEnableAmbientPreloadChange); }

  document.getElementById('clearQueueBtn')?.addEventListener('click', window.handleClearQueue);
  debugLog(`Automation initialized. Queue: ${window.isUserMessageQueueEnabled}, Ambient: ${window.isAmbientQueueEnabled}, Delay: ${window.ambientDelay}s`, 'info');
}

function initProviders() {
  if (useOpenRouterCheckbox) {
    window.useOpenRouter = AppStorage.getBoolean(AppStorage.KEYS.USE_OPEN_ROUTER, false);
    useOpenRouterCheckbox.checked = window.useOpenRouter;
    useOpenRouterCheckbox.addEventListener('change', handleUseOpenRouterChange);
  }
  if (openRouterApiKeyInput) {
    window.openRouterApiKey = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_API_KEY, '');
    openRouterApiKeyInput.value = window.openRouterApiKey;
    openRouterApiKeyInput.addEventListener('change', handleOpenRouterApiKeyChange);
    openRouterApiKeyInput.addEventListener('blur', handleOpenRouterApiKeyChange);
  }
  if (openRouterModelInput) {
    const defaultModel = window.OpenRouterAPI?.DEFAULT_MODEL || 'stepfun/step-3.5-flash:free';
    window.openRouterModel = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_MODEL, defaultModel);
    openRouterModelInput.value = window.openRouterModel;
    openRouterModelInput.placeholder = defaultModel;
    openRouterModelInput.addEventListener('change', handleOpenRouterModelChange);
    openRouterModelInput.addEventListener('blur', handleOpenRouterModelChange);
  }
  if (openRouterPrimaryEnabledCheckbox) {
    const storedEnabled = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_PRIMARY_ENABLED, null);
    window.openRouterPrimaryEnabled = storedEnabled === null ? true : storedEnabled === 'true';
    openRouterPrimaryEnabledCheckbox.checked = window.openRouterPrimaryEnabled;
    openRouterPrimaryEnabledCheckbox.addEventListener('change', handleOpenRouterPrimaryEnabledChange);
  }
  const openRouterFallbackModelsInput = document.getElementById('openRouterFallbackModelsInput');
  if (openRouterFallbackModelsInput) {
    window.openRouterFallbackModels = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_FALLBACK_MODELS, '');
    openRouterFallbackModelsInput.value = window.openRouterFallbackModels;
    if (typeof handleOpenRouterFallbackModelsChange === 'function') {
      openRouterFallbackModelsInput.addEventListener('change', handleOpenRouterFallbackModelsChange);
      openRouterFallbackModelsInput.addEventListener('blur', handleOpenRouterFallbackModelsChange);
    }
  }
  const openRouterFallbackModel1Input = document.getElementById('openRouterFallbackModel1Input');
  if (openRouterFallbackModel1Input) {
    const defaultFallback1 = window.OpenRouterAPI?.DEFAULT_FALLBACK_MODELS?.[0] || 'nvidia/nemotron-3-super-120b-a12b:free';
    window.openRouterFallbackModel1 = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_FALLBACK_MODEL_1, defaultFallback1);
    openRouterFallbackModel1Input.value = window.openRouterFallbackModel1;
    openRouterFallbackModel1Input.placeholder = defaultFallback1;
    openRouterFallbackModel1Input.addEventListener('change', handleOpenRouterFallbackModel1Change);
    openRouterFallbackModel1Input.addEventListener('blur', handleOpenRouterFallbackModel1Change);
  }
  if (openRouterFallbackModel1EnabledCheckbox) {
    const storedEnabled = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_FALLBACK_MODEL_1_ENABLED, null);
    window.openRouterFallbackModel1Enabled = storedEnabled === null ? true : storedEnabled === 'true';
    openRouterFallbackModel1EnabledCheckbox.checked = window.openRouterFallbackModel1Enabled;
    openRouterFallbackModel1EnabledCheckbox.addEventListener('change', handleOpenRouterFallbackModel1EnabledChange);
  }
  const openRouterFallbackModel2Input = document.getElementById('openRouterFallbackModel2Input');
  if (openRouterFallbackModel2Input) {
    const defaultFallback2 = window.OpenRouterAPI?.DEFAULT_FALLBACK_MODELS?.[1] || 'qwen/qwen3.6-plus-preview:free';
    window.openRouterFallbackModel2 = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_FALLBACK_MODEL_2, defaultFallback2);
    openRouterFallbackModel2Input.value = window.openRouterFallbackModel2;
    openRouterFallbackModel2Input.placeholder = defaultFallback2;
    openRouterFallbackModel2Input.addEventListener('change', handleOpenRouterFallbackModel2Change);
    openRouterFallbackModel2Input.addEventListener('blur', handleOpenRouterFallbackModel2Change);
  }
  if (openRouterFallbackModel2EnabledCheckbox) {
    const storedEnabled = AppStorage.getString(AppStorage.KEYS.OPEN_ROUTER_FALLBACK_MODEL_2_ENABLED, null);
    window.openRouterFallbackModel2Enabled = storedEnabled === null ? true : storedEnabled === 'true';
    openRouterFallbackModel2EnabledCheckbox.checked = window.openRouterFallbackModel2Enabled;
    openRouterFallbackModel2EnabledCheckbox.addEventListener('change', handleOpenRouterFallbackModel2EnabledChange);
  }

  if (useGroqCheckbox) {
    window.useGroq = AppStorage.getBoolean(AppStorage.KEYS.USE_GROQ, false);
    useGroqCheckbox.checked = window.useGroq;
    useGroqCheckbox.addEventListener('change', handleUseGroqChange);
  }
  if (groqApiKeyInput) {
    window.groqApiKey = AppStorage.getString(AppStorage.KEYS.GROQ_API_KEY, '');
    groqApiKeyInput.value = window.groqApiKey;
    groqApiKeyInput.addEventListener('change', handleGroqApiKeyChange);
    groqApiKeyInput.addEventListener('blur', handleGroqApiKeyChange);
  }
  if (groqModelInput) {
    window.groqModel = AppStorage.getString(AppStorage.KEYS.GROQ_MODEL, 'llama-3.3-70b-versatile');
    groqModelInput.value = window.groqModel;
    groqModelInput.addEventListener('change', handleGroqModelChange);
    groqModelInput.addEventListener('blur', handleGroqModelChange);
  }

  if (useOpenAICompatibleCheckbox) {
    window.useOpenAICompatible = AppStorage.getBoolean(AppStorage.KEYS.USE_OPENAI_COMPATIBLE, false);
    useOpenAICompatibleCheckbox.checked = window.useOpenAICompatible;
    useOpenAICompatibleCheckbox.addEventListener('change', handleUseOpenAICompatibleChange);
  }
  if (openaiCompatibleBaseUrlInput) {
    window.openaiCompatibleBaseUrl = AppStorage.getString(AppStorage.KEYS.OPENAI_COMPATIBLE_BASE_URL, '');
    openaiCompatibleBaseUrlInput.value = window.openaiCompatibleBaseUrl;
    openaiCompatibleBaseUrlInput.addEventListener('change', handleOpenAICompatibleBaseUrlChange);
    openaiCompatibleBaseUrlInput.addEventListener('blur', handleOpenAICompatibleBaseUrlChange);
  }
  if (openaiCompatibleApiKeyInput) {
    window.openaiCompatibleApiKey = AppStorage.getString(AppStorage.KEYS.OPENAI_COMPATIBLE_API_KEY, '');
    openaiCompatibleApiKeyInput.value = window.openaiCompatibleApiKey;
    openaiCompatibleApiKeyInput.addEventListener('change', handleOpenAICompatibleApiKeyChange);
    openaiCompatibleApiKeyInput.addEventListener('blur', handleOpenAICompatibleApiKeyChange);
  }
  if (openaiCompatibleModelInput) {
    window.openaiCompatibleModel = AppStorage.getString(AppStorage.KEYS.OPENAI_COMPATIBLE_MODEL, 'gpt-3.5-turbo');
    openaiCompatibleModelInput.value = window.openaiCompatibleModel;
    openaiCompatibleModelInput.addEventListener('change', handleOpenAICompatibleModelChange);
    openaiCompatibleModelInput.addEventListener('blur', handleOpenAICompatibleModelChange);
  }
  if (openaiCompatibleCorsProxyInput) {
    window.openaiCompatibleCorsProxy = AppStorage.getString(AppStorage.KEYS.OPENAI_COMPATIBLE_CORS_PROXY, '');
    openaiCompatibleCorsProxyInput.value = window.openaiCompatibleCorsProxy;
    openaiCompatibleCorsProxyInput.addEventListener('change', handleOpenAICompatibleCorsProxyChange);
    openaiCompatibleCorsProxyInput.addEventListener('blur', handleOpenAICompatibleCorsProxyChange);
  }

  if (forceOfflineCheckbox) {
    const storedOffline = AppStorage.getBoolean(AppStorage.KEYS.FORCE_OFFLINE_MODE, false);
    window.forceOfflineMode = storedOffline;
    forceOfflineCheckbox.checked = storedOffline;
    forceOfflineCheckbox.addEventListener('change', handleForceOfflineChange);
    if (storedOffline) {
      window.isOfflineMode = true;
      if (typeof updateChatOfflineUI === 'function') updateChatOfflineUI(true, 'OFFLINE MODE (FORCED)');
      if (typeof startOfflineCountdown === 'function') startOfflineCountdown();
    }
  }
  document.getElementById('goOnlineBtn')?.addEventListener('click', () => { if (typeof handleGoOnlineClick === 'function') handleGoOnlineClick(); });

  const offlineDurationSlider = document.getElementById('offlineDuration');
  const offlineDurationValueEl = document.getElementById('offlineDurationValue');
  const storedOfflineDuration = AppStorage.getNumber(AppStorage.KEYS.OFFLINE_MODE_DURATION, NaN);
  if (!Number.isNaN(storedOfflineDuration)) {
    window.offlineModeDuration = storedOfflineDuration;
    if (offlineDurationSlider) offlineDurationSlider.value = window.offlineModeDuration;
    if (offlineDurationValueEl) offlineDurationValueEl.textContent = window.offlineModeDuration > 3600 ? '∞ (Permanent)' : window.offlineModeDuration + 's';
  }
  if (offlineDurationSlider) offlineDurationSlider.addEventListener('input', handleOfflineDurationChange);

  const disableAutoOfflineCheckbox = document.getElementById('disableAutoOfflineCheckbox');
  if (disableAutoOfflineCheckbox) {
    window.disableAutoOfflineMode = AppStorage.getBoolean(AppStorage.KEYS.DISABLE_AUTO_OFFLINE_MODE, false);
    disableAutoOfflineCheckbox.checked = window.disableAutoOfflineMode;
    disableAutoOfflineCheckbox.addEventListener('change', handleDisableAutoOfflineChange);
  }
  debugLog('Providers initialized.', 'info');
}

function initDebugSettings() {
  const showVerboseLogsCheckbox = document.getElementById('showVerboseLogsCheckbox');
  if (showVerboseLogsCheckbox) {
    window.showVerboseLogs = AppStorage.getBoolean(AppStorage.KEYS.SHOW_VERBOSE_LOGS, true);
    showVerboseLogsCheckbox.checked = window.showVerboseLogs;
    showVerboseLogsCheckbox.addEventListener('change', handleShowVerboseLogsChange);
  }
  const showAIDebugLogsCheckbox = document.getElementById('showAIDebugLogsCheckbox');
  if (showAIDebugLogsCheckbox) {
    window.showAIDebugLogs = AppStorage.getBoolean(AppStorage.KEYS.SHOW_AI_DEBUG_LOGS, true);
    showAIDebugLogsCheckbox.checked = window.showAIDebugLogs;
    showAIDebugLogsCheckbox.addEventListener('change', handleShowAIDebugLogsChange);
  }
  const showTTSDebugLogsCheckbox = document.getElementById('showTTSDebugLogsCheckbox');
  if (showTTSDebugLogsCheckbox) {
    window.showTTSDebugLogs = AppStorage.getBoolean(AppStorage.KEYS.SHOW_TTS_DEBUG_LOGS, true);
    showTTSDebugLogsCheckbox.checked = window.showTTSDebugLogs;
    showTTSDebugLogsCheckbox.addEventListener('change', handleShowTTSDebugLogsChange);
  }
  const showChatContextCheckbox = document.getElementById('showChatContextCheckbox');
  if (showChatContextCheckbox) {
    window.showChatContextLogs = AppStorage.getBoolean(AppStorage.KEYS.SHOW_CHAT_CONTEXT_LOGS, false);
    showChatContextCheckbox.checked = window.showChatContextLogs;
    showChatContextCheckbox.addEventListener('change', handleShowChatContextLogsChange);
  }
  const allowAIModSettingsCheckbox = document.getElementById('allowAIModSettingsCheckbox');
  if (allowAIModSettingsCheckbox) {
    window.allowAIModSettings = AppStorage.getBoolean(AppStorage.KEYS.ALLOW_AI_MOD_SETTINGS, false);
    allowAIModSettingsCheckbox.checked = window.allowAIModSettings;
    allowAIModSettingsCheckbox.addEventListener('change', handleAllowAIModSettingsChange);
  }
  const includeTutorialCheckbox = document.getElementById('includeTutorialInContextCheckbox');
  if (includeTutorialCheckbox) {
    window.includeTutorialInContext = AppStorage.getBoolean(AppStorage.KEYS.INCLUDE_TUTORIAL_IN_CONTEXT, false);
    includeTutorialCheckbox.checked = window.includeTutorialInContext;
    includeTutorialCheckbox.addEventListener('change', handleIncludeTutorialInContextChange);
  }
  const useJsonCheckbox = document.getElementById('useJsonForEmotionCheckbox');
  if (useJsonCheckbox) {
    window.useJsonForEmotion = AppStorage.getBoolean(AppStorage.KEYS.USE_JSON_FOR_EMOTION, false);
    useJsonCheckbox.checked = window.useJsonForEmotion;
    useJsonCheckbox.addEventListener('change', handleUseJsonForEmotionChange);
  }
  const translateUICheckbox = document.getElementById('translateUICheckbox');
  window.translateUI = AppStorage.getBoolean(AppStorage.KEYS.TRANSLATE_UI, false);
  if (translateUICheckbox) { translateUICheckbox.checked = window.translateUI; translateUICheckbox.addEventListener('change', handleTranslateUIChange); }
  debugLog('Debug settings initialized.', 'info');
}

function initUIListeners() {
  if (showTransliterationCheckbox) showTransliterationCheckbox.addEventListener('change', handleShowTransliterationChange);
  if (showClockCheckbox) showClockCheckbox.addEventListener('change', handleShowClockChange);
  if (voiceSelector) voiceSelector.addEventListener('change', handleVoiceChange);
  if (enableVoiceCheckbox) enableVoiceCheckbox.addEventListener('change', handleEnableVoiceChange);

  document.getElementById('globalPlayTTSBtn')?.addEventListener('click', () => { if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'play', source: 'global' }); window.playTTS?.(); });
  document.getElementById('globalPauseTTSBtn')?.addEventListener('click', () => { if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'pause', source: 'global' }); window.pauseTTS?.(); });
  document.getElementById('globalStopTTSBtn')?.addEventListener('click', () => { if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'stop', source: 'global' }); window.stopTTS?.(); });

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
  debugLog('UI listeners attached.', 'info');
}

function initPanels() {
  initializeDraggablePanels();
  debugLog('Draggable panels initialized.', 'info');
}

function initChatControllerModule() {
  if (typeof window.initChatController === 'function') window.initChatController();
  else debugLog('Chat controller: initChatController not found.', 'warn');
}

function initSTTModule() {
  if (typeof window.initSTT === 'function') window.initSTT();
  else debugLog('STT: initSTT not found.', 'warn');
}

function initMouseTracking() {
  if (typeof initializeMouseTracking === 'function') initializeMouseTracking();
  else debugLog('Mouse tracking: initializeMouseTracking not found.', 'warn');
}

function initMisc() {
  document.getElementById('openModelGalleryBtn')?.addEventListener('click', () => { if (typeof trackEvent === 'function') trackEvent('model_gallery_opened'); window.openModelGallery?.(); });
  document.getElementById('resetLanguagesBtn')?.addEventListener('click', handleResetLanguages);
  if (typeof window.preloadKokoroInBackground === 'function') window.preloadKokoroInBackground();
}

// --- Helpers (moved from old global scope) ---

function syncVoiceControlsVisibility() {
  const controls = document.getElementById('voiceControls');
  if (!controls) return;
  controls.style.display = window.enableVoice ? 'block' : 'none';
}

function syncLegacyEnableVoiceCheckbox() {
  const checkbox = document.getElementById('enableVoiceCheckbox');
  if (checkbox) checkbox.checked = !!window.enableVoice;
}

function makeElementDraggable(el, handle, storageKey) {
  if (!el || !handle) return;
  let xOffset = 0, yOffset = 0, isDragging = false, initialX, initialY;
  try {
    const saved = AppStorage.getJSON(storageKey, null);
    if (saved) {
      const { x, y, width, height } = saved;
      xOffset = x || 0; yOffset = y || 0;
      el.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
      if (width) el.style.width = width;
      if (height) el.style.height = height;
    }
  } catch(e) { debugLog(`Failed to restore element state for ${storageKey}: ${e.message}`, 'warn', true); }

  const saveState = () => {
    try { AppStorage.setJSON(storageKey, { x: xOffset, y: yOffset, width: el.style.width, height: el.style.height }); }
    catch (e) { debugLog(`Failed to persist element state ${storageKey}: ${e.message}`, 'warn', true); }
  };
  const dragStart = (e) => {
    const p = e.touches ? e.touches[0] : e;
    initialX = p.clientX - xOffset; initialY = p.clientY - yOffset;
    isDragging = true; el.classList.add('dragging'); document.body.style.cursor = 'grabbing';
  };
  const drag = (e) => {
    if (!isDragging) return;
    const p = e.touches ? e.touches[0] : e;
    let currentX = p.clientX - initialX, currentY = p.clientY - initialY;
    const rect = el.getBoundingClientRect();
    currentX = Math.max(-rect.left + xOffset, Math.min(currentX, window.innerWidth - rect.right + xOffset));
    currentY = Math.max(-rect.top + yOffset, Math.min(currentY, window.innerHeight - rect.bottom + yOffset));
    xOffset = currentX; yOffset = currentY;
    el.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
  };
  const dragEnd = () => {
    if (!isDragging) return;
    isDragging = false; el.classList.remove('dragging'); document.body.style.cursor = '';
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

function setYouTubeSmallMode(enabled) {
  const c = document.getElementById('bgYoutubeContainer');
  const h = document.getElementById('bgYoutubeHandle');
  const iframe = document.getElementById('bgYoutube');
  if (!c || !h) return;
  c.classList.toggle('small', !!enabled);
  c.classList.toggle('interactive', !!enabled);
  h.style.display = enabled ? 'block' : 'none';
  if (iframe && iframe.src) {
    try { const u = new URL(iframe.src); u.searchParams.set('controls', enabled ? '1' : '0'); iframe.src = u.toString(); }
    catch(_) { debugLog(`Failed to update YouTube iframe URL: ${_.message}`, 'warn', true); }
  }
  if (!enabled) { c.style.removeProperty('left'); c.style.removeProperty('top'); c.style.removeProperty('width'); c.style.removeProperty('height'); }
  AppStorage.setBoolean('youtubeSmallMode', enabled);
}

// --- Boot Orchestrator ---

async function runBootSequence() {
  const modules = [
    { name: 'Chat', fn: initChat },
    { name: 'Sounds', fn: initSounds },
    { name: 'Memory', fn: initMemory },
    { name: 'Debugger', fn: initDebugger },
    { name: 'Settings Panel', fn: initSettingsPanel },
    { name: 'Context Prefs', fn: initContextPrefs },
    { name: 'Language', fn: initLanguage, async: true },
    { name: 'Voice', fn: initVoice },
    { name: 'Voice Providers', fn: initVoiceProviders },
    { name: 'Persona', fn: initPersona },
    { name: 'Opacity', fn: initOpacity },
    { name: 'Models', fn: initModels, async: true },
    { name: 'Model Controls', fn: initModelControls },
    { name: 'Backgrounds', fn: initBackgrounds },
    { name: 'TTS', fn: initTTS },
    { name: 'Automation', fn: initAutomation },
    { name: 'Providers', fn: initProviders },
    { name: 'Debug Settings', fn: initDebugSettings },
    { name: 'UI Listeners', fn: initUIListeners },
    { name: 'Panels', fn: initPanels },
    { name: 'Chat Controller', fn: initChatControllerModule },
    { name: 'STT', fn: initSTTModule },
    { name: 'Mouse Tracking', fn: initMouseTracking },
    { name: 'Misc', fn: initMisc },
  ];

  for (const mod of modules) {
    try {
      if (mod.async) await mod.fn();
      else mod.fn();
    } catch (e) {
      debugError(`Boot module "${mod.name}" failed`, e);
    }
  }
  debugLog('Boot sequence complete.', 'info');
}

window.addEventListener('load', runBootSequence);
