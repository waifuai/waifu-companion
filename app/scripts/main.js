// removed async function sendMessage() and related logic
// removed messageInput.addEventListener("keypress", ...) for sendMessage

// removed Event Listeners for:
// - memorySizeInput
// - enableDebuggerCheckbox
// - settingsButton (querySelector)
// - betaCloseButton (querySelector)
// - debugClearButton (querySelector)

// removed --- Tone.js Sound Effects Setup --- (moveSynth, zoomSynth, clickSynth, setupSounds, playSound)

// removed --- Initialization --- (window.addEventListener('load', ...))


// --- Radio Player Error Handling ---
window.handleAudioError = function(element) {
    debugError('Radio player error: Could not load audio stream', element);
}
// --- End Radio Player Error Handling ---