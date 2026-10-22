// Attempts own their resources, deadline and permission to commit preferences.
const AvatarRecovery = (() => {
  const LOAD_TIMEOUT_MS = 30000;
  let pending = null, panel;
  let state = { kind: 'empty', url: '' };
  const tr = (key, fallback) => {
    try { return window.WaifuI18n?.has(key) ? window.WaifuI18n.t(key) : fallback; }
    catch (_) { return fallback; }
  };
  const copy = {
    empty: ['avatar.empty', 'No character selected. Choose a character to show an avatar.'],
    loading: ['avatar.loading', 'Loading character… You can choose another character while you wait.'],
    failed: ['avatar.failed', 'Character could not load. Retry or choose another character. Your saved selection has been kept.'],
    stalled: ['avatar.stalled', 'Character loading timed out. Retry when your connection is ready, or choose another character.'],
    hidden: ['avatar.hidden', 'The avatar view is hidden or outside the screen. Restore the view to see your character.']
  };
  function render() {
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'avatarRecovery';
      panel.innerHTML = '<p id="avatarStatus" role="status" aria-live="polite" aria-atomic="true"></p><div class="avatar-actions"><select id="avatarChoice" aria-describedby="avatarStatus"></select><button id="avatarRetry" type="button"></button><button id="avatarRestore" type="button"></button><button id="avatarDefault" type="button"></button></div>';
      document.body.appendChild(panel);
      panel.querySelector('#avatarChoice').addEventListener('change', e => { if (e.target.value) loadModel(e.target.value).catch(() => {}); });
      panel.querySelector('#avatarRetry').addEventListener('click', () => loadModel(state.url || AppStorage.getString(AppStorage.KEYS.SELECTED_MODEL_URL, '')).catch(() => {}));
      panel.querySelector('#avatarDefault').addEventListener('click', () => loadModel(window.defaultModelUrl).catch(() => {}));
      panel.querySelector('#avatarRestore').addEventListener('click', restore);
    }
    const focused = panel.contains(document.activeElement);
    panel.hidden = state.kind === 'ready';
    panel.dataset.state = state.kind;
    const text = copy[state.kind];
    panel.querySelector('#avatarStatus').textContent = text ? tr(...text) : '';
    const select = panel.querySelector('#avatarChoice');
    const label = tr('avatar.choose', 'Choose a character');
    select.setAttribute('aria-label', label);
    const models = window.availableModels || [];
    if (select.dataset.urls !== JSON.stringify(models)) {
      select.replaceChildren(new Option(label, ''), ...models.map(m => new Option(m.name, m.url)));
      select.dataset.urls = JSON.stringify(models);
    }
    select.options[0].textContent = label;
    // Do not rebuild controls or move focus as a load progresses.
    select.value = '';
    const retry = panel.querySelector('#avatarRetry');
    retry.textContent = tr('avatar.retry', 'Retry character');
    retry.hidden = !['failed', 'stalled', 'empty'].includes(state.kind) || !(state.url || AppStorage.getString(AppStorage.KEYS.SELECTED_MODEL_URL, ''));
    const restoreButton = panel.querySelector('#avatarRestore');
    restoreButton.textContent = tr('avatar.restore', 'Restore avatar view');
    restoreButton.hidden = !['hidden', 'failed', 'stalled'].includes(state.kind) || (!window.currentModel && !(state.kind === 'hidden' && state.url));
    panel.querySelector('#avatarDefault').textContent = tr('avatar.default', 'Load default character');
    if (focused && (panel.hidden || document.activeElement.hidden)) {
      const target = window.WaifuEmbed && document.documentElement.classList.contains('embed-chat-hidden') ? 'embedChatBtn' : 'messageInput';
      (panel.hidden ? document.getElementById(target) : select)?.focus();
    }
  }
  function setState(kind, url = state.url) { state = { kind, url }; render(); }
  function outsideView() {
    const model = window.currentModel, canvas = window.app?.view;
    if (!model || !canvas) return true;
    const style = getComputedStyle(canvas);
    if (canvas.hidden || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || !model.visible || !model.renderable || model.alpha === 0 || !app.stage.visible || !app.stage.renderable || app.stage.alpha === 0) return true;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return true;
    const b = model.getBounds();
    const x = rect.left + b.x * rect.width / app.screen.width;
    const y = rect.top + b.y * rect.height / app.screen.height;
    return !Number.isFinite(x + y + b.width + b.height) || b.width <= 0 || b.height <= 0 || x + b.width * rect.width / app.screen.width <= 0 || y + b.height * rect.height / app.screen.height <= 0 || x >= innerWidth || y >= innerHeight;
  }
  function refreshVisibility() {
    if (!['ready', 'hidden'].includes(state.kind)) return;
    const kind = outsideView() ? 'hidden' : 'ready';
    if (kind !== state.kind) setState(kind);
  }
  function restore() {
    if (!window.currentModel) { if (state.url) loadModel(state.url).catch(() => {}); return; }
    const canvas = app.view;
    canvas.hidden = false;
    canvas.style.display = 'block'; canvas.style.visibility = 'visible'; canvas.style.opacity = '1';
    canvas.style.width = '100%'; canvas.style.height = '100%';
    canvas.style.transform = 'none'; canvas.style.top = '0'; canvas.style.left = '0';
    currentModel.visible = currentModel.renderable = app.stage.visible = app.stage.renderable = true;
    currentModel.alpha = app.stage.alpha = 1;
    app.renderer.resize(innerWidth, innerHeight);
    resetCurrentModelPosition();
    app.ticker.start();
    // Keep a failed replacement's retry controls after restoring the old model.
    refreshVisibility();
  }
  function cancel() { pending?.cancel(); pending = null; }
  function empty() { cancel(); setState('empty', ''); }
  window.WaifuI18n?.onChange(render);
  setInterval(refreshVisibility, 1000);
  return { get state() { return { ...state }; }, setState, refreshVisibility, empty, cancel,
    begin(attempt) { cancel(); pending = attempt; setState('loading', attempt.url); },
    owns(attempt) { return pending === attempt && !attempt.cancelled; },
    finish(attempt) { if (pending === attempt) pending = null; }, LOAD_TIMEOUT_MS };
})();
window.AvatarRecovery = AvatarRecovery;

// The default factory loses successful textures if another texture rejects.
// Our essentials middleware tracks uncached textures individually. Other
// consumers of the library retain the original pipeline.
const avatarFactory = PIXI.live2d.Live2DFactory;
avatarFactory.live2DModelMiddlewares = avatarFactory.live2DModelMiddlewares.map(middleware =>
  middleware !== avatarFactory.setupEssentials ? middleware : async (context, next) => {
    const owner = context.options.avatarAttempt;
    if (!owner) return middleware(context, next);
    if (owner.cancelled) throw new DOMException('Superseded', 'AbortError');
    const textures = context.settings.textures.map(path => {
      const base = new PIXI.BaseTexture(context.settings.resolveURL(path), { resourceOptions: { autoLoad: false, crossorigin: 'anonymous' } });
      const texture = new PIXI.Texture(base);
      owner.textures.push(texture);
      return texture;
    });
    const loaded = Promise.all(textures.map(t => t.baseTexture.resource.load()));
    loaded.catch(() => {});
    await next();
    if (owner.cancelled) { context.internalModel?.destroy(); throw new DOMException('Superseded', 'AbortError'); }
    owner.model.internalModel = context.internalModel;
    owner.model.emit('modelLoaded', context.internalModel);
    await loaded;
    if (owner.cancelled) throw new DOMException('Superseded', 'AbortError');
    owner.model.textures = textures;
    owner.model.emit('textureLoaded', textures);
  });

async function loadModel(modelUrl, source = 'user') {
  if (!modelUrl || !String(modelUrl).trim()) { AvatarRecovery.empty(); return null; }
  let rejectCancelled;
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
  const attempt = { url: modelUrl, model: null, textures: [], cancelled: false, disposed: false,
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      const model = this.model;
      if (model) {
        model.parent?.removeChild(model);
        // Library destroy assumes an internal model even before moc creation.
        if (!model.internalModel) model.internalModel = { destroy() {} };
        try { model.destroy({ children: true }); }
        catch (error) { debugError('Avatar cleanup failed', error); }
      }
      this.textures.forEach(t => {
        try { if (!t.destroyed) t.destroy(true); }
        catch (error) { debugError('Avatar texture cleanup failed', error); }
      });
    },
    cancel() { this.cancelled = true; this.dispose(); rejectCancelled(new DOMException('Superseded', 'AbortError')); }
  };
  AvatarRecovery.begin(attempt);
  let timer;
  try {
    attempt.model = new PIXI.live2d.Live2DModel({ autoUpdate: false });
    const loading = avatarFactory.setupLive2DModel(attempt.model, modelUrl, { autoUpdate: false, avatarAttempt: attempt });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Avatar load timed out')), AvatarRecovery.LOAD_TIMEOUT_MS); });
    await Promise.race([loading, cancelled, deadline]);
    if (!AvatarRecovery.owns(attempt)) return null;
    const model = attempt.model;
    model.__modelUrl = modelUrl;
    model.scale.set(0.4); model.position.set(innerWidth / 2, innerHeight / 2); model.anchor.set(0.5, 0.25);
    const saved = window.loadModelSavedPosition?.(modelUrl);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) model.position.set(saved.x, saved.y);
    const zoom = window.loadModelSavedZoom?.(modelUrl);
    if (Number.isFinite(zoom) && zoom > 0) model.scale.set(zoom);
    window.fitEmbedModel?.(model);
    model.interactive = model.buttonMode = true;
    window.setupModelInteractions?.(model); window.setupDragging?.(model); window.setupZooming?.(); window.setupWindowResize?.();
    app.stage.addChild(model);
    if (!window.allowMultipleModels) {
      app.stage.children.filter(m => m !== model && m.__modelUrl).forEach(m => {
        app.stage.removeChild(m);
        try { m.destroy({ children: true, texture: true, baseTexture: true }); }
        catch (error) { debugError('Previous avatar cleanup failed', error); }
      });
    }
    currentModel = model; currentModelUrl = modelUrl;
    currentModelName = availableModels.find(m => m.url === modelUrl)?.name || 'Character';
    model.autoUpdate = true;
    if (source !== 'initial') AppStorage.setString(AppStorage.KEYS.SELECTED_MODEL_URL, modelUrl);
    // Optional UI/effects failures must not destroy an already committed model.
    try {
      window.createParticleSystem?.(); window.startAnimationLoop?.(); window.__animLoopStarted = true;
      if (typeof populateModelSelector === 'function') populateModelSelector();
      if (typeof trackEvent === 'function') trackEvent('model_changed', { model_name: currentModelName, source });
    } catch (error) { debugError('Avatar UI update failed', error); }
    AvatarRecovery.setState('ready', modelUrl); AvatarRecovery.refreshVisibility();
    return model;
  } catch (error) {
    if (!AvatarRecovery.owns(attempt)) return null;
    attempt.cancelled = true;
    attempt.dispose();
    AvatarRecovery.setState(error.message === 'Avatar load timed out' ? 'stalled' : 'failed', modelUrl);
    debugError('Failed to load model', error, { url: modelUrl });
    throw error;
  } finally { clearTimeout(timer); AvatarRecovery.finish(attempt); }
}

function clearAllModels() {
  const clearedUrl = window.currentModelUrl;
  AvatarRecovery.empty();
  app.stage.children.filter(m => m.__modelUrl).forEach(m => { app.stage.removeChild(m); m.destroy({ children: true, texture: true, baseTexture: true }); });
  window.destroyParticleSystem?.(); window.stopAnimationLoop?.(); window.__animLoopStarted = false;
  currentModel = null; currentModelName = ''; currentModelUrl = null;
  if (clearedUrl) AvatarRecovery.setState('hidden', clearedUrl);
  // Clearing the scene is distinct from forgetting the saved character.
}
window.clearAllModels = clearAllModels;
