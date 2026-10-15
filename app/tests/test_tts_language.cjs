const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const routerPath = fs.existsSync(path.join(__dirname, '../scripts/tts_language_router.js'))
  ? path.join(__dirname, '../scripts/tts_language_router.js') : path.join(__dirname, '../tts_language_router.js');
const voices = [
  ['en_us_001','en-US','female','tiktok'], ['en_us_002','en-US','female','tiktok'], ['en_uk_001','en-GB','male','tiktok'],
  ['jp_003','ja-JP','female','tiktok'], ['jp_006','ja-JP','male','tiktok'], ['fr_001','fr-FR','male','tiktok'],
  ['es_002','es-ES','male','tiktok'], ['es_mx_002','es-MX','male','tiktok'], ['br_001','pt-BR','female','tiktok'],
  ['id_001','id-ID','female','tiktok'], ['de_001','de-DE','female','tiktok'], ['browser-male','en-US','male','browser'],
  ['af_bella','en-US','female','kokoro'],
].map(([id, language, gender, provider]) => ({id, language, gender, provider}));
function policy() {
  const context = vm.createContext({window:{}, setTimeout, clearTimeout});
  vm.runInContext(fs.readFileSync(routerPath, 'utf8'), context);
  return context.window.TTSLanguageRouter;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
const cases = [
  ['こんにちは。', 'ja-JP'], ['你好，今天怎么样？','zh-CN'], ['Hola!','es-ES'], ['Hola, gracias!','es-ES'],
  ['Terima kasih!','id-ID'], ['Bonjour, je suis contente de te voir.','fr-FR'],
  ['Olá, muito obrigado!','pt-BR'], ['Hallo, ich bin hier und ich liebe dich.','de-DE'],
  ['Hello, how are you today?','en-US'], ['Hello, the Japanese word is "こんにちは".','en-US'],
];
for (const [text, lang] of cases) test(`local language for ${text}`, () => {
  const a = policy().analyze(text); assert.equal(a.lang, lang); assert.equal(a.needsDecision, false);
});
test('repetition alone is not evidence of multiple matching words', () => {
  const p=policy(); assert.equal(p.analyze('amor amor something unfamiliar today').strong, false);
});
test('substantial mixed scripts and competing Latin evidence request meaning', () => {
  const p=policy(); assert.equal(p.analyze('こんにちは、元気ですか？ Hello, how are you today?').needsDecision, true);
  assert.equal(p.analyze('Bonjour je suis contente. Hello you are very welcome.').needsDecision, true);
});
test('speech cleanup removes URLs and picture payloads but retains ordinary translations', () => {
  const p=policy();
  assert.equal(p.clean('Hello [site](https://example.com). https://example.com/a'), 'Hello site.');
  assert.equal(p.clean('こんにちは。 [画像: a girl in her room] (translation: a girl in her room)'), 'こんにちは。');
  assert.equal(p.clean('Hola (translation: hello)'), 'Hola (translation: hello)');
});
test('compatible manual voices, accents and providers are retained', () => {
  const p=policy();
  for(const [id,lang] of [['jp_006','ja-JP'],['es_mx_002','es-ES'],['en_uk_001','en-US'],['af_bella','en-US']]) assert.equal(p.selectVoice(voices,id,lang).voiceId,id);
  assert.deepEqual(plain(p.selectVoice(voices,'browser-male','ja-JP')), {voiceId:'browser-male',lang:'ja-JP',provider:'browser',gender:'male'});
});
test('unsupported primary languages request browser routing rather than an English primary', () => {
  const p=policy(); const route=p.selectVoice(voices,'en_us_001','ar-SA');
  assert.equal(route.provider,'browser'); assert.equal(route.unsupportedPrimary,true);
});
test('neutral replies inherit conversation language; a clear English switch updates it', () => {
  const engine=policy().create(), opts={key:'one',voiceId:'en_us_001',voices};
  assert.equal(engine.prepare('Bonjour, je suis contente de te voir.',opts).lang,'fr-FR');
  assert.equal(engine.prepare('ok',opts).lang,'fr-FR');
  assert.equal(engine.prepare('Hello, how are you today?',opts).lang,'en-US');
  assert.equal(engine.prepare('ok',opts).lang,'en-US');
  assert.equal(engine.prepare('okay',opts).lang,'en-US');
});
test('manual mode and muted speech do not request decisions or learn a target', () => {
  const engine=policy().create();
  assert.equal(engine.prepare('mysterious unfamiliar phrases',{voices,auto:false}).needsDecision,false);
  assert.equal(engine.prepare('mysterious unfamiliar phrases',{voices,enabled:false}).needsDecision,false);
});
test('a model decision is cached and reused without another request', async () => {
  const engine=policy().create(), opts={key:'one',voiceId:'en_us_001',voices};
  const plan=engine.prepare('mysterious unfamiliar phrases',opts); assert.equal(plan.needsDecision,true);
  await engine.settle(plan,Promise.resolve({language:{choice_id:'fr-FR',confidence:.9}}),'language');
  assert.equal(plan.lang,'fr-FR'); assert.equal(plan.source,'decision');
  const cached=engine.prepare('mysterious unfamiliar phrases',opts);
  assert.equal(cached.lang,plan.lang);assert.equal(cached.cacheHit,true);assert.equal(cached.decisionRequested,false);
  assert.equal(engine.prepare('oui vraiment',opts).needsDecision,false);
});
test('voice/setting changes and conversation changes invalidate cached decisions', async () => {
  const engine=policy().create(), opts={key:'one',voiceId:'en_us_001',voices};
  const first=engine.prepare('mysterious unfamiliar phrases',opts);
  await engine.settle(first,{language:{choice_id:'ja-JP',confidence:.9}},'language');
  assert.notEqual(engine.prepare(first.text,{...opts,voiceId:'en_us_002'}),first);
  assert.equal(engine.prepare('okay',{...opts,key:'two'}).lang,'en-US');
  engine.reset('one'); assert.notEqual(engine.prepare(first.text,opts),first);
});
test('timeout freezes the local route; a late result cannot change already prepared speech', async () => {
  const engine=policy().create(), plan=engine.prepare('mysterious unfamiliar phrases',{voices});
  let deliver; const request=new Promise(resolve=>deliver=resolve);
  await engine.settle(plan,request,'language',()=>true,10);
  assert.equal(plan.source,'local-fallback'); const lang=plan.lang;
  deliver({language:{choice_id:'ja-JP',confidence:1}}); await new Promise(r=>setTimeout(r,1));
  assert.equal(plan.lang,lang);
});
test('unknown choices, errors and stale answers retain the local route', async () => {
  for(const [answer,valid] of [[{choice_id:'invented',confidence:1},true],[{choice_id:'ja-JP',confidence:0},false],[null,true]]) {
    const engine=policy().create(), plan=engine.prepare('mysterious unfamiliar phrases',{voices});const lang=plan.lang;
    await engine.settle(plan,answer?{language:answer}:Promise.reject(new Error('offline')),'language',()=>valid);
    assert.equal(plan.lang,lang);
  }
});

test('supported winning locales and keep apply even at zero confidence', async () => {
  for (const choice of ['ja-JP', 'fr-FR', 'keep']) {
    const engine=policy().create(), opts={key:'one',voices};
    engine.prepare('Hola, gracias!',opts);
    const plan=engine.prepare('Bonjour je suis contente. Hello you are very welcome.',opts);
    assert.equal(plan.needsDecision,true);
    await engine.settle(plan,{language:{choice_id:choice,confidence:0}},'language');
    assert.equal(plan.lang,choice==='keep'?'es-ES':choice);
    assert.equal(plan.source,choice==='keep'?'decision-keep':'decision');
    const cached=engine.prepare(plan.text,opts);
    assert.equal(cached.cacheHit,true);
    assert.equal(cached.lang,plan.lang);
  }
});
test('an older pending reply cannot overwrite a newer conversation target', async () => {
  const engine=policy().create(), opts={key:'one',voices}; const old=engine.prepare('mysterious unfamiliar phrases',opts);
  engine.prepare('Hola, gracias!',opts);
  await engine.settle(old,{language:{choice_id:'ja-JP',confidence:1}},'language');
  assert.equal(engine.prepare('okay',opts).lang,'es-ES');
});

test('a keep answer preserves an already established target without forcing reclassification', async () => {
  const engine=policy().create(), opts={key:'one',voices};
  engine.prepare('Bonjour, je suis contente de te voir.',opts);
  const mixed=engine.prepare('Bonjour je suis contente. Hello you are very welcome.',opts);
  assert.equal(mixed.needsDecision,true);
  await engine.settle(mixed,{language:{choice_id:'keep',confidence:.95}},'language');
  assert.equal(engine.prepare('je magnifique banane tranquille',opts).needsDecision,false);
});

test('female auto routing never substitutes male-only French or Spanish voices',()=>{
 const p=policy();for(const lang of ['fr-FR','es-ES']) {
  const r=p.selectVoice(voices,'en_us_001',lang);
  assert.equal(r.provider,'browser');assert.equal(r.gender,'female');assert.equal(r.unsupportedPrimary,true);
 }
 assert.equal(p.selectVoice(voices,'en_us_001','ja-JP').voiceId,'jp_003');
 assert.equal(p.selectVoice(voices,'es_002','es-ES',false).voiceId,'es_002');
});
test('browser gender selection refuses male and unknown fallback, with whole-name matching',()=>{
 const p=policy();const male={name:'David',lang:'en-US'},unknown={name:'Default',lang:'en-US'},female={name:'Samantha',lang:'en-US'};
 assert.equal(p.browserVoiceForGender([male,unknown],'female'),null);
 assert.equal(p.browserVoiceForGender([male,unknown,female],'female'),female);
 assert.equal(p.browserVoiceForGender([{name:'Female',lang:'en-US'}],'male'),null);
 assert.equal(p.browserVoiceForGender([female,male],'male'),male);
 assert.equal(p.browserVoiceForGender([],'female'),null);
 assert.equal(p.browserVoiceForGender([{name:'Custom',gender:'female'}],'female').name,'Custom');
});
