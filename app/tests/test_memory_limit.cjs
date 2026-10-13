const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(memory, trigger) {
  const store = new Map();
  if (memory !== undefined) store.set('MAX_MEMORY_SIZE', memory);
  if (trigger !== undefined) store.set('SUMMARY_TRIGGER_COUNT', trigger);
  const keys = new Proxy({}, { get: (_, key) => key });
  const elements = new Map(['memorySize', 'memorySizeValue', 'summaryTriggerCount', 'summaryTriggerCountValue']
    .map(id => [id, { value: 20, textContent: '', addEventListener() {} }]));
  const ctx = vm.createContext({
    document: { getElementById: id => elements.get(id) || null, addEventListener() {} },
    AppStorage: { KEYS: keys, getNumber: (key, fallback) => store.get(key) ?? fallback,
      getString: (key, fallback) => store.get(key) ?? fallback,
      setNumber: (key, value) => store.set(key, value), setString: (key, value) => store.set(key, value),
      setJSON: (key, value) => store.set(key, value) },
    memorySizeInput: elements.get('memorySize'), memorySizeValue: elements.get('memorySizeValue'),
    maxMemorySize: 20, conversationContext: [], addEventListener() {},
    debounced: (_, fn) => fn(), debugLog() {}, debugState() {}, debugError() {}, Date,
  });
  ctx.window = ctx;
  for (const script of ['settings_handlers.js', 'chat_controller.js', 'ai_interface.js', 'app_init.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), ctx);
  }
  ctx.initMemory();
  ctx.initPersona();
  return { ctx, store, elements };
}

test('returning browsers clamp saved 30 and 50 memory and summary settings to 20', () => {
  for (const saved of [30, 50]) {
    const { ctx, store, elements } = client(saved, saved);
    assert.equal(ctx.maxMemorySize, 20);
    assert.equal(ctx.summaryTriggerCount, 20);
    assert.equal(store.get('MAX_MEMORY_SIZE'), 20);
    assert.equal(store.get('SUMMARY_TRIGGER_COUNT'), 20);
    assert.equal(Number(elements.get('memorySize').value), 20);
    assert.equal(Number(elements.get('summaryTriggerCount').value), 20);
  }
});

test('fresh defaults and smaller saved choices are retained within the limit', () => {
  assert.equal(client().ctx.maxMemorySize, 20);
  const { ctx, store } = client(10, 5);
  assert.equal(ctx.maxMemorySize, 10);
  assert.equal(ctx.summaryTriggerCount, 5);
  assert.equal(store.get('MAX_MEMORY_SIZE'), 10);
});

test('programmatic settings and loaded long chats cannot send more than 20 history messages', async () => {
  const { ctx, store } = client(30, 30);
  ctx.updateMemorySize(50);
  assert.equal(store.get('MAX_MEMORY_SIZE'), 20);
  ctx.conversationContext = Array.from({ length: 35 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
  ctx.buildContextInfo = async () => [];
  ctx.buildSystemPrompt = () => 'Persona and memory summary';
  const messages = await ctx.buildChatMessages('message 34', 'en-US');
  assert.equal(messages.length, 21); // system prompt plus 20 recent messages
  assert.equal(messages[1].content, 'message 15');
  assert.equal(messages.at(-1).content, 'message 34');
  assert.equal(ctx.conversationContext.length, 35); // constructing a request does not erase stored chat
});

test('summary remains reachable after clamping a saved trigger above the memory limit', async () => {
  const { ctx } = client(30, 30);
  ctx.conversationContext = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: 'message ' + i }));
  ctx.messageCountSinceLastSummary = 20;
  let captured;
  ctx.summarizeConversation = async messages => { captured = messages; return 'Remembered facts'; };
  ctx.updateSummaryMarker = () => {};
  await ctx.maybeSummarizeConversation();
  assert.equal(captured.length, 20);
  assert.equal(ctx.conversationContext.length, 1);
  assert.equal(ctx.conversationContext[0].content, 'message 20');
  assert.equal(ctx.conversationSummary, 'Remembered facts');
});
