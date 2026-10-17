// Manages the UI and functionality of the radio stream player.

// Interface string lookup with an English fallback. A function declaration,
// because every app script is a classic script sharing one global scope, where
// duplicate lexical declarations throw.
function tr(key, fallback, params) {
  const api = typeof window !== 'undefined' && window.WaifuI18n;
  try { if (api && api.has(key)) return api.t(key, params); } catch (e) { /* fall back below */ }
  if (!params) return fallback;
  return String(fallback).replace(/%\{(\w+)\}/g, (all, name) => (params[name] == null ? all : String(params[name])));
}

function updateRadioToggleButton() {
    // Assumes radioPlayer, radioPlayIcon, radioPauseIcon are accessible
    if (!radioPlayer || !radioPlayIcon || !radioPauseIcon) return;

    if (radioPlayer.paused) {
        radioPlayIcon.classList.remove('hidden');
        radioPauseIcon.classList.add('hidden');
    } else {
        radioPlayIcon.classList.add('hidden');
        radioPauseIcon.classList.remove('hidden');
    }
}

// Add event listener for the custom radio toggle button
// Check if radioToggleBtn exists before adding the listener
if (radioToggleBtn) {
    radioToggleBtn.addEventListener('click', () => {
        // Assumes radioPlayer is accessible
        if (radioPlayer.paused) {
            if (typeof trackEvent === 'function') trackEvent('radio_toggle', { action: 'play' });
            radioPlayer.play().catch(error => {
                debugError('Radio playback failed', error);
                addMessage(tr('error.radioFailed', "Sorry, I couldn't start the radio stream. Your browser might require another click or interaction."), false);
            });
        } else {
            if (typeof trackEvent === 'function') trackEvent('radio_toggle', { action: 'pause' });
            radioPlayer.pause();
        }
    });

    // Listen for audio events to keep button state in sync
    radioPlayer.addEventListener('play', updateRadioToggleButton);
    radioPlayer.addEventListener('pause', updateRadioToggleButton);
    radioPlayer.addEventListener('ended', updateRadioToggleButton); // Handle when stream ends
}

// Add event listener for the volume slider
if (radioVolumeSlider) {
    // Sync the actual element volume to what the slider already shows. The
    // slider defaults to 0.25 in the markup but the audio element defaults to
    // 1.0, so the radio played at full volume until the slider was touched.
    if (radioPlayer) {
        const initialVolume = parseFloat(radioVolumeSlider.value);
        if (Number.isFinite(initialVolume)) radioPlayer.volume = initialVolume;
    }

    radioVolumeSlider.addEventListener('input', (e) => {
        // Assumes radioPlayer is accessible
        if (radioPlayer) {
            const val = parseFloat(e.target.value);
            radioPlayer.volume = val;
            if (typeof trackEvent === 'function') debounced('radio_volume', () => trackEvent('radio_volume_changed', { volume: val }));
            debugLog(`Radio volume set to: ${radioPlayer.volume.toFixed(2)}`, 'info');
        }
    });
}