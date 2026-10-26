/**
 * WaifuAI Cloud Proxy Wrapper
 *
 * Routes guest chat completions to the WaifuAI Cloud edge gateway.
 * Request/response handling lives in llm_provider_base.js.
 */

// Interface string lookup with an English fallback, so the Node suites can load
// this file standalone without the i18n runtime. A function declaration, because
// every app script is a classic script sharing one global scope, where duplicate
// lexical declarations throw.
function tr(key, fallback, params) {
  const api = typeof window !== 'undefined' && window.WaifuI18n;
  try { if (api && api.has(key)) return api.t(key, params); } catch (e) { /* fall back below */ }
  if (!params) return fallback;
  return String(fallback).replace(/%\{(\w+)\}/g, (all, name) => (params[name] == null ? all : String(params[name])));
}

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
      ...(typeof window.WaifuI18n?.snapshot === 'function' ? window.WaifuI18n.snapshot() : {}),
      model: window.currentModelName || '',
      voice_primary: Boolean(window.enablePrimaryVoice),
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
  TTS_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/tts',
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
    const body = { model, messages, max_tokens: 2500, stream: Boolean(stream), context_budget_version: 1 };

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

    const budget = window.ConversationBudget;
    if (purpose === 'chat' || purpose === 'ambient') {
      body.messages = budget.pack(body.messages, m => ({ ...body, messages: m }), window.maxMemorySize || 30).messages;
    }
    budget.checkBody(body);
    return {
      url: this.API_URL,
      headers,
      body,
      stream,
      signal: options.signal,
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
  // Each generation makes one request; failures are returned to the caller.
  async generateImage(prompt, aspect = '1:1', seed = null, purpose = null, options = {}) {
    const check = () => { if (options.signal?.aborted || (options.valid && !options.valid())) { const e = new Error('Turn interrupted'); e.name = 'AbortError'; throw e; } };
    check();
    const params = new URLSearchParams({ text: prompt, aspect });
    if (seed !== null && seed !== undefined && !isNaN(Number(seed))) {
      params.set('seed', String(parseInt(seed, 10)));
    }
    const headers = getRequestIdentityHeaders();
    if (purpose) headers['X-Waifu-Purpose'] = purpose;
    const res = await fetch(this.IMAGE_URL + '?' + params.toString(), { headers, signal: options.signal });
    check();
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (e) { }
      const err = new Error((body && body.error) || 'Image generation failed.');
      err.blocked = Boolean(body && body.blocked);
      err.status = res.status;
      err.retryable = !err.blocked && (res.status >= 500 || res.status === 408);
      // The proxy answers 504 when the image provider took too long.
      err.timedOut = res.status === 504;
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
      const blob = await res.blob(); check();
      if (!blob.size) throw new Error('Empty image bytes');
      return { url: await window.ImageStore.put(imageId, blob, options) };
    }
    // Last resort: res.url is the /image request itself. Rendering or saving
    // it regenerates the image on every load.
    try { if (res.body) res.body.cancel().catch(() => { }); } catch (e) { }
    throw new Error('Image response has no saved URL or image bytes');
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
  async decide(tasks, state, options = {}) {
    try {
      const res = await fetch(this.DECISIONS_URL, {
        method: 'POST',
        headers: { ...getRequestIdentityHeaders(), 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          request_id: (crypto.randomUUID && crypto.randomUUID()) || null,
          tasks,
          state: window.ConversationBudget.decisionState(state)
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

    const controller = new AbortController();
    // Include the response body in the wait so a stalled upload/response can
    // always release the microphone UI. A retry is a new user action.
    const timer = setTimeout(() => controller.abort(), 75000);
    const cancel = () => controller.abort();
    opts.signal?.addEventListener('abort', cancel, { once: true });
    if (opts.signal?.aborted) cancel();
    try {
      const res = await fetch(this.TRANSCRIBE_URL, {
        method: 'POST', headers: getRequestIdentityHeaders(), body: form, signal: controller.signal
      });
      let body = null;
      try { body = await res.json(); } catch (e) { if (controller.signal.aborted) throw e; }
      if (!res.ok) {
        const err = new Error((body && body.error) || tr('error.transcribeHttp', 'Transcription failed (HTTP %{status}).', { status: res.status }));
        err.status = res.status;
        throw err;
      }
      return body;
    } catch (error) {
      if (opts.signal?.aborted) { const e = new Error('Transcription canceled'); e.name = 'AbortError'; throw e; }
      if (controller.signal.aborted) throw new Error(tr('error.transcribeSlow', 'Transcription took too long. Please try again.'));
      throw error;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', cancel);
    }
  }
};

window.WaifuProxyAPI = WaifuProxyAPI;
