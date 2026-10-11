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
    let id = AppStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID())
        || ('v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      AppStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    // Blocked storage must not break the chat.
    return null;
  }
}

function getRequestIdentityHeaders() {
  const headers = {};
  const sid = getSessionId();
  if (sid) headers['x-session-id'] = sid;
  const vid = getVisitorId();
  if (vid) headers['x-visitor-id'] = vid;
  return headers;
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
  DECISIONS_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/decisions',
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

    const headers = { ...getRequestIdentityHeaders(), 'Content-Type': 'application/json' };
    if (purpose !== 'chat') {
      headers['X-Waifu-Purpose'] = purpose;
    } else {
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
  // Transient server failures (5xx without a content block, network
  // errors) are re-requested once; blocks and 429 overload are final.
  async generateImage(prompt, aspect = '1:1', seed = null, purpose = null) {
    const params = new URLSearchParams({ text: prompt, aspect });
    if (seed !== null && seed !== undefined && !isNaN(Number(seed))) {
      params.set('seed', String(parseInt(seed, 10)));
    }
    const headers = getRequestIdentityHeaders();
    if (purpose) headers['X-Waifu-Purpose'] = purpose;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(this.IMAGE_URL + '?' + params.toString(), { headers });
      } catch (e) {
        if (attempt === 0) continue; // network error: one more try
        throw e;
      }
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch (e) { }
        const err = new Error((body && body.error) || 'Image generation failed.');
        err.blocked = Boolean(body && body.blocked);
        // The proxy answers 504 when the image provider took too long.
        err.timedOut = res.status === 504;
        if (res.status >= 500 && !err.blocked && attempt === 0) continue;
        throw err;
      }
      // The image URL comes in X-Image-Url. Only the URL is needed; skip
      // downloading the bytes.
      const finalUrl = res.headers.get('X-Image-Url');
      if (finalUrl) {
        try { if (res.body) res.body.cancel().catch(() => { }); } catch (e) { }
        return { url: finalUrl };
      }
      // No URL: the image came as bytes only, under X-Image-Id. Keep it on
      // this device.
      const imageId = res.headers.get('X-Image-Id');
      if (imageId && window.ImageStore) {
        return { url: await window.ImageStore.put(imageId, await res.blob()) };
      }
      // Last resort: res.url is the /image request itself. Rendering or saving
      // it regenerates the image on every load.
      try { if (res.body) res.body.cancel().catch(() => { }); } catch (e) { }
      return { url: res.url };
    }
  },

  async createCompletionStream(options) {
    return performLLMRequest(this.buildRequest(options, true));
  },

  // Asks WaifuAI Cloud to make one or more small fixed choices for this turn
  // (picture, background scene, expression). The set of tasks is the server's;
  // this client only names task ids and supplies the conversation state each
  // task documents. Resolves { <task>: { choice_id, confidence } } on an ok
  // answer, or null when the endpoint is unavailable, the request was
  // rejected or the answer was not ok — callers keep their local behavior on
  // null. Never throws.
  async decide(tasks, state) {
    try {
      const res = await fetch(this.DECISIONS_URL, {
        method: 'POST',
        headers: { ...getRequestIdentityHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: (crypto.randomUUID && crypto.randomUUID()) || null,
          tasks,
          state
        })
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || body.status !== 'ok' || !body.answers) return null;
      return body.answers;
    } catch (e) {
      return null;
    }
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

    const res = await fetch(this.TRANSCRIBE_URL, {
      method: 'POST', headers: getRequestIdentityHeaders(), body: form
    });
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
