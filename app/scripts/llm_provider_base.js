/**
 * Shared HTTP request logic for chat-completion providers.
 *
 * groq.js and openai_compatible.js each carried their own ~150-line copy of
 * "build headers -> fetch -> check ok -> parse -> log", identical except for
 * provider-specific labels. openrouter.js has the same shape for a single
 * attempt, wrapped in its own per-model retry loop. All three now share this.
 *
 * Also fixes a real gap found while extracting this: none of the three
 * providers attached `.status` to the Error thrown on a non-2xx response.
 * Downstream code (ai_interface.js's trackError, and any future rate-limit
 * detection) reads `error.status` to tell a 429 apart from a 500 or a
 * network failure — without it, every provider HTTP error looked identical
 * to analytics.
 */

// Performs one chat-completion HTTP request.
// Returns {content} for a normal request, or {stream, response} when
// `stream` is true. Throws on network failure or a non-2xx response, with
// `.status` set whenever an HTTP status is known.
async function performLLMRequest({ url, headers, body, stream, providerLabel, providerSlug, extraLogContext = {} }) {
  const requestStart = Date.now();
  const streamLabel = stream ? ' stream' : '';

  debugNet(`${providerLabel}${streamLabel} request`, {
    provider: providerSlug,
    method: 'POST',
    model: body.model,
    messageCount: body.messages?.length,
    jsonMode: !!body.response_format,
    stream: !!stream,
    ...extraLogContext
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (fetchErr) {
    debugError(`[${providerLabel}]${streamLabel} fetch() failed`, fetchErr, {
      model: body.model,
      duration_ms: Date.now() - requestStart,
      messageCount: body.messages?.length,
      url,
      ...extraLogContext
    });
    throw fetchErr;
  }

  const duration = Date.now() - requestStart;

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err = new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    err.status = response.status;
    debugNet(`${providerLabel}${streamLabel} response error`, {
      provider: providerSlug,
      status: response.status,
      statusText: response.statusText,
      duration,
      model: body.model,
      errorType: 'HTTPError',
      errorMsg: err.message,
      ...extraLogContext
    });
    throw err;
  }

  if (stream) {
    debugNet(`${providerLabel} stream connected`, {
      provider: providerSlug,
      status: response.status,
      duration,
      model: body.model,
      ...extraLogContext
    });
    return { stream: response.body, response };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  debugNet(`${providerLabel} response ok`, {
    provider: providerSlug,
    status: response.status,
    duration,
    model: body.model,
    responseSize: content.length,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    totalTokens: data.usage?.total_tokens,
    ...extraLogContext
  });

  return { content };
}
window.performLLMRequest = performLLMRequest;

// Shared "not configured" error builder — same message/logging shape every
// provider used inline before this file existed.
function requireConfigured(condition, providerLabel, message) {
  if (condition) return;
  const err = new Error(message);
  debugError(`[${providerLabel}] request failed - not configured`, err);
  throw err;
}
window.requireConfigured = requireConfigured;
