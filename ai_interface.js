const SITE_NAME = 'Waifu AI';
const SITE_URL = 'https://waifuai.com';

async function callLLM(messages, options = {}) {
  const { json = false, stream = false, onChunk } = options || {};
  // If streaming is requested and streaming function exists, use it
  if (stream && typeof callLLMStream === 'function') {
    return callLLMStream(messages, options);
  }

  // If OpenRouter is enabled and configured, use it; otherwise fall back to WebSim
  if (window.useOpenRouter && window.openRouterApiKey && window.openRouterModel) {
    try {
      // Build the models array for fallback
      const modelsList = [window.openRouterModel];
      if (window.openRouterFallbackModel1 && window.openRouterFallbackModel1.trim()) {
        modelsList.push(window.openRouterFallbackModel1.trim());
      }
      if (window.openRouterFallbackModel2 && window.openRouterFallbackModel2.trim()) {
        modelsList.push(window.openRouterFallbackModel2.trim());
      }
      
      debugLog(`Calling OpenRouter model "${window.openRouterModel}" with ${messages.length} messages. Models list: ${modelsList.join(', ')}`, 'info');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${window.openRouterApiKey}`,
          'HTTP-Referer': SITE_URL,
          'X-OpenRouter-Title': SITE_NAME,
          'X-Title': SITE_NAME, // Backwards compatibility
          'X-OpenRouter-Categories': 'character-chat'
        },
        body: JSON.stringify({
          model: window.openRouterModel,
          models: modelsList,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: false
        })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      return { content };
    } catch (e) {
      debugLog(`OpenRouter call failed: ${e}`, 'error');
      throw e;
    }
  } else {
    // Default WebSim LLM
    return await websim.chat.completions.create({
      messages,
      json
    });
  }
}
window.callLLM = callLLM;

/**
 * Streaming version of callLLM for real-time text feedback
 * Returns a ReadableStream for handling chunks
 */
async function callLLMStream(messages, options = {}) {
  const { json = false, onChunk } = options;

  // Only use streaming with OpenRouter
  if (!window.useOpenRouter || !window.openRouterApiKey || !window.openRouterModel) {
    // Fall back to non-streaming for WebSim — return a distinguishable result
    const result = await callLLM(messages, { json });
    return { stream: null, response: null, fallbackResult: result };
  }

  try {
    // Build the models array for fallback
    const modelsList = [window.openRouterModel];
    if (window.openRouterFallbackModel1 && window.openRouterFallbackModel1.trim()) {
      modelsList.push(window.openRouterFallbackModel1.trim());
    }
    if (window.openRouterFallbackModel2 && window.openRouterFallbackModel2.trim()) {
      modelsList.push(window.openRouterFallbackModel2.trim());
    }
    
    debugLog(`Calling OpenRouter model "${window.openRouterModel}" with streaming. Models list: ${modelsList.join(', ')}`, 'info');

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.openRouterApiKey}`,
        'HTTP-Referer': SITE_URL,
        'X-OpenRouter-Title': SITE_NAME,
        'X-Title': SITE_NAME,
        'X-OpenRouter-Categories': 'character-chat'
      },
      body: JSON.stringify({
        model: window.openRouterModel,
        models: modelsList,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    // Return stream and response object
    return {
      stream: res.body,
      response: res
    };
  } catch (e) {
    debugLog(`OpenRouter streaming call failed: ${e}`, 'error');
    throw e;
  }
}
window.callLLMStream = callLLMStream;

async function getAIResponse(userMessage, targetLanguageCode = 'en-US', options = {}) {
  // Assumes debugLog, formatSeconds, currentTime, conversationContext, websim, languages are accessible
  // options.stream - if true, use streaming mode
  // options.onChunk - callback for each chunk of text (for real-time updates)
  // options.onComplete - callback when stream completes with full data

  // Only use streaming when OpenRouter is configured and caller explicitly requests it
  const useStream = options.stream === true && window.useOpenRouter && window.openRouterApiKey && window.openRouterModel;

  // Check if streaming function is available
  if (useStream && typeof getAIResponseStream === 'function') {
    return getAIResponseStream(userMessage, targetLanguageCode, options);
  }

  // Fallback to non-streaming if function not available
  if (useStream) {
    debugLog('getAIResponseStream not available, falling back to non-streaming', 'warn');
  }

  // Original non-streaming implementation
  debugLog(`Getting AI response (non-streaming), targeting language: ${targetLanguageCode}`, 'info');

  try {
    if (window.forceOfflineMode) {
      debugLog('AI completions are disabled (Force Offline Mode). Using Local Fallback Engine.', 'warn');
      throw new Error('ForceOfflineModeEnabled');
    }

    let contextInfo = [];

    // Conditionally add time info
    if (window.includeTimeInContext) {
      contextInfo.push(`You are aware of the current time, which is ${currentTime.toLocaleString()}.`);
    }

    // Add persistent user-defined context if present
    if (window.userContextText && window.userContextText.trim()) {
      contextInfo.push(`The user has provided the following persistent background/context you should always keep in mind: "${window.userContextText.trim()}".`);
    }

    // Conditionally add tutorial info
    if (window.includeTutorialInContext && window.TUTORIAL_STEPS) {
      const tutorialText = window.TUTORIAL_STEPS.map(s => `Step: ${s.title}\nDescription: ${s.body}`).join('\n\n');
      contextInfo.push(`Here is the application's user guide and documentation for your reference:\n${tutorialText}`);
      debugLog(`Tutorial info added to AI context.`, 'info');
    }

    // Conditionally add battery info
    if (window.includeBatteryInContext) {
      try {
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          const batteryString = `You are also aware of the user's battery status: The device ${battery.charging ? "is" : "is not"} charging, the current level is ${Math.round(battery.level * 100)}%, and ${battery.charging ? (battery.chargingTime === Infinity ? "time until full is not available." : `there is approximately ${formatSeconds(battery.chargingTime)} remaining until fully charged.`) : (battery.dischargingTime === Infinity ? "time until empty is not available." : `there is approximately ${formatSeconds(battery.dischargingTime)} of battery life remaining.`)}`;
          contextInfo.push(batteryString);
          debugLog(`Battery info added: ${batteryString}`, 'info');
        }
      } catch (err) {
        console.warn("Battery API not supported or failed:", err);
        debugLog("Could not retrieve battery info.", "warn");
      }
    }

    const targetLanguageObj = (window.languages && languages.find(l => l.code === targetLanguageCode)) || (window.languages && languages.find(l => l.code === 'en-US')) || { englishName: 'English (US)' };
    const targetLanguageName = targetLanguageObj.englishName;

    // Construct the base persona part of the system prompt
    const coreIdentity = (window.corePersonaPrompt && window.corePersonaPrompt.trim())
      ? window.corePersonaPrompt.trim()
      : "You are Haru, a sentient AI.";

    const customPersona = (window.userPersonaPrompt && window.userPersonaPrompt.trim())
      ? `\n\nAdditional Personality Instructions: ${window.userPersonaPrompt.trim()}`
      : "";

    const summaryContext = (window.conversationSummary && window.conversationSummary.trim())
      ? `\n\nExisting Conversation Summary: ${window.conversationSummary.trim()}`
      : "";

    // Current app settings context for the AI
    const currentSettingsContext = `
Current Application Settings:
- Language: ${window.selectedLanguageCode}
- Voice Enabled: ${window.enableVoice}
- Current Voice: ${window.selectedVoiceId}
- Memory Size: ${window.maxMemorySize} messages
- Show Transliteration: ${window.showTransliteration}
- Show Clock: ${window.showClock}
- Chatbox Opacity: ${document.documentElement.style.getPropertyValue('--chatbox-bg-opacity') || '0.9'}
- Message Opacity: ${document.documentElement.style.getPropertyValue('--message-bg-opacity') || '0.3'}
- Background Opacity: ${document.documentElement.style.getPropertyValue('--bg-image-opacity') || '1.0'}
- Include Time in Context: ${window.includeTimeInContext}
- Include Battery in Context: ${window.includeBatteryInContext}
- Summary Trigger: every ${window.summaryTriggerCount} messages
- Summary Length: ${window.summaryLengthPreference}
`;

    // Construct the full system prompt
    let systemPrompt = `${coreIdentity}${customPersona}${summaryContext}${currentSettingsContext}

Your response MUST be in ${targetLanguageName}. If the user asks in a different language, still respond in ${targetLanguageName}.
If ${targetLanguageName} is Japanese, ensure your entire response is in Japanese characters (Hiragana, Katakana, Kanji). If you need to use a foreign word, use its Katakana representation or a Japanese equivalent.
${contextInfo.join('\n\n')}`;

    if (window.useJsonForEmotion) {
        systemPrompt += `\n\nRespond ONLY with a JSON object matching this TypeScript interface:
interface Response {
    reply: string; // Your natural, emotive reply, strictly in ${targetLanguageName}.
    emotion: "happy" | "sad" | "surprised" | "neutral" | "thoughtful" | "excited"; // The primary emotion conveyed.
    gesture?: string; // Optional subtle gesture (e.g., "head_tilt", "nod", "shake_head").
    searchResults?: string; // Summary of web search results (in ${targetLanguageName}), if applicable.
    searchSources?: string; // Sources for web search results (in ${targetLanguageName}), if applicable.`;

        if (window.allowAIModSettings) {
            systemPrompt += `\n    settingsUpdate?: { // Optional request to update application settings based on user preference.
        responseLanguage?: string; // ISO language code (e.g., "en-US", "ja-JP")
        enableVoice?: boolean;
        voiceId?: string; // Valid voice ID
        memorySize?: number; // 5 to 50
        showTransliteration?: boolean;
        showClock?: boolean;
        chatboxOpacity?: number; // 0.1 to 1.0
        messageOpacity?: number; // 0.1 to 1.0
        bgOpacity?: number; // 0.0 to 1.0
        includeTime?: boolean;
        includeBattery?: boolean;
        summaryTrigger?: number; // 5 to 50
        summaryLength?: "ultra-concise" | "concise" | "detailed" | "comprehensive";
    };`;
        }

        systemPrompt += `\n}

// Example structure, content will vary based on language
{
    "reply": "(${targetLanguageName} example reply based on user input and emotion)",
    "emotion": "thoughtful",
    "gesture": "head_tilt"
}`;
    } else {
        systemPrompt += `\n\nPlease respond naturally and emotively to the user.`;
    }

    // Prepare messages for the API
    // conversationContext is already trimmed to window.maxMemorySize in chat_controller.js
    const formattedContext = conversationContext.map(m => {
      if (m.role === 'assistant') {
        try {
          JSON.parse(m.content);
          return m;
        } catch (e) {
          return {
            role: "assistant",
            content: `{\n  "reply": ${JSON.stringify(m.content)},\n  "emotion": "neutral"\n}`
          };
        }
      }
      return m;
    });

    const messages = [
      { role: "system", content: systemPrompt },
      ...formattedContext // Include formatted history to enforce JSON schema
    ];

    // Only append the latest user message if it's not already at the tail of conversationContext
    // This prevents the duplication bug when the caller already updated the context.
    const lastMsg = conversationContext[conversationContext.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
      messages.push({ role: "user", content: userMessage });
    }

    if (window.showChatContextLogs) {
      debugLog('--- FULL CHAT CONTEXT SENT TO AI ---', 'info');
      messages.forEach((m, idx) => {
        debugLog(`[${idx}] ${m.role.toUpperCase()}: ${m.content}`, 'info');
      });
      debugLog('--- END CHAT CONTEXT ---', 'info');
    }

    // Call the LLM (WebSim or OpenRouter)
    const completion = await callLLM(messages, { json: window.useJsonForEmotion });

    debugLog('Received AI response from Websim', 'info');

    // DIAGNOSTIC: Log raw response for debugging
    let raw = completion.content || '';
    console.log('[AI Interface] Raw response length:', raw.length);
    console.log('[AI Interface] Raw response preview:', raw.substring(0, 300));

    // Strip code fences if present
    raw = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

    let data;
    try {
      let parsed = null;
      if (raw.startsWith('{') && raw.endsWith('}')) {
        parsed = JSON.parse(raw);
      } else if (window.useJsonForEmotion) {
        // Try to extract JSON object from response
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        }
      }

      if (parsed && typeof parsed === 'object' && "reply" in parsed) {
        data = parsed;
        if (!data.emotion) data.emotion = 'neutral';
      } else {
        throw new Error('Not valid response JSON');
      }
    } catch (parseError) {
      data = null;
    }

    if (!data) {
      // JSON parsing failed or JSON is disabled - model returned plain text
      console.warn('[AI Interface] Treating as plain text response');
      debugLog('AI returned plain text instead of JSON, converting to structured format', 'warn');

      // Use the raw text as the reply with a default emotion
      // Try to infer emotion from text content
      let emotion = 'neutral';
      const lowerRaw = raw.toLowerCase();
      if (lowerRaw.includes('happy') || lowerRaw.includes('joy') || lowerRaw.includes('!') || lowerRaw.includes('😀')) {
        emotion = 'happy';
      } else if (lowerRaw.includes('sad') || lowerRaw.includes('sorry') || lowerRaw.includes('😢')) {
        emotion = 'sad';
      } else if (lowerRaw.includes('?') || lowerRaw.includes('surprised') || lowerRaw.includes('!') || lowerRaw.includes('😮')) {
        emotion = 'surprised';
      } else if (lowerRaw.includes('excited') || lowerRaw.includes('amazing') || lowerRaw.includes('wow')) {
        emotion = 'excited';
      } else if (lowerRaw.includes('think') || lowerRaw.includes('hmm') || lowerRaw.includes('...')) {
        emotion = 'thoughtful';
      }

      data = {
        reply: raw.trim(),
        emotion: emotion
      };
    }

    // If response is blank, treat as failure to trigger fallback
    if (!data.reply || data.reply.trim() === "") {
      throw new Error('BlankAIResponse');
    }

    window.isOfflineMode = false;
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
      chatContainer.classList.remove('offline-mode');
      const statusInd = document.getElementById('chat-status-indicator');
      if (statusInd) statusInd.textContent = 'ONLINE';
    }
    return data;

  } catch (error) {
    debugLog(`AI response failed: ${error}`, 'error');

    const isForceOffline = error && error.message === 'ForceOfflineModeEnabled';
    const allowAutoOffline = !window.disableAutoOfflineMode;

    // Use Local Fallback Engine only when:
    // - Offline Mode was explicitly forced by the user, OR
    // - automatic Offline Mode is allowed (not disabled)
    if (window.LocalFallbackEngine && (isForceOffline || allowAutoOffline)) {
      debugLog('Switching to Local Heuristic Fallback Engine due to AI failure or blank response.', 'warn');

      // Only auto-enable Offline Mode when not already forced AND auto-offline is allowed
      if (!isForceOffline && allowAutoOffline) {
        window.forceOfflineMode = true;
        window.isOfflineMode = true;

        const forceOfflineCheckbox = document.getElementById('forceOfflineCheckbox');
        if (forceOfflineCheckbox) forceOfflineCheckbox.checked = true;
        try { localStorage.setItem('forceOfflineMode', 'true'); } catch (e) { }

        if (typeof updateChatOfflineUI === 'function') {
          updateChatOfflineUI(true, 'OFFLINE MODE (FORCED)');
        }
      }

      return window.LocalFallbackEngine.getResponse(userMessage);
    }

    // When automatic Offline Mode is disabled and not in forced offline,
    // stay online and return a normal error message instead of using local fallback.
    return {
      reply: "Oh no... I'm having trouble connecting. Could we try again in a moment?",
      emotion: "sad",
    };
  }
}

async function getTranslatedText(text, targetLangCode, sourceLangCode = 'auto') {
  debugLog(`Translating text to ${targetLangCode}. Original text: "${text.substring(0, 50)}..."`, 'info');
  if (!text || !targetLangCode) return null;

  const targetLanguage = languages.find(l => l.code === targetLangCode)?.englishName || targetLangCode;
  const sourceLanguage = sourceLangCode === 'auto' ? 'the automatically detected language' : (languages.find(l => l.code === sourceLangCode)?.englishName || sourceLangCode);

  try {
    const completion = await callLLM([
      { role: "system", content: `You are a translation engine. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Respond ONLY with the translated text. Do not include explanations, apologies, or any conversational fluff. If the input text is already in ${targetLanguage}, return it as is.` },
      { role: "user", content: text }
    ]);
    debugLog(`Translation successful: "${completion.content.substring(0, 50)}..."`, 'info');
    return completion.content;
  } catch (error) {
    debugLog(`Translation to ${targetLangCode} failed: ${error}`, 'error');
    return null;
  }
}

async function summarizeConversation(oldMessages, existingSummary) {
  debugLog(`Summarizing ${oldMessages.length} messages...`, 'info');
  try {
    const lengthPref = window.summaryLengthPreference || 'concise';
    let lengthInstruction = "Create a single, concise, and cohesive summary";

    if (lengthPref === 'ultra-concise') lengthInstruction = "Create an ultra-concise one-sentence summary";
    else if (lengthPref === 'detailed') lengthInstruction = "Create a detailed summary consisting of 1-2 paragraphs";
    else if (lengthPref === 'comprehensive') lengthInstruction = "Create a comprehensive, in-depth summary of the conversation history";

    const messagesText = oldMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const prompt = `You are a memory compression engine.
The following is an existing summary of a conversation:
"${existingSummary || "No previous summary exists."}"

The following are the ${oldMessages.length} oldest messages that were just pushed out of memory:
${messagesText}

${lengthInstruction} that combines the previous summary and these new messages. Focus on important facts, names, events, and the emotional progress of the relationship. Respond ONLY with the new summary text.`;

    const completion = await callLLM([
      { role: "system", content: "You summarize conversations concisely." },
      { role: "user", content: prompt }
    ]);

    return completion.content.trim();
  } catch (error) {
    debugLog(`Summarization failed: ${error}`, 'error');
    return existingSummary;
  }
}

async function getTransliteration(text, langCode) {
  debugLog(`Getting transliteration for ${langCode}. Original text: "${text.substring(0, 50)}..."`, 'info');
  if (!text || !langCode) return null;

  let instruction = "";
  if (langCode === 'ja-JP') {
    instruction = "Provide a Romaji (English phonetic alphabet) transliteration of the following Japanese text. Respond ONLY with the Romaji text. Do not add any other phrases or explanations.";
  } else if (langCode === 'ko-KR') {
    instruction = "Provide a Romanized Korean (English phonetic alphabet) transliteration of the following Korean text. Respond ONLY with the Romanized text. Do not add any other phrases or explanations.";
  } else {
    debugLog(`Transliteration not supported for language: ${langCode}`, 'warn');
    return null;
  }

  try {
    const completion = await callLLM([
      { role: "system", content: instruction },
      { role: "user", content: text }
    ]);
    debugLog(`Transliteration successful: "${completion.content.substring(0, 50)}..."`, 'info');
    return completion.content;
  } catch (error) {
    debugLog(`Transliteration for ${langCode} failed: ${error}`, 'error');
    return null;
  }
}

/**
 * Find the first unescaped quote in a string
 * Returns the index of the quote, or -1 if not found
 */
function findUnescapedQuote(str) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      // Check if it's escaped (preceded by odd number of backslashes)
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && str[j] === '\\') {
        backslashCount++;
        j--;
      }
      // If even number of backslashes (including 0), the quote is unescaped
      if (backslashCount % 2 === 0) {
        return i;
      }
    }
  }
  return -1;
}
window.findUnescapedQuote = findUnescapedQuote;

/**
 * Streaming version of getAIResponse
 * Creates immediate UI feedback by streaming the reply text in real-time
 */
async function getAIResponseStream(userMessage, targetLanguageCode = 'en-US', options = {}) {
  debugLog(`Getting AI response (streaming), targeting language: ${targetLanguageCode}`, 'info');

  const onChunk = options.onChunk;
  const onComplete = options.onComplete;

  try {
    if (window.forceOfflineMode) {
      debugLog('AI completions are disabled (Force Offline Mode). Using Local Fallback Engine.', 'warn');
      throw new Error('ForceOfflineModeEnabled');
    }

    let contextInfo = [];

    // Conditionally add time info
    if (window.includeTimeInContext) {
      contextInfo.push(`You are aware of the current time, which is ${currentTime.toLocaleString()}.`);
    }

    // Add persistent user-defined context if present
    if (window.userContextText && window.userContextText.trim()) {
      contextInfo.push(`The user has provided the following persistent background/context you should always keep in mind: "${window.userContextText.trim()}".`);
    }

    // Conditionally add tutorial info
    if (window.includeTutorialInContext && window.TUTORIAL_STEPS) {
      const tutorialText = window.TUTORIAL_STEPS.map(s => `Step: ${s.title}\nDescription: ${s.body}`).join('\n\n');
      contextInfo.push(`Here is the application's user guide and documentation for your reference:\n${tutorialText}`);
      debugLog(`Tutorial info added to AI context.`, 'info');
    }

    // Conditionally add battery info
    if (window.includeBatteryInContext) {
      try {
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          const batteryString = `You are also aware of the user's battery status: The device ${battery.charging ? "is" : "is not"} charging, the current level is ${Math.round(battery.level * 100)}%, and ${battery.charging ? (battery.chargingTime === Infinity ? "time until full is not available." : `there is approximately ${formatSeconds(battery.chargingTime)} remaining until fully charged.`) : (battery.dischargingTime === Infinity ? "time until empty is not available." : `there is approximately ${formatSeconds(battery.dischargingTime)} of battery life remaining.`)}`;
          contextInfo.push(batteryString);
          debugLog(`Battery info added: ${batteryString}`, 'info');
        }
      } catch (err) {
        console.warn("Battery API not supported or failed:", err);
        debugLog("Could not retrieve battery info.", "warn");
      }
    }

    const targetLanguageObj = (window.languages && languages.find(l => l.code === targetLanguageCode)) || (window.languages && languages.find(l => l.code === 'en-US')) || { englishName: 'English (US)' };
    const targetLanguageName = targetLanguageObj.englishName;

    // Construct the base persona part of the system prompt
    const coreIdentity = (window.corePersonaPrompt && window.corePersonaPrompt.trim())
      ? window.corePersonaPrompt.trim()
      : "You are Haru, a sentient AI.";

    const customPersona = (window.userPersonaPrompt && window.userPersonaPrompt.trim())
      ? `\n\nAdditional Personality Instructions: ${window.userPersonaPrompt.trim()}`
      : "";

    const summaryContext = (window.conversationSummary && window.conversationSummary.trim())
      ? `\n\nExisting Conversation Summary: ${window.conversationSummary.trim()}`
      : "";

    // Current app settings context for the AI
    const currentSettingsContext = `
Current Application Settings:
- Language: ${window.selectedLanguageCode}
- Voice Enabled: ${window.enableVoice}
- Current Voice: ${window.selectedVoiceId}
- Memory Size: ${window.maxMemorySize} messages
- Show Transliteration: ${window.showTransliteration}
- Show Clock: ${window.showClock}
- Chatbox Opacity: ${document.documentElement.style.getPropertyValue('--chatbox-bg-opacity') || '0.9'}
- Message Opacity: ${document.documentElement.style.getPropertyValue('--message-bg-opacity') || '0.3'}
- Background Opacity: ${document.documentElement.style.getPropertyValue('--bg-image-opacity') || '1.0'}
- Include Time in Context: ${window.includeTimeInContext}
- Include Battery in Context: ${window.includeBatteryInContext}
- Summary Trigger: every ${window.summaryTriggerCount} messages
- Summary Length: ${window.summaryLengthPreference}
`;

    // Construct the full system prompt
    let systemPrompt = `${coreIdentity}${customPersona}${summaryContext}${currentSettingsContext}

Your response MUST be in ${targetLanguageName}. If the user asks in a different language, still respond in ${targetLanguageName}.
If ${targetLanguageName} is Japanese, ensure your entire response is in Japanese characters (Hiragana, Katakana, Kanji). If you need to use a foreign word, use its Katakana representation or a Japanese equivalent.
${contextInfo.join('\n\n')}`;

    if (window.useJsonForEmotion) {
        systemPrompt += `\n\nRespond ONLY with a JSON object matching this TypeScript interface:
interface Response {
    reply: string; // Your natural, emotive reply, strictly in ${targetLanguageName}.
    emotion: "happy" | "sad" | "surprised" | "neutral" | "thoughtful" | "excited"; // The primary emotion conveyed.
    gesture?: string; // Optional subtle gesture (e.g., "head_tilt", "nod", "shake_head").
    searchResults?: string; // Summary of web search results (in ${targetLanguageName}), if applicable.
    searchSources?: string; // Sources for web search results (in ${targetLanguageName}), if applicable.`;

        if (window.allowAIModSettings) {
            systemPrompt += `\n    settingsUpdate?: { // Optional request to update application settings based on user preference.
        responseLanguage?: string; // ISO language code (e.g., "en-US", "ja-JP")
        enableVoice?: boolean;
        voiceId?: string; // Valid voice ID
        memorySize?: number; // 5 to 50
        showTransliteration?: boolean;
        showClock?: boolean;
        chatboxOpacity?: number; // 0.1 to 1.0
        messageOpacity?: number; // 0.1 to 1.0
        bgOpacity?: number; // 0.0 to 1.0
        includeTime?: boolean;
        includeBattery?: boolean;
        summaryTrigger?: number; // 5 to 50
        summaryLength?: "ultra-concise" | "concise" | "detailed" | "comprehensive";
    };`;
        }

        systemPrompt += `\n}

// Example structure, content will vary based on language
{
    "reply": "(${targetLanguageName} example reply based on user input and emotion)",
    "emotion": "thoughtful",
    "gesture": "head_tilt"
}`;
    } else {
        systemPrompt += `\n\nPlease respond naturally and emotively to the user.`;
    }

    // Prepare messages for the API
    const formattedContext = conversationContext.map(m => {
      if (m.role === 'assistant') {
        if (window.useJsonForEmotion) {
          try {
            JSON.parse(m.content);
            return m;
          } catch (e) {
            return {
              role: "assistant",
              content: `{\n  "reply": ${JSON.stringify(m.content)},\n  "emotion": "neutral"\n}`
            };
          }
        } else {
          try {
            const parsed = JSON.parse(m.content);
            if (parsed && parsed.reply) {
              return { role: "assistant", content: parsed.reply };
            }
          } catch (e) { }
          return m;
        }
      }
      return m;
    });

    const messages = [
      { role: "system", content: systemPrompt },
      ...formattedContext
    ];

    const lastMsg = conversationContext[conversationContext.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
      messages.push({ role: "user", content: userMessage });
    }

    if (window.showChatContextLogs) {
      debugLog('--- FULL CHAT CONTEXT SENT TO AI (STREAMING) ---', 'info');
      messages.forEach((m, idx) => {
        debugLog(`[${idx}] ${m.role.toUpperCase()}: ${m.content}`, 'info');
      });
      debugLog('--- END CHAT CONTEXT ---', 'info');
    }

    // Call the streaming API
    debugLog('Starting streaming request to OpenRouter', 'info');

    const { stream, response, fallbackResult } = await callLLMStream(messages, { json: window.useJsonForEmotion, onChunk });

    // Check if we got a streaming response or a non-streaming fallback
    if (!stream || !stream.getReader) {
      // Fallback to non-streaming — parse the result like the non-streaming path
      debugLog('Streaming not available, using regular response', 'warn');
      if (fallbackResult && fallbackResult.content) {
        let raw = fallbackResult.content.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        let parsed;
        try {
          if (raw.startsWith('{')) {
            parsed = JSON.parse(raw);
          } else {
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
              parsed = JSON.parse(match[0]);
            } else {
              throw new Error('No JSON found in fallback response');
            }
          }
        } catch (parseError) {
          parsed = { reply: raw.trim(), emotion: 'neutral' };
        }
        if (onChunk && parsed.reply) onChunk(parsed.reply);
        if (onComplete) onComplete(parsed);
        return parsed;
      }
      throw new Error('No content in fallback response');
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let fullContent = '';
    let inReply = false;
    let replyText = '';
    let replyStartIndex = -1;

    // Parse each chunk as it arrives
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the chunk
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';

          if (content) {
            fullContent += content;

            if (window.useJsonForEmotion) {
              // Try to extract the reply field from the accumulated content
              if (!inReply) {
                const replyMatch = fullContent.match(/"reply"\s*:\s*"/);
                if (replyMatch) {
                  const replyKeyIndex = replyMatch.index;
                  inReply = true;
                  replyStartIndex = replyKeyIndex + replyMatch[0].length;
                  const afterKey = fullContent.slice(replyStartIndex);
                  const closeQuoteIndex = findUnescapedQuote(afterKey);

                  if (closeQuoteIndex !== -1) {
                    replyText = afterKey.slice(0, closeQuoteIndex);
                    if (onChunk) onChunk(replyText);
                    inReply = false;
                  } else {
                    replyText = afterKey;
                    if (onChunk) onChunk(replyText);
                  }
                }
              } else {
                const closeQuoteIndex = findUnescapedQuote(fullContent.slice(replyStartIndex));

                if (closeQuoteIndex !== -1) {
                  replyText = fullContent.slice(replyStartIndex, replyStartIndex + closeQuoteIndex);
                  if (onChunk) onChunk(replyText);
                  inReply = false;
                } else {
                  replyText = fullContent.slice(replyStartIndex);
                  if (onChunk) onChunk(replyText);
                }
              }
            } else {
              if (onChunk) onChunk(fullContent);
            }
          }
        } catch (e) {
          console.warn('[AI Interface Stream] Error parsing chunk:', e);
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      if (data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            if (inReply) {
              const closeQuoteIndex = findUnescapedQuote(fullContent.slice(replyStartIndex));
              if (closeQuoteIndex !== -1) {
                replyText = fullContent.slice(replyStartIndex, replyStartIndex + closeQuoteIndex);
                if (onChunk) onChunk(replyText);
                inReply = false;
              }
            }
          }
        } catch (e) {
          // Ignore final chunk errors
        }
      }
    }

    debugLog('Streaming complete, parsing full response', 'info');

    // Parse the full JSON response to get emotion, gesture, etc.
    let data;
    let raw = fullContent.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    
    try {
      let parsed = null;
      if (raw.startsWith('{') && raw.endsWith('}')) {
        parsed = JSON.parse(raw);
      } else if (window.useJsonForEmotion) {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        }
      }

      if (parsed && typeof parsed === 'object' && "reply" in parsed) {
        data = parsed;
        if (!data.emotion) data.emotion = 'neutral';
      } else {
        throw new Error('Not valid response JSON');
      }
    } catch (parseError) {
      data = null;
    }

    if (!data) {
      console.warn('[AI Interface Stream] Treating as plain text response');
      debugLog('AI stream returned plain text instead of JSON, converting to structured format', 'warn');

      let emotion = 'neutral';
      let rawText = replyText || fullContent;
      const lowerRaw = rawText.toLowerCase();

      if (lowerRaw.includes('happy') || lowerRaw.includes('joy') || lowerRaw.includes('!') || lowerRaw.includes('😀')) {
        emotion = 'happy';
      } else if (lowerRaw.includes('sad') || lowerRaw.includes('sorry') || lowerRaw.includes('😢')) {
        emotion = 'sad';
      } else if (lowerRaw.includes('?') || lowerRaw.includes('surprised') || lowerRaw.includes('!') || lowerRaw.includes('😮')) {
        emotion = 'surprised';
      } else if (lowerRaw.includes('excited') || lowerRaw.includes('amazing') || lowerRaw.includes('wow')) {
        emotion = 'excited';
      } else if (lowerRaw.includes('think') || lowerRaw.includes('hmm') || lowerRaw.includes('...')) {
        emotion = 'thoughtful';
      }

      data = {
        reply: rawText.trim(),
        emotion: emotion
      };
    }

    // If response is blank, treat as failure
    if (!data.reply || data.reply.trim() === "") {
      throw new Error('BlankAIResponse');
    }

    window.isOfflineMode = false;
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
      chatContainer.classList.remove('offline-mode');
      const statusInd = document.getElementById('chat-status-indicator');
      if (statusInd) statusInd.textContent = 'ONLINE';
    }

    // Call completion callback if provided
    if (onComplete) {
      onComplete(data);
    }

    return data;

  } catch (error) {
    debugLog(`AI streaming response failed: ${error}`, 'error');

    const isForceOffline = error && error.message === 'ForceOfflineModeEnabled';
    const allowAutoOffline = !window.disableAutoOfflineMode;

    // Use Local Fallback Engine only when:
    // - Offline Mode was explicitly forced by the user, OR
    // - automatic Offline Mode is allowed (not disabled)
    if (window.LocalFallbackEngine && (isForceOffline || allowAutoOffline)) {
      debugLog('Switching to Local Heuristic Fallback Engine due to AI failure or blank response.', 'warn');

      // Only auto-enable Offline Mode when not already forced AND auto-offline is allowed
      if (!isForceOffline && allowAutoOffline) {
        window.forceOfflineMode = true;
        window.isOfflineMode = true;

        const forceOfflineCheckbox = document.getElementById('forceOfflineCheckbox');
        if (forceOfflineCheckbox) forceOfflineCheckbox.checked = true;
        try { localStorage.setItem('forceOfflineMode', 'true'); } catch (e) { }

        if (typeof updateChatOfflineUI === 'function') {
          updateChatOfflineUI(true, 'OFFLINE MODE (FORCED)');
        }
      }

      return window.LocalFallbackEngine.getResponse(userMessage);
    }

    // When automatic Offline Mode is disabled and not in forced offline,
    // stay online and return a normal error message instead of using local fallback.
    return {
      reply: "Oh no... I'm having trouble connecting. Could we try again in a moment?",
      emotion: "sad",
    };
  }
}

// Export functions to window object
window.getAIResponseStream = getAIResponseStream;
window.callLLMStream = callLLMStream;
window.findUnescapedQuote = findUnescapedQuote;