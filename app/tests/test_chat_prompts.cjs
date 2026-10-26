const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
function client(locale = 'en', bundle = true) {
  const c = vm.createContext({ console, Date, TextEncoder, navigator: {},
    document: { documentElement: { style: { getPropertyValue: () => '' } } },
    debugLog() {}, debugError() {}, formatSeconds: n => String(n) + 's',
    conversationContext: [], maxMemorySize: 30, clampMemorySetting: n => n,
  });
  c.window = c;
  c.WaifuI18n = { locale };
  for (const file of ['app/scripts/languages_full_data.js',
    ...(bundle ? ['i18n/chat_prompts.js'] : []), 'app/scripts/ai_interface.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c);
  }
  c.languages = c.LANGUAGE_DATA_RAW;
  c.ConversationBudget = require('../scripts/context_budget.js');
  return c;
}
const placeholders = s => [...s.matchAll(/%\{(\w+)\}/g)].map(m => m[1]).sort();

// All authored prompt languages are also full interface locales. Keep an
// explicit allowlist for any future intentionally reply-only additions.
const REPLY_ONLY_PROMPTS = [];

test('every interface locale has complete prompt and placeholder parity', () => {
  const c = client(), dicts = c.ChatPrompts.dictionaries;
  const catalog = require('../../i18n/i18n.js').locales().map(l => l.code);
  for (const code of catalog) assert.ok(dicts[code], code + ' is an interface locale but has no prompt dictionary');
  assert.deepEqual(Object.keys(dicts).sort(), [...catalog, ...REPLY_ONLY_PROMPTS].sort());
  for (const [locale, dict] of Object.entries(dicts)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(dicts.en).sort(), locale);
    for (const key of Object.keys(dicts.en)) {
      assert.ok(typeof dict[key] === 'string' && dict[key].trim(), locale + ':' + key);
      assert.deepEqual(placeholders(dict[key]), placeholders(dicts.en[key]), locale + ':' + key);
      if (locale !== 'en' && !['yes', 'no'].includes(key)) assert.notEqual(dict[key], dicts.en[key], locale + ':' + key);
    }
  }
});

test('reply-language selection overrides UI without changing it or requiring its dictionary', async () => {
  const c = client('ar');
  c.selectedLanguageCode = 'es-ES';
  const msgs = await c.buildChatMessages('Hola, ¿cómo estás?', 'es-ES');
  const sys = msgs[0].content;
  assert.ok(sys.startsWith('Responde en Español (es-ES)'));
  assert.match(sys, /Eres Haru/);
  assert.match(sys, /Nunca mezcles idiomas/);
  assert.match(sys, /Puedes dibujar imágenes/);
  assert.match(sys, /Responde solo con diálogo/);
  assert.doesNotMatch(sys, /You are Haru|Respond with plain|Reply in/);
  assert.match(sys, /- Language: es-ES/); // Stable settings metadata keys.
  assert.equal(c.WaifuI18n.locale, 'ar');
  assert.equal(msgs.at(-1).content, 'Hola, ¿cómo estás?');
});

test('auto localizes instructions to UI but continues to follow the latest message', async () => {
  const c = client('pt');
  const sys = (await c.buildChatMessages('Hola', 'en-US'))[0].content;
  const t = c.ChatPrompts.forLanguage(null);
  assert.ok(sys.startsWith('Responda no idioma da mensagem mais recente'));
  assert.doesNotMatch(sys, /^Responda em /);
  assert.match(sys, /- Language: auto \(match the language of the user's latest message\)/);
  assert.doesNotMatch(sys, /- Language: en-US/);
  assert.ok(sys.endsWith(t('reminderAuto')));
  assert.equal(c.WaifuI18n.locale, 'pt');
});

test('every supported reply locale reaches the complete localized request', async () => {
  const c = client();
  for (const code of ['ar', 'bn', 'cs', 'de-DE', 'el', 'es-ES', 'fi', 'fr-FR', 'hi', 'hu', 'id-ID', 'it', 'ja-JP', 'ko-KR', 'ms', 'my', 'nl', 'fa', 'pl', 'pt-BR', 'ro', 'ru', 'si', 'th', 'tr', 'uk', 'vi', 'zh-CN']) {
    const t = c.ChatPrompts.forLanguage(code);
    const sys = (await c.buildChatMessages('Synthetic greeting', code))[0].content;
    assert.ok(sys.startsWith(t('fixed', '', { language: c.resolveTargetLanguageName(code) })), code);
    assert.ok(sys.includes(t('persona')), code);
    assert.ok(sys.endsWith(t('reminder', '', { language: c.resolveTargetLanguageName(code) })), code);
    assert.doesNotMatch(sys, /%\{\w+\}/, code);
  }
});

test('only exact built-in personas are translated; custom prompts and saved memory remain intact', async () => {
  const c = client('ru');
  const init = fs.readFileSync(path.join(root, 'app/scripts/app_init.js'), 'utf8');
  const builtIn = init.match(/const DEFAULT_CORE_PERSONA = "([^"]+)";/)[1];
  assert.equal(builtIn, c.ChatPrompts.dictionaries.en.persona);
  c.corePersonaPrompt = builtIn;
  assert.match((await c.buildChatMessages('Привет', 'ru'))[0].content, /Ты Хару/);
  assert.equal(c.corePersonaPrompt, builtIn);
  c.corePersonaPrompt = 'You are MY CUSTOM CHARACTER. Preserve this exactly.';
  c.userPersonaPrompt = 'Keep my ${text} and %{text} literal.';
  c.userContextText = 'My custom background.';
  c.conversationSummary = 'User-owned remembered text.';
  const sys = (await c.buildChatMessages('Привет', 'ru'))[0].content;
  for (const text of [c.corePersonaPrompt, c.userPersonaPrompt, c.userContextText, c.conversationSummary]) assert.ok(sys.includes(text));
  assert.match(sys, /Additional Personality Instructions:/);
  assert.match(sys, /Existing Conversation Summary:/);
  assert.doesNotMatch(sys, /Ты Хару/);
});

test('localized instructions preserve all existing machine-readable custom-context fields', async () => {
  const c = client('es');
  c.userPersonaPrompt = 'Synthetic persona details.';
  c.userContextText = 'I like the phrase "good luck".';
  c.conversationSummary = 'Synthetic remembered context.';
  const sys = (await c.buildChatMessages('Hola', 'es-ES'))[0].content;
  // Pin the existing application field contract, including its quoted context format.
  const capture = pattern => sys.match(pattern)?.[1];
  assert.equal(capture(/Additional Personality Instructions:\s*([\s\S]*?)(?=\n\n|\nCurrent Application Settings|$)/), c.userPersonaPrompt);
  assert.equal(capture(/Existing Conversation Summary:\s*([\s\S]*?)(?=\n\n|\nCurrent Application Settings|$)/), c.conversationSummary);
  assert.equal(capture(/always keep in mind:\s*"([\s\S]*?)"(?:\.)?(?=\s*(?:\n|$))/), c.userContextText);
});

test('time, tutorial wrappers and battery context use the same reply locale', async () => {
  const c = client('en');
  Object.assign(c, { includeTimeInContext: true, includeTutorialInContext: true,
    includeBatteryInContext: true, TUTORIAL_STEPS: [{title:'Custom title',body:'Custom body'}] });
  c.navigator.getBattery = async () => ({ level: .42, charging: true, chargingTime: Infinity });
  let sys = (await c.buildChatMessages('Hola', 'es-ES'))[0].content;
  assert.match(sys, /La fecha y hora actuales/);
  assert.match(sys, /Paso: Custom title\nDescripción: Custom body/);
  assert.match(sys, /42%; cargando: sí/);
  assert.match(sys, /tiempo hasta la carga completa/);
  c.navigator.getBattery = async () => ({ level: .12, charging: false, dischargingTime: 60 });
  sys = (await c.buildChatMessages('Hola', 'es-ES'))[0].content;
  assert.match(sys, /12%; cargando: no/);
  assert.match(sys, /Quedan aproximadamente 60s de batería/);
});

test('unsupported languages retain the requested language with safe English instructions', async () => {
  const c = client('ar');
  for (const code of ['sv-SE', 'zh-TW', 'zz-test', 'constructor', '__proto__']) {
    const sys = (await c.buildChatMessages('Synthetic greeting', code))[0].content;
    assert.ok(sys.startsWith('Reply in '));
    assert.ok(sys.includes(code));
    assert.ok(sys.includes('You are Haru'));
  }
});

test('English chat remains usable when either translation runtime is missing', async () => {
  const c = client('es', false);
  assert.ok((await c.buildChatMessages('Hola', 'es-ES'))[0].content.startsWith('Reply in Español (es-ES)'));
  delete c.WaifuI18n;
  vm.runInContext(fs.readFileSync(path.join(root, 'i18n/chat_prompts.js'), 'utf8'), c);
  assert.equal(c.ChatPrompts.forLanguage(null).locale, 'en');
});

test('chat prompt bundle loads before prompt construction in the shipped page', () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  assert.ok(html.indexOf('../i18n/chat_prompts.js') < html.indexOf('scripts/ai_interface.js'));
});
