async function getAIResponse(userMessage, targetLanguageCode = 'en-US', options = {}) {
  const useStream = options.stream !== false;

  if (useStream && typeof getAIResponseStream === 'function') {
    return getAIResponseStream(userMessage, targetLanguageCode, options);
  }

  if (useStream) {
    debugLog('getAIResponseStream not available, falling back to non-streaming', 'warn');
  }

  debugLog(`Getting AI response (non-streaming), targeting language: ${targetLanguageCode}`, 'info');

  try {
    if (window.forceOfflineMode) {
      debugLog('AI completions are disabled (Force Offline Mode). Using Local Fallback Engine.', 'warn');
      throw new Error('ForceOfflineModeEnabled');
    }

    const isOpenRouterConfigured = window.OpenRouterAPI && window.OpenRouterAPI.isConfigured();
    const isGroqConfigured = window.useGroq && window.groqApiKey && window.groqModel;
    const isOpenAICompatibleConfigured = window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured();

    debugLog(`LLM Decision (non-streaming): isOpenRouterConfigured=${isOpenRouterConfigured}, isGroqConfigured=${isGroqConfigured}, isOpenAICompatibleConfigured=${isOpenAICompatibleConfigured}`, 'info');

    if (!isOpenRouterConfigured && !isGroqConfigured && !isOpenAICompatibleConfigured) {
      debugLog('No LLM provider configured. OpenRouter, Groq, and OpenAI Compatible not configured. Using Local Fallback Engine.', 'warn');
      throw new Error('LLMNotConfigured');
    }

    let contextInfo = [];

    if (window.includeTimeInContext) {
      contextInfo.push(`You are aware of the current time, which is ${currentTime.toLocaleString()}.`);
    }

    if (window.userContextText && window.userContextText.trim()) {
      contextInfo.push(`The user has provided the following persistent background/context you should always keep in mind: "${window.userContextText.trim()}".`);
    }

    if (window.includeTutorialInContext && window.TUTORIAL_STEPS) {
      const tutorialText = window.TUTORIAL_STEPS.map(s => `Step: ${s.title}\nDescription: ${s.body}`).join('\n\n');
      contextInfo.push(`Here is the application's user guide and documentation for your reference:\n${tutorialText}`);
      debugLog(`Tutorial info added to AI context.`, 'info');
    }

    if (window.includeBatteryInContext) {
      try {
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          const batteryString = `You are also aware of the user's battery status: The device ${battery.charging ? "is" : "is not"} charging, the current level is ${Math.round(battery.level * 100)}%, and ${battery.charging ? (battery.chargingTime === Infinity ? "time until full is not available." : `there is approximately ${formatSeconds(battery.chargingTime)} remaining until fully charged.`) : (battery.dischargingTime === Infinity ? "time until empty is not available." : `there is approximately ${formatSeconds(battery.dischargingTime)} of battery life remaining.`)}`;
          contextInfo.push(batteryString);
          debugLog(`Battery info added: ${batteryString}`, 'info');
        }
      } catch (err) {
        debugError('[AI] Battery API failed (non-streaming)', err);
      }
    }

    const targetLanguageObj = (window.languages && languages.find(l => l.code === targetLanguageCode)) || (window.languages && languages.find(l => l.code === 'en-US')) || { englishName: 'English (US)' };
    const targetLanguageName = targetLanguageObj.englishName;

    const coreIdentity = (window.corePersonaPrompt && window.corePersonaPrompt.trim())
      ? window.corePersonaPrompt.trim()
      : "You are Haru, a sentient AI.";

    const customPersona = (window.userPersonaPrompt && window.userPersonaPrompt.trim())
      ? `\n\nAdditional Personality Instructions: ${window.userPersonaPrompt.trim()}`
      : "";

    const summaryContext = (window.conversationSummary && window.conversationSummary.trim())
      ? `\n\nExisting Conversation Summary: ${window.conversationSummary.trim()}`
      : "";

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

    const systemPrompt = `${coreIdentity}${customPersona}${summaryContext}${currentSettingsContext}

Your response MUST be in ${targetLanguageName}. If the user asks in a different language, still respond in ${targetLanguageName}.
If ${targetLanguageName} is Japanese, ensure your entire response is in Japanese characters (Hiragana, Katakana, Kanji). If you need to use a foreign word, use its Katakana representation or a Japanese equivalent.
${contextInfo.join('\n\n')}

Respond ONLY with a JSON object matching this TypeScript interface:
interface Response {
    reply: string;
    emotion: "happy" | "sad" | "surprised" | "neutral" | "thoughtful" | "excited";
    gesture?: string;
    settingsUpdate?: {
        responseLanguage?: string;
        enableVoice?: boolean;
        voiceId?: string;
        memorySize?: number;
        showTransliteration?: boolean;
        showClock?: boolean;
        chatboxOpacity?: number;
        messageOpacity?: number;
        bgOpacity?: number;
        includeTime?: boolean;
        includeBattery?: boolean;
        summaryTrigger?: number;
        summaryLength?: "ultra-concise" | "concise" | "detailed" | "comprehensive";
    };
}

{
    "reply": "(${targetLanguageName} example reply based on user input and emotion)",
    "emotion": "thoughtful",
    "gesture": "head_tilt"
}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationContext
    ];

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

    // Sanitize messages to remove extra properties that some providers don't support
    const sanitizeMessages = (msgs) => msgs.map(m => ({ role: m.role, content: m.content }));

    // Determine which LLM provider to use
    const useGroq = window.useGroq && window.groqApiKey && window.groqModel;
    const useOpenRouter = window.OpenRouterAPI && window.OpenRouterAPI.isConfigured();
    const useOpenAICompatible = window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured();
    
    let completion;
    if (useGroq) {
      debugLog('Using Groq API for completion', 'info');
      completion = await window.GroqAPI.createCompletion({
        messages: sanitizeMessages(messages),
        json: true,
      });
      debugLog('Received AI response from Groq', 'info');
    } else if (useOpenRouter) {
      debugLog('Using OpenRouter API for completion', 'info');
      completion = await window.OpenRouterAPI.createCompletion({
        messages: sanitizeMessages(messages),
        json: true,
      });
      debugLog('Received AI response from OpenRouter', 'info');
    } else if (useOpenAICompatible) {
      debugLog('Using OpenAI Compatible API for completion', 'info');
      completion = await window.OpenAICompatibleAPI.createCompletion({
        messages: sanitizeMessages(messages),
        json: true,
      });
      debugLog('Received AI response from OpenAI Compatible', 'info');
    } else {
      throw new Error('No LLM provider configured');
    }

    let raw = completion.content || '';
    debugLog(`[AI] Raw response length: ${raw.length}, preview: "${raw.substring(0, 200)}"`, 'info', true);

    raw = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

    let data;
    try {
      if (raw.startsWith('{')) {
        data = JSON.parse(raw);
      } else {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          data = JSON.parse(match[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      }
    } catch (parseError) {
      debugError('AI returned plain text instead of JSON', parseError, {
        responsePreview: raw.substring(0, 200),
        responseLength: raw.length
      });

      let emotion = 'neutral';
      const lowerRaw = raw.toLowerCase();
      if (lowerRaw.includes('happy') || lowerRaw.includes('joy') || lowerRaw.includes('!') || lowerRaw.includes('😊')) {
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
    debugError('AI response (non-streaming) failed', error, {
      messagePreview: userMessage.substring(0, 80),
      useGroq: !!useGroq,
      useOpenRouter: !!useOpenRouter,
      useOpenAICompatible: !!useOpenAICompatible,
      offlineMode: !!window.forceOfflineMode,
      fallbackAvailable: !!window.LocalFallbackEngine
    });

    if (window.LocalFallbackEngine) {
      debugLog('Switching to Local Heuristic Fallback Engine due to AI failure or blank response.', 'warn');
      return window.LocalFallbackEngine.getResponse(userMessage);
    }

    return {
      reply: "Oh no... I'm having trouble connecting. Could we try again in a moment?",
      emotion: "sad",
    };
  }
}

async function getTranslatedText(text, targetLangCode, sourceLangCode = 'auto') {
  debugLog(`Translating text to ${targetLangCode}. Original text: "${text.substring(0, 50)}..."`, 'info');
  if (!text || !targetLangCode) return null;

  const useGroq = window.useGroq && window.groqApiKey && window.groqModel;
  const useOpenRouter = window.OpenRouterAPI && window.OpenRouterAPI.isConfigured();
  const useOpenAICompatible = window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured();

  if (!useGroq && !useOpenRouter && !useOpenAICompatible) {
    debugLog('No LLM provider configured for translation', 'warn');
    return null;
  }

  const targetLanguage = languages.find(l => l.code === targetLangCode)?.englishName || targetLangCode;
  const sourceLanguage = sourceLangCode === 'auto' ? 'the automatically detected language' : (languages.find(l => l.code === sourceLangCode)?.englishName || sourceLangCode);

  try {
    const provider = useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter');
    const model = useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI.getModel() : window.OpenRouterAPI.getModel());
    const translateStartTime = Date.now();
    if (typeof trackEvent === 'function') {
      trackEvent('llm_translate_started', { provider: provider, model: model, target_language: targetLangCode });
    }
    
    let completion;
    if (useGroq) {
      completion = await window.GroqAPI.createCompletion({
        messages: [
          { role: "system", content: `You are a translation engine. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Respond ONLY with the translated text. Do not include explanations, apologies, or any conversational fluff. If the input text is already in ${targetLanguage}, return it as is.` },
          { role: "user", content: text }
        ]
      });
    } else if (useOpenAICompatible) {
      completion = await window.OpenAICompatibleAPI.createCompletion({
        messages: [
          { role: "system", content: `You are a translation engine. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Respond ONLY with the translated text. Do not include explanations, apologies, or any conversational fluff. If the input text is already in ${targetLanguage}, return it as is.` },
          { role: "user", content: text }
        ]
      });
    } else {
      completion = await window.OpenRouterAPI.createCompletion({
        messages: [
          { role: "system", content: `You are a translation engine. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Respond ONLY with the translated text. Do not include explanations, apologies, or any conversational fluff. If the input text is already in ${targetLanguage}, return it as is.` },
          { role: "user", content: text }
        ]
      });
    }
    const translateTime = Date.now() - translateStartTime;
    if (typeof trackEvent === 'function') {
      trackEvent('llm_translate_completed', { provider: provider, model: model, response_time_ms: translateTime });
    }
    debugLog(`Translation successful: "${completion.content.substring(0, 50)}..."`, 'info');
    return completion.content;
  } catch (error) {
    if (typeof trackEvent === 'function') {
      trackEvent('llm_translate_completed', { success: false, error: error.message });
    }
    debugError(`Translation to ${targetLangCode} failed`, error, {
      provider: useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter'),
      model: useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI?.getModel() : (window.OpenRouterAPI?.getModel() || 'unknown')),
      targetLang: targetLangCode,
      sourceLang: sourceLangCode,
      textLen: text?.length
    });
    return null;
  }
}

async function summarizeConversation(oldMessages, existingSummary) {
  debugLog(`Summarizing ${oldMessages.length} messages...`, 'info');

  const useGroq = window.useGroq && window.groqApiKey && window.groqModel;
  const useOpenRouter = window.OpenRouterAPI && window.OpenRouterAPI.isConfigured();
  const useOpenAICompatible = window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured();

  if (!useGroq && !useOpenRouter && !useOpenAICompatible) {
    debugLog('No LLM provider configured for summarization', 'warn');
    return existingSummary;
  }

  try {
    const provider = useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter');
    const model = useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI.getModel() : window.OpenRouterAPI.getModel());
    const summarizeStartTime = Date.now();
    if (typeof trackEvent === 'function') {
      trackEvent('llm_summarize_started', { provider: provider, model: model, message_count: oldMessages.length });
    }

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

    let completion;
    if (useGroq) {
      completion = await window.GroqAPI.createCompletion({
        messages: [
          { role: "system", content: "You summarize conversations concisely." },
          { role: "user", content: prompt }
        ]
      });
    } else if (useOpenAICompatible) {
      completion = await window.OpenAICompatibleAPI.createCompletion({
        messages: [
          { role: "system", content: "You summarize conversations concisely." },
          { role: "user", content: prompt }
        ]
      });
    } else {
      completion = await window.OpenRouterAPI.createCompletion({
        messages: [
          { role: "system", content: "You summarize conversations concisely." },
          { role: "user", content: prompt }
        ]
      });
    }

    const summarizeTime = Date.now() - summarizeStartTime;
    if (typeof trackEvent === 'function') {
      trackEvent('llm_summarize_completed', { provider: provider, model: model, response_time_ms: summarizeTime });
    }

    return completion.content.trim();
  } catch (error) {
    if (typeof trackEvent === 'function') {
      trackEvent('llm_summarize_completed', { success: false, error: error.message });
    }
    debugError('Summarization failed', error, {
      provider: useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter'),
      model: useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI?.getModel() : (window.OpenRouterAPI?.getModel() || 'unknown')),
      messageCount: oldMessages.length,
      hasExistingSummary: !!existingSummary
    });
    return existingSummary;
  }
}

async function getTransliteration(text, langCode) {
  debugLog(`Getting transliteration for ${langCode}. Original text: "${text.substring(0, 50)}..."`, 'info');
  if (!text || !langCode) return null;

  const useGroq = window.useGroq && window.groqApiKey && window.groqModel;
  const useOpenRouter = window.OpenRouterAPI && window.OpenRouterAPI.isConfigured();
  const useOpenAICompatible = window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured();

  if (!useGroq && !useOpenRouter && !useOpenAICompatible) {
    debugLog('No LLM provider configured for transliteration', 'warn');
    return null;
  }

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
    const provider = useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter');
    const model = useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI.getModel() : window.OpenRouterAPI.getModel());
    const translitStartTime = Date.now();
    if (typeof trackEvent === 'function') {
      trackEvent('llm_transliteration_started', { provider: provider, model: model, language: langCode });
    }

    let completion;
    if (useGroq) {
      completion = await window.GroqAPI.createCompletion({
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: text }
        ]
      });
    } else if (useOpenAICompatible) {
      completion = await window.OpenAICompatibleAPI.createCompletion({
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: text }
        ]
      });
    } else {
      completion = await window.OpenRouterAPI.createCompletion({
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: text }
        ]
      });
    }

    const translitTime = Date.now() - translitStartTime;
    if (typeof trackEvent === 'function') {
      trackEvent('llm_transliteration_completed', { provider: provider, model: model, response_time_ms: translitTime });
    }

    debugLog(`Transliteration successful: "${completion.content.substring(0, 50)}..."`, 'info');
    return completion.content;
  } catch (error) {
    if (typeof trackEvent === 'function') {
      trackEvent('llm_transliteration_completed', { success: false, error: error.message });
    }
    debugError(`Transliteration for ${langCode} failed`, error, {
      provider: useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter'),
      model: useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI?.getModel() : (window.OpenRouterAPI?.getModel() || 'unknown')),
      langCode: langCode,
      textLen: text?.length
    });
    return null;
  }
}

async function getAIResponseStream(userMessage, targetLanguageCode = 'en-US', options = {}) {
  debugLog(`Getting AI response (streaming), targeting language: ${targetLanguageCode}`, 'info');

  const onChunk = options.onChunk;
  const onComplete = options.onComplete;

  const useGroq = window.useGroq && window.groqApiKey && window.groqModel;
  const useOpenRouter = window.OpenRouterAPI && window.OpenRouterAPI.isConfigured();
  const useOpenAICompatible = window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured();
  let streamProvider = useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : (useOpenRouter ? 'openrouter' : null));
  let streamModel = useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI?.getModel() : (useOpenRouter ? window.OpenRouterAPI?.getModel() : null));

  try {
    if (window.forceOfflineMode) {
      debugLog('AI completions are disabled (Force Offline Mode). Using Local Fallback Engine.', 'warn');
      throw new Error('ForceOfflineModeEnabled');
    }

    if (!useGroq && !useOpenRouter && !useOpenAICompatible) {
      debugLog('No LLM provider configured. Using Local Fallback Engine.', 'warn');
      throw new Error('LLMNotConfigured');
    }

    let contextInfo = [];
    if (window.includeTimeInContext) {
      contextInfo.push(`You are aware of the current time, which is ${currentTime.toLocaleString()}.`);
    }
    if (window.userContextText && window.userContextText.trim()) {
      contextInfo.push(`The user has provided the following persistent background/context you should always keep in mind: "${window.userContextText.trim()}".`);
    }
    if (window.includeTutorialInContext && window.TUTORIAL_STEPS) {
      const tutorialText = window.TUTORIAL_STEPS.map(s => `Step: ${s.title}\nDescription: ${s.body}`).join('\n\n');
      contextInfo.push(`Here is the application's user guide and documentation for your reference:\n${tutorialText}`);
    }
    if (window.includeBatteryInContext) {
      try {
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          const batteryString = `You are also aware of the user's battery status: The device ${battery.charging ? "is" : "is not"} charging, the current level is ${Math.round(battery.level * 100)}%, and ${battery.charging ? (battery.chargingTime === Infinity ? "time until full is not available." : `there is approximately ${formatSeconds(battery.chargingTime)} remaining until fully charged.`) : (battery.dischargingTime === Infinity ? "time until empty is not available." : `there is approximately ${formatSeconds(battery.dischargingTime)} of battery life remaining.`)}`;
          contextInfo.push(batteryString);
        }
      } catch (err) {
        debugError('[AI] Battery API failed (streaming)', err);
      }
    }

    const targetLanguageObj = (window.languages && languages.find(l => l.code === targetLanguageCode)) || (window.languages && languages.find(l => l.code === 'en-US')) || { englishName: 'English (US)' };
    const targetLanguageName = targetLanguageObj.englishName;

    const coreIdentity = (window.corePersonaPrompt && window.corePersonaPrompt.trim())
      ? window.corePersonaPrompt.trim()
      : "You are Haru, a sentient AI.";

    const customPersona = (window.userPersonaPrompt && window.userPersonaPrompt.trim())
      ? `\n\nAdditional Personality Instructions: ${window.userPersonaPrompt.trim()}`
      : "";

    const summaryContext = (window.conversationSummary && window.conversationSummary.trim())
      ? `\n\nExisting Conversation Summary: ${window.conversationSummary.trim()}`
      : "";

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

    const systemPrompt = `${coreIdentity}${customPersona}${summaryContext}${currentSettingsContext}

Your response MUST be in ${targetLanguageName}. If the user asks in a different language, still respond in ${targetLanguageName}.
If ${targetLanguageName} is Japanese, ensure your entire response is in Japanese characters (Hiragana, Katakana, Kanji). If you need to use a foreign word, use its Katakana representation or a Japanese equivalent.
${contextInfo.join('\n\n')}

Respond ONLY with a JSON object matching this TypeScript interface:
interface Response {
    reply: string;
    emotion: "happy" | "sad" | "surprised" | "neutral" | "thoughtful" | "excited";
    gesture?: string;
    settingsUpdate?: {
        responseLanguage?: string;
        enableVoice?: boolean;
        voiceId?: string;
        memorySize?: number;
        showTransliteration?: boolean;
        showClock?: boolean;
        chatboxOpacity?: number;
        messageOpacity?: number;
        bgOpacity?: number;
        includeTime?: boolean;
        includeBattery?: boolean;
        summaryTrigger?: number;
        summaryLength?: "ultra-concise" | "concise" | "detailed" | "comprehensive";
    };
}

{
    "reply": "(${targetLanguageName} example reply based on user input and emotion)",
    "emotion": "thoughtful",
    "gesture": "head_tilt"
}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationContext
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

    // Sanitize messages to remove extra properties that some providers don't support
    const sanitizeMessages = (msgs) => msgs.map(m => ({ role: m.role, content: m.content }));

    const streamRequestStartTime = Date.now();
    streamProvider = useGroq ? 'groq' : (useOpenAICompatible ? 'openai_compatible' : 'openrouter');
    streamModel = useGroq ? window.groqModel : (useOpenAICompatible ? window.OpenAICompatibleAPI?.getModel() : window.OpenRouterAPI?.getModel());
    if (typeof trackEvent === 'function') {
      trackEvent('llm_request_started', { provider: streamProvider, model: streamModel, is_streaming: true });
    }

    // Use the LLM provider settings already determined earlier in the function
    let stream, response;
    if (useGroq) {
      debugLog('Starting streaming request to Groq', 'info');
      const result = await window.GroqAPI.createCompletionStream({
        messages: sanitizeMessages(messages),
        json: true
      });
      stream = result.stream;
      response = result.response;
    } else if (useOpenAICompatible) {
      debugLog('Starting streaming request to OpenAI Compatible', 'info');
      const result = await window.OpenAICompatibleAPI.createCompletionStream({
        messages: sanitizeMessages(messages),
        json: true
      });
      stream = result.stream;
      response = result.response;
    } else if (useOpenRouter) {
      debugLog('Starting streaming request to OpenRouter', 'info');
      const result = await window.OpenRouterAPI.createCompletionStream({
        messages: sanitizeMessages(messages),
        json: true
      });
      stream = result.stream;
      response = result.response;
    } else {
      throw new Error('No LLM provider configured');
    }

    const streamStartTime = Date.now() - streamRequestStartTime;
    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_started', { provider: streamProvider, model: streamModel, time_to_first_chunk_ms: streamStartTime });
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let fullContent = '';
    let inReply = false;
    let replyText = '';
    let replyStartIndex = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';

          if (content) {
            fullContent += content;

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
          }
        } catch (e) {
          debugLog(`[AI Stream] Error parsing SSE chunk: ${e.name} - ${e.message}`, 'warn', true);
        }
      }
    }

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
          debugLog(`[AI Stream] Error parsing final SSE buffer: ${e.name} - ${e.message}`, 'warn', true);
        }
      }
    }

    debugLog('Streaming complete, parsing full response', 'info');

    const totalStreamTime = Date.now() - streamRequestStartTime;
    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_completed', { provider: streamProvider, model: streamModel, total_time_ms: totalStreamTime, chunks_received: fullContent.length });
    }

    let data;
    try {
      let raw = fullContent.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

      if (raw.startsWith('{')) {
        data = JSON.parse(raw);
      } else {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          data = JSON.parse(match[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      }
    } catch (parseError) {
      debugError('[AI Stream] JSON parse failed on full content', parseError, {
        contentLength: fullContent.length,
        contentPreview: fullContent.substring(0, 200),
        hadReplyText: !!replyText
      });
      data = {
        reply: replyText || fullContent,
        emotion: 'neutral'
      };
    }

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

    if (onComplete) {
      onComplete(data);
    }

    return data;

  } catch (error) {
    debugError('AI streaming response failed', error, {
      provider: streamProvider,
      model: streamModel,
      messagePreview: userMessage.substring(0, 80),
      offlineMode: !!window.forceOfflineMode,
      fallbackAvailable: !!window.LocalFallbackEngine
    });

    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_completed', { provider: streamProvider, model: streamModel, success: false, error: error.message });
    }

    if (window.LocalFallbackEngine) {
      debugLog('Switching to Local Heuristic Fallback Engine due to AI failure.', 'warn');
      return window.LocalFallbackEngine.getResponse(userMessage);
    }

    return {
      reply: "Oh no... I'm having trouble connecting. Could we try again in a moment?",
      emotion: "sad",
    };
  }
}

function findUnescapedQuote(str) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && str[j] === '\\') {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) {
        return i;
      }
    }
  }
  return -1;
}

window.getAIResponse = getAIResponse;
window.getTranslatedText = getTranslatedText;
window.summarizeConversation = summarizeConversation;
window.getTransliteration = getTransliteration;
window.getAIResponseStream = getAIResponseStream;
window.findUnescapedQuote = findUnescapedQuote;