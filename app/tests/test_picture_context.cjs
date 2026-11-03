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
      if (answer instanceof Error) throw answer;
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
  assert.ok(writers[0].messages[1].content.endsWith(`Companion's previous message: ${state.previous_reply}\n\nUser's NEW message: In your room`));
});

test('short context stays intact and zero-confidence none suppresses the writer', async () => {
  const previous = 'Here is the picture you requested.';
  const { context, decisions, writers } = client(previous, { picture_action_v1: { choice_id: 'none', confidence: 0 } });
  assert.equal(await context.getImageDecision('Thanks'), null);
  assert.equal(decisions[0].state.previous_reply, previous);
  assert.equal(writers.length, 0);
});

test('an unavailable decision retains the existing picture writer', async () => {
  const { context, writers } = client('Want a picture?', null);
  assert.ok(await context.getImageDecision('Yes please'));
  assert.equal(writers.length, 1);
});

test('zero-confidence draw sends an approved request to the description writer', async () => {
  const { context, writers } = client('Want a picture?', { picture_action_v1: { choice_id: 'draw', confidence: 0 } });
  assert.ok(await context.getImageDecision('Yes please'));
  assert.equal(writers.length, 1);
  const prompt = writers[0].messages[0].content;
  assert.match(prompt, /approved picture request/);
  assert.match(prompt, /exactly one line: DRAW:/);
  assert.doesNotMatch(prompt, /NONE|Decide whether/);
});

test('uncertain, unknown and failed actions retain the original picture judgment', async () => {
  for (const answer of [{ picture_action_v1: { choice_id: 'uncertain', confidence: 1 } }, { picture_action_v1: { choice_id: 'invented' } }, new Error('offline')]) {
    const { context, writers } = client('Want a picture?', answer);
    assert.ok(await context.getImageDecision('Yes please'));
    assert.equal(writers.length, 1);
    assert.match(writers[0].messages[0].content, /Decide whether/);
    assert.match(writers[0].messages[0].content, /NONE/);
  }
});

test('picture writer receives a custom companion and its early roleplay definition',async()=>{
  const {context,writers}=client('Of course, a selfie?',{picture_action_v1:{choice_id:'draw'}});
  context.window.userPersonaPrompt='You are Mira, an adult with short red hair and green eyes.';
  context.conversationContext.unshift({role:'user',content:'For this story you are a red-haired space pilot.'});
  for(let i=0;i<15;i++)context.conversationContext.push({role:'assistant',content:'A later ordinary chat turn.'});
  await context.getImageDecision('Send me a selfie');
  assert.match(writers[0].messages[1].content,/short red hair/);
  assert.match(writers[0].messages[1].content,/red-haired space pilot/);
  assert.match(writers[0].messages[0].content,/NEW request's explicit subject and appearance take priority/);
});

test('a short history keeps a character introduced between the first and recent turns',async()=>{
  const {context,writers}=client('Here is a selfie offer.',{picture_action_v1:{choice_id:'draw'}});
  context.conversationContext.length=0;
  for(let i=0;i<24;i++)context.conversationContext.push({role:'user',content:i===12?'In this story your name is Mira and you have turquoise hair.':'Ordinary short turn '+i});
  await context.getImageDecision('Send me a selfie');
  assert.match(writers[0].messages[1].content,/turquoise hair/);
});

test('long persona and history retain a later appearance correction, without image or superseded details',async()=>{
  const {context,writers}=client('A selfie?',{picture_action_v1:{choice_id:'draw'}});
  context.window.userPersonaPrompt='Custom companion Mira. '+ 'old costume '.repeat(1000);
  context.window.conversationSummary='Old story. '.repeat(1000);
  context.conversationContext.unshift({role:'user',content:'Earlier scene. '.repeat(1000)});
  context.conversationContext.push({role:'user',content:'For the current scene, you now have silver hair and a blue coat.'},
    {role:'assistant',content:'superseded-character-secret',superseded:true},
    {role:'assistant',content:'image-character-secret',imageUrl:'https://example.test/invented.png'});
  await context.getImageDecision('Send me a selfie');
  const character=context.pictureCharacterContext();assert.ok(character.length<=6000);
  assert.match(character,/silver hair and a blue coat/);assert.doesNotMatch(character,/superseded-character-secret|image-character-secret/);
  assert.match(writers[0].messages[0].content,/Later scene corrections override earlier details/);
});

test('a long new picture request retains its explicit subject at the end',async()=>{
  const {context,writers}=client('A drawing?',{picture_action_v1:{choice_id:'draw'}});
  await context.getImageDecision('Draw a picture. '+ 'setting '.repeat(500)+' The subject is an adult knight with amber eyes, not the companion.');
  const input=writers[0].messages[1].content;
  assert.match(input,/adult knight with amber eyes/);assert.match(writers[0].messages[0].content,/third-party subject/);
});
