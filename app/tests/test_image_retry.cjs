const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client(responses, random = () => 0.5) {
  const calls = [];
  const math = Object.create(Math);
  math.random = random;
  const context = vm.createContext({
    window: {}, URLSearchParams, Math: math,
    crypto: {},
    sessionStorage: { getItem: () => 'mock-session' },
    AppStorage: { getItem: () => 'mock-visitor' },
    async fetch(url, options) {
      calls.push({ url: new URL(url), options });
      const response = responses[calls.length - 1];
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected extra request');
      return response;
    }
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/waifu_proxy.js'), 'utf8'), context);
  return { api: context.window.WaifuProxyAPI, calls };
}

const success = () => ({ ok: true, headers: new Headers({ 'X-Image-Url': 'https://image.test/result.webp' }) });
const failure = (status, blocked = false) => ({ ok: false, status, json: async () => ({ error: 'Mock image failure', blocked }) });

test('a successful first image request preserves its seed and makes one call', async () => {
  const { api, calls } = client([success()]);
  assert.equal((await api.generateImage('Mock picture', '3:2', 42)).url, 'https://image.test/result.webp');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('seed'), '42');
});

test('a transient failure retries with a different seed even on a random collision', async () => {
  const { api, calls } = client([failure(504), success()], () => 42.5 / 2147483647);
  assert.equal((await api.generateImage('Mock picture', '3:2', 42, 'background')).url, 'https://image.test/result.webp');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('seed'), '42');
  assert.equal(calls[1].url.searchParams.get('seed'), '43');
  for (const request of calls) {
    assert.equal(request.url.searchParams.get('text'), 'Mock picture');
    assert.equal(request.url.searchParams.get('aspect'), '3:2');
    assert.equal(request.options.headers['x-session-id'], 'mock-session');
    assert.equal(request.options.headers['x-visitor-id'], 'mock-visitor');
    assert.equal(request.options.headers['X-Waifu-Purpose'], 'background');
  }
});

test('network and server failures add a seed only to the second request', async () => {
  for (const first of [new Error('Mock network failure'), failure(502), failure(503)]) {
    const { api, calls } = client([first, success()]);
    await api.generateImage('Mock picture');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.searchParams.has('seed'), false);
    assert.match(calls[1].url.searchParams.get('seed'), /^\d+$/);
  }
});

test('a failed retry stops after two calls and keeps the error flags', async () => {
  for (const second of [failure(504), failure(502, true), new Error('Mock retry network failure')]) {
    const { api, calls } = client([failure(502), second]);
    await assert.rejects(api.generateImage('Mock picture'), error => {
      if (second instanceof Error) assert.equal(error, second);
      else {
        assert.equal(error.timedOut, second.status === 504);
        assert.equal(error.blocked, second.status === 502);
      }
      return true;
    });
    assert.equal(calls.length, 2);
  }
});

test('content blocks, malformed requests and overload are never retried', async () => {
  for (const [status, blocked] of [[502, true], [429, false], [400, false]]) {
    const { api, calls } = client([failure(status, blocked)]);
    await assert.rejects(api.generateImage('Mock picture'), error => error.blocked === blocked && error.timedOut === false);
    assert.equal(calls.length, 1);
  }
});
