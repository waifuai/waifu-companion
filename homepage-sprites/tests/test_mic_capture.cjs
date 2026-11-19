const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function harness(config = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), recorders = [], streams = [];
  const calls = { audio: [], errors: [], states: [], levels: [], closed: 0 };
  const clock = (fn, ms, repeat) => {
    const id = ++nextTimer;
    timers.set(id, { fn, ms, repeat, at: now + ms });
    return id;
  };
  const makeStream = () => {
    const events = {};
    const track = { stopped: 0, stop() { this.stopped++; },
      addEventListener(name, fn) { events[name] = fn; },
      removeEventListener(name) { delete events[name]; },
      end() { events.ended?.(); }
    };
    const stream = { track, getTracks: () => [track] };
    streams.push(stream);
    return stream;
  };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() {
      if (config.constructError) throw Error('constructor');
      this.state = 'inactive'; this.mimeType = 'audio/webm'; recorders.push(this);
    }
    start() { if (config.startError) throw Error('start'); this.state = 'recording'; }
    stop() {
      assert.notEqual(this.state, 'inactive'); this.state = 'inactive';
      const finish = () => {
        this.ondataavailable({ data: new Blob([new Uint8Array(config.empty ? 0 : 10)]) });
        this.onstop();
      };
      if (config.deferStop) this.finish = finish; else finish();
    }
  }
  class AudioContext {
    constructor() { this.state = config.suspended ? 'suspended' : 'running'; calls.context = this; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return {
      getFloatTimeDomainData(buffer) { buffer.fill(config.signal || 0); }, disconnect() {}
    }; }
    resume() { return Promise.resolve(); }
    close() { calls.closed++; return Promise.resolve(); }
  }
  const context = vm.createContext({
    window: config.noMonitor ? {} : { AudioContext }, Blob, Float32Array,
    Date: class extends Date { static now() { return now; } },
    MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: () => config.getUserMedia ? config.getUserMedia(makeStream) : Promise.resolve(makeStream()) } },
    setTimeout: (fn, ms) => clock(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => clock(fn, ms, true), clearInterval: id => timers.delete(id)
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../mic_capture.js'), 'utf8'), context);
  const capture = context.window.MicCapture.create({
    onState: state => calls.states.push(state), onLevel: level => calls.levels.push(level),
    onError: message => calls.errors.push(message),
    async onAudio(blob) { calls.audio.push(blob); if (config.uploadError) throw Error('Upload failed'); }
  });
  function advance(ms, skipTimers = false) {
    const until = now + ms;
    if (!skipTimers) {
      while (true) {
        const pending = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) break;
        const [id, timer] = pending; now = timer.at;
        if (timer.repeat) timer.at += timer.ms; else timers.delete(id);
        timer.fn();
      }
    }
    now = until;
  }
  return { capture, calls, advance, streams, recorders, timers, config };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('measured digital silence is not uploaded and capture resources are released', async () => {
  const h = harness(); await h.capture.start(); h.advance(600); h.capture.stop(); await flush();
  assert.equal(h.calls.audio.length, 0);
  assert.match(h.calls.errors[0], /No microphone sound/);
  assert.equal(h.capture.state, 'idle');
  assert.equal(h.streams[0].track.stopped, 1);
  assert.equal(h.calls.closed, 1);
  assert.equal(h.timers.size, 0);
});

test('very quiet measured audio is preserved', async () => {
  const h = harness({ signal: 0.000001 }); await h.capture.start(); h.advance(600); h.capture.stop(); await flush();
  assert.equal(h.calls.audio.length, 1);
  assert.equal(h.calls.errors.length, 0);
  assert.ok(h.calls.levels.some(level => level > 0));
});

for (const config of [{ noMonitor: true }, { suspended: true }]) {
  test('unavailable measurement preserves audio: ' + JSON.stringify(config), async () => {
    const h = harness(config); await h.capture.start(); h.advance(600); h.capture.stop(); await flush();
    assert.equal(h.calls.audio.length, 1);
    assert.equal(h.calls.errors.length, 0);
  });
}

test('a gap in monitoring cannot reject unseen speech', async () => {
  const h = harness(); await h.capture.start(); h.advance(100); h.advance(600, true); h.capture.stop(); await flush();
  assert.equal(h.calls.audio.length, 1);
});

test('brief suspension between silent samples cannot reject unmeasured speech', async () => {
  const h = harness(); await h.capture.start(); h.advance(100);
  h.calls.context.state = 'suspended'; h.advance(100);
  h.calls.context.state = 'running'; h.advance(400); h.capture.stop(); await flush();
  assert.equal(h.calls.audio.length, 1);
});

for (const failure of ['constructError', 'startError']) {
  test('recorder ' + failure + ' releases the device and allows retry', async () => {
    const h = harness({ [failure]: true }); await h.capture.start();
    assert.equal(h.capture.state, 'idle'); assert.equal(h.streams[0].track.stopped, 1);
    h.config[failure] = false; await h.capture.start(); assert.equal(h.capture.state, 'listening');
    h.capture.stop(); await flush(); assert.equal(h.timers.size, 0);
  });
}

test('recorder error discards audio and a following recording works', async () => {
  const h = harness({ signal: 0.01 }); await h.capture.start(); h.advance(600);
  h.recorders[0].onerror(); await flush();
  assert.equal(h.capture.state, 'idle'); assert.equal(h.calls.audio.length, 0);
  assert.equal(h.timers.size, 0);
  await h.capture.start(); h.advance(600); h.capture.stop(); await flush();
  assert.equal(h.calls.audio.length, 1);
});

test('disconnecting the input device cleans up without uploading partial audio', async () => {
  const h = harness(); await h.capture.start(); h.advance(600); h.streams[0].track.end(); await flush();
  assert.match(h.calls.errors[0], /disconnected/); assert.equal(h.calls.audio.length, 0);
  assert.equal(h.timers.size, 0); assert.equal(h.capture.state, 'idle');
});

test('canceling permission startup cannot overwrite a newer recording', async () => {
  let completeFirst, request = 0;
  const h = harness({ getUserMedia(makeStream) {
    if (!request++) return new Promise(resolve => { completeFirst = () => resolve(makeStream()); });
    return Promise.resolve(makeStream());
  } });
  const pending = h.capture.start(); h.capture.stop(); await h.capture.start();
  completeFirst(); await pending;
  assert.equal(h.capture.state, 'listening');
  assert.equal(h.streams[0].track.stopped, 0); assert.equal(h.streams[1].track.stopped, 1);
  h.capture.stop(); await flush();
});

test('empty recorder output is reported rather than uploaded', async () => {
  const h = harness({ empty: true }); await h.capture.start(); h.advance(600); h.capture.stop(); await flush();
  assert.match(h.calls.errors[0], /No audio was recorded/); assert.equal(h.calls.audio.length, 0);
});

test('one minute stops recording and releases the microphone before upload', async () => {
  const h = harness({ signal: 0.01 }); await h.capture.start(); h.advance(60000); await flush();
  assert.equal(h.calls.audio.length, 1); assert.equal(h.streams[0].track.stopped, 1);
  assert.equal(h.capture.state, 'idle'); assert.equal(h.timers.size, 0);
});

test('repeated stop before the stop event does not turn a valid recording into an error', async () => {
  const h = harness({ signal: 0.01, deferStop: true }); await h.capture.start(); h.advance(600);
  h.capture.stop(); h.capture.stop(); h.recorders[0].finish(); await flush();
  assert.equal(h.calls.audio.length, 1); assert.equal(h.calls.errors.length, 0);
});

test('upload failures restore idle state with a retryable error', async () => {
  const h = harness({ signal: 0.01, uploadError: true }); await h.capture.start(); h.advance(600); h.capture.stop(); await flush();
  assert.equal(h.capture.state, 'idle'); assert.match(h.calls.errors[0], /Upload failed/);
  assert.equal(h.timers.size, 0);
});
