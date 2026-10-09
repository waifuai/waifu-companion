# Live2D Player Card checks

Share **https://waifuai.com/app/?card=player-v1** after deployment. This uses
the same fresh-query-link approach as the Sprites link
`https://waifuai.github.io/waifu-sprites/?card=player-v1`, avoiding reuse of
the exact `/app/` URL whose older image card may already be cached by X.

The `/app/` HTML provides static Player Card metadata regardless of `card`.
It advertises a 480 × 480 player at `https://waifuai.com/app/?embed=x`.
Only `embed=x` selects the compact layout; `card=player-v1` is the sharing
URL variant. The homepage keeps its normal image card. X acceptance and cache
behavior still need verification in an actual post.

Serve the repository root with `python -m http.server 8767 --bind 127.0.0.1`
and open `http://127.0.0.1:8767/app/embed-preview.html` to try the desktop and
narrow iframe layouts. Chatting there uses the normal proxy. Loading the card
does not make an inference request. Each card starts silent with ambient mode
off; automatic chat titles and Kokoro background preload are disabled. Voice
can be enabled with the card button or settings.

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
