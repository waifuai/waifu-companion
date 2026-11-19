const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client() {
  const calls = [];
  const context = vm.createContext({
    window: {}, URLSearchParams,
    crypto: {},
    sessionStorage: { getItem: () => 'mock-session' },
    AppStorage: { getItem: () => 'mock-visitor' },
    async fetch(url, options) { calls.push({ url, options }); throw new Error('no network expected'); }
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/waifu_proxy.js'), 'utf8'), context);
  return { api: context.window.WaifuProxyAPI, calls };
}

test('image generation is a local no-op with a clear unavailable outcome', async () => {
  const { api, calls } = client();
  const result = await api.generateImage('Mock picture', '3:2', 42, 'background');
  assert.equal(result.unavailable, true);
  assert.equal(result.local, true);
  assert.equal(result.url, undefined);
  assert.equal(calls.length, 0);
});

test('no endpoint constants point at a retired public service', () => {
  const { api } = client();
  for (const key of ['API_URL', 'IMAGE_URL', 'TRANSCRIBE_URL', 'TTS_URL', 'DECISIONS_URL']) {
    assert.equal(api[key], '', key);
  }
  assert.equal(api.isConfigured(), false);
});

test('decision and transcription methods cannot reach the network', async () => {
  const { api, calls } = client();
  assert.equal(await api.decide(['picture_action_v1'], {}), null);
  await assert.rejects(() => api.transcribeAudio(new Blob(['audio'])));
  await assert.rejects(() => api.createCompletion({ messages: [] }));
  await assert.rejects(() => api.createCompletionStream({ messages: [] }));
  assert.equal(calls.length, 0);
});
