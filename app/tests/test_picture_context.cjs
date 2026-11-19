const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client() {
  const calls = [];
  const context = vm.createContext({
    window: {},
    conversationContext: [],
    AppStorage: { KEYS: {}, getString: (_key, fallback) => fallback },
    debugLog() {}, debugError() {},
    tr: (_k, fallback) => fallback,
    async callConfiguredLLM(...args) { calls.push(args); return { content: 'DRAW: An anime companion smiling in a cozy room.' }; }
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/ai_interface.js'), 'utf8'), context);
  return { context, calls };
}

test('picture decisions are a local no-op: no decision call and no prompt writer', async () => {
  const { context, calls } = client();
  context.conversationContext.push({ role: 'assistant', content: 'Want a picture of me in my room?' });
  for (const message of ['Yes please', 'send me a selfie', 'Thanks, you look great']) {
    assert.equal(await context.getImageDecision(message), null, message);
  }
  assert.equal(calls.length, 0);
  assert.equal(context.window.WaifuProxyAPI, undefined);
});

test('emotion upgrading is a local no-op with no decision request', async () => {
  const { context, calls } = client();
  let applied = null;
  await context.upgradeEmotionFromDecision('hi', 'I am happy!', e => { applied = e; }, null, () => true);
  assert.equal(applied, null);
  assert.equal(calls.length, 0);
});

test('saved picture artifacts are still stripped from local replies', () => {
  const { context } = client();
  const dirty = 'Here you go [IMAGE: a girl|portrait] [generated an image: cute scene] (sent a picture: earlier)';
  assert.doesNotMatch(context.stripImageArtifacts(dirty), /\[IMAGE|generated an image|sent a picture/);
  assert.match(context.stripImageArtifacts(dirty), /Here you go/);
});

test('picture character context preserves an early roleplay definition', () => {
  const { context } = client();
  context.window.userPersonaPrompt = 'You are Mira, an adult with short red hair and green eyes.';
  context.conversationContext.unshift({ role: 'user', content: 'For this story you are a red-haired space pilot.' });
  for (let i = 0; i < 15; i++) context.conversationContext.push({ role: 'assistant', content: 'A later ordinary chat turn.' });
  const character = context.pictureCharacterContext();
  assert.match(character, /short red hair/);
  assert.match(character, /red-haired space pilot/);
});

test('picture character context stays bounded and drops superseded and image entries', () => {
  const { context } = client();
  context.window.userPersonaPrompt = 'Custom companion Mira. ' + 'old costume '.repeat(1000);
  context.window.conversationSummary = 'Old story. '.repeat(1000);
  context.conversationContext.unshift({ role: 'user', content: 'Earlier scene. ' + 'x '.repeat(1000) });
  context.conversationContext.push(
    { role: 'user', content: 'For the current scene, you now have silver hair and a blue coat.' },
    { role: 'assistant', content: 'superseded-character-secret', superseded: true },
    { role: 'assistant', content: 'image-character-secret', imageUrl: 'https://example.test/invented.png' }
  );
  const character = context.pictureCharacterContext();
  assert.ok(character.length <= 6000);
  assert.match(character, /silver hair and a blue coat/);
  assert.doesNotMatch(character, /superseded-character-secret|image-character-secret/);
});

test('a long closing offer is kept when clipping picture context', () => {
  const { context } = client();
  const offer = 'Want a picture of me in my room?';
  const long = 'Here is a little about me. ' + 'I enjoy good conversations. '.repeat(25) + offer;
  const clipped = context.clipPictureContext(long + '\n(sent a picture: older scene)');
  assert.ok(clipped.length <= 300);
  assert.ok(clipped.endsWith(offer));
  assert.doesNotMatch(clipped, /sent a picture/);
});
