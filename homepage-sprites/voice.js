/**
 * voice.js: voice input for the mic button.
 *
 * Speech recognition runs in the browser through the Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). The public transcription
 * service was retired and no request leaves this page for audio. When the
 * browser has no Web Speech support the mic button is hidden and typing
 * remains the only input.
 *
 * Gestures, as in waifu-companion:
 *  - press and hold: records while held, stops on release (push-to-talk)
 *  - quick tap: keeps recording until the next tap
 *  - keyboard (Enter/Space): toggles, like a tap
 */
const Voice = (() => {
  const tr = (key, params) => (window.WaifuI18n ? window.WaifuI18n.t(key, params) : key);
  const HOLD_THRESHOLD_MS = 300;

  function Recognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      return rec;
    } catch (e) { return null; }
  }
  const supported = Boolean(Recognition());

  let state = 'idle'; // idle | starting | listening
  let recognition = null;
  let buttonElement = null;
  let opts = {};
  let generation = 0;
  let finalText = '';

  function setState(next) {
    state = next;
    if (opts.onState) opts.onState(state);
  }

  function stop() {
    if (!recognition) return;
    try { recognition.stop(); } catch (e) { setState('idle'); }
  }

  function cancel() {
    generation++;
    if (!recognition) return;
    try { recognition.abort(); } catch (e) {}
    recognition = null;
    setState('idle');
  }

  function start() {
    if (!supported || recognition) return;
    const token = ++generation;
    const rec = Recognition();
    if (!rec) { opts.onError(tr('voice.failed', { message: 'Speech recognition is unavailable' })); return; }
    recognition = rec;
    finalText = '';
    setState('starting');
    let sawStart = false;
    rec.onstart = () => { if (token === generation) { sawStart = true; setState('listening'); } };
    rec.onresult = event => {
      if (token !== generation) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      opts.onLiveText?.((finalText + ' ' + interim).trim());
    };
    rec.onerror = event => {
      if (token !== generation) return;
      recognition = null;
      setState('idle');
      const message = event && event.error === 'not-allowed'
        ? tr('voice.failed', { message: 'Microphone permission was denied' })
        : tr('voice.failed', { message: (event && event.error) || 'Speech recognition failed' });
      opts.onError(message);
    };
    rec.onend = () => {
      if (token !== generation) return;
      recognition = null;
      setState('idle');
      const text = finalText.trim();
      if (text) opts.onText(text);
      else if (sawStart) opts.onError(tr('voice.heardNothing'));
    };
    try { rec.start(); }
    catch (e) { recognition = null; setState('idle'); opts.onError(tr('voice.failed', { message: e.message || 'Speech recognition failed' })); }
  }

  const recording = () => state === 'starting' || state === 'listening';

  /**
   * opts.onText(text) gets the final transcript, opts.onLiveText(text) interim
   * text, opts.onState(state) every state change, opts.onError(message)
   * failures. opts.ids() is retained for call-site compatibility but is unused.
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
      if (e.detail !== 0 || recording()) return; // keyboard only; pointer handled above
      start();
    });
  }

  return { init, stop, cancel, supported, get state() { return state; } };
})();
