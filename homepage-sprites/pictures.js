/**
 * pictures.js: local-only picture state for Waifu Sprites.
 *
 * The WaifuAI Cloud image and image-decision endpoints were retired. This
 * module no longer makes network requests: no /image, no /chat/completions and
 * no /decisions. Picture generation is unavailable in this build; the exports
 * stay so saved conversations with older picture messages can still be read,
 * exported and removed without breaking the app.
 */
const Pictures = (() => {
  const APPEARANCE = 'an anime girl with long lavender hair in twin tails, violet eyes, a white beret with a ribbon and moon-shaped hair clips, and a white frilly dress';
  const ASPECTS = { portrait: '2:3', square: '1:1', landscape: '3:2' };
  // Kept for prompt compatibility with existing locale bundles; the app does
  // not advertise a picture capability any more.
  const CHAT_RULE = '';

  function check(options) {
    if (options && options.signal && options.signal.aborted) {
      const error = new Error('Canceled');
      error.name = 'AbortError';
      throw error;
    }
  }

  async function decide(userText, prevReply, ids, options = {}) {
    check(options);
    return null;
  }

  async function draw(prompt, aspect, ids, options = {}) {
    check(options);
    const error = new Error('Picture generation is unavailable.');
    error.unavailable = true;
    throw error;
  }

  async function resolve(ref) {
    return null;
  }

  function forget(ref) {}

  return { decide, draw, resolve, forget, ASPECTS, CHAT_RULE, APPEARANCE };
})();
