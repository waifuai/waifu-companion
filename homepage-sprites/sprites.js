/**
 * sprites.js: the sprite player.
 *
 * Every state and emotion is a short looping MP4 clip with one or two
 * alternates. Two <video> elements are stacked: the next clip loads in the
 * hidden one and only swaps in (with a short crossfade) once it can play, so a
 * clip still downloading never shows a blank frame.
 *
 * Emotions go through RANSOC: each emotion has a mass that drops when it is
 * shown and recovers while others are shown, so the same face never plays
 * twice in a row and recently seen ones are less likely. When a detected
 * emotion was just shown, a similar one plays instead.
 */
const Sprites = (() => {
  const BASE = 'https://cdn.jsdelivr.net/gh/waifuai/waifuai.github.io@b81d52dd0a63c1658d5592013056114d7408d705/waifu-sprites/videos/';

  const STATES = {
    idle: 1, listening: 2, speaking: 3, thinking: 4, typing: 5, searching: 6,
    calculating: 7, fixing: 8, success: 9, error: 10, alert: 11, sleeping: 12,
  };
  const EMOTIONS = {
    happy: 1, funny: 2, empathetic: 3, curious: 4, confused: 5, amazed: 6,
    sorry: 7, found_it: 8, annoyed: 9, overwhelmed: 10, planning: 11, love: 12,
  };
  const tr = key => (window.WaifuI18n ? window.WaifuI18n.t(key) : key);

  // Clips with a second alternate (most have one: N.mp4 and N-1.mp4).
  const EXTRA_VARIANTS = { '4': ['4-2'], 'e2': ['e2-2'] };

  const SIMILAR = {
    happy: ['love', 'funny', 'found_it'],
    funny: ['happy', 'amazed', 'love'],
    empathetic: ['sorry', 'love', 'confused'],
    curious: ['confused', 'planning', 'amazed'],
    confused: ['curious', 'overwhelmed', 'empathetic'],
    amazed: ['found_it', 'happy', 'funny'],
    sorry: ['empathetic', 'confused', 'love'],
    found_it: ['amazed', 'happy', 'planning'],
    annoyed: ['overwhelmed', 'confused', 'sorry'],
    overwhelmed: ['annoyed', 'confused', 'empathetic'],
    planning: ['curious', 'found_it', 'confused'],
    love: ['happy', 'empathetic', 'funny'],
  };

  // Fallback when the reply carries no emotion tag. First match wins.
  const KEYWORDS = [
    [['haha', 'lol', 'lmao', 'hehe', 'funny', 'silly'], 'funny'],
    [['love', 'thank you', 'sweet', 'cutie', 'heart', 'glad', 'welcome'], 'love'],
    [['sorry', 'apolog', 'unfortunately', 'my bad', 'oops'], 'sorry'],
    [['a lot', 'so many', 'overwhelm', 'massive'], 'overwhelmed'],
    [['wow', 'amazing', 'incredible', 'fascinating', 'woah'], 'amazed'],
    [['hmm', 'confus', 'unclear', 'not sure'], 'confused'],
    [['again', 'already', 'seriously'], 'annoyed'],
    [['what is', 'how does', 'curious', 'interesting', 'tell me', 'what if'], 'curious'],
    [['found', 'perfect', 'exactly', 'done', 'got it'], 'found_it'],
    [['let me', 'going to', 'step by step', 'plan'], 'planning'],
    [['understand', 'tough', 'worry', 'breathe', 'here for you'], 'empathetic'],
    [['great', 'good', 'nice', 'awesome', 'wonderful', 'yay'], 'happy'],
  ];

  // ── RANSOC ──
  const LR = 0.3;
  const N = Object.keys(EMOTIONS).length;
  const SIMILARITY_BONUS = 3;
  const masses = {};
  Object.keys(EMOTIONS).forEach(k => { masses[k] = 1; });
  let lastEmotion = null;

  function weightedPick(items) {
    let total = 0;
    items.forEach(it => { total += it.weight; });
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it.name;
    }
    return items[items.length - 1].name;
  }

  function pickExcluding(exclude) {
    return weightedPick(Object.keys(masses).filter(k => k !== exclude).map(k => ({ name: k, weight: masses[k] })));
  }

  function pickSimilar(emotion) {
    const near = (SIMILAR[emotion] || []).filter(k => k !== lastEmotion);
    if (!near.length) return pickExcluding(lastEmotion);
    const items = near.map(k => ({ name: k, weight: masses[k] * SIMILARITY_BONUS }));
    Object.keys(masses).forEach(k => {
      if (k !== lastEmotion && !near.includes(k)) items.push({ name: k, weight: masses[k] });
    });
    return weightedPick(items);
  }

  function updateMass(shown) {
    lastEmotion = shown;
    Object.keys(masses).forEach(k => {
      masses[k] *= k === shown ? 1 - LR : 1 + LR / (N - 1);
      masses[k] = Math.max(0.1, Math.min(5, masses[k]));
    });
  }

  function ransocSelect(detected) {
    let pick;
    if (!EMOTIONS[detected]) {
      pick = pickExcluding(lastEmotion);
    } else if (detected === lastEmotion) {
      pick = pickSimilar(detected);
    } else {
      // A recently shown emotion (low mass) sometimes gives way to a similar one.
      let total = 0;
      Object.keys(masses).forEach(k => { total += masses[k]; });
      const swapChance = Math.max(0, 1 - masses[detected] / (total / N)) * 0.5;
      pick = Math.random() < swapChance ? pickSimilar(detected) : detected;
    }
    updateMass(pick);
    return pick;
  }

  // ── Player ──
  let videos = [];
  let front = 0;
  let labelEl = null;
  let lastClip = '';
  let loadToken = 0;
  let visible = true;
  let current = { kind: 'state', name: 'idle' };
  const listeners = [];
  let pendingMeasurement = null;
  let initialPlayback = false;

  // One result per request, including superseded attempts, so success rates
  // have an explicit denominator. No chat content or unique identifiers.
  function videoEvent(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, Object.assign({
      app_source: window.WaifuSpritesSource || 'homepage-sprites', video_host: 'jsdelivr'
    }, params));
  }
  function finishMeasurement(measurement, outcome) {
    if (!measurement || measurement.finished) return;
    measurement.finished = true;
    clearTimeout(measurement.timer);
    const duration = Math.round(performance.now() - measurement.started);
    videoEvent('sprite_video_result', {
      video_phase: measurement.phase, clip_kind: measurement.kind,
      video_outcome: outcome, load_ms: duration,
      load_bucket: duration < 1000 ? 'under_1s' : duration < 3000 ? '1_to_3s' : duration < 5000 ? '3_to_5s' : duration < 10000 ? '5_to_10s' : '10s_plus'
    });
    if (pendingMeasurement === measurement) pendingMeasurement = null;
  }


  function variantsOf(base) {
    return [base, base + '-1'].concat(EXTRA_VARIANTS[base] || []);
  }

  // A variant of base that differs from the clip playing now.
  function chooseClip(base) {
    const options = variantsOf(base).filter(v => v !== lastClip);
    return options[Math.floor(Math.random() * options.length)];
  }

  function play(clip, label) {
    lastClip = clip;
    if (labelEl) labelEl.textContent = label;
    listeners.forEach(fn => fn(current));
    if (!visible || !videos.length) return;

    finishMeasurement(pendingMeasurement, 'superseded');
    const token = ++loadToken;
    const measurement = { started: performance.now(), phase: initialPlayback ? 'subsequent' : 'initial', kind: current.kind, finished: false };
    pendingMeasurement = measurement;
    videoEvent('sprite_video_attempt', { video_phase: measurement.phase, clip_kind: measurement.kind });
    measurement.timer = setTimeout(() => finishMeasurement(measurement,
      document.visibilityState === 'visible' ? 'timeout' : 'backgrounded'), 10000);
    const next = videos[1 - front];
    const shown = videos[front];
    next.onerror = () => {
      if (token !== loadToken) return;
      finishMeasurement(measurement, 'error');
      // Fall back to the plain clip if an alternate fails to load.
      const plain = clip.replace(/-\d$/, '');
      if (plain !== clip) play(plain, label);
    };
    next.oncanplay = () => {
      if (token !== loadToken) return;
      next.oncanplay = null;
      const p = next.play();
      if (p) p.then(() => {
        if (token !== loadToken) return;
        initialPlayback = true;
        finishMeasurement(measurement, 'playing');
      }).catch(err => {
        if (token !== loadToken) return;
        finishMeasurement(measurement, err && err.name === 'NotAllowedError' ? 'autoplay_blocked' : 'play_error');
      });
      next.classList.add('front');
      shown.classList.remove('front');
      front = 1 - front;
      setTimeout(() => { if (token === loadToken) shown.pause(); }, 300);
    };
    next.src = BASE + clip + '.mp4';
  }

  function stateLabel(name) { return tr('sprite.state.' + name); }
  function emotionLabel(name) { return tr('sprite.emotion.' + name); }

  function setState(name) {
    if (!STATES[name]) return;
    current = { kind: 'state', name };
    play(chooseClip(String(STATES[name])), stateLabel(name));
  }

  function setEmotion(detected) {
    const name = ransocSelect(detected);
    current = { kind: 'emotion', name };
    play(chooseClip('e' + EMOTIONS[name]), emotionLabel(name));
    return name;
  }

  // Re-applies the current pill text after a language switch.
  function refreshLabel() {
    if (!labelEl) return;
    labelEl.textContent = current.kind === 'emotion' ? emotionLabel(current.name) : stateLabel(current.name);
  }

  function detectEmotion(text) {
    const t = (text || '').toLowerCase();
    for (const [words, emotion] of KEYWORDS) {
      if (words.some(w => t.includes(w))) return emotion;
    }
    return null;
  }

  function setVisible(on) {
    visible = !!on;
    if (!visible) { finishMeasurement(pendingMeasurement, 'hidden'); videos.forEach(v => v.pause()); }
    else if (current.kind === 'emotion') play(chooseClip('e' + EMOTIONS[current.name]), emotionLabel(current.name));
    else setState(current.name);
  }

  // Mobile browsers only autoplay muted inline video, and some still wait for a tap.
  function unlock() {
    const v = videos[front];
    if (v && v.paused && visible) v.play().catch(() => {});
  }

  // Warm the cache with the clips every chat uses, once the first clip is up.
  function prefetch() {
    // A feed impression needs only the idle clip; load other states on demand.
    if (window.WaifuSpritesEmbed) return;
    const conn = navigator.connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;
    const clips = ['2', '3', '4', '4-1', '1-1', '3-1', '2-1'];
    let i = 0;
    const nextFetch = () => {
      if (i >= clips.length) return;
      fetch(BASE + clips[i++] + '.mp4').then(r => r.blob()).catch(() => {}).then(nextFetch);
    };
    setTimeout(nextFetch, 1500);
  }

  function init(videoEls, label) {
    videos = videoEls;
    labelEl = label;
    videos.forEach(v => {
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
    });
    videos[0].classList.add('front');
    setState('idle');
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, unlock, { once: true, passive: true }));
    prefetch();
  }

  return {
    init, setState, setEmotion, detectEmotion, setVisible, refreshLabel,
    onChange: fn => listeners.push(fn),
    STATES: Object.keys(STATES),
    EMOTIONS: Object.keys(EMOTIONS),
    get current() { return current; },
  };
})();
