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
  const index = conversationContext.findIndex(m => m.content === content && m.role === role);

  if (index !== -1) {
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

    if (!window.isWaitingForAIResponse) {
      preloadNextQueuedMessage();
    }
    return;
  }

  // If already processing and queueing NOT enabled, put the text back rather
  // than silently discarding what the user typed.
  if (isProcessing) {
    messageInput.value = message;
    debugLog('Busy and message queue disabled — message restored to the input box.', 'warn');
    return;
  }

  // Reset ambient timer and clear buffer on any user activity
  if (window.resetAmbientTimer) window.resetAmbientTimer();
  window.ambientPreloadBuffer = null;

  await sendMessageInternal(message);
}

// Tears down everything tied to the conversation that's being left behind.
//
// Switching or creating a chat used to be able to leave an in-flight reply
// running: TTS kept speaking, isProcessing stayed set, and the queued
// messages and ambient timer belonged to the previous conversation — so a
// reply could land in, and be saved to, the chat the user had just opened.
function resetConversationRuntime() {
  // Clear the queue first: stopTTS releases the response, and a non-empty
  // queue at that moment would immediately start sending into the new chat.
  window.userMessageQueue = [];
  window.preloadedQueuedResponse = null;
  window.isPreloadingQueuedMessage = false;

  if (typeof window.stopTTS === 'function') window.stopTTS();

  isProcessing = false;
  isAIResponding = false;
  window.isWaitingForAIResponse = false;

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

// Drops the oldest messages once the context exceeds the memory size.
function trimConversationContext() {
  while (conversationContext.length > maxMemorySize) {
    conversationContext.shift();
  }
}
window.trimConversationContext = trimConversationContext;

let isSummarizing = false;

// Compresses the oldest slice of the conversation into the running summary.
//
// Messages are removed by identity, never by index. This used to capture
// `slice(0, trigger)` and then, in a `.then()` that resolved much later, run
// `splice(0, trigger)` against an array that had been shifted and appended to
// in the meantime — deleting the wrong messages. It also deleted them even
// when the summary request had failed, since summarizeConversation used to
// swallow errors and return the previous summary.
async function maybeSummarizeConversation() {
  if (isSummarizing) return;
  if (window.isOfflineMode || window.forceOfflineMode) return;

  const trigger = window.summaryTriggerCount || 20;
  if (window.messageCountSinceLastSummary < trigger) return;
  if (conversationContext.length <= trigger) return;

  const summarized = conversationContext.slice(0, trigger);
  isSummarizing = true;
  debugLog(`Message threshold (${trigger}) reached. Summarizing ${summarized.length} messages...`, 'info');

  try {
    const newSummary = await summarizeConversation(summarized, window.conversationSummary);

    window.conversationSummary = newSummary;
    AppStorage.setString(AppStorage.KEYS.CONVERSATION_SUMMARY, newSummary);

    const summaryEl = document.getElementById('conversationSummary');
    if (summaryEl) summaryEl.value = newSummary;

    // Remove exactly the messages we summarized, wherever they sit now.
    const removed = new Set(summarized);
    const beforeSummarizeTrim = conversationContext.length;
    conversationContext = conversationContext.filter(m => !removed.has(m));
    AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, conversationContext);
    debugState('Conversation', 'summarize_trimmed', { before: beforeSummarizeTrim, after: conversationContext.length, removed: summarized.length });

    window.messageCountSinceLastSummary = 0;
    AppStorage.setNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, 0);
    debugLog('Conversation summarized and memory compressed.', 'info');
    updateSummaryMarker();

    if (window.ChatManager) {
      const activeId = window.ChatManager.getActiveChatId();
      if (activeId) window.ChatManager.saveCurrentChat(activeId);
    }
  } catch (e) {
    // Keep every message. Losing history to a failed network call is far
    // worse than carrying a slightly oversized context into the next request.
    debugError('Summarization failed — conversation history preserved', e, { messageCount: summarized.length });
  } finally {
    isSummarizing = false;
  }
}
window.maybeSummarizeConversation = maybeSummarizeConversation;

async function sendMessageInternal(message, isAmbient = false, cachedResponse = null, ttsPreloadBuffer = null) {
  let aiResponse = null;
  let originalReply = '';
  let messageId = null;

  if (typeof trackEvent === 'function' && !isAmbient) {
    trackEvent('chat_message_sent');
  }

  debugState('ChatController', 'processing_start', { isProcessing: isProcessing, isAIResponding: isAIResponding });
  isProcessing = true;
  isAIResponding = true;

  debugLog(`Processing ${isAmbient ? 'ambient' : 'new'} message: "${message}"`, 'info');

  try {
    let userMsgId = null;
    if (!isAmbient) {
      userMsgId = addMessage(message, true, null, null, 'en-US');
      conversationContext.push({ role: "user", content: message, id: userMsgId });

      // Increment summary counter
      window.messageCountSinceLastSummary++;
      AppStorage.setNumber(AppStorage.KEYS.MESSAGE_COUNT_SINCE_LAST_SUMMARY, window.messageCountSinceLastSummary);

      // Runs in the background so it doesn't block the reply.
      maybeSummarizeConversation();

      trimConversationContext();
      AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, conversationContext);
      debugLog('Saved user message to conversation context', 'info');
      debugState('Conversation', 'user_msg_added', { count: conversationContext.length, maxMemory: maxMemorySize });
      updateSummaryMarker();

      if (window.ChatManager) {
        const activeId = window.ChatManager.getActiveChatId();
        if (activeId) window.ChatManager.saveCurrentChat(activeId);
      }
    }

    // Any configured provider (Groq, OpenRouter, OpenAI-compatible) streams —
    // this used to gate the streaming UI on OpenRouter specifically, so Groq
    // and OpenAI-compatible users got a plain typing indicator followed by an
    // instant full message instead of the live streaming UI, even though the
    // underlying request was already streaming.
    const useStreaming = typeof resolveLLMProvider === 'function' && !!resolveLLMProvider();

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
        // ── STREAMING PATH ──
        const streamObj = createStreamingMessage(selectedLanguageCode);
        let streamingReplyText = '';

        aiResponse = await getAIResponse(message, selectedLanguageCode, {
          stream: true,
          onChunk: (text) => {
            streamingReplyText = text;
            updateStreamingMessage(streamObj, text);
          },
          onComplete: () => {
            debugLog('Streaming complete, full data received', 'info');
          }
        });

        originalReply = aiResponse.reply;
        if (streamingReplyText && streamingReplyText.length > originalReply.length) {
          originalReply = streamingReplyText;
        }

        // Finalize exactly once. Transliteration arrives later and is
        // appended to the finished element — calling finalize a second time
        // used to duplicate the action buttons and append a second text block.
        messageId = finalizeStreamingMessage(streamObj, originalReply, selectedLanguageCode, null, null);

        if (!aiResponse.isError && showTransliteration && (selectedLanguageCode === 'ja-JP' || selectedLanguageCode === 'ko-KR')) {
          getTransliteration(originalReply, selectedLanguageCode).then(trans => {
            if (trans && typeof appendTransliteration === 'function') appendTransliteration(streamObj.messageDiv, trans);
          });
        }
      } else {
        // ── NON-STREAMING PATH (no provider configured / offline fallback) ──
        showTypingIndicator(true);
        aiResponse = await getAIResponse(message, selectedLanguageCode);
        showTypingIndicator(false);

        originalReply = aiResponse.reply;
        let transliterationText = null;

        if (!aiResponse.isError && showTransliteration && (selectedLanguageCode === 'ja-JP' || selectedLanguageCode === 'ko-KR')) {
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

    // Flagged by getAIResponse rather than string-compared, so it survives
    // translation and rewording of the connection-error text.
    const isErrorReply = aiResponse.isError === true;

    // A connection-error notice is UI feedback, not dialogue. Storing it
    // meant feeding "I'm having trouble connecting" back to the model as its
    // own turn.
    if (!isErrorReply) {
      conversationContext.push({
        role: "assistant",
        content: originalReply,
        id: messageId
      });
      const contextBeforeTrim = conversationContext.length;
      trimConversationContext();
      if (contextBeforeTrim !== conversationContext.length) {
        debugState('Conversation', 'context_trimmed', { before: contextBeforeTrim, after: conversationContext.length, maxMemory: maxMemorySize });
      }
      AppStorage.setJSON(AppStorage.KEYS.CONVERSATION_CONTEXT, conversationContext);
      debugLog('Saved AI response to conversation context and trimmed.', 'info');
      debugState('Conversation', 'assistant_msg_added', { count: conversationContext.length, maxMemory: maxMemorySize });
      updateSummaryMarker();

      if (window.ChatManager) {
        const activeId = window.ChatManager.getActiveChatId();
        if (activeId) {
          window.ChatManager.saveCurrentChat(activeId);
          const meta = window.ChatManager.getChatMeta(activeId);
          if (meta && meta.name === 'New Chat' && meta.messageCount >= 2 && typeof generateChatTitle === 'function') {
            generateChatTitle(activeId);
          }
        }
      }
    } else {
      debugLog('Connection-error reply shown to user but kept out of conversation context.', 'warn');
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
        // notifyOnComplete=true: this playback owns the response lifecycle
        // and must release isProcessing when it drains. Manual per-message
        // playback passes false so it can't advance the user message queue
        // out of turn.
        playTTS(originalReply, selectedLanguageCode, messageId, 0, ttsPreloadBuffer, true);
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
  // Idempotent: several paths can reach here for the same response (TTS
  // drain, TTS error, the catch in sendMessageInternal). Without this guard a
  // double call shifts two messages off the queue and only sends one of them.
  if (!isProcessing && !isAIResponding) {
    debugLog('AI response already finalized, ignoring duplicate completion.', 'info');
    return;
  }

  debugLog('AI response and TTS fully finished.', 'info');
  debugState('ChatController', 'processing_end', { isProcessing: isProcessing, isAIResponding: isAIResponding, queueRemaining: userMessageQueue.length });
  isProcessing = false;
  isAIResponding = false;
  window.isWaitingForAIResponse = false;

  // Process next message from queue if available
  if (userMessageQueue.length > 0) {
    const nextMsg = userMessageQueue.shift();

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
    if (window.resetAmbientTimer) window.resetAmbientTimer();
  }
}

async function preloadNextQueuedMessage() {
  if (userMessageQueue.length === 0 || window.isPreloadingQueuedMessage || window.preloadedQueuedResponse) {
    return;
  }

  const nextMsg = userMessageQueue[0];
  debugLog(`Preloading next queued message: "${nextMsg}"`, 'info');

  window.isPreloadingQueuedMessage = true;

  try {
    const response = await getAIResponse(nextMsg, selectedLanguageCode);

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
