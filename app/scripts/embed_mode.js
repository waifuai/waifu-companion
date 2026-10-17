// Read before the app scripts so storage and boot can select the card session.
const waifuCardParams = new URLSearchParams(location.search);

// Interface string lookup with an English fallback, so this file still works
// when it is loaded without the i18n runtime (or as the very first script).
// Declared as a function (not a const) because every app script is a classic
// script sharing one global scope, where duplicate lexical declarations throw.
function tr(key, fallback, params) {
  const api = typeof window !== 'undefined' && window.WaifuI18n;
  try { return api && api.has(key) ? api.t(key, params) : fallback; } catch (e) { return fallback; }
}
window.WaifuEmbed = waifuCardParams.get('embed') === 'x' || waifuCardParams.get('card') === 'player-v1';
if (window.WaifuEmbed) document.documentElement.classList.add('waifu-embed');

window.fitEmbedModel = function (model) {
  if (!window.WaifuEmbed || !model) return;
  const width = model.width / model.scale.x;
  const height = model.height / model.scale.y;
  // Portrait framing: face/torso above the chat, with lower body allowed to
  // extend behind it. Fitting the whole figure into half a card made her tiny.
  const chatHidden = document.documentElement.classList.contains('embed-chat-hidden');
  const areaHeight = Math.max(60, window.innerHeight - 52);
  model.anchor.set(0.5, 0);
  model.scale.set(Math.min((window.innerWidth - 24) / width, areaHeight * (chatHidden ? 1 : 1.45) / height));
  model.position.set(window.innerWidth / 2, 44);
};

window.initEmbedControls = function () {
  if (!window.WaifuEmbed) return;
  // Boot restores the card's voice choices. New visitors have TikTok voice on;
  // no speech is requested until they chat or explicitly play a message.
  syncLegacyEnableVoiceCheckbox();
  syncVoiceControlsVisibility();
  const button = document.getElementById('embedVoiceBtn');
  let restoreFallback = window.enableFallbackVoice;
  const update = () => {
    button.textContent = window.enableVoice ? tr('app.voiceOn', 'Voice on') : tr('app.voiceOff', 'Voice off');
    button.setAttribute('aria-pressed', String(window.enableVoice));
  };
  button.addEventListener('click', () => {
    const enabled = !window.enableVoice;
    if (!enabled) restoreFallback = window.enableFallbackVoice;
    const primary = document.getElementById('enableTikTokVoiceCheckbox');
    primary.checked = enabled;
    primary.dispatchEvent(new Event('change'));
    if (enabled) {
      const fallback = document.getElementById('enableFallbackVoiceCheckbox');
      fallback.checked = restoreFallback;
      fallback.dispatchEvent(new Event('change'));
    }
    if (!enabled) {
      ['enableFallbackVoiceCheckbox', 'enableKokoroVoiceCheckbox'].forEach(id => {
        const checkbox = document.getElementById(id);
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
      });
      if (typeof window.stopTTS === 'function') window.stopTTS();
    }
    update();
  });
  ['enableTikTokVoiceCheckbox', 'enableFallbackVoiceCheckbox', 'enableKokoroVoiceCheckbox'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', update);
  });
  update();
  const chatButton = document.getElementById('embedChatBtn');
  const chat = document.querySelector('.chat-container');
  chatButton.addEventListener('click', () => {
    const hidden = document.documentElement.classList.toggle('embed-chat-hidden');
    chat.hidden = hidden;
    chatButton.setAttribute('aria-pressed', String(!hidden));
    const chatLabel = hidden ? tr('app.showChat', 'Show chat') : tr('app.hideChat', 'Hide chat');
    chatButton.setAttribute('aria-label', chatLabel);
    chatButton.title = chatLabel;
    if (hidden && chat.contains(document.activeElement)) document.activeElement.blur();
    window.fitEmbedModel(window.currentModel);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.app?.ticker.stop();
      window.stopAnimationLoop?.();
      window.stopTTS?.();
    } else {
      window.app?.ticker.start();
      window.startAnimationLoop?.();
    }
  });
};
