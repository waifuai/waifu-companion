const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = async () => { for(let i=0;i<20;i++) await Promise.resolve(); };
function client({streaming=true}={}) {
  const elements = new Map(), timers = new Map(), requests = [], events = [], saves = [], effects = [];
  let seq=0, timer=0, chat='chat-a';
  function element(id) {
    const e = { id, dataset:{}, style:{}, children:[], isConnected:true, textContent:'',
      classList:{add(){},remove(){},toggle(){}}, setAttribute(){}, querySelector(){return null;}, querySelectorAll(){return [];},
      appendChild(child){this.children.push(child);return child;}, remove(){this.isConnected=false;}, replaceChildren(){this.children=[];} };
    if(id) elements.set(id,e); return e;
  }
  element('sendMessageBtn');
  const ctx = vm.createContext({ console, AbortController, TextDecoder, TextEncoder, Date, Error, TypeError,
    setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,ms});return id;}, clearTimeout(id){timers.delete(id);},
    document:{getElementById:id=>elements.get(id)||null, createElement:()=>element(), querySelectorAll:()=>[]},
    messageInput:{value:''}, conversationContext:[], userMessageQueue:[], isUserMessageQueueEnabled:true,
    isProcessing:false,isAIResponding:false,selectedLanguageCode:'en-US',showTransliteration:false,currentModel:null,
    messageCountSinceLastSummary:0,maxMemorySize:30,languages:[{code:'en-US',defaultVoiceId:'en_us_001'}],
    debugLog(){}, debugState(){}, debugError(){}, showTypingIndicator(){}, updateQueueUI(){}, trackEvent:(...e)=>events.push(e),
    AppStorage:{KEYS:{CONVERSATION_CONTEXT:'context'},setJSON(k,v){saves.push(JSON.parse(JSON.stringify(v)));},setNumber(){},setString(){}},
    ChatManager:{getActiveChatId:()=>chat,saveCurrentChat(){},getChatMeta:()=>null},
    nextMessageId:()=>`m-${++seq}`,
    addMessage(text){const e=element(`m-${++seq}`);e.textContent=text;return e.id;},
    createStreamingMessage(){return {messageDiv:element(`m-${++seq}`)};},
    updateStreamingMessage(s,t){s.messageDiv.textContent=t;},
    finalizeStreamingMessage(s,t){s.messageDiv.textContent=t;return s.messageDiv.id;},
    resolveLLMProvider:()=>streaming?{}:null,
    getAIResponse(message,lang,options){const d=deferred();requests.push({message,lang,options,...d});return d.promise;},
    getImageDecision:()=>null, playTTS:()=>effects.push('speech'), stopTTS:()=>effects.push('stop'),cancelVoiceInput:()=>effects.push('cancel'),
    ConversationBudget:require('../scripts/context_budget.js')
  });
  ctx.window=ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/ai_interface.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/chat_controller.js'),'utf8'),ctx);
  ctx.getAIResponse=(message,lang,options)=>{const d=deferred();requests.push({message,lang,options,...d});return d.promise;};
  ctx.getImageDecision=()=>null;ctx.updateSummaryMarker=()=>{};ctx.maybeSummarizeConversation=async()=>{};
  return {ctx,requests,effects,events,elements,timers,saves,replace:()=>{ctx.resetConversationRuntime();chat='chat-b';ctx.conversationContext=[];},
    send(text){ctx.messageInput.value=text;return ctx.sendMessage();},
    clock(ms){for(const [id,t] of [...timers]) if(t.ms<=ms){timers.delete(id);t.fn();}}};
}
for(const streaming of [true,false]) {
 test(`owner is synchronous and Stop before headers discards late ${streaming?'streaming':'plain'} completion`,async()=>{
   const c=client({streaming});const running=c.send('hello');const owner=c.ctx.getActiveTurn();
   assert.ok(owner);assert.equal(c.ctx.conversationContext.filter(m=>m.role==='user').length,1);
   c.ctx.stopActiveTurn();await running;
   c.requests[0].resolve({reply:'late',emotion:'happy'});await tick();
   assert.equal(c.ctx.conversationContext.at(-1).attemptStatus,'stopped');assert.equal(c.ctx.conversationContext.at(-1).content,'');
   assert.ok(c.requests[0].options.signal.aborted);assert.ok(!c.effects.includes('speech'));
 });
}
test('whitespace-normalized duplicates do not queue; an intentional repeat after completion is accepted',async()=>{
 const c=client();const first=c.send('hello  world');await c.send('hello world');assert.equal(c.requests.length,1);assert.equal(c.ctx.userMessageQueue.length,0);
 c.requests[0].resolve({reply:'answer'});await first;const second=c.send('hello world');assert.equal(c.requests.length,2);
 c.requests[1].resolve({reply:'again'});await second;assert.equal(c.ctx.conversationContext.filter(m=>m.role==='user').length,2);
});
test('Stop preserves partial text, pauses distinct queued text and Retry reuses the user',async()=>{
 const c=client();const first=c.send('hello');c.requests[0].options.onChunk('Partial answer');await c.send('next message');await c.send('next   message');
 assert.deepEqual([...c.ctx.userMessageQueue],['next message']);c.ctx.stopActiveTurn();await first;
 const partial=c.ctx.conversationContext.at(-1);assert.equal(partial.content,'Partial answer');assert.equal(partial.attemptStatus,'stopped');assert.equal(c.requests.length,1);
 const retry=c.ctx.retryTurn(partial);assert.equal(c.requests.length,2);assert.equal(c.ctx.conversationContext.filter(m=>m.role==='user').length,1);
 assert.ok(!c.ctx.contextForModel(c.ctx.conversationContext).some(m=>m.content==='Partial answer'));
 assert.notEqual(c.requests[0].options.signal,c.requests[1].options.signal);
 c.ctx.stopActiveTurn();await retry;
});
test('late old cleanup and stream chunks cannot release or overwrite a newer send',async()=>{
 const c=client();const old=c.send('first');c.ctx.stopActiveTurn();const fresh=c.send('second');
 c.requests[0].options.onChunk('stale chunk');c.requests[0].resolve({reply:'old'});await old;await tick();
 assert.equal(c.ctx.isProcessing,true);assert.equal(c.ctx.getActiveTurn().user.content,'second');assert.equal(c.ctx.conversationContext.at(-1).content,'');
 c.requests[1].resolve({reply:'new'});await fresh;assert.equal(c.ctx.conversationContext.at(-1).content,'new');
});
test('conversation replacement rejects delayed callbacks and does not save into the new chat',async()=>{
 const c=client();const running=c.send('first');c.replace();c.requests[0].options.onChunk('stale');c.requests[0].resolve({reply:'stale'});await running;
 assert.equal(c.ctx.conversationContext.length,0);assert.equal(c.ctx.isProcessing,false);
});
test('8/20 second status is owned, cleared by usable text, and deadline remains Failed',async()=>{
 const c=client();const running=c.send('waiting');const owner=c.ctx.getActiveTurn();c.clock(8000);assert.equal(owner.waitElement.dataset.i18n,'chat.stillWorking');
 c.clock(20000);assert.equal(owner.waitElement.dataset.i18n,'chat.longWait');c.requests[0].options.onChunk('usable text');assert.equal(owner.waitElement,null);
 assert.ok([...c.timers.values()].some(t=>t.ms===90000));c.clock(90000);await running;
 assert.equal(c.ctx.conversationContext.at(-1).attemptStatus,'failed');assert.equal(c.ctx.userQueuePaused,true);
});
test('latest failed Retry is disabled after a later turn or deletion',async()=>{
 const c=client();const first=c.send('one');c.requests[0].reject(new Error('offline'));await first;
 const failed=c.ctx.conversationContext.at(-1);assert.ok(c.ctx.canRetryTurn(failed));
 const later=c.send('two');assert.equal(c.ctx.canRetryTurn(failed),false);c.ctx.stopActiveTurn();await later;
 c.ctx.conversationContext=[];assert.equal(c.ctx.canRetryTurn(failed),false);
});
test('recovering saved pending text/images does not issue requests and uses truthful context',()=>{
 const c=client();const messages=[{role:'assistant',content:'partial',attemptStatus:'pending'},
 {role:'assistant',content:'',imageOperation:{generation:'pending',display:'unknown',prompt:'room'}},
 {role:'assistant',content:'[generated an image: beach]',imageUrl:'https://example/image'}];
 c.ctx.recoverSavedTurns(messages);assert.equal(messages[0].attemptStatus,'interrupted');assert.equal(messages[1].imageOperation.generation,'interrupted');assert.equal(c.requests.length,0);
 const context=c.ctx.contextForModel(messages);assert.ok(!context.some(m=>m.content==='partial'));assert.match(context[0].content,/generation interrupted/);assert.match(context[1].content,/display unknown/);assert.doesNotMatch(JSON.stringify(context),/sent a picture/);
});
test('stopped picture decision cannot fall through to the writer',async()=>{
 const c=client();const d=deferred();let writers=0;
 c.ctx.WaifuProxyAPI={generateImage(){},decide:()=>d.promise};c.ctx.callConfiguredLLM=()=>{writers++;return {content:'DRAW: A cozy room.'};};
 const controller=new AbortController();const pending=c.ctx.getImageDecision('send a selfie',{signal:controller.signal});controller.abort();d.resolve(null);
 assert.equal(await pending,null);assert.equal(writers,0);
});
test('context preparation canceled before transport cannot dispatch a request',async()=>{
 const c=client();const d=deferred();let transports=0;c.ctx.performLLMRequest=()=>{};c.ctx.buildContextInfo=()=>d.promise;c.ctx.resolveLLMProvider=()=>({api:{createCompletionStream(){transports++;}}});
 const controller=new AbortController();const pending=c.ctx.getAIResponseStream('hello','en-US',{signal:controller.signal});await tick();controller.abort();d.resolve([]);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(transports,0);
});
test('canceled emotion decision cannot change the avatar',async()=>{
 const c=client();const d=deferred();let applied=0;c.ctx.WaifuProxyAPI={decide:()=>d.promise};const controller=new AbortController();let valid=true;
 const pending=c.ctx.upgradeEmotionFromDecision('hello','reply',()=>applied++,null,()=>valid,{signal:controller.signal});valid=false;controller.abort();d.resolve({live2d_emotion_v1:{choice_id:'happy'}});await pending;assert.equal(applied,0);
});
for (const job of ['picture','transliteration','summary','background']) test(`replacement discards a delayed ${job} result`,async()=>{
 const c=client();const old=c.send('first');c.requests[0].resolve({reply:'first reply'});await old;
 const owner=c.ctx.getActiveTurn();const d=deferred();let result;
 if(job==='picture') {c.ctx.WaifuProxyAPI={generateImage(){},decide:()=>d.promise};c.ctx.callConfiguredLLM=async()=>({content:'DRAW: A cozy room with warm light.'});result=c.ctx.getImageDecision('send me a picture',c.ctx.turnOptions(owner));}
 if(job==='transliteration') {c.ctx.resolveLLMProvider=()=>({});c.ctx.callConfiguredLLM=()=>d.promise;result=c.ctx.getTransliteration('こんにちは','ja-JP',c.ctx.turnOptions(owner));}
 if(job==='summary') {c.ctx.summaryTriggerCount=1;c.ctx.conversationSummary='';c.ctx.summaryProgress=null;c.ctx.clampMemorySetting=()=>1;c.ctx.requestMemorySummary=()=>d.promise;result=c.ctx.maybeSummarizeConversation(true,owner);}
 if(job==='background') {c.ctx.AppStorage.getString=(_k,f)=>f;c.ctx.document.addEventListener=()=>{};vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/settings_handlers.js'),'utf8'),c.ctx);c.ctx.callConfiguredLLM=()=>d.promise;result=c.ctx.getBackgroundScene(true,c.ctx.turnOptions(owner));}
 await tick();c.replace();d.resolve(job==='summary'?'stale summary':job==='background'?{content:'SCENE: A sunny quiet beach'}:job==='transliteration'?{content:'konnichiwa'}:{picture_action_v1:{choice_id:'draw'}});
 await Promise.resolve(result).catch(()=>{});assert.equal(c.ctx.conversationContext.length,0);assert.notEqual(c.ctx.conversationSummary,'stale summary');
 if(job==='picture'||job==='transliteration') assert.equal(await result,null);
});
test('a canceled blob commit is removed rather than kept as an orphan',async()=>{
 const transactions=[];let deleted=0,created=0;
 const db={transaction(){const tx={objectStore:()=>({put(){},delete(){deleted++;}})};transactions.push(tx);return tx;}};
 const c=vm.createContext({window:{},indexedDB:{open(){const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}},Blob,URL:{createObjectURL(){created++;return 'blob:test';},revokeObjectURL(){}},queueMicrotask});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/image_store.js'),'utf8'),c);
 const controller=new AbortController();const pending=c.window.ImageStore.put('one',new Blob(['bytes']),{signal:controller.signal});await tick();assert.equal(transactions.length,1);
 controller.abort();transactions[0].oncomplete();await tick();assert.equal(transactions.length,2);transactions[1].oncomplete();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(deleted,1);assert.equal(created,0);
});
test('transcription body completing after cancellation cannot append to replacement input',async()=>{
 let audio;const done=deferred(),listeners={};let capturedSignal;
 const input={value:'',placeholder:'Type'};
 const button={style:{setProperty(){}},dataset:{},classList:{toggle(){}},setAttribute(){},addEventListener:(k,fn)=>listeners[k]=fn};
 const c=vm.createContext({AbortController,window:{sttEngine:'proxy',messageInput:input,MediaRecorder:function(){},MicCapture:{create:options=>{audio=options.onAudio;return {start(){},cancel(){},state:'idle'};}},WaifuProxyAPI:{transcribeAudio(_blob,opts){capturedSignal=opts.signal;return done.promise;}}},
 navigator:{mediaDevices:{getUserMedia(){}}},document:{getElementById:id=>id==='micBtn'?button:null,querySelectorAll:()=>[]},debugLog(){},debugError(){},addMessage(){throw Error('stale error');}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/stt_controller.js'),'utf8'),c);
 c.window.initSTT();listeners.click({detail:0});const pending=audio(new Blob(['audio']));c.window.cancelVoiceInput();input.value='new chat text';done.resolve({text:'stale transcript'});await pending;
 assert.ok(capturedSignal.aborted);assert.equal(input.value,'new chat text');
});
test('OpenRouter cancellation never starts its configured fallback',async()=>{
 let requests=0;const controller=new AbortController();
 const c=vm.createContext({window:{},MODEL_PRIORITY:['first'],tr:(_key,fallback)=>fallback,requireConfigured(){},performLLMRequest:async options=>{requests++;assert.equal(options.signal,controller.signal);controller.abort();const e=new Error('canceled');e.name='AbortError';throw e;},debugLog(){},AppStorage:{KEYS:{},getString:()=> 'key',getBoolean:()=>true}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/openrouter.js'),'utf8'),c);
 const api=c.window.OpenRouterAPI;api.getApiKey=()=> 'key';api.getCandidateModels=()=>['first','fallback'];
 await assert.rejects(api.createCompletion({messages:[],signal:controller.signal}),{name:'AbortError'});assert.equal(requests,1);
});
test('title response cannot rename a chat after a replacement or a newer turn',async()=>{
 const d=deferred(),writes=[],store=new Map();let current='one';
 store.set('chatIndex',[{id:'one',name:'New Chat'}]);store.set('chatData_one',{conversationContext:[{role:'user',content:'hello'}]});store.set('activeChatId','one');
 const c=vm.createContext({window:{conversationMemoryRevision:1},document:{body:{dataset:{}},addEventListener(){}},AppStorage:{getJSON:(k,f)=>store.get(k)||f,getItem:k=>store.get(k),setJSON:(k,v)=>writes.push([k,v]),setItem(){},removeItem(){}},
 resolveLLMProvider:()=>({api:{createCompletion:()=>d.promise}}),debugLog(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/chat_manager.js'),'utf8'),c);
 const pending=c.window.ChatManager.generateChatTitle('one',true);c.window.conversationMemoryRevision++;d.resolve({content:'Stale title'});await pending;
 assert.equal(writes.length,0);
});
test('stream canceled after headers cancels its reader and emits no successful terminal event',async()=>{
 const c=client();const reading=deferred();let canceled=0;const controller=new AbortController();
 c.ctx.performLLMRequest=()=>{};c.ctx.buildChatMessages=async()=>[];
 c.ctx.resolveLLMProvider=()=>({name:'mock',model:'mock',api:{createCompletionStream:async()=>({stream:{getReader:()=>({read:()=>reading.promise,cancel:()=>{canceled++;return Promise.resolve();}})}})}});
 const pending=c.ctx.getAIResponseStream('hello','en-US',{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});
 reading.resolve({done:false,value:new TextEncoder().encode('data: late\n\n')});await tick();assert.ok(canceled>0);
 assert.ok(!c.events.some(e=>e[0]==='llm_stream_completed'));
});
test('premature stream close preserves partial as Failed rather than completing it',async()=>{
 const c=client();const running=c.send('hello');c.requests[0].options.onChunk('saved partial');c.requests[0].resolve({isError:true,reply:'Connection problem'});await running;
 assert.equal(c.ctx.conversationContext.at(-1).content,'saved partial');assert.equal(c.ctx.conversationContext.at(-1).attemptStatus,'failed');
 assert.ok(!c.ctx.contextForModel(c.ctx.conversationContext).some(m=>m.content==='saved partial'));
});
