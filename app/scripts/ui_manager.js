// Monotonic counter so ids stay unique when many messages are created inside a
// single millisecond — replaying history from localStorage used to collide
// often enough to break TTS highlighting and the summary marker.
let _msgIdCounter = 0;
function nextMessageId() {
  _msgIdCounter += 1;
  return `msg-${Date.now()}-${_msgIdCounter}`;
}
window.nextMessageId = nextMessageId;

// Appends transliteration text to an already-rendered message, replacing any
// previous one. Used by the streaming path, where the transliteration request
// resolves after the message has been finalized.
function appendTransliteration(messageDiv, transliterationText) {
  if (!messageDiv || !transliterationText) return;
  const existing = messageDiv.querySelector('.message-transliteration-text');
  if (existing) existing.remove();
  const span = document.createElement('span');
  span.className = 'message-transliteration-text';
  span.textContent = `(${transliterationText})`;
  messageDiv.appendChild(span);
}
window.appendTransliteration = appendTransliteration;

// Splits text into per-sentence spans so TTS can highlight along as it
// speaks. Shared by addMessage and finalizeStreamingMessage — streamed
// replies used to render as one flat text node, so sentence highlighting
// silently did nothing on the streaming path.
function renderSentenceSpans(container, text) {
  container.textContent = '';
  const sentences = (typeof splitIntoSentences === 'function') ? splitIntoSentences(text) : [text];
  sentences.forEach((sentence, idx) => {
    const span = document.createElement('span');
    span.className = 'sentence-chunk';
    span.dataset.index = idx;
    span.textContent = sentence + ' ';
    container.appendChild(span);
  });
}
window.renderSentenceSpans = renderSentenceSpans;

function addMessage(originalText, isUser, translationText = null, transliterationText = null, languageCode = 'en-US') {
  // Assumes chatHistory is accessible
  const messageDiv = document.createElement("div");
  messageDiv.id = nextMessageId();
  messageDiv.className = `message ${isUser ? "user-message" : "model-message"}`;
  
  // Stagger entry for multiple messages if needed
  const existingMessages = chatHistory.querySelectorAll('.message').length;
  messageDiv.style.animationDelay = `${Math.min(existingMessages * 0.05, 0.5)}s`;
  
  // Actions Container
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'message-actions';

  // Play TTS button
  const playBtn = document.createElement('button');
  playBtn.className = 'message-action-btn tts-play';
  playBtn.innerHTML = '🔊';
  playBtn.title = 'Play TTS';
  playBtn.onclick = () => {
    if (typeof window.playTTS === 'function') {
      const textToPlay = isUser ? originalText : Array.from(originalSpan.querySelectorAll('.sentence-chunk')).map(s => s.textContent).join(' ');
      if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'play', source: 'message' });
      window.playTTS(textToPlay, languageCode, messageDiv.id);
    }
  };

  // Pause (Stop) TTS button
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'message-action-btn tts-pause';
  pauseBtn.innerHTML = '⏹'; // Use stop square icon for clarity
  pauseBtn.title = 'Stop TTS';
  pauseBtn.onclick = () => {
    if (typeof window.stopTTS === 'function') {
      if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'stop', source: 'message' });
      window.stopTTS();
    }
  };

  // Copy Message button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'message-action-btn copy-msg';
  copyBtn.innerHTML = '📋';
  copyBtn.title = 'Copy Text';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(originalText).then(() => {
      if (typeof trackEvent === 'function') trackEvent('message_copied');
      const oldHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅';
      setTimeout(() => copyBtn.innerHTML = oldHtml, 2000);
    });
  };

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'message-action-btn delete-msg';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.title = 'Delete message';
  deleteBtn.onclick = () => {
    if (typeof window.deleteMessage === 'function') {
      if (typeof trackEvent === 'function') trackEvent('message_deleted');
      window.deleteMessage(messageDiv, originalText, isUser);
    }
  };

  actionsDiv.appendChild(playBtn);
  actionsDiv.appendChild(pauseBtn);
  actionsDiv.appendChild(copyBtn);
  actionsDiv.appendChild(deleteBtn);
  messageDiv.appendChild(actionsDiv);

  // Original Text
  const originalSpan = document.createElement('span');
  originalSpan.className = 'message-original-text';
  
  if (!isUser) {
    renderSentenceSpans(originalSpan, originalText);
  } else {
    originalSpan.textContent = originalText;
  }
  
  messageDiv.appendChild(originalSpan);

  // Transliteration (if provided and not user message)
  if (!isUser && transliterationText) {
    const transliterationSpan = document.createElement('span');
    transliterationSpan.className = 'message-transliteration-text';
    transliterationSpan.textContent = `(${transliterationText})`;
    messageDiv.appendChild(transliterationSpan);
  }
  
  // Translation (if provided and not user message)
  if (!isUser && translationText && originalText.trim() !== translationText.trim()) { // Avoid showing translation if it's identical
    const translationSpan = document.createElement('span');
    translationSpan.className = 'message-translation-text';
    translationSpan.textContent = `(EN: ${translationText})`; // Assuming translation is always to English for now based on prompt
    messageDiv.appendChild(translationSpan);
  }

  // Add language-specific class for potential styling (e.g., fonts)
  messageDiv.classList.add(`lang-${languageCode.split('-')[0]}`); // e.g., lang-ja, lang-en

  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return messageDiv.id;
}

function highlightSentence(messageId, sentenceIndex, append = false) {
  const msgDiv = document.getElementById(messageId);
  if (!msgDiv) return;
  
  // Remove existing highlights in this message if not appending
  if (!append) {
    msgDiv.querySelectorAll('.sentence-highlight').forEach(el => el.classList.remove('sentence-highlight'));
  }
  
  // Add new highlight
  if (sentenceIndex !== null) {
    const target = msgDiv.querySelector(`.sentence-chunk[data-index="${sentenceIndex}"]`);
    if (target) {
      target.classList.add('sentence-highlight');
      // Smooth scroll within chat history if needed
      if (!append) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}
window.highlightSentence = highlightSentence;

function showRetryTTSButton(messageId, startIndex, languageCode) {
  const msgDiv = document.getElementById(messageId);
  if (!msgDiv || msgDiv.querySelector('.retry-tts-btn')) return;
  
  const retryBtn = document.createElement('button');
  retryBtn.className = 'retry-tts-btn';
  retryBtn.innerHTML = '<span>⚠️ Playback failed. Resume?</span>';
  retryBtn.onclick = () => {
    retryBtn.remove();
    if (typeof playTTS === 'function') {
      playTTS(null, languageCode, messageId, startIndex);
    }
  };
  msgDiv.appendChild(retryBtn);
}
window.showRetryTTSButton = showRetryTTSButton;

function showTypingIndicator(show) {
  // Assumes typingIndicator, currentModelName, selectedLanguageCode, languages are accessible
  if (show) {
      const characterName = currentModelName || 'Character';
      let typingText;

      const currentLangConfig = languages.find(l => l.code === selectedLanguageCode);
      
      if (currentLangConfig && typeof currentLangConfig.typingIndicatorText === 'function') {
          typingText = currentLangConfig.typingIndicatorText(characterName);
      } else {
          // Fallback to English if specific language or function is not found
          const englishConfig = languages.find(l => l.code === 'en-US');
          if (englishConfig && typeof englishConfig.typingIndicatorText === 'function') {
              typingText = englishConfig.typingIndicatorText(characterName);
          } else { // Absolute fallback
              typingText = `${characterName} is typing...`;
          }
      }
      
      typingIndicator.textContent = typingText;
      typingIndicator.style.display = "block";
  } else {
      typingIndicator.style.display = "none";
  }
}

function clearChatHistory() {
  // Assumes chatHistory, conversationContext, debugLog are accessible
  debugLog('Clearing chat history', 'info');

  // Stop any reply still in flight, or its TTS keeps speaking over an empty
  // transcript and its result is written back after the clear.
  if (typeof window.resetConversationRuntime === 'function') window.resetConversationRuntime();

  // Reset current chat data in-place
  chatHistory.innerHTML = '';
  conversationContext = [];
  window.conversationSummary = '';
  window.messageCountSinceLastSummary = 0;

  AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, []);
  AppStorage.setString(AppStorage.KEYS.CONVERSATION_SUMMARY, '');
  AppStorage.setNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, 0);

  // Save the cleared state to the active chat
  if (window.ChatManager) {
    const activeId = window.ChatManager.getActiveChatId();
    if (activeId) {
      window.ChatManager.saveCurrentChat(activeId);
      window.ChatManager.renderChatList();
    }
  }

  const summaryEl = document.getElementById('conversationSummary');
  if (summaryEl) summaryEl.value = '';

  if (typeof updateSummaryMarker === 'function') updateSummaryMarker();
}

// populateModelSelector lives in settings_ui.js. A second implementation used
// to be declared here that appended to an undefined `modelSelector` global;
// it would have thrown on the first call and was saved only by settings_ui.js
// loading later and overwriting the binding.

/**
 * Create a streaming message element for real-time updates
 * Similar to addMessage but without all the extra elements (TTS buttons, etc.)
 * Added after streaming completes
 * 
 * @param {string} languageCode - Language code for styling
 * @returns {object} - Object with messageDiv, textContainer for updating
 */
function createStreamingMessage(languageCode = 'en-US') {
  const messageDiv = document.createElement("div");
  messageDiv.id = nextMessageId();
  messageDiv.className = `message model-message streaming-message`;
  
  // Stagger entry animation
  const existingMessages = chatHistory.querySelectorAll('.message').length;
  messageDiv.style.animationDelay = `${Math.min(existingMessages * 0.05, 0.5)}s`;
  
  // Actions Container
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'message-actions';
  
  // Placeholder buttons (will be populated after streaming completes)
  const playBtn = document.createElement('button');
  playBtn.className = 'message-action-btn tts-play';
  playBtn.innerHTML = '🔊';
  playBtn.title = 'Play TTS';
  playBtn.style.opacity = '0.3'; // Dimmed until message is complete
  
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'message-action-btn tts-pause';
  pauseBtn.innerHTML = '⏹';
  pauseBtn.title = 'Stop TTS';
  pauseBtn.style.opacity = '0.3';
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'message-action-btn copy-msg';
  copyBtn.innerHTML = '📋';
  copyBtn.title = 'Copy Text';
  copyBtn.style.opacity = '0.3';
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'message-action-btn delete-msg';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.title = 'Delete message';
  deleteBtn.style.opacity = '0.3';
  
  actionsDiv.appendChild(playBtn);
  actionsDiv.appendChild(pauseBtn);
  actionsDiv.appendChild(copyBtn);
  actionsDiv.appendChild(deleteBtn);
  messageDiv.appendChild(actionsDiv);
  
  // Text container for streaming content
  const textContainer = document.createElement('span');
  textContainer.className = 'message-original-text streaming-text';
  textContainer.textContent = ''; // Start empty, fill as chunks arrive
  messageDiv.appendChild(textContainer);
  
  // Add language-specific class
  messageDiv.classList.add(`lang-${languageCode.split('-')[0]}`);
  
  // Add to chat
  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  
  return {
    messageDiv: messageDiv,
    textContainer: textContainer,
    actionsDiv: actionsDiv,
    playBtn: playBtn,
    pauseBtn: pauseBtn,
    copyBtn: copyBtn,
    deleteBtn: deleteBtn
  };
}

/**
 * Update a streaming message with new text chunk
 * 
 * @param {object} streamObj - Object returned by createStreamingMessage
 * @param {string} text - New text to display
 */
function updateStreamingMessage(streamObj, text) {
  if (!streamObj || !streamObj.textContainer) return;
  
  streamObj.textContainer.textContent = text;
  
  // Auto-scroll to bottom
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Finalize a streaming message after streaming completes
 * Enables action buttons and sets up TTS functionality
 * 
 * @param {object} streamObj - Object returned by createStreamingMessage
 * @param {string} originalText - The complete text content
 * @param {string} languageCode - Language code for TTS
 * @param {string} transliterationText - Optional transliteration
 * @param {string} translationText - Optional translation
 */
function finalizeStreamingMessage(streamObj, originalText, languageCode = 'en-US', transliterationText = null, translationText = null) {
  if (!streamObj || !streamObj.messageDiv) return;
  
  const { messageDiv, textContainer, actionsDiv, playBtn, pauseBtn, copyBtn, deleteBtn } = streamObj;
  
  // Remove streaming class
  messageDiv.classList.remove('streaming-message');
  messageDiv.classList.add('model-message');

  // Re-render the accumulated plain text as sentence spans now that the
  // reply is complete, so highlightSentence has something to target.
  textContainer.classList.remove('streaming-text');
  renderSentenceSpans(textContainer, originalText);

  // Enable action buttons
  playBtn.style.opacity = '1';
  pauseBtn.style.opacity = '1';
  copyBtn.style.opacity = '1';
  deleteBtn.style.opacity = '1';
  
  // Set up TTS button
  playBtn.onclick = () => {
    if (typeof window.playTTS === 'function') {
      if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'play', source: 'message' });
      window.playTTS(originalText, languageCode, messageDiv.id);
    }
  };
  
  // Set up stop TTS button
  pauseBtn.onclick = () => {
    if (typeof window.stopTTS === 'function') {
      if (typeof trackEvent === 'function') trackEvent('tts_action', { action: 'stop', source: 'message' });
      window.stopTTS();
    }
  };
  
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(originalText).then(() => {
      if (typeof trackEvent === 'function') trackEvent('message_copied');
      const oldHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅';
      setTimeout(() => copyBtn.innerHTML = oldHtml, 2000);
    });
  };
  
  // Set up delete button
  deleteBtn.onclick = () => {
    if (typeof window.deleteMessage === 'function') {
      if (typeof trackEvent === 'function') trackEvent('message_deleted');
      window.deleteMessage(messageDiv, originalText, false);
    }
  };
  
  // Add transliteration if provided
  if (transliterationText) {
    const transliterationSpan = document.createElement('span');
    transliterationSpan.className = 'message-transliteration-text';
    transliterationSpan.textContent = `(${transliterationText})`;
    messageDiv.appendChild(transliterationSpan);
  }
  
  // Add translation if provided
  if (translationText && originalText.trim() !== translationText.trim()) {
    const translationSpan = document.createElement('span');
    translationSpan.className = 'message-translation-text';
    translationSpan.textContent = `(EN: ${translationText})`;
    messageDiv.appendChild(translationSpan);
  }
  
  // Scroll to bottom
  chatHistory.scrollTop = chatHistory.scrollHeight;
  
  return messageDiv.id;
}

// Export for use in other modules
window.createStreamingMessage = createStreamingMessage;
window.updateStreamingMessage = updateStreamingMessage;
window.finalizeStreamingMessage = finalizeStreamingMessage;