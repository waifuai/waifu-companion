/**
 * Single source of truth for OpenRouter model priority order.
 *
 * Edit ONLY this array to reorder models.
 * Index 0 = Priority #1 (primary)
 * Index 1 = Priority #2 (fallback 1)
 * Index 2 = Priority #3 (fallback 2)
 */
const MODEL_PRIORITY = [
  'qwen/qwen3.6-plus-preview:free',          // #1 primary
  'stepfun/step-3.5-flash:free',              // #2 fallback 1
  'nvidia/nemotron-3-super-120b-a12b:free',   // #3 fallback 2
];
