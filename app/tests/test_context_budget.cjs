const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = fs.existsSync(path.join(__dirname, '../scripts/context_budget.js'))
  ? '../scripts/context_budget.js' : '../context_budget.js';
const b = require(file);
const body = messages => ({ model: 'waifuai-v1', messages, max_tokens: 2500, stream: false });

test('the request limit is measured on encoded JSON, including the exact boundary', () => {
  const value = { text: '' }, overhead = b.jsonBytes(value);
  value.text = 'x'.repeat(b.limits.request - overhead);
  assert.equal(b.checkBody(value), b.limits.request);
  value.text += 'x';
  assert.throws(() => b.checkBody(value), { code: 'context_too_large' });
});

test('packing protects the newest turn and instructions without mutating the archive', () => {
  const messages = [{ role: 'system', content: 'Persona and remembered facts' },
    ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'item ' + i }))];
  const result = b.pack(messages, body);
  assert.equal(result.messages.length, 21);
  assert.equal(result.messages[0], messages[0]);
  assert.equal(result.messages.at(-1), messages.at(-1));
  assert.equal(messages.length, 41);
});

test('history and final-body budgets both reduce old context', () => {
  const messages = [{ role: 'system', content: 'S'.repeat(18000) },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(1500) + i }))];
  const result = b.pack(messages, body);
  assert.ok(result.historyBytes <= 16384);
  assert.ok(result.requestBytes <= 32768);
  assert.ok(result.omitted > 0);
  assert.equal(result.messages.at(-1), messages.at(-1));
});

test('an oversized mandatory message is rejected intact rather than truncated', () => {
  const latest = { role: 'user', content: '🙂'.repeat(10000) };
  assert.throws(() => b.pack([{ role: 'system', content: 'Persona' }, latest], body), { code: 'context_too_large' });
  assert.equal(latest.content, '🙂'.repeat(10000));
});

test('summary acceptance measures UTF-8 rather than JavaScript characters', () => {
  assert.equal(b.validateSummary('x'.repeat(4096)).length, 4096);
  assert.throws(() => b.validateSummary('記'.repeat(1400)), { code: 'summary_too_large' });
  assert.throws(() => b.validateSummary('   '), { code: 'summary_empty' });
});

test('compression prefers whole messages and leaves later sources pending', () => {
  const entries = [0, 1, 2].map(id => ({ id, text: 'USER: ' + 'x'.repeat(14000) }));
  const task = b.compressionTask(entries, { summary: '' }, body);
  assert.equal(task.completed.length, 1);
  assert.equal(task.partial, null);
  assert.equal(entries.length, 3);
  assert.ok(task.requestBytes <= 32768);
});

for (const [label, text] of [['multilingual', '記憶🙂'.repeat(12000)], ['JSON escaping', '"\\\n'.repeat(20000)]]) {
  test(`long ${label} messages resume without dropping source characters`, () => {
    const entries = [{ id: 'long', text }];
    let state = { summary: '' }, previousOffset = 0, count = 0;
    while (true) {
      const task = b.compressionTask(entries, state, body);
      assert.ok(task.requestBytes <= 32768);
      assert.ok(b.bytes(task.messages[1].content) < 32768);
      assert.equal(entries[0].text, text);
      state = b.accept(task, 'Names and unresolved facts');
      count++;
      if (!task.partial) { assert.equal(task.completed[0].text, text); break; }
      assert.ok(task.partial.offset > previousOffset);
      previousOffset = task.partial.offset;
      assert.ok(count < 30);
    }
    assert.ok(count > 1);
  });
}

test('legacy memory is kept until its last accepted chunk, with a full backup', () => {
  const original = 'Older facts. '.repeat(10000);
  let state = { summary: original }, calls = 0;
  while (true) {
    const task = b.compressionTask([], state, body);
    assert.equal(task.legacy, true);
    state = b.accept(task, 'Compressed facts');
    calls++;
    if (!state.progress) break;
    assert.equal(state.summary, original);
    assert.ok(calls < 20);
  }
  assert.equal(state.summary, 'Compressed facts');
  assert.equal(state.backup, original);
  assert.ok(calls > 1);
});

test('edited continuation sources and oversized results do not advance the checkpoint', () => {
  const entries = [{ id: 'a', text: 'x'.repeat(40000) }];
  const task = b.compressionTask(entries, { summary: '' }, body);
  assert.throws(() => b.accept(task, 'x'.repeat(4097)), { code: 'summary_too_large' });
  const state = b.accept(task, 'Facts');
  entries[0].text = 'Edited source';
  assert.throws(() => b.compressionTask(entries, state, body), { code: 'memory_changed' });
});

test('impossible summary envelopes fail without a shrinking-loop stall', () => {
  assert.throws(() => b.compressionTask([{ id: 'a', text: 'x' }], { summary: '' },
    messages => ({ messages, extra: 'x'.repeat(32768) })), { code: 'context_too_large' });
});

test('activeSummary returns bounded prompt summary without mutating legacy memory', () => {
  assert.equal(b.activeSummary(''), '');
  assert.equal(b.activeSummary('Compact memory'), 'Compact memory');
  assert.equal(b.activeSummary({ summary: 'Compact memory' }), 'Compact memory');
  const huge = 'Older legacy facts. '.repeat(1000);
  const state = { summary: huge, progress: null };
  const active1 = b.activeSummary(state);
  assert.ok(b.bytes(active1) <= 4096);
  assert.equal(state.summary, huge);
  state.progress = { legacy: { source: huge, offset: 5000, summary: 'Partially condensed facts' } };
  const active2 = b.activeSummary(state);
  assert.equal(active2, 'Partially condensed facts');
  assert.equal(state.summary, huge);
});

