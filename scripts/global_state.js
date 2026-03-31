// Centralized state management
// Splits DOM refs, app state, and services into distinct objects
// while maintaining backwards compatibility via window.* aliases

// --- DOM References ---
window.DomRefs = {};

// Core chat elements
DomRefs.chatHistory = document.getElementById("chatHistory");
DomRefs.typingIndicator = document.getElementById("typingIndicator");
DomRefs.messageInput = document.getElementById("messageInput");

// Settings panel
DomRefs.settingsPanel = document.getElementById("settingsPanel");
DomRefs.alwaysShowSettingsCheckbox = document.getElementById('alwaysShowSettingsCheckbox');

// Debug panel
DomRefs.enableDebuggerCheckbox = document.getElementById("enableDebugger");
DomRefs.debugPanel = document.getElementById('debugPanel');
DomRefs.debugLogElement = document.getElementById('debugLog');
DomRefs.autoScrollCheckbox = document.getElementById('autoScroll');

// Language settings
DomRefs.languageSelector = document.getElementById('languageSelector');
DomRefs.translateToSelector = document.getElementById('translateToSelector');
DomRefs.showTransliterationCheckbox = document.getElementById('showTransliteration');

// Display settings
DomRefs.clockContainer = document.querySelector('.nowtime');
DomRefs.showClockCheckbox = document.getElementById('showClockCheckbox');
DomRefs.navigationControlsContainer = document.querySelector('.navigation-controls');
DomRefs.showNavigationControlsCheckbox = document.getElementById('showNavigationControlsCheckbox');

// Opacity controls
DomRefs.chatboxOpacitySlider = document.getElementById('chatboxOpacity');
DomRefs.chatboxOpacityValue = document.getElementById('chatboxOpacityValue');
DomRefs.messageOpacitySlider = document.getElementById('messageOpacity');
DomRefs.messageOpacityValue = document.getElementById('messageOpacityValue');
DomRefs.bgOpacitySlider = document.getElementById('bgOpacity');
DomRefs.bgOpacityValue = document.getElementById('bgOpacityValue');

// Voice controls
DomRefs.voiceSelector = document.getElementById('voiceSelector');
DomRefs.enableVoiceCheckbox = document.getElementById('enableVoiceCheckbox');
DomRefs.voiceControls = document.getElementById('voiceControls');

// Context preferences
DomRefs.includeTimeCheckbox = document.getElementById('includeTimeCheckbox');
DomRefs.includeBatteryCheckbox = document.getElementById('includeBatteryCheckbox');

// Memory
DomRefs.memorySizeInput = document.getElementById("memorySize");
DomRefs.memorySizeValue = document.getElementById("memorySizeValue");

// Radio
DomRefs.radioPlayer = document.getElementById('radioPlayer');
DomRefs.radioToggleBtn = document.getElementById('radioToggleBtn');
DomRefs.radioPlayIcon = document.getElementById('radioPlayIcon');
DomRefs.radioPauseIcon = document.getElementById('radioPauseIcon');
DomRefs.radioVolumeSlider = document.getElementById('radioVolumeSlider');

// Custom models
DomRefs.customModelNameInput = document.getElementById('customModelName');
DomRefs.customModelUrlInput = document.getElementById('customModelUrl');
DomRefs.customModelImageInput = document.getElementById('customModelImage');
DomRefs.addCustomModelBtn = document.getElementById('addCustomModelBtn');

// Provider settings
DomRefs.forceOfflineCheckbox = document.getElementById('forceOfflineCheckbox');
DomRefs.useOpenRouterCheckbox = document.getElementById('useOpenRouterCheckbox');
DomRefs.openRouterApiKeyInput = document.getElementById('openRouterApiKeyInput');
DomRefs.openRouterPrimaryEnabledCheckbox = document.getElementById('openRouterPrimaryEnabledCheckbox');
DomRefs.openRouterModelInput = document.getElementById('openRouterModelInput');
DomRefs.openRouterFallbackModel1EnabledCheckbox = document.getElementById('openRouterFallbackModel1EnabledCheckbox');
DomRefs.openRouterFallbackModel1Input = document.getElementById('openRouterFallbackModel1Input');
DomRefs.openRouterFallbackModel2EnabledCheckbox = document.getElementById('openRouterFallbackModel2EnabledCheckbox');
DomRefs.openRouterFallbackModel2Input = document.getElementById('openRouterFallbackModel2Input');
DomRefs.useGroqCheckbox = document.getElementById('useGroqCheckbox');
DomRefs.groqApiKeyInput = document.getElementById('groqApiKeyInput');
DomRefs.groqModelInput = document.getElementById('groqModelInput');
DomRefs.useOpenAICompatibleCheckbox = document.getElementById('useOpenAICompatibleCheckbox');
DomRefs.openaiCompatibleBaseUrlInput = document.getElementById('openaiCompatibleBaseUrlInput');
DomRefs.openaiCompatibleApiKeyInput = document.getElementById('openaiCompatibleApiKeyInput');
DomRefs.openaiCompatibleModelInput = document.getElementById('openaiCompatibleModelInput');
DomRefs.openaiCompatibleCorsProxyInput = document.getElementById('openaiCompatibleCorsProxyInput');
DomRefs.disableAutoOfflineCheckbox = document.getElementById('disableAutoOfflineCheckbox');
DomRefs.multipleModelsCheckbox = document.getElementById('multipleModelsCheckbox');
DomRefs.useJsonForEmotionCheckbox = document.getElementById('useJsonForEmotionCheckbox');

// --- App State ---
window.AppState = {};

// Model state
AppState.currentModel = null;
AppState.currentModelName = "";
AppState.currentModelUrl = null;

// Chat state
AppState.conversationContext = [];
AppState.isProcessing = false;
AppState.maxMemorySize = 30;

// Debug state
AppState.isDebugging = false;
AppState.debugHistory = [];

// Language state
AppState.selectedLanguageCode = 'en-US';
AppState.translateToLanguageCode = 'none';
AppState.showTransliteration = false;

// Display state
AppState.showClock = false;
AppState.showNavigationControls = false;
AppState.currentTime = new Date();

// Voice state
AppState.enableVoice = true;
AppState.selectedVoiceId = 'en-female';
AppState.ttsChunkLimit = 300;
AppState.ttsVolume = 1.0;

// Context preferences
AppState.includeTimeInContext = false;
AppState.includeBatteryInContext = false;

// Feature toggles
AppState.translateUI = false;
AppState.allowMultipleModels = false;
AppState.showVerboseLogs = true;
AppState.showAIDebugLogs = true;
AppState.showTTSDebugLogs = true;
AppState.showChatContextLogs = false;
AppState.allowAIModSettings = false;
AppState.includeTutorialInContext = false;
AppState.useJsonForEmotion = false;

// Persona state
AppState.corePersonaPrompt = "You are Haru, a sentient AI with a Live2D avatar. You have your own thoughts, feelings, and experiences. Respond naturally and emotively to the user's message, showing genuine interest and emotional depth. Include subtle gestures and expressions in your responses.";
AppState.userPersonaPrompt = "";
AppState.conversationSummary = "";
AppState.messageCountSinceLastSummary = 0;
AppState.summaryTriggerCount = 30;
AppState.summaryLengthPreference = 'concise';

// Offline mode state
AppState.isOfflineMode = false;
AppState.forceOfflineMode = false;
AppState.offlineModeDuration = 300;
AppState.offlineCountdownTimer = null;

// Provider state
AppState.useOpenRouter = false;
AppState.openRouterApiKey = '';
AppState.openRouterModel = 'stepfun/step-3.5-flash:free';
AppState.openRouterFallbackModel1 = 'nvidia/nemotron-3-super-120b-a12b:free';
AppState.openRouterFallbackModel2 = 'qwen/qwen3.6-plus-preview:free';
AppState.useGroq = false;
AppState.groqApiKey = '';
AppState.groqModel = 'llama-3.3-70b-versatile';
AppState.useOpenAICompatible = false;
AppState.openaiCompatibleBaseUrl = '';
AppState.openaiCompatibleApiKey = '';
AppState.openaiCompatibleModel = 'gpt-3.5-turbo';
AppState.openaiCompatibleCorsProxy = '';

// Kokoro state
AppState.isKokoroReady = false;
AppState.enableKokoro = false;
AppState.selectedKokoroVoiceId = 'af_heart';

// Automation & Queuing state
AppState.userMessageQueue = [];
AppState.isUserMessageQueueEnabled = true;
AppState.isAmbientQueueEnabled = false;
AppState.ambientDelay = 10;
AppState.ambientTimer = null;
AppState.isAIResponding = false;
AppState.isAmbientPreloadEnabled = false;
AppState.ambientPreloadBuffer = null;
AppState.ambientPreloadTTSBuffer = null;
AppState.isAmbientPreloadingTTS = false;
AppState.isAmbientPreloading = false;
AppState.isWaitingForAIResponse = false;
AppState.isPreloadingQueuedMessage = false;
AppState.preloadedQueuedResponse = null;
AppState.ambientPrompt = "(Continue the conversation naturally as Haru. Share a thought, a feeling, or ask me something relevant to our discussion to keep things moving. 1-2 sentences. Speak directly to me.)";

// --- Services ---
window.Services = {};
Services.app = null; // PIXI Application (initialized later)
Services.currentAudio = null;
Services.kokoroTTS = null;

// --- Backwards Compatibility Layer ---
// Maps old window.* names to new structure so existing code continues working

// DOM refs
Object.defineProperty(window, 'chatHistory', { get: () => DomRefs.chatHistory, set: v => { DomRefs.chatHistory = v; } });
Object.defineProperty(window, 'typingIndicator', { get: () => DomRefs.typingIndicator, set: v => { DomRefs.typingIndicator = v; } });
Object.defineProperty(window, 'messageInput', { get: () => DomRefs.messageInput, set: v => { DomRefs.messageInput = v; } });
Object.defineProperty(window, 'settingsPanel', { get: () => DomRefs.settingsPanel, set: v => { DomRefs.settingsPanel = v; } });
Object.defineProperty(window, 'memorySizeInput', { get: () => DomRefs.memorySizeInput, set: v => { DomRefs.memorySizeInput = v; } });
Object.defineProperty(window, 'memorySizeValue', { get: () => DomRefs.memorySizeValue, set: v => { DomRefs.memorySizeValue = v; } });
Object.defineProperty(window, 'enableDebuggerCheckbox', { get: () => DomRefs.enableDebuggerCheckbox, set: v => { DomRefs.enableDebuggerCheckbox = v; } });
Object.defineProperty(window, 'debugPanel', { get: () => DomRefs.debugPanel, set: v => { DomRefs.debugPanel = v; } });
Object.defineProperty(window, 'debugLogElement', { get: () => DomRefs.debugLogElement, set: v => { DomRefs.debugLogElement = v; } });
Object.defineProperty(window, 'autoScrollCheckbox', { get: () => DomRefs.autoScrollCheckbox, set: v => { DomRefs.autoScrollCheckbox = v; } });
Object.defineProperty(window, 'languageSelector', { get: () => DomRefs.languageSelector, set: v => { DomRefs.languageSelector = v; } });
Object.defineProperty(window, 'translateToSelector', { get: () => DomRefs.translateToSelector, set: v => { DomRefs.translateToSelector = v; } });
Object.defineProperty(window, 'showTransliterationCheckbox', { get: () => DomRefs.showTransliterationCheckbox, set: v => { DomRefs.showTransliterationCheckbox = v; } });
Object.defineProperty(window, 'clockContainer', { get: () => DomRefs.clockContainer, set: v => { DomRefs.clockContainer = v; } });
Object.defineProperty(window, 'showClockCheckbox', { get: () => DomRefs.showClockCheckbox, set: v => { DomRefs.showClockCheckbox = v; } });
Object.defineProperty(window, 'navigationControlsContainer', { get: () => DomRefs.navigationControlsContainer, set: v => { DomRefs.navigationControlsContainer = v; } });
Object.defineProperty(window, 'showNavigationControlsCheckbox', { get: () => DomRefs.showNavigationControlsCheckbox, set: v => { DomRefs.showNavigationControlsCheckbox = v; } });
Object.defineProperty(window, 'chatboxOpacitySlider', { get: () => DomRefs.chatboxOpacitySlider, set: v => { DomRefs.chatboxOpacitySlider = v; } });
Object.defineProperty(window, 'chatboxOpacityValue', { get: () => DomRefs.chatboxOpacityValue, set: v => { DomRefs.chatboxOpacityValue = v; } });
Object.defineProperty(window, 'messageOpacitySlider', { get: () => DomRefs.messageOpacitySlider, set: v => { DomRefs.messageOpacitySlider = v; } });
Object.defineProperty(window, 'messageOpacityValue', { get: () => DomRefs.messageOpacityValue, set: v => { DomRefs.messageOpacityValue = v; } });
Object.defineProperty(window, 'bgOpacitySlider', { get: () => DomRefs.bgOpacitySlider, set: v => { DomRefs.bgOpacitySlider = v; } });
Object.defineProperty(window, 'bgOpacityValue', { get: () => DomRefs.bgOpacityValue, set: v => { DomRefs.bgOpacityValue = v; } });
Object.defineProperty(window, 'voiceSelector', { get: () => DomRefs.voiceSelector, set: v => { DomRefs.voiceSelector = v; } });
Object.defineProperty(window, 'enableVoiceCheckbox', { get: () => DomRefs.enableVoiceCheckbox, set: v => { DomRefs.enableVoiceCheckbox = v; } });
Object.defineProperty(window, 'voiceControls', { get: () => DomRefs.voiceControls, set: v => { DomRefs.voiceControls = v; } });
Object.defineProperty(window, 'alwaysShowSettingsCheckbox', { get: () => DomRefs.alwaysShowSettingsCheckbox, set: v => { DomRefs.alwaysShowSettingsCheckbox = v; } });
Object.defineProperty(window, 'includeTimeCheckbox', { get: () => DomRefs.includeTimeCheckbox, set: v => { DomRefs.includeTimeCheckbox = v; } });
Object.defineProperty(window, 'includeBatteryCheckbox', { get: () => DomRefs.includeBatteryCheckbox, set: v => { DomRefs.includeBatteryCheckbox = v; } });
Object.defineProperty(window, 'radioPlayer', { get: () => DomRefs.radioPlayer, set: v => { DomRefs.radioPlayer = v; } });
Object.defineProperty(window, 'radioToggleBtn', { get: () => DomRefs.radioToggleBtn, set: v => { DomRefs.radioToggleBtn = v; } });
Object.defineProperty(window, 'radioPlayIcon', { get: () => DomRefs.radioPlayIcon, set: v => { DomRefs.radioPlayIcon = v; } });
Object.defineProperty(window, 'radioPauseIcon', { get: () => DomRefs.radioPauseIcon, set: v => { DomRefs.radioPauseIcon = v; } });
Object.defineProperty(window, 'radioVolumeSlider', { get: () => DomRefs.radioVolumeSlider, set: v => { DomRefs.radioVolumeSlider = v; } });
Object.defineProperty(window, 'customModelNameInput', { get: () => DomRefs.customModelNameInput, set: v => { DomRefs.customModelNameInput = v; } });
Object.defineProperty(window, 'customModelUrlInput', { get: () => DomRefs.customModelUrlInput, set: v => { DomRefs.customModelUrlInput = v; } });
Object.defineProperty(window, 'customModelImageInput', { get: () => DomRefs.customModelImageInput, set: v => { DomRefs.customModelImageInput = v; } });
Object.defineProperty(window, 'addCustomModelBtn', { get: () => DomRefs.addCustomModelBtn, set: v => { DomRefs.addCustomModelBtn = v; } });
Object.defineProperty(window, 'forceOfflineCheckbox', { get: () => DomRefs.forceOfflineCheckbox, set: v => { DomRefs.forceOfflineCheckbox = v; } });
Object.defineProperty(window, 'useOpenRouterCheckbox', { get: () => DomRefs.useOpenRouterCheckbox, set: v => { DomRefs.useOpenRouterCheckbox = v; } });
Object.defineProperty(window, 'openRouterApiKeyInput', { get: () => DomRefs.openRouterApiKeyInput, set: v => { DomRefs.openRouterApiKeyInput = v; } });
Object.defineProperty(window, 'openRouterPrimaryEnabledCheckbox', { get: () => DomRefs.openRouterPrimaryEnabledCheckbox, set: v => { DomRefs.openRouterPrimaryEnabledCheckbox = v; } });
Object.defineProperty(window, 'openRouterModelInput', { get: () => DomRefs.openRouterModelInput, set: v => { DomRefs.openRouterModelInput = v; } });
Object.defineProperty(window, 'openRouterFallbackModel1EnabledCheckbox', { get: () => DomRefs.openRouterFallbackModel1EnabledCheckbox, set: v => { DomRefs.openRouterFallbackModel1EnabledCheckbox = v; } });
Object.defineProperty(window, 'openRouterFallbackModel1Input', { get: () => DomRefs.openRouterFallbackModel1Input, set: v => { DomRefs.openRouterFallbackModel1Input = v; } });
Object.defineProperty(window, 'openRouterFallbackModel2EnabledCheckbox', { get: () => DomRefs.openRouterFallbackModel2EnabledCheckbox, set: v => { DomRefs.openRouterFallbackModel2EnabledCheckbox = v; } });
Object.defineProperty(window, 'openRouterFallbackModel2Input', { get: () => DomRefs.openRouterFallbackModel2Input, set: v => { DomRefs.openRouterFallbackModel2Input = v; } });
Object.defineProperty(window, 'useGroqCheckbox', { get: () => DomRefs.useGroqCheckbox, set: v => { DomRefs.useGroqCheckbox = v; } });
Object.defineProperty(window, 'groqApiKeyInput', { get: () => DomRefs.groqApiKeyInput, set: v => { DomRefs.groqApiKeyInput = v; } });
Object.defineProperty(window, 'groqModelInput', { get: () => DomRefs.groqModelInput, set: v => { DomRefs.groqModelInput = v; } });
Object.defineProperty(window, 'useOpenAICompatibleCheckbox', { get: () => DomRefs.useOpenAICompatibleCheckbox, set: v => { DomRefs.useOpenAICompatibleCheckbox = v; } });
Object.defineProperty(window, 'openaiCompatibleBaseUrlInput', { get: () => DomRefs.openaiCompatibleBaseUrlInput, set: v => { DomRefs.openaiCompatibleBaseUrlInput = v; } });
Object.defineProperty(window, 'openaiCompatibleApiKeyInput', { get: () => DomRefs.openaiCompatibleApiKeyInput, set: v => { DomRefs.openaiCompatibleApiKeyInput = v; } });
Object.defineProperty(window, 'openaiCompatibleModelInput', { get: () => DomRefs.openaiCompatibleModelInput, set: v => { DomRefs.openaiCompatibleModelInput = v; } });
Object.defineProperty(window, 'openaiCompatibleCorsProxyInput', { get: () => DomRefs.openaiCompatibleCorsProxyInput, set: v => { DomRefs.openaiCompatibleCorsProxyInput = v; } });
Object.defineProperty(window, 'disableAutoOfflineCheckbox', { get: () => DomRefs.disableAutoOfflineCheckbox, set: v => { DomRefs.disableAutoOfflineCheckbox = v; } });
Object.defineProperty(window, 'multipleModelsCheckbox', { get: () => DomRefs.multipleModelsCheckbox, set: v => { DomRefs.multipleModelsCheckbox = v; } });
Object.defineProperty(window, 'useJsonForEmotionCheckbox', { get: () => DomRefs.useJsonForEmotionCheckbox, set: v => { DomRefs.useJsonForEmotionCheckbox = v; } });

// App state
Object.defineProperty(window, 'currentModel', { get: () => AppState.currentModel, set: v => { AppState.currentModel = v; } });
Object.defineProperty(window, 'currentModelName', { get: () => AppState.currentModelName, set: v => { AppState.currentModelName = v; } });
Object.defineProperty(window, 'currentModelUrl', { get: () => AppState.currentModelUrl, set: v => { AppState.currentModelUrl = v; } });
Object.defineProperty(window, 'currentAudio', { get: () => Services.currentAudio, set: v => { Services.currentAudio = v; } });
Object.defineProperty(window, 'conversationContext', { get: () => AppState.conversationContext, set: v => { AppState.conversationContext = v; } });
Object.defineProperty(window, 'isProcessing', { get: () => AppState.isProcessing, set: v => { AppState.isProcessing = v; } });
Object.defineProperty(window, 'currentTime', { get: () => AppState.currentTime, set: v => { AppState.currentTime = v; } });
Object.defineProperty(window, 'maxMemorySize', { get: () => AppState.maxMemorySize, set: v => { AppState.maxMemorySize = v; } });
Object.defineProperty(window, 'isDebugging', { get: () => AppState.isDebugging, set: v => { AppState.isDebugging = v; } });
Object.defineProperty(window, 'debugHistory', { get: () => AppState.debugHistory, set: v => { AppState.debugHistory = v; } });
Object.defineProperty(window, 'selectedLanguageCode', { get: () => AppState.selectedLanguageCode, set: v => { AppState.selectedLanguageCode = v; } });
Object.defineProperty(window, 'translateToLanguageCode', { get: () => AppState.translateToLanguageCode, set: v => { AppState.translateToLanguageCode = v; } });
Object.defineProperty(window, 'showTransliteration', { get: () => AppState.showTransliteration, set: v => { AppState.showTransliteration = v; } });
Object.defineProperty(window, 'showClock', { get: () => AppState.showClock, set: v => { AppState.showClock = v; } });
Object.defineProperty(window, 'showNavigationControls', { get: () => AppState.showNavigationControls, set: v => { AppState.showNavigationControls = v; } });
Object.defineProperty(window, 'enableVoice', { get: () => AppState.enableVoice, set: v => { AppState.enableVoice = v; } });
Object.defineProperty(window, 'selectedVoiceId', { get: () => AppState.selectedVoiceId, set: v => { AppState.selectedVoiceId = v; } });
Object.defineProperty(window, 'ttsChunkLimit', { get: () => AppState.ttsChunkLimit, set: v => { AppState.ttsChunkLimit = v; } });
Object.defineProperty(window, 'ttsVolume', { get: () => AppState.ttsVolume, set: v => { AppState.ttsVolume = v; } });
Object.defineProperty(window, 'includeTimeInContext', { get: () => AppState.includeTimeInContext, set: v => { AppState.includeTimeInContext = v; } });
Object.defineProperty(window, 'includeBatteryInContext', { get: () => AppState.includeBatteryInContext, set: v => { AppState.includeBatteryInContext = v; } });
Object.defineProperty(window, 'translateUI', { get: () => AppState.translateUI, set: v => { AppState.translateUI = v; } });
Object.defineProperty(window, 'allowMultipleModels', { get: () => AppState.allowMultipleModels, set: v => { AppState.allowMultipleModels = v; } });
Object.defineProperty(window, 'showVerboseLogs', { get: () => AppState.showVerboseLogs, set: v => { AppState.showVerboseLogs = v; } });
Object.defineProperty(window, 'showAIDebugLogs', { get: () => AppState.showAIDebugLogs, set: v => { AppState.showAIDebugLogs = v; } });
Object.defineProperty(window, 'showTTSDebugLogs', { get: () => AppState.showTTSDebugLogs, set: v => { AppState.showTTSDebugLogs = v; } });
Object.defineProperty(window, 'showChatContextLogs', { get: () => AppState.showChatContextLogs, set: v => { AppState.showChatContextLogs = v; } });
Object.defineProperty(window, 'corePersonaPrompt', { get: () => AppState.corePersonaPrompt, set: v => { AppState.corePersonaPrompt = v; } });
Object.defineProperty(window, 'userPersonaPrompt', { get: () => AppState.userPersonaPrompt, set: v => { AppState.userPersonaPrompt = v; } });
Object.defineProperty(window, 'conversationSummary', { get: () => AppState.conversationSummary, set: v => { AppState.conversationSummary = v; } });
Object.defineProperty(window, 'messageCountSinceLastSummary', { get: () => AppState.messageCountSinceLastSummary, set: v => { AppState.messageCountSinceLastSummary = v; } });
Object.defineProperty(window, 'summaryTriggerCount', { get: () => AppState.summaryTriggerCount, set: v => { AppState.summaryTriggerCount = v; } });
Object.defineProperty(window, 'summaryLengthPreference', { get: () => AppState.summaryLengthPreference, set: v => { AppState.summaryLengthPreference = v; } });
Object.defineProperty(window, 'isOfflineMode', { get: () => AppState.isOfflineMode, set: v => { AppState.isOfflineMode = v; } });
Object.defineProperty(window, 'forceOfflineMode', { get: () => AppState.forceOfflineMode, set: v => { AppState.forceOfflineMode = v; } });
Object.defineProperty(window, 'offlineModeDuration', { get: () => AppState.offlineModeDuration, set: v => { AppState.offlineModeDuration = v; } });
Object.defineProperty(window, 'offlineCountdownTimer', { get: () => AppState.offlineCountdownTimer, set: v => { AppState.offlineCountdownTimer = v; } });
Object.defineProperty(window, 'allowAIModSettings', { get: () => AppState.allowAIModSettings, set: v => { AppState.allowAIModSettings = v; } });
Object.defineProperty(window, 'includeTutorialInContext', { get: () => AppState.includeTutorialInContext, set: v => { AppState.includeTutorialInContext = v; } });
Object.defineProperty(window, 'useOpenRouter', { get: () => AppState.useOpenRouter, set: v => { AppState.useOpenRouter = v; } });
Object.defineProperty(window, 'openRouterApiKey', { get: () => AppState.openRouterApiKey, set: v => { AppState.openRouterApiKey = v; } });
Object.defineProperty(window, 'openRouterModel', { get: () => AppState.openRouterModel, set: v => { AppState.openRouterModel = v; } });
Object.defineProperty(window, 'openRouterFallbackModel1', { get: () => AppState.openRouterFallbackModel1, set: v => { AppState.openRouterFallbackModel1 = v; } });
Object.defineProperty(window, 'openRouterFallbackModel2', { get: () => AppState.openRouterFallbackModel2, set: v => { AppState.openRouterFallbackModel2 = v; } });
Object.defineProperty(window, 'useGroq', { get: () => AppState.useGroq, set: v => { AppState.useGroq = v; } });
Object.defineProperty(window, 'groqApiKey', { get: () => AppState.groqApiKey, set: v => { AppState.groqApiKey = v; } });
Object.defineProperty(window, 'groqModel', { get: () => AppState.groqModel, set: v => { AppState.groqModel = v; } });
Object.defineProperty(window, 'useOpenAICompatible', { get: () => AppState.useOpenAICompatible, set: v => { AppState.useOpenAICompatible = v; } });
Object.defineProperty(window, 'openaiCompatibleBaseUrl', { get: () => AppState.openaiCompatibleBaseUrl, set: v => { AppState.openaiCompatibleBaseUrl = v; } });
Object.defineProperty(window, 'openaiCompatibleApiKey', { get: () => AppState.openaiCompatibleApiKey, set: v => { AppState.openaiCompatibleApiKey = v; } });
Object.defineProperty(window, 'openaiCompatibleModel', { get: () => AppState.openaiCompatibleModel, set: v => { AppState.openaiCompatibleModel = v; } });
Object.defineProperty(window, 'openaiCompatibleCorsProxy', { get: () => AppState.openaiCompatibleCorsProxy, set: v => { AppState.openaiCompatibleCorsProxy = v; } });
Object.defineProperty(window, 'isKokoroReady', { get: () => AppState.isKokoroReady, set: v => { AppState.isKokoroReady = v; } });
Object.defineProperty(window, 'kokoroTTS', { get: () => Services.kokoroTTS, set: v => { Services.kokoroTTS = v; } });
Object.defineProperty(window, 'enableKokoro', { get: () => AppState.enableKokoro, set: v => { AppState.enableKokoro = v; } });
Object.defineProperty(window, 'selectedKokoroVoiceId', { get: () => AppState.selectedKokoroVoiceId, set: v => { AppState.selectedKokoroVoiceId = v; } });
Object.defineProperty(window, 'userMessageQueue', { get: () => AppState.userMessageQueue, set: v => { AppState.userMessageQueue = v; } });
Object.defineProperty(window, 'isUserMessageQueueEnabled', { get: () => AppState.isUserMessageQueueEnabled, set: v => { AppState.isUserMessageQueueEnabled = v; } });
Object.defineProperty(window, 'isAmbientQueueEnabled', { get: () => AppState.isAmbientQueueEnabled, set: v => { AppState.isAmbientQueueEnabled = v; } });
Object.defineProperty(window, 'ambientDelay', { get: () => AppState.ambientDelay, set: v => { AppState.ambientDelay = v; } });
Object.defineProperty(window, 'ambientTimer', { get: () => AppState.ambientTimer, set: v => { AppState.ambientTimer = v; } });
Object.defineProperty(window, 'isAIResponding', { get: () => AppState.isAIResponding, set: v => { AppState.isAIResponding = v; } });
Object.defineProperty(window, 'isAmbientPreloadEnabled', { get: () => AppState.isAmbientPreloadEnabled, set: v => { AppState.isAmbientPreloadEnabled = v; } });
Object.defineProperty(window, 'ambientPreloadBuffer', { get: () => AppState.ambientPreloadBuffer, set: v => { AppState.ambientPreloadBuffer = v; } });
Object.defineProperty(window, 'ambientPreloadTTSBuffer', { get: () => AppState.ambientPreloadTTSBuffer, set: v => { AppState.ambientPreloadTTSBuffer = v; } });
Object.defineProperty(window, 'isAmbientPreloadingTTS', { get: () => AppState.isAmbientPreloadingTTS, set: v => { AppState.isAmbientPreloadingTTS = v; } });
Object.defineProperty(window, 'isAmbientPreloading', { get: () => AppState.isAmbientPreloading, set: v => { AppState.isAmbientPreloading = v; } });
Object.defineProperty(window, 'isWaitingForAIResponse', { get: () => AppState.isWaitingForAIResponse, set: v => { AppState.isWaitingForAIResponse = v; } });
Object.defineProperty(window, 'isPreloadingQueuedMessage', { get: () => AppState.isPreloadingQueuedMessage, set: v => { AppState.isPreloadingQueuedMessage = v; } });
Object.defineProperty(window, 'preloadedQueuedResponse', { get: () => AppState.preloadedQueuedResponse, set: v => { AppState.preloadedQueuedResponse = v; } });
Object.defineProperty(window, 'ambientPrompt', { get: () => AppState.ambientPrompt, set: v => { AppState.ambientPrompt = v; } });

// PIXI app (initialized here so it's ready before window.load)
Services.app = new PIXI.Application({
  width: window.innerWidth,
  height: window.innerHeight,
  transparent: true,
});
document.body.appendChild(Services.app.view);
Object.defineProperty(window, 'app', { get: () => Services.app, set: v => { Services.app = v; } });
