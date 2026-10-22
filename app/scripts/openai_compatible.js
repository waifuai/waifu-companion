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
    return window.openaiCompatibleBaseUrl || AppStorage.getItem('openaiCompatibleBaseUrl') || '';
  },

  getApiKey() {
    return window.openaiCompatibleApiKey || AppStorage.getItem('openaiCompatibleApiKey') || '';
  },

  getModel() {
    return window.openaiCompatibleModel || AppStorage.getItem('openaiCompatibleModel') || this.DEFAULT_MODEL;
  },

  getCorsProxy() {
    return window.openaiCompatibleCorsProxy || AppStorage.getItem('openaiCompatibleCorsProxy') || '';
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
    return Boolean(window.useOpenAICompatible && this.getBaseUrl() && this.getApiKey());
  },

  buildRequest(options, stream) {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    requireConfigured(!!baseUrl, 'OpenAI Compatible', tr('error.notConfiguredUrl', '%{provider} API base URL not configured. Please set it in settings.', { provider: 'OpenAI Compatible' }));
    requireConfigured(!!apiKey, 'OpenAI Compatible', tr('error.notConfiguredKey', '%{provider} API key not configured. Please set it in settings.', { provider: 'OpenAI Compatible' }));

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
      signal: options.signal,
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
