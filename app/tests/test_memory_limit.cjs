const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(memory, trigger, store = new Map()) {
  if (memory !== undefined) store.set('MAX_MEMORY_SIZE', memory);
  if (trigger !== undefined) store.set('SUMMARY_TRIGGER_COUNT', trigger);
  const keys = new Proxy({}, { get: (_, key) => key });
  const elements = new Map(['memorySize', 'memorySizeValue', 'summaryTriggerCount', 'summaryTriggerCountValue']
    .map(id => [id, { value: 20, textContent: '', addEventListener() {} }]));
  const ctx = vm.createContext({
    document: { getElementById: id => elements.get(id) || null, addEventListener() {},
      documentElement: { style: { getPropertyValue: () => '0.9' } } },
    AppStorage: { KEYS: keys, getNumber: (key, fallback) => store.get(key) ?? fallback,
      getString: (key, fallback) => store.get(key) ?? fallback, getJSON: (key, fallback) => store.get(key) ?? fallback,
      setNumber: (key, value) => store.set(key, value), setString: (key, value) => store.set(key, value),
      setJSON: (key, value) => store.set(key, value) },
    memorySizeInput: elements.get('memorySize'), memorySizeValue: elements.get('memorySizeValue'),
    maxMemorySize: 20, conversationContext: JSON.parse(JSON.stringify(store.get('CONVERSATION_CONTEXT') || [])), addEventListener() {},
    debounced: (_, fn) => fn(), debugLog() {}, debugState() {}, debugError() {}, Date, setTimeout: () => 0,
  });
  ctx.window = ctx;
  ctx.ConversationBudget = require('../scripts/context_budget.js');
  for (const script of ['settings_handlers.js', 'chat_controller.js', 'ai_interface.js', 'app_init.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), ctx);
  }
  ctx.initMemory();
  ctx.initPersona();
  ctx.updateSummaryMarker = () => {};
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
  ctx.requestMemorySummary = async messages => { captured = messages; return 'Remembered facts'; };
  ctx.updateSummaryMarker = () => {};
  await ctx.maybeSummarizeConversation();
  assert.equal(captured.length, 2);
  assert.ok(captured[1].content.includes('message 0'));
  assert.equal(ctx.conversationContext.length, 10);
  assert.equal(ctx.conversationContext.at(-1).content, 'message 20');
  assert.equal(ctx.conversationSummary, 'Remembered facts');
});

function longConversation(ctx, size = 100) {
  ctx.conversationContext = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: 'message ' + i + 'x'.repeat(size) }));
}

test('size errors explain how to recover without exposing arbitrary server text', () => {
  const { ctx } = client();
  for (const error of [{ code: 'context_too_large' }, { status: 413, message: 'private server detail' }]) {
    const result = ctx.handleAIFailure(error);
    assert.equal(result.isError, true);
    assert.match(result.reply, /Update Summary from Chat/);
    assert.doesNotMatch(result.reply, /private server detail/);
  }
});
test('pending and failed summary work never trims source messages', async () => {
  const { ctx } = client(); longConversation(ctx);
  let finish;
  ctx.requestMemorySummary = () => new Promise(resolve => { finish = resolve; });
  const work = ctx.maybeSummarizeConversation(true);
  ctx.trimConversationContext();
  assert.equal(ctx.conversationContext.length, 30);
  ctx.conversationContext.push({ id: 'new', role: 'user', content: 'Newest input' });
  finish('Retained names and promises'); await work;
  assert.equal(ctx.conversationContext.at(-1).id, 'new');
  assert.equal(ctx.conversationContext.length, 5);
  longConversation(ctx);
  ctx.requestMemorySummary = async () => { throw Error('Offline'); };
  await assert.rejects(ctx.maybeSummarizeConversation(true), /Offline/);
  assert.equal(ctx.conversationContext.length, 30);
  assert.equal(ctx.conversationSummary, 'Retained names and promises');
});
test('oversized summary replies keep the old memory and all pending source', async () => {
  const { ctx } = client(); longConversation(ctx); ctx.conversationSummary = 'Existing facts';
  ctx.requestMemorySummary = async () => 'x'.repeat(4097);
  await assert.rejects(ctx.maybeSummarizeConversation(true), { code: 'summary_too_large' });
  assert.equal(ctx.conversationSummary, 'Existing facts');
  assert.equal(ctx.conversationContext.length, 30);
  assert.equal(ctx.summaryProgress, null);
});
test('reset and deleted-source results are stale and cannot overwrite current memory', async () => {
  for (const change of ['reset', 'delete']) {
    const { ctx } = client(); longConversation(ctx);
    let finish; ctx.requestMemorySummary = () => new Promise(resolve => { finish = resolve; });
    const work = ctx.maybeSummarizeConversation(true);
    if (change === 'reset') ctx.handleResetPersona();
    else ctx.deleteMessage({ style: {}, id: 'm0', remove() {} }, '', true);
    finish('Stale facts');
    assert.equal(await work, false);
    assert.notEqual(ctx.conversationSummary, 'Stale facts');
  }
});
test('large-message checkpoints survive reload and only completed source is removed', async () => {
  const first = client(); const { ctx, store } = first;
  ctx.conversationContext = [{ id: 'huge', role: 'user', content: '記憶🙂'.repeat(10000) },
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'keep' + i, role: i % 2 ? 'assistant' : 'user', content: 'Recent ' + i }))];
  ctx.requestMemorySummary = async () => 'Remembered facts';
  await ctx.maybeSummarizeConversation(true);
  assert.equal(ctx.conversationContext.length, 5);
  assert.ok(ctx.summaryProgress.partial.offset > 0);
  const reloaded = client(undefined, undefined, store).ctx;
  reloaded.conversationContext = JSON.parse(JSON.stringify(store.get('CONVERSATION_CONTEXT')));
  reloaded.requestMemorySummary = async () => 'Remembered facts';
  let calls = 0;
  while (reloaded.summaryProgress) { await reloaded.maybeSummarizeConversation(true); assert.ok(++calls < 15); }
  assert.equal(reloaded.conversationContext.length, 4);
  assert.equal(reloaded.conversationContext[0].id, 'keep0');
});
test('automatic partial compression runs once per user turn and failure has a cooldown', async () => {
  const { ctx } = client(); longConversation(ctx, 10000);
  let calls = 0; ctx.requestMemorySummary = async () => { calls++; return 'Facts'; };
  await ctx.maybeSummarizeConversation(); await ctx.maybeSummarizeConversation();
  assert.equal(calls, 1);
  ctx.conversationContext.push({ id: 'next', role: 'user', content: 'Next turn' });
  ctx.requestMemorySummary = async () => { calls++; throw Error('Offline'); };
  assert.equal(await ctx.maybeSummarizeConversation(), false);
  ctx.conversationContext.push({ id: 'another', role: 'user', content: 'Another turn' });
  assert.equal(await ctx.maybeSummarizeConversation(), false);
  assert.equal(calls, 2);
});

test('oversized legacy summary never blocks chat or prompts the user, using active summary within budget', async () => {
  const { ctx } = client();
  const legacySummary = 'Older facts about user and story. '.repeat(500);
  ctx.conversationSummary = legacySummary;
  ctx.conversationContext = [
    { role: 'user', content: 'prior question' },
    { role: 'assistant', content: 'prior answer' }
  ];
  ctx.buildContextInfo = async () => [];
  const messages = await ctx.buildChatMessages('new message', 'en-US');
  assert.ok(messages.length >= 2);
  const sysMsg = messages.find(m => m.role === 'system');
  assert.ok(sysMsg);
  assert.ok(sysMsg.content.includes('Existing Conversation Summary:'));
  assert.ok(Buffer.byteLength(sysMsg.content, 'utf8') < 10000);
  assert.equal(ctx.conversationSummary, legacySummary);
  const body = { model: 'waifuai-v1', messages, max_tokens: 2500, stream: true };
  assert.ok(Buffer.byteLength(JSON.stringify(body), 'utf8') <= 32768);
});

