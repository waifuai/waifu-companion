const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime({ provider = null, withEngine = true } = {}) {
  const window = { LocalFallbackEngine: undefined };
  const calls = { provider: 0, logs: [] };
  const context = vm.createContext({
    window, console, debugLog: (...a) => calls.logs.push(a.join(' ')),
    debugError() {}, tr: (_k, fallback) => fallback,
    setTimeout, clearTimeout, AbortSignal, URL, URLSearchParams,
    document: { baseURI: 'https://example.test/app/', documentElement: { style: { getPropertyValue: () => '' } } },
    trackEvent() {}, trackError() {}, classifyError: () => 'network',
    conversationContext: [], maxMemorySize: 20, AppStorage: { getString: () => '2:3', KEYS: {} },
    ConversationBudget: {
      pack: (m) => ({ messages: m }),
      packUserMemory: () => '',
      activeSummary: () => '',
      pruneRepeatedReplies: (m) => m
    },
    clampMemorySetting: () => 20, currentAvatarAppearance: () => null,
    fetch: async () => { throw new Error('offline'); }
  });
  if (withEngine) {
    vm.runInContext(readFileSync(path.join(__dirname, '../scripts/local_fallback_engine.js'), 'utf8'), context);
  }
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/ai_interface.js'), 'utf8'), context);
  if (provider) {
    const c = context;
    c.performLLMRequest = async () => ({ ok: true, status: 200 });
    window.performLLMRequest = c.performLLMRequest;
    window.ConversationBudget = c.ConversationBudget;
    window.clampMemorySetting = c.clampMemorySetting;
    window.currentAvatarAppearance = c.currentAvatarAppearance;
    window.conversationContext = c.conversationContext;
    window.GroqAPI = {
      isConfigured: () => true,
      getModel: () => 'test-model',
      createCompletion: async () => { calls.provider++; throw new Error('network down'); }
    };
    window.useGroq = true;
  }
  return { window, context, calls };
}

test('failed chat turn gets a local reply with no isError', async () => {
  const r = runtime();
  const reply = await r.context.getAIResponse('hello there', 'en-US', { stream: false });
  assert.equal(reply.isFallback, true);
  assert.ok(reply.reply.length > 0);
  assert.notEqual(reply.isError, true);
});

test('word anchors do not fire on substrings', () => {
  const r = runtime();
  assert.equal(r.window.LocalFallbackEngine.getResponse('I was thinking about this').isFallback, true);
  assert.doesNotMatch(r.window.LocalFallbackEngine.getResponse('I was thinking about this').reply, /glad you're here/i);
});

test('no persisted offline mode between turns', async () => {
  const r = runtime({ provider: true });
  const first = await r.context.getAIResponse('hi', 'en-US', { stream: false });
  assert.equal(first.isFallback, true);
  assert.equal(r.calls.provider, 1);
  const second = await r.context.getAIResponse('hi again', 'en-US', { stream: false });
  assert.equal(second.isFallback, true);
  assert.equal(r.calls.provider, 2);
  assert.equal(r.window.forceOfflineMode, undefined);
  assert.equal(r.window.isOfflineMode, undefined);
});

test('actionable memory errors keep isError and skip the fallback', async () => {
  const r = runtime();
  const result = r.context.handleAIFailure({ code: 'memory_pending' }, 'hi');
  assert.equal(result.isError, true);
  assert.equal(result.isFallback, undefined);
  assert.match(result.reply, /Update Summary/i);
});

test('ambient preloads never consume the fallback', async () => {
  const r = runtime();
  const result = r.context.handleAIFailure(new Error('offline'), 'continue naturally', 'ambient');
  assert.equal(result.isError, true);
  assert.equal(result.isFallback, undefined);
});

test('missing engine degrades to the standard connection error', async () => {
  const r = runtime({ withEngine: false });
  const result = await r.context.getAIResponse('hello', 'en-US', { stream: false });
  assert.equal(result.isError, true);
  assert.equal(result.isFallback, undefined);
});
