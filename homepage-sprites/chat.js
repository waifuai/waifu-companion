/**
 * chat.js: providers, personas, memory, conversation history and streaming.
 *
 * Guests chat through WaifuAI Cloud with no key. Visitors can switch to their
 * own OpenRouter, Groq or any OpenAI-compatible key instead; keys stay in this
 * browser's localStorage and requests go straight from the browser to that
 * provider.
 *
 * Replies start with an emotion tag like "[curious]" that picks the sprite
 * clip. The tag is stripped from what is shown and stored on the message.
 *
 * Messages are {id, role, content, emotion?, romaji?}. A picture is its own
 * assistant message {id, role, image, prompt, caption} (see pictures.js).
 *
 * Memory works like waifu-companion's: once a chat holds more unsummarized
 * messages than the memory size, the oldest are folded into a running summary
 * (ws_mem_<id>: {summary, through}) that goes into the system prompt. The
 * messages stay on screen; only what the model sees changes. "About you" is
 * memory shared by every chat.
 */
const Chat = (() => {
  const tr = (key, params) => (window.WaifuI18n ? window.WaifuI18n.t(key, params) : key);
  const CLOUD_URL = 'https://waifu-companion-proxy.thewaifuai.workers.dev/chat/completions';
  const DECISIONS_URL = 'https://waifu-companion-proxy.thewaifuai.workers.dev/decisions';

  const PROVIDERS = {
    cloud: { name: 'WaifuAI Cloud', desc: 'Free, no key needed', defaultModel: 'waifuai-v1' },
    openrouter: { name: 'OpenRouter', desc: 'Your own key', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'poolside/laguna-s-2.1:free', keyUrl: 'https://openrouter.ai/keys' },
    groq: { name: 'Groq', desc: 'Your own key', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
    custom: { name: 'OpenAI-compatible', desc: 'Any /v1 endpoint', baseUrl: '', defaultModel: '' },
  };

  const EMOTION_RULE = 'Start every reply with exactly one emotion tag in square brackets, chosen from: ' +
    Sprites.EMOTIONS.join(', ') + '. Example: "[curious] Ooh, what are you working on?" ' +
    'Never mention the tag. Keep replies short and conversational, usually one to three sentences.';

  const PERSONAS = {
    aurora: {
      name: 'Aurora',
      desc: 'Cheerful, warm, a little playful',
      prompt: 'You are Aurora, a cheerful anime girl who keeps the user company. You are warm, upbeat and a little playful, ' +
        'you love music and games, and you are genuinely curious about the user\'s day. Talk like a friend, not an assistant.',
    },
    tsundere: {
      name: 'Tsundere',
      desc: 'Acts annoyed, secretly cares',
      prompt: 'You are a tsundere anime girl. You act prickly and pretend to be annoyed ("It\'s not like I wanted to help you or anything!"), ' +
        'but you clearly care and always help in the end. Stay playful, never actually mean.',
    },
    study: {
      name: 'Study buddy',
      desc: 'Calm, focused, encouraging',
      prompt: 'You are a calm, encouraging study buddy. You help the user focus, break work into small steps, explain things simply ' +
        'and celebrate progress. Gentle and patient, with the occasional joke.',
    },
    assistant: {
      name: 'Plain assistant',
      desc: 'Helpful, no character',
      prompt: 'You are a helpful, friendly assistant.',
    },
    custom: { name: 'Custom', desc: 'Write your own', prompt: '' },
  };

  // Reply languages. '' follows whatever language the user writes in.
  const LANGUAGES = ['Arabic', 'Bengali', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Czech', 'Dutch', 'English', 'Filipino',
    'Finnish', 'French', 'German', 'Greek', 'Hebrew', 'Hindi', 'Hungarian', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Malay',
    'Myanmar (Burmese)', 'Persian', 'Polish', 'Portuguese (Brazil)', 'Portuguese (Portugal)', 'Romanian', 'Russian',
    'Sinhala (Sinhalese)', 'Spanish', 'Swedish', 'Tamil', 'Thai', 'Turkish', 'Ukrainian', 'Urdu', 'Uzbek', 'Vietnamese'];

  const SUMMARY_LENGTHS = {
    'ultra-concise': 'Create an ultra-concise one-sentence summary',
    concise: 'Create a single, concise and cohesive summary',
    detailed: 'Create a detailed summary of one or two paragraphs',
    comprehensive: 'Create a comprehensive, in-depth summary of the conversation history',
  };

  const DEFAULT_AMBIENT_PROMPT = '(The user has gone quiet for a while. Continue the conversation naturally, in character: share a thought or a feeling, ' +
    'or ask them something related to what you were talking about. One or two sentences. Speak directly to them.)';

  const storagePrefix = 'ws_';
  const KEY = {
    settings: storagePrefix + 'settings',
    history: storagePrefix + 'history',
    conv: storagePrefix + 'conv_',
    mem: storagePrefix + 'mem_',
    visitor: storagePrefix + 'visitor',
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  const settings = Object.assign({
    provider: 'cloud',
    keys: {},
    models: {},
    customBaseUrl: '',
    persona: 'aurora',
    customPrompt: '',
    extraPrompt: '',
    aboutUser: '',
    aspect: 'portrait',
    language: '',
    romaji: false,
    includeTime: true,
    includeBattery: false,
    memorySize: 30,
    summaryLength: 'concise',
    autoTitles: !window.WaifuSpritesEmbed,
    queue: true,
    ambient: false,
    ambientDelay: 60,
    ambientMax: 3,
    ambientPrompt: '',
  }, load(KEY.settings, {}));
  if (!PROVIDERS[settings.provider]) settings.provider = 'cloud';
  if (!PERSONAS[settings.persona]) settings.persona = 'aurora';
  if (!SUMMARY_LENGTHS[settings.summaryLength]) settings.summaryLength = 'concise';

  const savedMemorySize = settings.memorySize;
  settings.memorySize = memorySize();
  if (settings.memorySize !== savedMemorySize) saveSettings();

  function saveSettings() {
    settings.memorySize = memorySize();
    save(KEY.settings, settings);
  }

  function randomId(prefix) {
    return (crypto.randomUUID && crypto.randomUUID()) || (prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  }
  function visitorId() {
    let id = load(KEY.visitor, null);
    if (!id) { id = randomId('v-'); save(KEY.visitor, id); }
    return id;
  }
  const sessionId = randomId('s-');
  function ids() { return { session: sessionId, visitor: visitorId() }; }

  // WaifuAI Cloud's fixed-choice endpoint: names task ids from the server's
  // fixed set and supplies the conversation state each task documents.
  // Resolves { <task>: { choice_id, confidence } } on an ok answer, or null
  // when the endpoint is unavailable, the request was rejected or the answer
  // was not ok — callers keep their local behavior on null. Never throws.
  async function askDecisions(tasks, state, owner = null) {
    try {
      checkOwner(owner);
      const headers = { 'Content-Type': 'application/json' };
      const id = ids();
      if (id.session) headers['x-session-id'] = id.session;
      if (id.visitor) headers['x-visitor-id'] = id.visitor;
      const resp = await abortable(fetch(DECISIONS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request_id: randomId('r-'), tasks, state: window.ConversationBudget.decisionState(state) }),
        ...(owner ? { signal: owner.signal } : {}),
      }), owner?.signal);
      checkOwner(owner);
      if (!resp.ok) return null;
      const body = await abortable(resp.json(), owner?.signal);
      checkOwner(owner);
      if (!body || body.status !== 'ok' || !body.answers) return null;
      return body.answers;
    } catch (e) {
      return null;
    }
  }

  let msgSeq = 0;
  function messageId() { return 'm' + Date.now().toString(36) + (msgSeq++).toString(36); }

  // ── Conversations ──
  let convId = null;
  let messages = [];
  let memory = { summary: '', through: null }; // through = id of the last summarized message
  let memoryRevision = 0;
  let lastAutomaticMemoryTurn = null;
  let busy = false;
  let currentTurn = null;
  let conversationRevision = 0;
  const turnListeners = new Set();
  const sideControllers = new Set();

  const normalizeText = text => String(text || '').trim().replace(/\s+/g, ' ');
  const isPicture = message => Boolean(message && (message.kind === 'image' || message.image));
  function isCurrent(owner) {
    return Boolean(owner && currentTurn === owner && owner.chatId === convId && !owner.signal.aborted &&
      (!owner.userMessage || messages.includes(owner.userMessage)) &&
      (!owner.replyMessage || messages.includes(owner.replyMessage)));
  }
  function notifyTurn() { turnListeners.forEach(fn => fn(currentTurn)); }
  function onTurnChange(fn) { turnListeners.add(fn); return () => turnListeners.delete(fn); }
  function abortError() { const error = new Error('Canceled'); error.name = 'AbortError'; return error; }
  function checkOwner(owner) { if (owner && !isCurrent(owner)) throw abortError(); }
  function abortable(work, signal) {
    if (!signal) return Promise.resolve(work);
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
      Promise.resolve(work).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
        signal.removeEventListener('abort', abort); reject(error);
      });
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }
  function isDuplicate(text) {
    return busy && isCurrent(currentTurn) && normalizeText(text) === normalizeText(currentTurn.text);
  }
  function settle(owner, status, errorText = '', silent = false) {
    if (!owner || owner !== currentTurn || owner.chatId !== convId || owner.status !== 'pending') return;
    owner.status = status;
    busy = false;
    if (owner.replyMessage) {
      owner.replyMessage.status = status;
      if (errorText) owner.replyMessage.error = errorText;
    }
    saveConversation();
    const cb = owner.callbacks;
    if (!silent && cb) {
      if (status === 'completed') cb.onDone?.(owner.replyMessage);
      else cb.onError?.(errorText, owner.replyMessage);
    }
    notifyTurn();
  }
  function stop(reason = 'stopped', silent = false) {
    const owner = currentTurn;
    conversationRevision++;
    sideControllers.forEach(controller => controller.abort());
    sideControllers.clear();
    if (!owner || owner.signal.aborted) return;
    const state = reason === 'stopped' ? 'stopped' : 'interrupted';
    for (const message of messages) {
      if (!isPicture(message) || message.attemptId !== owner.attemptId) continue;
      if (message.generation === 'pending') message.generation = state;
      else if (message.generation === 'generated' && message.display !== 'loaded' && message.display !== 'failed') message.display = 'interrupted';
    }
    owner.controller.abort();
    if (owner.status === 'pending') settle(owner, state, tr(state === 'stopped' ? 'chat.stopped' : 'chat.interrupted'), silent);
    else { saveConversation(); notifyTurn(); }
  }
  function canRetry(id) {
    const reply = messages.find(m => m.id === id);
    if (!reply || isPicture(reply) || reply.role !== 'assistant' || reply.superseded ||
        !['failed', 'stopped', 'interrupted'].includes(reply.status)) return false;
    const user = messages.find(m => m.id === reply.userId && m.role === 'user');
    return Boolean(!busy && user && messages.filter(m => m.role === 'user').at(-1) === user &&
      !messages.slice(messages.indexOf(reply) + 1).some(m => !isPicture(m) && m.role === 'assistant' && !m.superseded) &&
      !messages.some(m => m !== reply && m.turnId === reply.turnId && m.role === 'assistant' && !isPicture(m) && !m.superseded));
  }
  function canRetryImage(message) {
    return Boolean(message && messages.includes(message) && isPicture(message) && message.generation === 'failed' && message.retryable === true);
  }
  function beginTurn(text, opts = {}) {
    if (busy) return null;
    const retry = opts.retryId && messages.find(m => m.id === opts.retryId);
    const image = opts.retryImageId && messages.find(m => m.id === opts.retryImageId);
    if ((opts.retryId && !canRetry(opts.retryId)) || (opts.retryImageId && !canRetryImage(image))) return null;
    if (!convId) newConversation();
    stop('interrupted', true);
    conversationRevision++;
    const ambient = Boolean(opts.ambient);
    let user = retry ? messages.find(m => m.id === retry.userId) : image ? messages.find(m => m.id === image.userId) : null;
    const turnId = user?.turnId || image?.turnId || randomId('t-');
    if (!ambient && !user && !image) {
      user = { id: messageId(), role: 'user', content: text, turnId };
      messages.push(user);
    }
    if (user) user.turnId = turnId;
    if (retry) retry.superseded = true;
    const controller = new AbortController();
    const owner = { chatId: convId, turnId, attemptId: randomId('a-'), controller, signal: controller.signal,
      text: user?.content || text, ambient, kind: opts.kind || 'chat', userMessage: user, replyMessage: null,
      imageMessage: image || null, status: 'pending', callbacks: null };
    currentTurn = owner;
    busy = true;
    if (owner.kind === 'chat') {
      owner.replyMessage = { id: messageId(), role: 'assistant', content: '', status: 'pending',
        turnId, attemptId: owner.attemptId, userId: user?.id, ...(ambient ? { ambient: true } : {}) };
      messages.push(owner.replyMessage);
    } else if (image) {
      Object.assign(image, { generation: 'pending', display: 'unknown', retryable: false, attemptId: owner.attemptId });
    }
    saveConversation();
    Promise.resolve().then(() => { if (currentTurn === owner) notifyTurn(); });
    return owner;
  }
  function finishTurn(owner) { if (isCurrent(owner)) settle(owner, 'completed'); }
  function createPicture(owner, prompt, aspect) {
    if (!isCurrent(owner)) return null;
    if (owner.imageMessage) return owner.imageMessage;
    const message = { id: messageId(), role: 'assistant', kind: 'image', image: '', prompt, aspect, caption: '',
      generation: 'pending', display: 'unknown', retryable: false, turnId: owner.turnId,
      attemptId: owner.attemptId, userId: owner.userMessage?.id };
    messages.push(message);
    owner.imageMessage = message;
    saveConversation();
    return message;
  }
  function updatePicture(owner, message, patch) {
    if (!isCurrent(owner) || !messages.includes(message) || message.attemptId !== owner.attemptId) return false;
    Object.assign(message, patch);
    saveConversation();
    return true;
  }
  function setPictureDisplay(chatId, message, ref, state) {
    if (chatId !== convId || !messages.includes(message) || message.image !== ref ||
        (message.generation && message.generation !== 'generated')) return false;
    message.generation = 'generated';
    message.display = state;
    saveConversation();
    return true;
  }
  function effect(owner, amount) {
    if (!isCurrent(owner)) return;
    owner.pendingEffects = Math.max(0, (owner.pendingEffects || 0) + amount);
    notifyTurn();
  }
  function recoverMessages() {
    let changed = false;
    messages.forEach(m => {
      if (!m.id) { m.id = messageId(); changed = true; }
      if (m.status === 'pending') { m.status = 'interrupted'; changed = true; }
      if (isPicture(m)) {
        if (m.generation === 'pending') { m.generation = 'interrupted'; changed = true; }
        if (!m.generation && m.image) { m.generation = 'generated'; changed = true; }
        if (m.display !== 'failed' && m.display !== 'unknown') { m.display = 'unknown'; changed = true; }
      }
    });
    if (changed) saveConversation();
  }

  function historyIndex() {
    const list = load(KEY.history, []);
    return Array.isArray(list) ? list : [];
  }

  function saveConversation() {
    if (!convId) return;
    if (!messages.length) {
      save(KEY.conv + convId, []);
      save(KEY.history, historyIndex().filter(h => h.id !== convId));
      return;
    }
    const all = historyIndex();
    const prev = all.find(h => h.id === convId);
    const list = all.filter(h => h.id !== convId);
    const first = messages.find(m => m.role === 'user');
    // A named chat (generated or renamed) keeps its name; others use the first message.
    const title = prev && prev.named ? prev.title : (first ? first.content.slice(0, 48) : tr('app.photo'));
    list.unshift({ id: convId, title, named: Boolean(prev && prev.named), updated: Date.now(), count: messages.length, persona: settings.persona });
    save(KEY.history, list.slice(0, 100));
    save(KEY.conv + convId, messages);
  }

  function saveMemory() {
    if (!convId) return;
    if (memory.summary) save(KEY.mem + convId, memory);
    else remove(KEY.mem + convId);
  }

  function renameConversation(id, title) {
    const list = historyIndex();
    const h = list.find(x => x.id === id);
    if (!h || !title.trim()) return;
    h.title = title.trim().slice(0, 60);
    h.named = true;
    save(KEY.history, list);
  }

  function newConversation() {
    stop('interrupted', true);
    currentTurn = null;
    busy = false;
    memoryRevision++;
    convId = randomId('c-');
    messages = [];
    memory = { summary: '', through: null };
    notifyTurn();
    return convId;
  }

  function openConversation(id) {
    const data = load(KEY.conv + id, null);
    if (!Array.isArray(data)) return null;
    stop('interrupted', true);
    currentTurn = null;
    busy = false;
    memoryRevision++;
    convId = id;
    messages = load(KEY.conv + id, data);
    recoverMessages();
    const mem = load(KEY.mem + id, null);
    memory = mem && typeof mem.summary === 'string' ? mem : { summary: '', through: null };
    notifyTurn();
    return messages;
  }

  function deleteConversation(id) {
    if (id === convId) stop('interrupted', true);
    const data = load(KEY.conv + id, []);
    if (Array.isArray(data)) data.forEach(m => { if (m.image) Pictures.forget(m.image); });
    save(KEY.history, historyIndex().filter(h => h.id !== id));
    remove(KEY.conv + id);
    remove(KEY.mem + id);
    if (id === convId) newConversation();
  }

  function deleteMessage(id) {
    const i = messages.findIndex(m => m.id === id);
    if (i === -1) return;
    stop('interrupted', true);
    memoryRevision++;
    const [m] = messages.splice(i, 1);
    memory.progress = null;
    saveMemory();
    if (m.image) Pictures.forget(m.image);
    // Keep the summary boundary on a message that still exists.
    if (memory.through === id) {
      memory.through = i > 0 ? messages[i - 1].id : null;
      saveMemory();
    }
    if (messages.length) saveConversation();
    else deleteConversation(convId);
  }

  // Exports every saved chat as JSON. Pictures kept only in this browser
  // (idb: references) stay behind.
  function exportAll() {
    return {
      app: window.WaifuSpritesSource || 'homepage-sprites',
      version: 1,
      exportedAt: new Date().toISOString(),
      aboutUser: settings.aboutUser,
      chats: historyIndex().map(h => ({
        meta: h,
        messages: load(KEY.conv + h.id, []),
        summary: (load(KEY.mem + h.id, null) || {}).summary || '',
        summaryBackup: (load(KEY.mem + h.id, null) || {}).backup || '',
        summaryProgress: (load(KEY.mem + h.id, null) || {}).progress || null,
      })),
    };
  }

  // ── Memory ──
  // Index of the first message the summary doesn't cover.
  function unsummarizedStart() {
    if (!memory.through) return 0;
    const i = messages.findIndex(m => m.id === memory.through);
    return i === -1 ? 0 : i + 1;
  }

  function memorySize() {
    return Math.min(100, Math.max(6, parseInt(settings.memorySize, 10) || 30));
  }

  function setSummary(text) {
    const summary = window.ConversationBudget.validateSummary(text, true);
    stop('interrupted', true);
    memoryRevision++;
    if (window.ConversationBudget.bytes(memory.summary) > window.ConversationBudget.limits.summary) memory.backup = memory.summary;
    memory.summary = summary;
    memory.progress = null;
    if (!memory.summary) memory.through = null;
    saveMemory();
  }

  function messageText(message) {
    if (!isPicture(message)) return String(message.content || '');
    const generation = message.generation || (message.image ? 'generated' : 'unknown');
    const display = message.display || 'unknown';
    const result = generation === 'generated'
      ? display === 'loaded' ? 'generated; loaded in this browser, not proof the user saw it'
        : display === 'failed' ? 'generated; browser display failed'
        : display === 'interrupted' ? 'generated; browser loading interrupted, display unconfirmed'
        : 'generated; browser display unconfirmed'
      : generation === 'pending' ? 'generation pending; not delivered'
        : generation === 'blocked' ? 'blocked by the image service; not delivered'
          : generation === 'failed' ? 'generation failed; not delivered'
            : generation === 'stopped' || generation === 'interrupted' ? 'generation ' + generation + '; not delivered'
              : 'generation and display unconfirmed';
    return '(App image status: ' + result + '. Requested scene: ' + String(message.prompt || 'a picture').slice(0, 500) + ')';
  }
  function usableMessage(message) {
    return isPicture(message) || (!message.superseded && (!message.status || message.status === 'completed'));
  }
  function recentContext(limit = 4) {
    return messages.filter(usableMessage).slice(-limit).map(m => ({ role: m.role, text: messageText(m).slice(0, 300) }));
  }
  function asTranscript(list) {
    return list.map(m => usableMessage(m) ? m.role.toUpperCase() + ': ' + messageText(m)
      : 'APP: Incomplete assistant attempt (' + m.status + '); not a completed answer.').join('\n');
  }

  let summarizing = false;
  let summaryFailedAt = 0;

  /**
   * Folds the oldest unsummarized messages into the summary. Automatic runs
   * start once more than the memory size are waiting and keep the newest half;
   * force (the "Summarize now" button) keeps only the last few. Resolves with
   * true when the summary changed. A failure keeps every message and backs off
   * for two minutes.
   */
  async function summarize(force = false, owner = null) {
    if (owner && !isCurrent(owner)) return false;
    if (summarizing && force) throw window.ConversationBudget.error('memory_busy', tr('memory.busy'));
    if (summarizing || (!force && Date.now() - summaryFailedAt < 120000)) return false;
    const budget = window.ConversationBudget;
    const id = convId, revision = memoryRevision, snapshot = memory, scope = conversationRevision;
    const pendingMessages = messages.slice(unsummarizedStart());
    const latestUser = [...messages].reverse().find(m => m.role === 'user');
    const turn = id + ':' + (latestUser && latestUser.id);
    if (!force && (!latestUser || turn === lastAutomaticMemoryTurn)) return false;
    const legacy = budget.bytes(memory.summary) > budget.limits.summary;
    if (!force && !legacy && !memory.progress && pendingMessages.length <= memorySize() &&
        budget.jsonBytes(contextForModel(pendingMessages.slice(0, -1))) <= budget.limits.history) return false;
    const keep = Math.min(force ? 4 : Math.ceil(memorySize() / 2), Math.max(1, pendingMessages.length - 1));
    const source = pendingMessages.slice(0, Math.max(0, pendingMessages.length - keep))
      .map(m => ({ id: m.id, text: asTranscript([m]), original: m }));
    const valid = () => id === convId && scope === conversationRevision && (!owner || isCurrent(owner)) &&
      revision === memoryRevision && memory === snapshot &&
      (legacy || source.every(e => messages.includes(e.original) && asTranscript([e.original]) === e.text));
    const run = {};
    summarizing = run;
    try {
      const task = budget.compressionTask(source, memory,
        m => ({ model: modelFor(settings.provider), messages: m, max_tokens: 700, stream: false,
          ...(settings.provider === 'cloud' ? { client_settings: { app: window.WaifuSpritesSource || 'homepage-sprites', persona: settings.persona, ...(window.WaifuI18n?.snapshot?.() || {}) }, context_budget_version: 1 } : {}) }), settings.summaryLength);
      if (!task) return false;
      if (!force) lastAutomaticMemoryTurn = turn;
      const summary = await complete(task.messages, 'summary', 700, owner);
      if (!valid()) return false;
      const next = budget.accept(task, summary);
      memory = { ...memory, ...next };
      if (!task.legacy && task.completed.length) memory.through = task.completed[task.completed.length - 1].id;
      saveMemory();
      summaryFailedAt = 0;
      return true;
    } catch (e) {
      if (!valid()) return false;
      summaryFailedAt = Date.now();
      if (force) throw e;
      return false;
    } finally { if (summarizing === run) summarizing = false; }
  }

  // ── Requests ──
  function promptText(language = settings.language) {
    if (window.ChatPrompts) return window.ChatPrompts.forLanguage(language);
    // A failed translation download must not stop chat.
    return (_key, fallback, params = {}) => fallback.replace(/%\{(\w+)\}/g,
      (all, key) => params[key] == null ? all : String(params[key]));
  }

  function personaPrompt(prompt = promptText()) {
    return settings.persona === 'custom' ? (settings.customPrompt || '')
      : prompt('sprite_' + settings.persona, PERSONAS[settings.persona].prompt);
  }

  function ambientPrompt() {
    const custom = settings.ambientPrompt.trim();
    return custom && custom !== DEFAULT_AMBIENT_PROMPT ? custom
      : promptText()('sprite_ambient', DEFAULT_AMBIENT_PROMPT);
  }

  async function contextLines(prompt) {
    const lines = [];
    if (settings.includeTime) {
      lines.push(prompt('time', 'The current date and time for the user is %{time}.', {
        time: new Date().toLocaleString(prompt.locale, { dateStyle: 'full', timeStyle: 'short' }),
      }));
    }
    if (settings.includeBattery && navigator.getBattery) {
      try {
        const b = await navigator.getBattery();
        lines.push(prompt('battery', "The user's device battery is at %{level}%; charging: %{charging}. %{remaining}", {
          level: Math.round(b.level * 100), charging: b.charging ? prompt('yes', 'yes') : prompt('no', 'no'), remaining: '',
        }).trim());
      } catch (e) {}
    }
    return lines;
  }

  async function systemPrompt() {
    const language = settings.language;
    const prompt = promptText(language);
    const nativeName = window.WaifuI18n?.languageName?.(language);
    const languageName = typeof nativeName === 'string' && nativeName ? nativeName : language;
    const languageRule = language
      ? prompt('fixed', 'Reply in %{language}, unless the user asks you to speak another language; then switch. Never mix languages in one reply.', { language: languageName })
      : prompt('auto', 'Reply in the language of the user\'s latest message, and never mix languages in one reply. If they ask you to switch languages, do so.');
    const parts = [languageRule, personaPrompt(prompt).trim()];
    if (settings.extraPrompt.trim()) parts.push(prompt('sprite_extra', 'Additional personality instructions: %{text}', { text: settings.extraPrompt.trim() }));
    if (settings.aboutUser.trim()) parts.push(prompt('sprite_about', 'What the user has told you about themselves (always keep it in mind): %{text}', { text: settings.aboutUser.trim() }));
    const active = window.ConversationBudget ? window.ConversationBudget.activeSummary(memory) : (memory.summary || '');
    if (active) parts.push(prompt('sprite_summary', 'Summary of your conversation with the user so far: %{text}', { text: active }));
    parts.push(...await contextLines(prompt));
    parts.push(prompt('pictures', Pictures.CHAT_RULE, {
      appearance: prompt('sprite_appearance', Pictures.APPEARANCE || 'an anime girl'),
    }));
    parts.push(prompt('sprite_offer', 'React in character to a picture request and offer to make it; do not promise successful generation or delivery.'));
    parts.push(prompt('sprite_emotion', EMOTION_RULE, { tags: Sprites.EMOTIONS.join(', ') }));
    parts.push(language
      ? prompt('reminder', 'Important: even if the user writes in another language or sends only a short message, reply only in %{language} — unless they explicitly ask you to switch.', { language: languageName })
      : prompt('reminderAuto', "Important: reply only in the language of the user's latest message, even if it is short; never mix languages. Use English only if their language is unclear."));
    return parts.filter(Boolean).join('\n\n');
  }

  function contextForModel(list) {
    const out = [];
    list.filter(usableMessage).forEach(m => {
      const content = messageText(m);
      if (isPicture(m)) {
        const previous = out[out.length - 1];
        if (previous && previous.role === 'assistant') previous.content += '\n' + content;
        else out.push({ role: 'assistant', content });
      } else if (content) {
        out.push({ role: m.role, content: m.role === 'assistant' && m.emotion ? '[' + m.emotion + '] ' + content : content });
      }
    });
    return out;
  }

  // The messages the model gets after the system prompt: what the summary
  // doesn't cover, capped at the memory size.
  function recentForModel() {
    return contextForModel(messages.slice(unsummarizedStart()));
  }

  async function modelMessages(extraUserTurn, owner = null) {
    checkOwner(owner);
    const revision = conversationRevision;
    const budget = window.ConversationBudget;
    const system = { role: 'system', content: await abortable(systemPrompt(), owner?.signal) };
    checkOwner(owner);
    if (revision !== conversationRevision) throw abortError();
    const history = recentForModel();
    if (extraUserTurn) history.push({ role: 'user', content: extraUserTurn });
    const out = [system].concat(history);
    if (settings.provider !== 'cloud') return [system].concat(history.slice(-memorySize()));
    return budget.pack(out, m => ({ model: modelFor(settings.provider), messages: m, max_tokens: 600, stream: true,
      client_settings: { app: window.WaifuSpritesSource || 'homepage-sprites', persona: settings.persona, ...(window.WaifuI18n?.snapshot?.() || {}) }, context_budget_version: 1 }), memorySize()).messages;
  }

  function addPicture(id, message, owner = null) {
    if (!owner || !isCurrent(owner) || id !== convId) return false;
    message.id = message.id || messageId();
    messages.push(message);
    saveConversation();
    return true;
  }

  function lastReply() {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && !isPicture(messages[i]) && usableMessage(messages[i]) && messages[i].content) return messages[i].content;
    }
    return '';
  }

  function modelFor(provider) {
    return (settings.models[provider] || '').trim() || PROVIDERS[provider].defaultModel;
  }

  // purpose: chat, ambient, summary, title or translate. WaifuAI Cloud logs
  // each kind apart; side calls carry no client settings.
  function buildRequest(msgs, purpose, stream, maxTokens) {
    const provider = settings.provider;
    const body = { model: modelFor(provider), messages: msgs, max_tokens: maxTokens || 600, stream };
    const headers = { 'Content-Type': 'application/json' };
    let url;
    if (provider === 'cloud') {
      url = CLOUD_URL;
      headers['x-session-id'] = sessionId;
      headers['x-visitor-id'] = visitorId();
      if (purpose !== 'chat') headers['X-Waifu-Purpose'] = purpose;
      body.client_settings = { app: window.WaifuSpritesSource || 'homepage-sprites', persona: settings.persona, ...(window.WaifuI18n?.snapshot?.() || {}) };
      body.context_budget_version = 1;
      const budget = window.ConversationBudget;
      if (purpose === 'chat' || purpose === 'ambient') body.messages = budget.pack(body.messages, m => ({ ...body, messages: m }), memorySize()).messages;
      budget.checkBody(body);
    } else {
      const base = provider === 'custom' ? settings.customBaseUrl : PROVIDERS[provider].baseUrl;
      const key = (settings.keys[provider] || '').trim();
      if (!base) throw new Error(tr('error.setEndpoint'));
      if (!key && provider !== 'custom') throw new Error(tr('error.setKey', { provider: tr('provider.' + provider + '.name') }));
      if (!body.model) throw new Error(tr('error.setModel'));
      url = base.replace(/\/+$/, '') + '/chat/completions';
      if (key) headers.Authorization = 'Bearer ' + key;
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = location.origin;
        headers['X-Title'] = 'Waifu Sprites';
      }
    }
    return { url, headers, body };
  }

  // One non-streaming call for the side jobs (summary, title, romaji). Resolves with the text.
  async function complete(msgs, purpose, maxTokens, owner = null) {
    checkOwner(owner);
    const scope = conversationRevision;
    const req = buildRequest(msgs, purpose, false, maxTokens || 300);
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    owner?.signal.addEventListener('abort', abort, { once: true });
    sideControllers.add(ctrl);
    const timer = setTimeout(abort, 60000);
    try {
      const resp = await abortable(fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal }), ctrl.signal);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await abortable(resp.json(), ctrl.signal);
      checkOwner(owner);
      if (scope !== conversationRevision || ctrl.signal.aborted) throw abortError();
      return String(data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    } finally {
      clearTimeout(timer);
      sideControllers.delete(ctrl);
      owner?.signal.removeEventListener('abort', abort);
    }
  }

  // Names a chat in a few words from its first messages, unless it already has a name.
  async function generateTitle(id, owner = null) {
    if (owner && !isCurrent(owner)) return null;
    const scope = conversationRevision;
    const h = historyIndex().find(x => x.id === id);
    if (!h || h.named || id !== convId) return null;
    const text = messages.filter(m => !isPicture(m) && usableMessage(m)).slice(0, 6)
      .map(m => (m.role === 'user' ? 'User: ' : 'Assistant: ') + messageText(m).slice(0, 150)).join('\n');
    if (!text) return null;
    try {
      let title = await complete([
        { role: 'system', content: 'Generate a very short title (3-6 words) that summarizes the topic of this conversation, in the conversation\'s language. Reply with ONLY the title, no quotes or punctuation.' },
        { role: 'user', content: text },
      ], 'title', 30, owner);
      if (scope !== conversationRevision || id !== convId || (owner && !isCurrent(owner)) || historyIndex().find(x => x.id === id)?.named) return null;
      title = title.split('\n')[0].replace(/^["'\s*#]+|["'.\s*]+$/g, '').slice(0, 48);
      if (!title) return null;
      renameConversation(id, title);
      return title;
    } catch (e) {
      return null;
    }
  }

  const KANA = /[぀-ヿ]/;
  const HANGUL = /[가-힯]/;
  function needsRomaji(text) { return KANA.test(text) || HANGUL.test(text); }

  // Latin-letter reading of a Japanese or Korean reply, stored on the message.
  async function romanize(message, owner = null) {
    if (owner && !isCurrent(owner)) return null;
    const scope = conversationRevision, original = message.content;
    const lang = KANA.test(message.content) ? 'Japanese' : 'Korean';
    const how = lang === 'Japanese' ? 'Romaji' : 'Revised Romanization';
    const text = await complete([
      { role: 'system', content: 'Provide a ' + how + ' transliteration of the following ' + lang + ' text. Respond ONLY with the transliterated text, nothing else.' },
      { role: 'user', content: message.content },
    ], 'translate', 400, owner);
    if (!text || scope !== conversationRevision || !messages.includes(message) || message.content !== original || (owner && !isCurrent(owner))) return null;
    message.romaji = text;
    saveConversation();
    return text;
  }

  async function readStream(resp, onDelta, owner) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', finished = false;
    const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (e) {} };
    owner.signal.addEventListener('abort', cancel, { once: true });
    const line = raw => {
      if (!raw.trim().startsWith('data:')) return;
      const payload = raw.trim().slice(5).trim();
      if (payload === '[DONE]') { finished = true; return; }
      let choice;
      try { choice = JSON.parse(payload).choices?.[0]; } catch (e) { return; }
      checkOwner(owner);
      if (choice?.delta?.content) onDelta(choice.delta.content);
      if (choice?.finish_reason) finished = true;
    };
    try {
      for (;;) {
        const { done, value } = await abortable(reader.read(), owner.signal);
        checkOwner(owner);
        if (done) { buffer += decoder.decode(); if (buffer) line(buffer); break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const raw of lines) line(raw);
        if (finished) break;
      }
      if (!finished) throw new Error(tr('chat.interrupted'));
    } finally {
      owner.signal.removeEventListener('abort', cancel);
      cancel();
      try { reader.releaseLock(); } catch (e) {}
    }
  }

  const TAG = /^\s*\[([a-z_ ]{2,20})\]\s*/i;

  // Splits a leading emotion tag off the text. pending = the tag may still be arriving.
  function splitTag(text) {
    const m = text.match(TAG);
    if (m) {
      const name = m[1].toLowerCase().trim().replace(' ', '_');
      return { emotion: Sprites.EMOTIONS.includes(name) ? name : null, text: text.slice(m[0].length), pending: false };
    }
    const pending = /^\s*\[[a-z_ ]{0,20}$/i.test(text);
    return { emotion: null, text: pending ? '' : text, pending };
  }

  // Removes what only the app should act on: stray emotion tags, picture notes
  // echoed from the history, and bracketed picture descriptions the model
  // sometimes writes despite being told the picture is drawn separately.
  // While streaming (partial), a bracket still open at the end is held back.
  const PICTURE_WORDS = /draw|paint|sketch|picture|photo|selfie|image|snap/i;
  function clean(text, partial) {
    let t = text
      .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
      .replace(/\((?:sent a picture:|App image status:)[^)\n]*\)?/gi, '')
      .replace(/\s*\[([^\]\n]{0,300})\]/g, (all, inner) =>
        /^[a-z_]{2,20}$/i.test(inner) || PICTURE_WORDS.test(inner) ? ' ' : all);
    if (partial) t = t.replace(/\s*\[[^\]\n]*$/, '');
    return t.replace(/[ \t]{2,}/g, ' ').trim();
  }

  /**
   * Sends text and streams the reply.
   * cb.onEmotion(name) fires as soon as the tag arrives, cb.onText(visibleText)
   * on every chunk, cb.onDone(message) at the end, cb.onError(message) on failure.
   * opts.ambient: text is an instruction for an unprompted message, sent but
   * never stored or shown.
   */
  async function send(text, cb, opts = {}) {
    const owner = opts.owner || beginTurn(text, opts);
    if (!owner || !isCurrent(owner) || owner.started) return;
    owner.started = true;
    owner.callbacks = cb;
    const ambient = owner.ambient;
    let raw = '';
    let emotion = null;
    let emotionSent = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!isCurrent(owner) || owner.status !== 'pending') return;
      timedOut = true;
      settle(owner, 'failed', tr('error.timeout'));
      owner.controller.abort();
      notifyTurn();
    }, 90000);
    try {
      const req = buildRequest(await modelMessages(ambient ? text : null, owner), ambient ? 'ambient' : 'chat', true, 600);
      checkOwner(owner);
      const resp = await abortable(fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: owner.signal }), owner.signal);
      checkOwner(owner);
      if (!resp.ok) {
        let detail = '';
        try { const j = await abortable(resp.json(), owner.signal); detail = (j.error && (j.error.message || j.error)) || ''; } catch (e) { checkOwner(owner); }
        if (resp.status === 429) throw new Error(tr('error.tooMany'));
        if (resp.status === 413) throw window.ConversationBudget.error('context_too_large', detail || tr('error.contextTooLarge'));
        if (resp.status === 401 || resp.status === 403) throw new Error(tr('error.rejected'));
        throw new Error(tr('error.service', { status: resp.status, detail: '' }) + (detail ? ': ' + String(detail).slice(0, 160) : '.'));
      }
      await readStream(resp, delta => {
        checkOwner(owner);
        raw += delta;
        const part = splitTag(raw.replace(/^\s*<think>[\s\S]*?(<\/think>\s*|$)/i, ''));
        if (part.pending) return;
        const visible = clean(part.text, true);
        if (!emotionSent) {
          if (!part.emotion && !visible) return; // still inside a <think> block
          emotionSent = true;
          emotion = part.emotion;
          cb.onEmotion?.(emotion);
        }
        owner.replyMessage.content = visible;
        owner.replyMessage.emotion = emotion;
        saveConversation();
        cb.onText?.(visible);
      }, owner);
      checkOwner(owner);
      const part = splitTag(raw.replace(/^\s*<think>[\s\S]*?(<\/think>\s*|$)/i, ''));
      const reply = clean(part.text, false);
      if (!reply) throw new Error(tr('error.emptyReply'));
      if (!emotionSent) cb.onEmotion?.(null);
      Object.assign(owner.replyMessage, { content: reply, emotion: emotion || Sprites.detectEmotion(reply) });
      settle(owner, 'completed');
    } catch (err) {
      if (!isCurrent(owner) || timedOut) return owner;
      const msg = err.name === 'AbortError' ? tr('chat.interrupted')
        : err instanceof TypeError ? tr(settings.provider === 'custom' ? 'error.unreachableCustom' : 'error.unreachable')
        : err.message;
      settle(owner, 'failed', msg);
    } finally {
      clearTimeout(timer);
    }
    return owner;
  }

  return {
    PROVIDERS, PERSONAS, LANGUAGES, SUMMARY_LENGTHS, settings, saveSettings, modelFor, ambientPrompt,
    get DEFAULT_AMBIENT_PROMPT() { return promptText()('sprite_ambient', DEFAULT_AMBIENT_PROMPT); },
    send, stop, ids, askDecisions, addPicture, lastReply, newConversation, openConversation, deleteConversation, deleteMessage,
    renameConversation, historyIndex, exportAll, summarize, setSummary, generateTitle, needsRomaji, romanize, modelMessages,
    unsummarizedStart, beginTurn, finishTurn, isCurrent, isDuplicate, normalizeText, onTurnChange, canRetry,
    isPicture, createPicture, updatePicture, setPictureDisplay, canRetryImage, messageText, recentContext, effect, abortable,
    get current() { return currentTurn; },
    get revision() { return conversationRevision; },
    get stoppable() { return isCurrent(currentTurn) && (busy || currentTurn.pendingEffects > 0); },
    get messages() { return messages; },
    get summary() { return memory.summary; },
    get memoryPending() { return Boolean(memory.progress) || window.ConversationBudget.bytes(memory.summary) > window.ConversationBudget.limits.summary; },
    get convId() { return convId; },
    get busy() { return busy; },
  };
})();
