// Assumes debugLog, isProcessing, messageInput, addMessage, conversationContext, maxMemorySize,
// showTypingIndicator, getAIResponse, currentModel, playTTS,
// selectedLanguageCode, translateToLanguageCode, showTransliteration,
// getTranslatedText, getTransliteration (from ai_interface.js) are accessible via window or config.js

function deleteMessage(messageElement, content, isUser) {
  // Remove from UI with a small fade effect
  messageElement.style.opacity = '0';
  messageElement.style.transform = 'scale(0.9)';
  messageElement.style.transition = 'all 0.2s ease';

  setTimeout(() => {
    messageElement.remove();
  }, 200);

  // Remove from conversationContext
  const role = isUser ? 'user' : 'assistant';
  // Use findLastIndex to target the specific instance if there are duplicates (more likely to delete the one clicked)
  // However, simple findIndex is usually enough for most cases.
  const index = conversationContext.findIndex(m => m.content === content && m.role === role);

  if (index !== -1) {
    conversationContext.splice(index, 1);
    try {
      localStorage.setItem('conversationContext', JSON.stringify(conversationContext));
      debugLog(`Message deleted from context: "${content.substring(0, 30)}..."`, 'info');
      debugState('Conversation', 'message_deleted', { role: role, remainingContext: conversationContext.length });

      // Save to chat manager
      if (window.ChatManager) {
        const activeId = window.ChatManager.getActiveChatId();
        if (activeId) window.ChatManager.saveCurrentChat(activeId);
      }
    } catch (e) {
      debugError('Failed to update localStorage after message deletion', e, { key: 'conversationContext' });
    }
  } else {
    debugLog('Message removed from UI, but not found in conversationContext (may have been a system/sample message).', 'info');
  }
}
window.deleteMessage = deleteMessage;

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Clear input immediately to prevent double-processing or STT interference
  messageInput.value = "";
  if (window.hasOwnProperty('sttFinalTranscript')) {
    window.sttFinalTranscript = "";
  }

  // If already processing and queueing is enabled, add to queue
  if (isProcessing && isUserMessageQueueEnabled) {
    userMessageQueue.push(message);
    debugLog(`Message queued: "${message}" (Queue length: ${userMessageQueue.length})`, 'info');
    updateQueueUI();

    // If we are not currently waiting for the LLM to respond to the previous message, 
    // we can start preloading this newly queued message immediately.
    if (!window.isWaitingForAIResponse) {
      preloadNextQueuedMessage();
    }
    return;
  }

  // If already processing and queueing NOT enabled, ignore (default behavior)
  if (isProcessing) return;

  // Reset ambient timer and clear buffer on any user activity
  if (window.resetAmbientTimer) window.resetAmbientTimer();
  window.ambientPreloadBuffer = null;

  await sendMessageInternal(message);
}

async function sendMessageInternal(message, isAmbient = false, cachedResponse = null, ttsPreloadBuffer = null) {
  if (typeof trackEvent === 'function' && !isAmbient) {
    trackEvent('chat_message_sent');
  }

  debugState('ChatController', 'processing_start', { isProcessing: isProcessing, isAIResponding: isAIResponding });
  isProcessing = true;
  isAIResponding = true;

  // If ambient triggered, we already cleared the input (no-op)
  // but if called from somewhere else, we ensure it's logged correctly.
  debugLog(`Processing ${isAmbient ? 'ambient' : 'new'} message: "${message}"`, 'info');

  try {
    let userMsgId = null;
    if (!isAmbient) {
      userMsgId = addMessage(message, true, null, null, 'en-US');
      conversationContext.push({ role: "user", content: message, id: userMsgId });

      // Increment summary counter
      window.messageCountSinceLastSummary++;
      localStorage.setItem('messageCountSinceLastSummary', window.messageCountSinceLastSummary.toString());

      // Check if it's time to summarize (every N messages, user defined)
      const trigger = window.summaryTriggerCount || 20;
      const canSummarize = !window.isOfflineMode && !window.forceOfflineMode;

      if (canSummarize && window.messageCountSinceLastSummary >= trigger && conversationContext.length >= trigger) {
        debugLog(`Message threshold (${trigger}) reached. Triggering conversation summarization...`, 'info');
        const messagesToSummarize = conversationContext.slice(0, trigger);

        // Perform summarization asynchronously so it doesn't block the reply
        summarizeConversation(messagesToSummarize, window.conversationSummary).then(newSummary => {
          window.conversationSummary = newSummary;
          localStorage.setItem('conversationSummary', newSummary);

          // Update UI if summary area exists
          const summaryEl = document.getElementById('conversationSummary');
          if (summaryEl) summaryEl.value = newSummary;

          // Remove the summarized messages from context
          const beforeSummarizeTrim = conversationContext.length;
          conversationContext.splice(0, trigger);
          localStorage.setItem('conversationContext', JSON.stringify(conversationContext));
          debugState('Conversation', 'summarize_trimmed', { before: beforeSummarizeTrim, after: conversationContext.length, removed: trigger });

          // Reset counter
          window.messageCountSinceLastSummary = 0;
          localStorage.setItem('messageCountSinceLastSummary', '0');
          debugLog('Conversation summarized and memory compressed.', 'info');
          debugState('Conversation', 'summarized', { messagesRemoved: trigger, remainingContext: conversationContext.length });
          updateSummaryMarker();

          // Save to chat manager
          if (window.ChatManager) {
            const activeId = window.ChatManager.getActiveChatId();
            if (activeId) window.ChatManager.saveCurrentChat(activeId);
          }
        });
      }

      while (conversationContext.length > maxMemorySize) {
        conversationContext.shift();
      }
      localStorage.setItem('conversationContext', JSON.stringify(conversationContext));
      debugLog('Saved user message to conversation context', 'info');
      debugState('Conversation', 'user_msg_added', { count: conversationContext.length, maxMemory: maxMemorySize });
      updateSummaryMarker();

      // Save to chat manager
      if (window.ChatManager) {
        const activeId = window.ChatManager.getActiveChatId();
        if (activeId) window.ChatManager.saveCurrentChat(activeId);
      }
    }

    // Determine if we should use streaming (only with OpenRouter)
    const useStreaming = window.useOpenRouter && window.openRouterApiKey && window.openRouterModel;

    if (cachedResponse) {
      aiResponse = cachedResponse;
      originalReply = aiResponse.reply;
      let transliterationText = null;
      if (showTransliteration && (selectedLanguageCode === 'ja-JP' || selectedLanguageCode === 'ko-KR')) {
        transliterationText = await getTransliteration(originalReply, selectedLanguageCode);
      }
      messageId = addMessage(originalReply, false, null, transliterationText, selectedLanguageCode);
    } else {
      window.isWaitingForAIResponse = true;
      debugState('ChatController', 'waiting_for_ai', { isWaiting: true });
      
      if (useStreaming) {
        // ── STREAMING PATH (OpenRouter) ──
        const streamObj = createStreamingMessage(selectedLanguageCode);
        let streamingReplyText = '';

        aiResponse = await getAIResponse(isAmbient ? message : message, selectedLanguageCode, {
          stream: true,
          onChunk: (text) => {
            streamingReplyText = text;
            updateStreamingMessage(streamObj, text);
          },
          onComplete: (fullData) => {
            debugLog('Streaming complete, full data received', 'info');
          }
        });

        originalReply = aiResponse.reply;
        if (streamingReplyText && streamingReplyText.length > originalReply.length) {
          originalReply = streamingReplyText;
        }

        let transliterationText = null;
        const isErrorReply = originalReply === "Oh no... I'm having trouble connecting. Could we try again in a moment?";

        if (!isErrorReply && showTransliteration && (selectedLanguageCode === 'ja-JP' || selectedLanguageCode === 'ko-KR')) {
          getTransliteration(originalReply, selectedLanguageCode).then(trans => {
            transliterationText = trans;
            finalizeStreamingMessage(streamObj, originalReply, selectedLanguageCode, transliterationText, null);
          });
        }

        messageId = finalizeStreamingMessage(streamObj, originalReply, selectedLanguageCode, null, null);
      } else {
        // ── NON-STREAMING PATH (WebSim / Offline) ──
        showTypingIndicator(true);
        aiResponse = await getAIResponse(message, selectedLanguageCode);
        showTypingIndicator(false);

        originalReply = aiResponse.reply;
        let transliterationText = null;
        const isErrorReply = originalReply === "Oh no... I'm having trouble connecting. Could we try again in a moment?";

        if (!isErrorReply && showTransliteration && (selectedLanguageCode === 'ja-JP' || selectedLanguageCode === 'ko-KR')) {
          transliterationText = await getTransliteration(originalReply, selectedLanguageCode);
        }

        messageId = addMessage(originalReply, false, null, transliterationText, selectedLanguageCode);
      }
      
      window.isWaitingForAIResponse = false;
      debugState('ChatController', 'ai_responded', { isWaiting: false });
    }

    // Apply settings updates if requested by AI and allowed by user
    if (aiResponse.settingsUpdate && window.allowAIModSettings) {
      if (typeof window.applyAIProposedSettings === 'function') {
        window.applyAIProposedSettings(aiResponse.settingsUpdate);
      }
    }

    const isErrorReply = originalReply === "Oh no... I'm having trouble connecting. Could we try again in a moment?";

    conversationContext.push({
      role: "assistant",
      content: originalReply,
      id: messageId
    });
    // Trim again after assistant reply to respect memory size
    const contextBeforeTrim = conversationContext.length;
    while (conversationContext.length > maxMemorySize) {
      conversationContext.shift();
    }
    if (contextBeforeTrim !== conversationContext.length) {
      debugState('Conversation', 'context_trimmed', { before: contextBeforeTrim, after: conversationContext.length, maxMemory: maxMemorySize });
    }
    localStorage.setItem('conversationContext', JSON.stringify(conversationContext));
    debugLog('Saved AI response to conversation context and trimmed.', 'info');
    debugState('Conversation', 'assistant_msg_added', { count: conversationContext.length, maxMemory: maxMemorySize });
    updateSummaryMarker();

    // Save to chat manager
    if (window.ChatManager) {
      const activeId = window.ChatManager.getActiveChatId();
      if (activeId) {
        window.ChatManager.saveCurrentChat(activeId);
        // Generate title from first message if chat is still named "New Chat"
        const meta = window.ChatManager.getChatMeta(activeId);
        if (meta && meta.name === 'New Chat' && meta.messageCount >= 2 && typeof generateChatTitle === 'function') {
          generateChatTitle(activeId);
        }
      }
    }

    // Trigger preloading for next queued message if available
    if (window.isUserMessageQueueEnabled && userMessageQueue.length > 0) {
      preloadNextQueuedMessage();
    }

    if (currentModel && !isErrorReply) {
      // Enhanced emotion responses with more varied animations
      switch (aiResponse.emotion) {
        case "happy":
          currentModel.expression("f04");
          currentAnimationState.targetBodyAngle = Math.random() * 10 - 5;
          setTimeout(() => { currentAnimationState.targetBodyAngle = 0; }, 3000);
          break;
        case "sad":
          currentModel.expression("f03");
          currentModel.internalModel.coreModel.setParameterValueById("ParamBrowY", -1);
          currentAnimationState.targetHeadAngle = -8;
          setTimeout(() => { currentAnimationState.targetHeadAngle = 0; }, 4000);
          break;
        case "surprised":
          currentModel.expression("f02");
          currentModel.internalModel.coreModel.setParameterValueById("ParamEyeLOpen", 2);
          currentModel.internalModel.coreModel.setParameterValueById("ParamEyeROpen", 2);
          currentAnimationState.targetHeadAngle = (Math.random() - 0.5) * 15;
          setTimeout(() => { currentAnimationState.targetHeadAngle = 0; }, 2000);
          break;
        case "thoughtful":
          currentModel.expression("f04");
          currentModel.internalModel.coreModel.setParameterValueById("ParamBrowY", 0.5);
          currentAnimationState.targetHeadAngle = Math.random() > 0.5 ? 12 : -12;
          setTimeout(() => { currentAnimationState.targetHeadAngle = 0; }, 5000);
          break;
        case "excited":
          currentModel.motion("tap_body");
          currentModel.expression("f01");
          currentAnimationState.targetBodyAngle = 15;
          setTimeout(() => {
            currentAnimationState.targetBodyAngle = -10;
            setTimeout(() => { currentAnimationState.targetBodyAngle = 0; }, 1000);
          }, 1000);
          break;
        default:
          currentModel.expression("f00");
          currentAnimationState.targetHeadAngle = 0;
          currentAnimationState.targetBodyAngle = 0;
      }
    }

    const langConfig = languages.find(l => l.code === selectedLanguageCode) || languages.find(l => l.code === 'en-US');
    const voiceId = selectedVoiceId || langConfig.defaultVoiceId;
    debugLog(`TTS Queue: Using voice ID: ${voiceId} for language: ${langConfig.englishName}`, 'info');

    // Initiate TTS playback
    if (window.enableVoice && !isErrorReply) {
      try {
        playTTS(originalReply, selectedLanguageCode, messageId, 0, ttsPreloadBuffer);
      } catch (e) {
        debugError('TTS call failed (playTTS threw)', e, {
          messageId: messageId,
          language: selectedLanguageCode,
          voiceId: voiceId,
          replyLen: originalReply?.length
        });
        onAIResponseFullyFinished(); // Fallback if TTS fails immediately
      }
    } else {
      if (!window.enableVoice) debugLog('TTS is disabled, skipping playback.', 'info');
      else if (isErrorReply) debugLog('TTS skipped for error message.', 'info');
      
      onAIResponseFullyFinished(); // Trigger next task immediately if no TTS
    }

    debugLog(`AI response complete. Emotion: ${aiResponse.emotion}. Waiting for TTS to finish...`, 'info');

    // Trigger preloading if enabled
    if (window.isAmbientQueueEnabled && window.isAmbientPreloadEnabled) {
      if (typeof window.preloadNextAmbientMessage === 'function') {
        window.preloadNextAmbientMessage();
      }
    }

  } catch (err) {
    debugError('Message processing failed', err, {
      messagePreview: message.substring(0, 80),
      isAmbient: isAmbient,
      hadCachedResponse: !!cachedResponse,
      contextSize: conversationContext?.length,
      queueSize: userMessageQueue?.length
    });
    window.isWaitingForAIResponse = false;
    addMessage("Sorry, something went wrong while processing your message.", false);
    showTypingIndicator(false);
    onAIResponseFullyFinished(); // Ensure processing flag is reset on error
  }
}

function onAIResponseFullyFinished() {
  debugLog('AI response and TTS fully finished.', 'info');
  debugState('ChatController', 'processing_end', { isProcessing: isProcessing, isAIResponding: isAIResponding, queueRemaining: userMessageQueue.length });
  isProcessing = false;
  isAIResponding = false;
  window.isWaitingForAIResponse = false;

  // Process next message from queue if available
  if (userMessageQueue.length > 0) {
    const nextMsg = userMessageQueue.shift();
    
    // Check if we have a preloaded response for this message
    if (window.preloadedQueuedResponse && window.preloadedQueuedResponse.message === nextMsg) {
      debugLog(`Using preloaded response for: "${nextMsg}"`, 'info');
      const cached = window.preloadedQueuedResponse.response;
      window.preloadedQueuedResponse = null;
      updateQueueUI();
      sendMessageInternal(nextMsg, false, cached);
    } else {
      debugLog(`Processing next message from queue: "${nextMsg}"`, 'info');
      updateQueueUI();
      sendMessageInternal(nextMsg);
    }
  } else {
    // If no queued messages, restart ambient timer
    if (window.resetAmbientTimer) window.resetAmbientTimer();
  }
}

async function preloadNextQueuedMessage() {
  // If no queue, already preloading, or already have a preload, skip
  if (userMessageQueue.length === 0 || window.isPreloadingQueuedMessage || window.preloadedQueuedResponse) {
    return;
  }

  const nextMsg = userMessageQueue[0];
  debugLog(`Preloading next queued message: "${nextMsg}"`, 'info');
  
  window.isPreloadingQueuedMessage = true;
  
  try {
    // Note: getAIResponse uses the global conversationContext which has already 
    // been updated with the current assistant response.
    const response = await getAIResponse(nextMsg, selectedLanguageCode);
    
    // Double check queue hasn't changed or been cleared during await
    if (userMessageQueue.length > 0 && userMessageQueue[0] === nextMsg) {
      window.preloadedQueuedResponse = {
        message: nextMsg,
        response: response
      };
      debugLog(`Preloaded response for queued message: "${nextMsg}"`, 'info');
    } else {
      debugLog(`Preload for "${nextMsg}" discarded because queue changed.`, 'warn');
    }
  } catch (e) {
    debugError('Failed to preload queued message', e, {
      messagePreview: nextMsg.substring(0, 80),
      queueSize: userMessageQueue.length,
      language: selectedLanguageCode
    });
  } finally {
    window.isPreloadingQueuedMessage = false;
  }
}

window.sendMessageInternal = sendMessageInternal;
window.onAIResponseFullyFinished = onAIResponseFullyFinished;
window.preloadNextQueuedMessage = preloadNextQueuedMessage;

function updateSummaryMarker() {
  if (!window.chatHistory) return;

  let marker = document.getElementById('summary-cutoff-marker');
  if (!marker) {
    marker = document.createElement('div');
    marker.id = 'summary-cutoff-marker';
    marker.className = 'summary-cutoff-marker';
    const lang = window.selectedLanguageCode || 'en-US';
    const text = (window.UI_STRINGS && window.UI_STRINGS[lang]?.summaryCutoffMarker) || "--- Summary Boundary ---";
    marker.innerHTML = `<span>${text}</span>`;
  }

  // Find the insertion point: just before the first message currently in conversationContext
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

  // If no context, the marker sits at the bottom of the chat history (or doesn't exist)
  if (window.chatHistory.children.length > 0) {
    window.chatHistory.appendChild(marker);
  } else {
    if (marker.parentNode) marker.remove();
  }
}
window.updateSummaryMarker = updateSummaryMarker;

function initChatController() {
  // Assumes messageInput is globally available (e.g., from config.js)
  if (window.messageInput) {
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
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
    sendButton.addEventListener('click', () => {
      sendMessage();
    });
  }
}

window.sendMessage = sendMessage;
