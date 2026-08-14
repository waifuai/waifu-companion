/**
 * Groq API Wrapper
 *
 * Provides a compatible interface to Groq's API for chat completions.
 * Request/response handling lives in llm_provider_base.js — this file only
 * resolves Groq-specific config (key, model, endpoint) and builds the body.
 */

const GroqAPI = {
  API_URL: 'https://api.groq.com/openai/v1/chat/completions',

  DEFAULT_MODEL: 'llama-3.3-70b-versatile',

  getApiKey() {
    return window.groqApiKey || localStorage.getItem('groqApiKey') || '';
  },

  getModel() {
    return window.groqModel || localStorage.getItem('groqModel') || this.DEFAULT_MODEL;
  },

  isConfigured() {
    return !!this.getApiKey();
  },

  buildRequest(options, stream) {
    const apiKey = this.getApiKey();
    requireConfigured(!!apiKey, 'Groq', 'Groq API key not configured. Please set it in settings.');

    const model = this.getModel();
    const { messages, json } = options;
    const body = { model, messages };
    if (stream) body.stream = true;
    if (json) body.response_format = { type: 'json_object' };

    return {
      url: this.API_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body,
      stream,
      providerLabel: 'Groq',
      providerSlug: 'groq'
    };
  },

  async createCompletion(options) {
    return performLLMRequest(this.buildRequest(options, false));
  },

  async createCompletionStream(options) {
    return performLLMRequest(this.buildRequest(options, true));
  }
};

window.GroqAPI = GroqAPI;
