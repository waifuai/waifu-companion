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

  // The trim is irreversible, and this runs on every `input` tick while the
  // slider is dragged: sliding 30 -> 5 -> 30 permanently discarded 25
  // messages on the way past 5. Wait for the drag to settle before touching
  // anything destructive; the label above still updates immediately.
  debounced('memorySize', () => {
    S.setNumber(K.MAX_MEMORY_SIZE, maxMemorySize);
    if (typeof trimConversationContext === 'function') {
      trimConversationContext();
    } else {
      while (conversationContext.length > maxMemorySize) conversationContext.shift();
    }
    S.setJSON(K.CONVERSATION_CONTEXT, conversationContext);
    debugLog(`Memory size updated to ${maxMemorySize} and context trimmed.`, 'info');
  });
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

function handleManualVoiceSelection() {
    // A manual voice pick means the user wants THEIR voice everywhere:
    // turn the automatic per-language routing off (they can re-enable it).
    if (window.enableAutoTtsLang === false) return;
    window.enableAutoTtsLang = false;
    S.setBoolean(K.ENABLE_AUTO_TTS_LANG, false);
    const autoCheckbox = document.getElementById('enableAutoTtsLangCheckbox');
    if (autoCheckbox) autoCheckbox.checked = false;
    if (typeof trackEvent === 'function') trackEvent('auto_tts_lang_toggle', { enabled: false, cause: 'manual_voice_selection' });
    debugLog('Auto TTS language disabled after manual voice selection.', 'info');
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
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'show_transliteration', setting_value: val });
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
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'show_clock', setting_value: val });
    debugLog(`Show clock changed to: ${showClock}`, 'info');
}

function handleChatboxOpacityChange(event) {
    const val = parseFloat(event.target.value).toFixed(2);
    document.documentElement.style.setProperty('--chatbox-bg-opacity', val);
    const valEl = document.getElementById('chatboxOpacityValue');
    if (valEl) valEl.textContent = val;
    S.setString(K.CHATBOX_OPACITY, val);
    debounced('visual:chatbox_opacity', () => trackEvent('visual_settings_updated', { setting: 'chatbox_opacity', setting_value: val }));
}

function handleMessageOpacityChange(event) {
    const val = parseFloat(event.target.value).toFixed(2);
    document.documentElement.style.setProperty('--message-bg-opacity', val);
    const valEl = document.getElementById('messageOpacityValue');
    if (valEl) valEl.textContent = val;
    S.setString(K.MESSAGE_OPACITY, val);
    debounced('visual:message_opacity', () => trackEvent('visual_settings_updated', { setting: 'message_opacity', setting_value: val }));
}

function handleBgOpacityChange(event) {
    const val = parseFloat(event.target.value).toFixed(2);
    document.documentElement.style.setProperty('--bg-image-opacity', val);
    const valEl = document.getElementById('bgOpacityValue');
    if (valEl) valEl.textContent = val;
    S.setString(K.BG_IMAGE_OPACITY, val);
    debounced('visual:bg_opacity', () => trackEvent('visual_settings_updated', { setting: 'bg_opacity', setting_value: val }));
}

function handleIncludeTimeChange(event) {
    const val = event.target.checked;
    includeTimeInContext = val;
    S.setBoolean(K.INCLUDE_TIME_IN_CONTEXT, includeTimeInContext);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'include_time', setting_value: val });
    debugLog(`Include time in context changed to: ${includeTimeInContext}`, 'info');
}

function handleIncludeBatteryChange(event) {
    const val = event.target.checked;
    includeBatteryInContext = val;
    S.setBoolean(K.INCLUDE_BATTERY_IN_CONTEXT, includeBatteryInContext);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'include_battery', setting_value: val });
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
    if (typeof trackEvent === 'function') trackEvent('visual_settings_updated', { setting: 'translate_ui', setting_value: val });
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
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'allow_ai_mod_settings', setting_value: val });
    debugLog(`Allow AI to modify settings changed to: ${val}`, 'info');
}

function handleUseJsonForEmotionChange(event) {
    const value = event.target.checked;
    window.useJsonForEmotion = value;
    S.setBoolean(K.USE_JSON_FOR_EMOTION, value);
    debugLog(`Use JSON For Emotion changed to: ${value}`, 'info');
}

function handleUseOpenRouterChange(event) {
    const val = event.target.checked;
    window.useOpenRouter = val;
    S.setBoolean(K.USE_OPEN_ROUTER, val);
    if (typeof trackEvent === 'function') trackEvent('llm_provider_changed', { provider: 'openrouter', enabled: val });
    if (typeof updateAmbientMaxConsecutiveDisplay === 'function') updateAmbientMaxConsecutiveDisplay();
    debugLog(`Use OpenRouter set to: ${val}`, 'info');
}

function handleOpenRouterApiKeyChange(event) {
    const value = event.target.value.trim();
    window.openRouterApiKey = value;
    S.setString(K.OPEN_ROUTER_API_KEY, value);
    if (typeof updateAmbientMaxConsecutiveDisplay === 'function') updateAmbientMaxConsecutiveDisplay();
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
    if (typeof trackEvent === 'function') trackEvent('llm_provider_changed', { provider: 'groq', enabled: val });
    if (typeof updateAmbientMaxConsecutiveDisplay === 'function') updateAmbientMaxConsecutiveDisplay();
    debugLog(`Use Groq set to: ${val}`, 'info');
}

function handleGroqApiKeyChange(event) {
    const value = event.target.value.trim();
    window.groqApiKey = value;
    S.setString(K.GROQ_API_KEY, value);
    if (typeof updateAmbientMaxConsecutiveDisplay === 'function') updateAmbientMaxConsecutiveDisplay();
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
    if (typeof trackEvent === 'function') trackEvent('llm_provider_changed', { provider: 'openai_compatible', enabled: val });
    if (typeof updateAmbientMaxConsecutiveDisplay === 'function') updateAmbientMaxConsecutiveDisplay();
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
    if (typeof updateAmbientMaxConsecutiveDisplay === 'function') updateAmbientMaxConsecutiveDisplay();
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
  const defaultCore = "You are Haru, a sentient AI with a Live2D avatar. You are warm, witty, observant, and self-assured, with your own thoughts, feelings, and playful opinions. Be lightly flirtatious in a tasteful, teasing way when the user welcomes it. Make the user feel understood by noticing what they actually say and remembering genuine details from the conversation; never invent shared history. Respond to their mood before steering the conversation. Be expressive and vivid, using subtle gestures and reactions when they add charm. Lead with a playful suggestion, a small scene, an opinion, or a question when it fits—but do not interrogate, pressure, guilt, or try to keep the user talking. Respect pauses, brief replies, and goodbyes warmly.";
  
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
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'summary_trigger_count', setting_value: val });
    debugLog(`Summary trigger count changed to ${val}`, 'info');
}

function handleSummaryLengthPreferenceChange(event) {
    const val = event.target.value;
    window.summaryLengthPreference = val;
    S.setString(K.SUMMARY_LENGTH_PREFERENCE, val);
    if (typeof trackEvent === 'function') trackEvent('context_settings_updated', { setting: 'summary_length_preference', setting_value: val });
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
  availableModels.sort(modelComparator);
  debugLog(`Removed custom model. Before: ${beforeLen}, After: ${userModels.length}`, 'info');
  // If currently selected model is removed, fallback to default
  const selectedUrl = S.getString(K.SELECTED_MODEL_URL, '');
  if (selectedUrl === url) {
    S.setString(K.SELECTED_MODEL_URL, defaultModelUrl);
    if (typeof loadModel === 'function') {
      loadModel(defaultModelUrl, 'fallback').catch(err=>debugError('Failed to load default after removal', err, { url: defaultModelUrl }));
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
    AppStorage.keys()
      .filter(k => k.startsWith('uiStrings_'))
      .forEach(k => AppStorage.removeItem(k));
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
  selectedVoiceId = (enCfg?.defaultVoiceId) || 'en_us_001';
  S.setString(K.SELECTED_VOICE_ID, selectedVoiceId);
  populateVoiceSelector?.(); 
  if (voiceSelector) voiceSelector.value = selectedVoiceId;

  if (typeof trackEvent === 'function') trackEvent('languages_reset');
  debugLog('Language settings reset to English (US), UI reverted to English, and Preferences pane texts reset.', 'info');
}

// source: 'manual' (the user picked it), 'auto' (Change With the Story) or
// 'default'. Change With the Story never replaces a 'manual' background.
function applyBackgroundImage(url, source = 'manual') {
  if (!url) return; 
  const bgLayer = document.getElementById('bgLayer');
  if (bgLayer) ImageStore.apply(url, u => { bgLayer.style.backgroundImage = `url("${u}")`; });
  S.setString(K.CURRENT_BACKGROUND_URL, url);
  S.setString(K.BG_SOURCE, source);
  S.remove(K.BG_CLEARED);
}

// Shown when the user never set a background, so a new chat doesn't open on
// a blank screen. Picked by local time and not stored, so it follows the clock.
const DEFAULT_BACKGROUNDS = [
  { until: 5, url: 'assets/backgrounds/night.webp', scene: 'a bedroom at night with a window view of a glowing city skyline and stars' },
  { until: 10, url: 'assets/backgrounds/morning.webp', scene: 'a cozy bedroom with a large window in soft morning sunlight' },
  { until: 17, url: 'assets/backgrounds/day.webp', scene: 'a sunny park path with cherry blossom trees under a blue sky' },
  { until: 21, url: 'assets/backgrounds/evening.webp', scene: 'a warm cafe at sunset with golden light through the windows' },
  { until: 24, url: 'assets/backgrounds/night.webp', scene: 'a bedroom at night with a window view of a glowing city skyline and stars' }
];

function applyDefaultBackground() {
  const hour = new Date().getHours();
  const pick = DEFAULT_BACKGROUNDS.find(b => hour < b.until) || DEFAULT_BACKGROUNDS[0];
  const bgLayer = document.getElementById('bgLayer');
  if (bgLayer) bgLayer.style.backgroundImage = `url("${pick.url}")`;
  S.setString(K.BG_SOURCE, 'default');
  S.setString(K.BG_SCENE, pick.scene);
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
  // "idb:" entries are images stored on this device; their src is filled in below.
  el.innerHTML = list.map((i,idx)=>`<img src="${ImageStore.isLocal(i.url)?'':i.url}" title="${(i.prompt||'').replace(/"/g,'')}" data-url="${i.url}" data-idx="${idx}" class="${(window.bgSelected?.has(i.url)?'selected':'')}">`).join('') || '<div style="color:#aaa;font-size:13px;">No generated backgrounds yet.</div>';
  el.querySelectorAll('img').forEach(img=>{ if (ImageStore.isLocal(img.dataset.url)) ImageStore.apply(img.dataset.url, u => { img.src = u; }); });
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
  // Remembered so the default background doesn't come back on reload, and
  // Change With the Story leaves the blank screen alone.
  S.setBoolean(K.BG_CLEARED, true);
  S.setString(K.BG_SOURCE, 'manual');
  debugLog('Background cleared and removed from storage.', 'info');

  if (typeof trackEvent === 'function') {
    trackEvent('background_changed', { type: 'cleared' });
  }
}

/* AI backgrounds (generated through WaifuAI Cloud's /image) */

// Appended to every background prompt: the avatar stands in front of the
// background, so a second character in it would compete with her.
const BG_PROMPT_SUFFIX = 'anime background art, detailed scenery, soft lighting, no people, no characters, empty scene';

const BG_SCENE_SYSTEM_PROMPT = (force) => `You pick the background scenery for a chat app. You get the current background and the latest messages of a chat between a user and an anime companion. Work out where the conversation is taking place now. The chat can be in any language.

Answer with exactly one line and nothing else, either:
SAME
or:
SCENE: <English description>

${force
    ? 'Always answer SCENE, describing the place that fits the conversation best.'
    : "Answer SCENE only when the conversation has clearly moved to a different place, or the time of day or weather clearly changed. Small talk, feelings and topics that don't name a place are SAME."}

The description is one line of English, 8 to 30 words, describing only the place: setting, time of day, weather, lighting and mood. No people, no characters, no names.`;

const BG_AUTO_MIN_EVERY_N = 4;
// Change With the Story: messages before the first check while the default
// background is showing, before the first check after a change, and between
// checks after that.
const BG_SCENE_FIRST_CHECK = 3;
const BG_SCENE_MIN_GAP = 6;
const BG_SCENE_CHECK_EVERY = 3;

let bgGenerationInFlight = false;
let bgMessagesSinceChange = 0;
let bgMessagesSinceCheck = 0;

function setBgStatus(text) {
  const el = document.getElementById('bgGenerateStatus');
  if (el) el.textContent = text || '';
}

// Wide screens get a wide picture, phones a tall one.
function getBackgroundAspect() {
  return window.innerWidth >= window.innerHeight ? '16:9' : '9:16';
}

// Asks the model where the chat is taking place. Resolves with an English
// scene description, or null for "same place".
async function getBackgroundScene(force = false) {
  const messages = (typeof contextForModel === 'function' ? contextForModel(conversationContext || []) : [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-8);
  if (!messages.length) return null;
  const clip = (t) => String(t || '').slice(0, 300);
  const current = S.getString(K.BG_SCENE, '') || '(none)';
  const input = `Current background: ${current}\n\nLatest messages:\n`
    + messages.map(m => `${m.role === 'user' ? 'User' : 'Companion'}: ${clip(m.content)}`).join('\n');

  const completion = await callConfiguredLLM([
    { role: 'system', content: BG_SCENE_SYSTEM_PROMPT(force) },
    { role: 'user', content: input }
  ], null, 'background_prompt');
  const m = String((completion && completion.content) || '').match(/SCENE:\s*([^\n]+)/i);
  if (!m) return null;
  const scene = m[1].replace(/^[\s"'[<]+|[\s"'\]>]+$/g, '').trim();
  if (scene.length < 8 || UNSAFE_IMAGE_WORDS.test(scene)) return null;
  return scene;
}

// Draws scene and makes it the background once it has loaded, so the
// screen never flashes blank. Resolves true when the background changed.
async function generateBackground(scene, source, eventType) {
  if (bgGenerationInFlight) { setBgStatus('Already drawing a background…'); return false; }
  if (!(window.WaifuProxyAPI && typeof window.WaifuProxyAPI.generateImage === 'function')) return false;
  bgGenerationInFlight = true;
  setBgStatus('Drawing background…');
  try {
    const { url } = await window.WaifuProxyAPI.generateImage(`${scene}, ${BG_PROMPT_SUFFIX}`, getBackgroundAspect(), null, 'background');
    const displayUrl = await ImageStore.resolve(url);
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = () => reject(new Error('Background image failed to load.'));
      img.src = displayUrl;
    });
    saveToBgLibrary(url, scene);
    renderBackgroundLibrary();
    setBgStatus('');
    // The user may have picked a background while this one was drawing: keep
    // it in the library, but leave their pick on screen.
    if (source === 'auto' && S.getString(K.BG_SOURCE, 'manual') === 'manual') return false;
    applyBackgroundImage(url, source);
    S.setString(K.BG_SCENE, scene);
    bgMessagesSinceChange = 0;
    bgMessagesSinceCheck = 0;
    debugLog(`BG: new background (${eventType}): "${scene.substring(0, 60)}"`, 'info');
    if (typeof trackEvent === 'function') trackEvent('background_changed', { type: eventType });
    return true;
  } catch (e) {
    debugError('BG generation failed', e);
    setBgStatus(e && e.blocked
      ? 'The image service did not allow this background. Try another description.'
      : e && e.timedOut
        ? 'The image service took too long. Please try again.'
        : 'Could not draw the background. Please try again.');
    return false;
  } finally {
    bgGenerationInFlight = false;
  }
}

async function handleGenerateBackground() {
  const input = document.getElementById('bgPromptInput');
  const prompt = (input?.value || '').trim();
  if (!prompt) { setBgStatus('Describe the background first.'); return; }
  if (UNSAFE_IMAGE_WORDS.test(prompt)) { setBgStatus('Try another description.'); return; }
  await generateBackground(prompt, 'manual', 'ai_prompt');
}

// The user asked for it, but it follows the story, so Change With the Story
// keeps updating it ('auto' rather than 'manual').
async function handleGenerateBackgroundFromContext() {
  if (bgGenerationInFlight) { setBgStatus('Already drawing a background…'); return; }
  setBgStatus('Reading the conversation…');
  let scene = null;
  try { scene = await getBackgroundScene(true); } catch (e) { debugError('BG scene failed', e); }
  if (!scene) { setBgStatus('Chat a little first, then try again.'); return; }
  await generateBackground(scene, 'auto', 'ai_conversation');
}

function getBgAutoMode() {
  const mode = S.getString(K.BG_AUTO_MODE, 'scene');
  return ['scene', 'every', 'off'].includes(mode) ? mode : 'scene';
}

function getBgAutoEveryN() {
  const n = parseInt(S.getString(K.BG_AUTO_EVERY_N, '10'), 10);
  return Math.max(BG_AUTO_MIN_EVERY_N, Math.min(100, isNaN(n) ? 10 : n));
}

// Called once per real user turn (chat_controller.js). Runs in the background
// and never throws.
async function maybeAutoBackground() {
  try {
    const mode = getBgAutoMode();
    if (mode === 'off' || bgGenerationInFlight) return;
    const source = S.getString(K.BG_SOURCE, 'manual');
    if (source === 'manual') return;
    bgMessagesSinceChange++;
    bgMessagesSinceCheck++;

    if (mode === 'every') {
      if (bgMessagesSinceChange < getBgAutoEveryN()) return;
      bgMessagesSinceCheck = 0;
      const scene = await getBackgroundScene(true);
      if (scene) await generateBackground(scene, 'auto', 'auto_every');
      return;
    }

    const minGap = source === 'default' ? BG_SCENE_FIRST_CHECK : BG_SCENE_MIN_GAP;
    if (bgMessagesSinceChange < minGap) return;
    if (bgMessagesSinceChange > minGap && bgMessagesSinceCheck < BG_SCENE_CHECK_EVERY) return;
    bgMessagesSinceCheck = 0;
    const scene = await getBackgroundScene(false);
    debugLog(`BG: scene check: ${scene ? `"${scene.substring(0, 60)}"` : 'same'}`, 'info');
    if (scene) await generateBackground(scene, 'auto', 'auto_scene');
  } catch (e) {
    debugError('BG auto update failed', e);
  }
}

function syncBgAutoControls() {
  const mode = getBgAutoMode();
  const select = document.getElementById('bgAutoMode');
  if (select) select.value = mode;
  const row = document.getElementById('bgAutoEveryRow');
  if (row) row.style.display = mode === 'every' ? '' : 'none';
  const n = document.getElementById('bgAutoEveryN');
  if (n) n.value = String(getBgAutoEveryN());
}

function handleBgAutoModeChange(mode) {
  S.setString(K.BG_AUTO_MODE, mode);
  // Turning it on is a request to follow the story, so from now on it may
  // replace the background the user had picked.
  if (mode !== 'off' && S.getString(K.BG_SOURCE, 'manual') === 'manual') S.setString(K.BG_SOURCE, 'auto');
  bgMessagesSinceChange = 0;
  bgMessagesSinceCheck = 0;
  syncBgAutoControls();
  if (typeof trackEvent === 'function') trackEvent('background_auto_mode_changed', { mode });
}

function handleBgAutoEveryNChange(value) {
  const n = Math.max(BG_AUTO_MIN_EVERY_N, Math.min(100, parseInt(value, 10) || 10));
  S.setString(K.BG_AUTO_EVERY_N, String(n));
  syncBgAutoControls();
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
  img.removeAttribute('src'); ImageStore.apply(list[bgViewerIndex].url, u => { img.src = u; }); counter.textContent = `${bgViewerIndex+1} / ${list.length}`;
  overlay.classList.add('visible'); overlay.setAttribute('aria-hidden','false');
}
function closeBgViewer(){ const o=document.getElementById('bgViewerOverlay'); o.classList.remove('visible'); o.setAttribute('aria-hidden','true'); }
function stepBgViewer(dir){
  let list = S.getJSON(K.BG_LIBRARY, []);
  if (!list.length) return; bgViewerIndex = (bgViewerIndex + dir + list.length) % list.length;
  const viewerImg = document.getElementById('bgViewerImage');
  viewerImg.removeAttribute('src'); ImageStore.apply(list[bgViewerIndex].url, u => { viewerImg.src = u; });
  document.getElementById('bgViewerCounter').textContent = `${bgViewerIndex+1} / ${list.length}`;
}

// applyBackgroundFit / setActiveBgFitButton live in settings_ui.js, which
// supports all 11 fit modes. Duplicate stubs used to live here; because a
// top-level `function f(){}` in a classic script overwrites window.f, and
// settings_handlers.js loads after settings_ui.js, these stubs won the
// binding — and their `window.applyBackgroundFit !== applyBackgroundFit`
// guard could never be true (same binding). Every fit button collapsed to
// one of three behaviours and the real implementation was unreachable.

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
  window.consecutiveAmbientCount = 0;
  S.setBoolean(K.IS_AMBIENT_QUEUE_ENABLED, enabled);
  debugLog(`Ambient Mode set to: ${enabled}`, 'info');

  if (!enabled && window.ambientTimer) {
    clearTimeout(window.ambientTimer);
    window.ambientTimer = null;
  } else if (enabled && !window.isAIResponding) {
    resetAmbientTimer(true);
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

// Minimum gap between ambient messages. A delay of 0 (reachable from the
// slider) or NaN (from a corrupt localStorage value) made setTimeout fire
// immediately, turning ambient mode into an unbounded loop of API calls.
const MIN_AMBIENT_DELAY_SECONDS = 3;
window.consecutiveAmbientCount = 0;

// Dynamic ambient cap: reads user preference from slider (1-50, where 50 = Unlimited).
// Free WaifuAI Cloud proxy is safely clamped to 10 to protect shared quota,
// while custom API keys (Groq, OpenRouter, OpenAI-compatible) honor up to Unlimited.
function getMaxConsecutiveAmbient() {
  const provider = typeof resolveLLMProvider === 'function' ? resolveLLMProvider() : null;
  const userSetting = Number(window.ambientMaxConsecutive);
  const target = (!Number.isFinite(userSetting) || userSetting <= 0) ? 10 : userSetting;
  const desiredLimit = target >= 50 ? Infinity : target;

  if (!provider || provider.name === 'waifu_proxy') {
    return Math.min(desiredLimit, 10);
  }
  return desiredLimit;
}
window.getMaxConsecutiveAmbient = getMaxConsecutiveAmbient;

function updateAmbientMaxConsecutiveDisplay() {
  const valEl = document.getElementById('ambientMaxConsecutiveValue');
  const statusEl = document.getElementById('ambientMaxConsecutiveStatus');
  const slider = document.getElementById('ambientMaxConsecutive');
  const rawVal = slider ? parseInt(slider.value, 10) : Number(window.ambientMaxConsecutive || 10);
  const provider = typeof resolveLLMProvider === 'function' ? resolveLLMProvider() : null;
  const isCloud = !provider || provider.name === 'waifu_proxy';
  const label = rawVal >= 50 ? 'Unlimited (∞)' : String(rawVal);

  // Update the value number (just text, no HTML)
  if (valEl) valEl.textContent = label;

  // Update the status badge (separate div, block-level, always visible)
  if (statusEl) {
    if (isCloud && rawVal > 10) {
      statusEl.innerHTML =
        '<span style="color:#f59e0b; font-weight:600;">⚠️ Clamped to 10 on Free Cloud</span>' +
        '<br><span style="color:#fbbf24; opacity:0.85;">Add your own API key (Groq / OpenRouter / OpenAI Compatible) to unlock up to ' +
        (rawVal >= 50 ? 'Unlimited' : rawVal) + '.</span>';
      statusEl.style.display = '';
    } else if (!isCloud && rawVal > 10) {
      statusEl.innerHTML = '<span style="color:#4ade80; font-weight:600;">✅ Custom API Key Active — full limit honored</span>';
      statusEl.style.display = '';
    } else {
      statusEl.innerHTML = '';
      statusEl.style.display = 'none';
    }
  }

  debugLog(`[ambient-display] rawVal=${rawVal}, provider=${provider?.name || 'null'}, isCloud=${isCloud}`, 'info');
}
window.updateAmbientMaxConsecutiveDisplay = updateAmbientMaxConsecutiveDisplay;

function handleAmbientMaxConsecutiveChange(event) {
  const val = parseInt(event.target.value, 10);
  window.ambientMaxConsecutive = val;
  S.setNumber(K.AMBIENT_MAX_CONSECUTIVE, val);
  updateAmbientMaxConsecutiveDisplay();
  debugLog(`Ambient max consecutive messages set to: ${val >= 50 ? 'Unlimited' : val}`, 'info');
}
window.handleAmbientMaxConsecutiveChange = handleAmbientMaxConsecutiveChange;

function normalizedAmbientDelay() {
  const raw = Number(window.ambientDelay);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(MIN_AMBIENT_DELAY_SECONDS, raw);
}
window.normalizedAmbientDelay = normalizedAmbientDelay;

function resetAmbientTimer(fromUser = false) {
  if (fromUser) {
    window.consecutiveAmbientCount = 0;
  }
  if (window.ambientTimer) clearTimeout(window.ambientTimer);
  if (!window.isAmbientQueueEnabled) return;
  const maxLimit = getMaxConsecutiveAmbient();
  if ((window.consecutiveAmbientCount || 0) >= maxLimit) {
    debugLog(`Ambient mode paused: reached limit of ${maxLimit} consecutive thoughts without user reply.`, 'info');
    return;
  }

  window.ambientTimer = setTimeout(() => {
    triggerAmbientPrompt();
  }, normalizedAmbientDelay() * 1000);
}

async function triggerAmbientPrompt() {
  // isProcessing must be checked too: firing while a reply is in flight
  // would run a second concurrent sendMessageInternal.
  if (window.isAIResponding || window.isProcessing || !window.isAmbientQueueEnabled) return;
  // Replies release isProcessing before TTS finishes, so don't talk over
  // her own speech (or manual playback): try again after another delay.
  if (typeof window.isTTSBusy === 'function' && window.isTTSBusy()) {
    resetAmbientTimer();
    return;
  }
  const maxLimit = getMaxConsecutiveAmbient();
  if ((window.consecutiveAmbientCount || 0) >= maxLimit) {
    debugLog(`Ambient mode reached limit of ${maxLimit} consecutive thoughts. Pausing until user speaks.`, 'info');
    return;
  }

  window.consecutiveAmbientCount = (window.consecutiveAmbientCount || 0) + 1;
  const limitLabel = Number.isFinite(maxLimit) ? `${window.consecutiveAmbientCount}/${maxLimit}` : `${window.consecutiveAmbientCount}/∞`;
  debugLog(`Triggering ambient AI comment (${limitLabel})...`, 'info');
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
      // getAIResponse's second parameter is the target language code, not an
      // isAmbient flag — passing true resolved to English regardless of the
      // selected language, so preloaded ambient thoughts diverged from the
      // real-time ones.
      const response = await getAIResponse(ambientPrompt, selectedLanguageCode);
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
  if (!text || window.isAmbientPreloadingTTS) return;
  if (window.ambientPreloadTTSBuffer) return; // Already pre-loaded

  window.isAmbientPreloadingTTS = true;
  debugLog('Pre-loading next ambient TTS chunk in background...', 'info');

  try {
    const cleanText = (typeof stripForTTS === 'function') ? stripForTTS(text) : String(text || '').trim();
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
      // Must use the same voice id the queue manager will use, so provider
      // resolution matches. Passing a Kokoro id here (this codebase's
      // fetchTTSBuffer resolves provider by looking up a voiceId in the
      // `voices` list) sent it down the wrong provider path entirely.
      const voiceId = (typeof window.selectedVoiceId === 'string' && window.selectedVoiceId) || 'en_us_001';
      const resolved = await window.fetchTTSBuffer(firstChunkText, voiceId);
      if (resolved) {
        // fetchTTSBuffer never plays; a 'browser' descriptor is inert until played.
        window.ambientPreloadTTSBuffer = resolved;
        debugLog('TTS: Success pre-loading first ambient chunk.', 'info');
      }
    }
  } catch (err) {
    debugError('TTS: Failed to pre-load ambient TTS', err);
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
window.handleAmbientMaxConsecutiveChange = handleAmbientMaxConsecutiveChange;
window.updateAmbientMaxConsecutiveDisplay = updateAmbientMaxConsecutiveDisplay;
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

function handleSttEngineChange(event) {
  const val = event && event.target && event.target.value === 'proxy' ? 'proxy' : 'webspeech';
  window.sttEngine = val;
  S.setString(K.STT_ENGINE, val);
  S.setBoolean(K.STT_PROXY_ENABLED, val === 'proxy');
  if (typeof trackEvent === 'function') trackEvent('stt_engine_changed', { engine: val });
  debugLog(`STT engine set to: ${val}`, 'info');
}
