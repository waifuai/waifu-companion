// --- Global AudioContext and Analyser for TTS ---
let ttsAudioContext = null;
let ttsAnalyser = null;
let ttsGainNode = null;

function getTTSAudioContext() {
    if (!ttsAudioContext || ttsAudioContext.state === 'closed') {
        if (ttsAudioContext) {
             debugLog("TTS: Previous AudioContext was closed. Recreating.", "info");
        }
        ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        debugLog("TTS: New AudioContext created/recreated.", "info");
        // If context is recreated, analyser also needs to be recreated.
        if (ttsAnalyser) {
            try { ttsAnalyser.disconnect(); } catch(e) { /* ignore */ }
            ttsAnalyser = null; 
        }
    }
    // Attempt to resume if suspended (e.g., due to browser autoplay policies)
    if (ttsAudioContext.state === 'suspended') {
        ttsAudioContext.resume().then(() => {
            debugLog("TTS: AudioContext resumed.", "info");
        }).catch(e => debugLog("TTS: Error resuming AudioContext: " + e, "error"));
    }
    return ttsAudioContext;
}

function getTTSAnalyser() {
    const context = getTTSAudioContext(); // Ensures context is live
    if (!ttsAnalyser || ttsAnalyser.context !== context) { 
        if (ttsAnalyser) { // Disconnect old analyser if it exists and context changed
            try { ttsAnalyser.disconnect(); } catch(e) { /* ignore */ }
        }
        ttsAnalyser = context.createAnalyser();
        ttsAnalyser.fftSize = 1024; 
        // Create or reuse a gain node for global TTS volume control
        if (!ttsGainNode || ttsGainNode.context !== context) {
            ttsGainNode = context.createGain();
            ttsGainNode.gain.value = typeof window.ttsVolume === 'number' ? window.ttsVolume : 1.0;
            ttsGainNode.connect(context.destination);
        }
        ttsAnalyser.connect(ttsGainNode);
        debugLog("TTS: Analyser (re)created and connected to gain node.", "info");
    }
    return ttsAnalyser;
}

function getTTSGainNode() {
    const context = getTTSAudioContext();
    if (!ttsGainNode || ttsGainNode.context !== context) {
        ttsGainNode = context.createGain();
        ttsGainNode.gain.value = typeof window.ttsVolume === 'number' ? window.ttsVolume : 1.0;
        ttsGainNode.connect(context.destination);
        if (ttsAnalyser) {
            try { ttsAnalyser.disconnect(); } catch(e) {}
            ttsAnalyser.connect(ttsGainNode);
        }
        debugLog("TTS: Gain node (re)created.", "info");
    }
    return ttsGainNode;
}

// Export functions to window for global access
window.getTTSAudioContext = getTTSAudioContext;
window.getTTSAnalyser = getTTSAnalyser;
window.getTTSGainNode = getTTSGainNode;