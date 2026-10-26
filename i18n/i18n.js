/**
 * WaifuI18n — a small, dependency-free interface-localization runtime.
 *
 * Shared by the WaifuAI pages. It only knows about metadata (which locales
 * exist, their BCP-47 tag, native name and direction) and dictionaries that
 * per-locale files register into it; it never fetches translations from a
 * service and never calls a model.
 *
 * Markup contract (all optional, all re-applied by apply()):
 *   data-i18n="key"              textContent
 *   data-i18n-html="key"         innerHTML (only for strings we author, e.g. ones with <code>/<a>)
 *   data-i18n-placeholder="key"  the placeholder attribute
 *   data-i18n-title="key"        the title attribute
 *   data-i18n-aria-label="key"   the aria-label attribute
 *   data-i18n-value="key"        the value attribute (buttons/inputs)
 *
 * Code contract:  WaifuI18n.t('key') and WaifuI18n.t('key', { count: 3 })
 *
 * Dictionary contract: a flat map of 'a.b.c' keys to either a string or, when
 * the string depends on a number, an object keyed by CLDR plural category
 * ({ one, other, few, many, two, zero }). Interpolate with %{name}.
 */
(function (root) {
  'use strict';

  var FALLBACK = 'en';
  var PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

  // Metadata only: which locales exist. Strings live in locales/<code>.js.
  var CATALOG = [
    { code: 'en', tag: 'en', name: 'English', englishName: 'English', dir: 'ltr' },
    { code: 'ar', tag: 'ar', name: 'العربية', englishName: 'Arabic', dir: 'rtl' },
    { code: 'es', tag: 'es', name: 'Español', englishName: 'Spanish', dir: 'ltr' },
    { code: 'pt', tag: 'pt-BR', name: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', dir: 'ltr' },
    { code: 'fr', tag: 'fr', name: 'Français', englishName: 'French', dir: 'ltr' },
    { code: 'ru', tag: 'ru', name: 'Русский', englishName: 'Russian', dir: 'ltr' },
    { code: 'ja', tag: 'ja', name: '日本語', englishName: 'Japanese', dir: 'ltr' },
    { code: 'zh', tag: 'zh-CN', name: '简体中文', englishName: 'Chinese (Simplified)', dir: 'ltr' },
    { code: 'fa', tag: 'fa', name: 'فارسی', englishName: 'Persian', dir: 'rtl' },
    { code: 'de', tag: 'de', name: 'Deutsch', englishName: 'German', dir: 'ltr' },
    { code: 'id', tag: 'id', name: 'Bahasa Indonesia', englishName: 'Indonesian', dir: 'ltr' },
    { code: 'ms', tag: 'ms', name: 'Bahasa Melayu', englishName: 'Malay', dir: 'ltr' },
    { code: 'pl', tag: 'pl', name: 'Polski', englishName: 'Polish', dir: 'ltr' },
    { code: 'it', tag: 'it', name: 'Italiano', englishName: 'Italian', dir: 'ltr' },
    { code: 'bn', tag: 'bn', name: 'বাংলা', englishName: 'Bengali', dir: 'ltr' },
    { code: 'ko', tag: 'ko', name: '한국어', englishName: 'Korean', dir: 'ltr' },
    { code: 'hi', tag: 'hi', name: 'हिन्दी', englishName: 'Hindi', dir: 'ltr' },
    { code: 'tr', tag: 'tr', name: 'Türkçe', englishName: 'Turkish', dir: 'ltr' },
    { code: 'vi', tag: 'vi', name: 'Tiếng Việt', englishName: 'Vietnamese', dir: 'ltr' },
    { code: 'uk', tag: 'uk', name: 'Українська', englishName: 'Ukrainian', dir: 'ltr' },
    { code: 'cs', tag: 'cs', name: 'Čeština', englishName: 'Czech', dir: 'ltr' },
    { code: 'th', tag: 'th', name: 'ไทย', englishName: 'Thai', dir: 'ltr' },
    { code: 'nl', tag: 'nl', name: 'Nederlands', englishName: 'Dutch', dir: 'ltr' },
    { code: 'el', tag: 'el', name: 'Ελληνικά', englishName: 'Greek', dir: 'ltr' },
    { code: 'ro', tag: 'ro', name: 'Română', englishName: 'Romanian', dir: 'ltr' },
    { code: 'hu', tag: 'hu', name: 'Magyar', englishName: 'Hungarian', dir: 'ltr' },
    { code: 'fi', tag: 'fi', name: 'Suomi', englishName: 'Finnish', dir: 'ltr' },
    { code: 'my', tag: 'my', name: 'မြန်မာဘာသာ', englishName: 'Myanmar (Burmese)', dir: 'ltr' },
    { code: 'si', tag: 'si', name: 'සිංහල', englishName: 'Sinhala (Sinhalese)', dir: 'ltr' },
  ];

  // Legacy tags that do not reduce to a supported base language. Filipino and
  // Tagalog have reply-language support but no interface dictionary, so they
  // deliberately fall through to the next browser language (usually English);
  // mapping tl/fil to Indonesian would show the wrong interface.
  var ALIASES = { in: 'id' };

  // Endonyms for the reply-language list. The English name is the value the
  // app sends in the system prompt; the label the visitor sees is the language's
  // own name, the same in every interface language, so it lives here as
  // metadata instead of in every interface dictionary.
  var ENDONYMS = {
    'Arabic': 'العربية', 'Bengali': 'বাংলা', 'Chinese (Simplified)': '简体中文',
    'Chinese (Traditional)': '繁體中文', 'Czech': 'Čeština', 'Dutch': 'Nederlands',
    'English': 'English', 'Filipino': 'Filipino', 'Finnish': 'Suomi', 'French': 'Français',
    'German': 'Deutsch', 'Greek': 'Ελληνικά', 'Hebrew': 'עברית', 'Hindi': 'हिन्दी',
    'Hungarian': 'Magyar', 'Indonesian': 'Bahasa Indonesia', 'Italian': 'Italiano',
    'Japanese': '日本語', 'Korean': '한국어', 'Malay': 'Bahasa Melayu',
    'Myanmar (Burmese)': 'မြန်မာဘာသာ', 'Persian': 'فارسی', 'Polish': 'Polski',
    'Portuguese (Brazil)': 'Português (Brasil)', 'Portuguese (Portugal)': 'Português (Portugal)',
    'Romanian': 'Română', 'Russian': 'Русский', 'Sinhala (Sinhalese)': 'සිංහල',
    'Spanish': 'Español', 'Swedish': 'Svenska',
    'Tamil': 'தமிழ்', 'Thai': 'ไทย', 'Turkish': 'Türkçe', 'Ukrainian': 'Українська',
    'Urdu': 'اردو', 'Vietnamese': 'Tiếng Việt',
  };

  /** The native name of a reply language, or the given name when unknown. */
  function languageName(name) { return ENDONYMS[name] || name; }

  var metas = Object.create(null);   // code -> metadata
  var order = [];                    // catalog order (display + priority)
  var dicts = Object.create(null);   // code -> dictionary
  var resolved = Object.create(null); // normalized tag -> code
  var listeners = [];
  var pluralRules = Object.create(null);
  var pending = Object.create(null); // code -> Promise for an on-demand bundle
  var settings = { storageKey: 'waifu_locale', localesBase: '', fallback: FALLBACK };
  var current = FALLBACK;
  var choice = null;                 // null (never chosen) | 'auto' | locale code

  function normalize(tag) {
    return String(tag == null ? '' : tag).trim().toLowerCase().replace(/_/g, '-');
  }

  function addLocale(meta) {
    if (!meta || !meta.code) throw new Error('WaifuI18n.addLocale needs { code }');
    var code = meta.code;
    metas[code] = Object.assign({ code: code, tag: code, name: code, englishName: code, dir: 'ltr' }, meta);
    if (order.indexOf(code) === -1) order.push(code);
    delete resolved[normalize(code)];
    delete resolved[normalize(metas[code].tag)];
    return metas[code];
  }

  /** Registers one locale dictionary. meta is optional when the catalog already has the locale. */
  function register(code, dict, meta) {
    if (meta) addLocale(Object.assign({ code: code }, meta));
    else if (!metas[code]) addLocale({ code: code });
    dicts[code] = dict || {};
    return dicts[code];
  }

  function localeInfo(code) { return metas[code] || null; }

  function locales() { return order.map(function (code) { return metas[code]; }); }

  function dictionary(code) { return dicts[code] || null; }

  function byTag(tag) {
    for (var i = 0; i < order.length; i++) {
      var code = order[i];
      if (normalize(code) === tag || normalize(metas[code].tag) === tag) return code;
    }
    return null;
  }

  function byBase(base) {
    for (var i = 0; i < order.length; i++) if (order[i] === base) return base;
    for (var j = 0; j < order.length; j++) {
      if (normalize(metas[order[j]].tag).split('-')[0] === base) return order[j];
    }
    return null;
  }

  /**
   * Turns any BCP-47 tag into a supported locale code, or null.
   * 'es-MX' -> 'es', 'pt-PT' -> 'pt', 'zh-TW' -> 'zh', 'in' -> 'id'.
   */
  function resolve(tag) {
    var norm = normalize(tag);
    if (!norm) return null;
    if (resolved[norm]) return resolved[norm];
    if (ALIASES[norm]) norm = ALIASES[norm];
    var found = byTag(norm);
    if (!found) found = byTag(norm.split('-')[0]);
    if (!found) found = byBase(norm.split('-')[0]);
    if (found) resolved[normalize(tag)] = found;
    return found;
  }

  function browserLanguages() {
    var nav = root.navigator || {};
    var list = Array.isArray(nav.languages) ? nav.languages.slice() : [];
    if (nav.language) list.push(nav.language);
    return list.filter(Boolean);
  }

  /** First supported locale in the visitor's own preference order; English when nothing matches. */
  function detect(list) {
    var tags = Array.isArray(list) ? list : browserLanguages();
    for (var i = 0; i < tags.length; i++) {
      var code = resolve(tags[i]);
      if (code) return code;
    }
    return settings.fallback || FALLBACK;
  }

  function pluralForm(code, count) {
    var tag = (metas[code] && metas[code].tag) || code;
    if (!pluralRules[tag]) {
      try { pluralRules[tag] = new Intl.PluralRules(tag); } catch (e) { pluralRules[tag] = null; }
    }
    var rules = pluralRules[tag];
    var form = rules ? rules.select(count) : (count === 1 ? 'one' : 'other');
    return PLURAL_FORMS.indexOf(form) === -1 ? 'other' : form;
  }

  function lookup(code, key) {
    var dict = dicts[code];
    if (!dict) return undefined;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    // Nested dictionaries are accepted as well as flat keys.
    var parts = String(key).split('.');
    var node = dict;
    for (var i = 0; i < parts.length; i++) {
      if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, parts[i])) node = node[parts[i]];
      else return undefined;
    }
    return node;
  }

  function pick(value, params, code) {
    if (value == null || value === '') return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      var count = params && typeof params.count === 'number' ? params.count : null;
      if (count === null) return value.other;
      var form = pluralForm(code, count);
      return value[form] != null ? value[form] : value.other;
    }
    return undefined;
  }

  function interpolate(text, params) {
    if (!params) return text;
    return String(text).replace(/%\{(\w+)\}/g, function (all, name) {
      return params[name] == null ? all : String(params[name]);
    });
  }

  /** The translated string for a key, falling back to English and then to the key itself. */
  function t(key, params) {
    var value = pick(lookup(current, key), params, current);
    if (value == null && current !== settings.fallback) value = pick(lookup(settings.fallback, key), params, settings.fallback);
    if (value == null) return key;
    return interpolate(value, params);
  }

  function has(key) {
    return pick(lookup(current, key), null, current) != null ||
      pick(lookup(settings.fallback, key), null, settings.fallback) != null;
  }

  /** Every key the active locale defines, sorted. Used by the parity checks. */
  function keys(code) {
    var dict = dicts[code || current];
    if (!dict) return [];
    var out = Object.keys(dict).filter(function (k) { return typeof dict[k] === 'string' || (dict[k] && typeof dict[k] === 'object'); });
    var nested = function (node, prefix) {
      Object.keys(node).forEach(function (k) {
        var value = node[k];
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.other !== 'string' && typeof value.one !== 'string') {
          nested(value, prefix + k + '.');
        } else {
          out.push(prefix + k);
        }
      });
    };
    nested(dict, '');
    return Array.from(new Set(out)).sort();
  }

  function dir(code) {
    var meta = metas[code || current];
    return meta && meta.dir === 'rtl' ? 'rtl' : 'ltr';
  }

  function forEach(rootNode, selector, fn) {
    if (!rootNode || !rootNode.querySelectorAll) return;
    var nodes = rootNode.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  /** Translates every marked node under scope (document by default). Safe to call repeatedly. */
  function apply(scope) {
    var doc = root.document;
    if (!doc) return;
    var node = scope || doc;
    forEach(node, '[data-i18n]', function (el) {
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    forEach(node, '[data-i18n-html]', function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
    forEach(node, '[data-i18n-placeholder]', function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    forEach(node, '[data-i18n-title]', function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
    forEach(node, '[data-i18n-aria-label]', function (el) {
      var key = el.getAttribute('data-i18n-aria-label');
      if (key) el.setAttribute('aria-label', t(key));
    });
    forEach(node, '[data-i18n-value]', function (el) {
      var key = el.getAttribute('data-i18n-value');
      if (key) el.value = t(key);
    });
  }

  function applyEnvironment() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return;
    var meta = metas[current] || {};
    doc.documentElement.lang = meta.tag || current;
    doc.documentElement.dir = dir(current);
    doc.documentElement.setAttribute('data-locale', current);
  }

  function readSaved() {
    try {
      var raw = root.localStorage ? root.localStorage.getItem(settings.storageKey) : null;
      return raw ? String(raw) : null;
    } catch (e) { return null; }
  }

  function writeSaved(value) {
    try {
      if (!root.localStorage) return;
      if (value) root.localStorage.setItem(settings.storageKey, value);
    } catch (e) { /* storage blocked: the choice still applies for this visit */ }
  }

  function activate(code) {
    current = code || settings.fallback || FALLBACK;
    applyEnvironment();
    apply();
    listeners.slice().forEach(function (fn) { try { fn(current); } catch (e) { } });
    return current;
  }

  /** Loads locales/<code>.js on demand when a switch needs a bundle that is not in the page. */
  function ensure(code) {
    if (dicts[code]) return Promise.resolve(code);
    var doc = root.document;
    if (!doc || !settings.localesBase) return Promise.resolve(current);
    if (!pending[code]) {
      pending[code] = new Promise(function (ok, fail) {
        var el = doc.createElement('script');
        el.src = settings.localesBase + code + '.js';
        el.async = false;
        el.onload = function () { ok(code); };
        el.onerror = function () { fail(new Error('WaifuI18n: could not load ' + code)); };
        (doc.head || doc.documentElement).appendChild(el);
      }).catch(function () { return null; });
    }
    return pending[code].then(function () { return dicts[code] ? code : current; });
  }

  /**
   * Switches the interface language. 'auto' (or no argument) restores device
   * detection. Resolves with the locale actually in use, which is the current
   * one when a bundle could not be loaded.
   */
  function setLocale(code, opts) {
    opts = opts || {};
    var auto = !code || code === 'auto';
    choice = auto ? 'auto' : code;
    if (opts.persist !== false) writeSaved(auto ? 'auto' : code);
    var target = auto ? detect() : (resolve(code) || code);
    return ensure(target).then(function (ready) {
      if (ready === target || dicts[target]) return activate(target);
      return current;
    });
  }

  /**
   * Resolves the language to show now and applies it. Synchronous, so a page
   * can decide what to load before it paints.
   */
  function init(opts) {
    if (opts) settings = Object.assign(settings, opts);
    var saved = readSaved();
    choice = saved && (saved === 'auto' || resolve(saved)) ? (saved === 'auto' ? 'auto' : resolve(saved)) : null;
    var code = choice && choice !== 'auto' ? choice : detect();
    return activate(code);
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  CATALOG.forEach(addLocale);

  var api = {
    FALLBACK: FALLBACK,
    PLURAL_FORMS: PLURAL_FORMS,
    addLocale: addLocale,
    register: register,
    locales: locales,
    localeInfo: localeInfo,
    dictionary: dictionary,
    keys: keys,
    resolve: resolve,
    languageName: languageName,
    detect: detect,
    browserLanguages: browserLanguages,
    init: init,
    ensure: ensure,
    setLocale: setLocale,
    apply: apply,
    onChange: onChange,
    has: has,
    t: t,
    get locale() { return current; },
    get choice() { return choice; },
    get dir() { return dir(current); },
    get languages() { return browserLanguages(); },
  };

  root.WaifuI18n = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
