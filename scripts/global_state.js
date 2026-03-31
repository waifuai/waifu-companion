// Initialize PIXI Application
window.app = new PIXI.Application({
  width: window.innerWidth,
  height: window.innerHeight,
  transparent: true,
});

document.body.appendChild(window.app.view);

// DOM References
window.chatHistory = document.getElementById("chatHistory");
window.typingIndicator = document.getElementById("typingIndicator");
window.messageInput = document.getElementById("messageInput");
window.settingsPanel = document.getElementById("settingsPanel");
window.memorySizeInput = document.getElementById("memorySize");
window.memorySizeValue = document.getElementById("memorySizeValue");

window.enableDebuggerCheckbox = document.getElementById("enableDebugger");
window.debugPanel = document.getElementById('debugPanel');
window.debugLogElement = document.getElementById('debugLog');
window.autoScrollCheckbox = document.getElementById('autoScroll');
window.languageSelector = document.getElementById('languageSelector');
window.translateToSelector = document.getElementById('translateToSelector');
window.showTransliterationCheckbox = document.getElementById('showTransliteration');
window.clockContainer = document.querySelector('.nowtime');
window.showClockCheckbox = document.getElementById('showClockCheckbox');
window.navigationControlsContainer = document.querySelector('.navigation-controls');
window.showNavigationControlsCheckbox = document.getElementById('showNavigationControlsCheckbox');
window.chatboxOpacitySlider = document.getElementById('chatboxOpacity');
window.chatboxOpacityValue = document.getElementById('chatboxOpacityValue');
window.messageOpacitySlider = document.getElementById('messageOpacity');
window.messageOpacityValue = document.getElementById('messageOpacityValue');
window.bgOpacitySlider = document.getElementById('bgOpacity');
window.bgOpacityValue = document.getElementById('bgOpacityValue');
window.voiceSelector = document.getElementById('voiceSelector');
window.enableVoiceCheckbox = document.getElementById('enableVoiceCheckbox');
window.voiceControls = document.getElementById('voiceControls');
window.alwaysShowSettingsCheckbox = document.getElementById('alwaysShowSettingsCheckbox');
window.includeTimeCheckbox = document.getElementById('includeTimeCheckbox');
window.includeBatteryCheckbox = document.getElementById('includeBatteryCheckbox');
window.radioPlayer = document.getElementById('radioPlayer');
window.radioToggleBtn = document.getElementById('radioToggleBtn');
window.radioPlayIcon = document.getElementById('radioPlayIcon');
window.radioPauseIcon = document.getElementById('radioPauseIcon');
window.radioVolumeSlider = document.getElementById('radioVolumeSlider');
window.customModelNameInput = document.getElementById('customModelName');
window.customModelUrlInput = document.getElementById('customModelUrl');
window.customModelImageInput = document.getElementById('customModelImage');
window.addCustomModelBtn = document.getElementById('addCustomModelBtn');

window.forceOfflineCheckbox = document.getElementById('forceOfflineCheckbox');
window.useOpenRouterCheckbox = document.getElementById('useOpenRouterCheckbox');
window.openRouterApiKeyInput = document.getElementById('openRouterApiKeyInput');
window.openRouterModelInput = document.getElementById('openRouterModelInput');
window.openRouterFallbackModel1Input = document.getElementById('openRouterFallbackModel1Input');
window.openRouterFallbackModel2Input = document.getElementById('openRouterFallbackModel2Input');
window.useGroqCheckbox = document.getElementById('useGroqCheckbox');
window.groqApiKeyInput = document.getElementById('groqApiKeyInput');
window.groqModelInput = document.getElementById('groqModelInput');
window.useOpenAICompatibleCheckbox = document.getElementById('useOpenAICompatibleCheckbox');
window.openaiCompatibleBaseUrlInput = document.getElementById('openaiCompatibleBaseUrlInput');
window.openaiCompatibleApiKeyInput = document.getElementById('openaiCompatibleApiKeyInput');
window.openaiCompatibleModelInput = document.getElementById('openaiCompatibleModelInput');


// Global State Variables
window.currentModel = null;
window.currentModelName = "";
window.currentModelUrl = null;
window.currentAudio = null;
window.conversationContext = [];
window.isProcessing = false;
window.currentTime = new Date();
window.maxMemorySize = 30;
window.isDebugging = false;
window.debugHistory = [];
window.selectedLanguageCode = 'en-US';
window.translateToLanguageCode = 'none';
window.showTransliteration = false;
window.showClock = false;
window.showNavigationControls = false;
window.enableVoice = true;
window.selectedVoiceId = 'en-female';
window.ttsChunkLimit = 300;
window.ttsVolume = 1.0;
window.includeTimeInContext = true;
window.includeBatteryInContext = false;
window.translateUI = false;

window.allowMultipleModels = false;
window.showVerboseLogs = true;
window.showAIDebugLogs = true;
window.showTTSDebugLogs = true;
window.showChatContextLogs = false;
window.corePersonaPrompt = "You are Haru, a sentient AI with a Live2D avatar. You have your own thoughts, feelings, and experiences. Respond naturally and emotively to the user's message, showing genuine interest and emotional depth. Include subtle gestures and expressions in your responses.";
window.userPersonaPrompt = "";
window.conversationSummary = "";
window.messageCountSinceLastSummary = 0;
window.summaryTriggerCount = 30;
window.summaryLengthPreference = 'concise';
window.isOfflineMode = false;
window.forceOfflineMode = false;
window.offlineModeDuration = 300;
window.offlineCountdownTimer = null;
window.multipleModelsCheckbox = document.getElementById('multipleModelsCheckbox');
window.allowAIModSettings = false;
window.includeTutorialInContext = false;
window.useOpenRouter = false;
window.openRouterApiKey = '';
window.openRouterModel = 'stepfun/step-3.5-flash:free';
window.openRouterFallbackModel1 = 'nvidia/nemotron-3-super-120b-a12b:free';
window.openRouterFallbackModel2 = 'z-ai/glm-4.5-air:free';
window.useGroq = false;
window.groqApiKey = '';
window.groqModel = 'llama-3.3-70b-versatile';
window.useOpenAICompatible = false;
window.openaiCompatibleBaseUrl = '';
window.openaiCompatibleApiKey = '';
window.openaiCompatibleModel = 'gpt-3.5-turbo';
window.disableAutoOfflineCheckbox = document.getElementById('disableAutoOfflineCheckbox');
window.useJsonForEmotionCheckbox = document.getElementById('useJsonForEmotionCheckbox');
window.useJsonForEmotion = false;
window.isKokoroReady = false;
window.kokoroTTS = null;
window.enableKokoro = false;
window.selectedKokoroVoiceId = 'af_heart';
// --- Automation & Queuing ---
window.userMessageQueue = [];
window.isUserMessageQueueEnabled = true;
window.isAmbientQueueEnabled = false;
window.ambientDelay = 10;
window.ambientTimer = null;
window.isAIResponding = false;
window.isAmbientPreloadEnabled = false;
window.ambientPreloadBuffer = null;
window.ambientPreloadTTSBuffer = null;
window.isAmbientPreloadingTTS = false;
window.isAmbientPreloading = false;
window.isWaitingForAIResponse = false;
window.isPreloadingQueuedMessage = false;
window.preloadedQueuedResponse = null;
window.ambientPrompt = "(Continue the conversation naturally as Haru. Share a thought, a feeling, or ask me something relevant to our discussion to keep things moving. 1-2 sentences. Speak directly to me.)";
