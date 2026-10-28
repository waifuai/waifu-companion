# `i18n/` — the shared interface-localization runtime

A tiny, dependency-free runtime that shows every visitor their own language on
the first paint, with no flash of English and no per-visit model call. It is
plain `<script>` tags and local dictionaries: no build step, no webfont,
no CDN.

Waifu Sprites and Waifu Companion share the same runtime and catalog. Companion
vendors byte-identical copies of `i18n.js` and `chat_prompts.js`; each app has
its own complete interface dictionaries matching its English key set.

| File | Role |
|---|---|
| `i18n/i18n.js` | The runtime: locale catalog, detection, `t()`, plurals, `apply()`, `setLocale()`, `onChange()`, RTL metadata. |
| `i18n/bootstrap.js` | Runs in `<head>`: picks the language, sets `<html lang dir>` before paint, and loads the matched dictionary during parse. |
| `i18n/locales/en.js` | English, the source of truth. Every other dictionary must match its keys. |
| `i18n/locales/<code>.js` | One dictionary per locale. |
| `i18n/chat_prompts.js` | Shared built-in chat instructions, also vendored by Companion. |

## Chat instructions

Sprites loads the shared `chat_prompts.js` bundle and then
`waifu-sprites/prompt_translations.js`. Together they provide chat instructions
for all 33 interface locales: English, Arabic, Spanish, Brazilian Portuguese,
French, Russian, Japanese, Simplified Chinese, Persian, German, Indonesian,
Malay, Polish, Italian, Bengali, Korean, Hindi, Turkish, Vietnamese, Ukrainian,
Czech, Thai, Dutch, Greek, Romanian, Hungarian, Finnish, Burmese, Sinhala, Urdu, Filipino, Tamil and Uzbek.
They cover four built-in personas, response language, picture behavior, emotion
instructions, context wrappers and the default ambient instruction. The shared
bundle is byte-identical to Companion's; Sprites adds only its own keys in its
separate file.

Every locale that `i18n.js` offers in the interface picker must have both a UI
dictionary and chat instructions. All current prompt languages are full interface
locales. A future reply-only prompt must be explicitly listed in
`test_chat_prompts.cjs`'s `REPLY_ONLY_PROMPTS`; the test enforces coverage.

An explicit reply-language selection chooses the instruction locale. Automatic
replies use the interface locale for instruction prose while still following the
latest user message. The reply and interface settings remain independent. Each
prompt ends with a short reminder in the same locale: an explicit choice repeats
the requested language even when the user writes in another language or sends
only a few words, and automatic mode repeats the latest-message rule. An
unsupported prompt language uses English instructions naming the requested
language. Simplified Chinese instructions are not substituted for a Traditional
Chinese selection. Missing bundles leave English chat instructions usable; no
translation service or model call is used to select a prompt.

Custom personas, extra instructions, user background, memories and custom
ambient prompts remain verbatim and are never rewritten in storage. An exact
saved copy of the old English default ambient prompt is treated as the built-in
default when constructing a request. Emotion identifiers such as `[curious]`
remain unchanged; their explanations and examples are translated, and the tags
are still stripped from displayed and spoken replies. Internal picture writers,
summaries and transliteration tasks retain their existing output contracts.

## Adopting it in another app

1. **Load the runtime in `<head>`, in order**, before anything that reads a
   language:

   ```html
   <script src="../i18n/i18n.js"></script>
   <script src="../i18n/bootstrap.js"></script>
   <script src="../i18n/locales/en.js"></script>
   ```

   Set `window.WaifuSpritesEmbed` (or your own flag) before `bootstrap.js` if the
   page needs its own storage key; otherwise edit the `storageKey` in
   `bootstrap.js`.

2. **Mark up static text** with `data-i18n*` attributes (all optional, all
   re-applied by `apply()`, so a language switch needs no re-render):

   | Attribute | Effect |
   |---|---|
   | `data-i18n="key"` | `textContent` |
   | `data-i18n-html="key"` | `innerHTML` (only for strings you author that contain `<code>`/`<a>`) |
   | `data-i18n-placeholder="key"` | `placeholder` |
   | `data-i18n-title="key"` | `title` |
   | `data-i18n-aria-label="key"` | `aria-label` |
   | `data-i18n-value="key"` | `value` |

3. **Translate strings built in JavaScript** with
   `WaifuI18n.t('key')` / `t('key', { count: 3 })`, and prefer the same
   `data-i18n*` attributes on elements you create so `apply(document)` can
   re-translate them in place. For live state (a status pill, a placeholder that
   depends on a control), register `WaifuI18n.onChange(fn)`.

4. **Run `WaifuI18n.apply(document)` before your app scripts** at the end of
   `<body>`.

5. **Offer a language picker** with `WaifuI18n.locales()` (metadata) and switch
   with `WaifuI18n.setLocale(code)`; `'auto'` restores device detection. A
   dictionary that is not yet in the page loads on demand; if it fails the page
   simply keeps the language it has.

## Detection and persistence

First match wins: a saved choice (`localStorage`, per app) → `navigator.languages`
in the visitor's own order → `navigator.language` → English. Regional and legacy
tags reduce to the base locale (`es-MX`→`es`, `pt-PT`→`pt`, `zh-TW`→`zh`,
`in`→`id`, …). Tagalog (`tl`) resolves to the Filipino (`fil`) dictionary. Only an explicit pick is stored, so a visitor who later changes
their browser language still gets the new language; `auto` remembers the intent
without freezing the language.

The picker lists all 33 catalog locales plus the device-language option.
`python waifu-sprites/tests/test_locale_expansion_browser.py` checks every new locale
and Italian in narrow full-app and embedded layouts, saved-choice reloads,
new-language startup, and device-language loading after a saved choice. Inference
is mocked. `test_locale_loading.cjs` also covers a failed dictionary download;
the working interface remains active.

## Adding a language

One `locales/<code>.js` file, and a catalog entry in `i18n.js` only when the tag
does not already reduce to a supported base. A `zh-Hant` dictionary later needs
no runtime change. An interface locale also needs instructions in the shared
`chat_prompts.js` bundle and its Sprites keys in `prompt_translations.js`;
`test_chat_prompts.cjs` fails when a catalog locale has no prompt dictionary. A
reply-only locale needs only the prompt dictionaries and must be listed in that
test's `REPLY_ONLY_PROMPTS`.

### Dictionary contract

- Register with the same wrapper as `en.js`:

  ```js
  (function (root) {
    'use strict';
    var api = root.WaifuI18n;
    if (!api) return;
    api.register('xx', { /* … */ });
  })(typeof window !== 'undefined' ? window : globalThis);
  ```

- Keys are flat `namespace.key` strings. **Every key in `en.js` must be present**
  and no others; `tests/test_i18n.cjs` fails the build otherwise.
- Interpolate with `%{name}` and keep the placeholders exactly as English has
  them.
- A key whose text depends on a number maps to a plural object
  (`{ one, few, many, two, zero, other }`); include the forms your language uses
  plus `other`. `WaifuI18n` picks the form with `Intl.PluralRules`.
- Keep brand names and identifiers unchanged: `WaifuAI Cloud`, `OpenRouter`, `Groq`, `TikTok`, `LISTEN.moe`,
  `Romaji`, `/image`.
- Translate built-in chat instructions in the prompt bundles, preserving all
  placeholders, emotion identifiers and the original meaning. Never translate
  user-authored text as part of interface localization. Internal task prompts
  retain their separate output contracts.
- Strings authored with markup keep it: `settings.picturesNote` keeps
  `<code dir="ltr">/image</code>`, `settings.radioNote` keeps the `LISTEN.moe`
  link.
- Numbers stay Latin digits with no grouping, so size reports like
  `14 / 32768 bytes` are identical in every language.

The Urdu, Filipino, Tamil and Uzbek interface dictionaries and some prompt translations use machine translation; native-speaker review remains pending.
