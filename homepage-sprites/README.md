# Homepage Sprites

The homepage uses an adapted copy of the Sprites interface and its localization files. The interface markup lives in the root `index.html`; the scripts and styles are in this directory. Animated clips are loaded from jsDelivr, with a still-image fallback.

Run the video analytics checks with:

```sh
node --test homepage-sprites/tests/video-analytics.test.cjs
```

## Syncing from the source

The upstream client lives in `waifuai.github.io\waifu-sprites\`
(change it there first, commit, then copy here). Never blind-copy: re-apply the
embed adaptations, which are the ONLY lines that should differ from the source:

- `chat.js` — the four `client_settings`/pack `app:` fields become
  `app: window.WaifuSpritesSource || 'homepage-sprites'` (chat request, summarizer,
  pack size check, `buildRequest`), and **keep the plain `storagePrefix = 'ws_'`**
  (storage keys must never change in this copy).
- `app.js` — the gtag `app_source` becomes
  `window.WaifuSpritesSource || 'homepage-sprites'`, and **keep the plain
  `DISPLAY_KEY = 'ws_display'`** (same rule).
- Every other file (`context_budget.js`, `speech.js`, `voice.js`, `pictures.js`,
  `sprites.js`, `mic_capture.js`, `tts_language_router.js`, `prompt_translations.js`,
  `i18n/`) is a plain copy. (`pictures.js` and `sprites.js` currently carry older
  embed adaptations and have no source-side changes since the last sync.)

Verify by diffing each file against the source with line endings normalized
(`sed 's/\r$//'`): the only remaining differences must be the adaptation lines above.
