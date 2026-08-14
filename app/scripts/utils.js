function formatSeconds(seconds) {
  // Calculate days, hours, minutes, and remaining seconds
  const days = Math.floor(seconds / (60 * 60 * 24));
  const hours = Math.floor((seconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const remainingSeconds = seconds % 60;

  // Construct the formatted string
  let result = "";
  if (days > 0) result += `${days} day${days > 1 ? "s" : ""} `;
  if (hours > 0) result += `${hours} hour${hours > 1 ? "s" : ""} `;
  if (minutes > 0)
    result += `${minutes} minute${minutes > 1 ? "s" : ""} `;
  if (remainingSeconds > 0 || result === "")
    result += `${remainingSeconds} second${remainingSeconds > 1 ? "s" : ""}`;

  return result.trim();
}

function trackEvent(eventName, params = {}) {
  if (typeof gtag === 'function') {
    gtag('event', eventName, params);
  }
}
window.trackEvent = trackEvent;

// Runs fn once the caller stops calling for `ms`, keyed by name.
// Range inputs fire `input` continuously while dragging, so a single slider
// drag can emit dozens of analytics events and localStorage writes if left
// ungated. Visual feedback stays immediate; only the side effects are deferred.
const _debounceTimers = new Map();
function debounced(key, fn, ms = 600) {
  clearTimeout(_debounceTimers.get(key));
  _debounceTimers.set(key, setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, ms));
}
window.debounced = debounced;

// --- Error reporting --------------------------------------------------------
// Reports failures to analytics as a fixed category plus a numeric-ish code.
// Deliberately never sends the raw error message: API error bodies can echo
// request content (including API keys), and free-text messages would blow up
// GA's cardinality until the dimension becomes unqueryable.

const ERROR_CATEGORIES = [
  'ai_request',     // chat completion failed
  'tts',            // speech synthesis failed
  'summarization',  // memory compression failed
  'translation',    // translate / transliterate failed
  'model_load',     // Live2D model failed to load
  'image_gen',      // background generation failed
  'storage'         // localStorage write failed / quota exceeded
];

// One event per category+code every 60s, and a hard session cap, so a failure
// inside a retry loop can't fire hundreds of events.
const _errorThrottle = new Map();
const ERROR_THROTTLE_MS = 60000;
const ERROR_SESSION_CAP = 50;
let _errorsReported = 0;

function trackError(category, code) {
  if (!ERROR_CATEGORIES.includes(category)) return;
  if (_errorsReported >= ERROR_SESSION_CAP) return;

  // Only pass through a plain status code; anything else is bucketed.
  const safeCode = Number.isInteger(code) ? code : 0;

  const key = `${category}:${safeCode}`;
  const now = Date.now();
  const last = _errorThrottle.get(key);
  if (last && now - last < ERROR_THROTTLE_MS) return;
  _errorThrottle.set(key, now);
  _errorsReported++;

  trackEvent('app_error', { category, code: safeCode });
}
window.trackError = trackError;