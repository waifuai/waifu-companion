/**
 * WaifuAI Cloud Proxy Wrapper
 *
 * Routes guest chat completions to the WaifuAI Cloud edge gateway.
 * Request/response handling lives in llm_provider_base.js.
 */

const WaifuProxyAPI = {
  API_URL: 'https://waifu-companion-proxy.thewaifuai.workers.dev/chat/completions',
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
    const body = { model, messages, max_tokens: 1500 };
    if (stream) body.stream = true;

    return {
      url: this.API_URL,
      headers: {
        'Content-Type': 'application/json'
      },
      body,
      stream,
      providerLabel: 'WaifuAI Cloud',
      providerSlug: 'waifu_proxy'
    };
  },

  async createCompletion(options) {
    return performLLMRequest(this.buildRequest(options, false));
  },

  async createCompletionStream(options) {
    return performLLMRequest(this.buildRequest(options, true));
  }
};

window.WaifuProxyAPI = WaifuProxyAPI;
