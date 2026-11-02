const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function chatClient({ locale = 'en', crossChatMemory = true, userMemory = 'Name: Rei\nLikes: rain sounds', store = new Map() } = {}) {
  const keys = new Proxy({}, { get: (_, key) => key });
  const elements = new Map();
  const ctx = vm.createContext({
    document: {
      body: { dataset: {}, addEventListener() {} },
      getElementById: id => elements.get(id) || null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      addEventListener() {},
    },
    AppStorage: {
      KEYS: keys,
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      getString: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      getBoolean: (key, fallback) => { const v = store.get(key); return v === undefined ? fallback : v === 'true'; },
      getNumber: (key, fallback) => { const n = Number(store.get(key)); return Number.isFinite(n) ? n : fallback; },
      getJSON: (key, fallback) => { const v = store.get(key); return v === undefined || v === null ? fallback : JSON.parse(v); },
      setString: (key, value) => store.set(key, String(value)),
      setNumber: (key, value) => store.set(key, String(value)),
      setJSON: (key, value) => store.set(key, JSON.stringify(value)),
    },
    addMessage: () => 'msg-id',
    debugLog() {},
  });
  ctx.window = ctx;
  ctx.WaifuI18n = { locale, onChange() {} };
  ctx.ConversationBudget = require('../scripts/context_budget.js');
  const events = [];
  ctx.trackEvent = name => events.push(name);
  const hints = [];
  ctx.showWelcomeHint = () => { hints.push(1); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/chat_manager.js'), 'utf8'), ctx);
  ctx.crossChatMemory = crossChatMemory;
  ctx.userMemory = userMemory;
  return { ctx, store, events, hints };
}

test('a new chat greets a remembered visitor back and keeps the store', () => {
  const { ctx, events, hints } = chatClient();
  ctx.handleNewChat();
  assert.equal(ctx.conversationContext.length, 1);
  const greeting = ctx.conversationContext[0];
  assert.equal(greeting.userMemoryGreeting, true);
  assert.equal(greeting.role, 'assistant');
  assert.match(greeting.content, /^Nice to see you again! I remembered: Name: Rei; Likes: rain sounds — how have things been\?$/);
  assert.equal(ctx.userMemory, 'Name: Rei\nLikes: rain sounds');
  assert.ok(events.includes('cross_chat_memory_greeting'));
  assert.deepEqual(hints, []);
});

test('new chats keep the plain welcome hint while the toggle is off', () => {
  const { ctx, events, hints } = chatClient({ crossChatMemory: false });
  ctx.handleNewChat();
  assert.equal(ctx.conversationContext.length, 0);
  assert.equal(hints.length, 1);
  assert.deepEqual(events, []);
});

test('a non-English interface never gets the cross-chat greeting', () => {
  const { ctx, hints } = chatClient({ locale: 'ja' });
  ctx.handleNewChat();
  assert.equal(ctx.conversationContext.length, 0);
  assert.equal(hints.length, 1);
});

test('an empty store never greets', () => {
  const { ctx, hints } = chatClient({ userMemory: '' });
  ctx.handleNewChat();
  assert.equal(ctx.conversationContext.length, 0);
  assert.equal(hints.length, 1);
});

test('overlong store lines are clipped in the greeting', () => {
  const { ctx } = chatClient({ userMemory: 'x'.repeat(200) });
  ctx.handleNewChat();
  assert.match(ctx.conversationContext[0].content, /^Nice to see you again! I remembered: x{80}… — how have things been\?$/);
});
