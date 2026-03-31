function debugLog(message, type = 'log', isVerbose = false) {
  if (isVerbose && !window.showVerboseLogs) return;

  // Filter AI and TTS logs based on user preference
  const isAI = /AI|completion|completions/i.test(message);
  const isTTS = /TTS|preload|speech/i.test(message);

  if (isAI && window.showAIDebugLogs === false) return;
  if (isTTS && window.showTTSDebugLogs === false) return;

  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message,
    type
  };

  // Assumes debugHistory is accessible (defined in config.js or passed as argument)
  debugHistory.push(logEntry);

  // Assumes isDebugging and debugLogElement are accessible
  if (isDebugging) {
    const logElement = document.createElement('div');
    logElement.className = `debug-log ${type}`;
    logElement.textContent = `[${timestamp}] ${message}`;
    debugLogElement.appendChild(logElement);

    // Assumes autoScrollCheckbox is defined
    if (autoScrollCheckbox.checked) {
      logElement.scrollIntoView();
    }
  }
}

function debugError(message, error, context = {}) {
  const parts = [message];

  if (error) {
    if (error.name) parts.push(`Type=${error.name}`);
    if (error.message) parts.push(`Msg="${error.message}"`);
    if (error.stack) parts.push(`Stack="${error.stack.split('\n').slice(0, 3).join(' | ')}"`);
    if (error.status) parts.push(`HTTP=${error.status}`);
    if (error.code) parts.push(`Code=${error.code}`);
  }

  const ctxKeys = Object.keys(context);
  if (ctxKeys.length > 0) {
    parts.push(`Context={${ctxKeys.map(k => `${k}=${JSON.stringify(context[k])}`).join(', ')}}`);
  }

  debugLog(parts.join(' | '), 'error');
}

function debugNet(action, details = {}) {
  const parts = [`[Net] ${action}`];
  if (details.provider) parts.push(`Provider=${details.provider}`);
  if (details.url) parts.push(`URL=${details.url}`);
  if (details.method) parts.push(`Method=${details.method}`);
  if (details.status != null) parts.push(`Status=${details.status}`);
  if (details.statusText) parts.push(`StatusText="${details.statusText}"`);
  if (details.duration != null) parts.push(`Duration=${details.duration}ms`);
  if (details.model) parts.push(`Model=${details.model}`);
  if (details.messageCount != null) parts.push(`Msgs=${details.messageCount}`);
  if (details.promptTokens != null) parts.push(`PromptTokens=${details.promptTokens}`);
  if (details.completionTokens != null) parts.push(`CompletionTokens=${details.completionTokens}`);
  if (details.totalTokens != null) parts.push(`TotalTokens=${details.totalTokens}`);
  if (details.responseSize != null) parts.push(`ResponseSize=${details.responseSize}B`);
  if (details.errorType) parts.push(`ErrorType=${details.errorType}`);
  if (details.errorMsg) parts.push(`ErrorMsg="${details.errorMsg}"`);
  if (details.voice) parts.push(`Voice=${details.voice}`);
  if (details.textLen != null) parts.push(`TextLen=${details.textLen}`);
  debugLog(parts.join(' | '), details.errorType ? 'error' : 'info');
}

function debugState(component, change, details = {}) {
  const parts = [`[State] ${component}`];
  parts.push(`Change=${change}`);
  if (details.before != null) parts.push(`Before=${JSON.stringify(details.before)}`);
  if (details.after != null) parts.push(`After=${JSON.stringify(details.after)}`);
  if (details.count != null) parts.push(`Count=${details.count}`);
  if (details.key) parts.push(`Key=${details.key}`);
  debugLog(parts.join(' | '), 'info');
}

function toggleDebugger() {
  // Assumes isDebugging, debugPanel, enableDebuggerCheckbox are accessible
  isDebugging = !isDebugging;
  debugPanel.classList.toggle('visible');
  enableDebuggerCheckbox.checked = isDebugging;

  try {
    localStorage.setItem('debugPanelVisible', isDebugging.toString());
    if (typeof trackEvent === 'function') trackEvent('debug_panel_toggled', { visible: isDebugging });
  } catch (e) {
    debugLog(`Failed to persist debugPanelVisible: ${e.message}`, 'error');
  }
}

function copyDebugLog() {
  const text = debugLogElement ? debugLogElement.innerText : '';
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    // Brief visual feedback on the copy button
    const btn = document.querySelector('[data-action="copy-debug-log"]');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  }).catch(err => {
    debugLog('Failed to copy debug log: ' + err, 'error');
  });
}

function clearDebugLog() {
  // Assumes debugHistory and debugLogElement are accessible
  debugHistory = [];
  debugLogElement.innerHTML = '';
  if (typeof trackEvent === 'function') trackEvent('debug_log_cleared');
}

document.addEventListener('DOMContentLoaded', () => {
  const debugPanel = document.getElementById('debugPanel');
  if (!debugPanel || debugPanel.dataset.eventsBound === 'true') return;

  debugPanel.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl || !debugPanel.contains(actionEl)) return;

    switch (actionEl.dataset.action) {
      case 'clear-debug-log':
        clearDebugLog();
        break;
      case 'copy-debug-log':
        copyDebugLog();
        break;
      case 'toggle-debugger':
        toggleDebugger();
        break;
      default:
        break;
    }
  });

  debugPanel.dataset.eventsBound = 'true';
});

window.toggleDebugger = toggleDebugger;
window.copyDebugLog = copyDebugLog;
window.clearDebugLog = clearDebugLog;
