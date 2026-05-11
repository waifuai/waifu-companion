# Voice & Audio Settings

Waifu Companion supports multiple text-to-speech engines, real-time lip-sync, audio preloading, and various audio features.

## Text-to-Speech (TTS)

Three TTS providers are available, each can be independently enabled/disabled:

### TikTok TTS (Primary)
Free TTS API with the largest voice selection. Enable in Settings > Voice > Enable TikTok TTS.

**Voices (35+):**
- **English (US)**: Female (F1, F2), Male (M1, M2, M3, M4)
- **English (UK)**: Male (M1, M2)
- **English (Australian)**: Female, Male
- **French**: Male (M1, M2)
- **German**: Female, Male
- **Spanish (ES)**: Male
- **Spanish (MX)**: Male
- **Portuguese (BR)**: Female (F1, F2, F3), Male
- **Japanese**: Female (F1, F2, F3), Male
- **Korean**: Male (M1, M2), Female
- **Indonesian**: Female
- **Character Voices**: Ghost Face, C3PO, Stitch, Pirate, Narrator, Warmy Breeze

### Kokoro TTS (Local)
High-quality, offline text-to-speech powered by ONNX Runtime. Runs locally in the browser using WebGPU (preferred) or WASM (CPU fallback).

**Features:**
- No API key or internet required after initial model download
- Automatic hardware detection (WebGPU vs WASM)
- Safety checks: disabled on low RAM (<4GB) or slow networks (2G/3G)
- Background preloading at startup

**Voices (10+):**
- **US English**: Heart (F), Bella (F), Nicole (F), Sarah (F), Sky (F), Adam (M), Michael (M)
- **UK English**: Alice (F), Emma (F), George (M), Lewis (M)

### Browser SpeechSynthesis
Built-in browser TTS with no rate limits or dependencies. Uses the system's native speech voices.

- **Female**: Uses first available female voice for the detected language
- **Male**: Uses first available male voice for the detected language

## Voice Language Overrides

The app maps unsupported language codes to a base language whose voices should be used. This covers 100+ language codes:
- Southeast Asian languages (Javanese, Sundanese, Cebuano, etc.) → Indonesian
- Slavic languages (Ukrainian, Bulgarian, Serbian, etc.) → Russian
- East Asian languages (Cantonese, Thai, Vietnamese, etc.) → Chinese
- Indic languages (Bengali, Tamil, Telugu, etc.) → Hindi
- Romance languages (Catalan, Galician, Romanian, etc.) → Spanish/Italian/French
- Germanic languages (Dutch, Afrikaans, Danish, Swedish, etc.) → German/English
- And many more

## Real-Time Lip-Sync

During TTS playback, the Live2D model's mouth animates based on audio frequency analysis:
- Analyzes vocal frequency range (10-100 Hz band)
- Drives `ParamMouthOpenY` (mouth openness) and `ParamMouthForm` (mouth shape)
- Smooth volume interpolation prevents jitter
- Works with all three TTS providers
- Resets mouth position when audio ends

## TTS Preloading

The TTS queue manager pre-fetches the next message's audio in the background:
- Reduces delay between messages in multi-sentence responses
- Audio buffer is cached and played instantly when ready
- Preloading respects voice ID and text matching to avoid stale cache

## Speech-to-Text (STT)

Use your microphone to speak to your companion:
1. Click the microphone icon in the chat input
2. Speak your message
3. Click again to stop recording
4. Message is automatically transcribed and sent

Powered by the Web Speech API. Requires microphone permissions.

## Internet Radio

Stream music from Listen.moe:
1. Go to Settings > Audio Settings
2. Toggle the radio on/off
3. Volume can be adjusted in the same section

## Sound Effects

UI interactions produce subtle sound effects powered by Tone.js:
- Button clicks
- Panel opens/closes
- Chat message send/receive

## Audio Settings

- **Master Volume**: Overall audio volume
- **TTS Volume**: Text-to-speech volume
- **Radio Volume**: Internet radio volume
- **Sound Effects**: Toggle UI sound effects on/off
- **Enable TikTok TTS**: Primary voice engine toggle
- **Enable Kokoro Voice**: Local ONNX engine toggle

## TTS Queue

Multi-sentence AI responses are split into individual sentences for TTS:
- Sentences are processed sequentially
- Each sentence can be preloaded while the previous one plays
- Configurable character limit per TTS chunk
- Queue can be interrupted by sending a new message
