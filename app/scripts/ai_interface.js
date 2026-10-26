// Guard after every asynchronous boundary; transports also receive the signal.
function checkTurn(options = {}) {
  if (options.signal?.aborted || (options.valid && !options.valid())) {
    const error = new Error('Turn interrupted'); error.name = 'AbortError'; throw error;
  }
}
function awaitTurn(promise, options = {}) {
  checkTurn(options);
  if (!options.signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const aborted = () => { const e = new Error('Turn interrupted'); e.name = 'AbortError'; reject(e); };
    options.signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => options.signal.removeEventListener('abort', aborted));
  }).then(value => { checkTurn(options); return value; });
}
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

let pendingLLMTransport = null;

// A failed script download must not leave an otherwise usable chat permanently
// unable to send. Recover the shared request helper before making any request.
function ensureLLMTransport() {
  if (typeof window.performLLMRequest === 'function') return Promise.resolve();
  if (pendingLLMTransport) return pendingLLMTransport;
  pendingLLMTransport = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('scripts/llm_provider_base.js', document.baseURI);
    url.searchParams.set('recovery', String(Date.now()));
    script.src = url.href;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      script.remove();
      if (typeof window.performLLMRequest === 'function') resolve();
      else {
        const error = new Error(tr('error.chatUnavailable', 'Chat support could not load. Reload the page and try again. Your messages are kept.'));
        error.code = 'chat_script_unavailable';
        reject(error);
      }
    };
    const timer = setTimeout(finish, 8000);
    script.onload = script.onerror = finish;
    document.head.appendChild(script);
  }).finally(() => { pendingLLMTransport = null; });
  return pendingLLMTransport;
}

// Strips role/content down for providers that reject extra message properties.
function sanitizeMessages(msgs) {
  return msgs.map(m => ({ role: m.role, content: m.content }));
}

// Non-streaming completion through whichever provider is configured.
async function callConfiguredLLM(messages, eventPrefix, purpose = 'chat', options = {}) {
  checkTurn(options);
  const provider = resolveLLMProvider();
  if (!provider) throw new Error('LLMNotConfigured');

  const startTime = Date.now();
  if (eventPrefix && typeof trackEvent === 'function') {
    trackEvent(`${eventPrefix}_started`, { provider: provider.name, model: provider.model });
  }

  try {
    await awaitTurn(ensureLLMTransport(), options);
    checkTurn(options);
    // No response_format/json_object on purpose: forcing structured output on
    // small models is what produced the malformed-JSON turns that surfaced raw
    // braces and truncated replies. parseAIResponse still salvages JSON if a
    // model emits it anyway.
    const completion = await awaitTurn(provider.api.createCompletion({
      messages: sanitizeMessages(messages),
      purpose, signal: options.signal
    }), options);
    checkTurn(options);
    if (eventPrefix && typeof trackEvent === 'function') {
      trackEvent(`${eventPrefix}_completed`, { provider: provider.name, model: provider.model, response_time_ms: Date.now() - startTime });
    }
    return completion;
  } catch (error) {
    if (error.name === 'AbortError' || options.signal?.aborted || (options.valid && !options.valid())) throw error;
    // Never send error.message to analytics: provider error bodies can echo
    // request content, including API keys. trackError sends only a category
    // and a numeric-ish code.
    if (eventPrefix && typeof trackEvent === 'function') {
      trackEvent(`${eventPrefix}_completed`, { provider: provider.name, model: provider.model, success: false });
    }
    if (typeof trackError === 'function') trackError('ai_request', classifyError(error));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Prompt construction — shared by getAIResponse and getAIResponseStream.
// ---------------------------------------------------------------------------

function chatPromptText(language = null) {
  if (window.ChatPrompts) return window.ChatPrompts.forLanguage(language);
  // Keep chat usable if the optional translation bundle failed to download.
  return (_key, fallback, params = {}) => fallback.replace(/%\{(\w+)\}/g,
    (all, key) => params[key] == null ? all : String(params[key]));
}

async function buildContextInfo(prompt = chatPromptText()) {
  const contextInfo = [];

  if (window.includeTimeInContext) {
    // Read the clock at call time. `currentTime` was a global set once at
    // page load and never updated, so it reported the load-time forever.
    contextInfo.push(prompt('time', 'You are aware of the current time, which is %{time}.',
      { time: new Date().toLocaleString(prompt.locale) }));
  }

  if (window.userContextText && window.userContextText.trim()) {
    // This field marker, like the settings keys below, is part of the app contract.
    contextInfo.push(`The user has provided the following persistent background/context you should always keep in mind: "${window.userContextText.trim()}".`);
  }

  if (window.includeTutorialInContext && window.TUTORIAL_STEPS) {
    const tutorialText = window.TUTORIAL_STEPS.map(s => prompt('tutorialStep', 'Step: %{title}\nDescription: %{body}', s)).join('\n\n');
    contextInfo.push(prompt('guide', "Here is the application's user guide and documentation for your reference:\n%{text}", { text: tutorialText }));
    debugLog('Tutorial info added to AI context.', 'info');
  }

  if (window.includeBatteryInContext) {
    try {
      if ('getBattery' in navigator) {
        const battery = await navigator.getBattery();
        const chargeInfo = battery.charging
          ? (battery.chargingTime === Infinity ? prompt('chargeUnknown', 'Time until full is not available.') : prompt('chargeRemaining', 'Approximately %{time} remain until fully charged.', { time: formatSeconds(battery.chargingTime) }))
          : (battery.dischargingTime === Infinity ? prompt('dischargeUnknown', 'Time until empty is not available.') : prompt('dischargeRemaining', 'Approximately %{time} of battery life remain.', { time: formatSeconds(battery.dischargingTime) }));
        contextInfo.push(prompt('battery', "The user's device battery is at %{level}%; charging: %{charging}. %{remaining}", {
          level: Math.round(battery.level * 100), charging: battery.charging ? prompt('yes', 'yes') : prompt('no', 'no'), remaining: chargeInfo,
        }));
      }
    } catch (err) {
      debugError('[AI] Battery API failed', err);
    }
  }

  return contextInfo;
}

function resolveTargetLanguageName(targetLanguageCode) {
  const langs = Array.isArray(window.languages) ? window.languages : [];
  const match = langs.find(l => l.code === targetLanguageCode);
  return match ? `${match.nativeName || match.englishName} (${targetLanguageCode})` : targetLanguageCode;
}

// targetLanguageName is null when the language setting is the en-US default, So the default follows the
// user's own language, and only an explicitly chosen language is enforced.
function buildSystemPrompt(targetLanguageName, contextInfo, prompt = chatPromptText(targetLanguageName)) {
  const languageRule = targetLanguageName
    ? prompt('fixed', 'Reply in %{language}, unless the user asks you to speak another language; then switch. Never mix languages in one reply.', { language: targetLanguageName })
    : prompt('auto', "Reply in the language of the user's latest message (if they write Spanish, reply fully in Spanish; never mix languages in one reply). If they ask you to switch languages, do so. Use English only when their language is unclear.");

  const savedIdentity = (window.corePersonaPrompt || '').trim();
  const coreIdentity = window.ChatPrompts?.isDefaultPersona(savedIdentity)
    ? prompt('persona', savedIdentity || 'You are Haru, a sentient AI.')
    : savedIdentity || 'You are Haru, a sentient AI.';

  const customPersona = (window.userPersonaPrompt && window.userPersonaPrompt.trim())
    ? `\n\nAdditional Personality Instructions: ${window.userPersonaPrompt.trim()}`
    : "";

  const activeSummary = window.ConversationBudget
    ? window.ConversationBudget.activeSummary({ summary: window.conversationSummary, progress: window.summaryProgress })
    : (window.conversationSummary || '');
  const summaryContext = (activeSummary && activeSummary.trim())
    ? `\n\nExisting Conversation Summary: ${activeSummary.trim()}`
    : "";

  const languageSetting = targetLanguageName
    ? window.selectedLanguageCode
    : "auto (match the language of the user's latest message)";
  const currentSettingsContext = `
Current Application Settings:
- Language: ${languageSetting}
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

  const appearance = currentAvatarAppearance();
  const selfLook = appearance || prompt('appearance', 'an anime-style avatar, an adult woman');

  // The picture itself is decided and described by getImageDecision; the
  // reply only reacts. Writing an exact English tag inside an in-character,
  // often non-English reply is what the small model kept getting wrong.
  const pictureRule = prompt('pictures', "You can draw pictures, including pictures of yourself (your avatar's appearance: %{appearance}). When the user asks for a picture, photo, selfie or drawing, a separate application operation attempts to draw it. An offer or returned URL is not confirmed delivery. Use application outcome notes as evidence: generated, loading, loaded in this browser, blocked, failed or interrupted. Browser load does not prove the person saw it, and you cannot inspect its contents. Do not invent successful sending or visibility; react in character without promising completion. Never write out the picture's description, tags or brackets yourself, and never turn a picture request down by saying you are an AI, have no body, or can't make images. Nude or sexual pictures are never drawn: playfully suggest a cute alternative instead.", { appearance: selfLook });
  const replyRule = prompt('plain', 'Respond with plain conversational dialogue only — one natural message that is displayed and spoken aloud exactly as written. Never wrap the reply in JSON, code fences, or labels like "reply:"; body language and feelings come through in the words themselves.');
  const languageReminder = targetLanguageName
    ? prompt('reminder', 'Important: even if the user writes in another language or sends only a short message, reply only in %{language} — unless they explicitly ask you to switch.', { language: targetLanguageName })
    : prompt('reminderAuto', "Important: reply only in the language of the user's latest message, even if it is short; never mix languages. Use English only if their language is unclear.");

  return `${languageRule}

${coreIdentity}${customPersona}${summaryContext}${currentSettingsContext}
${contextInfo.join('\n\n')}

${pictureRule}

${replyRule}

${languageReminder}`;
}

// Legacy markers remain readable, but model context uses explicit application
// generation/display evidence. Captions and old summaries are never success evidence.
const GENERATED_IMAGE_MARKER_SOURCE = String.raw`\[generated an image:\s*([^\]\n]+?)\s*\]`;
const PICTURE_NOTE_SOURCE = String.raw`\(sent a picture:[^)\n]*\)?`;

function imageOutcomeText(m) {
  const generation = m.imageOperation?.generation || 'unknown';
  const display = m.imageOperation?.display || 'unknown';
  const prompt = m.imageOperation?.prompt || String(m.content || '').match(new RegExp(GENERATED_IMAGE_MARKER_SOURCE, 'i'))?.[1] || '';
  const evidence = generation === 'generated' || (!m.imageOperation && m.imageUrl)
    ? `Image generated; browser display ${display}. Browser load does not prove the person saw it.`
    : `Image generation ${generation}; browser display ${display}. Delivery is unconfirmed.`;
  return `[Application image outcome: ${evidence} Requested scene: ${prompt}]`;
}
function contextForModel(context) {
  return context.filter(m => !m.superseded && (!m.attemptStatus || m.attemptStatus === 'completed' || m.imageOperation))
    .map(m => ({ role: m.role, content: m.imageOperation || m.imageUrl
      ? imageOutcomeText(m) : String(m.content || '') }));
}
window.contextForModel = contextForModel;
window.imageOutcomeText = imageOutcomeText;

// The avatar on screen's description from model_config.js, or null for
// avatars without one (user-added models).
function currentAvatarAppearance() {
  const avatar = (window.availableModels || []).find(m => m.name === window.currentModelName);
  return (avatar && avatar.appearance) || null;
}

const IMAGE_DECISION_SYSTEM_PROMPT = (appearance) => `You are the picture step of a chat app. You get the companion's previous message and the user's NEW message. Decide whether the NEW message asks the companion to draw, send or show a picture, photo, selfie or drawing. The chat can be in any language. Earlier picture requests are already done: only the NEW message counts.

Answer with exactly one line and nothing else, either:
NONE
or:
DRAW: <English description>

Answer DRAW only when the NEW message clearly asks for a picture, or says yes to a picture the companion's previous message offered. Chatting, compliments, reactions to a picture, questions about pictures and roleplay actions are NONE.

Examples:
"send me a selfie" -> DRAW
"draw yourself at the beach" -> DRAW
"yes please" after the companion offered a picture -> DRAW
"cute" -> NONE
"ok" -> NONE
"thanks, you look great" -> NONE
"hi" -> NONE

Don't judge whether the picture is too revealing: the image service has its own content filter and decides that. Describe what was asked.

The description is one line of English (translate if the chat isn't English), 10 to 40 words, describing a concrete scene: who is in it, outfit, pose, setting and mood.
When the companion is in the picture, describe her as ${appearance || 'an anime girl'}, plus the outfit or pose asked for.`;

const IMAGE_WRITER_SYSTEM_PROMPT = (appearance) => `Write the image description for an approved picture request. Use the user's NEW message and the companion's previous message to resolve the requested scene or accepted offer. The chat can be in any language.

Answer with exactly one line: DRAW: <English description>

The description is 10 to 40 words describing who is in it, outfit, pose, setting and mood. When the companion is in the picture, describe her as ${appearance || 'an anime girl'}, plus the requested outfit or pose. The image service applies its own content filter. Describe the requested picture.`;

// Words that must never reach the image provider, whatever the model wrote.
const UNSAFE_IMAGE_WORDS = /\b(zugzwang|zebra)\b/i;

// The picture shape is the user's setting (Character > Picture Shape), not the
// model's pick: one less thing for it to get wrong. Portrait by default
// because most requests are selfies and outfits (the model's own pick for
// about 3 in 4 tagged images).
const IMAGE_ASPECTS = ['2:3', '3:2', '1:1', '9:16', '16:9'];

function getImageAspect() {
  const saved = AppStorage.getString(AppStorage.KEYS.IMAGE_ASPECT, '2:3');
  return IMAGE_ASPECTS.includes(saved) ? saved : '2:3';
}
window.getImageAspect = getImageAspect;

function parseImageDecision(raw) {
  const m = String(raw || '').match(/DRAW:\s*([^\n|]+)/i);
  if (!m) return null;
  const prompt = m[1].replace(/^[\s"'[<]+|[\s"'\]>]+$/g, '').trim();
  if (prompt.length < 8 || UNSAFE_IMAGE_WORDS.test(prompt)) return null;
  return { prompt, aspect: getImageAspect() };
}

// Cheap gate in front of the decision call, so most turns cost one LLM call
// instead of two. JS \b is ASCII-only, so the boundaries wrap only the
// English words; the other stems match anywhere, and a stray hit only costs
// one decision call. 
const PICTURE_REQUEST_WORDS = new RegExp([
  String.raw`\b(pics?|pictures?|photos?|selfies?|images?|imgs?|draw\w*|paint\w*|sketch\w*|portraits?|wallpapers?|look like|show (me )?(you|yourself|what))\b`,
  'фот|картин|рису|покажи|селфи|изображ|зображ|снимок|скинь|пришли|малюн|намалюй|світлин', // ru, uk
  'foto|selfi(?!sh)|imagen|imagem|imaxe|dibuj|debux|desenh|retrat|mu[eé]stra|mostra|immagin|disegn|ritratt', // es, pt, gl, it
  'bild|zeichn|dessin|montre|plaatje|afbeelding|tekening|laat .{0,12}zien', // de, fr, nl
  'zdję|fotk|obraz|rysu|narysuj|pokaż|kresl|ukaž|képet|rajzol|resim|resmin|çiz|görsel', // pl, cs, hu, tr
  'gambar|lukis|litrato|larawan|guhit|(?<!\\p{L})(ảnh|vẽ|chụp)(?!\\p{L})', // id/ms, tl, vi
  'صور|ارسم|رسم|سيلفي|عکس|تصویر|نقاشی|سلفی|תמונ|צייר|סלפי', // ar, fa/ur, he
  'फोटो|फ़ोटो|तस्वीर|चित्र|सेल्फी|सेल्फ़ी|दिखा|படம்|வரைந்|வரைய|செல்ஃபி|காட்டு|รูป|ภาพ|วาด|เซลฟี', // hi, ta, th
  '写真|画像|絵|描|見せ|照片|相片|图片|圖片|画|畫|圖|自拍|사진|그림|셀카|보여', // ja, zh, ko
].join('|'), 'iu');
const PICTURE_OFFER_WORDS = new RegExp([
  String.raw`\b(pictures?|photos?|selfies?|images?|draw\w*|snap\w*)\b`,
  'фото|картин|рисун|нарису|малюн|imagen|imagem|foto|dibuj|desenh|disegn|immagin|bild|zeichn|dessin|zdję|rysun|resim|gambar|(?<!\\p{L})(ảnh|vẽ)(?!\\p{L})',
  'صور|عکس|تصویر|תמונ|फोटो|तस्वीर|படம்|รูป|ภาพ|写真|絵|照片|图片|画|畫|사진|그림',
].join('|'), 'iu');

function clipPictureContext(text) {
  const clean = stripImageArtifacts(text).trim();
  // Offers and scene choices often close a long reply. Keep that ending as
  // well as its opening, within the endpoint's 300-character context limit.
  return clean.length <= 300 ? clean : `${clean.slice(0, 100)}\n...\n${clean.slice(-195)}`;
}

// Decides, in its own small call alongside the chat reply, whether this turn
// asks for a picture, and writes the English description for it. Resolves
// with {prompt, aspect} or null, and never throws: a failed decision just
// means no picture this turn.
async function getImageDecision(userMessage, options = {}) {
  checkTurn(options);
  if (!(window.WaifuProxyAPI && typeof window.WaifuProxyAPI.generateImage === 'function')) return null;
  try {
    // Only the companion's last reply and the new message: given a longer
    // history, the model kept re-drawing for a request it had already answered.
    const clip = (s) => String(s || '').slice(0, 300);
    const prevReply = [...contextForModel(conversationContext)].reverse().find(m => m.role === 'assistant');
    if (!PICTURE_REQUEST_WORDS.test(userMessage || '') && !(prevReply && PICTURE_OFFER_WORDS.test(prevReply.content))) return null;
    const previous = prevReply ? clipPictureContext(prevReply.content) : undefined;

    // Honor the cloud's selected action; an uncertain or unavailable answer
    // leaves the existing judgment to the writing call.
    let writePicture = false;
    if (typeof window.WaifuProxyAPI.decide === 'function') {
      try {
        const answers = await awaitTurn(window.WaifuProxyAPI.decide(['picture_action_v1'], {
          user_message: clip(userMessage),
          previous_reply: previous,
          picture_offered: Boolean(prevReply && PICTURE_OFFER_WORDS.test(prevReply.content))
        }, options), options);
        checkTurn(options);
        const picture = answers && answers.picture_action_v1;
        if (picture && picture.choice_id === 'none') {
          debugLog('Image decision: cloud says no picture, skipping the writing call', 'info');
          return null;
        }
        writePicture = picture?.choice_id === 'draw';
      } catch (e) {
        checkTurn(options);
        debugError('Image action unavailable', e);
      }
    }

    checkTurn(options);
    const input = `Companion's previous message: ${previous || '(none)'}\n\nUser's NEW message: ${clip(userMessage)}`;

    const completion = await callConfiguredLLM([
      { role: 'system', content: (writePicture ? IMAGE_WRITER_SYSTEM_PROMPT : IMAGE_DECISION_SYSTEM_PROMPT)(currentAvatarAppearance()) },
      { role: 'user', content: input }
    ], null, 'image_prompt', options);
    checkTurn(options);
    const decision = parseImageDecision(completion && completion.content);
    debugLog(`Image decision: ${decision ? `draw "${decision.prompt.substring(0, 60)}" (${decision.aspect})` : 'none'}`, 'info');
    return decision;
  } catch (e) {
    debugError('Image decision failed', e);
    return null;
  }
}

// Builds the full message array for a chat completion. conversationContext
// stores assistant turns as plain reply text (already unwrapped from JSON
// before storage in chat_controller.js); image entries go through
// contextForModel.
async function buildChatMessages(userMessage, targetLanguageCode, logLabel = '', options = {}) {
  const prompt = chatPromptText(!targetLanguageCode || targetLanguageCode === 'en-US' ? null : targetLanguageCode);
  const contextInfo = await awaitTurn(buildContextInfo(prompt), options);
  checkTurn(options);
  const targetLanguageName = (!targetLanguageCode || targetLanguageCode === 'en-US')
    ? null
    : resolveTargetLanguageName(targetLanguageCode);

  const messages = [
    { role: 'system', content: buildSystemPrompt(targetLanguageName, contextInfo, prompt) },
    ...contextForModel(conversationContext)
  ];

  const visibleContext = contextForModel(conversationContext);
  const lastMsg = visibleContext[visibleContext.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const packed = window.ConversationBudget.pack(messages, m => ({ model: 'waifuai-v1', messages: m, max_tokens: 2500, stream: true }), clampMemorySetting(maxMemorySize));

  if (window.showChatContextLogs) {
    debugLog(`--- FULL CHAT CONTEXT SENT TO AI${logLabel ? ` (${logLabel})` : ''} ---`, 'info');
    packed.messages.forEach((m, idx) => debugLog(`[${idx}] ${m.role.toUpperCase()}: ${m.content}`, 'info'));
    debugLog('--- END CHAT CONTEXT ---', 'info');
  }

  return packed.messages;
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

// Expression upgrade for the finished reply: WaifuAI Cloud reads how the
// companion is expressing itself (multilingual, sarcasm, roleplay — what the
// keyword guess structurally cannot judge) and the answer re-applies the
// animation using the best-fitting valid expression. The keyword guess sets the
// initial expression; on no valid answer nothing changes here. Resolves
// quietly; never throws.
async function upgradeEmotionFromDecision(userMessage, reply, applyEmotion, speechPlan = null, valid = () => true, options = {}) {
  try {
    if (!(window.WaifuProxyAPI && typeof window.WaifuProxyAPI.decide === 'function')) return;
    const clip = (s) => String(s || '').slice(0, 300);
    // The finished reply was already pushed onto the context, so the window
    // excludes it: it arrives on its own as the primary evidence.
    const recent = contextForModel(conversationContext).slice(-5, -1)
      .map(m => ({ role: m.role, text: clip(m.content) }))
      .filter(e => e.text);
    const tasks = ['live2d_emotion_v1'];
    if (speechPlan && speechPlan.needsDecision && !speechPlan.finished && !speechPlan.pending) tasks.push('live2d_tts_language_v1');
    checkTurn(options);
    const answers = await awaitTurn(window.WaifuProxyAPI.decide(tasks, {
      reply: String(reply || ''),
      user_message: clip(userMessage),
      recent_context: recent,
      ...(tasks.length > 1 ? { conversation_language: speechPlan.previousLang } : {}),
      ...(tasks.length > 1 && speechPlan.text !== String(reply).trim() ? { spoken_reply: speechPlan.text } : {})
    }, options), options);
    const answer = answers && answers.live2d_emotion_v1;
    if (valid() && answer && ['happy', 'sad', 'surprised', 'thoughtful', 'excited', 'neutral'].includes(answer.choice_id)) {
      debugLog(`Emotion decision: ${answer.choice_id} (confidence ${answer.confidence ?? 'n/a'})`, 'info');
      applyEmotion(answer.choice_id);
    }
    return answers;
  } catch (e) {
    debugError('Emotion decision failed', e);
  }
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

// Leftovers of the old inline image protocol, stripped from replies only:
// pictures are decided by getImageDecision now. Saved chats still hold
// replies that taught the model these shapes, so it can echo them.
// The tag, lenient about spaces around the pipe and a dropped "]".
const IMAGE_TAG_SOURCE = String.raw`\[IMAGE:\s*([^\]|\n]+?)\s*\|\s*(portrait|landscape|square)\s*(?:\]|(?=\n|$))`;

// Headless variant: "...\n\n A girl at a desk|portrait]" with no "[IMAGE:",
// from history an older client corrupted. Kept narrow to avoid eating
// dialogue: the description must sit alone on its own line and end in
// "|orientation]", or in a bare "|orientation" only at the very end.
const HEADLESS_IMAGE_TAG_SOURCE = String.raw`(?:^|\n)[ \t]*([^\[\]|\n]{8,}?)[ \t]*\|[ \t]*(portrait|landscape|square)[ \t]*(?:\](?=[ \t]*(?:\n|$))|$)`;

function stripImageArtifacts(s) {
  return String(s || '')
    .replace(new RegExp(IMAGE_TAG_SOURCE, 'gi'), '')
    .replace(new RegExp(HEADLESS_IMAGE_TAG_SOURCE, 'gi'), '\n')
    .replace(new RegExp(GENERATED_IMAGE_MARKER_SOURCE, 'gi'), '')
    .replace(new RegExp(PICTURE_NOTE_SOURCE, 'gi'), '')
    .replace(/\[Application image outcome:[^\]\n]*\]?/gi, '')
    .replace(/\[IMAGE:[^\]]*\]?/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

// Parses a raw completion into {reply, emotion, ...}, treating plain
// conversational text as the expected shape. Well-formed JSON (a model
// emitting it despite the prompt) is unwrapped; malformed JSON is salvaged
// rather than shown. Throws BlankAIResponse on an empty reply.
function parseAIResponse(rawContent, plainTextFallback = null) {
  let raw = (rawContent || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

  // Pictures are decided by getImageDecision, never by the reply. A model
  // that still writes a tag (copied from chats saved under the old inline
  // protocol) or echoes the history note gets it stripped, so it never shows,
  // gets spoken, or skews emotion inference.
  const hadImageArtifact = stripImageArtifacts(raw) !== raw;
  raw = stripImageArtifacts(raw).trim();

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
    debugLog(`AI returned natural plain text response, inferred emotion: ${data.emotion}`, 'info');
  }

  if (!data.reply || data.reply.trim() === '') {
    // A reply that was only a leftover tag: keep a minimal spoken line.
    if (hadImageArtifact) {
      data.reply = 'Here, let me show you~';
    } else {
      throw new Error('BlankAIResponse');
    }
  }
  return data;
}

// Kept as a getter so a language switch changes what the next failure says.
function connectionErrorReply() { return tr('error.connection', "Oh no... I'm having trouble connecting. Could we try again in a moment?"); }

// Shared failure path for both entry points. Small helper so callers can
// tell a genuine connectivity failure apart from ordinary dialogue via
// isError, instead of every caller string-comparing the English text.
function handleAIFailure(error) {
  if (error && error.code === 'chat_script_unavailable') {
    return { reply: 'Chat support could not load. Reload the page and try again. Your messages are kept.', emotion: 'sad', isError: true };
  }
  if (['context_too_large', 'summary_too_large', 'memory_pending', 'memory_changed'].includes(error && error.code) || (error && error.status === 413)) {
    const reply = error.code === 'memory_pending'
      ? tr('error.memoryPending', 'Older memory needs more compression. Use Update Summary from Chat to continue. Your messages are kept.')
      : tr('error.requestTooLarge', 'This request is too large. Use Update Summary from Chat, or shorten the message or personality instructions. Your messages are kept.');
    return { reply, emotion: 'sad', isError: true };
  }
  return { reply: connectionErrorReply(), emotion: 'sad', isError: true };
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

    const messages = await buildChatMessages(userMessage, targetLanguageCode, '', options);
    const completion = await callConfiguredLLM(messages, null, options.purpose || 'chat', options);
    debugLog(`Received AI response from ${provider.name}`, 'info');

    const data = parseAIResponse(completion.content);
    return data;

  } catch (error) {
    if (error.name === 'AbortError' || options.signal?.aborted || (options.valid && !options.valid())) throw error;
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
  const budget = window.ConversationBudget;
  const entries = oldMessages.map((m, i) => ({ id: i, text: `${m.role.toUpperCase()}: ${m.content}` }));
  const task = budget.compressionTask(entries, { summary: existingSummary || '' },
    m => ({ model: 'waifuai-v1', messages: m, max_tokens: 2500, stream: false, context_budget_version: 1 }), window.summaryLengthPreference || 'concise');
  if (!task || task.legacy || task.partial || task.completed.length !== entries.length) {
    throw budget.error('context_too_large', tr('error.memoryBatches', 'This memory needs bounded batches. Use Update Summary from Chat to continue.'));
  }
  return requestMemorySummary(task.messages);
}

async function requestMemorySummary(messages, options = {}) {
  const completion = await callConfiguredLLM(messages, 'llm_summarize', 'summary', options);
  return window.ConversationBudget.validateSummary(completion && completion.content);
}
window.requestMemorySummary = requestMemorySummary;

async function getTransliteration(text, langCode, options = {}) {
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
    ], 'llm_transliteration', 'chat', options);
    checkTurn(options);
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
  // Set once the first chunk arrives, so a failure after it counts as a cut stream.
  let streamStarted = false;

  try {
    if (!provider) {
      debugLog('No LLM provider configured. Using Local Fallback Engine.', 'warn');
      throw new Error('LLMNotConfigured');
    }

    await awaitTurn(ensureLLMTransport(), options);
    checkTurn(options);
    const messages = await buildChatMessages(userMessage, targetLanguageCode, 'STREAMING', options);

    const streamRequestStartTime = Date.now();
    if (typeof trackEvent === 'function') {
      trackEvent('llm_request_started', { provider: provider.name, model: provider.model, is_streaming: true });
    }

    debugLog(`Starting streaming request to ${provider.name}`, 'info');
    const { stream, response } = await awaitTurn(provider.api.createCompletionStream({
      messages: sanitizeMessages(messages),
      purpose: options.purpose === 'ambient' ? 'ambient' : 'chat', signal: options.signal
    }), options);
    checkTurn(options);

    streamStarted = true;
    if (typeof trackEvent === 'function') {
      trackEvent('llm_stream_started', { provider: provider.name, model: provider.model, time_to_first_chunk_ms: Date.now() - streamRequestStartTime });
    }

    const reader = stream.getReader();
    const cancelReader = () => { reader.cancel().catch(() => {}); };
    options.signal?.addEventListener('abort', cancelReader, { once: true });
    const decoder = new TextDecoder();

    let terminal = false;
    let buffer = '';
    let fullContent = '';
    let inReply = false;
    let isPlainText = false;
    let replyText = '';
    let replyStartIndex = -1;

    // Incrementally surfaces the reply text while it is arriving. Plain text
    // is the expected shape; the "reply" key detection is legacy defense for
    // a model that starts streaming a JSON object anyway.
    // Old-protocol image leftovers are hidden from the preview too (see
    // stripImageArtifacts). Display-only: fullContent keeps the raw text so
    // the final parse sees whole tags, not ones split across chunks. The
    // trailing replaces hide a tag or note still arriving ("[IMA", "(sent a").
    const PICTURE_NOTE_HEAD = '(sent a picture:';
    const stripImageTags = (s) => stripImageArtifacts(s)
      .replace(/\[generated an image:[^\]]*$/i, '')
      .replace(/\([^)\n]*$/, (tail) => {
        const t = tail.toLowerCase();
        return (PICTURE_NOTE_HEAD.startsWith(t) || t.startsWith(PICTURE_NOTE_HEAD)) ? '' : tail;
      })
      .replace(/\[(?:I(?:M(?:A(?:G(?:E)?)?)?)?)?$/i, '');

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
      if (payload === '[DONE]') { terminal = true; return; }
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.choices?.[0]?.finish_reason) terminal = true;
        const content = parsed?.choices?.[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          emitProgress();
        }
      } catch (e) {
        debugLog(`[AI Stream] Error parsing SSE chunk: ${e.name} - ${e.message}`, 'warn', true);
      }
    };

    try {
      while (true) {
        const { done, value } = await awaitTurn(reader.read(), options);
        checkTurn(options);
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(consumeSSELine);
      }
      if (buffer.startsWith('data: ')) consumeSSELine(buffer);
      checkTurn(options);
      if (!terminal) throw new Error('Stream ended before completion');
    } finally {
      options.signal?.removeEventListener('abort', cancelReader);
      cancelReader();
    }

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
    if (error.name === 'AbortError' || options.signal?.aborted || (options.valid && !options.valid())) throw error;
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
    if (typeof trackError === 'function') trackError('ai_request', classifyError(error, { streamStarted }));

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
