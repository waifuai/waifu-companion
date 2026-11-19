const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client({ browserSpeech = false, denied = false } = {}) {
  const listeners = {};
  const button = {
    style: { setProperty() {} }, dataset: {}, classList: { toggle() {} }, setAttribute() {},
    addEventListener(name, fn) { listeners[name] = fn; }
  };
  const calls = { recognition: 0, messages: [], fetch: [] };
  const input = { value: '', placeholder: 'Message' };
  const window = { sttEngine: 'proxy', messageInput: input, selectedLanguageCode: 'en-US' };
  if (browserSpeech) {
    window.SpeechRecognition = class {
      start() {
        calls.recognition++;
        if (denied) this.onerror({ error: 'not-allowed' });
        else this.onstart();
      }
      abort() {}
      stop() {}
    };
  }
  const context = vm.createContext({
    window, Blob, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: {
      getElementById(id) { return id === 'micBtn' ? button : null; },
      querySelectorAll() { return []; }
    },
    debugLog() {}, debugError() {}, trackEvent() {},
    fetch: async (url) => { calls.fetch.push(url); throw new Error('no network expected'); },
    addMessage(message) { calls.messages.push(message); }
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/stt_controller.js'), 'utf8'), context);
  window.initSTT();
  return { window, calls, button, click: () => listeners.click({ detail: 0 }) };
}

test('supported browser speech is used and no engine selection is attempted', () => {
  const c = client({ browserSpeech: true });
  c.click();
  assert.equal(c.calls.recognition, 1);
  assert.equal(c.window.sttEngine, 'webspeech');
  assert.equal(c.calls.fetch.length, 0);
});

test('a retired proxy preference is reset to webspeech without any upload path', () => {
  const c = client({ browserSpeech: true });
  assert.equal(c.window.sttEngine, 'webspeech');
  assert.equal(c.calls.fetch.length, 0);
});

test('browser microphone permission denial is displayed without a network request', () => {
  const c = client({ browserSpeech: true, denied: true });
  c.click();
  assert.match(c.calls.messages[0], /permission denied/i);
  assert.equal(c.calls.fetch.length, 0);
});

test('mic is hidden when Web Speech is unavailable and no fallback engine is used', () => {
  const c = client();
  assert.equal(c.button.style.display, 'none');
  c.click();
  assert.equal(c.calls.recognition, 0);
  assert.equal(c.calls.fetch.length, 0);
});
