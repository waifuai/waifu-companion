# Live2D Player Card checks

Share **https://waifuai.com/app/?card=player-v1** after deployment. This uses
the same fresh-query-link approach as the Sprites link
`https://waifuai.github.io/waifu-sprites/?card=player-v1`, avoiding reuse of
the exact `/app/` URL whose older image card may already be cached by X.

The `/app/` HTML provides static Player Card metadata regardless of `card`.
It advertises a 480 × 480 player at `https://waifuai.com/app/?embed=x`.
Both `embed=x` and the `card=player-v1` sharing variant select the compact
portrait layout. The avatar fills the scene, messages float over the lower
40%, and the toolbar's chat button hides/restores the conversation. The
homepage keeps its normal image card. X acceptance and cache
behavior still need verification in an actual post.

Serve the repository root with `python -m http.server 8767 --bind 127.0.0.1`
and open `http://127.0.0.1:8767/app/embed-preview.html` to try the desktop and
narrow iframe layouts. Chatting there uses the normal proxy. Loading the card
does not make an inference or speech request. New visitors get the cloud voice
(`cloud`), which is spoken in the reply's language; the request carries only
that language. Replies are spoken after chatting. Automatic language routing
starts on: the reply's detected language rides on the speech request, and an
uncertain reply may ask the decision endpoint. Choosing a browser or Kokoro
voice switches to that voice; in the app a manual pick also locks routing, and
the card keeps its starting voice. A speech outage stays silent; an explicit
browser voice still speaks. Language detection uses script/word hints, including Sprites' approximate
Spanish-to-Portuguese and Malay/Tagalog-to-Indonesian mappings.
Saved voice/mute/automatic-language choices are restored. Ambient mode starts off; automatic chat
titles and Kokoro background preload are disabled. Voice can be muted with
the card button or changed in settings.

Cards use `waifu_x_` browser storage and `waifuImagesEmbed` IndexedDB, separate
from the full app's conversations, provider keys, pictures and preferences.
When the host blocks storage, chats and pictures remain usable in memory for
that frame, but cannot survive a reload.

The interface is localized by `i18n/` at the repository root (see
`i18n/README.md`): 29 dictionaries selected from a saved choice, then the
browser's own language order, then English, with Arabic and Persian set to
`dir="rtl"` before the first paint. The Interface language picker offers native
names and is independent of the English-valued response-language dropdown, so
switching the interface never changes the reply-language setting. Built-in chat
instructions use an explicit reply locale, or the interface locale when replies
follow the user automatically; saved custom prompt and memory text stay intact.

Unit checks run from the repository root with `node --test "app/tests/*.cjs"`;
`test_i18n.cjs` pins dictionary parity, placeholder and brand-name rules,
locale detection and the `data-i18n*` markup contract. The browser tests need
`playwright` and its Chromium browser (`python -m playwright install chromium`);
run them with `python app/tests/test_player_card.py` from the repository root.
They use real PIXI/Cubism libraries and the default Hiyori model from the
configured CDNs, and all inference and analytics are intercepted. They cover
Send, Enter, IME input, blocked forms/storage, narrow layouts, resizing,
settings, voice toggling, browser-driven interface language, saved-language
persistence and reload, right-to-left mirroring, and full-app storage isolation.

`test_chat_prompts.cjs` checks prompt/placeholder parity for all 29 interface
locales, reply/interface independence, automatic language following,
custom prompt preservation, context localization and English fallback.
`python app/tests/test_chat_prompts_browser.py` checks actual Send requests in
the mobile-width full app and embedded app with inference mocked, including a
failed prompt-bundle download. These checks establish request construction,
not output-language accuracy or translation quality with real conversations.

`python app/tests/test_locale_expansion_browser.py` checks all fifteen new
locales plus Italian through the real interface picker in narrow full-app and
embedded layouts, persistence across reload, first-visit detection and the
device-language path after a saved choice. `test_locale_loading.cjs` covers
unloaded and failed device-language downloads.

Lifecycle regressions run with `python -m unittest discover -s app/tests -p
'test_*.py' -v` (including the Player Card checks above). `test_turn_ownership.cjs`
and `test_lifecycle_browser.py` cover delayed replies and side effects, Stop,
partial preservation, safe Retry, duplicate sends, paused queues, saved-operation
recovery, and explicit image generation/display recovery. Browser checks exercise
desktop, narrow mobile and embedded layouts, keyboard controls and localized
8/20-second wait statuses. Inference, speech and analytics are mocked; the
renderer/model CDN assets are real. These checks do not prove live delivery.

Local iframe checks do not confirm X will accept or display an interactive
card. After a future deployment, verify an actual post on desktop and mobile.
Microphone/audio/popups depend on the host permissions; the Full app link is
available when needed. No deployment is part of these local changes.
