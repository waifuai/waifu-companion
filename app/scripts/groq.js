/**
 * Groq API Wrapper
 * 
 * Provides a compatible interface to Groq's API for chat completions.
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

  async createCompletion(options) {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      const err = new Error('Groq API key not configured. Please set it in settings.');
      debugError('[Groq] createCompletion failed - no API key', err);
      throw err;
    }

    const model = this.getModel();
    const { messages, json } = options;

    const body = {
      model: model,
      messages: messages,
    };

    if (json) {
      body.response_format = { type: 'json_object' };
    }

    const requestStart = Date.now();
    debugNet('Groq request', {
      provider: 'groq',
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
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const duration = Date.now() - requestStart;
      debugError('[Groq] fetch() failed', fetchErr, {
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
      debugNet('Groq response error', {
        provider: 'groq',
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

    debugNet('Groq response ok', {
      provider: 'groq',
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
      const err = new Error('Groq API key not configured. Please set it in settings.');
      debugError('[Groq] createCompletionStream failed - no API key', err);
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
      body.response_format = { type: 'json_object' };
    }

    const requestStart = Date.now();
    debugNet('Groq stream request', {
      provider: 'groq',
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
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const duration = Date.now() - requestStart;
      debugError('[Groq] stream fetch() failed', fetchErr, {
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
      debugNet('Groq stream response error', {
        provider: 'groq',
        status: response.status,
        statusText: response.statusText,
        duration: duration,
        model: model,
        errorType: 'HTTPError',
        errorMsg: err.message
      });
      throw err;
    }

    debugNet('Groq stream connected', {
      provider: 'groq',
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

window.GroqAPI = GroqAPI;
