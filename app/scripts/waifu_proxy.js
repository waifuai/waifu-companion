/**
 * Local compatibility shim for the retired public service.
 *
 * The public inference/voice/image endpoints were retired. This module is kept
 * because legacy callers still look it up on `window`, but none of its methods
 * can reach a network endpoint any more: every method is a local no-op. BYO
 * Groq / OpenRouter / OpenAI-compatible providers live in their own modules and
 * remain opt-in.
 */
(function () {
  // Kept as keys for legacy callers that read them. The values are intentionally
  // empty: there is no endpoint to talk to, and no request may be built from
  // them. (retired public service)
  const RETIRED = '';

  function tr(key, fallback) {
    return fallback;
  }

  function getSessionId() { return null; }
  function getVisitorId() { return null; }
  function getRequestIdentityHeaders() { return {}; }

  const WaifuProxyAPI = {
    API_URL: RETIRED,
    IMAGE_URL: RETIRED,
    TRANSCRIBE_URL: RETIRED,
    TTS_URL: RETIRED,
    DECISIONS_URL: RETIRED,
    DEFAULT_MODEL: 'local-fallback',

    getModel() { return this.DEFAULT_MODEL; },

    // Never selectable as a chat provider, and never reported as configured.
    isConfigured() { return false; },

    requestHeaders() { return {}; },

    buildRequest() {
      throw new Error('Retired public service: local-only mode has no proxy request.');
    },

    async createCompletion() {
      throw new Error('Retired public service: local-only mode has no proxy inference.');
    },

    async createCompletionStream() {
      throw new Error('Retired public service: local-only mode has no proxy streaming.');
    },

    // Local no-op: pictures are disabled. Callers surface a clear local outcome
    // instead of attempting an /image request.
    async generateImage() {
      return { unavailable: true, local: true };
    },

    // Local no-op: no /decisions request. null means "keep the local behavior".
    async decide() {
      return null;
    },

    // Local no-op: speech-to-text is browser Web Speech API only.
    async transcribeAudio() {
      throw new Error('Retired public service: voice input uses the browser Web Speech API.');
    }
  };

  window.WaifuProxyAPI = WaifuProxyAPI;
  window.waifuProxyRetired = true;
})();
