/**
 * voice.js: voice input for the mic button.
 *
 * Records the mic with MediaRecorder and transcribes it through WaifuAI Cloud's
 * /transcribe endpoint, whichever provider the chat itself uses.
 *
 * Gestures, as in waifu-companion:
 *  - press and hold: records while held, stops on release (push-to-talk)
 *  - quick tap: keeps recording until the next tap
 *  - keyboard (Enter/Space): toggles, like a tap
 * Recordings stop by themselves after one minute.
 */
const Voice = (() => {
  const tr = (key, params) => (window.WaifuI18n ? window.WaifuI18n.t(key, params) : key);
  const TRANSCRIBE_URL = 'https://waifu-companion-proxy.thewaifuai.workers.dev/transcribe';
  const HOLD_THRESHOLD_MS = 300;

  const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && window.MicCapture);

  let state = 'idle'; // idle | starting | listening | transcribing
  let capture = null;
  let buttonElement = null;
  let opts = {};
  let generation = 0;
  let transcriptionController = null;

  function setState(next) {
    state = next;
    if (opts.onState) opts.onState(state);
  }

  async function transcribe(blob) {
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : blob.type.includes('mpeg') ? 'mp3' : 'webm';
    const form = new FormData();
    form.append('file', blob, 'audio.' + ext);
    const lang = (navigator.language || 'en').split('-')[0];
    if (/^[a-z]{2}$/.test(lang)) form.append('language', lang);
    const ids = opts.ids ? opts.ids() : {};
    const headers = {};
    if (ids.session) headers['x-session-id'] = ids.session;
    if (ids.visitor) headers['x-visitor-id'] = ids.visitor;
    const controller = new AbortController();
    transcriptionController = controller;
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const res = await fetch(TRANSCRIBE_URL, { method: 'POST', body: form, headers, signal: controller.signal });
      let body = null;
      try { body = await res.json(); } catch (error) { if (controller.signal.aborted) throw error; }
      if (!res.ok) {
        const err = new Error((body && body.error) || tr('voice.transcribeFailed', { status: res.status }));
        err.status = res.status;
        throw err;
      }
      return ((body && body.text) || '').trim();
    } catch (error) {
      if (controller.signal.aborted) throw new Error(tr('voice.transcribeSlow'));
      throw error;
    } finally {
      clearTimeout(timer);
      if (transcriptionController === controller) transcriptionController = null;
    }
  }

  function start() {
    if (!capture) capture = window.MicCapture.create({
      onState: setState,
      onLevel(level) {
        buttonElement.dataset.inputMonitor = String(level !== null);
        buttonElement.style.setProperty('--mic-input-level', String(level || 0));
      },
      onError(message) { opts.onError(message); },
      async onAudio(blob) {
        const token = generation;
        let text;
        try { text = await transcribe(blob); }
        catch (error) {
          if (token !== generation) return;
          throw new Error(error.status === 429
            ? tr('voice.busy')
            : tr('voice.failed', { message: error.message }));
        }
        if (token !== generation) return;
        if (text) opts.onText(text);
        else opts.onError(tr('voice.heardNothing'));
      }
    });
    capture.start();
  }

  function stop() { capture?.stop(); }
  function cancel() {
    generation++;
    transcriptionController?.abort();
    capture?.cancel();
  }

  const recording = () => state === 'starting' || state === 'listening';

  /**
   * opts.onText(text) gets each transcript, opts.onState(state) every state
   * change, opts.onError(message) failures; opts.ids() returns {session, visitor}.
   */
  function init(button, options) {
    opts = options;
    buttonElement = button;
    if (!supported) { button.hidden = true; return; }

    let pressAction = null;
    let pressStartedAt = 0;

    button.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); // keep focus in the text box and stop long-press menus
      if (state === 'transcribing') return;
      if (recording()) { pressAction = 'stop'; return; }
      pressAction = 'start';
      pressStartedAt = Date.now();
      try { button.setPointerCapture(e.pointerId); } catch (err) {}
      start();
    });
    const pressEnd = () => {
      const action = pressAction;
      pressAction = null;
      if (action === 'stop') stop();
      else if (action === 'start' && Date.now() - pressStartedAt >= HOLD_THRESHOLD_MS && state === 'listening') stop();
      // A quick tap leaves it recording until the next tap.
    };
    button.addEventListener('pointerup', pressEnd);
    button.addEventListener('pointercancel', pressEnd);
    button.addEventListener('contextmenu', e => e.preventDefault());
    button.addEventListener('click', e => {
      if (e.detail !== 0 || state === 'transcribing') return; // keyboard only
      if (recording()) stop(); else start();
    });
  }

  return { init, cancel, supported, get state() { return state; } };
})();
