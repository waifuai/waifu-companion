/**
 * app.js: wires the sprite player and the chat engine to the page.
 *
 * Sprite flow: listening while the visitor types, thinking while the reply is
 * on its way, the reply's emotion as soon as its tag arrives, back to idle a
 * while after, and sleeping after a few minutes without activity.
 */
(() => {
  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const messagesEl = $('messages');
  const input = $('msgInput');
  let viewRevision = 0;
  let observedOwner = null;
  let observedAbort = false;
  let waitTimers = [];
  let waitOwner = null;
  let waitStatus = null;
  let summaryUIRun = 0;
  const pictureViews = new Map();

  // ── Interface language ──
  // Every string the page shows goes through I18n; a missing runtime would
  // only ever happen in a stripped-down copy, so fall back to the key.
  const I18n = window.WaifuI18n;
  const tr = (key, params) => (I18n ? I18n.t(key, params) : key);
  const localize = el => {
    if (I18n) {
      if (el.hasAttribute('data-i18n')) el.textContent = tr(el.getAttribute('data-i18n'));
      for (const [attribute, target] of [['data-i18n-title', 'title'], ['data-i18n-aria-label', 'aria-label']]) {
        if (el.hasAttribute(attribute)) el.setAttribute(target, tr(el.getAttribute(attribute)));
      }
      I18n.apply(el);
    }
    return el;
  };

  const RETURN_TO_IDLE_MS = 12000;
  const SLEEP_AFTER_MS = 3 * 60 * 1000;
  const STARTERS = window.WaifuSpritesEmbed
    ? ['starter.hiShort', 'starter.fun', 'starter.selfie', 'starter.focusShort']
    : ['starter.hi', 'starter.fun', 'starter.selfie', 'starter.focus'];

  Sprites.init(Array.from(document.querySelectorAll('.sprite')), $('spriteLabel'));

  // Analytics events use waifu-companion's names so both apps share GA reports;
  // app_source (and the page path) tells them apart.
  function track(name, params) {
    if (typeof gtag === 'function') gtag('event', name, Object.assign({ app_source: window.WaifuSpritesSource || 'homepage-sprites' }, params));
  }

  // ── Sprite timing ──
  let idleTimer = null;
  let sleepTimer = null;

  function later(fn, ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(fn, ms);
  }
  function activity() {
    clearTimeout(sleepTimer);
    if (Sprites.current.name === 'sleeping') Sprites.setState('idle');
    sleepTimer = setTimeout(() => { if (!Chat.busy) Sprites.setState('sleeping'); }, SLEEP_AFTER_MS);
    if (ambientTimer) scheduleAmbient(); // the visitor is around: restart the quiet countdown
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
  // Sound is only allowed after a gesture, so every click or key unlocks it.
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, Speech.unlock, { passive: true }));

  input.addEventListener('input', () => {
    if (Chat.busy) return;
    clearTimeout(idleTimer);
    if (input.value.trim() && Sprites.current.name !== 'listening') Sprites.setState('listening');
    if (!input.value.trim()) later(() => Sprites.setState('idle'), 4000);
  });

  // ── Display settings ──
  const DISPLAY_KEY = 'ws_display';
  let display = { opacity: 0.55, fontSize: 15, hideVideo: false, hideChat: false, voiceAutoSend: true, clock: false, radioVolume: 0.3 };
  try { display = Object.assign(display, JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}')); } catch (e) {}
  function saveDisplay() { try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)); } catch (e) {} }
  if (window.WaifuSpritesEmbed) document.addEventListener('visibilitychange', () => {
    Sprites.setVisible(!document.hidden && !display.hideVideo);
  });
  function applyDisplay() {
    stage.style.setProperty('--bubble-alpha', display.opacity);
    stage.style.setProperty('--chat-font', display.fontSize + 'px');
    stage.style.setProperty('--queued-label', '"' + tr('chat.queued').replace(/"/g, '\\"') + '"');
    stage.classList.toggle('no-video', display.hideVideo);
    stage.classList.toggle('chat-hidden', display.hideChat);
    $('chatToggle').setAttribute('aria-pressed', String(display.hideChat));
    $('chatToggle').title = tr(display.hideChat ? 'app.showChat' : 'app.hideChat');
    $('chatToggle').setAttribute('aria-label', tr(display.hideChat ? 'app.showChat' : 'app.hideChat'));
    Sprites.setVisible(!display.hideVideo);
    $('clock').hidden = !display.clock;
    tickClock();
  }
  function tickClock() {
    if (display.clock) $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tickClock, 10000);
  $('opacity').value = display.opacity;
  $('fontSize').value = display.fontSize;
  $('hideVideo').checked = display.hideVideo;
  $('showClock').checked = display.clock;
  $('voiceAutoSend').checked = display.voiceAutoSend;
  $('voiceAutoSend').addEventListener('change', e => { display.voiceAutoSend = e.target.checked; saveDisplay(); });
  $('opacity').addEventListener('input', e => { display.opacity = +e.target.value; applyDisplay(); saveDisplay(); });
  $('fontSize').addEventListener('input', e => { display.fontSize = +e.target.value; applyDisplay(); saveDisplay(); });
  $('hideVideo').addEventListener('change', e => { display.hideVideo = e.target.checked; applyDisplay(); saveDisplay(); track('setting_changed', { setting: 'hide_video', setting_value: e.target.checked }); });
  $('showClock').addEventListener('change', e => { display.clock = e.target.checked; applyDisplay(); saveDisplay(); track('setting_changed', { setting: 'show_clock', setting_value: e.target.checked }); });
  $('chatToggle').addEventListener('click', () => { display.hideChat = !display.hideChat; applyDisplay(); saveDisplay(); track('setting_changed', { setting: 'hide_chat', setting_value: display.hideChat }); });
  applyDisplay();

  // ── Radio ──
  let radio = null;
  const radioBtn = $('radioBtn');
  function applyRadio() {
    const on = radio && !radio.paused;
    radioBtn.innerHTML = (on ? '&#9208; ' : '&#9654; ') + '<span data-i18n="' + (on ? 'radio.pause' : 'radio.play') + '"></span>';
    radioBtn.setAttribute('aria-pressed', String(Boolean(on)));
    localize(radioBtn);
  }
  radioBtn.addEventListener('click', () => {
    if (!radio) {
      radio = new Audio('https://listen.moe/stream');
      radio.volume = display.radioVolume;
      ['play', 'pause', 'ended', 'error'].forEach(ev => radio.addEventListener(ev, applyRadio));
    }
    if (radio.paused) {
      radio.play().catch(() => bubble('error', tr('radio.failed')));
      track('radio_toggle', { action: 'play' });
    } else {
      radio.pause();
      track('radio_toggle', { action: 'pause' });
    }
  });
  $('radioVolume').value = display.radioVolume;
  $('radioVolume').addEventListener('input', e => {
    display.radioVolume = +e.target.value;
    if (radio) radio.volume = display.radioVolume;
    saveDisplay();
  });

  // ── Her voice ──
  const speakToggle = $('speakToggle');
  function applySpeech() {
    const on = Speech.settings.enabled;
    speakToggle.setAttribute('aria-pressed', String(on));
    speakToggle.innerHTML = on ? '&#128266;' : '&#128263;';
    speakToggle.title = tr(on ? 'app.muteVoice' : 'app.readAloud');
    speakToggle.setAttribute('aria-label', tr('app.readAloud'));
    $('speakEnabled').checked = on;
    $('speakVolume').value = Speech.settings.volume;
    $('voiceSelect').value = Speech.settings.voiceId;
  }
  (() => {
    const select = $('voiceSelect');
    const groups = {};
    Speech.VOICES.forEach(v => {
      if (!groups[v.group]) {
        groups[v.group] = document.createElement('optgroup');
        groups[v.group].label = v.group;
        select.appendChild(groups[v.group]);
      }
      groups[v.group].appendChild(new Option(v.name, v.id));
    });
  })();
  function setSpeech(on) {
    Speech.settings.enabled = on;
    Speech.save();
    if (!on) Speech.stop();
    applySpeech();
    track('voice_enabled_toggle', { type: 'cloud', enabled: on });
  }
  speakToggle.addEventListener('click', () => setSpeech(!Speech.settings.enabled));
  $('speakEnabled').addEventListener('change', e => setSpeech(e.target.checked));
  $('speakVolume').addEventListener('change', e => { Speech.settings.volume = +e.target.value; Speech.save(); });
  $('voiceSelect').addEventListener('change', e => {
    Speech.settings.voiceId = e.target.value;
    Speech.save();
    track('voice_changed', { voice_id: e.target.value });
    Speech.speak('Hi! This is how I sound.', { sample: true });
  });
  applySpeech();

  // Reads a reply aloud and keeps her emotion on screen until it ends.
  // Resolves when she's done talking (at once when her voice is off).
  function speakReply(text, force, routingPlan = null, owner = null) {
    const valid = () => !owner || Chat.isCurrent(owner);
    if ((!Speech.settings.enabled && !force) || !valid()) return Promise.resolve();
    return Speech.speak(text, {
      force,
      routingPlan,
      owner,
      valid,
      onStart() { if (valid()) clearTimeout(idleTimer); },
      onPlay(info) { if (!force && valid()) track('tts_played', info); },
      onEnd() { if (valid()) later(() => { if (valid()) Sprites.setState('idle'); }, 4000); },
    });
  }

  // ── Messages ──
  function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function bubble(role, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    const span = document.createElement('span');
    span.className = 'text';
    span.dir = 'auto';
    span.textContent = text;
    el.appendChild(span);
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }
  function setText(el, text) { el.querySelector('.text').textContent = text; }

  function showRomaji(el, text) {
    let r = el.querySelector('.romaji');
    if (!r) {
      r = document.createElement('div');
      r.className = 'romaji';
      el.insertBefore(r, el.querySelector('.actions'));
    }
    r.textContent = text;
    scrollDown();
  }

  function actionButton(label, titleKey, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = label;
    b.setAttribute('data-i18n-title', titleKey);
    b.setAttribute('data-i18n-aria-label', titleKey);
    localize(b);
    b.addEventListener('click', e => { e.stopPropagation(); onClick(b); });
    return b;
  }

  // Replay, copy and delete on a finished message. Shown on hover, or on tap on touch screens.
  function addActions(el, message) {
    el.dataset.id = message.id;
    el.querySelector('.actions')?.remove();
    const bar = document.createElement('div');
    bar.className = 'actions';
    if (Chat.canRetry(message.id)) {
      const retry = actionButton(tr('app.retry'), 'app.retry', () => {
        if (Chat.canRetry(message.id)) runTurn({ text: Chat.messages.find(m => m.id === message.userId)?.content, source: 'retry', retryId: message.id });
      });
      retry.className = 'retry';
      bar.appendChild(retry);
    }
    if (message.role === 'assistant' && message.content) {
      bar.appendChild(actionButton('&#128266;', 'chat.readAloud', () => {
        track('tts_action', { action: 'play', source: 'message' });
        speakReply(message.content, true);
      }));
    }
    if (message.content) {
      bar.appendChild(actionButton('&#128203;', 'chat.copy', b => {
        navigator.clipboard && navigator.clipboard.writeText(message.content).then(() => {
          b.innerHTML = '&#10003;';
          setTimeout(() => { b.innerHTML = '&#128203;'; }, 1500);
        });
        track('message_copied');
      }));
    }
    bar.appendChild(actionButton('&#128465;', 'chat.delete', () => {
      Chat.deleteMessage(message.id);
      renderConversation();
      track('message_deleted');
      placeMemoryMark();
      if (!Chat.messages.length) renderConversation();
    }));
    el.appendChild(bar);
    el.addEventListener('click', e => {
      if (e.target.closest('a, img') || !matchMedia('(hover: none)').matches) return;
      messagesEl.querySelectorAll('.msg.show-actions').forEach(m => { if (m !== el) m.classList.remove('show-actions'); });
      el.classList.toggle('show-actions');
    });
  }

  function messageBubble(message) {
    const el = bubble(message.role, message.content);
    if (message.romaji) showRomaji(el, message.romaji);
    addActions(el, message);
    showAttemptStatus(el, message);
    return el;
  }

  function showAttemptStatus(el, message) {
    el.querySelector('.attempt-status')?.remove();
    if (!message.status || message.status === 'completed' || message.status === 'pending') return;
    const status = document.createElement('div');
    status.className = 'attempt-status';
    status.setAttribute('role', 'status');
    if (message.status !== 'failed' || !message.error) {
      status.setAttribute('data-i18n', 'chat.' + message.status); localize(status);
    } else status.textContent = tr('chat.failed') + ': ' + message.error;
    el.appendChild(status);
  }

  function renderEmpty() {
    const key = Chat.settings.persona;
    bubble('info', key === 'custom' ? tr('chat.sayHi') : tr('chat.sayHiTo', { name: tr('persona.' + key + '.name') }));
    const wrap = document.createElement('div');
    wrap.className = 'starters';
    STARTERS.forEach(starterKey => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-i18n', starterKey);
      localize(b);
      b.addEventListener('click', () => send(tr(starterKey), 'starter'));
      wrap.appendChild(b);
    });
    messagesEl.appendChild(wrap);
  }

  function pictureBubble(message) {
    const old = pictureViews.get(message.id);
    old?.dispose();
    const fig = document.createElement('figure');
    fig.className = 'msg assistant pic';
    fig.dataset.id = message.id;
    const revision = viewRevision, chatId = Chat.convId, ref = message.image, attempt = message.attemptId;
    const owner = Chat.current?.attemptId === attempt && Chat.isCurrent(Chat.current) ? Chat.current : null;
    let disposed = false, objectUrl = null;
    const valid = () => !disposed && revision === viewRevision && chatId === Chat.convId &&
      Chat.messages.includes(message) && message.image === ref && message.attemptId === attempt && fig.isConnected &&
      (!owner || Chat.isCurrent(owner));
    const status = document.createElement('figcaption');
    status.className = 'picture-status';
    status.setAttribute('role', 'status');
    const stateKey = () => 'picture.' + ((message.generation || 'generated') !== 'generated'
      ? (message.generation || 'unknown') : message.display === 'loaded' ? 'loaded' : message.display === 'failed' ? 'displayFailed'
        : message.display === 'interrupted' ? 'interrupted' : 'loading');
    const refreshStatus = () => { status.setAttribute('data-i18n', stateKey()); localize(status); };
    refreshStatus();
    const img = document.createElement('img');
    img.alt = message.prompt || tr('app.photo');
    img.title = tr('chat.openFullSize');
    const displayFailed = () => {
      if (!valid()) return;
      Chat.setPictureDisplay(chatId, message, ref, 'failed');
      img.hidden = true;
      refreshStatus();
      reload.hidden = false;
    };
    img.addEventListener('load', () => {
      if (!valid()) return;
      if (!img.naturalWidth) { displayFailed(); return; }
      Chat.setPictureDisplay(chatId, message, ref, 'loaded');
      refreshStatus(); scrollDown();
    });
    img.addEventListener('error', displayFailed);
    img.addEventListener('click', () => { if (valid() && message.display === 'loaded') openLightbox(img.src, img.alt); });
    const reload = actionButton(tr('picture.reload'), 'picture.reload', () => {
      if (!Chat.messages.includes(message) || Chat.convId !== chatId) return;
      Chat.setPictureDisplay(chatId, message, ref, 'unknown');
      pictureBubble(message);
    });
    reload.className = 'picture-reload';
    reload.hidden = message.display !== 'interrupted';
    fig.append(img, status, reload);
    if (message.caption) {
      const cap = document.createElement('figcaption');
      cap.textContent = message.caption;
      fig.appendChild(cap);
    }
    if (old?.el.isConnected) old.el.replaceWith(fig); else messagesEl.appendChild(fig);
    const dispose = () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    pictureViews.set(message.id, { el: fig, dispose });
    if (ref && message.display !== 'interrupted' && (!message.generation || message.generation === 'generated')) {
      Promise.resolve().then(() => Pictures.resolve(ref)).then(src => {
        if (src?.startsWith('blob:')) objectUrl = src;
        if (!valid()) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
        if (!src) { displayFailed(); return; }
        img.src = src;
      }).catch(displayFailed);
    } else img.hidden = true;
    if (Chat.canRetryImage(message)) {
      fig.appendChild(actionButton(tr('picture.again'), 'picture.again', () => {
        if (!Chat.busy && Chat.canRetryImage(message)) runImageRetry(message);
      }));
    }
    if (message.id) addActions(fig, message);
    scrollDown();
    return fig;
  }

  // A divider above the first message the model still sees word for word;
  // everything above it reaches her as the summary.
  function placeMemoryMark() {
    messagesEl.querySelectorAll('.memory-mark').forEach(el => el.remove());
    if (!Chat.summary) return;
    const first = Chat.messages[Chat.unsummarizedStart()];
    const target = first && messagesEl.querySelector('[data-id="' + first.id + '"]');
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'memory-mark';
    mark.setAttribute('data-i18n', 'chat.olderSummary');
    mark.setAttribute('data-i18n-title', 'chat.editMemory');
    localize(mark);
    mark.addEventListener('click', () => openPanel('settingsPanel', 'summaryText'));
    if (target) messagesEl.insertBefore(mark, target);
  }

  function renderConversation() {
    viewRevision++;
    summaryUIRun++;
    $('summarizeNow').disabled = false;
    $('summaryStatus').textContent = '';
    pictureViews.forEach(view => view.dispose());
    pictureViews.clear();
    Voice.cancel();
    clearWait();
    Speech.stop();
    stopAmbient();
    clearQueue();
    messagesEl.textContent = '';
    if (!Chat.messages.length) renderEmpty();
    else Chat.messages.forEach(m => (Chat.isPicture(m) ? pictureBubble(m) : messageBubble(m)));
    placeMemoryMark();
    renderMeta();
  }

  // ── Lightbox ──
  const lightbox = $('lightbox');
  function openLightbox(src, alt) {
    $('lightboxImg').src = src;
    $('lightboxImg').alt = alt;
    $('lightboxOpen').href = src;
    lightbox.hidden = false;
  }
  lightbox.addEventListener('click', e => { if (e.target !== $('lightboxOpen')) lightbox.hidden = true; });

  // ── Pictures ──
  // A persisted operation keeps the same message ID through every outcome.
  async function paint(prompt, aspect, source, owner) {
    if (!Chat.isCurrent(owner)) return;
    const message = Chat.createPicture(owner, prompt, aspect);
    pictureBubble(message);
    Chat.effect(owner, 1);
    track('image_generation_started', { source });
    try {
      const ref = await Pictures.draw(prompt, aspect, Chat.ids(), { owner, signal: owner.signal, valid: () => Chat.isCurrent(owner) });
      if (!Chat.updatePicture(owner, message, { image: ref, generation: 'generated', display: 'unknown', retryable: false })) {
        Pictures.forget(ref); return;
      }
      track('image_generation_completed', { source });
      pictureBubble(message);
    } catch (err) {
      if (!Chat.isCurrent(owner)) return;
      track('image_generation_failed', { source, blocked: Boolean(err.blocked), timed_out: Boolean(err.timedOut) });
      Chat.updatePicture(owner, message, { generation: err.blocked ? 'blocked' : 'failed',
        retryable: err.retryable === true || (!err.blocked && err instanceof TypeError) });
      pictureBubble(message);
    } finally {
      Chat.effect(owner, -1);
      if (Chat.isCurrent(owner) && owner.kind === 'image') Chat.finishTurn(owner);
    }
  }

  function aspectValue(name) { return Pictures.ASPECTS[name] || Pictures.ASPECTS.portrait; }

  function parseImageCommand(text) {
    let prompt = text.replace(/^\/(image|img)\b\s*/i, '').trim();
    let aspect = aspectValue(Chat.settings.aspect);
    const m = prompt.match(/\s+(portrait|landscape|square)\s*$/i);
    if (m) { aspect = aspectValue(m[1].toLowerCase()); prompt = prompt.slice(0, m.index).trim(); }
    return { prompt, aspect };
  }

  function runImageRetry(message) {
    const owner = Chat.beginTurn('', { kind: 'image', retryImageId: message.id });
    if (!owner) return;
    prepareTurn(owner);
    paint(message.prompt, message.aspect, 'retry', owner).then(() => drainQueue(owner));
  }

  function renderMeta() {
    const s = Chat.settings;
    const meta = $('chatMeta');
    meta.textContent = '';
    const b = document.createElement('button');
    b.type = 'button';
    const model = s.provider === 'cloud' ? '' : Chat.modelFor(s.provider) || tr('provider.' + s.provider + '.name');
    b.textContent = tr('persona.' + s.persona + '.name') + ' · ' + (s.provider === 'cloud' ? tr('provider.cloud.name') : model);
    b.setAttribute('data-i18n-title', 'chat.changePersonality');
    localize(b);
    b.addEventListener('click', () => openPanel('settingsPanel'));
    meta.appendChild(b);
  }

  // ── Queue ──
  // Messages typed while she's replying wait their turn, as in waifu-companion.
  let queue = []; // {text, source, el}
  let queuePaused = false;
  let ambientPaused = false;
  function clearQueue() {
    queue.forEach(q => q.el.remove());
    queue = [];
    queuePaused = false;
  }
  function renderQueued() {
    queue.forEach(q => {
      q.el.querySelector('.queue-actions')?.remove();
      const controls = document.createElement('div'); controls.className = 'queue-actions';
      const label = document.createElement('small');
      label.setAttribute('data-i18n', queuePaused ? 'chat.queuePaused' : 'chat.queued'); localize(label);
      controls.appendChild(label);
      if (queuePaused) controls.appendChild(actionButton(tr('chat.resumeQueue'), 'chat.resumeQueue', () => {
        if (Chat.busy) return;
        queuePaused = false; renderQueued();
        const next = queue.shift(); next.el.remove(); runTurn({ text: next.text, source: 'queued' });
      }));
      controls.appendChild(actionButton(tr('chat.removeQueued'), 'chat.removeQueued', () => {
        queue = queue.filter(item => item !== q); q.el.remove();
      }));
      q.el.appendChild(controls);
    });
  }
  function enqueue(text, source) {
    input.value = '';
    const el = bubble('user queued', text);
    queue.push({ text, source, el });
    renderQueued();
  }

  // ── Ambient: she speaks up when the visitor goes quiet ──
  let ambientTimer = null;
  let ambientRun = 0; // unprompted messages since the visitor last wrote
  function stopAmbient() {
    clearTimeout(ambientTimer);
    ambientTimer = null;
  }
  function scheduleAmbient() {
    stopAmbient();
    const s = Chat.settings;
    if (ambientPaused || !s.ambient || !Chat.messages.length || ambientRun >= s.ambientMax) return;
    ambientTimer = setTimeout(fireAmbient, Math.max(15, s.ambientDelay) * 1000);
  }
  function fireAmbient() {
    ambientTimer = null;
    const panelOpen = Array.from(document.querySelectorAll('.panel')).some(p => !p.hidden);
    // Not while she's busy or talking, or the visitor is typing or away.
    if (Chat.busy || queue.length || Speech.speaking || input.value.trim() || panelOpen || document.hidden) {
      scheduleAmbient();
      return;
    }
    ambientRun++;
    runTurn({ ambient: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ambientTimer) scheduleAmbient(); });

  // ── Sending ──
  function clearWait() {
    waitTimers.forEach(clearTimeout); waitTimers = [];
    waitStatus?.remove(); waitStatus = null; waitOwner = null;
  }
  function startWait(owner, reply) {
    clearWait(); waitOwner = owner;
    [8000, 20000].forEach((delay, index) => waitTimers.push(setTimeout(() => {
      if (!Chat.isCurrent(owner) || owner.status !== 'pending' || waitOwner !== owner || !reply.isConnected) return;
      if (!waitStatus) { waitStatus = document.createElement('div'); waitStatus.className = 'wait-status'; waitStatus.setAttribute('role', 'status'); reply.appendChild(waitStatus); }
      waitStatus.setAttribute('data-i18n', index ? 'chat.longWait' : 'chat.stillWorking'); localize(waitStatus);
    }, delay)));
  }
  function updateComposer() {
    const button = $('sendBtn');
    const stopping = Chat.stoppable;
    button.dataset.mode = stopping ? 'stop' : 'send';
    button.setAttribute('data-i18n-aria-label', stopping ? 'composer.stop' : 'composer.send');
    button.setAttribute('data-i18n-title', stopping ? 'composer.stop' : 'composer.send');
    button.textContent = stopping ? '■' : '➤'; localize(button);
    stage.classList.toggle('busy', Chat.busy);
    messagesEl.querySelectorAll('.retry').forEach(b => { b.disabled = !Chat.canRetry(b.closest('[data-id]').dataset.id); });
  }
  Chat.onTurnChange(owner => {
    const aborted = Boolean(owner?.signal.aborted);
    if (owner !== observedOwner || aborted !== observedAbort) {
      Speech.stop(); Voice.cancel(); clearWait();
      observedOwner = owner; observedAbort = aborted;
      if (aborted) {
        stopAmbient();
        for (const m of Chat.messages.filter(Chat.isPicture)) pictureBubble(m);
      }
    }
    updateComposer();
  });
  function prepareTurn(owner) {
    Speech.stop(); Voice.cancel(); stopAmbient();
    observedOwner = owner; observedAbort = false;
    clearWait();
    if (!owner.ambient) { ambientRun = 0; ambientPaused = false; }
    messagesEl.querySelectorAll('.starters, .msg.info:not(.keep)').forEach(m => m.remove());
    updateComposer();
  }
  function stopTurn() {
    queuePaused = true; ambientPaused = true;
    stopAmbient(); Speech.stop(); Voice.cancel(); clearWait();
    Chat.stop();
    renderQueued();
    updateComposer();
    Sprites.setState('idle');
  }
  // All submission sources share this guard. Only the primary Stop click cancels.
  function send(text, source = 'typed') {
    text = (text || '').trim();
    if (!text || Chat.isDuplicate(text) || queue.some(q => Chat.normalizeText(q.text) === Chat.normalizeText(text))) return;
    if (Chat.busy || (queuePaused && queue.length)) {
      if (Chat.settings.queue) enqueue(text, source);
      return;
    }
    runTurn({ text, source });
  }
  function drainQueue(owner) {
    if (!Chat.isCurrent(owner) || Chat.busy || queuePaused) return;
    if (queue.length) {
      const next = queue.shift(); next.el.remove();
      runTurn({ text: next.text, source: 'queued' });
    }
  }

  async function runTurn({ text, source, ambient = false, retryId }) {
    const command = !ambient && /^\/(image|img)\b/i.test(text) ? parseImageCommand(text) : null;
    if (command && !command.prompt) { bubble('info', tr('chat.imageHelp')); return; }
    const previous = Chat.lastReply();
    const owner = Chat.beginTurn(ambient ? Chat.ambientPrompt() : text,
      { ambient, retryId, kind: command ? 'image' : 'chat' });
    if (!owner) return;
    input.value = '';
    prepareTurn(owner);
    const revision = viewRevision;
    const valid = () => Chat.isCurrent(owner) && revision === viewRevision;
    if (!ambient && !retryId) messageBubble(owner.userMessage);
    updateComposer();
    if (command) { await paint(command.prompt, command.aspect, 'command', owner); drainQueue(owner); return; }
    const reply = bubble('assistant typing', '');
    reply.dataset.id = owner.replyMessage.id;
    startWait(owner, reply);
    clearTimeout(idleTimer); Sprites.setState('thinking');
    // Ownership exists before either asynchronous branch starts.
    const aspect = aspectValue(Chat.settings.aspect);
    if (!ambient) Chat.effect(owner, 1);
    const pictureDecision = ambient ? Promise.resolve(null)
      : Pictures.decide(text, previous, Chat.ids(), { owner, signal: owner.signal, valid });
    const provider = Chat.settings.provider;
    const model = provider === 'cloud' ? 'cloud' : Chat.modelFor(provider) || '';
    const startedAt = Date.now();
    let streaming = false, tagged = false, done = null, speechRouting = null;
    const firstChunk = () => {
      if (streaming) return;
      streaming = true;
      track('llm_stream_started', { provider, model, time_to_first_chunk_ms: Date.now() - startedAt });
    };
    if (ambient) track('ambient_message', { provider, persona: Chat.settings.persona, run: ambientRun });
    else track('chat_message_sent', { provider, persona: Chat.settings.persona, source, turn: Chat.messages.filter(m => m.role === 'user').length });
    track('llm_request_started', { provider, model, is_streaming: true });
    await Chat.send(owner.text, {
      onEmotion(name) {
        if (!valid()) return;
        tagged = Boolean(name);
        if (name) Sprites.setEmotion(name); else Sprites.setState('speaking');
      },
      onText(visible) {
        if (!valid()) return;
        if (visible.trim()) { clearWait(); firstChunk(); }
        setText(reply, visible); scrollDown();
      },
      onDone(message) {
        if (!valid()) return;
        clearWait(); done = message;
        reply.classList.remove('typing'); setText(reply, message.content); addActions(reply, message);
        if (!tagged && message.emotion) Sprites.setEmotion(message.emotion);
        const speechPlan = Speech.settings.enabled ? Speech.prepareRouting(message.content) : null;
        const tasks = ambient ? [] : ['sprites_emotion_v1'];
        if (speechPlan?.needsDecision && !speechPlan.finished && !speechPlan.pending) tasks.push('sprites_tts_language_v1');
        const decision = tasks.length ? Chat.askDecisions(tasks, { reply: message.content, user_message: text?.slice(0, 300),
          ...(tasks.includes('sprites_tts_language_v1') ? { conversation_language: speechPlan.previousLang, recent_context: Chat.recentContext().slice(0, -1),
            ...(speechPlan.text !== message.content.trim() ? { spoken_reply: speechPlan.text } : {}) } : {}) }, owner) : null;
        const expression = Sprites.current;
        decision?.then(answers => {
          if (!valid() || Sprites.current !== expression) return;
          const e = answers?.sprites_emotion_v1;
          if (e && Sprites.EMOTIONS.includes(e.choice_id) && e.choice_id !== message.emotion) Sprites.setEmotion(e.choice_id);
        }).catch(() => {});
        speechRouting = speechPlan ? Speech.finishRouting(speechPlan, decision, () => valid() && Speech.settings.enabled) : null;
        track('llm_stream_completed', { provider, model, success: true, total_time_ms: Date.now() - startedAt, reply_chars: message.content.length, emotion: message.emotion || '(none)' });
        later(() => { if (valid()) Sprites.setState('idle'); }, RETURN_TO_IDLE_MS);
      },
      onError(msg, message) {
        // A Stop callback belongs to this attempt even though its signal is now aborted.
        if (Chat.current !== owner || revision !== viewRevision) return;
        clearWait(); reply.classList.remove('typing');
        queuePaused = true; renderQueued();
        setText(reply, message.content); addActions(reply, message); showAttemptStatus(reply, message);
        track('llm_stream_completed', { provider, model, success: false, total_time_ms: Date.now() - startedAt });
        if (message.status === 'failed') Sprites.setState('error');
      },
    }, { owner });
    if (!valid()) return;
    updateComposer();
    if (matchMedia('(pointer: fine)').matches && !ambient) input.focus();
    const spoken = done ? speakReply(done.content, false, speechRouting, owner) : Promise.resolve();
    if (done) afterReply(done, reply, owner);
    // Waiting for a decision does not lock the composer; a newer send cancels this owner.
    pictureDecision.then(prompt => {
      if (valid() && done && prompt) return paint(prompt, aspect, 'auto', owner);
    }).catch(() => {}).finally(() => {
      if (!ambient) Chat.effect(owner, -1);
    });
    if (!done) { queuePaused = true; renderQueued(); }
    drainQueue(owner);
    if (done) spoken.then(() => { if (valid() && !Chat.busy && !queue.length) scheduleAmbient(); }).catch(() => {});
  }

  function afterReply(message, el, owner) {
    const valid = () => Chat.isCurrent(owner) && el.isConnected;
    const s = Chat.settings;
    if (s.romaji && Chat.needsRomaji(message.content)) {
      Chat.romanize(message, owner).then(t => { if (t && valid()) showRomaji(el, t); }).catch(() => {});
    }
    const meta = Chat.historyIndex().find(h => h.id === owner.chatId);
    if (s.autoTitles && meta && !meta.named && Chat.messages.length >= 2) {
      Chat.generateTitle(owner.chatId, owner).then(t => { if (t && valid() && !$('historyPanel').hidden) renderHistory(); });
    }
    Chat.summarize(false, owner).then(changed => {
      if (!changed || !valid()) return;
      track('memory_summarized', { source: 'auto' }); placeMemoryMark();
      if (!$('settingsPanel').hidden) { $('summaryText').value = Chat.summary; showSummarySize(); }
    }).catch(() => {});
  }

  $('sendBtn').addEventListener('click', e => {
    // A second click from a double-click Send gesture is a duplicate submission.
    if (Chat.stoppable && e.detail < 2) stopTurn(); else send(input.value);
  });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); send(input.value);
  });
  $('composer').addEventListener('submit', e => { e.preventDefault(); send(input.value); });

  // ── Voice ──
  const micBtn = $('micBtn');
  const MIC_KEYS = { idle: 'composer.micIdle', starting: 'composer.micStarting', listening: 'composer.micListening', transcribing: 'composer.micTranscribing' };
  const micPlaceholder = state => tr(MIC_KEYS[state] || 'composer.micIdle');
  Voice.init(micBtn, {
    ids: Chat.ids,
    onState(state) {
      micBtn.dataset.state = state;
      input.placeholder = micPlaceholder(state);
      if (state === 'starting') { Speech.stop(); stopAmbient(); } // don't record her own voice
      if (Chat.busy) return;
      if (state === 'listening' || state === 'transcribing') {
        clearTimeout(idleTimer);
        Sprites.setState(state === 'listening' ? 'listening' : 'thinking');
      } else if (state === 'idle' && Sprites.current.name === 'listening') {
        later(() => Sprites.setState('idle'), 1000); // too short to transcribe, or mic failed
      }
    },
    onText(text) {
      track('voice_input_used', { engine: 'proxy' });
      const combined = (input.value.trim() + ' ' + text).trim();
      if (display.voiceAutoSend && (!Chat.busy || Chat.settings.queue)) {
        send(combined, 'voice');
      } else {
        input.value = combined;
        input.focus();
        if (!Chat.busy) later(() => Sprites.setState('idle'), 4000);
      }
    },
    onError(msg) {
      messagesEl.querySelectorAll('.starters').forEach(el => el.remove());
      bubble('error', msg);
      if (!Chat.busy) {
        Sprites.setState('error');
        later(() => Sprites.setState('idle'), 4000);
      }
    },
  });

  // ── Panels ──
  function openPanel(id, focusId) {
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== id || (!focusId && !p.hidden); });
    if (id === 'historyPanel') renderHistory();
    if (id === 'settingsPanel') renderSettings();
    if (!$(id).hidden) {
      track(id === 'settingsPanel' ? 'settings_opened' : 'history_opened', { source: focusId ? 'memory_mark' : 'user' });
      if (focusId) { $(focusId).scrollIntoView({ block: 'center' }); $(focusId).focus(); }
    }
  }
  function closePanels() { document.querySelectorAll('.panel').forEach(p => { p.hidden = true; }); }
  $('settingsBtn').addEventListener('click', () => openPanel('settingsPanel'));
  $('historyBtn').addEventListener('click', () => openPanel('historyPanel'));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanels));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanels(); });

  $('newBtn').addEventListener('click', () => {
    Chat.newConversation();
    renderConversation();
    closePanels();
    track('conversation_new');
    Sprites.setState('idle');
  });

  // ── History ──
  function timeAgo(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return tr('history.justNow');
    if (min < 60) return tr('history.minutesAgo', { count: min });
    if (min < 1440) return tr('history.hoursAgo', { count: Math.round(min / 60) });
    return new Date(ms).toLocaleDateString();
  }

  function renderHistory() {
    const list = $('historyList');
    list.textContent = '';
    const items = Chat.historyIndex();
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'note';
      p.setAttribute('data-i18n', 'history.empty');
      localize(p);
      list.appendChild(p);
      return;
    }
    items.forEach(h => {
      const row = document.createElement('div');
      row.className = 'history-item' + (h.id === Chat.convId ? ' current' : '');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'history-open';
      const title = document.createElement('span');
      title.dir = 'auto';
      title.textContent = h.title;
      const meta = document.createElement('small');
      const persona = Chat.PERSONAS[h.persona];
      meta.textContent = (persona ? tr('persona.' + h.persona + '.name') + ' · ' : '') +
        tr('history.count', { count: h.count }) + ' · ' + timeAgo(h.updated);
      open.append(title, meta);
      open.addEventListener('click', () => {
        if (Chat.openConversation(h.id)) { renderConversation(); closePanels(); }
      });
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'history-del';
      rename.title = tr('history.rename');
      rename.setAttribute('aria-label', tr('history.renameFor', { title: h.title }));
      rename.innerHTML = '&#9998;';
      rename.addEventListener('click', () => {
        const name = prompt(tr('history.namePrompt'), h.title);
        if (name && name.trim()) { Chat.renameConversation(h.id, name); renderHistory(); }
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'history-del';
      del.title = tr('history.delete');
      del.setAttribute('aria-label', tr('history.deleteFor', { title: h.title }));
      del.textContent = '✕';
      del.addEventListener('click', () => {
        const wasCurrent = h.id === Chat.convId;
        Chat.deleteConversation(h.id);
        if (wasCurrent) renderConversation();
        renderHistory();
      });
      row.append(open, rename, del);
      list.appendChild(row);
    });
  }

  $('clearAll').addEventListener('click', () => {
    if (!confirm(tr('settings.deleteAllConfirm'))) return;
    Chat.historyIndex().forEach(h => Chat.deleteConversation(h.id));
    Chat.newConversation();
    renderConversation();
    renderHistory();
  });

  $('exportChats').addEventListener('click', () => {
    const data = Chat.exportAll();
    if (!data.chats.length) { alert(tr('settings.exportNone')); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'waifu-sprites-chats-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    track('settings_action', { action: 'export_chats' });
  });

  // ── Settings ──
  function optionButton(labelKey, descKey, checked, onPick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(checked));
    const name = document.createElement('span');
    name.setAttribute('data-i18n', labelKey);
    const small = document.createElement('small');
    small.setAttribute('data-i18n', descKey);
    b.append(name, small);
    localize(b);
    b.addEventListener('click', onPick);
    return b;
  }

  function renderSettings() {
    const s = Chat.settings;
    const personaList = $('personaList');
    personaList.textContent = '';
    personaList.setAttribute('role', 'radiogroup');
    Object.entries(Chat.PERSONAS).forEach(([key, p]) => {
      personaList.appendChild(optionButton('persona.' + key + '.name', 'persona.' + key + '.desc', s.persona === key, () => {
        s.persona = key;
        Chat.saveSettings();
        track('persona_updated', { persona: key });
        renderSettings();
        renderMeta();
        if (!Chat.messages.length) renderConversation();
      }));
    });
    $('customPromptBox').hidden = s.persona !== 'custom';
    $('customPrompt').value = s.customPrompt;
    $('extraPrompt').value = s.extraPrompt;

    $('aboutUser').value = s.aboutUser;
    $('summaryText').value = Chat.summary;
    showSummarySize();
    $('summaryStatus').textContent = '';
    $('memorySize').value = s.memorySize;
    $('memorySizeValue').textContent = s.memorySize;
    $('summaryLength').value = s.summaryLength;
    $('includeTime').checked = s.includeTime;
    $('includeBattery').checked = s.includeBattery;
    $('batteryRow').hidden = !navigator.getBattery;
    $('contextPeek').open = false;

    $('replyLanguage').value = s.language;
    $('romaji').checked = s.romaji;
    $('queueMessages').checked = s.queue;
    $('autoTitles').checked = s.autoTitles;
    $('ambient').checked = s.ambient;
    $('ambientBox').hidden = !s.ambient;
    $('ambientDelay').value = String(s.ambientDelay);
    $('ambientMax').value = String(s.ambientMax);
    $('ambientPrompt').value = Chat.ambientPrompt();

    const providerList = $('providerList');
    providerList.textContent = '';
    providerList.setAttribute('role', 'radiogroup');
    Object.entries(Chat.PROVIDERS).forEach(([key, p]) => {
      providerList.appendChild(optionButton('provider.' + key + '.name', 'provider.' + key + '.desc', s.provider === key, () => {
        s.provider = key;
        Chat.saveSettings();
        track('llm_provider_changed', { provider: key, enabled: true });
        renderSettings();
        renderMeta();
      }));
    });

    const p = Chat.PROVIDERS[s.provider];
    const own = s.provider !== 'cloud';
    $('baseUrlRow').hidden = s.provider !== 'custom';
    $('keyRow').hidden = !own;
    $('modelRow').hidden = !own;
    $('baseUrl').value = s.customBaseUrl;
    $('apiKey').value = s.keys[s.provider] || '';
    $('modelName').value = s.models[s.provider] || '';
    $('modelName').placeholder = p.defaultModel || 'model-id';
    $('keyLink').hidden = !p.keyUrl;
    if (p.keyUrl) $('keyLink').href = p.keyUrl;
    $('providerNote').textContent = own
      ? tr('settings.providerNoteOwn', { target: s.provider === 'custom' ? tr('settings.providerTargetEndpoint') : tr('provider.' + s.provider + '.name') })
      : tr('settings.providerNoteCloud');

    const aspectList = $('aspectList');
    aspectList.textContent = '';
    aspectList.setAttribute('role', 'radiogroup');
    [['portrait'], ['square'], ['landscape']].forEach(([key]) => {
      aspectList.appendChild(optionButton('aspect.' + key + '.label', 'aspect.' + key + '.desc', s.aspect === key, () => {
        s.aspect = key;
        Chat.saveSettings();
        renderSettings();
      }));
    });

    renderInterfaceLanguage();
    buildReplyLanguages();
  }

  // ── Interface language ──
  // The picker lists "Use device language" plus every locale's own name; a
  // switch is instant and never reloads the page.
  function detectedName() {
    const meta = I18n && I18n.localeInfo(I18n.detect());
    return meta ? meta.name : 'English';
  }

  function renderInterfaceLanguage() {
    const select = $('interfaceLanguage');
    const current = (I18n && I18n.choice) || 'auto';
    select.textContent = '';
    select.appendChild(new Option(tr('settings.deviceLanguage') + ' · ' + detectedName(), 'auto'));
    (I18n ? I18n.locales() : []).forEach(meta => select.appendChild(new Option(meta.name, meta.code)));
    select.value = current;
  }

  // Reply-language values stay the English names sent in the system prompt;
  // only the visible labels become the language's own name.
  function buildReplyLanguages() {
    const select = $('replyLanguage');
    select.textContent = '';
    select.appendChild(new Option(tr('settings.yourLanguage'), ''));
    Chat.LANGUAGES.forEach(name => select.appendChild(new Option(I18n ? I18n.languageName(name) : name, name)));
    select.value = Chat.settings.language || '';
  }

  $('interfaceLanguage').addEventListener('change', e => {
    const code = e.target.value;
    if (I18n) I18n.setLocale(code);
    track('interface_language_changed', { locale: code });
  });

  if (I18n) I18n.onChange(() => {
    // Static attributes are re-applied by the runtime; this refreshes the parts
    // built in JavaScript and the few strings that depend on live state.
    applyDisplay();
    applyRadio();
    applySpeech();
    renderMeta();
    input.placeholder = micPlaceholder(Voice.state);
    Sprites.refreshLabel();
    renderInterfaceLanguage();
    buildReplyLanguages();
    if (!$('historyPanel').hidden) renderHistory();
    if (!$('settingsPanel').hidden) renderSettings();
    else $('summarySizeStatus').textContent = tr('memory.limitNote');
    if (!Chat.messages.length) renderConversation();
    updateComposer();
    renderQueued();
    placeMemoryMark();
  });

  renderInterfaceLanguage();
  buildReplyLanguages();

  // Saves a settings control into Chat.settings. kind: text, check, number or select.
  function bindSetting(id, key, kind, after) {
    const el = $(id);
    const ev = kind === 'text' ? 'input' : 'change';
    el.addEventListener(ev, () => {
      const s = Chat.settings;
      s[key] = kind === 'check' ? el.checked : kind === 'number' ? +el.value : el.value;
      Chat.saveSettings();
      if (kind !== 'text') track('setting_changed', { setting: key, setting_value: String(s[key]) });
      if (after) after(s[key]);
    });
  }
  bindSetting('customPrompt', 'customPrompt', 'text');
  bindSetting('extraPrompt', 'extraPrompt', 'text');
  bindSetting('aboutUser', 'aboutUser', 'text');
  bindSetting('memorySize', 'memorySize', 'number', v => { $('memorySizeValue').textContent = v; });
  $('memorySize').addEventListener('input', e => { $('memorySizeValue').textContent = e.target.value; });
  bindSetting('summaryLength', 'summaryLength', 'select');
  bindSetting('includeTime', 'includeTime', 'check');
  bindSetting('includeBattery', 'includeBattery', 'check');
  bindSetting('replyLanguage', 'language', 'select');
  bindSetting('romaji', 'romaji', 'check');
  bindSetting('queueMessages', 'queue', 'check');
  bindSetting('autoTitles', 'autoTitles', 'check');
  bindSetting('ambient', 'ambient', 'check', on => {
    $('ambientBox').hidden = !on;
    ambientRun = 0;
    if (on) scheduleAmbient(); else stopAmbient();
  });
  bindSetting('ambientDelay', 'ambientDelay', 'number', () => { if (ambientTimer) scheduleAmbient(); });
  bindSetting('ambientMax', 'ambientMax', 'number');
  bindSetting('ambientPrompt', 'ambientPrompt', 'text');

  function showSummarySize(message) {
    $('summarySizeStatus').textContent = message || (window.ConversationBudget.bytes($('summaryText').value) + ' / ' + window.ConversationBudget.limits.summary + ' bytes');
  }
  $('summaryText').addEventListener('input', () => showSummarySize());
  $('summaryText').addEventListener('change', e => {
    try { Chat.setSummary(e.target.value); placeMemoryMark(); showSummarySize(); }
    catch (error) { e.target.value = Chat.summary; showSummarySize(error.message); }
  });
  $('summarizeNow').addEventListener('click', async () => {
    const btn = $('summarizeNow');
    const status = $('summaryStatus');
    if (Chat.messages.length < 2 && !Chat.memoryPending) { status.textContent = tr('memory.tooShort'); return; }
    const run = ++summaryUIRun, revision = Chat.revision, view = viewRevision;
    const valid = () => run === summaryUIRun && revision === Chat.revision && view === viewRevision;
    btn.disabled = true;
    status.textContent = tr('memory.summarizing');
    try {
      const changed = await Chat.summarize(true);
      if (!valid()) return;
      status.textContent = changed ? tr(Chat.memoryPending ? 'memory.partUpdated' : 'memory.updated') : tr('memory.nothingOlder');
      if (changed) {
        track('manual_summary_triggered');
        $('summaryText').value = Chat.summary;
        showSummarySize();
        placeMemoryMark();
      }
    } catch (e) {
      if (valid()) status.textContent = e.message || tr('memory.failed');
    } finally {
      if (run === summaryUIRun) btn.disabled = false;
    }
  });
  $('contextPeek').addEventListener('toggle', async () => {
    if (!$('contextPeek').open) return;
    const revision = Chat.revision, view = viewRevision;
    const valid = () => revision === Chat.revision && view === viewRevision && $('contextPeek').open;
    try {
      const msgs = await Chat.modelMessages(null);
      if (valid()) $('contextView').textContent = msgs.map(m => m.role.toUpperCase() + ':\n' + m.content).join('\n\n');
    } catch (e) { if (valid()) $('contextView').textContent = e.message; }
  });

  $('baseUrl').addEventListener('change', e => { Chat.settings.customBaseUrl = e.target.value.trim(); Chat.saveSettings(); });
  $('apiKey').addEventListener('change', e => { Chat.settings.keys[Chat.settings.provider] = e.target.value.trim(); Chat.saveSettings(); });
  $('modelName').addEventListener('change', e => { Chat.settings.models[Chat.settings.provider] = e.target.value.trim(); Chat.saveSettings(); renderMeta(); });

  // ── Start: reopen the most recent chat ──
  const recent = Chat.historyIndex()[0];
  if (!(recent && Chat.openConversation(recent.id))) Chat.newConversation();
  renderConversation();
  activity();
})();
