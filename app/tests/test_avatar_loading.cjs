const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function fixture() {
  const elements = new Map();
  function element() { return { hidden:false, style:{}, dataset:{}, options:[], textContent:'', setAttribute(){}, addEventListener(){}, contains(){return false;}, focus(){}, replaceChildren(...children){this.options=children;}, querySelector(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);} }; }
  const document={createElement:element,body:{appendChild(){}},getElementById(){return null;}};
  const stored=new Map([['selectedModelUrl','good']]);
  const loads=[]; const timers=new Map(); let timerId=0;
  class Model {
    constructor(){this.scale={set(){}};this.position={set(){}};this.anchor={set(){}};this.visible=this.renderable=true;this.alpha=1;this.events=[];this.textures=[];}
    emit(name){this.events.push(name);}
    getBounds(){return {x:20,y:20,width:100,height:100};}
    destroy(){this.destroyed=true;this.autoUpdate=false;this.internalModel?.destroy();}
  }
  class BaseTexture { constructor(){this.pending=deferred();this.resource={load:()=>this.pending.promise};} }
  class Texture { constructor(base){this.baseTexture=base;} destroy(){this.destroyed=true;this.baseTexture.destroyed=true;} }
  const essentials=()=>{};
  const factory={setupEssentials:essentials,live2DModelMiddlewares:[essentials],setupLive2DModel(model,url,options){const job=deferred();loads.push({...job,model,url,options});return job.promise;}};
  const children=[];
  const c={document,Option:function(text,value){this.textContent=text;this.value=value;},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),DOMException,PIXI:{BaseTexture,Texture,live2d:{Live2DModel:Model,Live2DFactory:factory}},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},setInterval(){},
    innerWidth:800,innerHeight:600,currentModel:null,currentModelUrl:null,availableModels:[{url:'good',name:'Good'}],
    debugError(){},AppStorage:{KEYS:{SELECTED_MODEL_URL:'selectedModelUrl'},getString:(k,f)=>stored.get(k)||f,setString:(k,v)=>stored.set(k,v)},
    app:{screen:{width:800,height:600},view:{style:{},getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})},stage:{children,visible:true,renderable:true,alpha:1,addChild(m){children.push(m);},removeChild(m){children.splice(children.indexOf(m),1);}}}};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/live2d_manager.js'),'utf8'),c);
  return {c,stored,loads,timers,factory,Model};
}
test('empty selection starts no load and does not overwrite the saved preference',async()=>{
 const {c,loads,stored}=fixture();assert.equal(await c.loadModel(''),null);assert.equal(loads.length,0);assert.equal(c.AvatarRecovery.state.kind,'empty');assert.equal(stored.get('selectedModelUrl'),'good');
});
test('failure disposes partial resources and retains the previous working avatar and saved URL',async()=>{
 const {c,loads,stored,Model}=fixture();const old=c.currentModel=new Model();
 const p=c.loadModel('bad');const texture={destroy(){this.destroyed=true;}};loads[0].options.avatarAttempt.textures.push(texture);
 loads[0].reject(new Error('404'));await assert.rejects(p,/404/);
 assert.equal(c.currentModel,old);assert.equal(old.destroyed,undefined);assert.equal(stored.get('selectedModelUrl'),'good');assert.equal(texture.destroyed,true);assert.equal(loads[0].model.destroyed,true);assert.equal(c.AvatarRecovery.state.kind,'failed');
});
test('only the latest successful attempt may replace the avatar or commit selection',async()=>{
 const {c,loads,stored,timers}=fixture();const a=c.loadModel('a');const b=c.loadModel('b');
 loads[1].resolve();assert.equal(await b,loads[1].model);loads[0].resolve();assert.equal(await a,null);
 assert.equal(c.currentModel,loads[1].model);assert.equal(stored.get('selectedModelUrl'),'b');assert.equal(loads[0].model.destroyed,true);assert.equal(timers.size,0);
});
test('deadline fails once, disposes the attempt and ignores eventual completion; retry succeeds',async()=>{
 const {c,loads,timers,stored}=fixture();const a=c.loadModel('slow');[...timers.values()][0]();await assert.rejects(a,/timed out/);
 assert.equal(c.AvatarRecovery.state.kind,'stalled');assert.equal(loads.length,1);assert.equal(loads[0].model.destroyed,true);assert.equal(stored.get('selectedModelUrl'),'good');
 loads[0].resolve();await Promise.resolve();assert.equal(c.currentModel,null);
 const retry=c.loadModel('slow');loads[1].resolve();await retry;assert.equal(stored.get('selectedModelUrl'),'slow');
});
test('clear cancels in-flight loads without forgetting the saved choice',async()=>{
 const {c,loads,stored}=fixture();const p=c.loadModel('a');c.clearAllModels();loads[0].resolve();assert.equal(await p,null);assert.equal(c.currentModel,null);assert.equal(stored.get('selectedModelUrl'),'good');
});
test('partial texture failure releases every owned texture',async()=>{
 const {c,factory}=fixture();let owner;
 factory.setupLive2DModel=(model,url,options)=>{
   owner=options.avatarAttempt;
   return factory.live2DModelMiddlewares[0]({options,settings:{textures:['one','two'],resolveURL:p=>p},internalModel:{destroy(){}}},async()=>{});
 };
 const p=c.loadModel('broken');
 owner.textures[0].baseTexture.pending.resolve();owner.textures[1].baseTexture.pending.reject(new Error('texture failed'));
 await assert.rejects(p,/texture failed/);
 assert.ok(owner.textures.every(t=>t.destroyed));assert.equal(owner.model.destroyed,true);
});
test('late moc completion after cancellation disposes its internal model',async()=>{
 const {c,factory}=fixture();const wait=deferred();let destroyed=false;
 const owner={cancelled:false,textures:[],model:new c.PIXI.live2d.Live2DModel()};
 const q=factory.live2DModelMiddlewares[0]({options:{avatarAttempt:owner},settings:{textures:[],resolveURL:p=>p},internalModel:{destroy(){destroyed=true;}}},()=>wait.promise);
 owner.cancelled=true;wait.resolve();await assert.rejects(q,{name:'AbortError'});assert.equal(destroyed,true);
});
