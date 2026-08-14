/**
 * Single source of truth for OpenRouter model priority order.
 *
 * Edit ONLY this array to reorder models.
 * Index 0 = Priority #1 (primary)
 * Index 1 = Priority #2 (fallback 1)
 * Index 2 = Priority #3 (fallback 2)
 *
 * Primary is `openrouter/free`, an evergreen router alias rather than a
 * specific model slug. Specific slugs (qwen/..., stepfun/..., nvidia/...)
 * get retired or renamed within months, and a stale slug doesn't degrade —
 * every chat request fails outright. Fallbacks are intentionally empty:
 * stacking more specific slugs "for safety" just creates two more entries
 * that need the same upkeep this file exists to avoid. openrouter/free
 * already load-balances across free models on its own.
 */
const MODEL_PRIORITY = [
  'openrouter/free',   // #1 primary — evergreen, never goes stale
  '',                  // #2 fallback 1 — intentionally empty, see above
  '',                  // #3 fallback 2 — intentionally empty, see above
];

// Hardcoded defaults that shipped previously. Anyone whose stored
// openRouterModel matches one of these is carrying a default they never
// chose (handleOpenRouterModelChange fires on blur as well as change, so
// simply tabbing through settings could persist the displayed default) —
// app_init.js migrates it to the current default on load.
const STALE_OPENROUTER_DEFAULTS = [
  'qwen/qwen3.6-plus-preview:free',
  'stepfun/step-3.5-flash:free',
  'nvidia/nemotron-3-super-120b-a12b:free'
];
window.STALE_OPENROUTER_DEFAULTS = STALE_OPENROUTER_DEFAULTS;
