// Read before the app scripts so storage and boot can select the card session.
const waifuCardParams = new URLSearchParams(location.search);
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
  // Every new frame starts silent; voice is an explicit action in the card.
  window.enablePrimaryVoice = window.enableFallbackVoice = window.enableKokoro = window.enableVoice = false;
  ['enableTikTokVoiceCheckbox', 'enableFallbackVoiceCheckbox', 'enableKokoroVoiceCheckbox'].forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) checkbox.checked = false;
  });
  syncLegacyEnableVoiceCheckbox();
  syncVoiceControlsVisibility();
  const button = document.getElementById('embedVoiceBtn');
  const update = () => {
    button.textContent = window.enableVoice ? 'Voice on' : 'Voice off';
    button.setAttribute('aria-pressed', String(window.enableVoice));
  };
  button.addEventListener('click', () => {
    const enabled = !window.enableVoice;
    const primary = document.getElementById('enableTikTokVoiceCheckbox');
    primary.checked = enabled;
    primary.dispatchEvent(new Event('change'));
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
    chatButton.setAttribute('aria-label', hidden ? 'Show chat' : 'Hide chat');
    chatButton.title = hidden ? 'Show chat' : 'Hide chat';
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
