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

const WaifuProxyAPI = {
  API_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/chat/completions',
  IMAGE_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/image',
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
  // Error with .blocked = true when the request was not allowed.
  async generateImage(prompt, aspect = '1:1', seed = null) {
    const params = new URLSearchParams({ text: prompt, aspect });
    if (seed !== null && seed !== undefined && !isNaN(Number(seed))) {
      params.set('seed', String(parseInt(seed, 10)));
    }
    const res = await fetch(this.IMAGE_URL + '?' + params.toString());
    let body = null;
    try { body = await res.json(); } catch (e) { }
    if (!res.ok) {
      const err = new Error((body && body.error) || 'Image generation failed.');
      err.blocked = Boolean(body && body.blocked);
      throw err;
    }
    return { url: res.url };
  },

  async createCompletionStream(options) {
    return performLLMRequest(this.buildRequest(options, true));
  }
};

window.WaifuProxyAPI = WaifuProxyAPI;
