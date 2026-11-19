const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client() {
  const calls = [];
  const context = vm.createContext({
    crypto: {}, sessionStorage: { getItem: () => 'mock-session' },
    AppStorage: { getItem: () => 'mock-visitor' },
    URLSearchParams, FormData, Blob, AbortController,
    window: {},
    setTimeout: () => 0, clearTimeout() {},
    async fetch(url, options) { calls.push({ url, options }); throw new Error('no network expected'); }
  });
  for (const script of ['llm_provider_base.js', 'waifu_proxy.js']) {
    vm.runInContext(readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), context);
  }
  return { api: context.window.WaifuProxyAPI, calls };
}

test('the retired proxy never builds a request or makes a network call', async () => {
  const { api, calls } = client();
  assert.throws(() => api.buildRequest({ messages: [] }, false));
  await assert.rejects(() => api.createCompletion({ messages: [], purpose: 'chat' }));
  await assert.rejects(() => api.createCompletionStream({ messages: [], purpose: 'ambient' }));
  assert.equal(calls.length, 0);
});

test('request headers are empty: no session or visitor identity leaves the page', () => {
  const { api } = client();
  assert.equal(Object.keys(api.requestHeaders()).length, 0);
});

test('image, voice and decision endpoints cannot be reached', async () => {
  const { api, calls } = client();
  assert.equal((await api.generateImage('Mock picture', '1:1', null, 'background')).unavailable, true);
  assert.equal(await api.decide(['live2d_emotion_v1'], { reply: 'hi' }), null);
  await assert.rejects(() => api.transcribeAudio(new Blob(['mock audio'])));
  assert.equal(calls.length, 0);
});

test('the proxy is never selectable as a configured provider', () => {
  const { api } = client();
  assert.equal(api.isConfigured(), false);
  assert.equal(api.getModel(), 'local-fallback');
});
