const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');

function client(locale = 'en', bundles = true) {
  const store = new Map();
  const spriteSource = fs.readFileSync(path.join(root, 'homepage-sprites/sprites.js'), 'utf8');
  const emotions = Object.keys(vm.runInNewContext('(' + spriteSource.match(/const EMOTIONS = (\{[\s\S]*?\});/)[1] + ')'));
  const c = vm.createContext({ Date, navigator: {}, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
    Sprites: { EMOTIONS: emotions },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) },
  });
  c.window = c;
  c.WaifuI18n = { locale, languageName: name => ({ Spanish:'Español', Russian:'Русский', Bengali:'বাংলা' }[name] || name) };
  for (const file of [...(bundles ? ['homepage-sprites/i18n/chat_prompts.js', 'homepage-sprites/prompt_translations.js'] : []),
    'homepage-sprites/context_budget.js', 'homepage-sprites/pictures.js', 'homepage-sprites/chat.js']) {
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), c);
  }
  c.chat = vm.runInContext('Chat', c);
  c.chat.settings.includeTime = false;
  return { c, chat:c.chat, store };
}
const system = async chat => (await chat.modelMessages('Synthetic greeting'))[0].content;
const placeholders = s => [...s.matchAll(/%\{(\w+)\}/g)].map(m => m[1]).sort();

test('picture context includes a short middle-scene definition and excludes stopped/image turns',()=>{
  const {chat}=client();
  for(let i=0;i<24;i++)chat.messages.push({role:'user',content:i===12?'In this story you are Mira with turquoise hair.':'Ordinary short turn '+i});
  chat.messages.push({role:'assistant',status:'stopped',content:'stopped-character-secret'},
    {role:'assistant',kind:'image',content:'image-character-secret'});
  const context=chat.pictureCharacterContext();
  assert.match(context,/turquoise hair/);assert.doesNotMatch(context,/stopped-character-secret|image-character-secret/);
});

test('long character context reserves space for current appearance corrections',()=>{
  const {chat}=client();chat.settings.persona='custom';chat.settings.customPrompt='Custom companion Mira. '+'old costume '.repeat(1000);
  chat.settings.extraPrompt='Old instructions. '.repeat(1000);chat.setSummary('Old story. '.repeat(1000));
  chat.messages.push({role:'user',content:'Earlier scene. '.repeat(1000)},
    {role:'user',content:'For the current scene, you now have silver hair and a blue coat.'});
  const context=chat.pictureCharacterContext();assert.ok(context.length<=6000);
  assert.match(context,/silver hair and a blue coat/);assert.match(context,/Custom companion Mira/);
});

// All authored prompt languages are also full interface locales. Keep an
// explicit allowlist for any future intentionally reply-only additions.
const REPLY_ONLY_PROMPTS = [];

test('every interface locale has complete Sprites prompts and placeholders', () => {
  const { c } = client();
  const dicts = c.ChatPrompts.dictionaries;
  const catalog = require('../../i18n/i18n.js').locales().map(l => l.code);
  for (const code of catalog) assert.ok(dicts[code], code + ' is an interface locale but has no prompt dictionary');
  assert.deepEqual(Object.keys(dicts).sort(), [...catalog, ...REPLY_ONLY_PROMPTS].sort());
  for (const [locale, entries] of Object.entries(dicts)) {
    assert.deepEqual(Object.keys(entries).sort(), Object.keys(dicts.en).sort(), locale);
    for (const key of Object.keys(dicts.en)) {
      assert.ok(typeof entries[key] === 'string' && entries[key].trim(), locale + ':' + key);
      assert.deepEqual(placeholders(entries[key]), placeholders(dicts.en[key]), locale + ':' + key);
      if (locale !== 'en' && !['yes','no'].includes(key)) assert.notEqual(entries[key], dicts.en[key], locale + ':' + key);
    }
  }
});

test('all four built-in personas and emotion instructions use every supported reply locale', async () => {
  const { c, chat } = client('ar');
  const languages = { en:'English', ar:'Arabic', bn:'Bengali', es:'Spanish', pt:'Portuguese (Brazil)',
    ru:'Russian', fr:'French', de:'German', ja:'Japanese', zh:'Chinese (Simplified)', fa:'Persian',
    id:'Indonesian', ms:'Malay', pl:'Polish', hi:'Hindi', ko:'Korean', tr:'Turkish',
    it:'Italian', vi:'Vietnamese', uk:'Ukrainian', cs:'Czech',
    th:'Thai', nl:'Dutch', el:'Greek', ro:'Romanian',
    hu:'Hungarian', fi:'Finnish', my:'Myanmar (Burmese)', si:'Sinhala (Sinhalese)' };
  for (const [locale, language] of Object.entries(languages)) {
    chat.settings.language = language;
    const t = c.ChatPrompts.forLanguage(language);
    assert.equal(t.locale, locale);
    for (const persona of ['aurora','tsundere','study','assistant']) {
      chat.settings.persona = persona;
      const sys = await system(chat);
      assert.ok(sys.startsWith(t('fixed', '', { language:c.WaifuI18n.languageName(language) })), locale);
      assert.ok(sys.includes(t('sprite_' + persona)), locale + ':' + persona);
      assert.ok(sys.includes(t('sprite_emotion', '', { tags:c.Sprites.EMOTIONS.join(', ') })), locale);
      assert.ok(sys.includes('[curious]'), locale);
      assert.ok(sys.includes(t('sprite_appearance')), locale);
      assert.ok(sys.includes(t('sprite_offer')), locale);
      assert.ok(sys.endsWith(t('reminder', '', { language: c.WaifuI18n.languageName(language) })), locale);
      assert.doesNotMatch(sys, /%\{\w+\}/, locale);
    }
    assert.equal(c.WaifuI18n.locale, 'ar');
    assert.equal(chat.settings.language, language);
  }
});

test('English translations preserve the original persona definitions', () => {
  const { c, chat } = client();
  for (const id of ['aurora','tsundere','study','assistant']) {
    assert.equal(c.ChatPrompts.dictionaries.en['sprite_' + id], chat.PERSONAS[id].prompt);
  }
});

test('automatic replies localize instructions to UI while following the latest message', async () => {
  const { c, chat } = client('pt');
  const t = c.ChatPrompts.forLanguage(null);
  const sys = await system(chat);
  assert.ok(sys.startsWith('Responda no idioma da mensagem mais recente'));
  assert.ok(sys.includes('Você é Aurora'));
  assert.ok(sys.endsWith(t('reminderAuto')));
  assert.equal(chat.settings.language, '');
  c.WaifuI18n.locale = 'ru';
  assert.ok((await system(chat)).startsWith('Отвечай на языке последнего сообщения'));
});

test('custom persona, extra instructions, background and memory remain verbatim and saved', async () => {
  const { c, chat, store } = client('es');
  Object.assign(chat.settings, { persona:'custom', customPrompt:'MY CUSTOM PERSONA', extraPrompt:'EXTRA %{text}',
    aboutUser:'PERSONAL BACKGROUND', language:'Russian' });
  chat.setSummary('REMEMBERED FACTS'); chat.saveSettings();
  const saved = store.get('ws_settings');
  const sys = await system(chat);
  for (const s of ['MY CUSTOM PERSONA','EXTRA %{text}','PERSONAL BACKGROUND','REMEMBERED FACTS']) assert.ok(sys.includes(s));
  assert.doesNotMatch(sys, /Ты Аврора/);
  assert.equal(store.get('ws_settings'), saved);
  assert.equal(c.WaifuI18n.locale, 'es');
});

test('time and battery context share the reply language', async () => {
  const { c, chat } = client();
  Object.assign(chat.settings, { language:'Spanish', includeTime:true, includeBattery:true });
  c.navigator.getBattery = async () => ({ level:.42, charging:true });
  const sys = await system(chat);
  assert.ok(sys.includes('La fecha y hora actuales'));
  assert.ok(sys.includes('42%; cargando: sí'));
});

test('default and saved legacy ambient instructions translate while custom instructions are preserved', () => {
  const { c, chat } = client();
  const english = chat.DEFAULT_AMBIENT_PROMPT;
  chat.settings.language = 'Bengali';
  assert.ok(chat.ambientPrompt().startsWith('(ব্যবহারকারী'));
  chat.settings.ambientPrompt = english;
  assert.ok(chat.ambientPrompt().startsWith('(ব্যবহারকারী'));
  assert.equal(chat.settings.ambientPrompt, english);
  chat.settings.ambientPrompt = 'CUSTOM AMBIENT %{text}';
  assert.equal(chat.ambientPrompt(), 'CUSTOM AMBIENT %{text}');
  assert.equal(c.WaifuI18n.locale, 'en');
});

test('unsupported explicit languages keep their requested language with English instructions', async () => {
  const { chat } = client('ar');
  for (const language of ['Swedish','Chinese (Traditional)','constructor','__proto__']) {
    chat.settings.language = language;
    const sys = await system(chat);
    assert.ok(sys.startsWith('Reply in ' + language));
    assert.ok(sys.includes('You are Aurora'));
  }
});

test('missing translation bundles keep chat and ambient generation usable', async () => {
  const { chat } = client('es', false);
  chat.settings.language = 'Bengali';
  const sys = await system(chat);
  assert.ok(sys.startsWith('Reply in বাংলা'));
  assert.ok(sys.includes('You are Aurora'));
  assert.ok(sys.includes('Start every reply with exactly one emotion tag'));
  assert.ok(chat.ambientPrompt().startsWith('(The user has gone quiet'));
});

test('shipped page loads prompt bundles in order before chat', () => {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const base = html.indexOf('/homepage-sprites/i18n/chat_prompts.js'), extra = html.indexOf('prompt_translations.js'), chat = html.indexOf('src="/homepage-sprites/chat.js');
  assert.ok(base > 0 && base < extra && extra < chat);
});

 test('new reply languages and Tagalog tags select their prompt locale', () => {
  const { c } = client();
  for (const [language, code] of [['Urdu','ur'], ['Filipino','fil'], ['Filipino (Tagalog)','fil'], ['tl-PH','fil'], ['Tamil','ta'], ['Uzbek','uz']]) {
    assert.equal(c.ChatPrompts.forLanguage(language).locale, code, language);
  }
});
