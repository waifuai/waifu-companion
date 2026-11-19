const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function runtime() {
  const requests=[], audio=[], events=[], decisions=[];
  const window={enableVoice:true,enableAutoTtsLang:true,enablePrimaryVoice:true,enableFallbackVoice:true,selectedVoiceId:'cloud',languages:[{code:'en-US'}],ChatManager:{getActiveChatId:()=> 'one'},onAIResponseSpeechFinished(){}};
  const c=vm.createContext({window,setTimeout,clearTimeout,setInterval,clearInterval,console,debugLog(){},debugError(){},debugState(){},
    document:{querySelectorAll:()=>[],getElementById:()=>null},highlightSentence(){},
    trackEvent:(name,data)=>events.push({name,data}),
    getTTSAudioContext:()=>({decodeAudioData:async()=>({duration:0})}),
    URL,URLSearchParams,AbortSignal,atob,
    fetch:async(url)=>{requests.push(String(url));throw new Error('no network expected');},
    conversationContext:[],speechSynthesis:{getVoices:()=>[{name:'English Female',lang:'en-US'}],cancel(){}},
  });
  window.speechSynthesis=c.speechSynthesis;
  for(const file of ['tiktok_tts.js','tts_language_router.js','voice_config.js','sentence_processor.js','audio_player.js','tts_queue_manager.js','ai_interface.js']) {
    let source=fs.readFileSync(path.join(__dirname,'../scripts',file),'utf8');
    if(file==='voice_config.js')source=source.slice(0,source.indexOf('];')+2);
    vm.runInContext(source,c);
    if(file==='voice_config.js')c.voices=window.voices;
  }
  c.playResolvedChunk=async (descriptor,label,valid,onStart)=>{if(descriptor){audio.push(descriptor);onStart?.(descriptor);}};
  // A local no-op shim stands in for legacy callers; it must never be used.
  window.WaifuProxyAPI={TTS_URL:'',async decide(...args){decisions.push(args);return null;}};
  return {c,window,requests,audio,events,decisions};
}
async function until(check) {for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('pipeline did not finish');}

test('browser voices serve every chunk with no network and no decision request',async()=>{
  const r=runtime();const text='Kimi no koe ga yasashikute kokoro ga atatakai. '.repeat(12);
  const plan=r.c.prepareTTSRouting(text);
  const routing=await r.c.getTTSRouting(text);
  assert.ok(plan.needsDecision);assert.ok(routing);
  r.c.playTTS(text,'en-US',null,0,null,true,routing);
  await until(()=>r.events.some(e=>e.name==='tts_played'));
  assert.equal(r.requests.length,0);assert.equal(r.decisions.length,0);
  assert.ok(r.audio.length>=1);assert.ok(r.audio.every(x=>x.kind==='browser'));
});
test('clear speech needs no decision and routes to the detected language locally',async()=>{
  const r=runtime();r.c.speechSynthesis.getVoices=()=>[{name:'French Female',lang:'fr-FR'}];
  const text='Hallo, ich bin hier und ich liebe dich.';
  const plan=r.c.prepareTTSRouting(text);assert.equal(plan.needsDecision,false);
  const resolved=await r.c.fetchTTSBuffer(text,'cloud',plan);
  assert.equal(resolved.kind,'browser');assert.equal(resolved.voiceId,'cloud');
  assert.equal(r.requests.length,0);assert.equal(r.decisions.length,0);
});
test('replaying the same uncertain reply reuses a stable local route',async()=>{
  const r=runtime();const text='Kimi no koe ga yasashikute kokoro ga atatakai.';
  const first=await r.c.getTTSRouting(text);const second=await r.c.getTTSRouting(text);
  assert.equal(first.lang,second.lang);assert.equal(r.decisions.length,0);assert.equal(r.requests.length,0);
});
test('a saved cloud id resolves to a browser voice without any request',async()=>{
  const r=runtime();r.c.speechSynthesis.getVoices=()=>[{name:'Arabic Female',lang:'ar-SA'}];
  const result=await r.c.fetchTTSBuffer('مرحبا كيف حالك اليوم؟','cloud');
  assert.equal(result.kind,'browser');assert.equal(r.requests.length,0);
});
test('a saved cloud:<id> choice falls back to a browser voice',async()=>{
  const r=runtime();
  const result=await r.c.fetchTTSBuffer('Hola, gracias por estar aquí.','cloud:nanami');
  assert.equal(result.kind,'browser');assert.equal(r.requests.length,0);
});
test('no cloud failure paths remain: speech is resolved locally',async()=>{
  const r=runtime();
  const result=await r.c.fetchTTSBuffer('Hello, how are you today?','cloud');
  assert.equal(result.kind,'browser');assert.equal(r.requests.length,0);
});
test('explicit browser selection remains available',async()=>{
  const r=runtime();const result=await r.c.fetchTTSBuffer('Hello','browser-female');
  assert.equal(result.kind,'browser');assert.equal(result.fellBack,false);assert.equal(r.requests.length,0);
});
test('explicit browser selection speaks even with the cloud voice off',async()=>{
  const r=runtime();r.window.enablePrimaryVoice=false;
  const result=await r.c.fetchTTSBuffer('Hello','browser-male');
  assert.equal(result.kind,'browser');assert.equal(result.voiceId,'browser-male');assert.equal(r.requests.length,0);
});
test('disabled primary with enabled fallback speaks the configured fallback voice',async()=>{
  const r=runtime();r.window.enablePrimaryVoice=false;r.window.ttsFallbackVoiceId='browser-male';
  const result=await r.c.fetchTTSBuffer('Hello, how are you today?','cloud');
  assert.equal(result.kind,'browser');assert.equal(result.voiceId,'browser-male');assert.equal(result.fellBack,true);assert.equal(r.requests.length,0);
});
test('a ready local Kokoro voice wins for its selection',async()=>{
  const r=runtime();r.window.enableKokoro=true;r.window.isKokoroReady=true;
  const local=[];r.window.generateKokoroAudioBuffer=async(text,id)=>{local.push(id);return{duration:0}};
  const result=await r.c.fetchTTSBuffer('Hello, how are you today?','af_bella');
  assert.equal(result.provider,'kokoro');assert.deepEqual(local,['af_bella']);assert.equal(r.requests.length,0);
});
test('disabled primary and disabled fallback stays silent',async()=>{
  const r=runtime();r.window.enablePrimaryVoice=false;r.window.enableFallbackVoice=false;
  assert.equal(await r.c.fetchTTSBuffer('Hello, how are you today?','cloud'),null);assert.equal(r.requests.length,0);
});
test('Kokoro selection cannot speak Japanese locally but can hand off to a browser voice',async()=>{
  const r=runtime();r.window.enableKokoro=true;r.window.isKokoroReady=true;
  let generated=0;r.window.generateKokoroAudioBuffer=async()=>{generated++;return{duration:0}};
  const japanese=await r.c.fetchTTSBuffer('こんにちは。','af_bella');
  assert.equal(generated,0);assert.equal(japanese.kind,'browser');assert.equal(r.requests.length,0);
});
test('muted speech and automatic routing off make no requests',async()=>{
  const r=runtime();r.window.enableVoice=false;await r.c.playTTS('mysterious unfamiliar phrases','en-US');
  assert.equal(r.decisions.length,0);r.window.enableVoice=true;r.window.enableAutoTtsLang=false;
  r.c.playTTS('mysterious unfamiliar phrases','en-US');await until(()=>r.audio.length===1);
  assert.equal(r.decisions.length,0);assert.equal(r.requests.length,0);
});
test('durable playback counts audio start even when interrupted and analytics is unavailable',async()=>{
  const r=runtime(),emitted=[];r.window.reportVoiceEvent=(event,info)=>emitted.push({event,info});
  r.c.trackEvent=undefined;
  r.c.playResolvedChunk=async(descriptor,label,valid,onStart)=>{onStart(descriptor);await new Promise(()=>{});};
  r.c.playTTS('Hola, gracias por estar aquí conmigo.','en-US');
  await until(()=>emitted.some(e=>e.event==='tts_played'));r.c.stopTTS();
  assert.equal(emitted.filter(e=>e.event==='tts_played').length,1);
  assert.equal(emitted.filter(e=>e.event==='tts_chunk_played').length,1);
  assert.equal(r.requests.length,0);
});
test('None suppresses automatic playback, preloads and requests',async()=>{
  const r=runtime();r.window.selectedVoiceId='none';let finished=0;r.window.onAIResponseSpeechFinished=()=>finished++;
  assert.equal(r.c.prepareTTSRouting('mysterious unfamiliar phrases').needsDecision,false);
  assert.equal(await r.c.fetchTTSBuffer('Hello','none'),null);
  await r.c.playTTS('mysterious unfamiliar phrases','en-US',null,0,null,true);
  assert.equal(finished,1);assert.equal(r.requests.length,0);assert.equal(r.decisions.length,0);assert.equal(r.audio.length,0);
});
for (const name of ['David', 'Unknown default']) test(`female browser fallback refuses ${name}`, async()=>{
 const r=runtime(); r.c.speechSynthesis.getVoices=()=>[{name,lang:'en-US'}];
 assert.equal(r.c.selectBrowserVoice('browser-female').unsupported,true);
 let spoken=0;r.c.speechSynthesis.speak=()=>spoken++;
 await r.c.speakViaBrowser('Hello','browser-female');assert.equal(spoken,0);
});
test('empty browser inventory never uses an unspecified system voice',()=>{
 const r=runtime();r.c.speechSynthesis.getVoices=()=>[];
 assert.equal(r.c.selectBrowserVoice('browser-female').unsupported,true);
});
test('initial default and language-menu defaults select the TikTok voice',()=>{
 const available=[{id:'en_us_001',language:'en-US',gender:'female',provider:'tiktok'},{id:'cloud',language:'en-US',gender:'female',provider:'browser'}];
 const languages=[{code:'fr-FR'}];
 const window={};const c=vm.createContext({window,voices:available,languages,selectedLanguageCode:'fr-FR',selectedVoiceId:'',navigator:{language:'fr-FR'},
  AppStorage:{KEYS:{},getString:()=>'',setString(){}},debugLog(){},populateVoiceSelector(){},document:{getElementById:()=>null}});
 let source=fs.readFileSync(path.join(__dirname,'../scripts/app_init.js'),'utf8');
 const fn=source.slice(source.indexOf('function initVoice()'),source.indexOf('function initVoiceProviders()'));
 vm.runInContext(fn.slice(0,fn.indexOf('  populateVoiceSelector();'))+'}',c);
 c.initVoice();assert.equal(c.selectedVoiceId,'en_us_001');
 source=fs.readFileSync(path.join(__dirname,'../scripts/settings_ui.js'),'utf8');
 const helper=source.slice(source.indexOf('  function getDefaultVoiceForLanguage('),source.indexOf('  // Get the default voice for current language'));
 c.availableVoices=available;vm.runInContext(helper,c);assert.equal(c.getDefaultVoiceForLanguage('fr-FR'),'en_us_001');
});
test('Stop during browser voice discovery cannot speak after voices arrive',async()=>{
 const r=runtime();let ready,spoken=0,valid=true;r.c.waitForBrowserVoices=()=>new Promise(resolve=>ready=resolve);
 r.c.speechSynthesis.speak=()=>spoken++;
 const pending=r.c.speakViaBrowser('Old reply','browser-female','en-US',()=>valid);
 valid=false;r.c.stopTTS();ready();await pending;assert.equal(spoken,0);
});
test('TikTok voices are present with the historical default id',()=>{
 const r=runtime();
 const tiktok=r.window.voices.filter(v=>v.provider==='tiktok');
 assert.equal(tiktok.length,50);
 assert.equal(r.window.voices.find(v=>v.id==='en_us_001').provider,'tiktok');
 const state=fs.readFileSync(path.join(__dirname,'../scripts/global_state.js'),'utf8');
 assert.match(state,/AppState\.selectedVoiceId\s*=\s*'en_us_001'/);
});
test('an explicitly chosen TikTok voice fetches audio from the external service',async()=>{
 const r=runtime();const text='Hello, how are you today?';
 let called=0;
 r.c.fetch=async(url,opts)=>{
  called++;assert.equal(String(url),r.window.TikTokTTS.API_URL);
  assert.deepEqual(JSON.parse(opts.body),{text,voice:'en_us_001'});
  return {ok:true,status:200,text:async()=>'{"success":true,"data":"AAAA"}'};
 };
 const result=await r.c.fetchTTSBuffer(text,'en_us_001');
 assert.equal(called,1);assert.equal(result.kind,'buffer');assert.equal(result.provider,'tiktok');assert.equal(result.voiceId,'en_us_001');
});
test('a failed TikTok request hands off to the browser fallback voice',async()=>{
 const r=runtime();r.window.ttsFallbackVoiceId='browser-female';
 r.c.fetch=async()=>({ok:false,status:503});
 const result=await r.c.fetchTTSBuffer('Hello, how are you today?','en_us_001');
 assert.equal(result.kind,'browser');assert.equal(result.provider,'browser');assert.equal(result.fellBack,true);
});
test('a disabled primary voice never contacts the TikTok service',async()=>{
 const r=runtime();r.window.enablePrimaryVoice=false;r.window.ttsFallbackVoiceId='browser-male';
 const result=await r.c.fetchTTSBuffer('Hello, how are you today?','en_us_001');
 assert.equal(result.kind,'browser');assert.equal(result.voiceId,'browser-male');assert.equal(r.requests.length,0);
});
