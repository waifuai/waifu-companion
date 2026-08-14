/**
 * OpenAI-Compatible API Wrapper
 *
 * Provides a compatible interface for any OpenAI-compatible API endpoint
 * with a user-configurable base URL. Request/response handling lives in
 * llm_provider_base.js — this file only resolves config and builds the body.
 */

const OpenAICompatibleAPI = {
  DEFAULT_MODEL: 'gpt-3.5-turbo',

  getBaseUrl() {
    return window.openaiCompatibleBaseUrl || localStorage.getItem('openaiCompatibleBaseUrl') || '';
  },

  getApiKey() {
    return window.openaiCompatibleApiKey || localStorage.getItem('openaiCompatibleApiKey') || '';
  },

  getModel() {
    return window.openaiCompatibleModel || localStorage.getItem('openaiCompatibleModel') || this.DEFAULT_MODEL;
  },

  getCorsProxy() {
    return window.openaiCompatibleCorsProxy || localStorage.getItem('openaiCompatibleCorsProxy') || '';
  },

  getApiUrl() {
    const base = this.getBaseUrl().replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const proxy = this.getCorsProxy();
    if (proxy) {
      return `${proxy}${url}`;
    }
    return url;
  },

  isConfigured() {
    return !!this.getBaseUrl() && !!this.getApiKey();
  },

  buildRequest(options, stream) {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    requireConfigured(!!baseUrl, 'OpenAI Compatible', 'OpenAI Compatible API base URL not configured. Please set it in settings.');
    requireConfigured(!!apiKey, 'OpenAI Compatible', 'OpenAI Compatible API key not configured. Please set it in settings.');

    const model = this.getModel();
    const { messages, json } = options;
    const body = { model, messages };
    if (stream) body.stream = true;
    if (json) body.response_format = { type: 'json_object' };

    return {
      url: this.getApiUrl(),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body,
      stream,
      providerLabel: 'OpenAI Compatible',
      providerSlug: 'openai_compatible'
    };
  },

  async createCompletion(options) {
    return performLLMRequest(this.buildRequest(options, false));
  },

  async createCompletionStream(options) {
    return performLLMRequest(this.buildRequest(options, true));
  }
};

window.OpenAICompatibleAPI = OpenAICompatibleAPI;
