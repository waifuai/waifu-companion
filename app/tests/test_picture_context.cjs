const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client(previous, answer) {
  const decisions = [], writers = [];
  const context = vm.createContext({
    window: { WaifuProxyAPI: { generateImage() {}, async decide(tasks, state) {
      decisions.push({ tasks, state });
      return answer === undefined
        ? { picture_action_v1: { choice_id: state.previous_reply.includes('Want a picture') ? 'draw' : 'none', confidence: 0.9 } }
        : answer;
    } } },
    conversationContext: [{ role: 'assistant', content: previous }],
    AppStorage: { KEYS: {}, getString: (_key, fallback) => fallback },
    debugLog() {}, debugError() {}
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../scripts/ai_interface.js'), 'utf8'), context);
  context.callConfiguredLLM = async (messages, _event, purpose) => {
    writers.push({ messages, purpose });
    return { content: 'DRAW: An anime companion smiling in a cozy room, warm light and a comfortable outfit.' };
  };
  return { context, decisions, writers };
}

test('accepting a closing offer in a long reply reaches the picture writer', async () => {
  const offer = 'Want a picture of me in my room, or in a cozy cafe?';
  const previous = 'Here is a little about me. ' + 'I enjoy good conversations. '.repeat(25) + offer;
  // A saved picture note must not displace the spoken offer at the end.
  const { context, decisions, writers } = client(previous + '\n(sent a picture: ' + 'A pleasant earlier scene. '.repeat(20) + ')');
  const result = await context.getImageDecision('In your room');
  assert.ok(result, 'The option selected from the offer should reach the writer');
  assert.equal(decisions.length, 1);
  const state = decisions[0].state;
  assert.ok(state.previous_reply.length <= 300);
  assert.ok(state.previous_reply.startsWith('Here is a little about me.'));
  assert.ok(state.previous_reply.endsWith(offer));
  assert.ok(!state.previous_reply.includes('sent a picture:'));
  assert.equal(writers.length, 1);
  assert.equal(writers[0].purpose, 'image_prompt');
  assert.equal(writers[0].messages[1].content, `Companion's previous message: ${state.previous_reply}\n\nUser's NEW message: In your room`);
});

test('short context stays intact and confident none still suppresses the writer', async () => {
  const previous = 'Here is the picture you requested.';
  const { context, decisions, writers } = client(previous, { picture_action_v1: { choice_id: 'none', confidence: 0.6 } });
  assert.equal(await context.getImageDecision('Thanks'), null);
  assert.equal(decisions[0].state.previous_reply, previous);
  assert.equal(writers.length, 0);
});

test('an unavailable decision retains the existing picture writer', async () => {
  const { context, writers } = client('Want a picture?', null);
  assert.ok(await context.getImageDecision('Yes please'));
  assert.equal(writers.length, 1);
});
