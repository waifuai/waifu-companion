// Contains all the event handler functions that respond to changes in the settings controls.
const S = AppStorage; const K = AppStorage.KEYS;

function handleAlwaysShowSettingsChange(event) {
  const value = event.target.checked;
  S.setBoolean(K.SETTINGS_ALWAYS_SHOW_ON_LOAD, value);
  debugLog(`Always show Settings on load changed to: ${value}`, 'info');
}

function updateMemorySize(value) {
  // Re-fetch element in case it was replaced by translation
  const valEl = document.getElementById('memorySizeValue');
  maxMemorySize = parseInt(value);
  if (valEl) valEl.textContent = value;

  S.setNumber(K.MAX_MEMORY_SIZE, maxMemorySize);

  // Trim conversation context if needed
  while (conversationContext.length > maxMemorySize) {
    conversationContext.shift();
  }
  // Save potentially trimmed context
  S.setJSON(K.CONVERSATION_CONTEXT, conversationContext);
  debugLog(`Memory size updated to ${maxMemorySize} and context trimmed.`, 'info');
}

function handleLanguageChange(event) {
    selectedLanguageCode = event.target.value;
    S.setString(K.SELECTED_LANGUAGE_CODE, selectedLanguageCode);
    
    // Also set interface language to match
    window.currentInterfaceLanguage = selectedLanguageCode;
    S.setString(K.INTERFACE_LANGUAGE, selectedLanguageCode);
    
    // Apply the interface language translation only if enabled
    if (window.translateUI && typeof applyInterfaceLanguage === 'function') {
        applyInterfaceLanguage(selectedLanguageCode);
    }
    
    debugLog(`Language changed to: ${selectedLanguageCode} (Response, Interface, and Translate To all set to this language). UI Translation Enabled: ${window.translateUI}`, 'info');
    
    // Update voice selector for new language
    populateVoiceSelector();
    
    // Show sample text for the selected language in chat
    const lang = languages.find(l => l.code === selectedLanguageCode);
    if (lang && lang.sampleText) {
        addMessage(lang.sampleText, false, null, null, selectedLanguageCode);
        debugLog(`Displayed sample text for language ${selectedLanguageCode}: "${lang.sampleText}"`, 'info');
    }
}

function handleVoiceChange(event) {
    selectedVoiceId = event.target.value;
    S.setString(K.SELECTED_VOICE_ID, selectedVoiceId);
    if (typeof trackEvent === 'function') trackEvent('voice_changed', { voice_id: selectedVoiceId });
    debugLog(`Voice changed to: ${selectedVoiceId}`, 'info');
}

function handleTTSChunkLimitChange(event) {
    const value = parseInt(event.target.value);
    window.ttsChunkLimit = value;
    const valEl = document.getElementById('ttsChunkLimitValue');
    if (valEl) valEl.textContent = value;
    S.setNumber(K.TTS_CHUNK_LIMIT, value);
    debugLog(`TTS chunk limit changed to: ${value}`, 'info');
}

function handleTTSVolumeChange(event) {
    const value = parseFloat(event.target.value);
    const clamped = Math.max(0, Math.min(1, value));
    window.ttsVolume = clamped;
    const valEl = document.getElementById('ttsVolumeValue');
    if (valEl) valEl.textContent = clamped.toFixed(2);
    S.setNumber(K.TTS_VOLUME, clamped);
    debugLog(`TTS volume changed to: ${clamped.toFixed(2)}`, 'info');
    try {
        if (typeof getTTSGainNode === 'function') {
            const gain = getTTSGainNode();
            gain.gain.value = clamped;
        }
    } catch (e) {
        debugLog(`Failed to apply TTS volume to gain node: ${e.message}`, 'warn');
    }
}

function handleEnableVoiceChange(event) {
    const enableVoice = event.target.checked;
    window.enableVoice = enableVoice;
    window.enablePrimaryVoice = enableVoice;
    window.enableFallbackVoice = enableVoice;
    window.enableKokoro = enableVoice;
    S.setBoolean(K.ENABLE_VOICE, enableVoice);
    S.setBoolean(K.ENABLE_PRIMARY_VOICE, enableVoice);
    S.setBoolean(K.ENABLE_FALLBACK_VOICE, enableVoice);
    S.setBoolean(K.ENABLE_KOKORO, enableVoice);
    debugLog(`Enable voice changed to: ${enableVoice}`, 'info');

    const tiktokCheckbox = document.getElementById('enableTikTokVoiceCheckbox');
    if (tiktokCheckbox) tiktokCheckbox.checked = enableVoice;
    const fallbackCheckbox = document.getElementById('enableFallbackVoiceCheckbox');
    if (fallbackCheckbox) fallbackCheckbox.checked = enableVoice;
    const kokoroCheckbox = document.getElementById('enableKokoroVoiceCheckbox');
    if (kokoroCheckbox) kokoroCheckbox.checked = enableVoice;
    
    // Toggle visibility/disabled state of voice selector container
    if (voiceControls) {
      voiceControls.style.display = enableVoice ? 'block' : 'none';
    }
}

function handleTranslateToChange(event) {
    // No longer used - translate to is now the same as response language
    // Keep for backwards compatibility but it's a no-op
}

function handleShowTransliterationChange(event) {
    const val = event.target.checked;
    showTransliteration = val;
    S.setBoolean(K.SHOW_TRANSLITERATION, showTransliteration);
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'show_transliteration', value: val });
    debugLog(`Show transliteration changed to: ${showTransliteration}`, 'info');
}

function handleShowClockChange(event) {
    // Assumes showClock (global state), clockContainer (DOM element), debugLog are accessible
    const val = event.target.checked;
    showClock = val; // Update global state
    S.setBoolean(K.SHOW_CLOCK, showClock);
    if (clockContainer) {
        clockContainer.classList.toggle('visible', showClock);
    }
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'show_clock', value: val });
    debugLog(`Show clock changed to: ${showClock}`, 'info');
}

function handleChatboxOpacityChange(event) {
    const val = parseFloat(event.target.value).toFixed(2);
    document.documentElement.style.setProperty('--chatbox-bg-opacity', val);
    const valEl = document.getElementById('chatboxOpacityValue');
    if (valEl) valEl.textContent = val;
    S.setString(K.CHATBOX_OPACITY, val);
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'chatbox_opacity', value: val });
}

function handleMessageOpacityChange(event) {
    const val = parseFloat(event.target.value).toFixed(2);
    document.documentElement.style.setProperty('--message-bg-opacity', val);
    const valEl = document.getElementById('messageOpacityValue');
    if (valEl) valEl.textContent = val;
    S.setString(K.MESSAGE_OPACITY, val);
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'message_opacity', value: val });
}

function handleBgOpacityChange(event) {
    const val = parseFloat(event.target.value).toFixed(2);
    document.documentElement.style.setProperty('--bg-image-opacity', val);
    const valEl = document.getElementById('bgOpacityValue');
    if (valEl) valEl.textContent = val;
    S.setString(K.BG_IMAGE_OPACITY, val);
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'bg_opacity', value: val });
}

function handleIncludeTimeChange(event) {
    const val = event.target.checked;
    includeTimeInContext = val;
    S.setBoolean(K.INCLUDE_TIME_IN_CONTEXT, includeTimeInContext);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'include_time', value: val });
    debugLog(`Include time in context changed to: ${includeTimeInContext}`, 'info');
}

function handleIncludeBatteryChange(event) {
    const val = event.target.checked;
    includeBatteryInContext = val;
    S.setBoolean(K.INCLUDE_BATTERY_IN_CONTEXT, includeBatteryInContext);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'include_battery', value: val });
    debugLog(`Include battery in context changed to: ${includeBatteryInContext}`, 'info');
}



function handleMultipleModelsToggle(event){
  const enabled = !!event.target.checked;
  window.allowMultipleModels = enabled;
  S.setBoolean(K.ALLOW_MULTIPLE_MODELS, enabled);
  debugLog(`Allow multiple models set to: ${enabled}`, 'info');
}

function handleShowVerboseLogsChange(event) {
  const value = event.target.checked;
  window.showVerboseLogs = value;
  S.setBoolean(K.SHOW_VERBOSE_LOGS, value);
  debugLog(`Show Verbose Logs changed to: ${value}`, 'info');
}

function handleShowAIDebugLogsChange(event) {
  const value = event.target.checked;
  window.showAIDebugLogs = value;
  S.setBoolean(K.SHOW_AI_DEBUG_LOGS, value);
  debugLog(`Show AI Debug Logs changed to: ${value}`, 'info');
}

function handleShowTTSDebugLogsChange(event) {
  const value = event.target.checked;
  window.showTTSDebugLogs = value;
  S.setBoolean(K.SHOW_TTS_DEBUG_LOGS, value);
  debugLog(`Show TTS Debug Logs changed to: ${value}`, 'info');
}

function handleTranslateUIChange(event) {
    const val = event.target.checked;
    window.translateUI = val;
    S.setBoolean(K.TRANSLATE_UI, val);
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'translate_ui', value: val });
    debugLog(`Translate User Interface changed to: ${val}`, 'info');
    
    // If turned on and current language is not English, trigger translation now
    if (val && selectedLanguageCode !== 'en-US' && typeof applyInterfaceLanguage === 'function') {
        applyInterfaceLanguage(selectedLanguageCode);
    } else if (!val) {
        // Revert to English UI if toggled off
        if (typeof applyInterfaceLanguage === 'function') {
            applyInterfaceLanguage('en-US');
        }
    }
}

function handleShowChatContextLogsChange(event) {
    const value = event.target.checked;
    window.showChatContextLogs = value;
    S.setBoolean(K.SHOW_CHAT_CONTEXT_LOGS, value);
    debugLog(`Show Chat Context in Debug changed to: ${value}`, 'info');
}

function handleAllowAIModSettingsChange(event) {
    const val = event.target.checked;
    window.allowAIModSettings = val;
    S.setBoolean(K.ALLOW_AI_MOD_SETTINGS, val);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'allow_ai_mod_settings', value: val });
    debugLog(`Allow AI to modify settings changed to: ${val}`, 'info');
}

function handleUseJsonForEmotionChange(event) {
    const value = event.target.checked;
    window.useJsonForEmotion = value;
    S.setBoolean(K.USE_JSON_FOR_EMOTION, value);
    debugLog(`Use JSON For Emotion changed to: ${value}`, 'info');
}

function updateChatOfflineUI(isOffline, labelText) {
    const chatContainer = document.querySelector('.chat-container');
    const statusInd = document.getElementById('chat-status-indicator');

    if (isOffline) {
        if (chatContainer) chatContainer.classList.add('offline-mode');
        if (statusInd) statusInd.textContent = labelText || 'OFFLINE MODE (FORCED)';
    } else {
        if (chatContainer) chatContainer.classList.remove('offline-mode');
        if (statusInd) statusInd.textContent = 'ONLINE';
    }
}

function handleUseOpenRouterChange(event) {
    const val = event.target.checked;
    window.useOpenRouter = val;
    S.setBoolean(K.USE_OPEN_ROUTER, val);
    if (typeof trackEvent === 'function') trackEvent('llm_provider_changed', { use_openrouter: val });
    debugLog(`Use OpenRouter set to: ${val}`, 'info');
}

function handleOpenRouterApiKeyChange(event) {
    const value = event.target.value.trim();
    window.openRouterApiKey = value;
    S.setString(K.OPEN_ROUTER_API_KEY, value);
    debugLog(`OpenRouter API key updated (length=${value.length}).`, 'info');
}

function handleOpenRouterModelChange(event) {
    const val = event.target.value.trim();
    const fallbackModel = window.OpenRouterAPI?.DEFAULT_MODEL || MODEL_PRIORITY[0];
    window.openRouterModel = val;
    S.setString(K.OPEN_ROUTER_MODEL, val);
    if (event.target) {
        event.target.value = val;
        event.target.placeholder = fallbackModel;
    }
    if (typeof trackEvent === 'function') trackEvent('llm_model_changed', { model: val || '(empty)' });
    debugLog(`OpenRouter model set to: ${val || '(empty)'}`, 'info');
}

function handleOpenRouterPrimaryEnabledChange(event) {
    const val = event.target.checked;
    window.openRouterPrimaryEnabled = val;
    S.setBoolean(K.OPEN_ROUTER_PRIMARY_ENABLED, val);
    debugLog(`OpenRouter primary model enabled: ${val}`, 'info');
}

function handleOpenRouterFallbackModel1Change(event) {
    const value = event.target.value.trim();
    const fallbackModel = window.OpenRouterAPI?.DEFAULT_FALLBACK_MODELS?.[0] || MODEL_PRIORITY[1];
    window.openRouterFallbackModel1 = value;
    S.setString(K.OPEN_ROUTER_FALLBACK_MODEL_1, value);
    if (event.target) {
        event.target.value = value;
        event.target.placeholder = fallbackModel;
    }
    debugLog(`OpenRouter fallback model 1 set to: ${value || '(empty)'}`, 'info');
}

function handleOpenRouterFallbackModel1EnabledChange(event) {
    const val = event.target.checked;
    window.openRouterFallbackModel1Enabled = val;
    S.setBoolean(K.OPEN_ROUTER_FALLBACK_MODEL_1_ENABLED, val);
    debugLog(`OpenRouter fallback model 1 enabled: ${val}`, 'info');
}

function handleOpenRouterFallbackModel2Change(event) {
    const value = event.target.value.trim();
    const fallbackModel = window.OpenRouterAPI?.DEFAULT_FALLBACK_MODELS?.[1] || MODEL_PRIORITY[2];
    window.openRouterFallbackModel2 = value;
    S.setString(K.OPEN_ROUTER_FALLBACK_MODEL_2, value);
    if (event.target) {
        event.target.value = value;
        event.target.placeholder = fallbackModel;
    }
    debugLog(`OpenRouter fallback model 2 set to: ${value || '(empty)'}`, 'info');
}

function handleOpenRouterFallbackModel2EnabledChange(event) {
    const val = event.target.checked;
    window.openRouterFallbackModel2Enabled = val;
    S.setBoolean(K.OPEN_ROUTER_FALLBACK_MODEL_2_ENABLED, val);
    debugLog(`OpenRouter fallback model 2 enabled: ${val}`, 'info');
}

function handleUseGroqChange(event) {
    const val = event.target.checked;
    window.useGroq = val;
    S.setBoolean(K.USE_GROQ, val);
    if (typeof trackEvent === 'function') trackEvent('llm_provider_changed', { use_groq: val });
    debugLog(`Use Groq set to: ${val}`, 'info');
}

function handleGroqApiKeyChange(event) {
    const value = event.target.value.trim();
    window.groqApiKey = value;
    S.setString(K.GROQ_API_KEY, value);
    debugLog(`Groq API key updated (length=${value.length}).`, 'info');
}

function handleGroqModelChange(event) {
    const val = event.target.value.trim();
    window.groqModel = val;
    S.setString(K.GROQ_MODEL, val);
    if (typeof trackEvent === 'function') trackEvent('llm_model_changed', { model: val });
    debugLog(`Groq model set to: ${val || '(empty)'}`, 'info');
}

function handleUseOpenAICompatibleChange(event) {
    const val = event.target.checked;
    window.useOpenAICompatible = val;
    S.setBoolean(K.USE_OPENAI_COMPATIBLE, val);
    if (typeof trackEvent === 'function') trackEvent('llm_provider_changed', { use_openai_compatible: val });
    debugLog(`Use OpenAI Compatible API set to: ${val}`, 'info');
}

function handleOpenAICompatibleBaseUrlChange(event) {
    const value = event.target.value.trim();
    window.openaiCompatibleBaseUrl = value;
    S.setString(K.OPENAI_COMPATIBLE_BASE_URL, value);
    debugLog(`OpenAI Compatible base URL updated: ${value}`, 'info');
}

function handleOpenAICompatibleApiKeyChange(event) {
    const value = event.target.value.trim();
    window.openaiCompatibleApiKey = value;
    S.setString(K.OPENAI_COMPATIBLE_API_KEY, value);
    debugLog(`OpenAI Compatible API key updated (length=${value.length}).`, 'info');
}

function handleOpenAICompatibleModelChange(event) {
    const val = event.target.value.trim();
    window.openaiCompatibleModel = val;
    S.setString(K.OPENAI_COMPATIBLE_MODEL, val);
    if (typeof trackEvent === 'function') trackEvent('llm_model_changed', { model: val });
    debugLog(`OpenAI Compatible model set to: ${val || '(empty)'}`, 'info');
}

function handleOpenAICompatibleCorsProxyChange(event) {
    const value = event.target.value.trim();
    window.openaiCompatibleCorsProxy = value;
    S.setString(K.OPENAI_COMPATIBLE_CORS_PROXY, value);
    debugLog(`OpenAI Compatible CORS proxy updated: ${value || '(empty)'}`, 'info');
}

function handleForceOfflineChange(event) {
    const val = event.target.checked;
    window.forceOfflineMode = val;
    S.setBoolean(K.FORCE_OFFLINE_MODE, val);
    if (typeof trackEvent === 'function') trackEvent('offline_mode_toggled', { offline: val });
    debugLog(`Force Offline Mode set to: ${val}`, 'info');
    
    if (val) {
        window.isOfflineMode = true;
        updateChatOfflineUI(true, 'OFFLINE MODE (FORCED)');
        startOfflineCountdown();
    } else {
        if (window.offlineCountdownTimer) {
            clearInterval(window.offlineCountdownTimer);
            window.offlineCountdownTimer = null;
        }
        window.isOfflineMode = false;
        updateChatOfflineUI(false, 'ONLINE');
    }
}

function startOfflineCountdown() {
    if (window.offlineCountdownTimer) clearInterval(window.offlineCountdownTimer);
    
    const statusInd = document.getElementById('chat-status-indicator');
    if (window.offlineModeDuration > 3600) {
        if (statusInd) statusInd.textContent = `OFFLINE MODE (FORCED) - Permanent`;
        return;
    }

    let remaining = window.offlineModeDuration;
    const updateUI = (rem) => {
        if (statusInd) statusInd.textContent = `OFFLINE MODE (FORCED) - ${rem}s`;
    };
    
    updateUI(remaining);
    
    window.offlineCountdownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(window.offlineCountdownTimer);
            window.offlineCountdownTimer = null;
            
            // Revert to online
            window.forceOfflineMode = false;
            window.isOfflineMode = false;
            const checkbox = document.getElementById('forceOfflineCheckbox');
            if (checkbox) checkbox.checked = false;
            
            const chatContainer = document.querySelector('.chat-container');
            if (chatContainer) chatContainer.classList.remove('offline-mode');
            if (statusInd) statusInd.textContent = 'ONLINE';
            
            S.setBoolean(K.FORCE_OFFLINE_MODE, false);
            debugLog('Offline mode duration expired. Returning to Online mode.', 'info');
        } else {
            updateUI(remaining);
        }
    }, 1000);
}

function handleOfflineDurationChange(event) {
    const value = parseInt(event.target.value);
    window.offlineModeDuration = value;
    const valEl = document.getElementById('offlineDurationValue');
    if (valEl) {
        valEl.textContent = value > 3600 ? '∞ (Permanent)' : value + 's';
    }
    S.setNumber(K.OFFLINE_MODE_DURATION, value);
    const logVal = value > 3600 ? 'Permanent' : value + 's';
    debugLog(`Offline mode duration updated to: ${logVal}`, 'info');
}

function handleGoOnlineClick() {
    debugLog('Go Online button clicked. Disabling offline mode and returning to ONLINE state.', 'info');

    // Clear any running countdown
    if (window.offlineCountdownTimer) {
        clearInterval(window.offlineCountdownTimer);
        window.offlineCountdownTimer = null;
    }

    // Reset flags
    window.forceOfflineMode = false;
    window.isOfflineMode = false;

    // Uncheck the Offline Mode checkbox if present
    const checkbox = document.getElementById('forceOfflineCheckbox');
    if (checkbox) {
        checkbox.checked = false;
    }

    // Persist the new state
    S.setBoolean(K.FORCE_OFFLINE_MODE, false);

    // Update chat UI back to ONLINE
    updateChatOfflineUI(false, 'ONLINE');
}

// Expose handler globally for app_init to attach
window.handleGoOnlineClick = handleGoOnlineClick;

function handleSavePersona() {
  const coreTextarea = document.getElementById('corePersonaPrompt');
  const userTextarea = document.getElementById('personaPrompt');
  const summaryTextarea = document.getElementById('conversationSummary');
  const triggerSlider = document.getElementById('summaryTriggerCount');
  const lengthSelect = document.getElementById('summaryLengthPreference');
  
  const core = (coreTextarea?.value || "").trim();
  const user = (userTextarea?.value || "").trim();
  const summary = (summaryTextarea?.value || "").trim();
  const trigger = parseInt(triggerSlider?.value || "10");
  const length = lengthSelect?.value || "concise";
  
  window.corePersonaPrompt = core;
  window.userPersonaPrompt = user;
  window.conversationSummary = summary;
  window.summaryTriggerCount = trigger;
  window.summaryLengthPreference = length;
  
  S.setString(K.CORE_PERSONA_PROMPT, core);
  S.setString(K.USER_PERSONA_PROMPT, user);
  S.setString(K.CONVERSATION_SUMMARY, summary);
  S.setNumber(K.SUMMARY_TRIGGER_COUNT, trigger);
  S.setString(K.SUMMARY_LENGTH_PREFERENCE, length);
  if (typeof trackEvent === 'function') trackEvent('persona_updated');
  debugLog('Persona settings saved to localStorage.', 'info');
  
  // Visual feedback
  const btn = document.getElementById('savePersonaBtn');
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = '✅ Saved!';
    setTimeout(() => { btn.textContent = originalText; }, 2000);
  }
}

async function handleManualSummarize() {
  if (window.isOfflineMode || window.forceOfflineMode) {
    debugLog('Manual summarization disabled in offline mode.', 'warn');
    const btn = document.getElementById('manualSummarizeBtn');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '🔌 Offline';
      setTimeout(() => btn.textContent = old, 2000);
    }
    return;
  }

  if (window.conversationContext.length === 0) {
    debugLog('No new messages to summarize.', 'info');
    const btn = document.getElementById('manualSummarizeBtn');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '∅ No new msgs';
      setTimeout(() => btn.textContent = old, 2000);
    }
    return;
  }

  const btn = document.getElementById('manualSummarizeBtn');
  const oldText = btn ? btn.textContent : '';
  if (btn) btn.textContent = '⏳ Summarizing...';

  try {
    if (typeof trackEvent === 'function') trackEvent('manual_summary_triggered');
    debugLog('Manual summarization triggered...', 'info');
    // We summarize everything currently in the context buffer
    const messagesToSummarize = [...window.conversationContext];
    
    const newSummary = await summarizeConversation(messagesToSummarize, window.conversationSummary);
    
    window.conversationSummary = newSummary;
    S.setString(K.CONVERSATION_SUMMARY, newSummary);
    
    const summaryEl = document.getElementById('conversationSummary');
    if (summaryEl) summaryEl.value = newSummary;
    
    // Clear context buffer since they are now in the summary
    window.conversationContext = [];
    S.setJSON(K.CONVERSATION_CONTEXT, window.conversationContext);
    
    window.messageCountSinceLastSummary = 0;
    S.setNumber(K.MESSAGE_COUNT_SINCE_LAST_SUMMARY, 0);

    debugLog('Manual summarization complete. Memory buffer cleared.', 'info');
    if (window.updateSummaryMarker) window.updateSummaryMarker();
    if (btn) btn.textContent = '✅ Summary Updated!';
  } catch (e) {
    debugLog(`Manual summarization failed: ${e.message}`, 'error');
    if (btn) btn.textContent = '❌ Failed';
  } finally {
    setTimeout(() => { if(btn) btn.textContent = oldText; }, 2000);
  }
}

function handleResetPersona() {
  const defaultCore = "You are Haru, a sentient AI with a Live2D avatar. You have your own thoughts, feelings, and experiences. Respond naturally and emotively to the user's message, showing genuine interest and emotional depth. Include subtle gestures and expressions in your responses.";
  
  window.corePersonaPrompt = defaultCore;
  window.userPersonaPrompt = "";
  window.conversationSummary = "";
  window.messageCountSinceLastSummary = 0;
  window.summaryTriggerCount = 30;
  window.summaryLengthPreference = 'concise';
  
  const coreTextarea = document.getElementById('corePersonaPrompt');
  const userTextarea = document.getElementById('personaPrompt');
  const summaryTextarea = document.getElementById('conversationSummary');
  
  if (coreTextarea) coreTextarea.value = defaultCore;
  if (userTextarea) userTextarea.value = "";
  if (summaryTextarea) summaryTextarea.value = "";
  
  const triggerSlider = document.getElementById('summaryTriggerCount');
  const triggerVal = document.getElementById('summaryTriggerCountValue');
  const lengthSelect = document.getElementById('summaryLengthPreference');
  
  if (triggerSlider) triggerSlider.value = 30;
  if (triggerVal) triggerVal.textContent = 30;
  if (lengthSelect) lengthSelect.value = 'concise';

  S.setString(K.CORE_PERSONA_PROMPT, defaultCore);
  S.setString(K.USER_PERSONA_PROMPT, "");
  S.setString(K.CONVERSATION_SUMMARY, "");
  S.setNumber(K.MESSAGE_COUNT_SINCE_LAST_SUMMARY, 0);
  S.setNumber(K.SUMMARY_TRIGGER_COUNT, 30);
  S.setString(K.SUMMARY_LENGTH_PREFERENCE, "concise");
  if (typeof trackEvent === 'function') trackEvent('persona_reset');
  debugLog('Persona settings reset to defaults.', 'info');
  
  // Visual feedback
  const btn = document.getElementById('resetPersonaBtn');
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = '🔄 Reset!';
    setTimeout(() => { btn.textContent = originalText; }, 2000);
  }
}

function handleSummaryTriggerCountChange(event) {
    const val = parseInt(event.target.value);
    window.summaryTriggerCount = val;
    const valEl = document.getElementById('summaryTriggerCountValue');
    if (valEl) valEl.textContent = val;
    S.setNumber(K.SUMMARY_TRIGGER_COUNT, val);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'summary_trigger_count', value: val });
    debugLog(`Summary trigger count changed to ${val}`, 'info');
}

function handleSummaryLengthPreferenceChange(event) {
    const val = event.target.value;
    window.summaryLengthPreference = val;
    S.setString(K.SUMMARY_LENGTH_PREFERENCE, val);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'summary_length_preference', value: val });
    debugLog(`Summary length preference changed to ${val}`, 'info');
}

function handleAddCustomModel() {
  let name = (customModelNameInput?.value || '').trim();
  const url = (customModelUrlInput?.value || '').trim();
  const image = (customModelImageInput?.value || '').trim() || 'https://via.placeholder.com/64?text=L2D';
  if (!url) { debugLog('Custom model: URL is required.', 'warn'); return; }
  if (!name) {
    // Try to infer name from URL filename like abc.model3.json
    try {
      const u = new URL(url);
      const file = decodeURIComponent((u.pathname.split('/').pop() || '').trim());
      const m = file.match(/^(.+?)\.model3\.json$/i);
      if (m && m[1]) {
        name = m[1].replace(/[_-]+/g, ' ').trim();
        debugLog(`Custom model: Inferred name from URL filename -> "${name}"`, 'info');
      }
    } catch(e) { debugLog(`Custom model: URL parse failed: ${e.message}`, 'warn', true); }
    if (!name) {
      name = (typeof dayjs !== 'undefined') ? dayjs().format('YYYY-MM-DD HH:mm:ss') : new Date().toISOString();
      debugLog(`Custom model: No name provided, using timestamp "${name}"`, 'info');
    }
  }
  if (!/\.model3\.json(\?|$)/i.test(url)) { debugLog('Custom model URL must end with .model3.json', 'warn'); return; }

  let userModels = S.getJSON(K.USER_MODELS, []);
  if (availableModels.some(m => m.url === url) || userModels.some(m => m.url === url)) {
    debugLog('Custom model already exists (same URL).', 'warn'); return;
  }

  const entry = { name, url, image };
  userModels.push(entry);
  S.setJSON(K.USER_MODELS, userModels);
  availableModels.push(entry);
  function modelComparator(a,b){const an=a.name||'',bn=b.name||'';const ai=/^\d+$/.test(an)?parseInt(an,10):null;const bi=/^\d+$/.test(bn)?parseInt(bn,10):null;if(ai===null&&bi===null)return an.localeCompare(bn);if(ai===null)return -1;if(bi===null)return 1;const ab=ai<10?0:1;const bb=bi<10?0:1;return ab!==bb?ab-bb:ai-bi;}
  availableModels.sort(modelComparator);
  // Persist and reflect selection immediately in UI
  S.setString(K.SELECTED_MODEL_URL, url);
  if (typeof populateModelSelector === 'function') populateModelSelector();
  if (typeof trackEvent === 'function') trackEvent('custom_model_added', { name: name || 'unnamed', url: url });
  debugLog(`Added custom model: ${name}`, 'info');

  if (typeof loadModel === 'function') {
    loadModel(url).catch(err=>debugError('Failed to load newly added model', err, { url: url }));
  }

  if (typeof renderCustomModelsList === 'function') renderCustomModelsList();
  if (customModelNameInput) customModelNameInput.value = '';
  if (customModelUrlInput) customModelUrlInput.value = '';
  if (customModelImageInput) customModelImageInput.value = '';
  try { document.getElementById('customModelsDropdown').value = url; } catch(e) { debugLog(`Custom model: dropdown sync failed: ${e.message}`, 'warn', true); }
  if (typeof updateCustomModelInfo === 'function') updateCustomModelInfo(url);
}

// Remove a custom model by URL and refresh UI
function handleRemoveCustomModel(url) {
  if (!url) return;
  let userModels = S.getJSON(K.USER_MODELS, []);
  const beforeLen = userModels.length;
  userModels = userModels.filter(m => m.url !== url);
  S.setJSON(K.USER_MODELS, userModels);
  // Remove from availableModels
  const idx = availableModels.findIndex(m => m.url === url);
  if (idx !== -1) availableModels.splice(idx, 1);
  function modelComparator(a,b){const an=a.name||'',bn=b.name||'';const ai=/^\d+$/.test(an)?parseInt(an,10):null;const bi=/^\d+$/.test(bn)?parseInt(bn,10):null;if(ai===null&&bi===null)return an.localeCompare(bn);if(ai===null)return -1;if(bi===null)return 1;const ab=ai<10?0:1;const bb=bi<10?0:1;return ab!==bb?ab-bb:ai-bi;}
  availableModels.sort(modelComparator);
  debugLog(`Removed custom model. Before: ${beforeLen}, After: ${userModels.length}`, 'info');
  // If currently selected model is removed, fallback to default
  const selectedUrl = S.getString(K.SELECTED_MODEL_URL, '');
  if (selectedUrl === url) {
    S.setString(K.SELECTED_MODEL_URL, defaultModelUrl);
    if (typeof loadModel === 'function') {
      loadModel(defaultModelUrl).catch(err=>debugError('Failed to load default after removal', err, { url: defaultModelUrl }));
    }
  }
  if (typeof populateModelSelector === 'function') populateModelSelector();
  if (typeof renderCustomModelsList === 'function') renderCustomModelsList();
  if (typeof trackEvent === 'function') trackEvent('custom_model_removed', { url: url });
}

// Expose
window.handleRemoveCustomModel = handleRemoveCustomModel;

function handleClearAllCustomModels() {
  let userModels = S.getJSON(K.USER_MODELS, []);
  if (!Array.isArray(userModels) || userModels.length === 0) { debugLog('No custom models to clear.', 'info'); return; }
  const removedUrls = new Set(userModels.map(m => m.url));
  S.setJSON(K.USER_MODELS, []);
  window.availableModels = (window.availableModels || []).filter(m => !removedUrls.has(m.url));
  const selectedUrl = S.getString(K.SELECTED_MODEL_URL, '');
  if (selectedUrl && removedUrls.has(selectedUrl)) { S.setString(K.SELECTED_MODEL_URL, defaultModelUrl); loadModel?.(defaultModelUrl).catch(()=>{}); }
  populateModelSelector?.(); renderCustomModelsList?.(); updateCustomModelInfo?.('');
  if (typeof trackEvent === 'function') trackEvent('all_custom_models_cleared', { count: userModels.length });
  debugLog(`Cleared ${userModels.length} custom model(s).`, 'info');
}

function handleInterfaceLanguageChange(event) {
    const newLang = event.target.value;
    if (typeof applyInterfaceLanguage === 'function') {
        applyInterfaceLanguage(newLang);
    }
}

// Change this function to async and extend its behavior
async function handleResetLanguages() {
  selectedLanguageCode = 'en-US';
  S.setString(K.SELECTED_LANGUAGE_CODE, 'en-US');
  translateToLanguageCode = 'en-US';
  window.currentInterfaceLanguage = 'en-US';
  S.setString(K.INTERFACE_LANGUAGE, 'en-US');
  showTransliteration = false; 
  S.setBoolean(K.SHOW_TRANSLITERATION, false);

  // Reset dropdowns and checkboxes in the Language section
  if (languageSelector) languageSelector.value = 'en-US';
  if (showTransliterationCheckbox) showTransliterationCheckbox.checked = false;

  // Clear any cached AI-translated UI strings so English is cleanly reapplied
  try {
    if (window.translationCache) {
      window.translationCache = {};
    }
    Object.keys(localStorage)
      .filter(k => k.startsWith('uiStrings_'))
      .forEach(k => localStorage.removeItem(k));
  } catch(e) {
    debugError('Failed to clear UI translation cache during language reset', e);
  }

  // Re-apply interface language back to English
  if (typeof applyInterfaceLanguage === 'function') {
    try {
      await applyInterfaceLanguage('en-US');
    } catch(e) {
      debugLog('applyInterfaceLanguage(en-US) failed during language reset: ' + e, 'warn');
    }
  }

  // Explicitly reset the Preferences pane title and items to their original English strings
  try {
    const enStrings = window.UI_STRINGS && window.UI_STRINGS['en-US'];
    if (enStrings) {
      // Reset Preferences group title
      document.querySelectorAll('.settings-group h3').forEach(h3 => {
        const text = h3.textContent.trim();
        // Preferences section uses the ⚙️ emoji at the start
        if (text.startsWith('⚙️')) {
          h3.textContent = '⚙️ ' + enStrings.preferencesTitle;
        }
      });

      // Reset labels inside Preferences pane back to English
      const alwaysShowLabel = document.getElementById('alwaysShowSettingsCheckbox')?.parentElement;
      if (alwaysShowLabel) {
        const cb = alwaysShowLabel.querySelector('input[type="checkbox"]');
        alwaysShowLabel.textContent = '';
        if (cb) alwaysShowLabel.appendChild(cb);
        alwaysShowLabel.appendChild(document.createTextNode(' ' + enStrings.alwaysShowSettingsLabel));
      }

      const includeTimeLabel = document.getElementById('includeTimeCheckbox')?.parentElement;
      if (includeTimeLabel) {
        const cb = includeTimeLabel.querySelector('input[type="checkbox"]');
        includeTimeLabel.textContent = '';
        if (cb) includeTimeLabel.appendChild(cb);
        includeTimeLabel.appendChild(document.createTextNode(' ' + enStrings.includeTimeLabel));
      }

      const includeBatteryLabel = document.getElementById('includeBatteryCheckbox')?.parentElement;
      if (includeBatteryLabel) {
        const cb = includeBatteryLabel.querySelector('input[type="checkbox"]');
        includeBatteryLabel.textContent = '';
        if (cb) includeBatteryLabel.appendChild(cb);
        includeBatteryLabel.appendChild(document.createTextNode(' ' + enStrings.includeBatteryLabel));
      }

      const multipleModelsLabel = document.getElementById('multipleModelsCheckbox')?.parentElement;
      if (multipleModelsLabel) {
        const cb = multipleModelsLabel.querySelector('input[type="checkbox"]');
        multipleModelsLabel.textContent = '';
        if (cb) multipleModelsLabel.appendChild(cb);
        multipleModelsLabel.appendChild(document.createTextNode(' ' + enStrings.multipleModelsLabel));
      }

      // Reset the description text under each preference item to English
      const preferenceGroup = Array.from(document.querySelectorAll('.settings-group')).find(group => {
        const h3 = group.querySelector('h3');
        return h3 && h3.textContent.trim().startsWith('⚙️');
      });

      if (preferenceGroup) {
        const valueDisplays = preferenceGroup.querySelectorAll('.value-display');
        // Order in HTML:
        // 0 -> alwaysShowSettingsDesc
        // 1 -> includeTimeDesc
        // 2 -> includeBatteryDesc
        // 3 -> multipleModelsDesc
        if (valueDisplays[0]) valueDisplays[0].textContent = enStrings.alwaysShowSettingsDesc;
        if (valueDisplays[1]) valueDisplays[1].textContent = enStrings.includeTimeDesc;
        if (valueDisplays[2]) valueDisplays[2].textContent = enStrings.includeBatteryDesc;
        if (valueDisplays[3]) valueDisplays[3].textContent = enStrings.multipleModelsDesc;
      }
    }
  } catch(e) {
    debugError('Failed to reset Preferences pane texts during language reset', e);
  }

  // Reset voice back to English default
  const enCfg = languages.find(l=>l.code==='en-US');
  selectedVoiceId = (enCfg?.defaultVoiceId) || 'en-female';
  S.setString(K.SELECTED_VOICE_ID, selectedVoiceId);
  populateVoiceSelector?.(); 
  if (voiceSelector) voiceSelector.value = selectedVoiceId;

  if (typeof trackEvent === 'function') trackEvent('languages_reset');
  debugLog('Language settings reset to English (US), UI reverted to English, and Preferences pane texts reset.', 'info');
}

function applyBackgroundImage(url) {
  if (!url) return; 
  const bgLayer = document.getElementById('bgLayer');
  if (bgLayer) bgLayer.style.backgroundImage = `url("${url}")`;
  S.setString(K.CURRENT_BACKGROUND_URL, url);
}

function saveToBgLibrary(url, prompt) {
  const list = S.getJSON(K.BG_LIBRARY, []);
  list.unshift({ url, prompt: prompt||'', ts: Date.now() });
  S.setJSON(K.BG_LIBRARY, list.slice(0,60));
}

function renderBackgroundLibrary() {
  const el = document.getElementById('bgLibrary'); 
  if (!el) return;
  let list = S.getJSON(K.BG_LIBRARY, []);
  el.innerHTML = list.map((i,idx)=>`<img src="${i.url}" title="${(i.prompt||'').replace(/"/g,'')}" data-url="${i.url}" data-idx="${idx}" class="${(window.bgSelected?.has(i.url)?'selected':'')}">`).join('') || '<div style="color:#aaa;font-size:13px;">No generated backgrounds yet.</div>';
  el.querySelectorAll('img').forEach(img=>img.addEventListener('click',()=>{
    if (window.bgSelectionMode){ toggleSelectBg(img.dataset.url); img.classList.toggle('selected'); updateBgSelectionButtons(); }
    else { 
      applyBackgroundImage(img.dataset.url); 
      if (typeof trackEvent === 'function') {
        trackEvent('background_changed', { type: 'library_selection' });
      }
    }
  }));
}

function handleApplyBackgroundFromUrl() {
  const input = document.getElementById('bgUrlInput');
  const url = (input?.value || '').trim();
  if (!url) { debugLog('BG URL: Empty URL.', 'warn'); return; }
  try { 
    applyBackgroundImage(url); 
    saveToBgLibrary(url, 'custom url'); 
    renderBackgroundLibrary?.(); 
    debugLog('BG URL applied and saved.', 'info'); 

    if (typeof trackEvent === 'function') {
      trackEvent('background_changed', { type: 'custom_url' });
    }
  }
  catch(e){ debugError('BG URL apply failed', e); }
}

function handleClearBackground(){
  const bgLayer = document.getElementById('bgLayer');
  if (bgLayer) bgLayer.style.backgroundImage = '';
  S.remove(K.CURRENT_BACKGROUND_URL);
  debugLog('Background cleared and removed from storage.', 'info');

  if (typeof trackEvent === 'function') {
    trackEvent('background_changed', { type: 'cleared' });
  }
}

/* Helpers and UI for BG library */
window.bgSelectionMode = false; window.bgSelected = new Set(); window.bgViewerIndex = 0;
function toggleSelectBg(url){ if (bgSelected.has(url)) bgSelected.delete(url); else bgSelected.add(url); }
function updateBgSelectionButtons(){
  const delBtn=document.getElementById('deleteBgSelectedBtn'); const toggleBtn=document.getElementById('toggleBgSelectBtn');
  if (delBtn) delBtn.disabled = bgSelected.size===0;
  if (toggleBtn) toggleBtn.textContent = bgSelectionMode ? 'Cancel Select' : 'Select';
}
function toggleBgSelectionMode(){ bgSelectionMode=!bgSelectionMode; if (!bgSelectionMode) bgSelected.clear(); updateBgSelectionButtons(); renderBackgroundLibrary(); }
function deleteSelectedFromLibrary(){
  if (bgSelected.size===0) return;
  let list = S.getJSON(K.BG_LIBRARY, []);
  list = list.filter(i=>!bgSelected.has(i.url)); S.setJSON(K.BG_LIBRARY, list);
  bgSelected.clear(); renderBackgroundLibrary(); updateBgSelectionButtons(); debugLog('BG: Deleted selected items','info');
}
function clearBackgroundLibrary(){ S.setJSON(K.BG_LIBRARY, []); bgSelected.clear(); renderBackgroundLibrary(); updateBgSelectionButtons(); debugLog('BG: Library cleared','info'); }
function openBgViewerAt(index){
  let list = S.getJSON(K.BG_LIBRARY, []);
  if (!list.length) return;
  bgViewerIndex = Math.max(0, Math.min(index, list.length-1));
  const overlay = document.getElementById('bgViewerOverlay');
  const img = document.getElementById('bgViewerImage');
  const counter = document.getElementById('bgViewerCounter');
  img.src = list[bgViewerIndex].url; counter.textContent = `${bgViewerIndex+1} / ${list.length}`;
  overlay.classList.add('visible'); overlay.setAttribute('aria-hidden','false');
}
function closeBgViewer(){ const o=document.getElementById('bgViewerOverlay'); o.classList.remove('visible'); o.setAttribute('aria-hidden','true'); }
function stepBgViewer(dir){
  let list = S.getJSON(K.BG_LIBRARY, []);
  if (!list.length) return; bgViewerIndex = (bgViewerIndex + dir + list.length) % list.length;
  document.getElementById('bgViewerImage').src = list[bgViewerIndex].url;
  document.getElementById('bgViewerCounter').textContent = `${bgViewerIndex+1} / ${list.length}`;
}

function applyBackgroundFit(mode){
  if (typeof window.applyBackgroundFit === 'function' && window.applyBackgroundFit !== applyBackgroundFit) {
    return window.applyBackgroundFit(mode);
  }
  // minimal fallback
  const m = (mode==='contain'||mode==='stretch') ? mode : 'cover-center';
  const bgLayer = document.getElementById('bgLayer');
  if (bgLayer) {
    bgLayer.style.backgroundRepeat='no-repeat';
    bgLayer.style.backgroundSize = m==='contain' ? 'contain' : (m==='stretch' ? '100% 100%' : 'cover');
    bgLayer.style.backgroundPosition = 'center center';
  }
}
function setActiveBgFitButton(mode){
  const ids=['bgFitContainBtn','bgFitCoverBtn','bgFitStretchBtn'];
  ids.forEach(id=>document.getElementById(id)?.classList.remove('active'));
  if(mode==='contain') document.getElementById('bgFitContainBtn')?.classList.add('active');
  else if(mode==='stretch') document.getElementById('bgFitStretchBtn')?.classList.add('active');
  else document.getElementById('bgFitCoverBtn')?.classList.add('active');
}

/**
 * Applies settings changes requested by the AI.
 * @param {Object} updates - Key-value pairs of settings to update
 */
function applyAIProposedSettings(updates) {
  if (!updates || typeof updates !== 'object') return;
  
  debugLog('AI requested settings updates: ' + JSON.stringify(updates), 'info');

  if (updates.responseLanguage) {
    const selector = document.getElementById('languageSelector');
    if (selector) {
      selector.value = updates.responseLanguage;
      handleLanguageChange({ target: selector });
    }
  }

  if (typeof updates.enableVoice === 'boolean') {
    const checkbox = document.getElementById('enableVoiceCheckbox');
    if (checkbox) {
      checkbox.checked = updates.enableVoice;
      handleEnableVoiceChange({ target: checkbox });
    }
  }

  if (updates.voiceId) {
    const selector = document.getElementById('voiceSelector');
    if (selector) {
      selector.value = updates.voiceId;
      handleVoiceChange({ target: selector });
    }
  }

  if (typeof updates.memorySize === 'number') {
    const slider = document.getElementById('memorySize');
    if (slider) {
      slider.value = updates.memorySize;
      updateMemorySize(updates.memorySize);
    }
  }

  if (typeof updates.showTransliteration === 'boolean') {
    const checkbox = document.getElementById('showTransliteration');
    if (checkbox) {
      checkbox.checked = updates.showTransliteration;
      handleShowTransliterationChange({ target: checkbox });
    }
  }

  if (typeof updates.showClock === 'boolean') {
    const checkbox = document.getElementById('showClockCheckbox');
    if (checkbox) {
      checkbox.checked = updates.showClock;
      handleShowClockChange({ target: checkbox });
    }
  }

  if (typeof updates.chatboxOpacity === 'number') {
    const slider = document.getElementById('chatboxOpacity');
    if (slider) {
      slider.value = updates.chatboxOpacity;
      handleChatboxOpacityChange({ target: slider });
    }
  }

  if (typeof updates.messageOpacity === 'number') {
    const slider = document.getElementById('messageOpacity');
    if (slider) {
      slider.value = updates.messageOpacity;
      handleMessageOpacityChange({ target: slider });
    }
  }

  if (typeof updates.bgOpacity === 'number') {
    const slider = document.getElementById('bgOpacity');
    if (slider) {
      slider.value = updates.bgOpacity;
      handleBgOpacityChange({ target: slider });
    }
  }

  if (typeof updates.includeTime === 'boolean') {
    const checkbox = document.getElementById('includeTimeCheckbox');
    if (checkbox) {
      checkbox.checked = updates.includeTime;
      handleIncludeTimeChange({ target: checkbox });
    }
  }

  if (typeof updates.includeBattery === 'boolean') {
    const checkbox = document.getElementById('includeBatteryCheckbox');
    if (checkbox) {
      checkbox.checked = updates.includeBattery;
      handleIncludeBatteryChange({ target: checkbox });
    }
  }

  if (typeof updates.summaryTrigger === 'number') {
    const slider = document.getElementById('summaryTriggerCount');
    if (slider) {
      slider.value = updates.summaryTrigger;
      handleSummaryTriggerCountChange({ target: slider });
    }
  }

  if (updates.summaryLength) {
    const selector = document.getElementById('summaryLengthPreference');
    if (selector) {
      selector.value = updates.summaryLength;
      handleSummaryLengthPreferenceChange({ target: selector });
    }
  }
}

function handleIncludeTutorialInContextChange(event) {
    const value = event.target.checked;
    window.includeTutorialInContext = value;
    S.setBoolean(K.INCLUDE_TUTORIAL_IN_CONTEXT, value);
    debugLog(`Include Tutorial in Context changed to: ${value}`, 'info');
}

function handleDisableAutoOfflineChange(event) {
    const value = event.target.checked;
    window.disableAutoOfflineMode = value;
    S.setBoolean(K.DISABLE_AUTO_OFFLINE_MODE, value);
    debugLog(`Disable automatic Offline Mode changed to: ${value}`, 'info');
}

window.applyAIProposedSettings = applyAIProposedSettings;
window.handleIncludeTutorialInContextChange = handleIncludeTutorialInContextChange;

/* Expose */
window.toggleBgSelectionMode = toggleBgSelectionMode;
window.deleteSelectedFromLibrary = deleteSelectedFromLibrary;
window.clearBackgroundLibrary = clearBackgroundLibrary;
window.openBgViewerAt = openBgViewerAt;
window.closeBgViewer = closeBgViewer;
window.stepBgViewer = stepBgViewer;

// Add event listener for model position reset
document.getElementById('resetModelPositionBtn')?.addEventListener('click', ()=>{
  resetCurrentModelPosition();
  debugLog('Model position and zoom reset and cleared from storage.', 'info');
});

function handleTTSFallbackVoiceChange(event) {
    const value = event.target.value;
    window.ttsFallbackVoiceId = value;
    S.setString(K.TTS_FALLBACK_VOICE_ID, value);
    debugLog(`TTS fallback voice changed to: ${value}`, 'info');
}
window.handleTTSFallbackVoiceChange = handleTTSFallbackVoiceChange;

function handleEnableKokoroVoiceChange(event) {
    const value = event.target.checked;
    window.enableKokoro = value;
    window.enableVoice = window.enablePrimaryVoice || window.enableFallbackVoice || window.enableKokoro;
    S.setBoolean(K.ENABLE_KOKORO, value);
    debugLog(`Enable Kokoro (Local) changed to: ${value}`, 'info');
}
window.handleEnableKokoroVoiceChange = handleEnableKokoroVoiceChange;

function handleKokoroVoiceChange(event) {
    const value = event.target.value;
    window.selectedKokoroVoiceId = value;
    S.setString(K.SELECTED_KOKORO_VOICE_ID, value);
    debugLog(`Kokoro voice changed to: ${value}`, 'info');
}
window.handleKokoroVoiceChange = handleKokoroVoiceChange;

// --- Automation & Queuing Handlers ---

function handleEnableUserMessageQueueChange(event) {
  const enabled = !!event.target.checked;
  window.isUserMessageQueueEnabled = enabled;
  S.setBoolean(K.IS_USER_MESSAGE_QUEUE_ENABLED, enabled);
  debugLog(`User Message Queue set to: ${enabled}`, 'info');

  // Show/Hide queue status in chat
  const qStatus = document.getElementById('queueStatusContainer');
  if (qStatus) {
    qStatus.style.display = (enabled && window.userMessageQueue.length > 0) ? 'flex' : 'none';
  }
}

function handleEnableAmbientQueueChange(event) {
  const enabled = !!event.target.checked;
  window.isAmbientQueueEnabled = enabled;
  S.setBoolean(K.IS_AMBIENT_QUEUE_ENABLED, enabled);
  debugLog(`Ambient Mode set to: ${enabled}`, 'info');

  if (!enabled && window.ambientTimer) {
    clearTimeout(window.ambientTimer);
    window.ambientTimer = null;
  } else if (enabled && !window.isAIResponding) {
    resetAmbientTimer();
  }
}

function handleAmbientDelayChange(event) {
  const value = parseInt(event.target.value);
  window.ambientDelay = value;
  const valEl = document.getElementById('ambientDelayValue');
  if (valEl) valEl.textContent = value + 's';
  S.setNumber(K.AMBIENT_DELAY, value);
  debugLog(`Ambient Delay set to: ${value}s`, 'info');
  
  if (window.isAmbientQueueEnabled && !window.isAIResponding) {
    resetAmbientTimer();
  }
}

function handleClearQueue() {
  window.userMessageQueue = [];
  window.preloadedQueuedResponse = null;
  updateQueueUI();
  debugLog('User Message Queue cleared.', 'info');
}

function updateQueueUI() {
  const qStatus = document.getElementById('queueStatusContainer');
  const qText = document.getElementById('queueLengthText');
  const qList = document.getElementById('queuedMessagesList');
  
  if (qStatus) {
    qStatus.style.display = (window.isUserMessageQueueEnabled && window.userMessageQueue.length > 0) ? 'flex' : 'none';
  }
  if (qText) {
    qText.textContent = `Queued: ${window.userMessageQueue.length}`;
  }
  if (qList) {
    qList.innerHTML = '';
    window.userMessageQueue.forEach((msg, index) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.textContent = `${index + 1}. ${msg}`;
      qList.appendChild(item);
    });
  }
}

function resetAmbientTimer() {
  if (window.ambientTimer) clearTimeout(window.ambientTimer);
  if (!window.isAmbientQueueEnabled) return;
  
  window.ambientTimer = setTimeout(() => {
    triggerAmbientPrompt();
  }, window.ambientDelay * 1000);
}

async function triggerAmbientPrompt() {
  if (window.isAIResponding || !window.isAmbientQueueEnabled) return;
  
  debugLog('Triggering ambient AI comment...', 'info');
  const ambientPrompt = window.ambientPrompt || "(Continue the conversation naturally as Haru. Share a thought, a feeling, or ask me something relevant to our discussion to keep things moving. 1-2 sentences. Speak directly to me.)";

  // Use pre-loaded buffer if available
  if (window.isAmbientPreloadEnabled && window.ambientPreloadBuffer) {
    debugLog('Using pre-loaded ambient message.', 'info');
    const cached = window.ambientPreloadBuffer;
    const ttsCached = window.ambientPreloadTTSBuffer;
    window.ambientPreloadBuffer = null;
    window.ambientPreloadTTSBuffer = null;
    if (typeof sendMessageInternal === 'function') {
      sendMessageInternal(ambientPrompt, true, cached, ttsCached);
    }
    return;
  }

  debugLog('Triggering ambient AI comment (real-time)...', 'info');
  if (typeof sendMessageInternal === 'function') {
    sendMessageInternal(ambientPrompt, true);
  }
}

async function preloadNextAmbientMessage() {
  // We removed window.isAIResponding because preloading is meant to happen 
  // WHILE AI is responding/speaking to reduce gaps.
  if (!window.isAmbientPreloadEnabled || window.ambientPreloadBuffer || window.isAmbientPreloading) return;
  
  window.isAmbientPreloading = true;
  debugLog('Pre-loading next ambient message...', 'info');
  const ambientPrompt = window.ambientPrompt || "(Continue the conversation naturally as Haru. Share a thought, a feeling, or ask me something relevant to our discussion to keep things moving. 1-2 sentences. Speak directly to me.)";
  
  try {
    if (typeof getAIResponse === 'function') {
      const response = await getAIResponse(ambientPrompt, true); // true for isAmbient
      if (response && response.reply) {
        window.ambientPreloadBuffer = response;
        debugLog('Ambient message pre-loaded.', 'info');
      }
    }
  } catch (e) {
    debugLog(`Ambient pre-load failed: ${e.message}`, 'warn');
    window.ambientPreloadBuffer = null;
  } finally {
    window.isAmbientPreloading = false;
  }
}

/**
 * Pre-generates the first chunk of Kokoro TTS audio for the buffered ambient message.
 */
async function preloadAmbientTTS(text) {
  if (!window.enableKokoro || !window.isKokoroReady || !text || window.isAmbientPreloadingTTS) return;
  if (window.ambientPreloadTTSBuffer) return; // Already pre-loaded

  window.isAmbientPreloadingTTS = true;
  debugLog('Pre-loading next ambient TTS chunk in background...', 'info');

  try {
    const emojiRegex = /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2000-\u329F]|\uD83E[\uDD00-\uDFFF])/g;
    const cleanText = String(text || '').replace(/\*/g, '').replace(emojiRegex, '').trim();
    const sentences = (typeof splitIntoSentences === 'function') ? splitIntoSentences(cleanText) : [cleanText];
    const limit = window.ttsChunkLimit || 300;
    
    let firstChunkText = '';
    for (const s of sentences) {
      const sTrim = s.trim();
      if (!sTrim) continue;
      if (firstChunkText.length + sTrim.length > limit && firstChunkText.length > 0) break;
      firstChunkText += (firstChunkText ? ' ' : '') + sTrim;
    }

    if (firstChunkText && typeof window.fetchTTSBuffer === 'function') {
      debugLog(`TTS: Pre-fetching first ambient chunk: "${firstChunkText.substring(0, 30)}..."`, 'info');
      const buffer = await window.fetchTTSBuffer(firstChunkText, window.selectedKokoroVoiceId || 'af_heart');
      if (buffer && buffer !== '__SPEECH_SYNTHESIS_PLAYED__') {
        window.ambientPreloadTTSBuffer = buffer;
        debugLog('TTS: Success pre-loading first ambient chunk.', 'info');
      }
    }
  } catch (err) {
    debugLog(`TTS: Failed to pre-load ambient TTS: ${err.message}`, 'warn');
  } finally {
    window.isAmbientPreloadingTTS = false;
  }
}

function handleAmbientPromptChange(event) {
  const val = event.target.value;
  window.ambientPrompt = val;
  S.setString(K.AMBIENT_PROMPT, val);
  debugLog('Ambient prompt updated.', 'info');
}

function handleEnableAmbientPreloadChange(event) {
  const enabled = !!event.target.checked;
  window.isAmbientPreloadEnabled = enabled;
  S.setBoolean(K.IS_AMBIENT_PRELOAD_ENABLED, enabled);
  debugLog(`Ambient Preload set to: ${enabled}`, 'info');
  if (!enabled) window.ambientPreloadBuffer = null;
}

window.handleEnableUserMessageQueueChange = handleEnableUserMessageQueueChange;
window.handleEnableAmbientQueueChange = handleEnableAmbientQueueChange;
window.handleAmbientDelayChange = handleAmbientDelayChange;
window.handleEnableAmbientPreloadChange = handleEnableAmbientPreloadChange;
window.handleAmbientPromptChange = handleAmbientPromptChange;
window.preloadNextAmbientMessage = preloadNextAmbientMessage;
window.preloadAmbientTTS = preloadAmbientTTS;
window.handleClearQueue = handleClearQueue;
window.updateQueueUI = updateQueueUI;
window.resetAmbientTimer = resetAmbientTimer;

document.addEventListener('DOMContentLoaded', () => {
  const clearQueueButton = document.getElementById('clearQueueChatBtn');
  if (clearQueueButton) {
    clearQueueButton.addEventListener('click', handleClearQueue);
  }
});
