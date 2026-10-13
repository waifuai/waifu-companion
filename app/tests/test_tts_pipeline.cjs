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
  const r=runtime({live2d_emotion_v1:{choice_id:'happy',confidence:.9},live2d_tts_language_v1:{choice_id:'ja-JP',confidence:.9}});
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
  const r=runtime(()=>new Promise(()=>{}));const text='Bonjour, je suis contente de te voir.';
  const plan=r.c.prepareTTSRouting(text);assert.equal(plan.needsDecision,false);
  const answers=r.c.upgradeEmotionFromDecision('Bonjour',text,()=>{},plan);
  r.c.playTTS(text,'en-US',null,0,null,true,r.c.finishTTSRouting(plan,answers));
  await until(()=>r.audio.length===1);
  assert.deepEqual(r.decisions[0].tasks,['live2d_emotion_v1']);assert.equal(r.requests[0].voice,'fr_001');
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
  r.c.playTTS('Hola, gracias!','en-US');await until(()=>r.audio.length===1);
  deliver({live2d_tts_language_v1:{choice_id:'ja-JP',confidence:1}});await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(r.audio.length,1);assert.equal(r.requests[0].voice,'es_002');
});
test('stop during audio preparation never starts the fetched audio',async()=>{
  let finish;const fetched=new Promise(resolve=>finish=resolve);const r=runtime(null);
  r.c.fetch=()=>fetched;r.c.playTTS('Hola, gracias!','en-US');await new Promise(resolve=>setTimeout(resolve,5));
  r.c.stopTTS();finish({ok:true,status:200,json:async()=>({data:'AA=='})});await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(r.audio.length,0);
});
test('available Arabic browser speech bypasses the English primary; unavailable speech retains preference',async()=>{
  const r=runtime(null);r.c.speechSynthesis.getVoices=()=>[{name:'Arabic Female',lang:'ar-SA'}];
  const available=await r.c.fetchTTSBuffer('مرحبا كيف حالك اليوم؟','en_us_001');
  assert.equal(available.provider,'browser');assert.equal(available.lang,'ar-SA');assert.equal(r.requests.length,0);
  r.c.speechSynthesis.getVoices=()=>[{name:'English Female',lang:'en-US'}];
  const fallback=await r.c.fetchTTSBuffer('مرحبا كيف حالك اليوم؟','en_us_001');
  assert.equal(fallback.lang,'en-US');assert.equal(fallback.unsupported,true);assert.equal(r.requests[0].voice,'en_us_001');
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
