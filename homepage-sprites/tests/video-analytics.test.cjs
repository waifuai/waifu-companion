const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sprites.js'), 'utf8');
function setup() {
  const events = [], timers = new Map(); let time = 0, id = 0;
  const context = {
    window: { WaifuSpritesEmbed: true, gtag: (...args) => events.push(args) },
    document: { visibilityState: 'visible', addEventListener() {} },
    performance: { now: () => time }, navigator: {},
    setTimeout: (fn, ms) => { timers.set(++id, {fn, ms}); return id; },
    clearTimeout: n => timers.delete(n), console,
  };
  const video = () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, pause() {}, play: () => Promise.resolve() });
  const a = video(), b = video();
  vm.createContext(context); vm.runInContext(source + '\nthis.player = Sprites;', context);
  context.player.init([a,b], null);
  return {context, a, b, events, timers, advance(n) { time += n; }, fire(ms) { for (const t of [...timers.values()]) if (t.ms === ms) t.fn(); }};
}
test('reports startup then later emotion playback', async () => {
 const x=setup(); x.advance(1200); x.b.oncanplay(); await Promise.resolve();
 let results=x.events.filter(e => e[1] === 'sprite_video_result');
 assert.equal(results[0][2].video_outcome, 'playing'); assert.equal(results[0][2].video_phase, 'initial'); assert.equal(results[0][2].load_bucket, '1_to_3s');
 x.context.player.setEmotion('happy'); x.advance(500); x.a.oncanplay(); await Promise.resolve();
 results=x.events.filter(e => e[1] === 'sprite_video_result');
 assert.equal(results[1][2].video_phase, 'subsequent'); assert.equal(results[1][2].clip_kind, 'emotion');
});
test('superseded and timeout results are counted once', () => {
 const x=setup(); x.context.player.setState('thinking'); x.advance(10000); x.fire(10000);
 const results=x.events.filter(e => e[1] === 'sprite_video_result');
 assert.deepEqual(results.map(e => e[2].video_outcome), ['superseded', 'timeout']);
});
test('reports autoplay rejection distinctly', async () => {
 const x=setup(); x.b.play=() => Promise.reject(Object.assign(new Error(), { name:'NotAllowedError' }));
 x.b.oncanplay(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(x.events.find(e => e[1] === 'sprite_video_result')[2].video_outcome, 'autoplay_blocked');
});
test('background timeout is not classified as CDN failure', () => {
 const x=setup(); x.context.document.visibilityState='hidden'; x.advance(10000); x.fire(10000);
 assert.equal(x.events.find(e => e[1] === 'sprite_video_result')[2].video_outcome, 'backgrounded');
});
