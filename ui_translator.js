// Interface language translator with AI-powered dynamic translations
window.currentInterfaceLanguage = 'en-US';
window.translationCache = {}; // Cache for translated UI strings

async function translateInterfaceText(text, targetLang) {
  if (targetLang === 'en-US' || !text) return text;

  if (!window.OpenRouterAPI || !window.OpenRouterAPI.isConfigured()) {
    debugLog('UI translation requires OpenRouter API', 'warn');
    return text;
  }

  try {
    const completion = await window.OpenRouterAPI.createCompletion({
      messages: [
        { role: "system", content: `Translate the following text to ${languages.find(l => l.code === targetLang)?.englishName || targetLang}. Respond ONLY with the translated text, nothing else.` },
        { role: "user", content: text }
      ]
    });
    return completion.content.trim();
  } catch(e) {
    debugError('UI translation failed', e, { targetLang: targetLang, textLen: text?.length });
    return text;
  }
}

async function translateTutorialSteps(steps, targetLang) {
  if (targetLang === 'en-US' || !steps || steps.length === 0) return steps;

  if (!window.OpenRouterAPI || !window.OpenRouterAPI.isConfigured()) {
    debugLog('Tutorial translation requires OpenRouter API', 'warn');
    return steps;
  }

  try {
    const stepsText = steps.map(s => `TITLE: ${s.title}\nBODY: ${s.body}`).join('\n---\n');

    const completion = await window.OpenRouterAPI.createCompletion({
      messages: [
        { role: "system", content: `Translate the following tutorial steps to ${languages.find(l => l.code === targetLang)?.englishName || targetLang}. Keep the emoji and format structure exactly the same. Format your response as JSON array with objects containing "title" and "body" properties.` },
        { role: "user", content: stepsText }
      ],
      json: true
    });

    const translated = JSON.parse(completion.content);
    return Array.isArray(translated) ? translated : steps;
  } catch(e) {
    debugError('Tutorial translation failed', e, { targetLang: targetLang, stepsCount: steps?.length });
    return steps;
  }
}

// Get UI strings for a language - either predefined or AI-translated
async function getUIStringsForLanguage(langCode) {
  // If predefined strings exist, use them
  if (window.UI_STRINGS && window.UI_STRINGS[langCode]) {
    return window.UI_STRINGS[langCode];
  }

  // Check cache
  if (window.translationCache[langCode]) {
    return window.translationCache[langCode];
  }

  if (!window.OpenRouterAPI || !window.OpenRouterAPI.isConfigured()) {
    debugLog('UI strings translation requires OpenRouter API', 'warn');
    return window.UI_STRINGS['en-US'] || {};
  }

  // Get English strings as base
  const englishStrings = window.UI_STRINGS['en-US'];
  if (!englishStrings) {
    debugLog(`English UI strings not found`, 'error');
    return {};
  }

  try {
    // Translate all strings to target language
    debugLog(`Translating UI strings to ${langCode}...`, 'info');

    const stringsArray = Object.entries(englishStrings);
    const translatedStrings = {};

    // Batch translate strings for efficiency
    const stringPairs = stringsArray.map(([key, value]) => `${key}|${value}`).join('\n');

    const completion = await window.OpenRouterAPI.createCompletion({
      messages: [
        {
          role: "system",
          content: `Translate the following UI strings to ${languages.find(l => l.code === langCode)?.englishName || langCode}. Format: key|value on each line. Respond with the same format (key|translated_value), one per line. Preserve all keys exactly as they are. Do not translate keys, only values.`
        },
        { role: "user", content: stringPairs }
      ]
    });

    // Parse the response
    const lines = completion.content.trim().split('\n');
    lines.forEach(line => {
      const [key, ...valueParts] = line.split('|');
      if (key && valueParts.length > 0) {
        translatedStrings[key.trim()] = valueParts.join('|').trim();
      }
    });

    // Cache the translations
    window.translationCache[langCode] = translatedStrings;

    // Also persist to localStorage for faster future loads
    try {
      localStorage.setItem(`uiStrings_${langCode}`, JSON.stringify(translatedStrings));
    } catch(e) {
      debugError('Could not cache UI strings to localStorage', e, { key: `uiStrings_${langCode}` });
    }

    debugLog(`Successfully translated UI strings to ${langCode}`, 'info');
    return translatedStrings;
  } catch(e) {
    debugError(`Failed to translate UI strings to ${langCode}`, e, { langCode: langCode, stringCount: stringsArray?.length });
    return englishStrings; // Fallback to English
  }
}

// Load cached translations from localStorage
function loadCachedTranslations() {
  const langCode = window.currentInterfaceLanguage;
  if (langCode === 'en-US' || !langCode) return;

  try {
    const cached = localStorage.getItem(`uiStrings_${langCode}`);
    if (cached) {
      window.translationCache[langCode] = JSON.parse(cached);
      debugLog(`Loaded cached UI translations for ${langCode}`, 'info');
    }
  } catch(e) {
    debugError('Could not load cached translations', e, { langCode: langCode });
  }
}

async function applyInterfaceLanguage(langCode) {
  window.currentInterfaceLanguage = langCode;

  try {
    localStorage.setItem('interfaceLanguage', langCode);
  } catch(e) { debugLog(`Failed to persist interfaceLanguage: ${e.message}`, 'warn', true); }

  // Get UI strings (predefined or AI-translated)
  const uiStrings = await getUIStringsForLanguage(langCode);

  if (!uiStrings || Object.keys(uiStrings).length === 0) {
    debugLog(`No UI strings available for language: ${langCode}`, 'warn');
    return;
  }

  // 1. Headings
  document.querySelectorAll('[data-ui-key]').forEach(el => {
    const key = el.dataset.uiKey;
    if (uiStrings[key]) {
      // If it's a heading (H3), update text content
      if (el.tagName === 'H3') {
        el.textContent = uiStrings[key];
      }
      // If it's a button
      else if (el.tagName === 'BUTTON') {
        el.textContent = uiStrings[key];
      }
      // If it's a label
      else if (el.tagName === 'LABEL') {
        const checkbox = el.querySelector('input[type="checkbox"]');
        const select = el.querySelector('select');
        if (checkbox) {
          el.textContent = '';
          el.appendChild(checkbox);
          el.appendChild(document.createTextNode(' ' + uiStrings[key]));
        } else if (select) {
          // If the select is inside the label, clear the label's text nodes
          el.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
          });
          el.prepend(document.createTextNode(uiStrings[key] + ' '));
        } else {
          el.textContent = uiStrings[key];
        }
      }
    }
  });

  // 2. Value Displays & Descriptions
  document.querySelectorAll('[data-ui-desc]').forEach(el => {
    const descKey = el.dataset.uiDesc;

    // Handle specific descriptions
    if (uiStrings[descKey]) {
      el.textContent = uiStrings[descKey];
    }

    // Handle "Current:" dynamic displays
    const text = el.textContent.trim();
    if (text.includes('Current:') || text.includes('Max Characters:')) {
      const span = el.querySelector('span');
      if (span) {
        let prefixKey = '';
        if (descKey === 'memorySize') prefixKey = 'memorySizeCurrent';
        else if (descKey === 'chatboxOpacity') prefixKey = 'chatboxOpacityCurrent';
        else if (descKey === 'messageOpacity') prefixKey = 'messageOpacityCurrent';
        else if (descKey === 'bgOpacity') prefixKey = 'bgOpacityLabel'; // approximate
        else if (descKey === 'ttsChunkLimit') prefixKey = 'ttsChunkLimitCurrent';
        else if (descKey === 'ttsVolume') prefixKey = 'ttsVolumeCurrent';

        const prefix = uiStrings[prefixKey] || (text.includes('Current:') ? 'Current:' : 'Max Characters:');

        el.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.includes('Current:') || node.textContent.includes('Max Characters:')) {
              node.textContent = prefix + ' ';
            } else if (node.textContent.includes('messages')) {
              node.textContent = ' ' + (uiStrings.messages || 'messages');
            }
          }
        });
      }
    }
  });

  // 3. Placeholders
  const placeholderMap = {
    'corePersonaPrompt': 'corePersonaPlaceholder',
    'personaPrompt': 'personaPromptPlaceholder',
    'customModelName': 'modelNamePlaceholder',
    'customModelUrl': 'modelUrlPlaceholder',
    'customModelImage': 'modelImagePlaceholder',
    'bgPromptInput': 'bgPromptPlaceholder',
    'bgUrlInput': 'bgUrlPlaceholder',
    'messageInput': 'messageInputPlaceholder',
    'settingsSearch': 'searchSettingsPlaceholder'
  };

  Object.entries(placeholderMap).forEach(([elemId, strKey]) => {
    const elem = document.getElementById(elemId);
    if (elem && uiStrings[strKey]) elem.placeholder = uiStrings[strKey];
  });

  // 4. Translate actual persona prompt text values
  try {
    const coreArea = document.getElementById('corePersonaPrompt');
    if (coreArea && coreArea.value.trim()) {
      coreArea.value = await translateInterfaceText(coreArea.value, langCode);
      window.corePersonaPrompt = coreArea.value;
    }
    const personaArea = document.getElementById('personaPrompt');
    if (personaArea && personaArea.value.trim()) {
      personaArea.value = await translateInterfaceText(personaArea.value, langCode);
      window.userPersonaPrompt = personaArea.value;
    }
  } catch (e) {
    debugError('Failed to translate persona prompt values', e, { langCode: window.currentInterfaceLanguage });
  }

  // 5. Re-render tutorial ONLY if it's currently open
  const tutorialOverlay = document.getElementById('tutorialOverlay');
  if (tutorialOverlay && tutorialOverlay.classList.contains('visible') && window.rerenderTutorial && typeof window.rerenderTutorial === 'function') {
    window.rerenderTutorial();
  }

  debugLog(`Interface language changed and settings panel translated to: ${langCode}`, 'info');
}

window.applyInterfaceLanguage = applyInterfaceLanguage;
window.translateInterfaceText = translateInterfaceText;
window.translateTutorialSteps = translateTutorialSteps;
window.getUIStringsForLanguage = getUIStringsForLanguage;
window.loadCachedTranslations = loadCachedTranslations;

// Function to translate the tutorial's second half content
async function translateTutorialSecondHalf(targetLang) {
  const englishContent = `<h4>🤖🚀 LLM & OpenRouter Settings</h4>
<p>Configure your AI model in <b>Settings → LLM Provider</b>. You can use <b>OpenRouter</b> or <b>Groq</b> - both support free models. You'll need an API key from <a href="https://openrouter.ai/" target="_blank">openrouter.ai</a> or <a href="https://console.groq.com/" target="_blank">console.groq.com</a>. Both support <b>Streaming</b> ⚡ for real-time character-by-character responses.</p>

<h4>🧠🧵 Persona, Memory & Summarization</h4>
<p>Your AI isn't just a generic bot; you can define its <b>Core Identity</b> and <b>Custom Personality</b> in Persona Settings. Whether you want a helpful assistant or a specific character archetype, the AI will adapt its tone and behavior. To handle long conversations, the app uses a <b>Memory System</b>. As older messages are pushed out of immediate memory to save performance, the AI automatically generates a <b>Conversation Summary</b> 📝. This summary is fed back into the AI's context, ensuring it never truly "forgets" important events or your name.</p>

<h4>🎭✨ Live2D Animations & Expressions</h4>
<p>The Live2D models aren't just static images. They feature <b>Automatic Gaze</b> 👁️ (following your interactions), breathing animations, and physics-based hair/clothing movement. When chatting, the AI can trigger specific <b>Emotions</b> (Happy, Sad, Surprised, Thoughtful, Excited) and <b>Gestures</b> (like nodding or tilting its head) based on the sentiment of its reply. You can also add your own models by providing a URL to a <code>.model3.json</code> file.</p>

<h4>🔊🎤 TTS & Voice Interaction</h4>
<p>Text-to-Speech (TTS) is powered by TikTok's free TTS API, offering a variety of natural-sounding voices across many languages. You can select a unique voice for each language you use. For input, use the <b>Microphone</b> 🎤 icon to speak directly to your character. This uses your browser's native Speech-To-Text capabilities. Note: For the best experience, use a Chromium-based browser and ensure you've granted microphone permissions.</p>

<h4>🔌🔋 Context & Offline Fallback</h4>
<p>The AI can be made "aware" of your environment. By enabling <b>Time</b> and <b>Battery</b> context, the AI will know if it's late at night or if your device is running low on power, leading to more natural observations. If you lose your internet connection, the <b>Local Fallback Engine</b> 🔌 takes over, using smart heuristics to provide relevant (though less "intelligent") replies until the connection is restored.</p>

<h4>🐞🧰 Debug Panel & Troubleshooting</h4>
<p>If something isn't working as expected, the <b>Debug Panel</b> is your best friend. It logs everything from network requests to model loading errors. You can even enable <b>Show Chat Context</b> to see exactly what "thoughts" and instructions are being sent to the AI behind the scenes. If audio doesn't play, remember that most browsers require at least one manual click 🖱️ on the page before they allow automatic sound playback.</p>`;

  if (targetLang === 'en-US') {
    return englishContent;
  }

  if (!window.OpenRouterAPI || !window.OpenRouterAPI.isConfigured()) {
    debugLog('Tutorial translation requires OpenRouter API', 'warn');
    return englishContent;
  }

  try {
    const targetLanguageName = (window.languages?.find(l => l.code === targetLang)?.englishName || targetLang);
    const completion = await window.OpenRouterAPI.createCompletion({
      messages: [ 
        { 
          role: "system", 
          content: `Translate the following HTML tutorial content (keeping all HTML tags and emojis intact) to ${targetLanguageName}. Preserve the structure and all formatting. Respond ONLY with the translated HTML.` 
        },
        { role: "user", content: englishContent }
      ]
    });
    
    debugLog(`Tutorial second half translated to ${targetLanguageName}`, 'info');
    return completion.content;
  } catch(e) {
    debugError('Failed to translate tutorial second half', e, { targetLang: targetLang });
    return englishContent; // Fallback to English
  }
}

window.translateTutorialSecondHalf = translateTutorialSecondHalf;