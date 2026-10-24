const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function runtime(answer) {
  const requests=[], audio=[], events=[];
  const window={enableVoice:true,enableAutoTtsLang:true,enablePrimaryVoice:true,enableFallbackVoice:true,selectedVoiceId:'en_us_001',languages:[{code:'en-US',defaultVoiceId:'en_us_001'}],ChatManager:{getActiveChatId:()=> 'one'},onAIResponseSpeechFinished(){}};
  const c=vm.createContext({window,setTimeout,clearTimeout,setInterval,clearInterval,console,debugLog(){},debugError(){},debugState(){},
    document:{querySelectorAll:()=>[],getElementById:()=>null},highlightSentence(){},
    trackEvent:(name,data)=>events.push({name,data}),
    getTTSAudioContext:()=>({decodeAudioData:async()=>({duration:0})}),atob:x=>Buffer.from(x,'base64').toString('binary'),
    fetch:async(_url,opts)=>{requests.push(JSON.parse(opts.body));return{ok:true,status:200,json:async()=>({data:'AA=='})}},
    conversationContext:[],speechSynthesis:{getVoices:()=>[{name:'English Female',lang:'en-US'}],cancel(){}},
  });
  window.speechSynthesis=c.speechSynthesis;
  for(const file of ['tts_language_router.js','voice_config.js','sentence_processor.js','audio_player.js','tts_queue_manager.js','ai_interface.js']) {
    let source=fs.readFileSync(path.join(__dirname,'../scripts',file),'utf8');
    if(file==='voice_config.js')source=source.slice(0,source.indexOf('];')+2);
    vm.runInContext(source,c);
    if(file==='voice_config.js')c.voices=window.voices;
  }
  c.playResolvedChunk=async descriptor=>{if(descriptor)audio.push(descriptor)};
  const decisions=[];
  window.WaifuProxyAPI={async decide(tasks,state){decisions.push({tasks:JSON.parse(JSON.stringify(tasks)),state});return typeof answer==='function'?answer(tasks,state):answer}};
  return {c,window,requests,audio,events,decisions};
}
async function until(check) {for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('pipeline did not finish');}
test('uncertain speech shares the emotion request and one route serves every chunk',async()=>{
  const r=runtime({live2d_emotion_v1:{choice_id:'happy',confidence:0},live2d_tts_language_v1:{choice_id:'ja-JP',confidence:0}});
  const text='Kimi no koe ga yasashikute kokoro ga atatakai. '.repeat(12);
  const plan=r.c.prepareTTSRouting(text);assert.equal(plan.needsDecision,true);
  const answers=r.c.upgradeEmotionFromDecision('Please read this',text,()=>{},plan);
  r.c.playTTS(text,'en-US',null,0,null,true,r.c.finishTTSRouting(plan,answers));
  await until(()=>r.events.some(e=>e.name==='tts_played'));
  assert.equal(r.decisions.length,1);assert.deepEqual(r.decisions[0].tasks,['live2d_emotion_v1','live2d_tts_language_v1']);
  assert.ok(r.requests.length>=2);assert.ok(r.requests.every(x=>x.voice==='jp_003'));
  assert.equal(r.events[0].data.routing_source,'decision');
});
test('clear speech neither adds a language task nor waits for emotion',async()=>{
  const r=runtime(()=>new Promise(()=>{}));r.c.speechSynthesis.getVoices=()=>[{name:'French Female',lang:'fr-FR'}];const text='Hallo, ich bin hier und ich liebe dich.';
  const plan=r.c.prepareTTSRouting(text);assert.equal(plan.needsDecision,false);
  const answers=r.c.upgradeEmotionFromDecision('Bonjour',text,()=>{},plan);
  r.c.playTTS(text,'en-US',null,0,null,true,r.c.finishTTSRouting(plan,answers));
  await until(()=>r.audio.length===1);
  assert.deepEqual(r.decisions[0].tasks,['live2d_emotion_v1']);assert.equal(r.requests.length,1);assert.equal(r.audio[0].provider,'tiktok');assert.equal(r.audio[0].voiceId,'de_001');assert.equal(r.audio[0].lang,'de-DE');
});
test('replaying the same uncertain reply uses its completed decision',async()=>{
  const r=runtime({live2d_tts_language_v1:{choice_id:'ja-JP',confidence:.9}});
  const text='Kimi no koe ga yasashikute kokoro ga atatakai.';
  const first=await r.c.getTTSRouting(text);const second=await r.c.getTTSRouting(text);
  assert.equal(first.lang,'ja-JP');assert.equal(second.lang,'ja-JP');assert.equal(r.decisions.length,1);
});
test('stop during a pending decision allows new speech and prevents old audio',async()=>{
  let deliver;const old=new Promise(resolve=>deliver=resolve);
  const r=runtime(()=>old);r.c.playTTS('mysterious unfamiliar phrases','en-US');
  await until(()=>r.decisions.length===1);r.c.stopTTS();
  r.c.playTTS('こんにちは。','en-US');await until(()=>r.audio.length===1);
  deliver({live2d_tts_language_v1:{choice_id:'ja-JP',confidence:1}});await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(r.audio.length,1);assert.equal(r.requests[0].voice,'jp_003');
});
test('stop during audio preparation never starts the fetched audio',async()=>{
  let finish;const fetched=new Promise(resolve=>finish=resolve);const r=runtime(null);
  r.c.fetch=()=>fetched;r.c.playTTS('Hola, gracias!','en-US');await new Promise(resolve=>setTimeout(resolve,5));
  r.c.stopTTS();finish({ok:true,status:200,json:async()=>({data:'AA=='})});await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(r.audio.length,0);
});
test('unsupported primary language stays silent even with an installed browser voice',async()=>{
 const r=runtime(null);r.c.speechSynthesis.getVoices=()=>[{name:'Arabic Female',lang:'ar-SA'}];
 assert.equal(await r.c.fetchTTSBuffer('مرحبا كيف حالك اليوم؟','en_us_001'),null);assert.equal(r.requests.length,0);
});
for(const failure of ['network','http','api','decode'])test(`TikTok ${failure} failure stays silent with legacy fallback enabled`,async()=>{
 const r=runtime(null);r.c.fetch=async()=>{if(failure==='network')throw new TypeError('Failed to fetch');return{ok:failure!=='http',status:503,text:async()=>'',json:async()=>failure==='api'?{success:false,error:'offline'}:{data:'AA=='}}};
 if(failure==='decode')r.c.getTTSAudioContext=()=>({decodeAudioData:async()=>{throw new Error('Invalid audio')}});
 assert.equal(await r.c.fetchTTSBuffer('Hello, how are you today?','en_us_001'),null);
});
test('rate limit still reaches queue handling without browser speech',async()=>{
 const r=runtime(null);r.c.fetch=async()=>({ok:false,status:429,text:async()=>''});
 await assert.rejects(r.c.fetchTTSBuffer('Hello','en_us_001'),e=>e.status===429);
});
test('explicit browser selection remains available',async()=>{
 const r=runtime(null);const result=await r.c.fetchTTSBuffer('Hello','browser-female');
 assert.equal(result.kind,'browser');assert.equal(result.fellBack,false);assert.equal(r.requests.length,0);
});
test('explicit browser selection speaks even with the TikTok provider off',async()=>{
 const r=runtime(null);r.window.enablePrimaryVoice=false;
 const result=await r.c.fetchTTSBuffer('Hello','browser-male');
 assert.equal(result.kind,'browser');assert.equal(result.voiceId,'browser-male');assert.equal(r.requests.length,0);
});
test('disabled primary with enabled fallback speaks the configured fallback voice',async()=>{
 const r=runtime(null);r.window.enablePrimaryVoice=false;r.window.ttsFallbackVoiceId='browser-male';
 const result=await r.c.fetchTTSBuffer('Hello, how are you today?','en_us_001');
 assert.equal(result.kind,'browser');assert.equal(result.voiceId,'browser-male');assert.equal(result.fellBack,false);assert.equal(r.requests.length,0);
});
test('disabled primary with enabled fallback lets ready Kokoro win',async()=>{
 const r=runtime(null);r.window.enablePrimaryVoice=false;r.window.enableKokoro=true;r.window.isKokoroReady=true;
 const local=[];r.window.generateKokoroAudioBuffer=async(text,id)=>{local.push(id);return{duration:0}};
 const result=await r.c.fetchTTSBuffer('Hello, how are you today?','en_us_001');
 assert.equal(result.provider,'kokoro');assert.deepEqual(local,['af_heart']);
});
test('disabled primary and disabled fallback stays silent',async()=>{
 const r=runtime(null);r.window.enablePrimaryVoice=false;r.window.enableFallbackVoice=false;
 assert.equal(await r.c.fetchTTSBuffer('Hello, how are you today?','en_us_001'),null);assert.equal(r.requests.length,0);
});

test('compatible Kokoro selection is preserved, but it does not speak Japanese',async()=>{
  const r=runtime(null);r.window.enableKokoro=true;r.window.isKokoroReady=true;
  const local=[];r.window.generateKokoroAudioBuffer=async(text,id)=>{local.push(id);return{duration:0}};
  const english=await r.c.fetchTTSBuffer('Hello, how are you today?','af_bella');assert.equal(english.provider,'kokoro');assert.deepEqual(local,['af_bella']);
  const japanese=await r.c.fetchTTSBuffer('こんにちは。','af_bella');assert.equal(japanese.provider,'tiktok');assert.equal(r.requests[0].voice,'jp_003');
});
test('muted speech and automatic routing off make no language requests',async()=>{
  const r=runtime(null);r.window.enableVoice=false;await r.c.playTTS('mysterious unfamiliar phrases','en-US');
  assert.equal(r.decisions.length,0);r.window.enableVoice=true;r.window.enableAutoTtsLang=false;
  r.c.playTTS('mysterious unfamiliar phrases','en-US');await until(()=>r.audio.length===1);
  assert.equal(r.decisions.length,0);assert.equal(r.requests[0].voice,'en_us_001');
});

for (const name of ['David', 'Unknown default']) test(`female browser fallback refuses ${name}`, async()=>{
 const r=runtime(null); r.c.speechSynthesis.getVoices=()=>[{name,lang:'en-US'}];
 assert.equal(r.c.selectBrowserVoice('browser-female').unsupported,true);
 let spoken=0;r.c.speechSynthesis.speak=()=>spoken++;
 await r.c.speakViaBrowser('Hello','browser-female');assert.equal(spoken,0);
});
test('empty browser inventory never uses an unspecified system voice',()=>{
 const r=runtime(null);r.c.speechSynthesis.getVoices=()=>[];
 assert.equal(r.c.selectBrowserVoice('browser-female').unsupported,true);
});

test('initial default and language-menu defaults reject male language defaults',()=>{
 const available=[{id:'fr_001',language:'fr-FR',gender:'male',provider:'tiktok'}, {id:'en_us_001',language:'en-US',gender:'female',provider:'tiktok'}];
 const languages=[{code:'fr-FR',defaultVoiceId:'fr_001'}];
 const window={};const c=vm.createContext({window,voices:available,languages,selectedLanguageCode:'fr-FR',selectedVoiceId:'',navigator:{language:'fr-FR'},
  AppStorage:{KEYS:{},getString:()=>'',setString(){}},debugLog(){},populateVoiceSelector(){},document:{getElementById:()=>null}});
 let source=fs.readFileSync(path.join(__dirname,'../scripts/app_init.js'),'utf8');
 const fn=source.slice(source.indexOf('function initVoice()'),source.indexOf('function initVoiceProviders()'));
 // Run just the default selection, before unrelated speech-input preferences.
 vm.runInContext(fn.slice(0,fn.indexOf('  populateVoiceSelector();'))+'}',c);
 c.initVoice();assert.equal(c.selectedVoiceId,'en_us_001');
 source=fs.readFileSync(path.join(__dirname,'../scripts/settings_ui.js'),'utf8');
 const helper=source.slice(source.indexOf('  function getDefaultVoiceForLanguage('),source.indexOf('  // Get the default voice for current language'));
 c.availableVoices=available;vm.runInContext(helper,c);assert.equal(c.getDefaultVoiceForLanguage('fr-FR'),'en_us_001');
});


test('finished emotion evidence reaches the request wrapper without prefix truncation', async () => {
  const r=runtime({});const text='Opening. '+'x'.repeat(2600)+' I am thrilled!';
  await r.c.upgradeEmotionFromDecision('Hello',text,()=>{});
  assert.equal(r.decisions[0].state.reply,text);
});


test('valid emotion winners apply even at zero confidence; missing, invalid and stale answers do not', async () => {
  for(const confidence of [0,.01,.39,.9]) {
    const r=runtime({live2d_emotion_v1:{choice_id:'sad',confidence}}),applied=[];
    await r.c.upgradeEmotionFromDecision('Hello','A mixed reply.',x=>applied.push(x));
    assert.deepEqual(applied,['sad']);
  }
  for(const [answer,valid] of [[null,true],[{live2d_emotion_v1:{choice_id:'invented',confidence:1}},true],[{live2d_emotion_v1:{choice_id:'sad',confidence:0}},false]]) {
    const r=runtime(answer),applied=[];
    await r.c.upgradeEmotionFromDecision('Hello','A reply.',x=>applied.push(x),null,()=>valid);
    assert.deepEqual(applied,[]);
  }
});
test('Stop during browser voice discovery cannot speak after voices arrive',async()=>{
 const r=runtime(null);let ready,spoken=0,valid=true;r.c.waitForBrowserVoices=()=>new Promise(resolve=>ready=resolve);
 r.c.speechSynthesis.speak=()=>spoken++;
 const pending=r.c.speakViaBrowser('Old reply','browser-female','en-US',()=>valid);
 valid=false;r.c.stopTTS();ready();await pending;assert.equal(spoken,0);
});
