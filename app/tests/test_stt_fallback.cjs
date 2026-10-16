const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client({ browserSpeech = false, cloud = true, denied = false } = {}) {
  const listeners = {};
  const button = {
    style: { setProperty() {} }, dataset: {}, classList: { toggle() {} }, setAttribute() {},
    addEventListener(name, fn) { listeners[name] = fn; }
  };
  const selector = { value: 'webspeech' };
  const calls = { capture: 0, recognition: 0, saved: [], messages: [] };
  const input = { value: '', placeholder: 'Message' };
  const window = { sttEngine: 'webspeech', messageInput: input };
  if (cloud) window.WaifuProxyAPI = { transcribeAudio: async () => ({ text: 'Hello' }) };
  if (browserSpeech) {
    window.SpeechRecognition = class {
      start() {
        calls.recognition++;
        if (denied) this.onerror({ error: 'not-allowed' });
        else this.onstart();
      }
    };
  }
  class MediaRecorder {
    static isTypeSupported() { return true; }
    start() { this.state = 'recording'; }
  }
  window.MediaRecorder = MediaRecorder;
  const context = vm.createContext({
    window, MediaRecorder, Blob, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    navigator: { mediaDevices: { async getUserMedia() {
      calls.capture++;
      return { getTracks: () => [{ stop() {} }] };
    } } },
    document: {
      getElementById(id) { return id === 'micBtn' ? button : id === 'sttEngineSelector' ? selector : null; },
      querySelectorAll() { return []; }
    },
    debugLog() {}, debugError() {},
    addMessage(message) { calls.messages.push(message); },
    handleSttEngineChange(event) { calls.saved.push(event.target.value); }
  });
  for (const script of ['mic_capture.js', 'stt_controller.js']) {
    vm.runInContext(readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), context);
  }
  window.initSTT();
  return { window, calls, button, selector, click: () => listeners.click({ detail: 0 }) };
}

test('missing browser speech selects and starts cloud microphone capture', async () => {
  const c = client();
  assert.equal(c.window.sttEngine, 'proxy');
  assert.equal(c.selector.value, 'proxy');
  assert.deepEqual(c.calls.saved, ['proxy']);
  assert.notEqual(c.button.style.display, 'none');
  c.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.calls.capture, 1);
});

test('reselecting unsupported browser speech still starts cloud capture', async () => {
  const c = client();
  c.window.sttEngine = 'webspeech';
  c.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.window.sttEngine, 'proxy');
  assert.equal(c.calls.capture, 1);
});

test('supported browser speech keeps the selected engine', () => {
  const c = client({ browserSpeech: true });
  c.click();
  assert.equal(c.calls.recognition, 1);
  assert.equal(c.calls.capture, 0);
  assert.equal(c.window.sttEngine, 'webspeech');
});

test('browser microphone permission denial is displayed without starting cloud capture', () => {
  const c = client({ browserSpeech: true, denied: true });
  c.click();
  assert.equal(c.calls.capture, 0);
  assert.equal(c.window.sttEngine, 'webspeech');
  assert.match(c.calls.messages[0], /permission denied/i);
});

test('mic is hidden when neither speech engine is available', () => {
  const c = client({ cloud: false });
  assert.equal(c.button.style.display, 'none');
  c.click();
  assert.equal(c.calls.capture, 0);
});
