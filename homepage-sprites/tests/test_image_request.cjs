const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function client(responses) {
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    async fetch(url, options) {
      calls.push({ url: new URL(url), options });
      const response = responses[calls.length - 1];
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected extra request');
      return response;
    }
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../pictures.js'), 'utf8') + '\nthis.pictures = Pictures;', context);
  return { pictures: context.pictures, calls };
}

test('picture generation is unavailable and makes no HTTP request', async () => {
  let requests=0;
  const context=vm.createContext({URLSearchParams, async fetch(){requests++;throw Error('unexpected request');}});
  vm.runInContext(readFileSync(path.join(__dirname,'../pictures.js'),'utf8')+'\nthis.pictures = Pictures;',context);
  const pictures=context.pictures;
  assert.equal(await pictures.decide('draw a cat','',{},{}),null);
  await assert.rejects(pictures.draw('a cat','3:2',{},{}),error=>{
    assert.equal(error.unavailable,true);
    assert.match(error.message,/unavailable/i);
    return true;
  });
  assert.equal(await pictures.resolve('idb:old'),null);
  pictures.forget('idb:old');
  assert.equal(requests,0);
});

test('cancellation is honored before the unavailable error', async () => {
  const context=vm.createContext({URLSearchParams});
  vm.runInContext(readFileSync(path.join(__dirname,'../pictures.js'),'utf8')+'\nthis.pictures = Pictures;',context);
  const controller=new AbortController();controller.abort();
  await assert.rejects(context.pictures.draw('a cat','1:1',{}, {signal:controller.signal}),{name:'AbortError'});
});
