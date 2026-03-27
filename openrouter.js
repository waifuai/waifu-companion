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
      const err = new Error('OpenRouter API key not configured. Please set it in settings.');
      debugError('[OpenRouter] createCompletion failed - no API key', err);
      throw err;
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

    const requestStart = Date.now();
    debugNet('OpenRouter request', {
      provider: 'openrouter',
      method: 'POST',
      model: model,
      messageCount: messages.length,
      jsonMode: !!json
    });

    let response;
    try {
      response = await fetch(this.API_URL, {
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
    } catch (fetchErr) {
      const duration = Date.now() - requestStart;
      debugError('[OpenRouter] fetch() failed', fetchErr, {
        model: model,
        duration_ms: duration,
        messageCount: messages.length,
        url: this.API_URL
      });
      throw fetchErr;
    }

    const duration = Date.now() - requestStart;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const err = new Error(errorData.error?.message || `API request failed with status ${response.status}`);
      debugNet('OpenRouter response error', {
        provider: 'openrouter',
        status: response.status,
        statusText: response.statusText,
        duration: duration,
        model: model,
        errorType: 'HTTPError',
        errorMsg: err.message
      });
      throw err;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    debugNet('OpenRouter response ok', {
      provider: 'openrouter',
      status: response.status,
      duration: duration,
      model: model,
      responseSize: content.length,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens
    });

    return {
      content: content
    };
  },

  async createCompletionStream(options) {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      const err = new Error('OpenRouter API key not configured. Please set it in settings.');
      debugError('[OpenRouter] createCompletionStream failed - no API key', err);
      throw err;
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

    const requestStart = Date.now();
    debugNet('OpenRouter stream request', {
      provider: 'openrouter',
      method: 'POST',
      model: model,
      messageCount: messages.length,
      jsonMode: !!json,
      stream: true
    });

    let response;
    try {
      response = await fetch(this.API_URL, {
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
    } catch (fetchErr) {
      const duration = Date.now() - requestStart;
      debugError('[OpenRouter] stream fetch() failed', fetchErr, {
        model: model,
        duration_ms: duration,
        messageCount: messages.length,
        url: this.API_URL
      });
      throw fetchErr;
    }

    const duration = Date.now() - requestStart;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const err = new Error(errorData.error?.message || `API request failed with status ${response.status}`);
      debugNet('OpenRouter stream response error', {
        provider: 'openrouter',
        status: response.status,
        statusText: response.statusText,
        duration: duration,
        model: model,
        errorType: 'HTTPError',
        errorMsg: err.message
      });
      throw err;
    }

    debugNet('OpenRouter stream connected', {
      provider: 'openrouter',
      status: response.status,
      duration: duration,
      model: model
    });

    return {
      stream: response.body,
      response: response
    };
  }
};

window.OpenRouterAPI = OpenRouterAPI;
