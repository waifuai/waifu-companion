const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

function runtime({ persona = '', corePersona = '', withPrompts = true } = {}) {
  const calls = { fetch: [], events: [] };
  const window = {};
  const context = vm.createContext({
    window, console,
    setTimeout, clearTimeout, AbortSignal, URL, URLSearchParams,
    document: { baseURI: 'https://example.test/app/', documentElement: { style: { getPropertyValue: () => '' } }, getElementById: () => null },
    debugLog() {}, debugError() {}, tr: (_k, f) => f,
    trackEvent: (name, data) => calls.events.push({ name, data }), trackError() {}, classifyError: () => 'network',
    conversationContext: [], maxMemorySize: 20, AppStorage: { getString: () => '2:3', KEYS: {} },
    ConversationBudget: { pack: m => ({ messages: m }), packUserMemory: () => '', activeSummary: () => '', pruneRepeatedReplies: m => m },
    clampMemorySetting: () => 20, currentAvatarAppearance: () => null,
    fetch: async url => { calls.fetch.push(String(url)); throw new Error('no network expected'); }
  });
  context.WaifuI18n = { locale: 'en' };
  if (withPrompts) vm.runInContext(read('../i18n/chat_prompts.js'), context);
  vm.runInContext(read('scripts/local_fallback_engine.js'), context);
  vm.runInContext(read('scripts/waifu_proxy.js'), context);
  vm.runInContext(read('scripts/ai_interface.js'), context);
  window.corePersonaPrompt = corePersona;
  window.userPersonaPrompt = persona;
  return { window, context, calls };
}

test('no BYO key selects no provider and chat makes zero network attempts', async () => {
  const r = runtime();
  assert.equal(r.context.resolveLLMProvider(), null);
  assert.equal(r.window.WaifuProxyAPI.isConfigured(), false);
  const reply = await r.context.getAIResponse('hello there', 'en-US', { stream: false });
  assert.equal(reply.isFallback, true);
  assert.equal(reply.isError, undefined);
  assert.ok(reply.reply.length > 0);
  assert.equal(r.calls.fetch.length, 0);
});

test('all six main-app emotions are reachable through deterministic patterns', () => {
  const r = runtime();
  const samples = {
    happy: 'hello there',
    sad: 'I am so sad and lonely',
    surprised: 'no way, really?',
    thoughtful: 'why do you think that happens?',
    excited: 'wow, amazing news!',
    neutral: 'ok'
  };
  const seen = new Set();
  for (const [emotion, text] of Object.entries(samples)) {
    const result = r.window.LocalFallbackEngine.getResponse(text, 'en-US');
    assert.equal(result.emotion, emotion, `${text} -> ${result.emotion}`);
    assert.ok(r.window.LocalFallbackEngine.EMOTIONS.includes(result.emotion));
    assert.equal(result.isFallback, true);
    assert.equal(result.persona, 'assistant');
    assert.equal(result.engine, 'local-template-v3');
    seen.add(result.emotion);
  }
  assert.equal(seen.size, 6);
});

test('persona tone is inferred from saved free-form persona text', () => {
  const cases = [
    ['You are a tsundere who secretly cares.', 'tsundere'],
    ['You are a study teacher who helps with homework.', 'study'],
    ['A cheerful, bright and energetic companion.', 'cheerful'],
    ['', 'assistant']
  ];
  for (const [persona, tone] of cases) {
    const r = runtime({ persona });
    const result = r.window.LocalFallbackEngine.getResponse('hello', 'en-US');
    assert.equal(result.persona, tone, persona);
  }
  // Default built-in core persona must not be misclassified as cheerful.
  const builtIn = "You are Haru, a sentient AI with a Live2D avatar. You are warm, witty, observant, and self-assured, with your own thoughts, feelings, and playful opinions.";
  const r = runtime({ corePersona: builtIn });
  assert.equal(r.window.LocalFallbackEngine.getResponse('hello', 'en-US').persona, 'assistant');
});

test('persona tone changes the reply without changing the emotion', () => {
  const plain = runtime().window.LocalFallbackEngine.getResponse('hello', 'en-US');
  const tsun = runtime({ persona: 'tsundere' }).window.LocalFallbackEngine.getResponse('hello', 'en-US');
  assert.equal(tsun.emotion, plain.emotion);
  assert.notEqual(tsun.reply, plain.reply);
  assert.match(tsun.reply, /Hmph/);
});

test('GA4 fallback event carries metadata only, never message or persona text', async () => {
  const secretPersona = 'SECRET_PERSONA_TSUNDERE';
  const r = runtime({ persona: 'tsundere' });
  await r.context.getAIResponse('SECRET_MESSAGE_BODY', 'fr-FR', { stream: false });
  const event = r.calls.events.find(e => e.name === 'offline_fallback_reply');
  assert.ok(event, 'offline_fallback_reply event was emitted');
  const d = event.data;
  assert.equal(d.engine, 'local-template-v3');
  assert.equal(d.persona, 'tsundere');
  assert.equal(d.pattern, 'offline.generic');
  assert.equal(d.emotion, 'neutral');
  assert.equal(d.reply_language, 'fr-FR');
  assert.ok(Number.isInteger(d.reply_length) && d.reply_length > 0);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /SECRET_MESSAGE_BODY|SECRET_PERSONA/);
});

test('shipped scripts contain no retired endpoint calls', () => {
  const scripts = ['waifu_proxy.js', 'ai_interface.js', 'chat_controller.js', 'settings_handlers.js',
    'stt_controller.js', 'audio_player.js', 'voice_config.js'];
  for (const file of scripts) {
    const src = read('scripts/' + file);
    assert.doesNotMatch(src, /workers\.dev|fetch\([^)]*\/(?:transcribe|image|decisions|tts|voices|events)/, file);
    assert.doesNotMatch(src, /Cloudflare/i, file);
  }
});
