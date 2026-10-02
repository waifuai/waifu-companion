/**
 * WaifuAI Cloud Proxy Wrapper
 *
 * Routes guest chat completions to the WaifuAI Cloud edge gateway.
 * Request/response handling lives in llm_provider_base.js.
 */

function getSessionId() {
  try {
    const KEY = 'waifuSessionId';
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID())
        || ('s-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    // Blocked storage must not break the chat.
    return null;
  }
}

function getVisitorId() {
  try {
    const KEY = 'waifuVisitorId';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID())
        || ('v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    // Blocked storage must not break the chat.
    return null;
  }
}

// Feature-usage. Sent as a body field rather than system-prompt lines so the
// model never sees it. Booleans and short ids only: no URLs, keys or free text.
function getClientSettings() {
  try {
    const S = AppStorage, K = AppStorage.KEYS;
    return {
      model: window.currentModelName || '',
      voice_tiktok: Boolean(window.enablePrimaryVoice),
      voice_kokoro: Boolean(window.enableKokoro),
      voice_browser: Boolean(window.enableFallbackVoice),
      stt_engine: window.sttEngine || '',
      background_set: Boolean(S.getString(K.CURRENT_BACKGROUND_URL, '')),
      bg_auto_mode: S.getString(K.BG_AUTO_MODE, 'scene'),
      bg_library_size: S.getJSON(K.BG_LIBRARY, []).length,
      custom_models: S.getJSON(K.USER_MODELS, []).length,
      ambient_mode: S.getBoolean(K.IS_AMBIENT_QUEUE_ENABLED, false),
      message_queue: S.getBoolean(K.IS_USER_MESSAGE_QUEUE_ENABLED, true),
      multiple_models: Boolean(window.allowMultipleModels),
      translate_ui: Boolean(window.translateUI),
      allow_ai_settings: Boolean(window.allowAIModSettings),
      json_emotion: Boolean(window.useJsonForEmotion),
      radio_playing: typeof radioPlayer !== 'undefined' && Boolean(radioPlayer) && !radioPlayer.paused
    };
  } catch (e) {
    // A snapshot must never break the chat.
    return undefined;
  }
}

const WaifuProxyAPI = {
  API_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/chat/completions',
  IMAGE_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/image',
  TRANSCRIBE_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/transcribe',
  DEFAULT_MODEL: 'waifuai-v1',

  getModel() {
    return this.DEFAULT_MODEL;
  },

  isConfigured() {
    return true;
  },

  buildRequest(options, stream) {
    const model = this.getModel();
    const { messages } = options;
    const body = { model, messages, max_tokens: 2500, stream: Boolean(stream) };

    const purpose = typeof options.purpose === 'string' ? options.purpose : 'chat';

    const headers = { 'Content-Type': 'application/json' };
    if (purpose !== 'chat') {
      headers['X-Waifu-Purpose'] = purpose;
    } else {
      const sid = getSessionId();
      if (sid) headers['x-session-id'] = sid;
      const vid = getVisitorId();
      if (vid) headers['x-visitor-id'] = vid;
      // The proxy rebuilds the upstream request from known fields, so this
      // never reaches the model provider.
      const clientSettings = getClientSettings();
      if (clientSettings) body.client_settings = clientSettings;
    }

    return {
      url: this.API_URL,
      headers,
      body,
      stream,
      providerLabel: 'WaifuAI Cloud',
      providerSlug: 'waifu_proxy'
    };
  },

  async createCompletion(options) {
    return performLLMRequest(this.buildRequest(options, false));
  },

  // Free image generation. Resolves with { url } on success; throws an
  // Error with .blocked = true when the request was not allowed. purpose
  // 'background' makes the proxy log it as kind 'background'.
  async generateImage(prompt, aspect = '1:1', seed = null, purpose = null) {
    const params = new URLSearchParams({ text: prompt, aspect });
    if (seed !== null && seed !== undefined && !isNaN(Number(seed))) {
      params.set('seed', String(parseInt(seed, 10)));
    }
    const headers = {};
    const sid = getSessionId();
    if (sid) headers['x-session-id'] = sid;
    const vid = getVisitorId();
    if (vid) headers['x-visitor-id'] = vid;
    if (purpose) headers['X-Waifu-Purpose'] = purpose;
    const res = await fetch(this.IMAGE_URL + '?' + params.toString(), { headers });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (e) { }
      const err = new Error((body && body.error) || 'Image generation failed.');
      err.blocked = Boolean(body && body.blocked);
      // The proxy answers 504 when the image provider took too long.
      err.timedOut = res.status === 504;
      throw err;
    }
    // The proxy reports the final storage URL in X-Image-Url. res.url is the
    // proxy's own /image URL: rendering or saving that would regenerate the
    // image on every load, so it is only a fallback for older proxies.
    const finalUrl = res.headers.get('X-Image-Url') || res.url;
    // Only the URL is needed; skip downloading the bytes.
    try { if (res.body) res.body.cancel().catch(() => { }); } catch (e) { }
    return { url: finalUrl };
  },

  async createCompletionStream(options) {
    return performLLMRequest(this.buildRequest(options, true));
  },

  // Voice input (speech-to-text) through WaifuAI Cloud. Sends a recorded audio
  // Blob to WaifuAI Cloud's /transcribe endpoint.
  // No API key is needed client-side. Resolves with
  // the JSON response ({ text, ... }); throws Error with .status set.
  async transcribeAudio(audioBlob, opts = {}) {
    const form = new FormData();
    form.append('file', audioBlob, opts.filename || 'audio.webm');
    if (opts.language) form.append('language', opts.language);
    if (opts.prompt) form.append('prompt', opts.prompt);

    const res = await fetch(this.TRANSCRIBE_URL, { method: 'POST', body: form });
    let body = null;
    try { body = await res.json(); } catch (e) { }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Transcription failed (HTTP ${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return body;
  }
};

window.WaifuProxyAPI = WaifuProxyAPI;
