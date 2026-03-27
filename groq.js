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
      throw new Error('Groq API key not configured. Please set it in settings.');
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

    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
      throw new Error('Groq API key not configured. Please set it in settings.');
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

    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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

window.GroqAPI = GroqAPI;