// Centralized browser storage wrapper
// Replaces scattered localStorage calls with a typed, safe API.

(function () {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    // UI panels
    SETTINGS_PANEL_LAST_OPEN: 'settingsPanelLastOpen',
    SETTINGS_ALWAYS_SHOW_ON_LOAD: 'settingsAlwaysShowOnLoad',
    DEBUG_PANEL_VISIBLE: 'debugPanelVisible',
    CHAT_SIDEBAR_VISIBLE: 'chatSidebarVisible',

    // Language & display
    SELECTED_LANGUAGE_CODE: 'selectedLanguageCode',
    INTERFACE_LANGUAGE: 'interfaceLanguage',
    SHOW_TRANSLITERATION: 'showTransliteration',
    SHOW_CLOCK: 'showClock',
    SHOW_NAVIGATION_CONTROLS: 'showNavigationControls',

    // Opacities
    CHATBOX_OPACITY: 'chatboxOpacity',
    MESSAGE_OPACITY: 'messageOpacity',
    BG_IMAGE_OPACITY: 'bgImageOpacity',

    // Context preferences
    INCLUDE_TIME_IN_CONTEXT: 'includeTimeInContext',
    INCLUDE_BATTERY_IN_CONTEXT: 'includeBatteryInContext',

    // Memory
    MAX_MEMORY_SIZE: 'maxMemorySize',
    CONVERSATION_CONTEXT: 'conversationContext',
    CONVERSATION_SUMMARY: 'conversationSummary',
    MESSAGE_COUNT_SINCE_LAST_SUMMARY: 'messageCountSinceLastSummary',
    SUMMARY_TRIGGER_COUNT: 'summaryTriggerCount',
    SUMMARY_LENGTH_PREFERENCE: 'summaryLengthPreference',

    // Persona
    CORE_PERSONA_PROMPT: 'corePersonaPrompt',
    USER_PERSONA_PROMPT: 'userPersonaPrompt',

    // Voice
    SELECTED_VOICE_ID: 'selectedVoiceId',
    ENABLE_VOICE: 'enableVoice',
    ENABLE_PRIMARY_VOICE: 'enablePrimaryVoice',
    ENABLE_FALLBACK_VOICE: 'enableFallbackVoice',
    ENABLE_KOKORO: 'enableKokoro',
    SELECTED_KOKORO_VOICE_ID: 'selectedKokoroVoiceId',
    TTS_CHUNK_LIMIT: 'ttsChunkLimit',
    TTS_VOLUME: 'ttsVolume',
    TTS_FALLBACK_VOICE_ID: 'ttsFallbackVoiceId',

    // Automation & queue
    IS_USER_MESSAGE_QUEUE_ENABLED: 'isUserMessageQueueEnabled',
    IS_AMBIENT_QUEUE_ENABLED: 'isAmbientQueueEnabled',
    AMBIENT_DELAY: 'ambientDelay',
    AMBIENT_PROMPT: 'ambientPrompt',
    IS_AMBIENT_PRELOAD_ENABLED: 'isAmbientPreloadEnabled',

    // Debug & logging
    SHOW_VERBOSE_LOGS: 'showVerboseLogs',
    SHOW_AI_DEBUG_LOGS: 'showAIDebugLogs',
    SHOW_TTS_DEBUG_LOGS: 'showTTSDebugLogs',
    SHOW_CHAT_CONTEXT_LOGS: 'showChatContextLogs',

    // Feature toggles
    ALLOW_MULTIPLE_MODELS: 'allowMultipleModels',
    ALLOW_AI_MOD_SETTINGS: 'allowAIModSettings',
    INCLUDE_TUTORIAL_IN_CONTEXT: 'includeTutorialInContext',
    USE_JSON_FOR_EMOTION: 'useJsonForEmotion',
    TRANSLATE_UI: 'translateUI',

    // Providers
    USE_OPEN_ROUTER: 'useOpenRouter',
    OPEN_ROUTER_API_KEY: 'openRouterApiKey',
    OPEN_ROUTER_MODEL: 'openRouterModel',
    OPEN_ROUTER_PRIMARY_ENABLED: 'openRouterPrimaryEnabled',
    OPEN_ROUTER_FALLBACK_MODELS: 'openRouterFallbackModels',
    OPEN_ROUTER_FALLBACK_MODEL_1: 'openRouterFallbackModel1',
    OPEN_ROUTER_FALLBACK_MODEL_1_ENABLED: 'openRouterFallbackModel1Enabled',
    OPEN_ROUTER_FALLBACK_MODEL_2: 'openRouterFallbackModel2',
    OPEN_ROUTER_FALLBACK_MODEL_2_ENABLED: 'openRouterFallbackModel2Enabled',
    USE_GROQ: 'useGroq',
    GROQ_API_KEY: 'groqApiKey',
    GROQ_MODEL: 'groqModel',
    USE_OPENAI_COMPATIBLE: 'useOpenAICompatible',
    OPENAI_COMPATIBLE_BASE_URL: 'openaiCompatibleBaseUrl',
    OPENAI_COMPATIBLE_API_KEY: 'openaiCompatibleApiKey',
    OPENAI_COMPATIBLE_MODEL: 'openaiCompatibleModel',
    OPENAI_COMPATIBLE_CORS_PROXY: 'openaiCompatibleCorsProxy',

    // Offline
    FORCE_OFFLINE_MODE: 'forceOfflineMode',
    OFFLINE_MODE_DURATION: 'offlineModeDuration',
    DISABLE_AUTO_OFFLINE_MODE: 'disableAutoOfflineMode',

    // Models & backgrounds
    SELECTED_MODEL_URL: 'selectedModelUrl',
    USER_MODELS: 'userModels',
    CURRENT_BACKGROUND_URL: 'currentBackgroundUrl',
    BG_LIBRARY: 'bgLibrary',
    BG_FIT_MODE: 'bgFitMode',

    // YouTube
    YOUTUBE_SMALL_MODE: 'youtubeSmallMode',
  });

  function isStorageAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeGet(key) {
    if (!isStorageAvailable()) return null;
    try {
      return localStorage.getItem(key);
    } catch (e) {
      if (typeof debugLog === 'function') {
        debugLog(`Storage read error for key "${key}": ${e.message}`, 'warn');
      }
      return null;
    }
  }

  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError'
      || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || e.code === 22 || e.code === 1014;
  }

  // Frees space by dropping regenerable caches only. Deliberately never
  // evicts conversation data (chatData_*, CONVERSATION_CONTEXT) — silently
  // deleting a user's chats to make room for the next write is a worse
  // failure than the write itself failing.
  function reclaimSpace() {
    try {
      const uiCacheKeys = Object.keys(localStorage).filter(k => k.startsWith('uiStrings_'));
      if (uiCacheKeys.length > 0) {
        uiCacheKeys.forEach(k => localStorage.removeItem(k));
        if (typeof debugLog === 'function') {
          debugLog(`Storage: cleared ${uiCacheKeys.length} cached UI translation(s) to free space.`, 'warn');
        }
        return true;
      }
    } catch (e) { /* keep going */ }

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BG_LIBRARY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list) && list.length > 10) {
        localStorage.setItem(STORAGE_KEYS.BG_LIBRARY, JSON.stringify(list.slice(0, 10)));
        if (typeof debugLog === 'function') {
          debugLog(`Storage: trimmed background library from ${list.length} to 10 entries.`, 'warn');
        }
        return true;
      }
    } catch (e) { /* keep going */ }

    return false;
  }

  let quotaWarningShown = false;
  function notifyStorageFull() {
    if (quotaWarningShown) return;
    quotaWarningShown = true;
    if (typeof addMessage === 'function') {
      addMessage(
        "I'm running out of browser storage, so I can't save new messages right now. " +
        "Deleting an old chat from the sidebar will free some space.",
        false
      );
    }
    if (typeof trackError === 'function') trackError('storage', 0);
  }

  // Writes to localStorage, reclaiming space and retrying once on quota
  // failure. This is the single choke point every AppStorage.set* call goes
  // through, so every caller — chat history, settings, model lists — gets
  // quota handling for free instead of throwing mid-write.
  function safeSet(key, value) {
    if (!isStorageAvailable()) return false;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) {
        if (typeof debugLog === 'function') {
          debugLog(`Storage write error for key "${key}": ${e.message}`, 'error');
        }
        return false;
      }

      if (typeof debugLog === 'function') {
        debugLog(`Storage quota exceeded writing "${key}". Attempting to reclaim space.`, 'warn');
      }
      if (reclaimSpace()) {
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (e2) { /* fall through */ }
      }

      if (typeof debugLog === 'function') {
        debugLog(`Storage: could not free enough space for "${key}". This change will not persist.`, 'error');
      }
      notifyStorageFull();
      return false;
    }
  }

  function safeRemove(key) {
    if (!isStorageAvailable()) return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      if (typeof debugLog === 'function') {
        debugLog(`Storage remove error for key "${key}": ${e.message}`, 'error');
      }
      return false;
    }
  }

  function getString(key, fallback) {
    const raw = safeGet(key);
    return raw !== null ? String(raw) : (typeof fallback === 'string' ? fallback : '');
  }

  function getBoolean(key, fallback) {
    const raw = safeGet(key);
    if (raw === null) return typeof fallback === 'boolean' ? fallback : false;
    return raw === 'true';
  }

  function getNumber(key, fallback) {
    const raw = safeGet(key);
    if (raw === null) return typeof fallback === 'number' ? fallback : NaN;
    const num = Number(raw);
    return Number.isFinite(num) ? num : (typeof fallback === 'number' ? fallback : NaN);
  }

  function getJSON(key, fallback) {
    const raw = safeGet(key);
    if (raw === null) return typeof fallback !== 'undefined' ? fallback : null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      if (typeof debugLog === 'function') {
        debugLog(`Storage JSON parse error for key "${key}": ${e.message}`, 'warn');
      }
      return typeof fallback !== 'undefined' ? fallback : null;
    }
  }

  function setString(key, value) {
    return safeSet(key, String(value));
  }

  function setBoolean(key, value) {
    return safeSet(key, value ? 'true' : 'false');
  }

  function setNumber(key, value) {
    return safeSet(key, String(value));
  }

  function setJSON(key, value) {
    try {
      return safeSet(key, JSON.stringify(value));
    } catch (e) {
      if (typeof debugLog === 'function') {
        debugLog(`Storage JSON stringify error for key "${key}": ${e.message}`, 'error');
      }
      return false;
    }
  }

  function remove(key) {
    return safeRemove(key);
  }

  window.AppStorage = Object.freeze({
    KEYS: STORAGE_KEYS,
    getString,
    getBoolean,
    getNumber,
    getJSON,
    setString,
    setBoolean,
    setNumber,
    setJSON,
    remove,
    isStorageAvailable,
  });
})();
