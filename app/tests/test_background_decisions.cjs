const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client() {
  const calls = [];
  const context = vm.createContext({
    AppStorage: { KEYS: {}, getString: () => 'A cozy room at night' },
    document: { getElementById: () => null, addEventListener() {} },
    window: {},
    conversationContext: [{ role: 'user', content: 'Let us head to the beach' }],
    contextForModel: messages => messages,
    async callConfiguredLLM(...args) { calls.push(args); return { content: 'SCENE: A quiet beach' }; },
    debugLog() {}, debugError() {}, tr: (_k, fallback) => fallback
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/settings_handlers.js'), 'utf8'), context);
  return { context, calls };
}

test('background scenes are a local no-op with no decision or prompt calls', async () => {
  const { context, calls } = client();
  assert.equal(await context.getBackgroundScene(), null);
  assert.equal(await context.getBackgroundScene(true), null);
  assert.equal(calls.length, 0);
});

test('background generation makes no image request and reports a local outcome', async () => {
  const { context, calls } = client();
  let status = '';
  context.document.getElementById = id => (id === 'bgGenerateStatus' ? { set textContent(v) { status = v; } } : null);
  assert.equal(await context.generateBackground('A quiet beach', 'manual', 'ai_prompt'), false);
  assert.equal(calls.length, 0);
  assert.match(status, /unavailable in local-only mode/i);
});

test('automatic background updates never generate or decide', async () => {
  const { context, calls } = client();
  await context.maybeAutoBackground(null);
  await context.maybeAutoBackground(null);
  assert.equal(calls.length, 0);
});
