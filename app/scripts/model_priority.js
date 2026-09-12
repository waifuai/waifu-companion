/**
 * Single source of truth for OpenRouter model priority order.
 *
 * Edit ONLY this array to reorder models.
 * Index 0 = Priority #1 (primary)
 * Index 1 = Priority #2 (fallback 1)
 * Index 2 = Priority #3 (fallback 2)
 *
 * Primary is `nex-agi/nex-n2.5-pro:free` (natural companion personality,
 * instant streaming), followed by `nex-agi/nex-n2.5-mini:free` (0.37s TTFT,
 * ultra-high availability) and `google/gemma-4-26b-a4b-it:free` (DeepMind MoE).
 * Wildcard `openrouter/free` is intentionally retired because OpenRouter
 * load-balances it into content-safety evaluation models and code models.
 */
const MODEL_PRIORITY = [
  'nex-agi/nex-n2.5-pro:free',      // #1 primary — sweet companion persona, instant streaming
  'nex-agi/nex-n2.5-mini:free',     // #2 fallback 1 — ultra-fast 0.37s TTFT, 88B tokens served
  'google/gemma-4-26b-a4b-it:free'  // #3 fallback 2 — Google DeepMind MoE 26B instruction model
];

// Hardcoded defaults that shipped previously. Anyone whose stored
// openRouterModel matches one of these is carrying a default they never
// chose (handleOpenRouterModelChange fires on blur as well as change, so
// simply tabbing through settings could persist the displayed default) —
// app_init.js migrates it to the current default on load.
const STALE_OPENROUTER_DEFAULTS = [
  'openrouter/free',
  'qwen/qwen3.6-plus-preview:free',
  'stepfun/step-3.5-flash:free',
  'nvidia/nemotron-3-super-120b-a12b:free'
];
window.STALE_OPENROUTER_DEFAULTS = STALE_OPENROUTER_DEFAULTS;
