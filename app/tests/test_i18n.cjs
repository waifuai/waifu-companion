/**
 * Interface-localization checks: dictionary parity, placeholder parity, the
 * detection/region table, English fallback, plural rules, and the markup
 * contract of app/index.html (every data-i18n key resolves, no retired
 * attribute or script is left behind).
 *
 * Run: node --test app/tests/test_i18n.cjs
 */
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP_DIR = path.join(__dirname, '..');
const I18N_DIR = path.join(APP_DIR, '..', 'i18n');
const LOCALES_DIR = path.join(I18N_DIR, 'locales');
const I18n = require(path.join(I18N_DIR, 'i18n.js'));

// Register every dictionary the way the browser does, in catalog order.
for (const meta of I18n.locales()) {
  require(path.join(LOCALES_DIR, meta.code + '.js'));
}

const dictKeys = code => new Set(I18n.keys(code));
const placeholders = value => new Set(String(value).match(/%\{(\w+)\}/g) || []);

function placeholdersOf(entry) {
  const out = new Set();
  if (entry && typeof entry === 'object') {
    for (const form of Object.keys(entry)) for (const ph of placeholders(entry[form])) out.add(ph);
  } else {
    for (const ph of placeholders(entry)) out.add(ph);
  }
  return out;
}

// The keys the app renders from markup. apply() cannot pass interpolation
// parameters, so a key that needs one must be built in JS instead.
const PARAM_KEYS = new Set(['provider.modelExamples', 'chat.typing', 'queue.count', 'history.msgs']);

test('catalog and dictionary files line up', () => {
  const files = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
  const codes = I18n.locales().map(m => m.code).sort();
  assert.deepEqual(files, codes);
  assert.equal(codes.length, 29);
  for (const code of codes) assert.ok(I18n.dictionary(code), 'dictionary for ' + code);
});

test('every locale has exactly the English key set', () => {
  const reference = dictKeys('en');
  assert.ok(reference.size > 300, 'expected a full dictionary, got ' + reference.size);
  for (const meta of I18n.locales()) {
    if (meta.code === 'en') continue;
    const missing = [...reference].filter(k => !dictKeys(meta.code).has(k));
    const extra = [...dictKeys(meta.code)].filter(k => !reference.has(k));
    assert.deepEqual(missing, [], meta.code + ' is missing keys');
    assert.deepEqual(extra, [], meta.code + ' has keys English does not');
  }
});

test('every locale keeps the English %{placeholders}', () => {
  for (const meta of I18n.locales()) {
    if (meta.code === 'en') continue;
    const en = I18n.dictionary('en');
    const dict = I18n.dictionary(meta.code);
    for (const key of I18n.keys('en')) {
      const expected = placeholdersOf(en[key]);
      const actual = placeholdersOf(dict[key]);
      assert.deepEqual([...actual].sort(), [...expected].sort(), meta.code + ' ' + key + ' placeholders');
    }
  }
});

test('plural keys stay plural in every locale and always have an "other" form', () => {
  const pluralKeys = I18n.keys('en').filter(k => typeof I18n.dictionary('en')[k] === 'object');
  assert.ok(pluralKeys.length >= 5, 'expected the relative-time plurals, got ' + pluralKeys.length);
  for (const meta of I18n.locales()) {
    const dict = I18n.dictionary(meta.code);
    for (const key of pluralKeys) {
      const entry = dict[key];
      assert.equal(typeof entry, 'object', meta.code + ' ' + key + ' must be a plural map');
      assert.equal(typeof entry.other, 'string', meta.code + ' ' + key + ' needs an "other" form');
    }
  }
});

test('regional and legacy tags reduce to the supported base locale', () => {
  const table = {
    'es-MX': 'es', 'es-419': 'es', 'pt-BR': 'pt', 'pt-PT': 'pt', 'fr-CA': 'fr',
    'de-AT': 'de', 'de-CH': 'de', 'zh-CN': 'zh', 'zh-Hans': 'zh', 'zh-SG': 'zh',
    'zh-TW': 'zh', 'ar-EG': 'ar', 'ar-SA': 'ar', 'fa-IR': 'fa', 'ja-JP': 'ja',
    'ru-RU': 'ru', 'pl-PL': 'pl', 'ms-MY': 'ms', 'en-GB': 'en', 'en': 'en',
    'in': 'id', 'id-ID': 'id', 'EN_us': 'en', 'pt': 'pt',
  };
  for (const [tag, code] of Object.entries(table)) {
    assert.equal(I18n.resolve(tag), code, tag);
  }
  // Filipino and Tagalog have no interface dictionary. They must fall through
  // to the visitor's next language, never to Indonesian (the old alias).
  assert.equal(I18n.resolve('tl-PH'), null);
  assert.equal(I18n.resolve('fil'), null);
  assert.equal(I18n.detect(['fil-PH', 'en-US']), 'en');
  assert.equal(I18n.detect(['tl']), 'en');
  // An unknown stored value (the card test seeds 'zz-test') must never throw.
  assert.equal(I18n.resolve('xx-YY'), null);
  assert.equal(I18n.resolve('zz-test'), null);
  assert.equal(I18n.resolve(''), null);
  assert.equal(I18n.resolve(null), null);
});

test('detection uses the browser order and falls back to English', () => {
  assert.equal(I18n.detect(['xx', 'fr-CA', 'de']), 'fr');
  assert.equal(I18n.detect(['de-AT']), 'de');
  assert.equal(I18n.detect(['nope']), 'en');
  assert.equal(I18n.detect(['zz-test']), 'en');
  assert.equal(I18n.detect([]), 'en');
  assert.equal(I18n.detect(['in']), 'id');
});

test('English is the fallback for a missing key, then the key itself', async () => {
  await I18n.setLocale('fr');
  const fr = I18n.dictionary('fr');
  const keep = fr['app.live2d'];
  delete fr['app.live2d'];
  try {
    assert.equal(I18n.t('app.live2d'), I18n.dictionary('en')['app.live2d']);
  } finally {
    fr['app.live2d'] = keep;
  }
  assert.equal(I18n.t('no.such.key'), 'no.such.key');
  await I18n.setLocale('en');
});

test('plural forms resolve per locale through Intl.PluralRules', async () => {
  const cases = { en: ['en', [1, 3]], ru: ['ru', [1, 2, 5, 21, 22]], pl: ['pl', [1, 2, 5, 22, 25]], ar: ['ar', [0, 1, 2, 3, 11, 100]] };
  for (const [code, [tag, counts]] of Object.entries(cases)) {
    await I18n.setLocale(code);
    const entry = I18n.dictionary(code)['history.minutesAgo'];
    const rules = new Intl.PluralRules(tag);
    for (const n of counts) {
      const form = rules.select(n);
      const expected = String(entry[form] != null ? entry[form] : entry.other).replace('%{count}', String(n));
      assert.equal(I18n.t('history.minutesAgo', { count: n }), expected, code + ' count=' + n);
    }
  }
  await I18n.setLocale('en');
});

test('RTL metadata and native locale names are correct', () => {
  assert.equal(I18n.localeInfo('ar').dir, 'rtl');
  assert.equal(I18n.localeInfo('fa').dir, 'rtl');
  for (const code of ['en', 'es', 'pt', 'fr', 'ru', 'ja', 'zh', 'de', 'id', 'ms', 'pl']) {
    assert.equal(I18n.localeInfo(code).dir, 'ltr', code);
  }
  assert.equal(I18n.localeInfo('pt').tag, 'pt-BR');
  assert.equal(I18n.localeInfo('zh').tag, 'zh-CN');
  assert.equal(I18n.localeInfo('fa').tag, 'fa');
  // Native locale names, and the reply-language endonyms the app shows.
  assert.equal(I18n.localeInfo('ja').name, '日本語');
  assert.equal(I18n.languageName('Japanese'), '日本語');
  assert.equal(I18n.languageName('Arabic'), 'العربية');
  assert.equal(I18n.languageName('Klingon'), 'Klingon');
});

test('every markup key resolves and none needs interpolated parameters', () => {
  const html = readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  const attrs = [...html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label|-value)?="([^"]+)"/g)];
  assert.ok(attrs.length > 200, 'expected the settings markup to be tagged, got ' + attrs.length);
  const en = I18n.dictionary('en');
  for (const [, key] of attrs) {
    assert.ok(key in en, key + ' is used by index.html but missing from the English dictionary');
    assert.ok(!PARAM_KEYS.has(key), key + ' needs parameters, so apply() would render the raw %{placeholder}');
  }
});

test('every key the app scripts request resolves in the English dictionary', () => {
  // A tr()/t() key that is not in en.js would silently stay English in translated
  // locales, because the runtime falls back to the inline literal.
  const dir = path.join(APP_DIR, 'scripts');
  const en = I18n.dictionary('en');
  const orphans = new Map();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/(?:^|[^.\w])(?:tr|has|ensure|t)\(\s*'((?:[\w-]+\.)+[\w-]+)'/g)) {
      if (!(m[1] in en)) orphans.set(m[1], file);
    }
    for (const m of src.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label|-value)?="([^"]+)"/g)) {
      if (!(m[1] in en)) orphans.set(m[1], file);
    }
  }
  assert.deepEqual([...orphans], [], 'keys requested by scripts but missing from en.js (key, file)');
});

test('the retired AI UI translator is gone and the runtime is wired in', () => {
  const html = readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  assert.ok(!/data-ui-/.test(html), 'old data-ui-* attributes must be renamed to data-i18n*');
  assert.ok(!/ui_translator\.js|ui_strings\.js/.test(html), 'the translator scripts must not be loaded');
  assert.ok(!/translateUICheckbox|Translate User Interface/.test(html), 'the AI UI translation toggle must be gone');
  assert.ok(!/interfaceLanguageSelector/.test(html) === false, 'the Interface language picker must exist');
  // Head wiring, in order, before the CDN tags so <html dir> is right on the first paint.
  const order = ['scripts/embed_mode.js', '../i18n/i18n.js', '../i18n/bootstrap.js', '../i18n/locales/en.js', 'live2dcubismcore.js', 'cdn.jsdelivr.net'];
  let at = -1;
  for (const needle of order) {
    const found = html.indexOf(needle);
    assert.ok(found > at, needle + ' must be loaded in order');
    at = found;
  }
  assert.ok(/WaifuI18n\s*&&\s*window\.WaifuI18n\.apply\(document\)/.test(html), 'apply(document) must run at end of body');
});

test('bootstrap reads the app storage key, prefixed inside a Player Card', () => {
  const src = readFileSync(path.join(I18N_DIR, 'bootstrap.js'), 'utf8');
  assert.ok(/storageKey:\s*root\.WaifuEmbed\s*\?\s*'waifu_x_interfaceLanguage'\s*:\s*'interfaceLanguage'/.test(src));
  assert.ok(/localesBase/.test(src));
  // Same-named files must stay the shared runtime, not a fork.
  const runtime = readFileSync(path.join(I18N_DIR, 'i18n.js'), 'utf8');
  assert.ok(/root\.WaifuI18n = api/.test(runtime));
});

test('shared clients keep their English fallbacks without the runtime', () => {
  // mic_capture.js and context_budget.js are byte-identical to the other
  // WaifuAI clients, so the English text must live inside the call, not only
  // in the dictionary.
  for (const file of ['mic_capture.js', 'context_budget.js']) {
    const src = readFileSync(path.join(APP_DIR, 'scripts', file), 'utf8');
    assert.ok(/tr\('mic\.|tr\('memory\.|tr\('voice\./.test(src), file + ' must resolve its strings through tr()');
    assert.ok(/typeof window !== 'undefined' && window\.WaifuI18n|root\.WaifuI18n/.test(src), file + ' must guard the runtime');
  }
});

test('brand names in the source strings survive translation', () => {
  // Users meet these names in docs, signup and other apps, so a translated
  // string that mentions one keeps the Latin token rather than transliterating
  // it. Only keys whose English text carries a brand are checked, so ordinary
  // prose is untouched.
  const BRANDS = ['WaifuAI Cloud', 'WaifuAI', 'OpenRouter', 'Groq', 'Kokoro', 'Live2D', 'TikTok', 'Player Card'];
  const en = I18n.dictionary('en');
  for (const [key, value] of Object.entries(en)) {
    if (typeof value !== 'string') continue;
    for (const brand of BRANDS) {
      if (!value.includes(brand)) continue;
      for (const meta of I18n.locales()) {
        if (meta.code === 'en') continue;
        const translated = I18n.dictionary(meta.code)[key];
        assert.ok(typeof translated === 'string' && translated.includes(brand),
          meta.code + ' ' + key + ' must keep "' + brand + '" untranslated');
      }
    }
  }
});

const EXPANDED_LOCALES = ['bn', 'ko', 'hi', 'tr', 'vi', 'uk', 'cs', 'th', 'nl', 'el', 'ro', 'hu', 'fi', 'my', 'si'];

test('new interface locales detect regional browser preferences and keep native names', () => {
  const regions = { bn: 'BD', ko: 'KR', hi: 'IN', tr: 'TR', vi: 'VN', uk: 'UA',
    cs: 'CZ', th: 'TH', nl: 'NL', el: 'GR', ro: 'RO', hu: 'HU', fi: 'FI', my: 'MM', si: 'LK' };
  for (const code of [...EXPANDED_LOCALES, 'it']) {
    const tag = code + '-' + (regions[code] || 'IT');
    assert.equal(I18n.resolve(tag), code, tag);
    assert.equal(I18n.detect(['xx-YY', tag, 'en-US']), code, tag);
    const meta = I18n.localeInfo(code);
    assert.equal(meta.dir, 'ltr', code);
    assert.equal(I18n.languageName(meta.englishName), meta.name, code);
  }
});

test('new dictionaries preserve entry types, each plural placeholder, HTML and brand tokens', () => {
  const en = I18n.dictionary('en');
  const tokens = value => String(value).match(/%\{\w+\}/g)?.sort() || [];
  const tags = value => String(value).match(/<\/?[a-zA-Z][^>]*>/g) || [];
  const brands = ['WaifuAI Cloud', 'WaifuAI', 'OpenRouter', 'Groq', 'Kokoro', 'Live2D', 'TikTok', 'Player Card', 'LISTEN.moe', '/image'];
  for (const code of EXPANDED_LOCALES) {
    const dict = I18n.dictionary(code);
    const categories = new Intl.PluralRules(I18n.localeInfo(code).tag).resolvedOptions().pluralCategories;
    for (const [key, source] of Object.entries(en)) {
      const entry = dict[key];
      assert.equal(typeof entry, typeof source, code + ':' + key);
      if (typeof source === 'object') {
        for (const category of categories) assert.equal(typeof entry[category], 'string', code + ':' + key + ':' + category);
      }
      const reference = typeof source === 'string' ? source : source.other;
      for (const translated of typeof entry === 'string' ? [entry] : Object.values(entry)) {
        assert.ok(typeof translated === 'string' && translated.trim(), code + ':' + key);
        assert.ok(!translated.includes('\uFFFD'), code + ':' + key + ' has a replacement character');
        assert.deepEqual(tokens(translated), tokens(reference), code + ':' + key + ' placeholders');
        assert.deepEqual(tags(translated), tags(reference), code + ':' + key + ' HTML');
        for (const brand of brands.filter(brand => reference.includes(brand))) {
          assert.ok(translated.includes(brand), code + ':' + key + ' must keep ' + brand);
        }
      }
    }
  }
});

test('new locale plural forms render counts without unresolved placeholders', async () => {
  const en = I18n.dictionary('en');
  const pluralKeys = Object.keys(en).filter(key => typeof en[key] === 'object');
  for (const code of EXPANDED_LOCALES) {
    await I18n.setLocale(code);
    const rules = new Intl.PluralRules(I18n.localeInfo(code).tag);
    for (const key of pluralKeys) {
      const entry = I18n.dictionary(code)[key];
      for (const count of [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 1.5, 1000000]) {
        const expected = entry[rules.select(count)].replace(/%\{count\}/g, String(count));
        assert.equal(I18n.t(key, { count }), expected, code + ':' + key + ':' + count);
      }
    }
  }
  await I18n.setLocale('en');
});
