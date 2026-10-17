/* Microphone capture shared by the independently published web clients.
 * Input-level analysis stays on the device. This is
 * a digital-silence check, not a speech classifier. Unavailable or interrupted
 * measurements never reject a recording.
 */
(function () {
  // A shared client: when the localization runtime is absent it must keep its
  // English fallbacks, so every message carries its own English text.
  const tr = (key, fallback) => {
    const api = typeof window !== 'undefined' && window.WaifuI18n;
    try { return api && api.has(key) ? api.t(key) : fallback; } catch (error) { return fallback; }
  };
  const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];

  function inputMonitor(stream, onLevel, startedAt) {
    let context, source, analyser, timer;
    let samples = 0, maxPeak = 0, complete = true, lastSampleAt = startedAt, windowMs = 0;
    let closed = false;
    const level = value => { if (onLevel) onLevel(value); };
    const sample = () => {
      if (closed) return;
      if (context?.state !== 'running') { complete = false; return; }
      const now = Date.now();
      if (now - lastSampleAt > windowMs) complete = false;
      lastSampleAt = now;
      try {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0, peak = 0;
        for (const value of buffer) {
          if (!Number.isFinite(value)) { complete = false; return; }
          peak = Math.max(peak, Math.abs(value));
          sum += value * value;
        }
        samples++;
        maxPeak = Math.max(maxPeak, peak);
        level(Math.min(1, Math.sqrt(Math.sqrt(sum / buffer.length) * 8)));
      } catch (_) { complete = false; }
    };
    let buffer;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        windowMs = analyser.fftSize / (context.sampleRate || 48000) * 1000;
        buffer = new Float32Array(analyser.fftSize);
        source.connect(analyser); // Never connect microphone input to speakers.
        timer = setInterval(sample, 25);
        if (context.state === 'suspended') context.resume().catch(() => { complete = false; });
      }
    } catch (_) { complete = false; }
    return {
      finish() {
        if (closed) return { silent: false };
        sample();
        closed = true;
        clearInterval(timer);
        try { source?.disconnect(); } catch (_) {}
        try { analyser?.disconnect(); } catch (_) {}
        try { context?.close()?.catch(() => {}); } catch (_) {}
        level(null);
        // Below even 24-bit PCM resolution. Quiet speech and background noise
        // pass; only a continuously measured, effectively zero signal is held.
        return { silent: complete && samples >= 2 && maxPeak <= 1e-7 };
      }
    };
  }

  function create(options) {
    let state = 'idle', current = null;
    const setState = next => { state = next; options.onState?.(next); };
    const release = session => {
      clearTimeout(session.timer);
      session.signalResult = session.monitor?.finish() || { silent: false };
      session.monitor = null;
      for (const track of session.stream?.getTracks() || []) {
        track.removeEventListener?.('ended', session.onEnded);
        track.stop();
      }
      session.stream = null;
    };
    const fail = (session, message) => {
      if (session.finished || current !== session) return;
      session.finished = true;
      try { if (session.recorder?.state !== 'inactive') session.recorder?.stop(); } catch (_) {}
      release(session);
      current = null;
      setState('idle');
      options.onError?.(message);
    };
    const stop = () => {
      const session = current;
      if (!session || session.stopping || state === 'transcribing') return;
      if (state === 'starting') {
        session.finished = true;
        release(session);
        current = null;
        setState('idle');
      } else {
        session.stopping = true;
        try { session.recorder.stop(); }
        catch (_) { fail(session, tr('mic.finishFailed', 'Could not finish the recording. Please try the microphone again.')); }
      }
    };
    const start = async () => {
      if (state !== 'idle') return;
      const session = { chunks: [], finished: false };
      current = session;
      setState('starting');
      try {
        session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (current !== session || session.finished) { release(session); return; }
        const mimeType = MediaRecorder.isTypeSupported ? MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) : undefined;
        const recorder = session.recorder = new MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
        session.onEnded = () => fail(session, tr('mic.disconnected', 'The microphone disconnected. Check your input device and try again.'));
        for (const track of session.stream.getTracks()) track.addEventListener?.('ended', session.onEnded);
        recorder.ondataavailable = event => { if (event.data?.size) session.chunks.push(event.data); };
        recorder.onerror = () => fail(session, tr('mic.recordingFailed', 'Microphone recording failed. Check your input device and try again.'));
        recorder.onstop = async () => {
          if (session.finished || current !== session) return;
          session.finished = true;
          const duration = Date.now() - session.startedAt;
          const blob = new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' });
          release(session);
          try {
            if (duration < 400) return; // Ignore accidental short taps.
            if (!blob.size) {
              options.onError?.(tr('mic.noAudio', 'No audio was recorded. Check your microphone and try again.'));
              return;
            }
            if (session.signalResult.silent) {
              options.onError?.(tr('mic.silent', 'No microphone sound was detected. Check that the correct microphone is selected and unmuted, then try again.'));
              return;
            }
            setState('transcribing');
            await options.onAudio(blob);
          } catch (error) {
            options.onError?.(error?.message || tr('voice.genericFailed', 'Voice input failed. Please try again.'));
          } finally {
            if (current === session) { current = null; setState('idle'); }
          }
        };
        session.startedAt = Date.now();
        recorder.start();
        session.monitor = inputMonitor(session.stream, options.onLevel, session.startedAt);
        session.timer = setTimeout(stop, 60000);
        setState('listening');
      } catch (error) {
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        fail(session, denied
          ? tr('mic.denied', 'Microphone permission denied. Enable it in your browser settings to use voice input.')
          : tr('mic.startFailed', 'Could not start voice input. Check your microphone and try again.'));
      }
    };
    return { start, stop, get state() { return state; }, get recording() { return state === 'starting' || state === 'listening'; } };
  }

  window.MicCapture = { create };
})();
