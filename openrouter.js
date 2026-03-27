/**
 * OpenRouter API Wrapper
 * 
 * Provides a compatible interface to OpenRouter's API for chat completions.
 * Supports configuration of API key and model through localStorage.
 */

const OpenRouterAPI = {
  API_URL: 'https://openrouter.ai/api/v1/chat/completions',

  DEFAULT_MODEL: 'arcee-ai/trinity-large-preview:free',

  SITE_NAME: 'Waifu AI',
  SITE_URL: 'https://waifuai.com',

  getApiKey() {
    return localStorage.getItem('openRouterApiKey') || '';
  },

  setApiKey(apiKey) {
    localStorage.setItem('openRouterApiKey', apiKey);
  },

  getModel() {
    return localStorage.getItem('openRouterModel') || this.DEFAULT_MODEL;
  },

  setModel(model) {
    localStorage.setItem('openRouterModel', model);
  },

  isConfigured() {
    return !!this.getApiKey();
  },

  async createCompletion(options) {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Please set it in settings.');
    }

    const model = this.getModel();
    const { messages, json } = options;

    const body = {
      model: model,
      messages: messages,
    };

    if (json) {
      const unsupportedModels = ['stepfun/step-3.5-flash:free', 'stepfun/step-1-flash'];
      if (!unsupportedModels.includes(model)) {
        body.response_format = { type: 'json_object' };
      }
    }

    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': this.SITE_URL,
        'X-OpenRouter-Title': this.SITE_NAME,
        'X-Title': this.SITE_NAME,
        'X-OpenRouter-Categories': 'character-chat',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      content: content
    };
  },

  async createCompletionStream(options) {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Please set it in settings.');
    }

    const model = this.getModel();
    const { messages, json } = options;

    const body = {
      model: model,
      messages: messages,
      stream: true
    };

    if (json) {
      const unsupportedModels = ['stepfun/step-3.5-flash:free', 'stepfun/step-1-flash'];
      if (!unsupportedModels.includes(model)) {
        body.response_format = { type: 'json_object' };
      }
    }

    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': this.SITE_URL,
        'X-OpenRouter-Title': this.SITE_NAME,
        'X-Title': this.SITE_NAME,
        'X-OpenRouter-Categories': 'character-chat',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    return {
      stream: response.body,
      response: response
    };
  }
};

window.OpenRouterAPI = OpenRouterAPI;