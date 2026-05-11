// Manages the UI and functionality of the radio stream player.

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
                addMessage("Sorry, I couldn't start the radio stream. Your browser might require another click or interaction.", false);
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
    radioVolumeSlider.addEventListener('input', (e) => {
        // Assumes radioPlayer is accessible
        if (radioPlayer) {
            const val = parseFloat(e.target.value);
            radioPlayer.volume = val;
            if (typeof trackEvent === 'function') trackEvent('radio_volume_changed', { value: val });
            debugLog(`Radio volume set to: ${radioPlayer.volume.toFixed(2)}`, 'info');
        }
    });
}