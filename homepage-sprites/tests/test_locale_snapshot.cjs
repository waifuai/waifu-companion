const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function runtime(languages=['en-US'],saved=null){
 const box={navigator:{languages},localStorage:{getItem:()=>saved,setItem(){throw Error('blocked');}}};
 box.window=box;vm.createContext(box);
 vm.runInContext(fs.readFileSync(path.join(root,'i18n/i18n.js'),'utf8'),box);
 vm.runInContext(fs.readFileSync(path.join(root,'i18n/locales/en.js'),'utf8'),box);
 return box;
}
test('automatic, saved and manual choices report active dictionaries independently of reply language',async()=>{
 for(const saved of [null,'auto','ja']){
  const box=runtime(['ja-JP'],saved),api=box.WaifuI18n;
  api.init();assert.equal(api.snapshot().interface_locale,'unknown');
  assert.equal(api.snapshot().interface_locale_status,'dictionary_unavailable');
  vm.runInContext(fs.readFileSync(path.join(root,'i18n/locales/ja.js'),'utf8'),box);
  assert.equal(api.snapshot().interface_locale,'ja');
  assert.equal(api.snapshot().interface_locale_preference,saved==='ja'?'ja':'auto');
  await api.setLocale('en');assert.equal(api.snapshot().interface_locale,'en');
  await api.setLocale('de'); // unavailable dictionary retains English
  assert.equal(api.snapshot().interface_locale,'en');
  assert.equal(api.snapshot().interface_locale_preference,'de');
  assert.equal(api.snapshot().interface_locale_version,1);
 }
});
test('unsupported browser language resolves to the registered English fallback',()=>{
 const {WaifuI18n:api}=runtime(['xx-ZZ']);api.init();
 assert.equal(api.snapshot().interface_locale,'en');
 assert.equal(api.snapshot().interface_locale_preference,'auto');
});
