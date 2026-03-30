// Chat Manager - manages multiple chats stored in localStorage
// Each chat has: id, name, messages (conversationContext), summary, messageCountSinceLastSummary, createdAt, updatedAt

const CHAT_INDEX_KEY = 'chatIndex';
const ACTIVE_CHAT_KEY = 'activeChatId';

// --- Internal helpers ---

function _getChatIndex() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_INDEX_KEY) || '[]');
  } catch (e) {
    debugLog('ChatManager: Failed to parse chat index', 'error');
    return [];
  }
}

function _saveChatIndex(index) {
  localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
}

function _generateId() {
  return 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function _getChatData(chatId) {
  try {
    return JSON.parse(localStorage.getItem('chatData_' + chatId) || 'null');
  } catch (e) {
    debugLog(`ChatManager: Failed to parse chat data for ${chatId}`, 'error');
    return null;
  }
}

function _saveChatData(chatId, data) {
  localStorage.setItem('chatData_' + chatId, JSON.stringify(data));
}

function _deleteChatData(chatId) {
  localStorage.removeItem('chatData_' + chatId);
}

// --- Public API ---

// Get the currently active chat ID
function getActiveChatId() {
  return localStorage.getItem(ACTIVE_CHAT_KEY) || null;
}

// Set the active chat ID
function setActiveChatId(chatId) {
  if (chatId) {
    localStorage.setItem(ACTIVE_CHAT_KEY, chatId);
  } else {
    localStorage.removeItem(ACTIVE_CHAT_KEY);
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
function loadChat(chatId) {
  const data = _getChatData(chatId);
  if (!data) {
    debugLog(`ChatManager: No data found for chat ${chatId}`, 'warn');
    return false;
  }

  window.conversationContext = data.conversationContext || [];
  window.conversationSummary = data.conversationSummary || '';
  window.messageCountSinceLastSummary = data.messageCountSinceLastSummary || 0;

  // Persist to legacy keys so existing code continues to work
  localStorage.setItem('conversationContext', JSON.stringify(window.conversationContext));
  localStorage.setItem('conversationSummary', window.conversationSummary);
  localStorage.setItem('messageCountSinceLastSummary', window.messageCountSinceLastSummary.toString());

  setActiveChatId(chatId);

  // Re-render chat messages
  if (window.chatHistory) {
    window.chatHistory.innerHTML = '';
    window.conversationContext.forEach(msg => {
      const langCode = msg.role === 'user' ? 'en-US' : (msg.languageCode || window.selectedLanguageCode || 'en-US');
      const id = addMessage(msg.content, msg.role === 'user', null, null, langCode);
      msg.id = id;
    });
    if (typeof updateSummaryMarker === 'function') updateSummaryMarker();
  }

  // Update summary textarea if visible
  const summaryEl = document.getElementById('conversationSummary');
  if (summaryEl) summaryEl.value = window.conversationSummary;

  const meta = getChatMeta(chatId);
  debugLog(`ChatManager: Loaded chat "${meta?.name}" (${chatId})`, 'info');
  return true;
}

// Delete a chat
function deleteChat(chatId) {
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

  const savedContext = localStorage.getItem('conversationContext');
  const savedSummary = localStorage.getItem('conversationSummary') || '';
  const savedCount = parseInt(localStorage.getItem('messageCountSinceLastSummary') || '0');

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
    listEl.innerHTML = '<div class="chat-list-empty">No chats yet. Click + to start.</div>';
    return;
  }

  listEl.innerHTML = chats.map(chat => {
    const isActive = chat.id === activeId;
    const timeStr = _relativeTime(chat.updatedAt);
    return `
      <div class="chat-list-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
        <div class="chat-list-item-content" onclick="handleSwitchChat('${chat.id}')">
          <div class="chat-list-item-name">${_escapeHtml(chat.name)}</div>
          <div class="chat-list-item-meta">
            <span class="chat-list-item-count">${chat.messageCount} msgs</span>
            <span class="chat-list-item-time">${timeStr}</span>
          </div>
          ${chat.preview ? `<div class="chat-list-item-preview">${_escapeHtml(chat.preview)}</div>` : ''}
        </div>
        <div class="chat-list-item-actions">
          <button class="chat-action-btn" onclick="event.stopPropagation(); handleRenameChat('${chat.id}')" title="Rename">✏️</button>
          <button class="chat-action-btn chat-action-delete" onclick="event.stopPropagation(); handleDeleteChat('${chat.id}')" title="Delete">🗑️</button>
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
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + (minutes === 1 ? ' min ago' : ' mins ago');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
  const months = Math.floor(days / 30);
  if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');
  const years = Math.floor(months / 12);
  return years + (years === 1 ? ' year ago' : ' years ago');
}

// Generate a chat title using the LLM based on recent messages
async function generateChatTitle(chatId, force = false) {
  const data = _getChatData(chatId);
  if (!data) return;

  const messages = data.conversationContext || [];
  if (messages.length === 0) return;

  const meta = getChatMeta(chatId);
  if (!meta || (!force && meta.name !== 'New Chat')) return;

  const recentMessages = messages.slice(-6);
  const contextText = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 150)}`)
    .join('\n');

  try {
    let title = null;

    if (window.GroqAPI && window.GroqAPI.isConfigured()) {
      const result = await window.GroqAPI.createCompletion({
        messages: [
          { role: 'system', content: 'Generate a very short title (3-6 words) that summarizes the topic of this conversation. Reply with ONLY the title, no quotes or punctuation.' },
          { role: 'user', content: contextText }
        ]
      });
      title = result?.content;
    } else if (window.OpenRouterAPI && window.OpenRouterAPI.isConfigured()) {
      const result = await window.OpenRouterAPI.createCompletion({
        messages: [
          { role: 'system', content: 'Generate a very short title (3-6 words) that summarizes the topic of this conversation. Reply with ONLY the title, no quotes or punctuation.' },
          { role: 'user', content: contextText }
        ]
      });
      title = result?.content;
    }

    if (title && title.trim()) {
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
  try { localStorage.setItem('chatSidebarVisible', isVisible.toString()); } catch(e) {}
}

// --- UI Event Handlers ---

function handleNewChat() {
  // Save current chat first
  const currentId = getActiveChatId();
  if (currentId) {
    saveCurrentChat(currentId);
  }

  const id = createNewChat('New Chat');

  // Reset global state for new chat
  window.conversationContext = [];
  window.conversationSummary = '';
  window.messageCountSinceLastSummary = 0;
  localStorage.setItem('conversationContext', '[]');
  localStorage.setItem('conversationSummary', '');
  localStorage.setItem('messageCountSinceLastSummary', '0');

  // Clear chat UI
  if (window.chatHistory) window.chatHistory.innerHTML = '';
  const summaryEl = document.getElementById('conversationSummary');
  if (summaryEl) summaryEl.value = '';

  // Update header
  _updateChatHeader(name);

  renderChatList();
  debugLog('ChatManager: Started new chat', 'info');
}

function handleSwitchChat(chatId) {
  const currentId = getActiveChatId();
  if (currentId === chatId) return;

  // Save current chat
  if (currentId) {
    saveCurrentChat(chatId === currentId ? currentId : currentId);
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
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

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
  const newName = prompt('Rename chat:', currentName);
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

// Expose to global scope
window.ChatManager = {
  getActiveChatId,
  setActiveChatId,
  getAllChats,
  getChatMeta,
  createNewChat,
  saveCurrentChat,
  loadChat,
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
  handleRenameChat
};

// Also expose handlers directly for onclick attributes
window.handleNewChat = handleNewChat;
window.handleSwitchChat = handleSwitchChat;
window.handleDeleteChat = handleDeleteChat;
window.handleRenameChat = handleRenameChat;
window.toggleChatSidebar = toggleChatSidebar;
window.handleRegenerateTitle = handleRegenerateTitle;
window.generateChatTitle = generateChatTitle;
