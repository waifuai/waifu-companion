/**
 * pictures.js: pictures in chat, drawn through WaifuAI Cloud.
 *
 * Each turn whose message looks like a picture request gets its own small
 * decision call next to the reply, which answers NONE or "DRAW: <English
 * description>". A DRAW goes to the image endpoint. Pictures always go
 * through WaifuAI Cloud, whichever provider the chat itself uses.
 *
 * The image endpoint answers with the picture's address in X-Image-Url. When
 * it only sends the bytes (X-Image-Id), they are kept in IndexedDB so the
 * picture survives a reload without being drawn again.
 */
const Pictures = (() => {
  const BASE = 'https://waifu-companion-proxy.thewaifuai.workers.dev';
  const DECISION_MODEL = 'waifuai-v1';

  const APPEARANCE = 'an anime girl with long lavender hair in twin tails, violet eyes, a white beret with a ribbon and moon-shaped hair clips, and a white frilly dress';

  const ASPECTS = { portrait: '2:3', square: '1:1', landscape: '3:2' };

  // Cheap gate in front of the decision call, so most turns cost one call, not two.
  const REQUEST_WORDS = new RegExp([
    String.raw`\b(pics?|pictures?|photos?|selfies?|images?|imgs?|draw\w*|paint\w*|sketch\w*|portraits?|wallpapers?|look like|show (me )?(you|yourself|what))\b`,
    'фот|картин|рису|покажи|селфи|foto|selfi(?!sh)|imagen|imagem|dibuj|desenh|immagin|disegn|bild|zeichn|dessin|montre|zdję|rysu|resim|gambar',
    '写真|画像|絵|描|見せ|照片|图片|圖片|画|畫|自拍|사진|그림|셀카',
  ].join('|'), 'iu');
  const OFFER_WORDS = /\b(pictures?|photos?|selfies?|images?|draw\w*|snap\w*)\b|写真|絵|照片|图片|사진|그림/iu;

  const DECISION_PROMPT = `You are the picture step of a chat app. You get the companion's previous message and the user's NEW message. Decide whether the NEW message asks the companion to draw, send or show a picture, photo, selfie or drawing. The chat can be in any language. Earlier picture requests are already done: only the NEW message counts.

Answer with exactly one line and nothing else, either:
NONE
or:
DRAW: <English description>

Answer DRAW only when the NEW message clearly asks for a picture, or says yes to a picture the companion's previous message offered. Chatting, compliments, reactions to a picture, questions about pictures and roleplay actions are NONE.

Examples:
"send me a selfie" -> DRAW
"draw yourself at the beach" -> DRAW
"yes please" after the companion offered a picture -> DRAW
"cute" -> NONE
"ok" -> NONE
"thanks, you look great" -> NONE
"hi" -> NONE

Don't judge whether the picture is too revealing: the image service has its own content filter and decides that. Describe what was asked.

The description is one line of English (translate if the chat isn't English), 10 to 40 words, describing a concrete scene: who is in it, outfit, pose, setting and mood.
When the companion is in the picture, describe her as ${APPEARANCE}, plus the outfit or pose asked for.`;

  const WRITER_PROMPT = `Write the image description for an approved picture request. Use the user's NEW message and the companion's previous message to resolve the requested scene or accepted offer. The chat can be in any language.

Answer with exactly one line: DRAW: <English description>

The description is 10 to 40 words describing who is in it, outfit, pose, setting and mood. When the companion is in the picture, describe her as ${APPEARANCE}, plus the requested outfit or pose. The image service applies its own content filter. Describe the requested picture.`;

  // Added to the chat system prompt so the reply reacts instead of refusing.
  const CHAT_RULE = `You can draw pictures, including pictures of yourself (you look like ${APPEARANCE}). When the user asks for a picture, photo, selfie or drawing, a separate app operation attempts generation: react in character and offer to make it. An offer, request or returned URL does not confirm delivery. Only application-authored image outcome notes establish generation or browser loading; browser loading is not proof the user saw the picture. A blocked, failed, stopped, interrupted or unconfirmed operation must never be described as sent or delivered. You cannot inspect image contents. Never write out the picture's description yourself, and never refuse by saying you are an AI or can't make images. Nude or sexual pictures are never drawn: playfully suggest a cute alternative instead.`;

  function check(options) {
    if (options.signal?.aborted || (options.valid && !options.valid())) {
      const error = new Error('Canceled'); error.name = 'AbortError'; throw error;
    }
  }
  async function owned(work, options) {
    const result = await (typeof Chat !== 'undefined' && Chat.abortable ? Chat.abortable(work, options.signal) : work);
    check(options);
    return result;
  }

  // ── Decision ──
  function clipPictureContext(text) {
    const clean = String(text || '').trim();
    // Keep the closing offer or scene choices as well as the opening, within
    // the endpoint's 300-character context limit.
    return clean.length <= 300 ? clean : clean.slice(0, 100) + '\n...\n' + clean.slice(-195);
  }

  async function decide(userText, prevReply, ids, options = {}) {
    check(options);
    if (!REQUEST_WORDS.test(userText || '') && !(prevReply && OFFER_WORDS.test(prevReply))) return null;
    const clip = s => String(s || '').slice(0, 300);
    const previous = prevReply ? clipPictureContext(prevReply) : undefined;
    try {
      // Honor the cloud's selected action; uncertain or unavailable answers
      // leave the existing judgment to the writing call.
      let writePicture = false;
      if (typeof Chat !== 'undefined' && typeof Chat.askDecisions === 'function') {
        try {
          const answers = await owned(Chat.askDecisions(['picture_action_v1'], {
            user_message: clip(userText),
            previous_reply: previous,
            picture_offered: Boolean(prevReply && OFFER_WORDS.test(prevReply)),
          }, options.owner), options);
          const picture = answers && answers.picture_action_v1;
          if (picture && picture.choice_id === 'none') return null;
          writePicture = picture?.choice_id === 'draw';
        } catch (e) {
          check(options);
          // Continue with the existing picture judgment if the action failed.
        }
      }
      const headers = { 'Content-Type': 'application/json', 'X-Waifu-Purpose': 'image_prompt' };
      if (ids && ids.session) headers['x-session-id'] = ids.session;
      if (ids && ids.visitor) headers['x-visitor-id'] = ids.visitor;
      check(options);
      const resp = await owned(fetch(BASE + '/chat/completions', {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
          model: DECISION_MODEL,
          max_tokens: 120,
          stream: false,
          messages: [
            { role: 'system', content: writePicture ? WRITER_PROMPT : DECISION_PROMPT },
            { role: 'user', content: "Companion's previous message: " + (previous || '(none)') + "\n\nUser's NEW message: " + clip(userText) },
          ],
          client_settings: { app: window.WaifuSpritesSource || 'homepage-sprites' },
        }),
      }), options);
      if (!resp.ok) return null;
      const data = await owned(resp.json(), options);
      const m = String(data.choices?.[0]?.message?.content || '').match(/DRAW:\s*([^\n|]+)/i);
      if (!m) return null;
      const prompt = m[1].replace(/^[\s"'[<]+|[\s"'\]>]+$/g, '').trim();
      return prompt.length >= 8 ? prompt : null;
    } catch (e) {
      return null; // A failed decision just means no picture this turn.
    }
  }

  // ── Drawing ──
  // Resolves with a stored reference ("https://..." or "idb:<id>"). Throws with
  // .blocked when the content filter refused, .timedOut when it took too long.
  // Each generation makes one request; failures are returned to the caller.
  async function draw(prompt, aspect, ids, options = {}) {
    check(options);
    const params = new URLSearchParams({ text: prompt, aspect: aspect || '2:3' });
    const headers = {};
    if (ids && ids.session) headers['x-session-id'] = ids.session;
    if (ids && ids.visitor) headers['x-visitor-id'] = ids.visitor;
    const res = await owned(fetch(BASE + '/image?' + params.toString(), { headers, signal: options.signal }), options);
    if (!res.ok) {
      let body = null;
      try { body = await owned(res.json(), options); } catch (e) { check(options); }
      const err = new Error((body && body.error) || 'Image generation failed.');
      err.blocked = Boolean(body && body.blocked);
      err.timedOut = res.status === 504;
      err.retryable = !err.blocked && (res.status >= 500 || res.status === 408);
      throw err;
    }
    const url = res.headers.get('X-Image-Url');
    if (url) {
      try { res.body && res.body.cancel(); } catch (e) {}
      return url;
    }
    const id = res.headers.get('X-Image-Id') || ('img' + Date.now().toString(36));
    const blob = await owned(res.blob(), options);
    if (!blob?.size) { const error = new Error('Empty image'); error.retryable = true; throw error; }
    check(options);
    await Store.put(id, blob);
    try { check(options); } catch (error) { forget('idb:' + id); throw error; }
    return 'idb:' + id;
  }

  // Turns a stored reference into something an <img> can show.
  async function resolve(ref) {
    if (!ref || !ref.startsWith('idb:')) return ref;
    const blob = await Store.get(ref.slice(4));
    return blob ? URL.createObjectURL(blob) : null;
  }

  // ── IndexedDB for pictures that came back as bytes only ──
  const Store = (() => {
    let dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise((ok, fail) => {
          const req = indexedDB.open('waifu-sprites', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('images');
          req.onsuccess = () => ok(req.result);
          req.onerror = () => fail(req.error);
        });
      }
      return dbp;
    }
    function run(mode, fn) {
      return db().then(d => new Promise((ok, fail) => {
        const tx = d.transaction('images', mode);
        const req = fn(tx.objectStore('images'));
        tx.oncomplete = () => ok(req && req.result);
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error || new Error('Image storage interrupted'));
      }));
    }
    return {
      put: (id, blob) => run('readwrite', s => s.put(blob, id)),
      get: id => run('readonly', s => s.get(id)).catch(() => null),
      del: id => run('readwrite', s => s.delete(id)).catch(() => {}),
    };
  })();

  function forget(ref) {
    if (ref && ref.startsWith('idb:')) Store.del(ref.slice(4));
  }

  return { decide, draw, resolve, forget, ASPECTS, CHAT_RULE, APPEARANCE };
})();
