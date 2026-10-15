(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const limits = Object.freeze({ messages: 100, history: 128 * 1024, summary: 32 * 1024, transcript: 128 * 1024, request: 256 * 1024 });
  const bytes = text => encoder.encode(String(text || '')).length;
  const jsonBytes = value => bytes(JSON.stringify(value));
  function error(code, message) { const e = new Error(message); e.code = code; return e; }
  function validateSummary(text, allowEmpty = false) {
    text = String(text || '').trim();
    if (!text && !allowEmpty) throw error('summary_empty', 'The memory update was empty. Your previous memory is kept.');
    if (bytes(text) > limits.summary) throw error('summary_too_large', 'Memory must fit within 32 KiB. Compress it or shorten the text; your previous memory is kept.');
    return text;
  }
  function checkBody(body) {
    if (Array.isArray(body.messages) && body.messages.length > limits.messages + 1) {
      throw error('context_too_large', 'This request has too many messages or instructions. Compress older memory before sending it. Your saved text is kept.');
    }
    const size = jsonBytes(body);
    if (size > limits.request) throw error('context_too_large', 'This request is too large. Compress older memory or shorten the message or personality instructions. Your saved text is kept.');
    return size;
  }
  function pack(messages, makeBody = m => ({ messages: m }), memorySize = limits.messages) {
    const system = messages.filter(m => m.role === 'system');
    const history = messages.filter(m => m.role !== 'system');
    const count = Math.min(limits.messages, Math.max(1, Number(memorySize) || limits.messages), limits.messages + 1 - system.length);
    const selected = history.length ? [history[history.length - 1]] : [];
    checkBody(makeBody(system.concat(selected)));
    let historyBytes = 0;
    for (let i = history.length - 2; i >= 0 && selected.length < count; i--) {
      const cost = jsonBytes(history[i]) + 1;
      const candidate = [history[i], ...selected];
      if (historyBytes + cost > limits.history || jsonBytes(makeBody(system.concat(candidate))) > limits.request) break;
      selected.unshift(history[i]); historyBytes += cost;
    }
    const out = system.concat(selected);
    return { messages: out, omitted: history.length - selected.length, historyBytes, requestBytes: checkBody(makeBody(out)) };
  }
  function prefix(text, maxBytes) {
    const encoded = encoder.encode(text);
    let end = Math.min(maxBytes, encoded.length);
    while (end > 0 && end < encoded.length && (encoded[end] & 0xc0) === 0x80) end--;
    // Slice the original string, preserving even unusual UTF-16 input.
    return text.slice(0, decoder.decode(encoded.subarray(0, end)).length);
  }
  function signature(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return text.length + ':' + (hash >>> 0);
  }
  function summaryMessages(transcript, previous, preference = 'concise') {
    return [{ role: 'system', content: 'You summarize conversations concisely.' }, { role: 'user', content:
      'You are a memory compression engine.\nThe following is an existing summary of a conversation:\n"' +
      (previous || 'No previous summary exists.') + '"\n\nThe following are the oldest messages that were just pushed out of memory:\n' +
      transcript + '\n\nCombine the previous memory and this transcript into a ' + preference +
      ' summary. Aim for a compact summary; never exceed 32 KiB of UTF-8 text. Keep names, user preferences, decisions, promises and unresolved events. ' +
      'Condense repetition and older details. A continuation contains the next part of a long message; do not invent missing parts. Respond ONLY with the new summary text.' }];
  }
  function compressionTask(entries, state, makeBody = m => ({ messages: m }), preference = 'concise') {
    const legacy = bytes(state.summary) > limits.summary;
    let work = legacy ? state.progress && state.progress.legacy : null;
    if (legacy && (!work || work.source !== state.summary)) work = { source: state.summary, offset: 0, summary: '' };
    const source = legacy ? [{ id: 'legacy', text: work.source }] : entries;
    const previous = legacy ? work.summary : validateSummary(state.summary, true);
    let offset = legacy ? work.offset : state.progress && state.progress.partial ? state.progress.partial.offset : 0;
    if (!legacy && state.progress && state.progress.partial) {
      const partial = state.progress.partial;
      if (!source[0] || source[0].id !== partial.id || signature(source[0].text) !== partial.signature) {
        throw error('memory_changed', 'Older memory changed. Restart its compression before continuing.');
      }
    }
    let transcript = '', completed = 0, partial = null;
    for (const entry of source) {
      const remaining = entry.text.slice(offset);
      const lead = offset ? '[Continuation of an earlier message]\n' : '';
      const separator = transcript ? '\n' : '';
      let part = lead + remaining;
      const fits = value => bytes(value) <= limits.transcript && jsonBytes(makeBody(summaryMessages(value, previous, preference))) <= limits.request;
      if (!fits(transcript + separator + part)) {
        if (completed) break; // Prefer complete messages when a batch already has work.
        let piece = prefix(remaining, limits.transcript - bytes(lead));
        while (piece && !fits(lead + piece)) piece = prefix(piece, Math.max(0, Math.floor(bytes(piece) * .9)));
        if (!piece) throw error('context_too_large', 'The memory request cannot fit. Shorten the memory instructions.');
        part = lead + piece;
        partial = { id: entry.id, offset: offset + piece.length, signature: signature(entry.text) };
      }
      transcript += separator + part;
      if (partial) break;
      completed++; offset = 0;
    }
    if (!transcript) return null;
    const messages = summaryMessages(transcript, previous, preference);
    checkBody(makeBody(messages));
    return { legacy, source: legacy ? work.source : null, previousState: state, messages,
      completed: source.slice(0, completed), partial, requestBytes: jsonBytes(makeBody(messages)) };
  }
  function accept(task, text) {
    const summary = validateSummary(text);
    if (task.legacy && task.partial) return { summary: task.source, progress: { legacy: { source: task.source, offset: task.partial.offset, summary } } };
    return { summary, progress: task.partial ? { partial: task.partial } : null,
      ...(task.legacy ? { backup: task.source } : {}) };
  }
  function activeSummary(state) {
    if (!state) return '';
    const text = typeof state === 'string' ? state : String(state.summary || '');
    if (bytes(text) <= limits.summary) return text;
    const progress = typeof state === 'object' && state.progress;
    if (progress && progress.legacy && progress.legacy.summary) {
      const ps = String(progress.legacy.summary);
      if (bytes(ps) <= limits.summary) return ps;
      return prefix(ps, limits.summary);
    }
    return prefix(text, limits.summary);
  }
  function decisionReply(text, limit = 4096) {
    limit = Math.min(4096, Math.max(32, limit));
    const s = String(text ?? '');
    if (s.length <= limit) return s;
    const marker = '\n[...]\n';
    let head = Math.floor((limit - marker.length) / 2);
    let tail = s.length - (limit - marker.length - head);
    if (/[\uD800-\uDBFF]/.test(s[head - 1]) && /[\uDC00-\uDFFF]/.test(s[head])) head--;
    if (/[\uDC00-\uDFFF]/.test(s[tail]) && /[\uD800-\uDBFF]/.test(s[tail - 1])) tail++;
    return s.slice(0, head) + marker + s.slice(tail);
  }
  function decisionState(state) {
    const out = { ...state };
    for (const field of ['reply', 'spoken_reply']) {
      if (typeof out[field] === 'string') out[field] = decisionReply(out[field]);
    }
    // Leave room for task ids and request_id under the 16 Ki-character body cap.
    const fields = ['reply', 'spoken_reply'];
    while (JSON.stringify(out).length > 15000) {
      const field = fields.filter(k => typeof out[k] === 'string' && out[k].length > 64)
        .sort((a, b) => out[b].length - out[a].length)[0];
      if (!field) break;
      out[field] = decisionReply(out[field], Math.max(64, out[field].length - 256));
    }
    return out;
  }
  const api = { limits, bytes, jsonBytes, validateSummary, checkBody, pack, prefix, signature, summaryMessages, compressionTask, accept, activeSummary, error, decisionReply, decisionState };
  root.ConversationBudget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
