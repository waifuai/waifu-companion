# `i18n/` — the shared interface-localization runtime

A tiny, dependency-free runtime that shows every visitor their own language on
the first paint, with no flash of English and no per-visit model call. It is
plain `<script>` tags and local dictionaries: no build step, no webfont,
no CDN.

Waifu Sprites wrote it; **Waifu Companion is the second consumer and vendors the
same runtime and catalog here**. Each app has complete dictionaries matching
its own English key set, with consistent translations for shared text.
`i18n/i18n.js` is byte-identical to
`waifuai.github.io/i18n/i18n.js`.

| File | Role |
|---|---|
| `i18n/i18n.js` | The runtime: locale catalog, detection, `t()`, plurals, `apply()`, `setLocale()`, `onChange()`, RTL metadata. |
| `i18n/bootstrap.js` | Runs in `<head>`: picks the language, sets `<html lang dir>` before paint, and loads the matched dictionary during parse. |
| `i18n/locales/en.js` | English, the source of truth. Every other dictionary must match its keys. |
| `i18n/locales/<code>.js` | One dictionary per locale. |
| `i18n/chat_prompts.js` | Built-in chat instructions, separate from interface dictionaries and custom text. |

Companion's built-in chat prompt and full interface have authored translations
for all 33 catalog locales: English, Arabic, Spanish, Brazilian Portuguese,
French, Russian, Japanese, Simplified Chinese, Persian, German, Indonesian,
Malay, Polish, Italian, Bengali, Korean, Hindi, Turkish, Vietnamese, Ukrainian,
Czech, Thai, Dutch, Greek, Romanian, Hungarian, Finnish, Burmese, Sinhala, Urdu, Filipino, Tamil and Uzbek.
Every interface locale must have a UI dictionary and prompt instructions. All
current prompt languages are full interface locales. A future reply-only prompt
must be explicitly listed in `test_chat_prompts.cjs`'s `REPLY_ONLY_PROMPTS`; the
test enforces coverage.

An explicit reply-language selection chooses the prompt locale. The default
automatic reply setting is the `en-US` entry, labelled "Your language" in the
reply picker: it uses the interface locale for instructions while still asking
for the language of the latest user message. Neither choice changes the other
setting. Each prompt ends with a short reminder in the same locale: an explicit
choice repeats the requested language even when the user writes in another
language or sends only a few words, and automatic mode repeats the
latest-message rule. The settings block labels automatic mode as `auto` instead
of naming English, so it cannot be read as an English instruction. Unsupported
prompt languages use English instructions that still name the requested reply
language. Simplified Chinese instructions are not substituted for a Traditional
Chinese choice. The bundle makes no translation request or model call; English
instructions keep chat usable if it fails to load.

Only an exact built-in persona is replaced in outgoing context. Saved custom
personas, additional instructions, summaries, user background and avatar
descriptions remain verbatim; saved text is never rewritten. Existing persona,
summary and persistent-context field markers, settings keys and image-operation
markers retain their English contract spelling. Image-description and other internal task
prompts keep their own output contracts. Sprites vendors the same base prompt
bundle and adds its own personas, emotion instructions and ambient translations
in `waifu-sprites/prompt_translations.js`; its adoption is also local. The
interface runtime and dictionaries remain shared as before.

## Companion notes (differences from the Sprites copy)

1. **Storage key.** `bootstrap.js` derives it from `window.WaifuEmbed`, which
   `app/scripts/embed_mode.js` sets before the runtime loads:
   `waifu_x_interfaceLanguage` in a Player Card, plain `interfaceLanguage` in
   the full app. That is the app's existing `AppStorage.KEYS.INTERFACE_LANGUAGE`
   name, so a saved choice survives the upgrade (`ja-JP` → `ja`, `de-DE` → `de`,
   `id-ID` → `id`). Only an explicit pick is stored; `auto` is remembered
   literally and detection still runs every visit.
2. **Path.** The app reaches the runtime as `../i18n/…` and marks up the app in
   `app/index.html`; the runtime and the dictionaries live at the repository
   root, not inside `app/`.
3. This app is a vanilla-JS Live2D client; there is no build step and no
   service worker, exactly like Sprites.

## Adopting it in another app

1. **Load the runtime in `<head>`, in order**, before anything that reads a
   language:

   ```html
   <script src="../i18n/i18n.js"></script>
   <script src="../i18n/bootstrap.js"></script>
   <script src="../i18n/locales/en.js"></script>
   ```

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
`in`→`id`, …). Tagalog (`tl`) resolves to the Filipino (`fil`) dictionary.

The picker lists all 33 catalog locales plus the device-language option.
`python app/tests/test_locale_expansion_browser.py` checks every new locale
and Italian in narrow full-app and embedded layouts, saved-choice reloads,
new-language startup, and device-language loading after a saved choice. Inference
is mocked. `test_locale_loading.cjs` also covers a failed dictionary download;
the working interface remains active.

## Adding a language

One `locales/<code>.js` file, and a catalog entry in `i18n.js` only when the tag
does not already reduce to a supported base. An interface locale also needs a
dictionary in `i18n/chat_prompts.js`: `test_chat_prompts.cjs` fails when a
catalog locale has no instructions. A reply-only locale needs only the prompt
dictionary and must be listed in that test's `REPLY_ONLY_PROMPTS`.

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
  and no others; `app/tests/test_i18n.cjs` fails otherwise.
- Interpolate with `%{name}` and keep the placeholders exactly as English has
  them.
- A key whose text depends on a number maps to a plural object
  (`{ one, few, many, two, zero, other }`); include the forms your language uses
  plus `other`. `WaifuI18n` picks the form with `Intl.PluralRules`.
- Keep brand names and identifiers unchanged: `WaifuAI Cloud`, `OpenRouter`, `Groq`, `Kokoro`, `Live2D`, `TikTok`,
  `/image`, model ids, URLs, and the response-language list (`languages_full_data.js`
  keeps `englishName (nativeName)` and its English values).
- Translate authored chat instructions in `chat_prompts.js`, preserving every
  placeholder and the original meaning. Never translate user-authored text or
  machine-readable keys as part of interface localization.
- Numbers stay Latin digits with no grouping, so size reports like
  `32 KiB` and `N / 32768 bytes` are identical in every language.

The Urdu, Filipino, Tamil and Uzbek interface dictionaries and some prompt translations use machine translation; native-speaker review remains pending.
