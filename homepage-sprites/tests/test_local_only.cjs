const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const locales = path.join(root, 'i18n/locales');

function client(locale = 'en') {
  const store = new Map();
  const ctx = vm.createContext({
    window: {}, navigator: {}, crypto: require('node:crypto').webcrypto,
    AbortController, TextEncoder, TextDecoder, TypeError,
    Sprites: { EMOTIONS: ['happy', 'funny', 'empathetic', 'curious', 'confused', 'amazed', 'sorry', 'found_it', 'annoyed', 'overwhelmed', 'planning', 'love'], detectEmotion: () => null },
    Pictures: { CHAT_RULE: '', forget() {} },
    setTimeout, clearTimeout,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
  });
  ctx.window.ConversationBudget = require('../context_budget.js');
  vm.runInContext(fs.readFileSync(path.join(root, 'i18n/chat_prompts.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'prompt_translations.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'local_fallback_engine.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'chat.js'), 'utf8') + '\nthis.chat = Chat;', ctx);
  ctx.WaifuI18n = { locale };
  return { chat: ctx.chat, ctx, store };
}

test('default provider is the local built-in engine, with no endpoint configured', () => {
  const { chat } = client();
  assert.equal(chat.settings.provider, 'cloud');
  assert.equal(chat.PROVIDERS.cloud.name, 'Built-in local replies');
  assert.throws(() => chat.buildRequest([{ role: 'user', content: 'hi' }], 'chat', true, 600), /no endpoint/);
});

test('a local greeting turn completes with an emotion and text and no fetch', async () => {
  const { chat, ctx } = client();
  let requests = 0;
  ctx.fetch = async () => { requests++; throw Error('unexpected request'); };
  const events = [];
  await chat.send('hello there', {
    onEmotion: e => events.push(['emotion', e]),
    onText: t => events.push(['text', t]),
    onDone: m => events.push(['done', m]),
  });
  assert.equal(requests, 0);
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[1].status, 'completed');
  assert.ok(chat.messages[1].content.length > 0);
  assert.equal(chat.messages[1].emotion, 'happy');
  assert.deepEqual(events.map(e => e[0]), ['emotion', 'text', 'done']);
});

test('a local turn in French replies in French when the bundle is loaded', async () => {
  const { chat } = client('fr');
  chat.settings.language = 'French';
  await chat.send('bonjour', {});
  assert.ok(chat.messages[1].content.length > 0);
  assert.notEqual(chat.messages[1].content, 'bonjour');
});

test('local ambient turns are excluded from canned replies', async () => {
  const { chat, ctx } = client();
  let requests = 0;
  ctx.fetch = async () => { requests++; throw Error('unexpected request'); };
  const owner = chat.beginTurn('be spontaneous', { ambient: true });
  await chat.send('be spontaneous', {}, { owner });
  assert.equal(requests, 0);
});

test('no local network calls for summary, titles or transliteration', async () => {
  const { chat, ctx } = client();
  let requests = 0;
  ctx.fetch = async () => { requests++; throw Error('unexpected request'); };
  assert.equal(await chat.summarize(true), false);
  assert.equal(await chat.generateTitle(chat.convId), null);
  assert.equal(chat.settings.provider, 'cloud');
  assert.equal(requests, 0);
});

test('the local engine can reach every sprite emotion', () => {
  const { ctx } = client();
  const engine = ctx.window.LocalFallbackEngine;
  assert.deepEqual(engine.EMOTIONS.length, 12);
  const samples = {
    happy: 'hello there', funny: 'that joke is hilarious', empathetic: 'I am sad',
    curious: 'how are you?', confused: 'I am confused', amazed: 'that is amazing',
    sorry: 'I am sorry', found_it: 'I finally did it', annoyed: 'this is annoying',
    overwhelmed: 'I feel overwhelmed', planning: 'let us plan tomorrow', love: 'I love you',
  };
  const seen = new Set(Object.entries(samples).map(([emotion, text]) => {
    const result = engine.getResponse(text, 'English', 'aurora');
    assert.equal(result.emotion, emotion, text);
    assert.ok(result.reply.length > 0);
    assert.equal(result.isFallback, true);
    return result.emotion;
  }));
  assert.deepEqual([...seen].sort(), [...engine.EMOTIONS].sort());
});

test('each built-in persona gives the same intent a distinct voice', () => {
  const { ctx } = client();
  const engine = ctx.window.LocalFallbackEngine;
  const replies = Object.fromEntries(engine.PERSONAS.map(p =>
    [p, engine.getResponse('hello', 'English', p)]));
  assert.match(replies.aurora.reply, /glad you're here/);
  assert.match(replies.tsundere.reply, /^Hmph—/);
  assert.match(replies.tsundere.reply, /Not that I care or anything\.$/);
  assert.match(replies.study.reply, /^Okay, let's break it down\./);
  assert.ok(replies.assistant.reply.length < replies.aurora.reply.length);
  assert.equal(replies.assistant.reply, "Hey! I'm really glad you're here.");
  assert.equal(replies.custom.reply, replies.aurora.reply);
  for (const result of Object.values(replies)) assert.equal(result.engine, 'local-template-v2');
  const identity = engine.getResponse('who are you', 'English', 'study').reply;
  assert.match(identity, /Study buddy/);
  assert.doesNotMatch(identity, /Haru/);
});

test('local replies use the reply language bundle, including persona flair', () => {
  const { ctx } = client('fr');
  const engine = ctx.window.LocalFallbackEngine;
  assert.match(engine.getResponse('bonjour', 'French', 'aurora').reply, /^Salut !/);
  assert.match(engine.getResponse('bonjour', 'French', 'tsundere').reply, /^Hum ! Ce n'est pas que/);
  assert.match(engine.getResponse('bonjour', 'French', 'study').reply, /^D'accord, procédons étape par étape\./);
});

test('locale strings no longer promise cloud inference or pictures', () => {
  for (const file of fs.readdirSync(locales).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(locales, file), 'utf8');
    for (const key of ['provider.cloud.name', 'settings.providerNoteCloud', 'settings.providerNoteOwn']) {
      const line = src.split('\n').find(l => l.includes("'" + key + "'"));
      assert.ok(line, file + ' missing ' + key);
      assert.doesNotMatch(line, /WaifuAI Cloud|Pictures are drawn/i, file + ' ' + key);
    }
  }
});
