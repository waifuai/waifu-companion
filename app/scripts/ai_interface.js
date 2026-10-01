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
  if (window.useGroq && window.GroqAPI && window.GroqAPI.isConfigured()) {
    return { name: 'groq', api: window.GroqAPI, model: window.groqModel || window.GroqAPI.getModel() };
  }
  if (window.useOpenAICompatible && window.OpenAICompatibleAPI && window.OpenAICompatibleAPI.isConfigured()) {
    return { name: 'openai_compatible', api: window.OpenAICompatibleAPI, model: window.OpenAICompatibleAPI.getModel() };
  }
  if (window.useOpenRouter && window.OpenRouterAPI && window.OpenRouterAPI.isConfigured()) {
    return { name: 'openrouter', api: window.OpenRouterAPI, model: window.OpenRouterAPI.getModel() };
  }
  if (window.WaifuProxyAPI && window.WaifuProxyAPI.isConfigured()) {
    return { name: 'waifu_proxy', api: window.WaifuProxyAPI, model: window.WaifuProxyAPI.getModel() };
  }
  return null;
}
window.resolveLLMProvider = resolveLLMProvider;

// Strips role/content down for providers that reject extra message properties.
function sanitizeMessages(msgs) {
  return msgs.map(m => ({ role: m.role, content: m.content }));
}

// Non-streaming completion through whichever provider is configured.
async function callConfiguredLLM(messages, eventPrefix, purpose = 'chat') {
  const provider = resolveLLMProvider();
  if (!provider) throw new Error('LLMNotConfigured');

  const startTime = Date.now();
  if (eventPrefix && typeof trackEvent === 'function') {
    trackEvent(`${eventPrefix}_started`, { provider: provider.name, model: provider.model });
  }

  try {
    // No response_format/json_object on purpose: forcing structured output on
    // small models is what produced the malformed-JSON turns that surfaced raw
    // braces and truncated replies. parseAIResponse still salvages JSON if a
    // model emits it anyway.
    const completion = await provider.api.createCompletion({
      messages: sanitizeMessages(messages),
      purpose
    });
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
- Auto TTS Language: ${window.enableAutoTtsLang}
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

Respond in the language the user writes in.
${contextInfo.join('\n\n')}

You can draw pictures on request. When the user asks for a picture, photo, selfie or drawing, end your reply with a new line exactly in this form:
[IMAGE: <short English description of the scene>|<orientation>]
<orientation> is portrait, landscape or square. Keep the description safe-for-work and concrete (a real scene, outfit and setting); translate the user's request into English for the description. The rest of the reply stays normal spoken dialogue — react in character first, then the image tag on its own line. Never mention the tag or the words IMAGE around it; just talk naturally, the picture appears on its own.

Respond with plain conversational dialogue only — one natural message in ${targetLanguageName} that is displayed and spoken aloud exactly as written. Never wrap the reply in JSON, code fences, or labels like "reply:"; body language and feelings come through in the words themselves.`;
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

// Emotion inference for plain-text replies. The animation switch in
// chat_controller.js only understands happy/sad/surprised/thoughtful/excited,
// so map to those — anything else renders as the neutral expression. Order is
// most-specific first.
function inferEmotion(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('😢') || lower.includes('😭') || lower.includes('💔') || lower.includes('sad') || lower.includes('sorry') || lower.includes('miss you') || lower.includes('حزين') || lower.includes('آسف')) return 'sad';
  if (lower.includes('?!') || lower.includes('!?') || lower.includes('😮') || lower.includes('😲') || lower.includes('whoa') || lower.includes('omg')) return 'surprised';
  if (lower.includes('🎉') || lower.includes('✨') || lower.includes('!!!') || lower.includes('excited') || lower.includes('amazing') || lower.includes('congrats') || lower.includes('wow') || lower.includes('رائع') || lower.includes('حماس')) return 'excited';
  if (lower.includes('😊') || lower.includes('😀') || lower.includes('🥰') || lower.includes('💕') || lower.includes('happy') || lower.includes('joy') || lower.includes('love') || lower.includes('!') || lower.includes('جميل') || lower.includes('شكرا') || lower.includes('مرحبا') || lower.includes('أهلا')) return 'happy';
  if (lower.includes('🤔') || lower.includes('hmm') || lower.includes('...') || lower.includes('let me think') || lower.includes('أعتقد') || lower.includes('?') || lower.includes('؟')) return 'thoughtful';
  return 'neutral';
}

// Salvages the "reply" field from a malformed JSON wrapper — the failure mode
// small models hit when the reply string contains unescaped inner quotes.
// Prefers the boundary at the next ", "emotion" key over the first unescaped
// close quote, which an inner quoted word would trigger early.
function salvageReplyFromBrokenJson(raw) {
  const key = raw.match(/"reply"\s*:\s*"/);
  if (!key) return null;
  let after = raw.slice(key.index + key[0].length);
  const emotionBoundary = after.match(/",\s*"emotion"\s*:/);
  if (emotionBoundary) {
    after = after.slice(0, emotionBoundary.index);
  } else {
    const closeQuote = findUnescapedQuote(after);
    // A truncated response has no closing quote at all — everything after
    // the key is the partial reply worth showing.
    if (closeQuote !== -1) after = after.slice(0, closeQuote);
  }
  // Undo the string escapes JSON.parse would have handled.
  return after.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() || null;
}

// The animation switch in chat_controller.js only knows five expressions;
// models that do emit an emotion label reach for dozens of near-synonyms. 
// Fold them onto
// the supported set so a labeled turn doesn't fall through to the neutral
// face, and unknown labels degrade to neutral.
const EMOTION_ANIMATION_SYNONYMS = {
  playful: 'happy', warm: 'happy', amused: 'happy', cheerful: 'happy', friendly: 'happy',
  gentle: 'happy', shy: 'happy', loving: 'happy', affectionate: 'happy', content: 'happy',
  teasing: 'happy', flirtatious: 'happy', flirty: 'happy', romantic: 'happy', caring: 'happy',
  tender: 'happy', joyful: 'happy', welcoming: 'happy', smile: 'happy',
  curious: 'thoughtful', pensive: 'thoughtful', thinking: 'thoughtful',
  apologetic: 'sad', sympathetic: 'sad', concerned: 'sad', empathetic: 'sad',
  confused: 'surprised', flustered: 'surprised'
};
const ANIMATED_EMOTIONS = ['happy', 'sad', 'surprised', 'thoughtful', 'excited'];

function normalizeEmotion(emotion) {
  const v = String(emotion || '').toLowerCase().trim();
  return EMOTION_ANIMATION_SYNONYMS[v] || (ANIMATED_EMOTIONS.includes(v) ? v : 'neutral');
}

// Parses a raw completion into {reply, emotion, ...}, treating plain
// conversational text as the expected shape. Well-formed JSON (a model
// emitting it despite the prompt) is unwrapped; malformed JSON is salvaged
// rather than shown. Throws BlankAIResponse on an empty reply.
function parseAIResponse(rawContent, plainTextFallback = null) {
  let raw = (rawContent || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

  // Image protocol, stripped FIRST so the tag never reaches emotion
  // inference, TTS language detection, or the streaming preview. The
  // description is written in English by design; the visible/spoken reply
  // stays in the conversation language.
  let imageRequest = null;
  const imageTopMatch = raw.match(/\[IMAGE:\s*([^\]|]+)\|(portrait|landscape|square)\s*\]/i);
  if (imageTopMatch) {
    imageRequest = {
      prompt: imageTopMatch[1].trim(),
      aspect: imageTopMatch[2].toLowerCase() === 'portrait' ? '2:3' : (imageTopMatch[2].toLowerCase() === 'landscape' ? '3:2' : '1:1'),
    };
    raw = raw.replace(imageTopMatch[0], '').replace(/\n{3,}/g, '\n\n').trim();
  } else if (/\[IMAGE:/i.test(raw)) {
    raw = raw.replace(/\[IMAGE:[^\]]*\]?/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  let data = null;
  try {
    let parsed = null;
    if (raw.startsWith('{')) {
      parsed = JSON.parse(raw);
    } else {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }
    if (parsed && typeof parsed === 'object' && 'reply' in parsed && typeof parsed.reply === 'string' && parsed.reply.trim() !== '') {
      data = parsed;
      data.emotion = normalizeEmotion(data.emotion);
      if (imageRequest) data.imageRequest = imageRequest;
    }
  } catch (parseError) {
    data = null;
  }

  if (!data) {
    let text = (plainTextFallback || raw).trim();
    if (raw.startsWith('{')) {
      // A model that wrapped the reply in JSON but broke out of strict JSON
      // (unescaped inner quotes, truncation) must not surface braces — take
      // the salvage over the raw wrapper, but only displace a real streaming
      // fallback if the salvage recovered more of the reply.
      const salvaged = salvageReplyFromBrokenJson(raw);
      if (salvaged && (!plainTextFallback || salvaged.length > text.length)) text = salvaged;
    }
    data = { reply: text, emotion: inferEmotion(text) };
    if (imageRequest) data.imageRequest = imageRequest;
    debugLog(`AI returned natural plain text response, inferred emotion: ${data.emotion}`, 'info');
  }

  if (!data.reply || data.reply.trim() === '') {
    // A pure image turn (only the tag) is valid: keep a minimal spoken line.
    if (data.imageRequest) {
      data.reply = 'Here, let me show you~';
    } else {
      throw new Error('BlankAIResponse');
    }
  }
  return data;
}

const CONNECTION_ERROR_REPLY = "Oh no... I'm having trouble connecting. Could we try again in a moment?";

// Shared failure path for both entry points. Small helper so callers can
// tell a genuine connectivity failure apart from ordinary dialogue via
// isError, instead of every caller string-comparing the English text.
function handleAIFailure(error) {
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
    const provider = resolveLLMProvider();
    if (!provider) {
      debugLog('No LLM provider configured. Using Local Fallback Engine.', 'warn');
      throw new Error('LLMNotConfigured');
    }

    const messages = await buildChatMessages(userMessage, targetLanguageCode);
    const completion = await callConfiguredLLM(messages);
    debugLog(`Received AI response from ${provider.name}`, 'info');

    const data = parseAIResponse(completion.content);
    return data;

  } catch (error) {
    debugError('AI response (non-streaming) failed', error, {
      messagePreview: userMessage.substring(0, 80)
    });
    return handleAIFailure(error);
  }
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
  ], 'llm_summarize', 'summary');

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
 * streaming the reply text in real-time as the response arrives.
 */
async function getAIResponseStream(userMessage, targetLanguageCode = 'en-US', options = {}) {
  debugLog(`Getting AI response (streaming), targeting language: ${targetLanguageCode}`, 'info');

  const onChunk = options.onChunk;
  const onComplete = options.onComplete;

  const provider = resolveLLMProvider();

  try {
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
    const { stream, response } = await provider.api.createCompletionStream({
      messages: sanitizeMessages(messages),
      purpose: options.purpose === 'ambient' ? 'ambient' : 'chat'
    });

    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_started', { provider: provider.name, model: provider.model, time_to_first_chunk_ms: Date.now() - streamRequestStartTime });
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let fullContent = '';
    let inReply = false;
    let isPlainText = false;
    let replyText = '';
    let replyStartIndex = -1;

    // Incrementally surfaces the reply text while it is arriving. Plain text
    // is the expected shape; the "reply" key detection is legacy defense for
    // a model that starts streaming a JSON object anyway.
    // Strip the image protocol tag from the streamed preview: the tag is an
    // internal instruction, never visible text, and its English content would
    // poison TTS language detection if it leaked into the spoken reply.
    // Display-only: fullContent must keep the raw tag, or a tag split across
    // chunks loses its "[IMAGE:" head mid-stream and the final parse sees only
    // "...|portrait]" (no image, tag tail leaks into chat). The third replace
    // hides a tag head still arriving ("[", "[IMA", ...).
    const stripImageTags = (s) => s
      .replace(/\[IMAGE:\s*[^\]|]+\|(?:portrait|landscape|square)\s*\]/gi, '')
      .replace(/\[IMAGE:[^\]]*\]?/gi, '')
      .replace(/\[(?:I(?:M(?:A(?:G(?:E)?)?)?)?)?$/i, '')
      .replace(/\n{3,}/g, '\n\n');

    const emitProgress = () => {
      const visible = stripImageTags(fullContent);
      const trimmed = visible.trimStart();
      if (!isPlainText && !inReply) {
        if (trimmed.startsWith('{') || trimmed.includes('"reply"')) {
          const replyMatch = visible.match(/"reply"\s*:\s*"/);
          if (replyMatch) {
            inReply = true;
            replyStartIndex = replyMatch.index + replyMatch[0].length;
          }
        } else if (trimmed.length > 5) {
          // Model is responding in natural plain text
          isPlainText = true;
        }
      }

      if (isPlainText) {
        replyText = visible;
        if (onChunk) onChunk(replyText);
        return;
      }

      if (inReply) {
        const afterKey = visible.slice(replyStartIndex);
        const closeQuoteIndex = findUnescapedQuote(afterKey);
        if (closeQuoteIndex !== -1) {
          replyText = afterKey.slice(0, closeQuoteIndex);
          inReply = false;
        } else {
          replyText = afterKey;
        }
        if (onChunk) onChunk(replyText);
      }
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
    if (onComplete) onComplete(data);
    return data;

  } catch (error) {
    debugError('AI streaming response failed', error, {
      provider: provider && provider.name,
      model: provider && provider.model,
      messagePreview: userMessage.substring(0, 80)
    });

    // success:false only — never the raw error message, which can echo
    // request content including API keys.
    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_completed', { provider: provider && provider.name, model: provider && provider.model, success: false });
    }
    if (typeof trackError === 'function') trackError('ai_request', error && error.status);

    return handleAIFailure(error);
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
