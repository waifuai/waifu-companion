function addMessage(originalText, isUser, translationText = null, transliterationText = null, languageCode = 'en-US') {
  // Assumes chatHistory is accessible
  const messageDiv = document.createElement("div");
  messageDiv.id = `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
    // Wrap sentences in spans for highlighting
    const sentences = typeof splitIntoSentences === 'function' ? splitIntoSentences(originalText) : [originalText];
    sentences.forEach((sentence, idx) => {
      const sentenceSpan = document.createElement('span');
      sentenceSpan.className = 'sentence-chunk';
      sentenceSpan.dataset.index = idx;
      sentenceSpan.textContent = sentence + ' ';
      originalSpan.appendChild(sentenceSpan);
    });
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
  debugLog('Clearing chat history and localStorage', 'info');
  chatHistory.innerHTML = '';
  conversationContext = [];
  localStorage.removeItem('conversationContext');
}

function populateModelSelector() {
  // Populate the dropdown list
  function modelComparator(a,b){const an=a.name||'',bn=b.name||'';const ai=/^\d+$/.test(an)?parseInt(an,10):null;const bi=/^\d+$/.test(bn)?parseInt(bn,10):null;if(ai===null&&bi===null)return an.localeCompare(bn);if(ai===null)return -1;if(bi===null)return 1;const ab=ai<10?0:1;const bb=bi<10?0:1;return ab!==bb?ab-bb:ai-bi;}
  availableModels.slice().sort(modelComparator).forEach(model => {
    const listItem = document.createElement('li');
    listItem.textContent = model.name;
    modelSelector.appendChild(listItem);
  });
}

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
  messageDiv.id = `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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