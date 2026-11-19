const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(saved, embed = false, store = new Map()) {
  const key = 'ws_settings';
  if (saved !== undefined) store.set(key, JSON.stringify({ memorySize: saved, aboutUser: 'Remember me' }));
  const ctx = vm.createContext({ window: { WaifuSpritesEmbed: embed },
    Sprites: { EMOTIONS: ['happy'] }, Pictures: { CHAT_RULE: 'Picture instructions' }, navigator: {},
    crypto: require('node:crypto').webcrypto,
    AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
  });
  ctx.window.ConversationBudget = require('../context_budget.js');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chat.js'), 'utf8') + '\nthis.chat = Chat;', ctx);
  // Summary/body transport is still supported for bring-your-own-key providers;
  // opt this harness into one so those tests keep their original coverage.
  ctx.chat.settings.provider='custom';
  ctx.chat.settings.customBaseUrl='https://provider.test/v1';
  ctx.chat.settings.keys.custom='test-key';
  ctx.chat.settings.models.custom='test-model';
  return { chat: ctx.chat, store, key, ctx };
}

test('saved values above 100 are clamped and persisted for full and embedded clients', () => {
  for (const embed of [false, true]) for (const saved of [120, 150, 200]) {
    const { chat, store, key } = client(saved, embed);
    assert.equal(chat.settings.memorySize, 100);
    const persisted = JSON.parse(store.get(key));
    assert.equal(persisted.memorySize, 100);
    assert.equal(persisted.aboutUser, 'Remember me');
  }
});

function populate(chat, large = false) {
  chat.newConversation();
  for (let i = 0; i < 30; i++) chat.messages.push({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: 'item ' + i + 'x'.repeat(large ? 10000 : 100) });
}
function response(content) { return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }; }
test('failed and oversized results preserve both memory boundary and archive', async () => {
  for (const fail of ['offline', 'oversized']) {
    const { chat, ctx } = client(); populate(chat); chat.setSummary('Existing facts');
    ctx.fetch = async () => { if (fail === 'offline') throw Error('Offline'); return response('x'.repeat(32769)); };
    await assert.rejects(chat.summarize(true));
    assert.equal(chat.summary, 'Existing facts');
    assert.equal(chat.unsummarizedStart(), 0);
    assert.equal(chat.messages.length, 30);
  }
});
test('chat switches and manual edits invalidate an in-flight summary', async () => {
  for (const action of ['switch', 'edit', 'delete']) {
    const { chat, ctx } = client(); populate(chat);
    let finish; ctx.fetch = () => new Promise(resolve => { finish = resolve; });
    const work = chat.summarize(true);
    if (action === 'switch') chat.newConversation();
    else if (action === 'edit') chat.setSummary('Edited memory');
    else chat.deleteMessage('m0');
    finish(response('Stale result'));
    assert.equal(await work, false);
    assert.notEqual(chat.summary, 'Stale result');
  }
});
test('one automatic batch per user turn advances only completed source', async () => {
  const { chat, ctx } = client(); populate(chat, true);
  const calls = []; ctx.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return response('Remembered facts'); };
  await chat.summarize(); await chat.summarize();
  assert.equal(calls.length, 1);
  assert.equal(chat.messages.length, 30);
  assert.ok(chat.unsummarizedStart() > 0 && chat.unsummarizedStart() < 30);
  chat.messages.push({ id: 'next', role: 'user', content: 'Next turn' });
  await chat.summarize(); assert.equal(calls.length, 2);
  assert.ok(calls.every(r => Buffer.byteLength(JSON.stringify(r)) <= 262144));
});
test('legacy memory is progressively recompressed and the full original is retained', async () => {
  const { chat, ctx, store } = client(); populate(chat);
  const id = chat.convId, original = 'Older facts. '.repeat(12000);
  store.set('ws_conv_' + id, JSON.stringify(chat.messages));
  store.set('ws_mem_' + id, JSON.stringify({ summary: original, through: 'm0' }));
  chat.openConversation(id);
  let calls = 0; ctx.fetch = async () => { calls++; return response('Compact names and promises'); };
  await chat.summarize(true);
  assert.equal(chat.summary, original);
  assert.ok(chat.memoryPending);
  chat.openConversation(id); // resume persisted work
  while (chat.memoryPending) { await chat.summarize(true); assert.ok(calls < 15); }
  assert.equal(chat.summary, 'Compact names and promises');
  assert.equal(JSON.parse(store.get('ws_mem_' + id)).backup, original);
  assert.equal(chat.messages.length, 30);
});

test('fresh defaults and smaller saved choices use 60 and the smaller value respectively', () => {
  assert.equal(client().chat.settings.memorySize, 60);
  assert.equal(client(10).chat.settings.memorySize, 10);
});

test('settings saves and request construction enforce the cap without deleting messages', async () => {
  const { chat, store, key } = client(30);
  chat.settings.memorySize = 120;
  chat.saveSettings();
  assert.equal(JSON.parse(store.get(key)).memorySize, 100);
  for (let i = 0; i < 35; i++) chat.messages.push({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: 'message ' + i });
  chat.settings.memorySize = 150; // request boundary still protects against direct changes
  const messages = await chat.modelMessages();
  assert.equal(messages.length, 36);
  assert.equal(messages[1].content, 'message 0');
  assert.equal(messages.at(-1).content, 'message 34');
  assert.equal(chat.messages.length, 35);
});

test('oversized legacy summary never blocks chat or prompts the user, using active summary within budget', async () => {
  const { chat, store, ctx } = client();
  const budget = ctx.window.ConversationBudget;
  const id = chat.convId, legacySummary = 'Older facts about user and story. '.repeat(1500);
  chat.messages.push(
    { id: 'm1', role: 'user', content: 'prior question' },
    { id: 'm2', role: 'assistant', content: 'prior answer' }
  );
  store.set('ws_conv_' + id, JSON.stringify(chat.messages));
  store.set('ws_mem_' + id, JSON.stringify({ summary: legacySummary, through: 'm1' }));
  chat.openConversation(id);
  const messages = await chat.modelMessages('new message');
  assert.ok(messages.length >= 2);
  const sysMsg = messages.find(m => m.role === 'system');
  assert.ok(sysMsg);
  assert.ok(sysMsg.content.includes('Summary of your conversation with the user so far:'));
  assert.ok(Buffer.byteLength(sysMsg.content, 'utf8') < budget.limits.summary + 4096);
  assert.equal(chat.summary, legacySummary);
  const body = { model: 'waifuai-v1', messages, max_tokens: 600, stream: true };
  assert.ok(Buffer.byteLength(JSON.stringify(body), 'utf8') <= budget.limits.request);
});


test('decisions are local no-ops with no transport', async () => {
  const {chat,ctx}=client();let calls=0;
  ctx.fetch=async()=>{calls++;throw Error('decision API removed');};
  for(const n of [2600,9000]) {
    const reply='Opening. '+'x'.repeat(n)+' I am thrilled!';
    assert.equal(await chat.askDecisions(['sprites_emotion_v1'],{reply}),null);
  }
  assert.equal(calls,0);
});

test('cross-chat memory defaults on and persists under the browser storage prefix', () => {
  for (const embed of [false, true]) {
    const { chat, store } = client(undefined, embed);
    assert.equal(chat.settings.crossChatMemory, true);
    assert.equal(chat.getUserMemory(), '');
    chat.setUserMemory('Name: Rei\nLikes: rain sounds');
    assert.equal(chat.getUserMemory(), 'Name: Rei\nLikes: rain sounds');
    const key = 'ws_userMemory';
    assert.equal(JSON.parse(store.get(key)), 'Name: Rei\nLikes: rain sounds');
    chat.clearUserMemory();
    assert.equal(chat.getUserMemory(), '');
    assert.equal(store.has(key), false);
  }
});

test('saved settings without a cross-chat memory choice use the enabled default', () => {
  for (const embed of [false, true]) {
    const { chat } = client(20, embed);
    assert.equal(chat.settings.crossChatMemory, true);
    assert.equal(chat.settings.memorySize, 20);
    assert.equal(chat.settings.aboutUser, 'Remember me');
  }
});

test('turning cross-chat memory off survives reload and excludes saved memory', async () => {
  for (const embed of [false, true]) {
    const { chat, store } = client(undefined, embed);
    chat.setUserMemory('Name: Rei');
    chat.settings.crossChatMemory = false;
    chat.saveSettings();
    const reloaded = client(undefined, embed, store).chat;
    assert.equal(reloaded.settings.crossChatMemory, false);
    assert.equal(reloaded.getUserMemory(), 'Name: Rei');
    assert.doesNotMatch((await reloaded.modelMessages()).find(m => m.role === 'system').content, /Things you remember about the user/);
    reloaded.newConversation();
    assert.equal(reloaded.messages.length, 0);
    reloaded.settings.crossChatMemory = true;
    reloaded.saveSettings();
    assert.equal(client(undefined, embed, store).chat.settings.crossChatMemory, true);
  }
});

test('a remembered visitor’s new chats greet them back, and the opener is not saved alone', () => {
  const { chat } = client();
  chat.settings.crossChatMemory = true;
  chat.setUserMemory('Name: Rei\nLikes: rain sounds');
  chat.newConversation();
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].userMemoryGreeting, true);
  assert.match(chat.messages[0].content, /^Nice to see you again! I remembered: Name: Rei; Likes: rain sounds — how have things been\?$/);
  assert.equal(chat.historyIndex().length, 0);
  chat.newConversation();
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].userMemoryGreeting, true);
});

test('the greeting needs the toggle on, a non-empty store and a fresh conversation', () => {
  const withoutToggle = client();
  withoutToggle.chat.settings.crossChatMemory = false;
  withoutToggle.chat.setUserMemory('Name: Rei');
  withoutToggle.chat.newConversation();
  assert.equal(withoutToggle.chat.messages.length, 0);
  const withoutStore = client();
  withoutStore.chat.settings.crossChatMemory = true;
  withoutStore.chat.setUserMemory('');
  withoutStore.chat.newConversation();
  assert.equal(withoutStore.chat.messages.length, 0);
  const { chat, store } = client();
  chat.settings.crossChatMemory = true;
  chat.setUserMemory('Name: Rei');
  const id = 'c-existing';
  store.set('ws_conv_' + id, JSON.stringify([{ id: 'm1', role: 'user', content: 'hello there' }]));
  store.set('ws_history', JSON.stringify([{ id, title: 'hello there', named: false, updated: 1, count: 1, persona: 'aurora' }]));
  chat.openConversation(id);
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].userMemoryGreeting, undefined);
});

test('the summarizer’s durable section updates the store and the summary keeps the rest', async () => {
  const { chat, ctx, store } = client(); populate(chat);
  chat.settings.crossChatMemory = true;
  chat.setUserMemory('Name: Rei');
  chat.setSummary('Existing facts');
  ctx.fetch = async () => response('Remembered facts.\n\nDurable across chats:\nName: Rei\nLikes: rain sounds');
  await chat.summarize(true);
  assert.equal(chat.summary, 'Remembered facts.');
  assert.equal(chat.getUserMemory(), 'Name: Rei\nLikes: rain sounds');
  assert.equal(JSON.parse(store.get('ws_userMemory')), 'Name: Rei\nLikes: rain sounds');
});

test('with the toggle off the durable section is dropped, not stored', async () => {
  const { chat, ctx } = client(); populate(chat);
  chat.settings.crossChatMemory = false;
  chat.setUserMemory('Kept facts');
  ctx.fetch = async () => response('Remembered facts.\n\nDurable across chats:\nName: Rei');
  await chat.summarize(true);
  assert.equal(chat.summary, 'Remembered facts.');
  assert.equal(chat.getUserMemory(), 'Kept facts');
});

test('cross-chat memory rides in the system prompt', async () => {
  const { chat } = client();
  chat.settings.crossChatMemory = true;
  chat.setUserMemory('Name: Rei');
  const system = (await chat.modelMessages()).find(m => m.role === 'system');
  assert.ok(system.content.includes('Things you remember about the user from earlier conversations: Name: Rei'));
  chat.settings.crossChatMemory = false;
  assert.doesNotMatch((await chat.modelMessages()).find(m => m.role === 'system').content, /Things you remember about the user/);
  chat.settings.crossChatMemory = true;
  chat.clearUserMemory();
});

test('manual user-memory changes reject delayed durable updates without losing the chat summary', async () => {
  for (const embed of [false, true]) for (const action of ['forget', 'edit']) {
    const { chat, ctx, store } = client(undefined, embed); populate(chat);
    chat.settings.crossChatMemory = true; chat.setUserMemory('Name: Rei');
    let finish; ctx.fetch = () => new Promise(resolve => { finish = resolve; });
    const work = chat.summarize(true);
    if (action === 'forget') chat.clearUserMemory();
    else chat.setUserMemory('Name: Corrected');
    finish(response('Fresh chat summary.\nDurable across chats:\nName: Rei\nLikes: rain sounds'));
    assert.equal(await work, true);
    assert.equal(chat.summary, 'Fresh chat summary.');
    const expected = action === 'forget' ? '' : 'Name: Corrected';
    assert.equal(chat.getUserMemory(), expected);
    const stored = store.get('ws_userMemory');
    assert.equal(stored ? JSON.parse(stored) : '', expected);
  }
});

test('cross-chat setting changes leave pending durable updates unapplied', async () => {
  for (const enabled of [false, true]) {
    const { chat, ctx } = client(); populate(chat);
    chat.settings.crossChatMemory = enabled; chat.saveSettings(); chat.setUserMemory('Kept facts');
    let finish; ctx.fetch = () => new Promise(resolve => { finish = resolve; });
    const work = chat.summarize(true);
    if (enabled) { chat.settings.crossChatMemory = false; chat.saveSettings(); }
    chat.settings.crossChatMemory = true; chat.saveSettings();
    finish(response('Fresh chat summary.\nDurable across chats:\nName: Rei'));
    assert.equal(await work, true);
    assert.equal(chat.summary, 'Fresh chat summary.');
    assert.equal(chat.getUserMemory(), 'Kept facts');
  }
});

test('welcome-back survives replies, reload and removal of its message and summary', () => {
  for (const embed of [false, true]) {
    const prefix = 'ws_';
    const { chat, store } = client(undefined, embed); populate(chat); chat.setSummary('Our game');
    const id = chat.convId;
    assert.ok(chat.seedWelcomeBack());
    assert.equal(JSON.parse(store.get(prefix + 'mem_' + id)).welcomeBackGreeted, true);
    chat.messages.push({ id: 'next', role: 'user', content: 'Continue' });
    store.set(prefix + 'conv_' + id, JSON.stringify(chat.messages));
    const reloaded = client(undefined, embed, store).chat;
    reloaded.openConversation(id);
    assert.equal(reloaded.seedWelcomeBack(), false);
    reloaded.deleteMessage(reloaded.messages.find(m => m.welcomeBack).id);
    reloaded.setSummary('');
    assert.equal(JSON.parse(store.get(prefix + 'mem_' + id)).welcomeBackGreeted, true);
    reloaded.setSummary('A later summary');
    const afterRemoval = client(undefined, embed, store).chat;
    afterRemoval.openConversation(id);
    assert.equal(afterRemoval.seedWelcomeBack(), false);
    assert.equal(afterRemoval.messages.filter(m => m.welcomeBack).length, 0);
    afterRemoval.newConversation();
    afterRemoval.messages.push({ id: 'fresh', role: 'user', content: 'Another game' });
    afterRemoval.setSummary('Different game');
    assert.ok(afterRemoval.seedWelcomeBack());
  }
});

test('older welcome-back message markers migrate before those messages are removed', () => {
  const { chat, store } = client();
  const id = 'legacy-chat';
  store.set('ws_conv_' + id, JSON.stringify([
    { id: 'greet', role: 'assistant', content: 'Welcome back', welcomeBack: true },
    { id: 'user', role: 'user', content: 'Continue' }
  ]));
  store.set('ws_mem_' + id, JSON.stringify({ summary: 'Our game', through: null }));
  chat.openConversation(id);
  assert.equal(chat.seedWelcomeBack(), false);
  assert.equal(JSON.parse(store.get('ws_mem_' + id)).welcomeBackGreeted, true);
  chat.deleteMessage('greet');
  chat.openConversation(id);
  assert.equal(chat.seedWelcomeBack(), false);
});
