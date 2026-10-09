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
does not make an inference or speech request. New visitors have a female TikTok
voice matching their browser language, or US English (`en_us_001`) if no female
voice matches. Replies are spoken after chatting. Automatic language routing
starts on: reply text chooses a matching female TikTok voice (Japanese uses
`jp_003`); English or uncertain text keeps the selected voice. Choosing a voice
does not disable routing in the card; turn off Auto TTS Language to lock it.
Browser fallback starts on if TikTok fails, unless a saved preference disables
it. Language detection uses script/word hints, including Sprites' approximate
Spanish-to-Portuguese and Malay/Tagalog-to-Indonesian mappings.
Saved voice/mute/automatic-language choices are restored. Ambient mode starts off; automatic chat
titles and Kokoro background preload are disabled. Voice can be muted with
the card button or changed in settings.

Cards use `waifu_x_` browser storage and `waifuImagesEmbed` IndexedDB, separate
from the full app's conversations, provider keys, pictures and preferences.
When the host blocks storage, chats and pictures remain usable in memory for
that frame, but cannot survive a reload.

Run `python app/tests/test_player_card.py` from the repository root after
installing `playwright` and its Chromium browser (`python -m playwright install
chromium`). Tests use real PIXI/Cubism libraries and the default Hiyori model
from the configured CDNs; all inference and analytics are intercepted. They
cover Send, Enter, IME input, blocked forms/storage, narrow layouts, resizing,
settings, voice toggling and full-app storage isolation.

Local iframe checks do not confirm X will accept or display an interactive
card. After a future deployment, verify an actual post on desktop and mobile.
Microphone/audio/popups depend on the host permissions; the Full app link is
available when needed. No deployment is part of these local changes.
