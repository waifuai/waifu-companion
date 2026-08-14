/**
 * OpenRouter API Wrapper
 *
 * Provides a compatible interface to OpenRouter's API for chat completions.
 * Supports configuration of API key and model through localStorage.
 * Request/response handling for a single attempt lives in
 * llm_provider_base.js; this file adds per-model fallback retry on top.
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

    // No per-model exceptions: a hardcoded list of models that don't support
    // response_format is exactly the kind of thing that goes stale the
    // moment a model is renamed or retired (see model_priority.js). If a
    // model ignores this and returns plain text anyway, parseAIResponse in
    // ai_interface.js already treats non-JSON output as a valid plain-text
    // reply, so there's no failure mode to guard against here.
    if (json) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  },

  async requestCompletionWithFallback(options = {}) {
    const apiKey = this.getApiKey();
    requireConfigured(!!apiKey, 'OpenRouter', 'OpenRouter API key not configured. Please set it in settings.');

    const { messages, json, stream = false } = options;
    const modelsToTry = this.getCandidateModels();
    const failures = [];
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': this.SITE_URL,
      'X-OpenRouter-Title': this.SITE_NAME,
      'X-Title': this.SITE_NAME,
      'X-OpenRouter-Categories': 'character-chat',
    };

    for (let index = 0; index < modelsToTry.length; index++) {
      const model = modelsToTry[index];
      const attemptNumber = index + 1;
      const isLastAttempt = attemptNumber === modelsToTry.length;
      const body = this.buildRequestBody(model, messages, json, stream);

      try {
        const result = await performLLMRequest({
          url: this.API_URL,
          headers,
          body,
          stream,
          providerLabel: 'OpenRouter',
          providerSlug: 'openrouter',
          extraLogContext: { attempt: `${attemptNumber}/${modelsToTry.length}` }
        });
        return { ...result, model };
      } catch (err) {
        failures.push(`${model}: ${err.message}`);

        if (!isLastAttempt) {
          const reason = err.status ? `returned an error (HTTP ${err.status})` : 'failed to connect';
          debugLog(`[OpenRouter] Model ${model} ${reason}. Trying fallback model next.`, 'warn');
          continue;
        }

        err.failures = failures;
        throw err;
      }
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
