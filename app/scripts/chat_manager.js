// Chat Manager - manages multiple chats stored in localStorage
// Each chat has: id, name, messages (conversationContext), summary, messageCountSinceLastSummary, createdAt, updatedAt

const CHAT_INDEX_KEY = 'chatIndex';
const ACTIVE_CHAT_KEY = 'activeChatId';

// Interface string lookup with an English fallback. A function declaration,
// because every app script is a classic script sharing one global scope, where
// duplicate lexical declarations throw. The fallback interpolates too, so the
// relative-time plurals read correctly even without the runtime.
function tr(key, fallback, params) {
  const api = typeof window !== 'undefined' && window.WaifuI18n;
  try { if (api && api.has(key)) return api.t(key, params); } catch (e) { /* fall back below */ }
  if (!params) return fallback;
  return String(fallback).replace(/%\{(\w+)\}/g, (all, name) => (params[name] == null ? all : String(params[name])));
}

// --- Internal helpers ---

function _getChatIndex() {
  return AppStorage.getJSON(CHAT_INDEX_KEY, []);
}

function _saveChatIndex(index) {
  // Routed through AppStorage so a full quota reclaims space and retries
  // instead of throwing mid-write — this is the key that grows with every
  // chat created, renamed, or touched.
  AppStorage.setJSON(CHAT_INDEX_KEY, index);
}

function _generateId() {
  return 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function _getChatData(chatId) {
  return AppStorage.getJSON('chatData_' + chatId, null);
}

function _saveChatData(chatId, data) {
  AppStorage.setJSON('chatData_' + chatId, data);
}

function _deleteChatData(chatId) {
  AppStorage.removeItem('chatData_' + chatId);
}

// --- Public API ---

// Get the currently active chat ID
function getActiveChatId() {
  return AppStorage.getItem(ACTIVE_CHAT_KEY) || null;
}

// Set the active chat ID
function setActiveChatId(chatId) {
  if (getActiveChatId() !== chatId) window.resetConversationRuntime?.();
  if (chatId) {
    AppStorage.setItem(ACTIVE_CHAT_KEY, chatId);
  } else {
    AppStorage.removeItem(ACTIVE_CHAT_KEY);
  }
}

// Get all chats sorted by most recent first
function getAllChats() {
  return _getChatIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

// Get metadata for a specific chat
function getChatMeta(chatId) {
  const index = _getChatIndex();
  return index.find(c => c.id === chatId) || null;
}

// Create a new chat and return its ID
function createNewChat(name) {
  window.resetConversationRuntime?.();
  const id = _generateId();
  const now = Date.now();
  const meta = {
    id,
    name: name || 'New Chat',
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
    preview: ''
  };

  const data = {
    conversationContext: [],
    conversationSummary: '',
    summaryProgress: null,
    summaryBackup: '',
    messageCountSinceLastSummary: 0
  };

  const index = _getChatIndex();
  index.push(meta);
  _saveChatIndex(index);
  _saveChatData(id, data);
  setActiveChatId(id);

  debugLog(`ChatManager: Created new chat "${meta.name}" (${id})`, 'info');
  return id;
}

// Save current conversation state into a chat
function saveCurrentChat(chatId) {
  if (!chatId) return;
  const index = _getChatIndex();
  const meta = index.find(c => c.id === chatId);
  if (!meta) return;

  const data = {
    conversationContext: window.conversationContext || [],
    conversationSummary: window.conversationSummary || '',
    summaryProgress: window.summaryProgress || null,
    summaryBackup: window.summaryBackup || '',
    messageCountSinceLastSummary: window.messageCountSinceLastSummary || 0
  };

  _saveChatData(chatId, data);

  // Update metadata
  meta.messageCount = data.conversationContext.length;
  meta.updatedAt = Date.now();
  const lastMsg = data.conversationContext[data.conversationContext.length - 1];
  meta.preview = lastMsg ? lastMsg.content.substring(0, 80) : '';
  _saveChatIndex(index);

  debugLog(`ChatManager: Saved chat ${chatId} (${meta.messageCount} messages)`, 'info');
}

// Load a chat's data into the global state
// Read-only accessor to a chat's stored data (used by background
// image completions to append into a chat the user has navigated
// away from without disturbing the active conversation).
function getChatData(chatId) {
  return _getChatData(chatId);
}

function saveChatData(chatId, data) {
  _saveChatData(chatId, data);
  const meta = _getChatIndex().find(c => c.id === chatId);
  if (meta) {
    meta.messageCount = data.conversationContext.length;
    const lastMsg = data.conversationContext[data.conversationContext.length - 1];
    meta.preview = lastMsg ? lastMsg.content.substring(0, 80) : '';
    meta.updatedAt = Date.now();
    _saveChatIndex(_getChatIndex());
  }
}

function loadChat(chatId) {
  // Stop anything still running for the conversation being replaced. Without
  // this, switching chats mid-reply left TTS speaking and isProcessing set
  // for the PREVIOUS conversation, and a queued message could be sent into
  // the chat that was just opened.
  if (typeof window.resetConversationRuntime === 'function') window.resetConversationRuntime();

  const data = _getChatData(chatId);
  if (!data) {
    debugLog(`ChatManager: No data found for chat ${chatId}`, 'warn');
    return false;
  }

  window.conversationContext = data.conversationContext || [];
  window.recoverSavedTurns?.(window.conversationContext);
  window.conversationSummary = data.conversationSummary || '';
  window.summaryProgress = data.summaryProgress || null;
  window.summaryBackup = data.summaryBackup || '';
  window.showMemorySizeStatus?.();
  window.messageCountSinceLastSummary = data.messageCountSinceLastSummary || 0;

  // Persist to legacy keys so existing code continues to work
  AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, window.conversationContext);
  AppStorage.setString(AppStorage.KEYS.CONVERSATION_SUMMARY, window.conversationSummary);
  AppStorage.setJSON(AppStorage.KEYS.SUMMARY_PROGRESS, window.summaryProgress);
  AppStorage.setString(AppStorage.KEYS.SUMMARY_BACKUP, window.summaryBackup);
  AppStorage.setNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, window.messageCountSinceLastSummary);

  setActiveChatId(chatId);

  // Re-render chat messages
  if (window.chatHistory) {
    window.chatHistory.innerHTML = '';
    window.conversationContext.forEach(msg => {
      const langCode = msg.role === 'user' ? 'en-US' : (msg.languageCode || window.selectedLanguageCode || 'en-US');
      // Image messages store a [generated an image: ...] marker as content for
      // the LLM; show the caption instead (older saves have none).
      const text = (msg.imageOperation || msg.imageUrl) ? (msg.caption || 'Here, I drew this for you~ ✨') : msg.content;
      const id = addMessage(text, msg.role === 'user', null, null, langCode, null);
      if (msg.id) {
        const bubble = document.getElementById(id);
        if (bubble) bubble.id = msg.id;
      } else msg.id = id;
      if (msg.imageOperation || msg.imageUrl) window.renderImageOperation?.(msg);
      else window.renderAttemptState?.(msg);
    });
    if (typeof showWelcomeHint === 'function') showWelcomeHint();
    if (typeof updateSummaryMarker === 'function') updateSummaryMarker();
  }

  window.refreshTurnControls?.();
  saveCurrentChat(chatId);
  // Update summary textarea if visible
  const summaryEl = document.getElementById('conversationSummary');
  if (summaryEl) summaryEl.value = window.conversationSummary;

  const meta = getChatMeta(chatId);
  debugLog(`ChatManager: Loaded chat "${meta?.name}" (${chatId})`, 'info');
  return true;
}

// Delete a chat
function deleteChat(chatId) {
  if (getActiveChatId() === chatId) window.resetConversationRuntime?.();
  let index = _getChatIndex();
  const meta = index.find(c => c.id === chatId);
  index = index.filter(c => c.id !== chatId);
  _saveChatIndex(index);
  _deleteChatData(chatId);

  debugLog(`ChatManager: Deleted chat "${meta?.name}" (${chatId})`, 'info');
}

// Rename a chat
function renameChat(chatId, newName) {
  const index = _getChatIndex();
  const meta = index.find(c => c.id === chatId);
  if (!meta) return;
  meta.name = newName;
  meta.updatedAt = Date.now();
  _saveChatIndex(index);
  debugLog(`ChatManager: Renamed chat to "${newName}"`, 'info');
}

// Get chat count
function getChatCount() {
  return _getChatIndex().length;
}

// Migrate legacy single-chat data into a new chat on first use
function migrateLegacyChat() {
  const index = _getChatIndex();
  if (index.length > 0) return; // Already migrated

  const savedContext = AppStorage.getItem('conversationContext');
  const savedSummary = AppStorage.getItem('conversationSummary') || '';
  const savedCount = parseInt(AppStorage.getItem('messageCountSinceLastSummary') || '0');

  if (savedContext) {
    try {
      const context = JSON.parse(savedContext);
      if (Array.isArray(context) && context.length > 0) {
        const id = _generateId();
        const now = Date.now();
        const lastMsg = context[context.length - 1];
        const meta = {
          id,
          name: 'New Chat',
          messageCount: context.length,
          createdAt: now,
          updatedAt: now,
          preview: lastMsg ? lastMsg.content.substring(0, 80) : ''
        };

        const data = {
          conversationContext: context,
          conversationSummary: savedSummary,
          messageCountSinceLastSummary: savedCount
        };

        _saveChatIndex([meta]);
        _saveChatData(id, data);
        setActiveChatId(id);

        debugLog(`ChatManager: Migrated legacy chat into "${meta.name}" (${id})`, 'info');
        return;
      }
    } catch (e) {
      debugLog('ChatManager: Failed to migrate legacy chat', 'error');
    }
  }

  // No legacy data - create a fresh default chat
  createNewChat('Chat 1');
}

// Render the chat sidebar list
function renderChatList() {
  const listEl = document.getElementById('chatList');
  if (!listEl) return;

  const chats = getAllChats();
  const activeId = getActiveChatId();

  if (chats.length === 0) {
    listEl.innerHTML = '<div class="chat-list-empty" data-i18n="history.listEmpty">No chats yet. Click + to start.</div>';
    if (window.WaifuI18n) window.WaifuI18n.apply(listEl);
    return;
  }

  listEl.innerHTML = chats.map(chat => {
    const isActive = chat.id === activeId;
    const timeStr = _relativeTime(chat.updatedAt);
    return `
      <div class="chat-list-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
        <div class="chat-list-item-content" data-action="switch-chat" data-chat-id="${chat.id}" role="button" tabindex="0">
          <div class="chat-list-item-name">${_escapeHtml(chat.name)}</div>
          <div class="chat-list-item-meta">
            <span class="chat-list-item-count">${tr('history.msgs', '%{count} msgs', { count: chat.messageCount })}</span>
            <span class="chat-list-item-time">${timeStr}</span>
          </div>
          ${chat.preview ? `<div class="chat-list-item-preview">${_escapeHtml(chat.preview)}</div>` : ''}
        </div>
        <div class="chat-list-item-actions">
          <button class="chat-action-btn" type="button" data-action="rename-chat" data-chat-id="${chat.id}" title="${tr('history.rename', 'Rename')}">✏️</button>
          <button class="chat-action-btn chat-action-delete" type="button" data-action="delete-chat" data-chat-id="${chat.id}" title="${tr('history.delete', 'Delete')}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function _escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function _relativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  // Plural forms come from the interface dictionary (usually the locale's
  // { one, other, few, many } set); Latin digits, no grouping, in every locale.
  const en = (n, one, other) => (n === 1 ? one : other);
  if (seconds < 60) return tr('history.justNow', 'just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return tr('history.minutesAgo', en(minutes, '%{count} min ago', '%{count} mins ago'), { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tr('history.hoursAgo', en(hours, '%{count} hour ago', '%{count} hours ago'), { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return tr('history.daysAgo', en(days, '%{count} day ago', '%{count} days ago'), { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return tr('history.monthsAgo', en(months, '%{count} month ago', '%{count} months ago'), { count: months });
  const years = Math.floor(months / 12);
  return tr('history.yearsAgo', en(years, '%{count} year ago', '%{count} years ago'), { count: years });
}

// Generate a chat title using the LLM based on recent messages
async function generateChatTitle(chatId, force = false, owner = null) {
  const revision = window.conversationMemoryRevision;
  const valid = () => (!owner || window.turnIsCurrent?.(owner)) && getActiveChatId() === chatId && window.conversationMemoryRevision === revision && !!getChatMeta(chatId);
  if (window.WaifuEmbed && !force) return;
  const data = _getChatData(chatId);
  if (!data) return;

  const messages = data.conversationContext || [];
  if (messages.length === 0) return;

  const meta = getChatMeta(chatId);
  if (!meta || (!force && meta.name !== 'New Chat')) return;

  const recentMessages = typeof contextForModel === 'function' ? contextForModel(messages).slice(-6) : messages.slice(-6);
  const contextText = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 150)}`)
    .join('\n');

  try {
    // Routed through resolveLLMProvider so this works with whichever of
    // Groq / OpenRouter / OpenAI-compatible the user has configured — it used
    // to only try Groq and OpenRouter, so OpenAI-compatible users never got
    // auto-generated titles.
    const provider = typeof resolveLLMProvider === 'function' ? resolveLLMProvider() : null;
    let title = null;
    if (provider) {
      const result = await provider.api.createCompletion({
        messages: [
          { role: 'system', content: 'Generate a very short title (3-6 words) that summarizes the topic of this conversation. Reply with ONLY the title, no quotes or punctuation.' },
          { role: 'user', content: contextText }
        ],
        signal: owner?.controller.signal,
        purpose: 'title'
      });
      title = result?.content;
    }

    if (valid() && title && title.trim()) {
      title = title.trim().replace(/^["']|["']$/g, '').substring(0, 40);
      renameChat(chatId, title);
      if (getActiveChatId() === chatId) {
        _updateChatHeader(title);
      }
      renderChatList();
      debugLog(`ChatManager: Generated title "${title}" for chat ${chatId}`, 'info');
    }
  } catch (e) {
    debugLog(`ChatManager: Title generation failed: ${e.message}`, 'warn');
  }
}

async function handleRegenerateTitle() {
  const chatId = getActiveChatId();
  if (!chatId) return;
  await generateChatTitle(chatId, true);
}

// Toggle chat sidebar visibility
function toggleChatSidebar() {
  const sidebar = document.getElementById('chatSidebar');
  if (!sidebar) return;
  const isVisible = sidebar.classList.toggle('visible');
  try { AppStorage.setItem('chatSidebarVisible', isVisible.toString()); } catch(e) {}
}

// --- UI Event Handlers ---

function handleNewChat() {
  // Stop anything still running in the chat being left behind.
  if (typeof window.resetConversationRuntime === 'function') window.resetConversationRuntime();

  // Save current chat first
  const currentId = getActiveChatId();
  if (currentId) {
    saveCurrentChat(currentId);
  }

  const id = createNewChat('New Chat');

  // Reset global state for new chat
  window.conversationContext = [];
  window.conversationSummary = '';
  window.summaryProgress = null;
  window.summaryBackup = '';
  window.messageCountSinceLastSummary = 0;
  AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, []);
  AppStorage.setString(AppStorage.KEYS.CONVERSATION_SUMMARY, '');
  AppStorage.setJSON(AppStorage.KEYS.SUMMARY_PROGRESS, null);
  AppStorage.setString(AppStorage.KEYS.SUMMARY_BACKUP, '');
  AppStorage.setNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, 0);

  // Clear chat UI
  if (window.chatHistory) window.chatHistory.innerHTML = '';
  const summaryEl = document.getElementById('conversationSummary');
  if (summaryEl) summaryEl.value = '';
  window.showMemorySizeStatus?.();

  if (typeof showWelcomeHint === 'function') showWelcomeHint();

  // Update header. This used to reference an undefined `name`, which resolves
  // to window.name (a built-in cross-frame global, normally '""') instead of
  // throwing — so the header silently went blank instead of showing the new
  // chat's name.
  _updateChatHeader('New Chat');

  renderChatList();
  debugLog('ChatManager: Started new chat', 'info');
}

function handleSwitchChat(chatId) {
  const currentId = getActiveChatId();
  if (currentId === chatId) return;

  window.resetConversationRuntime?.();
  // Save current chat
  if (currentId) {
    saveCurrentChat(currentId);
  }

  // Load the target chat
  if (loadChat(chatId)) {
    const meta = getChatMeta(chatId);
    _updateChatHeader(meta?.name || 'Chat');
    renderChatList();
  }
}

function handleDeleteChat(chatId) {
  const meta = getChatMeta(chatId);
  const name = meta?.name || 'this chat';
  if (!confirm(tr('history.deleteConfirm', `Delete "${name}"? This cannot be undone.`, { name }))) return;

  const wasActive = getActiveChatId() === chatId;
  deleteChat(chatId);

  if (wasActive) {
    const remaining = getAllChats();
    if (remaining.length > 0) {
      loadChat(remaining[0].id);
      const meta = getChatMeta(remaining[0].id);
      _updateChatHeader(meta?.name || 'Chat');
    } else {
      // No chats left, create a new one
      handleNewChat();
      return;
    }
  }

  renderChatList();
}

function handleRenameChat(chatId) {
  const meta = getChatMeta(chatId);
  const currentName = meta?.name || 'Chat';
  const newName = prompt(tr('history.renamePrompt', 'Rename chat:'), currentName);
  if (!newName || newName.trim() === '' || newName === currentName) return;

  renameChat(chatId, newName.trim());

  if (getActiveChatId() === chatId) {
    _updateChatHeader(newName.trim());
  }

  renderChatList();
}

function _updateChatHeader(name) {
  const headerEl = document.getElementById('chatTitle');
  if (headerEl) headerEl.textContent = name;
}

// Export all chats as a JSON file download
function exportAllChats() {
  const index = _getChatIndex();
  if (index.length === 0) {
    alert(tr('history.exportNone', 'No chats to export.'));
    return;
  }

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    chatCount: index.length,
    chats: index.map(meta => {
      const data = _getChatData(meta.id) || {};
      return {
        meta,
        messages: data.conversationContext || [],
        summary: data.conversationSummary || '',
        summaryProgress: data.summaryProgress || null,
        summaryBackup: data.summaryBackup || '',
        messageCountSinceLastSummary: data.messageCountSinceLastSummary || 0
      };
    })
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `waifu-chats-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  debugLog(`ChatManager: Exported ${index.length} chats as JSON`, 'info');
}

function bindChatUIEvents() {
  if (document.body.dataset.chatUiEventsBound === 'true') return;

  document.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const chatId = actionEl.dataset.chatId;

    switch (action) {
      case 'switch-chat':
        if (chatId) handleSwitchChat(chatId);
        break;
      case 'rename-chat':
        event.stopPropagation();
        if (chatId) handleRenameChat(chatId);
        break;
      case 'delete-chat':
        event.stopPropagation();
        if (chatId) handleDeleteChat(chatId);
        break;
      case 'toggle-chat-sidebar':
        toggleChatSidebar();
        break;
      case 'new-chat':
        handleNewChat();
        break;
      case 'regenerate-title':
        handleRegenerateTitle();
        break;
      case 'export-all-chats':
        exportAllChats();
        break;
      default:
        break;
    }
  });

  document.addEventListener('keydown', (event) => {
    const actionEl = event.target.closest('[data-action="switch-chat"]');
    if (!actionEl) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const chatId = actionEl.dataset.chatId;
      if (chatId) handleSwitchChat(chatId);
    }
  });

  document.body.dataset.chatUiEventsBound = 'true';
}

bindChatUIEvents();

// Expose to global scope
window.ChatManager = {
  getActiveChatId,
  setActiveChatId,
  getAllChats,
  getChatMeta,
  getChatData,
  createNewChat,
  saveCurrentChat,
  loadChat,
  getChatData,
  saveChatData,
  deleteChat,
  renameChat,
  getChatCount,
  generateChatTitle,
  migrateLegacyChat,
  renderChatList,
  toggleChatSidebar,
  handleNewChat,
  handleSwitchChat,
  handleDeleteChat,
  handleRenameChat,
  exportAllChats
};

// Also expose handlers directly for onclick attributes
window.handleNewChat = handleNewChat;
window.handleSwitchChat = handleSwitchChat;
window.handleDeleteChat = handleDeleteChat;
window.handleRenameChat = handleRenameChat;

// Sidebar rows carry built strings (message counts, relative times), so a
// language switch re-renders the list instead of patching every node.
if (window.WaifuI18n) window.WaifuI18n.onChange(() => renderChatList());
window.toggleChatSidebar = toggleChatSidebar;
window.handleRegenerateTitle = handleRegenerateTitle;
window.generateChatTitle = generateChatTitle;
window.exportAllChats = exportAllChats;
