const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client(answer) {
  const decisions = [], writers = [];
  const context = vm.createContext({
    AppStorage: { KEYS: {}, getString: () => 'A cozy room at night' },
    document: { getElementById: () => null, addEventListener() {} },
    window: { WaifuProxyAPI: { async decide(tasks, state) {
      decisions.push({ tasks, state });
      if (answer instanceof Error) throw answer;
      return answer;
    } } },
    conversationContext: [{ role: 'user', content: 'Let us head to the beach' }],
    contextForModel: messages => messages,
    UNSAFE_IMAGE_WORDS: /\b(zugzwang|zebra)\b/i,
    async callConfiguredLLM(messages, _event, purpose) {
      writers.push({ messages, purpose });
      return { content: 'SCENE: A quiet beach at sunset, gentle waves and warm golden light' };
    },
    debugLog() {}, debugError() {}
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/settings_handlers.js'), 'utf8'), context);
  return { context, decisions, writers };
}

test('zero-confidence keep skips background writing', async () => {
  const { context, decisions, writers } = client({ background_action_v1: { choice_id: 'keep', confidence: 0 } });
  assert.equal(await context.getBackgroundScene(), null);
  assert.equal(decisions.length, 1);
  assert.equal(writers.length, 0);
});

test('zero-confidence change asks only for a scene description', async () => {
  const { context, writers } = client({ background_action_v1: { choice_id: 'change', confidence: 0 } });
  assert.match(await context.getBackgroundScene(), /beach/);
  assert.equal(writers.length, 1);
  assert.equal(writers[0].purpose, 'background_prompt');
  assert.match(writers[0].messages[0].content, /Always answer SCENE/);
  assert.doesNotMatch(writers[0].messages[0].content, /SAME/);
});

test('uncertain, invalid, unavailable and failed actions retain scene judgment', async () => {
  for (const answer of [{ background_action_v1: { choice_id: 'uncertain', confidence: 1 } }, { background_action_v1: { choice_id: 'invented' } }, null, new Error('offline')]) {
    const { context, writers } = client(answer);
    assert.ok(await context.getBackgroundScene());
    assert.equal(writers.length, 1);
    assert.match(writers[0].messages[0].content, /SAME/);
  }
});

test('manual generation bypasses the decision and always requests a scene', async () => {
  const { context, decisions, writers } = client({ background_action_v1: { choice_id: 'keep', confidence: 1 } });
  assert.ok(await context.getBackgroundScene(true));
  assert.equal(decisions.length, 0);
  assert.doesNotMatch(writers[0].messages[0].content, /SAME/);
});
