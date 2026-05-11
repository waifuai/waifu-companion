/**
 * OpenRouter API Wrapper
 * 
 * Provides a compatible interface to OpenRouter's API for chat completions.
 * Supports configuration of API key and model through localStorage.
 * 
 * Model priority is defined in model_priority.js
 */

const OpenRouterAPI = {
  API_URL: 'https://openrouter.ai/api/v1/chat/completions',

  DEFAULT_MODEL: MODEL_PRIORITY[0],
  DEFAULT_FALLBACK_MODELS: [MODEL_PRIORITY[1], MODEL_PRIORITY[2]],

  SITE_NAME: 'Waifu AI',
  SITE_URL: 'https://waifuai.com',

  getApiKey() {
    return localStorage.getItem('openRouterApiKey') || '';
  },

  setApiKey(apiKey) {
    localStorage.setItem('openRouterApiKey', apiKey);
  },

  normalizeModel(model, fallbackModel) {
    const trimmed = typeof model === 'string' ? model.trim() : '';
    return trimmed || fallbackModel;
  },

  getStoredModel(storageKey, fallbackModel) {
    const storedModel = localStorage.getItem(storageKey);
    if (storedModel === null) {
      return fallbackModel;
    }

    return typeof storedModel === 'string' ? storedModel.trim() : '';
  },

  isModelEnabled(storageKey, defaultValue = true) {
    const storedValue = localStorage.getItem(storageKey);
    if (storedValue === null) {
      return defaultValue;
    }

    return storedValue === 'true';
  },

  getModel() {
    return this.getStoredModel('openRouterModel', this.DEFAULT_MODEL);
  },

  setModel(model) {
    localStorage.setItem('openRouterModel', model);
  },

  getFallbackModels(primaryModel = this.getModel()) {
    const storedFallbacks = [
      this.isModelEnabled('openRouterFallbackModel1Enabled') ? this.getStoredModel('openRouterFallbackModel1', this.DEFAULT_FALLBACK_MODELS[0]) : '',
      this.isModelEnabled('openRouterFallbackModel2Enabled') ? this.getStoredModel('openRouterFallbackModel2', this.DEFAULT_FALLBACK_MODELS[1]) : ''
    ];

    return storedFallbacks.filter((model, index, allModels) => model && model !== primaryModel && allModels.indexOf(model) === index);
  },

  getCandidateModels() {
    const primaryModel = this.isModelEnabled('openRouterPrimaryEnabled') ? this.getModel() : '';
    const fallbackModels = this.getFallbackModels(primaryModel);
    return [primaryModel, ...fallbackModels].filter((model, index, allModels) => model && allModels.indexOf(model) === index);
  },

  buildRequestBody(model, messages, json, stream = false) {
    const body = {
      model,
      messages
    };

    if (stream) {
      body.stream = true;
    }

    if (json) {
      const unsupportedModels = ['stepfun/step-3.5-flash:free', 'stepfun/step-1-flash'];
      if (!unsupportedModels.includes(model)) {
        body.response_format = { type: 'json_object' };
      }
    }

    return body;
  },

  async requestCompletionWithFallback(options = {}) {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      const err = new Error('OpenRouter API key not configured. Please set it in settings.');
      debugError('[OpenRouter] request failed - no API key', err);
      throw err;
    }

    const { messages, json, stream = false } = options;
    const modelsToTry = this.getCandidateModels();
    const requestStart = Date.now();
    const failures = [];

    for (let index = 0; index < modelsToTry.length; index++) {
      const model = modelsToTry[index];
      const attemptNumber = index + 1;
      const attemptLabel = `${attemptNumber}/${modelsToTry.length}`;
      const body = this.buildRequestBody(model, messages, json, stream);

      debugNet(stream ? 'OpenRouter stream request' : 'OpenRouter request', {
        provider: 'openrouter',
        method: 'POST',
        model,
        messageCount: messages.length,
        jsonMode: !!json,
        stream: !!stream,
        attempt: attemptNumber,
        totalAttempts: modelsToTry.length
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
        failures.push(`${model}: ${fetchErr.message}`);
        debugError(`[OpenRouter] ${stream ? 'stream ' : ''}fetch() failed`, fetchErr, {
          model,
          duration_ms: Date.now() - requestStart,
          messageCount: messages.length,
          url: this.API_URL,
          attempt: attemptLabel
        });

        if (attemptNumber < modelsToTry.length) {
          debugLog(`[OpenRouter] Model ${model} failed to connect. Trying fallback model next.`, 'warn');
          continue;
        }

        throw fetchErr;
      }

      const duration = Date.now() - requestStart;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error?.message || `API request failed with status ${response.status}`);
        failures.push(`${model}: ${err.message}`);
        debugNet(stream ? 'OpenRouter stream response error' : 'OpenRouter response error', {
          provider: 'openrouter',
          status: response.status,
          statusText: response.statusText,
          duration,
          model,
          errorType: 'HTTPError',
          errorMsg: err.message,
          attempt: attemptLabel
        });

        if (attemptNumber < modelsToTry.length) {
          debugLog(`[OpenRouter] Model ${model} returned an error. Trying fallback model next.`, 'warn');
          continue;
        }

        err.failures = failures;
        throw err;
      }

      if (stream) {
        debugNet('OpenRouter stream connected', {
          provider: 'openrouter',
          status: response.status,
          duration,
          model,
          attempt: attemptLabel
        });

        return {
          stream: response.body,
          response,
          model
        };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      debugNet('OpenRouter response ok', {
        provider: 'openrouter',
        status: response.status,
        duration,
        model,
        responseSize: content.length,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
        attempt: attemptLabel
      });

      return {
        content,
        model
      };
    }

    const aggregateError = new Error(`All OpenRouter models failed. ${failures.join(' | ')}`.trim());
    aggregateError.failures = failures;
    throw aggregateError;
  },

  isConfigured() {
    return !!this.getApiKey() && this.getCandidateModels().length > 0;
  },

  async createCompletion(options) {
    return this.requestCompletionWithFallback({ ...options, stream: false });
  },

  async createCompletionStream(options) {
    return this.requestCompletionWithFallback({ ...options, stream: true });
  }
};

window.OpenRouterAPI = OpenRouterAPI;
