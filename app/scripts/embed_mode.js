// Read before the app scripts so storage and boot can select the card session.
window.WaifuEmbed = new URLSearchParams(location.search).get('embed') === 'x';
if (window.WaifuEmbed) document.documentElement.classList.add('waifu-embed');

window.fitEmbedModel = function (model) {
  if (!window.WaifuEmbed || !model) return;
  const width = model.width / model.scale.x;
  const height = model.height / model.scale.y;
  const areaHeight = window.innerHeight * 0.53 - 40;
  model.anchor.set(0.5, 0.5);
  model.scale.set(Math.min((window.innerWidth - 24) / width, Math.max(60, areaHeight) / height));
  model.position.set(window.innerWidth / 2, 40 + areaHeight / 2);
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
