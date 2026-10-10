const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');

function client({ visitorStorage = new Map(), sessionStorage = new Map(), blocked = false } = {}) {
  const calls = [];
  const storage = map => ({
    getItem(key) { if (blocked) throw new Error('Storage unavailable'); return map.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); map.set(key, value); }
  });
  const context = vm.createContext({
    crypto: webcrypto, sessionStorage: storage(sessionStorage),
    AppStorage: {
      ...storage(visitorStorage), KEYS: {}, getString: (_key, value) => value,
      getJSON: (_key, value) => value, getBoolean: (_key, value) => value
    },
    URLSearchParams, FormData, Blob, window: {},
    debugNet() {}, debugError() {},
    async fetch(url, options) {
      calls.push({ url, ...options });
      return {
        ok: true, status: 200, body: { cancel: () => Promise.resolve() },
        headers: new Headers({ 'X-Image-Url': 'https://image.test/result.png' }),
        json: async () => ({ choices: [{ message: { content: 'Mock reply' } }], text: 'Mock transcript' })
      };
    }
  });
  for (const script of ['llm_provider_base.js', 'waifu_proxy.js']) {
    vm.runInContext(readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), context);
  }
  return { api: context.window.WaifuProxyAPI, calls };
}

test('internal completions share the chat identity through the HTTP transport', async () => {
  const { api, calls } = client();
  const messages = [{ role: 'user', content: 'Mock request' }];
  await api.createCompletion({ messages });
  const identity = calls[0].headers;
  assert.ok(identity['x-session-id']);
  assert.ok(identity['x-visitor-id']);
  for (const purpose of ['title', 'summary', 'ambient', 'image_prompt', 'background_prompt']) {
    for (const stream of [false, true]) {
      await api[stream ? 'createCompletionStream' : 'createCompletion']({ messages, purpose });
      const request = calls.at(-1);
      assert.equal(request.headers['x-session-id'], identity['x-session-id']);
      assert.equal(request.headers['x-visitor-id'], identity['x-visitor-id']);
      assert.equal(request.headers['X-Waifu-Purpose'], purpose);
      assert.equal(JSON.parse(request.body).stream, stream);
      assert.deepEqual(JSON.parse(request.body).messages, messages);
      assert.equal(JSON.parse(request.body).client_settings, undefined);
    }
  }
  assert.equal(identity['X-Waifu-Purpose'], undefined);
  assert.ok(JSON.parse(calls[0].body).client_settings);
});

test('an internal call can establish identity before the first chat', async () => {
  const { api, calls } = client();
  await api.createCompletion({ messages: [], purpose: 'summary' });
  await api.createCompletion({ messages: [] });
  assert.ok(calls[0].headers['x-session-id']);
  assert.ok(calls[0].headers['x-visitor-id']);
  for (const header of ['x-session-id', 'x-visitor-id']) {
    assert.equal(calls[0].headers[header], calls[1].headers[header]);
  }
});

test('image and speech calls share identity without overriding multipart content type', async () => {
  const { api, calls } = client();
  await api.createCompletion({ messages: [], purpose: 'image_prompt' });
  const identity = calls[0].headers;
  assert.equal((await api.generateImage('Mock picture', '1:1', null, 'background')).url, 'https://image.test/result.png');
  const audio = new Blob(['mock audio'], { type: 'audio/webm' });
  await api.transcribeAudio(audio, { filename: 'sample.webm', language: 'en', prompt: 'Mock hint' });
  for (const request of calls.slice(1)) {
    for (const header of ['x-session-id', 'x-visitor-id']) {
      assert.equal(request.headers[header], identity[header]);
    }
  }
  assert.equal(calls[1].headers['X-Waifu-Purpose'], 'background');
  const speech = calls[2];
  assert.equal(speech.headers['Content-Type'], undefined);
  assert.equal(speech.headers['content-type'], undefined);
  assert.ok(speech.body instanceof FormData);
  assert.equal(speech.body.get('file').name, 'sample.webm');
  assert.equal(speech.body.get('file').type, 'audio/webm');
  assert.equal(speech.body.get('language'), 'en');
  assert.equal(speech.body.get('prompt'), 'Mock hint');
});

test('existing stored IDs survive reload and the visitor ID survives a new tab', async () => {
  const visitorStorage = new Map([['waifuVisitorId', 'existing-visitor']]);
  const sessionStorage = new Map([['waifuSessionId', 'existing-session']]);
  for (let i = 0; i < 2; i++) {
    const { api, calls } = client({ visitorStorage, sessionStorage });
    await api.createCompletion({ messages: [], purpose: 'title' });
    assert.equal(calls[0].headers['x-visitor-id'], 'existing-visitor');
    assert.equal(calls[0].headers['x-session-id'], 'existing-session');
  }
  const { api, calls } = client({ visitorStorage });
  await api.createCompletion({ messages: [], purpose: 'ambient' });
  assert.equal(calls[0].headers['x-visitor-id'], 'existing-visitor');
  assert.notEqual(calls[0].headers['x-session-id'], 'existing-session');
});

test('unavailable storage still allows internal and speech requests', async () => {
  const { api, calls } = client({ blocked: true });
  await api.createCompletion({ messages: [], purpose: 'summary' });
  await api.transcribeAudio(new Blob(['mock audio']));
  for (const request of calls) {
    assert.equal(request.headers['x-session-id'], undefined);
    assert.equal(request.headers['x-visitor-id'], undefined);
  }
});
