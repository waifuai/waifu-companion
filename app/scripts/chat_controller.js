// Assumes debugLog, isProcessing, messageInput, addMessage, conversationContext, maxMemorySize,
// showTypingIndicator, getAIResponse, currentModel, playTTS,
// selectedLanguageCode, translateToLanguageCode, showTransliteration,
// getTranslatedText, getTransliteration (from ai_interface.js) are accessible via window or config.js

// Interface string lookup with an English fallback. A function declaration,
// because every app script is a classic script sharing one global scope, where
// duplicate lexical declarations throw.
function tr(key, fallback, params) {
  const api = typeof window !== 'undefined' && window.WaifuI18n;
  try { if (api && api.has(key)) return api.t(key, params); } catch (e) { /* fall back below */ }
  if (!params) return fallback;
  return String(fallback).replace(/%\{(\w+)\}/g, (all, name) => (params[name] == null ? all : String(params[name])));
}

function deleteMessage(messageElement, content, isUser) {
  // Remove from UI with a small fade effect
  messageElement.style.opacity = '0';
  messageElement.style.transform = 'scale(0.9)';
  messageElement.style.transition = 'all 0.2s ease';

  setTimeout(() => {
    messageElement.remove();
  }, 200);

  // Remove from conversationContext. Match on the bubble's id: matching on
  // text removed the first identical message (e.g. an earlier "ok") instead
  // of this one, and never matched image bubbles, whose stored content is the
  // [generated an image: ...] marker rather than the caption shown.
  const role = isUser ? 'user' : 'assistant';
  let index = conversationContext.findIndex(m => m.id && m.id === messageElement.id);
  if (index === -1) index = conversationContext.findIndex(m => !m.id && m.content === content && m.role === role);

  if (index !== -1) {
    window.ambientStopped = true; invalidateTurn();
    invalidateConversationMemory();
    window.summaryProgress = null;
    AppStorage.setJSON(AppStorage.KEYS.SUMMARY_PROGRESS, null);
    conversationContext.splice(index, 1);
    if (AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, conversationContext)) {
      debugLog(`Message deleted from context: "${content.substring(0, 30)}..."`, 'info');
      debugState('Conversation', 'message_deleted', { role: role, remainingContext: conversationContext.length });

      if (window.ChatManager) {
        const activeId = window.ChatManager.getActiveChatId();
        if (activeId) window.ChatManager.saveCurrentChat(activeId);
      }
    }
  } else {
    debugLog('Message removed from UI, but not found in conversationContext (may have been a system/sample message).', 'info');
  }
}
window.deleteMessage = deleteMessage;

// Ownership survives text completion while decisions, display and speech finish.
let activeTurn = null;
let turnSequence = 0;
window.userQueuePaused = false;
window.ambientStopped = false;
function turnIsCurrent(owner) {
  return !!owner && activeTurn === owner && !owner.controller.signal.aborted &&
    (!window.ChatManager || window.ChatManager.getActiveChatId() === owner.chatId);
}
function turnOptions(owner) { return { signal: owner.controller.signal, valid: () => turnIsCurrent(owner) }; }
function saveTurnState() {
  AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, conversationContext);
  const id = window.ChatManager?.getActiveChatId();
  if (id) window.ChatManager.saveCurrentChat(id);
}
function refreshTurnControls() {
  const button = document.getElementById('sendMessageBtn');
  if (button) {
    const stop = !!activeTurn && turnIsCurrent(activeTurn) && (isProcessing || activeTurn.effects > 0);
    button.dataset.i18n = stop ? 'composer.stop' : 'chat.send';
    button.textContent = tr(button.dataset.i18n, stop ? 'Stop' : 'Send');
    button.dataset.i18nAriaLabel = button.dataset.i18n;
    button.setAttribute('aria-label', button.textContent);
    button.classList.toggle('turn-stop', stop);
    button.disabled = false;
  }
  document.querySelectorAll?.('.turn-retry').forEach(button => {
    const entry = conversationContext.find(m => m.id === button.dataset.attemptId);
    button.disabled = !canRetryTurn(entry);
  });
}
function clearTurnWait(owner) {
  (owner.timers || []).forEach(clearTimeout); owner.timers = [];
  owner.waitElement?.remove(); owner.waitElement = null;
}
function setTurnWait(owner, key, fallback) {
  if (!turnIsCurrent(owner) || owner.reply?.content?.trim() || owner.status !== 'pending') return;
  if (!owner.waitElement) {
    owner.waitElement = document.createElement('div');
    owner.waitElement.className = 'turn-wait'; owner.waitElement.setAttribute('role', 'status');
    document.getElementById(owner.reply?.id)?.appendChild(owner.waitElement);
  }
  owner.waitElement.dataset.i18n = key; owner.waitElement.textContent = tr(key, fallback);
}
function renderAttemptState(entry) {
  if (!entry || entry.role !== 'assistant' || entry.imageOperation) return;
  const bubble = document.getElementById(entry.id); if (!bubble) return;
  bubble.querySelector('.turn-result')?.remove(); bubble.querySelector('.turn-retry')?.remove();
  if (!entry.attemptStatus || entry.attemptStatus === 'completed' || entry.attemptStatus === 'pending') return;
  const state = document.createElement('span'); state.className = 'turn-result'; state.setAttribute('role', 'status');
  const key = entry.attemptStatus === 'stopped' ? 'chat.stopped' : entry.attemptStatus === 'interrupted' ? 'chat.interrupted' : 'chat.failed';
  state.dataset.i18n = key; state.textContent = tr(key, entry.attemptStatus);
  bubble.appendChild(state);
  if (entry.failureText) { const detail = document.createElement('span'); detail.className = 'turn-error-detail'; detail.textContent = entry.failureText; state.appendChild(detail); }
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'turn-retry';
  retry.dataset.attemptId = entry.id; retry.dataset.i18n = 'chat.retry'; retry.textContent = tr('chat.retry', 'Retry');
  retry.disabled = !canRetryTurn(entry); retry.onclick = () => retryTurn(entry); bubble.appendChild(retry);
}
function canRetryTurn(entry) {
  if (!entry || isProcessing || entry.superseded || entry.imageOperation || !['stopped','failed','interrupted'].includes(entry.attemptStatus)) return false;
  const i = conversationContext.indexOf(entry);
  return i >= 0 && conversationContext.some(m => m.id === entry.userId && m.role === 'user') &&
    !conversationContext.slice(i + 1).some(m => m.role === 'user' || (m.attemptStatus && !m.superseded));
}
function invalidateTurn(status = 'interrupted') {
  const owner = activeTurn;
  if (!owner) return;
  activeTurn = null; // Invalidate before abort listeners or speech completion run.
  owner.controller.abort(); clearTimeout(owner.deadline); clearTurnWait(owner);
  if (owner.reply?.attemptStatus === 'pending') {
    owner.reply.attemptStatus = status;
    if (owner.stream) finalizeStreamingMessage(owner.stream, owner.reply.content, owner.language);
    renderAttemptState(owner.reply);
  }
  conversationContext.forEach(m => {
    if (m.attemptId !== owner.attemptId || !m.imageOperation) return;
    if (m.imageOperation.generation === 'pending') m.imageOperation.generation = status;
    if (m.imageOperation.display === 'loading') m.imageOperation.display = 'interrupted';
    renderImageOperation(m, null, false);
  });
  saveTurnState();
  window.cancelVoiceInput?.();
  window.stopTTS?.();
  isProcessing = false; isAIResponding = false; window.isWaitingForAIResponse = false;
  showTypingIndicator(false); refreshTurnControls();
}
function stopActiveTurn() {
  window.userQueuePaused = true; window.ambientStopped = true;
  if (window.ambientTimer) clearTimeout(window.ambientTimer);
  window.ambientPreloadBuffer = null; window.ambientPreloadTTSBuffer = null;
  invalidateTurn('stopped'); updateQueueUI();
  if (window.chatHistory) window.chatHistory.scrollTop = window.chatHistory.scrollHeight;
}
function beginOwnedTurn(user, isAmbient = false) {
  window.ambientStopped = true; // Suppress completion hooks during replacement.
  invalidateTurn();
  window.cancelVoiceInput?.(); window.stopTTS?.();
  window.ambientStopped = false;
  window.invalidateConversationMemory?.();
  const owner = { chatId: window.ChatManager?.getActiveChatId() || null, turnId: user?.id || nextMessageId(),
    attemptId: 'attempt-' + Date.now() + '-' + (++turnSequence), controller: new AbortController(),
    status: 'pending', effects: 0, language: selectedLanguageCode, user, isAmbient, timers: [] };
  activeTurn = owner; isProcessing = true; isAIResponding = true;
  return owner;
}
async function ownedEffect(owner, work) {
  if (!turnIsCurrent(owner)) return;
  owner.effects++; refreshTurnControls();
  try { return await work(); } catch (e) { if (turnIsCurrent(owner) && e.name !== 'AbortError') debugError('Turn effect failed', e); }
  finally { owner.effects--; if (turnIsCurrent(owner)) refreshTurnControls(); }
}
function normalizeSend(text) { return String(text || '').trim().replace(/\s+/g, ' '); }
function isDuplicateSend(text) {
  const value = normalizeSend(text);
  return !!(activeTurn && turnIsCurrent(activeTurn) && (activeTurn.status === 'pending' || (activeTurn.imageOnly && activeTurn.effects > 0)) && normalizeSend(activeTurn.user?.content) === value) ||
    userMessageQueue.some(m => normalizeSend(m) === value);
}
function noteSentMessage() {} // Compatibility with older integrations; dedupe is attempt-bound.
async function sendMessage() {
  const message = messageInput.value.trim(); if (!message) return;
  if (isDuplicateSend(message)) { if (typeof trackEvent === 'function') trackEvent('duplicate_message_suppressed'); return; }
  if (isProcessing) {
    if (!isUserMessageQueueEnabled) return;
    userMessageQueue.push(message); messageInput.value = ''; updateQueueUI(); return;
  }
  messageInput.value = ''; window.sttFinalTranscript = '';
  window.userQueuePaused = false; window.ambientStopped = false;
  window.resetAmbientTimer?.(true); window.ambientPreloadBuffer = null;
  await sendMessageInternal(message);
}
async function retryTurn(entry) {
  if (!canRetryTurn(entry)) return;
  const user = conversationContext.find(m => m.id === entry.userId);
  entry.superseded = true;
  await sendMessageInternal(user.content, false, null, null, user);
}
function resumeUserQueue() {
  window.userQueuePaused = false; window.ambientStopped = false;
  if (!isProcessing && userMessageQueue.length) {
    const message = userMessageQueue.shift(); updateQueueUI(); sendMessageInternal(message);
  }
}
window.stopActiveTurn = stopActiveTurn;
window.turnIsCurrent = turnIsCurrent;
window.turnOptions = turnOptions;
window.refreshTurnControls = refreshTurnControls;
window.renderAttemptState = renderAttemptState;
window.resumeUserQueue = resumeUserQueue;
window.getActiveTurn = () => activeTurn;

// /image flow: draws a picture through the image endpoint and drops it into
// the chat. The prompt goes out as-is; a short in-character caption is added
// and stored so chat reloads and the LLM context both know the image exists.
// Maps an emotion label to the expression and pose it plays. One function so
// the keyword guess on the streaming reply and the decision upgrade for the
// finished reply apply the exact same animation per label; unknown labels
// render as the neutral expression.
function applyEmotionAnimation(emotion, owner = activeTurn) {
  const later = (fn, ms) => setTimeout(() => { if (!owner || turnIsCurrent(owner)) fn(); }, ms);
  if (!currentModel) return;
  switch (emotion) {
    case "happy":
      currentModel.expression("f04");
      currentAnimationState.targetBodyAngle = Math.random() * 10 - 5;
      later(() => { currentAnimationState.targetBodyAngle = 0; }, 3000);
      break;
    case "sad":
      currentModel.expression("f03");
      currentModel.internalModel.coreModel.setParameterValueById("ParamBrowY", -1);
      currentAnimationState.targetHeadAngle = -8;
      later(() => { currentAnimationState.targetHeadAngle = 0; }, 4000);
      break;
    case "surprised":
      currentModel.expression("f02");
      currentModel.internalModel.coreModel.setParameterValueById("ParamEyeLOpen", 2);
      currentModel.internalModel.coreModel.setParameterValueById("ParamEyeROpen", 2);
      currentAnimationState.targetHeadAngle = (Math.random() - 0.5) * 15;
      later(() => { currentAnimationState.targetHeadAngle = 0; }, 2000);
      break;
    case "thoughtful":
      currentModel.expression("f04");
      currentModel.internalModel.coreModel.setParameterValueById("ParamBrowY", 0.5);
      currentAnimationState.targetHeadAngle = Math.random() > 0.5 ? 12 : -12;
      later(() => { currentAnimationState.targetHeadAngle = 0; }, 5000);
      break;
    case "excited":
      currentModel.motion("tap_body");
      currentModel.expression("f01");
      currentAnimationState.targetBodyAngle = 15;
      later(() => {
        currentAnimationState.targetBodyAngle = -10;
        later(() => { currentAnimationState.targetBodyAngle = 0; }, 1000);
      }, 1000);
      break;
    default:
      currentModel.expression("f00");
      currentAnimationState.targetHeadAngle = 0;
      currentAnimationState.targetBodyAngle = 0;
  }
}

async function handleImageRequest(prompt, aspect = '1:1', caption = null, owner = activeTurn, entry = null) {
  if (!turnIsCurrent(owner)) return;
  if (!entry) {
    const id = addMessage('', false);
    entry = { id, role: 'assistant', content: '', caption: caption || '', turnId: owner.turnId,
      attemptId: owner.attemptId, userId: owner.user?.id, imageOperation: { prompt, aspect, generation: 'pending', display: 'unknown', retryable: false } };
    conversationContext.push(entry);
  }
  const op = entry.imageOperation; op.generation = 'pending'; op.display = 'unknown'; op.retryable = false;
  entry.attemptId = owner.attemptId; saveTurnState(); renderImageOperation(entry, owner);
  return ownedEffect(owner, async () => {
    if (typeof trackEvent === 'function') trackEvent('image_generation_started');
    try {
      const result = await awaitTurn(window.WaifuProxyAPI.generateImage(prompt, aspect, null, null, turnOptions(owner)), turnOptions(owner));
      if (!turnIsCurrent(owner)) return;
      entry.imageUrl = result.url; op.generation = 'generated'; op.display = 'loading';
      if (typeof trackEvent === 'function') trackEvent('image_generation_completed');
    } catch (error) {
      if (!turnIsCurrent(owner)) return;
      op.generation = error.blocked ? 'blocked' : 'failed';
      op.retryable = !error.blocked && ![401,403,429].includes(error.status) && (error.retryable === true || error.network || error instanceof TypeError || error.status >= 500);
      if (typeof trackEvent === 'function') trackEvent('image_generation_failed', { blocked: !!error.blocked, timed_out: !!error.timedOut });
    }
    if (!turnIsCurrent(owner)) return;
    saveTurnState(); renderImageOperation(entry, owner);
  });
}
function renderImageOperation(entry, owner = null, load = true) {
  const bubble = document.getElementById(entry.id); if (!bubble) return;
  bubble.querySelector('.message-original-text')?.replaceChildren();
  const previousImage = entry.imageOperation?.display === 'loaded' ? bubble.querySelector('.chat-image') : null;
  bubble.querySelector('.image-operation')?.remove();
  const panel = document.createElement('div'); panel.className = 'image-operation'; bubble.appendChild(panel);
  const op = entry.imageOperation || { generation: 'generated', display: 'unknown', prompt: '', aspect: entry.aspect || '1:1' };
  entry.imageOperation = op;
  const attempt = entry.attemptId;
  const valid = () => panel.isConnected && conversationContext.includes(entry) && entry.attemptId === attempt && (!owner || turnIsCurrent(owner));
  const label = document.createElement('span'); label.className = 'image-status'; label.setAttribute('role', 'status'); panel.appendChild(label);
  const status = () => {
    const state = op.generation === 'generated' ? ({ loaded:'loaded', failed:'displayFailed', interrupted:'interrupted', unknown:'unknown' }[op.display] || 'loading') : op.generation;
    const keys = { pending:['picture.pending','Drawing…'], loading:['picture.loading','Generated / loading…'], loaded:['picture.loaded','Loaded in this browser'], blocked:['picture.blocked','Blocked'], failed:['picture.failed','Generation failed'], displayFailed:['picture.displayFailed','Display failed'], stopped:['picture.stopped','Stopped'], interrupted:['picture.interrupted','Interrupted'], unknown:['picture.unknown','Generated / display unconfirmed'] };
    const [key, fallback] = keys[state] || keys.unknown; label.dataset.i18n = key; label.textContent = tr(key, fallback);
  };
  status();
  const button = (key, fallback, action) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.i18n = key; b.textContent = tr(key, fallback); b.onclick = action; panel.appendChild(b); return b; };
  if (op.generation === 'generated' && entry.imageUrl) {
    const img = previousImage || document.createElement('img'); img.className = 'chat-image'; img.alt = entry.caption || tr('picture.loading', 'Generated image'); panel.appendChild(img);
    let displayVersion = 0;
    const reload = button('picture.reload', 'Reload image', async () => {
      const version = ++displayVersion; const revision = window.conversationMemoryRevision;
      reload.disabled = true; op.display = 'loading'; status();
      let released = false;
      if (owner && turnIsCurrent(owner)) { owner.effects++; refreshTurnControls(); }
      const release = () => { if (released) return; released = true; if (owner) { owner.effects--; if (turnIsCurrent(owner)) refreshTurnControls(); owner.controller.signal.removeEventListener('abort', release); } };
      owner?.controller.signal.addEventListener('abort', release, { once: true });
      const current = () => valid() && version === displayVersion && window.conversationMemoryRevision === revision;
      const failed = () => { release(); if (!current()) return; op.display = 'failed'; reload.disabled = false; status(); saveTurnState(); };
      img.onload = () => { release(); if (!current()) return; op.display = 'loaded'; reload.disabled = false; status(); saveTurnState(); };
      img.onerror = failed;
      try {
        const url = await ImageStore.resolve(entry.imageUrl);
        if (!current()) { release(); return; }
        if (!url) { failed(); return; }
        img.src = url;
      } catch (_) { failed(); }
    });
    if (load && op.display !== 'interrupted') reload.click();
  } else if (op.generation === 'failed' && op.retryable) {
    button('picture.again', 'Generate again', () => {
      if (!valid() || isProcessing) return;
      const user = conversationContext.find(m => m.id === entry.userId);
      const next = beginOwnedTurn(user); next.status = 'completed'; isProcessing = false; isAIResponding = false;
      handleImageRequest(op.prompt, op.aspect, entry.caption, next, entry);
    });
  }
}
window.renderImageOperation = renderImageOperation;
function recoverSavedTurns(messages) {
  messages.forEach(m => {
    if (m.attemptStatus === 'pending') m.attemptStatus = 'interrupted';
    if (m.imageOperation?.generation === 'pending') m.imageOperation.generation = 'interrupted';
    if (m.imageOperation?.generation === 'generated') m.imageOperation.display = 'unknown';
  });
}
window.recoverSavedTurns = recoverSavedTurns;

// Tears down everything tied to the conversation that's being left behind.
//
// Switching or creating a chat used to be able to leave an in-flight reply
// running: TTS kept speaking, isProcessing stayed set, and the queued
// messages and ambient timer belonged to the previous conversation — so a
// reply could land in, and be saved to, the chat the user had just opened.
function resetConversationRuntime() {
  window.userQueuePaused = true; window.ambientStopped = true;
  invalidateTurn(); window.cancelVoiceInput?.();
  window.invalidateConversationMemory?.();
  // Clear the queue first: stopTTS releases the response, and a non-empty
  // queue at that moment would immediately start sending into the new chat.
  window.userMessageQueue = [];
  window.preloadedQueuedResponse = null;
  window.isPreloadingQueuedMessage = false;

  if (typeof window.stopTTS === 'function') window.stopTTS();

  isProcessing = false;
  isAIResponding = false;
  window.isWaitingForAIResponse = false;
  window.consecutiveAmbientCount = 0;

  window.ambientPreloadBuffer = null;
  window.ambientPreloadTTSBuffer = null;
  window.isAmbientPreloading = false;
  window.isAmbientPreloadingTTS = false;
  if (window.ambientTimer) {
    clearTimeout(window.ambientTimer);
    window.ambientTimer = null;
  }

  if (typeof updateQueueUI === 'function') updateQueueUI();
  if (typeof showTypingIndicator === 'function') showTypingIndicator(false);
  debugLog('Conversation runtime reset (TTS stopped, queues and timers cleared).', 'info');
}
window.resetConversationRuntime = resetConversationRuntime;

// Stored messages are retained until their bounded memory update succeeds.
// The outgoing request builder chooses its own smaller context.
function trimConversationContext() { return conversationContext.length; }
window.trimConversationContext = trimConversationContext;

let isSummarizing = false;
let lastSummarizeFailureTime = 0;
let lastAutomaticMemoryTurn = null;
let memoryMessageSequence = 0;
const SUMMARIZE_FAILURE_COOLDOWN_MS = 120000;
window.conversationMemoryRevision = 0;
function invalidateConversationMemory() { window.conversationMemoryRevision++; }
window.invalidateConversationMemory = invalidateConversationMemory;

function memoryEntry(message) {
  if (!message.id) message.id = 'memory-' + Date.now().toString(36) + '-' + (++memoryMessageSequence);
  const visible = typeof contextForModel === 'function' ? contextForModel([message]) : [message];
  return { id: message.id, text: visible.map(m => m.role.toUpperCase() + ': ' + m.content).join('\n'), original: message };
}
function persistConversationMemory() {
  AppStorage.setString(AppStorage.KEYS.CONVERSATION_SUMMARY, window.conversationSummary || '');
  AppStorage.setJSON(AppStorage.KEYS.SUMMARY_PROGRESS, window.summaryProgress || null);
  AppStorage.setString(AppStorage.KEYS.SUMMARY_BACKUP, window.summaryBackup || '');
  AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, conversationContext);
  AppStorage.setNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, window.messageCountSinceLastSummary);
  const id = window.ChatManager && window.ChatManager.getActiveChatId();
  if (id) window.ChatManager.saveCurrentChat(id);
}
window.persistConversationMemory = persistConversationMemory;
function showMemorySizeStatus(text) {
  const el = document.getElementById('summarySizeStatus');
  if (el) el.textContent = text || `${window.ConversationBudget.bytes(window.conversationSummary)} / ${window.ConversationBudget.limits.summary} bytes`;
}
window.showMemorySizeStatus = showMemorySizeStatus;

async function maybeSummarizeConversation(force = false, owner = null) {
  if (isSummarizing && force) throw window.ConversationBudget.error('memory_busy', 'A memory update is already running. Wait for it to finish.');
  if (isSummarizing || (!force && Date.now() - lastSummarizeFailureTime < SUMMARIZE_FAILURE_COOLDOWN_MS)) return false;
  const budget = window.ConversationBudget;
  const entries = conversationContext.map(memoryEntry).filter(e => e.text);
  const chatId = window.ChatManager && window.ChatManager.getActiveChatId();
  const latestUser = [...entries].reverse().find(e => e.original.role === 'user');
  const turn = String(chatId || 'legacy') + ':' + (latestUser && latestUser.id);
  if (!force && (!latestUser || turn === lastAutomaticMemoryTurn)) return false;
  const state = { summary: window.conversationSummary || '', progress: window.summaryProgress || null };
  const legacy = budget.bytes(state.summary) > budget.limits.summary;
  const trigger = Math.min(clampMemorySetting(maxMemorySize), clampMemorySetting(window.summaryTriggerCount));
  const olderBytes = budget.jsonBytes(contextForModel(conversationContext.slice(0, -1)));
  if (!force && !legacy && !state.progress && entries.length <= trigger && olderBytes <= budget.limits.history) return false;
  const keep = Math.min(force ? 4 : Math.ceil(clampMemorySetting(maxMemorySize) / 2), Math.max(1, entries.length - 1));
  const pending = entries.slice(0, Math.max(0, entries.length - keep));
  const task = budget.compressionTask(pending, state,
    m => ({ model: 'waifuai-v1', messages: m, max_tokens: 2500, stream: false, context_budget_version: 1 }), window.summaryLengthPreference || 'concise');
  if (!task) return false;
  if (!force) lastAutomaticMemoryTurn = turn;
  const revision = window.conversationMemoryRevision;
  const valid = () => (!owner || turnIsCurrent(owner)) && window.conversationMemoryRevision === revision &&
    (!window.ChatManager || window.ChatManager.getActiveChatId() === chatId) &&
    window.conversationSummary === state.summary && (window.summaryProgress || null) === state.progress &&
    (task.legacy || pending.every(e => conversationContext.includes(e.original) && memoryEntry(e.original).text === e.text));
  isSummarizing = true;
  try {
    const text = await requestMemorySummary(task.messages, owner ? turnOptions(owner) : {});
    if (!valid()) return false;
    const next = budget.accept(task, text);
    window.conversationSummary = next.summary;
    window.summaryProgress = next.progress;
    if (next.backup) window.summaryBackup = next.backup;
    if (!task.legacy) {
      const done = new Set(task.completed.map(e => e.original));
      conversationContext = conversationContext.filter(m => !done.has(m));
    }
    window.messageCountSinceLastSummary = 0;
    persistConversationMemory();
    const summaryEl = document.getElementById('conversationSummary');
    if (summaryEl) summaryEl.value = next.summary;
    showMemorySizeStatus(next.progress ? tr('memory.partialNote', 'Memory updated in part. More source text is kept for the next update.') : null);
    lastSummarizeFailureTime = 0;
    updateSummaryMarker();
    return true;
  } catch (e) {
    if (valid()) { lastSummarizeFailureTime = Date.now(); showMemorySizeStatus(e.message); }
    if (force) throw e;
    return false;
  } finally { isSummarizing = false; }
}
window.maybeSummarizeConversation = maybeSummarizeConversation;

async function sendMessageInternal(message, isAmbient = false, cachedResponse = null, ttsPreloadBuffer = null, retryUser = null) {
  if (isProcessing) return;
  const owner = beginOwnedTurn(retryUser, isAmbient); // Before context, image decisions or any await.
  let imagePromise = null;
  try {
    if (!isAmbient && !retryUser) {
      const id = addMessage(message, true, null, null, 'en-US');
      owner.user = { id, role: 'user', content: message }; owner.turnId = id;
      conversationContext.push(owner.user);
      window.messageCountSinceLastSummary++; window.consecutiveAmbientCount = 0;
      if (typeof trackEvent === 'function') trackEvent('chat_message_sent');
    }
    const direct = message.match(/^\/(?:image|img)\b\s*(.*)/i);
    if (direct && !isAmbient) {
      owner.imageOnly = true;
      let prompt = direct[1].trim(); let aspect = getImageAspect();
      const shape = prompt.match(/\s+(portrait|landscape|square)\s*$/i);
      if (shape) { aspect = {portrait:'2:3',landscape:'3:2',square:'1:1'}[shape[1].toLowerCase()]; prompt = prompt.slice(0,shape.index).trim(); }
      if (prompt) { owner.status = 'completed'; isProcessing = false; isAIResponding = false; await handleImageRequest(prompt, aspect, null, owner); }
      else { addMessage(tr('chat.imagePromptHelp', 'Describe what you want me to draw: /image a cozy cafe at sunset'), false); owner.status = 'failed'; }
      return;
    }
    owner.stream = createStreamingMessage(owner.language);
    owner.reply = { role: 'assistant', content: '', id: owner.stream.messageDiv.id, turnId: owner.turnId,
      userId: owner.user?.id, attemptId: owner.attemptId, attemptStatus: 'pending', languageCode: owner.language };
    conversationContext.push(owner.reply); saveTurnState(); refreshTurnControls(); updateSummaryMarker();
    owner.timers = [setTimeout(() => setTurnWait(owner, 'chat.stillWorking', 'Still working…'), 8000),
      setTimeout(() => setTurnWait(owner, 'chat.longWait', 'Taking longer than usual — Stop is available.'), 20000)];
    const deadline = setTimeout(() => {
      if (!turnIsCurrent(owner) || owner.status !== 'pending') return;
      owner.timedOut = true; window.userQueuePaused = true; window.ambientStopped = true;
      invalidateTurn('failed'); updateQueueUI();
    }, 90000);
    owner.deadline = deadline;
    if (!isAmbient && typeof getImageDecision === 'function') imagePromise = ownedEffect(owner, () => getImageDecision(message, turnOptions(owner)));
    const options = { ...turnOptions(owner), stream: typeof resolveLLMProvider === 'function' && !!resolveLLMProvider(),
      purpose: isAmbient ? 'ambient' : 'chat', onChunk(text) {
        if (!turnIsCurrent(owner)) return;
        owner.reply.content = text; updateStreamingMessage(owner.stream, text); saveTurnState();
        if (text.trim()) clearTurnWait(owner);
      } };
    const response = cachedResponse || await awaitTurn(getAIResponse(message, owner.language, options), options);
    if (!turnIsCurrent(owner)) return;
    if (response.isError) { const e = new Error('Reply request failed'); e.userMessage = response.reply; throw e; }
    owner.reply.content = response.reply || owner.reply.content;
    owner.reply.attemptStatus = 'completed'; owner.status = 'completed'; clearTimeout(owner.deadline);
    clearTurnWait(owner); finalizeStreamingMessage(owner.stream, owner.reply.content, owner.language);
    saveTurnState();
    if (showTransliteration && ['ja-JP','ko-KR'].includes(owner.language)) ownedEffect(owner, async () => {
      const text = await getTransliteration(owner.reply.content, owner.language, turnOptions(owner));
      if (turnIsCurrent(owner) && conversationContext.includes(owner.reply)) appendTransliteration(owner.stream.messageDiv, text);
    });
    if (imagePromise) ownedEffect(owner, async () => {
      const request = await imagePromise;
      if (request && turnIsCurrent(owner)) await handleImageRequest(request.prompt, request.aspect, null, owner);
    });
    if (!isAmbient && typeof maybeAutoBackground === 'function') ownedEffect(owner, () => maybeAutoBackground(owner));
    if (response.settingsUpdate && window.allowAIModSettings) window.applyAIProposedSettings?.(response.settingsUpdate);
    ownedEffect(owner, () => maybeSummarizeConversation(false, owner));
    const meta = window.ChatManager?.getChatMeta(owner.chatId);
    if (meta?.name === 'New Chat' && meta.messageCount >= 2) ownedEffect(owner, () => generateChatTitle(owner.chatId, false, owner));
    const valid = () => turnIsCurrent(owner) && conversationContext.includes(owner.reply);
    const plan = window.enableVoice && typeof prepareTTSRouting === 'function' ? prepareTTSRouting(owner.reply.content) : null;
    let decision = null;
    if (currentModel) {
      applyEmotionAnimation(response.emotion, owner);
      decision = ownedEffect(owner, () => upgradeEmotionFromDecision(message, owner.reply.content, e => { if (valid()) applyEmotionAnimation(e, owner); }, plan, valid, turnOptions(owner)));
    }
    if (plan?.needsDecision && !decision && window.WaifuProxyAPI) decision = ownedEffect(owner, () => window.WaifuProxyAPI.decide(['live2d_tts_language_v1'], { reply: plan.text, conversation_language: plan.previousLang }, turnOptions(owner)));
    const routing = plan && typeof finishTTSRouting === 'function' ? finishTTSRouting(plan, decision, valid) : null;
    if (window.enableVoice && valid()) playTTS(owner.reply.content, owner.language, owner.reply.id, 0, ttsPreloadBuffer, true, routing);
    onAIResponseFullyFinished(owner);
    if (turnIsCurrent(owner) && window.isAmbientQueueEnabled && window.isAmbientPreloadEnabled) window.preloadNextAmbientMessage?.();
  } catch (error) {
    if (!turnIsCurrent(owner)) return;
    window.userQueuePaused = true; window.ambientStopped = true;
    owner.status = 'failed'; clearTimeout(owner.deadline); if (owner.reply) owner.reply.attemptStatus = 'failed';
    if (owner.reply) owner.reply.failureText = error.userMessage || '';
    if (owner.stream) finalizeStreamingMessage(owner.stream, owner.reply.content, owner.language);
    clearTurnWait(owner); renderAttemptState(owner.reply); saveTurnState();
    // Failed text cannot authorize late picture/background/speech work.
    conversationContext.forEach(m => { if (m.attemptId === owner.attemptId && m.imageOperation?.generation === 'pending') { m.imageOperation.generation = 'interrupted'; renderImageOperation(m, null, false); } });
    owner.controller.abort(); activeTurn = null; saveTurnState();
    isProcessing = false; isAIResponding = false; window.isWaitingForAIResponse = false;
    showTypingIndicator(false); updateQueueUI(); refreshTurnControls();
  } finally {
    if (turnIsCurrent(owner) && owner.status !== 'pending') { clearTurnWait(owner); onAIResponseFullyFinished(owner); }
  }
}
function onAIResponseFullyFinished(owner = activeTurn) {
  if (!turnIsCurrent(owner)) return;
  if (!isProcessing && !isAIResponding) { refreshTurnControls(); return; }
  isProcessing = false; isAIResponding = false; window.isWaitingForAIResponse = false;
  refreshTurnControls();
  if (!window.userQueuePaused && userMessageQueue.length) resumeUserQueue();
  else if (!window.ambientStopped && !(typeof window.isTTSBusy === 'function' && window.isTTSBusy())) window.resetAmbientTimer?.();
}
function onAIResponseSpeechFinished() {
  if (window.ambientStopped || isProcessing || userMessageQueue.length) return;
  window.resetAmbientTimer?.();
}
async function preloadNextQueuedMessage() {
  // Queued text receives an owner only when accepted; never dispatch speculative requests.
}
window.sendMessageInternal = sendMessageInternal;
window.onAIResponseFullyFinished = onAIResponseFullyFinished;
window.onAIResponseSpeechFinished = onAIResponseSpeechFinished;
window.preloadNextQueuedMessage = preloadNextQueuedMessage;

function updateSummaryMarker() {
  if (!window.chatHistory) return;

  let marker = document.getElementById('summary-cutoff-marker');
  if (!marker) {
    marker = document.createElement('div');
    marker.id = 'summary-cutoff-marker';
    marker.className = 'summary-cutoff-marker';
    const text = tr('memory.cutoffMarker', '--- Summary Boundary (Active Memory Below) ---');
    marker.innerHTML = `<span>${text}</span>`;
  }

  if (window.conversationContext && window.conversationContext.length > 0) {
    const firstMsg = window.conversationContext[0];
    if (firstMsg.id) {
      const firstMsgEl = document.getElementById(firstMsg.id);
      if (firstMsgEl) {
        window.chatHistory.insertBefore(marker, firstMsgEl);
        return;
      }
    }
  }

  if (window.chatHistory.children.length > 0) {
    window.chatHistory.appendChild(marker);
  } else {
    if (marker.parentNode) marker.remove();
  }
}
window.updateSummaryMarker = updateSummaryMarker;

function initChatController() {
  if (window.messageInput) {
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        sendMessage();
      }
    });
    debugLog('Chat controller initialized, Enter key listener added to message input.', 'info');
  } else {
    debugLog('Chat_Controller: messageInput not found for event listener attachment.', 'error');
  }

  const sendButton = document.getElementById('sendMessageBtn');
  if (sendButton) {
    sendButton.addEventListener('click', (event) => {
      if (event.detail >= 2) return;
      if (turnIsCurrent(activeTurn) && (isProcessing || activeTurn.effects > 0)) stopActiveTurn();
      else sendMessage();
    });
  }
}

window.sendMessage = sendMessage;
window.handleImageRequest = handleImageRequest;
