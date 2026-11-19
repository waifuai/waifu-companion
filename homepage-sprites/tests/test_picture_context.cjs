const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function client() {
  let requests=0;
  const context=vm.createContext({ Chat:{ askDecisions:async()=>{ throw Error('decision API removed'); } },
    async fetch(){ requests++; throw Error('unexpected request'); } });
  vm.runInContext(readFileSync(__dirname+'/../pictures.js','utf8')+'\nthis.pictures = Pictures;',context);
  return { pictures:context.pictures, requests:()=>requests };
}

test('picture decisions are local no-ops even when a caller offers cloud answers', async () => {
  const { pictures, requests } = client();
  assert.equal(await pictures.decide('Yes please','Want a picture?',{},{}),null);
  assert.equal(await pictures.decide('draw yourself','',{},{}),null);
  assert.equal(requests(),0);
});

test('cancelled picture work never reaches a writer', async () => {
  const { pictures, requests } = client();
  const controller=new AbortController();controller.abort();
  await assert.rejects(pictures.decide('draw','',{}, {signal:controller.signal}),{name:'AbortError'});
  assert.equal(requests(),0);
});
