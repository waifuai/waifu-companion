// Dynamic import used instead of static to prevent blocking load
/**
 * Silently preloads the Kokoro ONNX model in the background.
 * This is meant to be called at application startup without 'await'.
 */
window.preloadKokoroInBackground = async function () {
    // Hardware and Network Safeguards for Web
    const hasWebGPU = navigator.gpu !== undefined;
    const isLowRAM = navigator.deviceMemory && navigator.deviceMemory < 4; // Less than 4GB RAM
    const isSlowNetwork = navigator.connection &&
        (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === '3g');

    if (window.enableKokoro === false || isLowRAM || isSlowNetwork) {
        let reason = isLowRAM ? "Low RAM" : (isSlowNetwork ? "Slow Network" : "Opted out");
        if (typeof debugLog === 'function') {
            debugLog(`[Voice Engine] Kokoro TTS disabled (${reason}). Falling back to standard browser TTS.`, 'info');
        } else {
            console.log(`[Voice Engine] Kokoro TTS disabled safely (${reason}). Falling back to standard browser TTS.`);
        }
        window.isKokoroReady = false;
        return;
    }

    if (typeof debugLog === 'function') {
        debugLog("[Voice Engine] Silently preloading Kokoro in the background...", 'info');
    } else {
        console.log("[Voice Engine] Silently preloading Kokoro in the background...");
    }

    try {
        // CRITICAL FIX: WebGPU + q8 = Garbage audio. 
        // We must use "fp32" for WebGPU, and "q8" for WASM (CPU).
        const targetDevice = hasWebGPU ? "webgpu" : "wasm";
        const targetDtype = hasWebGPU ? "fp32" : "q8";

        const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js");
        window.kokoroTTS = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
            dtype: targetDtype, 
            device: targetDevice,
        });
        window.isKokoroReady = true;

        if (typeof debugLog === 'function') {
            debugLog(`[Voice Engine] Kokoro ready! (Device: ${targetDevice}, Type: ${targetDtype})`, 'info');
        } else {
            console.log(`[Voice Engine] Kokoro ready! (Device: ${targetDevice}, Type: ${targetDtype})`);
        }
    } catch (err) {
        if (typeof debugError === 'function') {
            debugError('[Voice Engine] Background preload failed', err, {
                model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
                device: targetDevice,
                dtype: targetDtype
            });
        } else if (typeof debugLog === 'function') {
            debugLog(`[Voice Engine] Background preload failed: ${err.message}`, 'error');
        } else {
            console.error("[Voice Engine] Background preload failed:", err);
        }
    }
};

/**
 * Generates audio using the local Kokoro engine and returns an AudioBuffer.
 * @param {string} text The text to speak.
 * @param {string} voice The Kokoro voice ID (default: "af_heart").
 * @returns {Promise<AudioBuffer|null>}
 */
window.generateKokoroAudioBuffer = async function (text, voice = "af_heart") {
    if (!window.isKokoroReady || !window.kokoroTTS) {
        return null;
    }

    try {
        if (typeof debugLog === 'function') {
            debugLog(`[Voice Engine] Local Kokoro taking over for: "${text.substring(0, 50)}..."`, 'info');
        }

        const rawAudio = await window.kokoroTTS.generate(text, {
            voice: voice,
            speed: 1.0
        });

        const audioContext = typeof getTTSAudioContext === 'function' ? getTTSAudioContext() : new (window.AudioContext || window.webkitAudioContext)();

        // Kokoro-js returns raw audio as Float32Array and sampling_rate
        const buffer = audioContext.createBuffer(1, rawAudio.audio.length, rawAudio.sampling_rate);
        buffer.copyToChannel(rawAudio.audio, 0);

        return buffer;
    } catch (err) {
        if (typeof debugError === 'function') {
            debugError('[Voice Engine] Kokoro generation failed', err, { voice: voice, textLen: text?.length });
        } else if (typeof debugLog === 'function') {
            debugLog(`[Voice Engine] Kokoro generation failed: ${err.message}`, 'error');
        } else {
            console.error("[Voice Engine] Kokoro generation failed:", err);
        }
        return null;
    }
};