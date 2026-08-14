// ---------------------------------------------------------------------------
// Shared provider resolution
//
// The same "useGroq / useOpenRouter / useOpenAICompatible -> if/else/else"
// dispatch used to be copy-pasted five times (getAIResponse,
// getAIResponseStream, getTranslatedText, summarizeConversation,
// getTransliteration), and had already drifted: the non-streaming path tried
// providers in Groq > OpenRouter > OpenAICompatible order while the streaming
// path used Groq > OpenAICompatible > OpenRouter. One order, defined once.
// ---------------------------------------------------------------------------

function resolveLLMProvider() {
  if (window.useGroq && window.groqApiKey && window.groqModel) {
    return { name: 'groq', api: window.GroqAPI, model: window.groqModel };
  }
  if (window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured()) {
    return { name: 'openai_compatible', api: window.OpenAICompatibleAPI, model: window.OpenAICompatibleAPI.getModel() };
  }
  if (window.OpenRouterAPI && window.OpenRouterAPI.isConfigured()) {
    return { name: 'openrouter', api: window.OpenRouterAPI, model: window.OpenRouterAPI.getModel() };
  }
  return null;
}
window.resolveLLMProvider = resolveLLMProvider;

// Strips role/content down for providers that reject extra message properties.
function sanitizeMessages(msgs) {
  return msgs.map(m => ({ role: m.role, content: m.content }));
}

// Non-streaming completion through whichever provider is configured.
async function callConfiguredLLM(messages, eventPrefix) {
  const provider = resolveLLMProvider();
  if (!provider) throw new Error('LLMNotConfigured');

  const startTime = Date.now();
  if (eventPrefix && typeof trackEvent === 'function') {
    trackEvent(`${eventPrefix}_started`, { provider: provider.name, model: provider.model });
  }

  try {
    const completion = await provider.api.createCompletion({ messages: sanitizeMessages(messages), json: true });
    if (eventPrefix && typeof trackEvent === 'function') {
      trackEvent(`${eventPrefix}_completed`, { provider: provider.name, model: provider.model, response_time_ms: Date.now() - startTime });
    }
    return completion;
  } catch (error) {
    // Never send error.message to analytics: provider error bodies can echo
    // request content, including API keys. trackError sends only a category
    // and a numeric-ish code.
    if (eventPrefix && typeof trackEvent === 'function') {
      trackEvent(`${eventPrefix}_completed`, { provider: provider.name, model: provider.model, success: false });
    }
    if (typeof trackError === 'function') trackError('ai_request', error && error.status);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Prompt construction — shared by getAIResponse and getAIResponseStream.
// ---------------------------------------------------------------------------

async function buildContextInfo() {
  const contextInfo = [];

  if (window.includeTimeInContext) {
    // Read the clock at call time. `currentTime` was a global set once at
    // page load and never updated, so it reported the load-time forever.
    contextInfo.push(`You are aware of the current time, which is ${new Date().toLocaleString()}.`);
  }

  if (window.userContextText && window.userContextText.trim()) {
    contextInfo.push(`The user has provided the following persistent background/context you should always keep in mind: "${window.userContextText.trim()}".`);
  }

  if (window.includeTutorialInContext && window.TUTORIAL_STEPS) {
    const tutorialText = window.TUTORIAL_STEPS.map(s => `Step: ${s.title}\nDescription: ${s.body}`).join('\n\n');
    contextInfo.push(`Here is the application's user guide and documentation for your reference:\n${tutorialText}`);
    debugLog('Tutorial info added to AI context.', 'info');
  }

  if (window.includeBatteryInContext) {
    try {
      if ('getBattery' in navigator) {
        const battery = await navigator.getBattery();
        const chargeInfo = battery.charging
          ? (battery.chargingTime === Infinity ? 'time until full is not available.' : `there is approximately ${formatSeconds(battery.chargingTime)} remaining until fully charged.`)
          : (battery.dischargingTime === Infinity ? 'time until empty is not available.' : `there is approximately ${formatSeconds(battery.dischargingTime)} of battery life remaining.`);
        contextInfo.push(`You are also aware of the user's battery status: The device ${battery.charging ? 'is' : 'is not'} charging, the current level is ${Math.round(battery.level * 100)}%, and ${chargeInfo}`);
      }
    } catch (err) {
      debugError('[AI] Battery API failed', err);
    }
  }

  return contextInfo;
}

function resolveTargetLanguageName(targetLanguageCode) {
  const langs = Array.isArray(window.languages) ? window.languages : [];
  const match = langs.find(l => l.code === targetLanguageCode) || langs.find(l => l.code === 'en-US') || { englishName: 'English (US)' };
  return match.englishName;
}

function buildSystemPrompt(targetLanguageName, contextInfo) {
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

  return `${coreIdentity}${customPersona}${summaryContext}${currentSettingsContext}

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
}

// Builds the full message array for a chat completion. conversationContext
// stores assistant turns as plain reply text (already unwrapped from JSON
// before storage in chat_controller.js), so it's spread in directly.
async function buildChatMessages(userMessage, targetLanguageCode, logLabel = '') {
  const contextInfo = await buildContextInfo();
  const targetLanguageName = resolveTargetLanguageName(targetLanguageCode);

  const messages = [
    { role: 'system', content: buildSystemPrompt(targetLanguageName, contextInfo) },
    ...conversationContext
  ];

  const lastMsg = conversationContext[conversationContext.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  if (window.showChatContextLogs) {
    debugLog(`--- FULL CHAT CONTEXT SENT TO AI${logLabel ? ` (${logLabel})` : ''} ---`, 'info');
    messages.forEach((m, idx) => debugLog(`[${idx}] ${m.role.toUpperCase()}: ${m.content}`, 'info'));
    debugLog('--- END CHAT CONTEXT ---', 'info');
  }

  return messages;
}

// Rough emotion guess for a reply that didn't parse as JSON.
// Ordered most-specific first: '!' is a weak signal and used to be tested
// first in the happy branch, which made almost every reply "happy" and left
// "surprised" (which also tested '!') effectively unreachable.
function inferEmotion(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('😢') || lower.includes('sad') || lower.includes('sorry')) return 'sad';
  if (lower.includes('😮') || lower.includes('surprised') || lower.includes('?')) return 'surprised';
  if (lower.includes('excited') || lower.includes('amazing') || lower.includes('wow')) return 'excited';
  if (lower.includes('think') || lower.includes('hmm') || lower.includes('...')) return 'thoughtful';
  if (lower.includes('😊') || lower.includes('happy') || lower.includes('joy') || lower.includes('!')) return 'happy';
  return 'neutral';
}

// Parses a raw completion into {reply, emotion, ...}, falling back to treating
// the whole thing as plain text. Throws BlankAIResponse on an empty reply.
function parseAIResponse(rawContent, plainTextFallback = null) {
  let raw = (rawContent || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

  let data = null;
  try {
    if (raw.startsWith('{')) {
      data = JSON.parse(raw);
    } else {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error('No JSON found in response');
    }
  } catch (parseError) {
    debugError('AI returned plain text instead of JSON', parseError, {
      responsePreview: raw.substring(0, 200),
      responseLength: raw.length
    });
    const text = (plainTextFallback || raw).trim();
    data = { reply: text, emotion: inferEmotion(text) };
  }

  if (!data.reply || data.reply.trim() === '') {
    throw new Error('BlankAIResponse');
  }
  return data;
}

const CONNECTION_ERROR_REPLY = "Oh no... I'm having trouble connecting. Could we try again in a moment?";

// Shared failure path for both entry points. setTransientFallbackState/
// getLocalFallbackResponse already do the right thing here — the fallback is
// per-request and never persisted to localStorage, so a bad request doesn't
// strand the user in offline mode across reloads. This just makes sure the
// caller can tell a genuine connectivity failure apart from ordinary dialogue
// via `isError`, instead of every caller string-comparing the English text.
function handleAIFailure(error, userMessage, reason) {
  if (window.LocalFallbackEngine) {
    return getLocalFallbackResponse(userMessage, reason);
  }
  return { reply: CONNECTION_ERROR_REPLY, emotion: 'sad', isError: true };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

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

    const provider = resolveLLMProvider();
    if (!provider) {
      debugLog('No LLM provider configured. Using Local Fallback Engine.', 'warn');
      throw new Error('LLMNotConfigured');
    }

    const messages = await buildChatMessages(userMessage, targetLanguageCode);
    const completion = await callConfiguredLLM(messages);
    debugLog(`Received AI response from ${provider.name}`, 'info');

    const data = parseAIResponse(completion.content);
    setTransientFallbackState(false);
    return data;

  } catch (error) {
    debugError('AI response (non-streaming) failed', error, {
      messagePreview: userMessage.substring(0, 80),
      offlineMode: !!window.forceOfflineMode,
      fallbackAvailable: !!window.LocalFallbackEngine
    });
    const isForceOffline = error && error.message === 'ForceOfflineModeEnabled';
    return handleAIFailure(error, userMessage, isForceOffline ? 'forced offline' : 'ai failure or blank response');
  }
}

function setTransientFallbackState(isActive) {
  window.isOfflineMode = !!isActive;

  if (window.forceOfflineMode) {
    return;
  }

  const chatContainer = document.querySelector('.chat-container');
  const statusInd = document.getElementById('chat-status-indicator');

  if (isActive) {
    if (chatContainer) chatContainer.classList.add('offline-mode');
    if (statusInd) statusInd.textContent = 'OFFLINE FALLBACK';
  } else {
    if (chatContainer) chatContainer.classList.remove('offline-mode');
    if (statusInd) statusInd.textContent = 'ONLINE';
  }
}

function getLocalFallbackResponse(userMessage, reason) {
  setTransientFallbackState(true);
  debugLog(`Using Local Heuristic Fallback Engine (${reason}).`, 'warn');
  return window.LocalFallbackEngine.getResponse(userMessage);
}

async function getTranslatedText(text, targetLangCode, sourceLangCode = 'auto') {
  debugLog(`Translating text to ${targetLangCode}. Original text: "${text.substring(0, 50)}..."`, 'info');
  if (!text || !targetLangCode) return null;

  if (!resolveLLMProvider()) {
    debugLog('No LLM provider configured for translation', 'warn');
    return null;
  }

  const targetLanguage = languages.find(l => l.code === targetLangCode)?.englishName || targetLangCode;
  const sourceLanguage = sourceLangCode === 'auto' ? 'the automatically detected language' : (languages.find(l => l.code === sourceLangCode)?.englishName || sourceLangCode);

  try {
    const completion = await callConfiguredLLM([
      { role: 'system', content: `You are a translation engine. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Respond ONLY with the translated text. Do not include explanations, apologies, or any conversational fluff. If the input text is already in ${targetLanguage}, return it as is.` },
      { role: 'user', content: text }
    ], 'llm_translate');
    debugLog(`Translation successful: "${completion.content.substring(0, 50)}..."`, 'info');
    return completion.content;
  } catch (error) {
    debugError(`Translation to ${targetLangCode} failed`, error, { targetLang: targetLangCode, sourceLang: sourceLangCode, textLen: text?.length });
    return null;
  }
}

// Throws on failure. Callers delete the summarized messages from the
// conversation on success, so silently returning the previous summary here
// meant a failed network call destroyed chat history and produced nothing in
// exchange.
async function summarizeConversation(oldMessages, existingSummary) {
  debugLog(`Summarizing ${oldMessages.length} messages...`, 'info');

  if (!resolveLLMProvider()) {
    throw new Error('No LLM provider configured for summarization');
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

  const completion = await callConfiguredLLM([
    { role: 'system', content: 'You summarize conversations concisely.' },
    { role: 'user', content: prompt }
  ], 'llm_summarize');

  const summary = completion && completion.content && completion.content.trim();
  if (!summary) throw new Error('Summarization returned an empty summary');
  return summary;
}

async function getTransliteration(text, langCode) {
  debugLog(`Getting transliteration for ${langCode}. Original text: "${text.substring(0, 50)}..."`, 'info');
  if (!text || !langCode) return null;

  if (!resolveLLMProvider()) {
    debugLog('No LLM provider configured for transliteration', 'warn');
    return null;
  }

  let instruction = '';
  if (langCode === 'ja-JP') {
    instruction = 'Provide a Romaji (English phonetic alphabet) transliteration of the following Japanese text. Respond ONLY with the Romaji text. Do not add any other phrases or explanations.';
  } else if (langCode === 'ko-KR') {
    instruction = 'Provide a Romanized Korean (English phonetic alphabet) transliteration of the following Korean text. Respond ONLY with the Romanized text. Do not add any other phrases or explanations.';
  } else {
    debugLog(`Transliteration not supported for language: ${langCode}`, 'warn');
    return null;
  }

  try {
    const completion = await callConfiguredLLM([
      { role: 'system', content: instruction },
      { role: 'user', content: text }
    ], 'llm_transliteration');
    debugLog(`Transliteration successful: "${completion.content.substring(0, 50)}..."`, 'info');
    return completion.content;
  } catch (error) {
    debugError(`Transliteration for ${langCode} failed`, error, { langCode, textLen: text?.length });
    return null;
  }
}

/**
 * Find the first unescaped quote in a string.
 * Returns the index of the quote, or -1 if not found.
 */
function findUnescapedQuote(str) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && str[j] === '\\') {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) return i;
    }
  }
  return -1;
}
window.findUnescapedQuote = findUnescapedQuote;

/**
 * Streaming version of getAIResponse. Creates immediate UI feedback by
 * streaming the reply text in real-time as the JSON response arrives.
 */
async function getAIResponseStream(userMessage, targetLanguageCode = 'en-US', options = {}) {
  debugLog(`Getting AI response (streaming), targeting language: ${targetLanguageCode}`, 'info');

  const onChunk = options.onChunk;
  const onComplete = options.onComplete;

  const provider = resolveLLMProvider();

  try {
    if (window.forceOfflineMode) {
      debugLog('AI completions are disabled (Force Offline Mode). Using Local Fallback Engine.', 'warn');
      throw new Error('ForceOfflineModeEnabled');
    }
    if (!provider) {
      debugLog('No LLM provider configured. Using Local Fallback Engine.', 'warn');
      throw new Error('LLMNotConfigured');
    }

    const messages = await buildChatMessages(userMessage, targetLanguageCode, 'STREAMING');

    const streamRequestStartTime = Date.now();
    if (typeof trackEvent === 'function') {
      trackEvent('llm_request_started', { provider: provider.name, model: provider.model, is_streaming: true });
    }

    debugLog(`Starting streaming request to ${provider.name}`, 'info');
    const { stream, response } = await provider.api.createCompletionStream({ messages: sanitizeMessages(messages), json: true });

    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_started', { provider: provider.name, model: provider.model, time_to_first_chunk_ms: Date.now() - streamRequestStartTime });
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let fullContent = '';
    let inReply = false;
    let replyText = '';
    let replyStartIndex = -1;

    // Incrementally surfaces the `reply` field while the JSON is still arriving.
    const emitProgress = () => {
      if (!inReply) {
        const replyMatch = fullContent.match(/"reply"\s*:\s*"/);
        if (!replyMatch) return;
        inReply = true;
        replyStartIndex = replyMatch.index + replyMatch[0].length;
      }
      const afterKey = fullContent.slice(replyStartIndex);
      const closeQuoteIndex = findUnescapedQuote(afterKey);
      if (closeQuoteIndex !== -1) {
        replyText = afterKey.slice(0, closeQuoteIndex);
        inReply = false;
      } else {
        replyText = afterKey;
      }
      if (onChunk) onChunk(replyText);
    };

    const consumeSSELine = (line) => {
      if (!line.startsWith('data: ')) return;
      const payload = line.slice(6);
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          emitProgress();
        }
      } catch (e) {
        debugLog(`[AI Stream] Error parsing SSE chunk: ${e.name} - ${e.message}`, 'warn', true);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(consumeSSELine);
    }
    if (buffer.startsWith('data: ')) consumeSSELine(buffer);

    debugLog('Streaming complete, parsing full response', 'info');

    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_completed', {
        provider: provider.name,
        model: provider.model,
        total_time_ms: Date.now() - streamRequestStartTime,
        chunks_received: fullContent.length
      });
    }

    // replyText is the best plain-text fallback: for a truncated JSON
    // response it holds the partial reply we already showed the user.
    const data = parseAIResponse(fullContent, replyText || fullContent);
    setTransientFallbackState(false);
    if (onComplete) onComplete(data);
    return data;

  } catch (error) {
    debugError('AI streaming response failed', error, {
      provider: provider && provider.name,
      model: provider && provider.model,
      messagePreview: userMessage.substring(0, 80),
      offlineMode: !!window.forceOfflineMode,
      fallbackAvailable: !!window.LocalFallbackEngine
    });

    // success:false only — never the raw error message, which can echo
    // request content including API keys.
    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_completed', { provider: provider && provider.name, model: provider && provider.model, success: false });
    }
    if (typeof trackError === 'function') trackError('ai_request', error && error.status);

    const isForceOffline = error && error.message === 'ForceOfflineModeEnabled';
    return handleAIFailure(error, userMessage, isForceOffline ? 'forced offline' : 'streaming failure');
  }
}

// Export functions to window object
window.getAIResponse = getAIResponse;
window.getAIResponseStream = getAIResponseStream;
window.buildChatMessages = buildChatMessages;
window.parseAIResponse = parseAIResponse;
window.summarizeConversation = summarizeConversation;
window.getTranslatedText = getTranslatedText;
window.getTransliteration = getTransliteration;
