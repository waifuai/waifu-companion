/**
 * OpenAI-Compatible API Wrapper
 * 
 * Provides a compatible interface for any OpenAI-compatible API endpoint
 * with a user-configurable base URL.
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

  async createCompletion(options) {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();

    if (!baseUrl) {
      const err = new Error('OpenAI Compatible API base URL not configured. Please set it in settings.');
      debugError('[OpenAI Compatible] createCompletion failed - no base URL', err);
      throw err;
    }

    if (!apiKey) {
      const err = new Error('OpenAI Compatible API key not configured. Please set it in settings.');
      debugError('[OpenAI Compatible] createCompletion failed - no API key', err);
      throw err;
    }

    const model = this.getModel();
    const apiUrl = this.getApiUrl();
    const { messages, json } = options;

    const body = {
      model: model,
      messages: messages,
    };

    if (json) {
      body.response_format = { type: 'json_object' };
    }

    const requestStart = Date.now();
    debugNet('OpenAI Compatible request', {
      provider: 'openai_compatible',
      method: 'POST',
      model: model,
      messageCount: messages.length,
      jsonMode: !!json,
      url: apiUrl
    });

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const duration = Date.now() - requestStart;
      debugError('[OpenAI Compatible] fetch() failed', fetchErr, {
        model: model,
        duration_ms: duration,
        messageCount: messages.length,
        url: apiUrl
      });
      throw fetchErr;
    }

    const duration = Date.now() - requestStart;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const err = new Error(errorData.error?.message || `API request failed with status ${response.status}`);
      debugNet('OpenAI Compatible response error', {
        provider: 'openai_compatible',
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

    debugNet('OpenAI Compatible response ok', {
      provider: 'openai_compatible',
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
    const baseUrl = this.getBaseUrl();

    if (!baseUrl) {
      const err = new Error('OpenAI Compatible API base URL not configured. Please set it in settings.');
      debugError('[OpenAI Compatible] createCompletionStream failed - no base URL', err);
      throw err;
    }

    if (!apiKey) {
      const err = new Error('OpenAI Compatible API key not configured. Please set it in settings.');
      debugError('[OpenAI Compatible] createCompletionStream failed - no API key', err);
      throw err;
    }

    const model = this.getModel();
    const apiUrl = this.getApiUrl();
    const { messages, json } = options;

    const body = {
      model: model,
      messages: messages,
      stream: true
    };

    if (json) {
      body.response_format = { type: 'json_object' };
    }

    const requestStart = Date.now();
    debugNet('OpenAI Compatible stream request', {
      provider: 'openai_compatible',
      method: 'POST',
      model: model,
      messageCount: messages.length,
      jsonMode: !!json,
      stream: true,
      url: apiUrl
    });

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const duration = Date.now() - requestStart;
      debugError('[OpenAI Compatible] stream fetch() failed', fetchErr, {
        model: model,
        duration_ms: duration,
        messageCount: messages.length,
        url: apiUrl
      });
      throw fetchErr;
    }

    const duration = Date.now() - requestStart;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const err = new Error(errorData.error?.message || `API request failed with status ${response.status}`);
      debugNet('OpenAI Compatible stream response error', {
        provider: 'openai_compatible',
        status: response.status,
        statusText: response.statusText,
        duration: duration,
        model: model,
        errorType: 'HTTPError',
        errorMsg: err.message
      });
      throw err;
    }

    debugNet('OpenAI Compatible stream connected', {
      provider: 'openai_compatible',
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

window.OpenAICompatibleAPI = OpenAICompatibleAPI;
