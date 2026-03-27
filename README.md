# Waifu Companion

![License: MIT-0](https://img.shields.io/badge/License-MIT--0-purple.svg)

[![Waifu AI Live Demo](https://raw.githubusercontent.com/waifuai/projects-assets/main/assets/demo-portrait.webp)](https://waifuai.com)

**Waifu Companion** is a fully customizable, browser-based intelligent assistant that brings your favorite characters to life using Live2D technology. It combines interactive visuals with advanced AI capabilities to create a personalized desktop companion experience.

## Key Features

### Advanced AI Integration
- **OpenRouter Support**: Use custom LLM models via OpenRouter API with up to 2 fallback models
- **Groq Support**: Ultra-fast inference with Groq's LPU-powered models (e.g., `llama-3.3-70b-versatile`)
- **Streaming Responses**: Real-time text generation for natural conversations with both providers
- **Smart Fallback**: Automatic model fallback on failures, plus a local heuristic engine when offline
- **Provider Priority**: Groq > OpenRouter > Local Fallback Engine

### Interactive Live2D Models
- **Full Cubism SDK Support**: Seamlessly renders standard Live2D Cubism models.
- **50+ Built-in Models**: Gallery with thumbnails.
- **Custom Model Loading**: Add your own models by providing a URL to their `.model3.json` file.
- **Model Gallery**: Fullscreen overlay with thumbnail grid for browsing and switching characters.
- **Multi-Model Support**: Display interactions between multiple characters simultaneously.
- **Interactive Animations**: Drag to reposition, zoom, particle effects on click, idle breathing, blinking.
- **Emotion-Driven Expressions**: AI emotions (happy, sad, surprised, thoughtful, excited) trigger model expressions and motions.

### Smart AI Persona
- **Customizable Identity**: Define your companion's core personality and roleplay traits via system prompts.
- **Contextual Memory**: The AI remembers previous interactions with configurable memory depth.
- **Auto-Summarization**: Automatic conversation summarization to preserve context across long sessions.
- **Context Awareness**: Aware of real-time context like current time, device battery status, and user-provided background context.
- **AI Settings Control**: Experimental feature allowing the AI to modify application settings.

### Voice & Audio
- **Kokoro TTS**: Local ONNX-based text-to-speech engine (WebGPU/WASM) with 10+ voices across US and UK English.
- **TikTok TTS**: Free TTS API with 35+ voices across 10+ languages (English, French, German, Spanish, Portuguese, Japanese, Korean, Indonesian) plus character voices (Ghost Face, C3PO, Stitch, Pirate, Narrator).
- **Browser SpeechSynthesis**: Built-in fallback voice with no rate limits.
- **Real-Time Lip-Sync**: Mouth animation driven by audio frequency analysis during TTS playback.
- **TTS Preloading**: Background pre-fetch of next queued message audio for instant playback.
- **Speech-to-Text (STT)**: Talk to your companion using your microphone via Web Speech API.
- **Internet Radio**: Integrated music player streaming from [Listen.moe](https://listen.moe/).
- **Sound Effects**: UI interactions enhanced with subtle sound effects via Tone.js.

### Chat System
- **Message Queue**: Queue multiple messages for sequential processing with audio preloading.
- **Ambient Mode**: AI speaks unprompted after a configurable silence delay with custom prompt.
- **Typing Indicators**: Visual feedback during AI response generation.
- **Online/Offline Status**: Clear status indicator with manual reconnect option and configurable offline duration.
- **Debug Context**: Option to view full chat context sent to the AI in the debug panel.
- **Conversation Summary Markers**: Visual indicators showing where summarization occurred in chat history.

### Visual & UI Customization
- **Dynamic Backgrounds**:
  - **AI Generation**: Generate unique backgrounds on the fly using text prompts.
  - **Custom URLs**: Set any image from the web as your background.
  - **Background Library**: Save and manage your favorite scenes.
  - **11 Fit Modes**: Multiple options for how backgrounds fill the screen.
- **Draggable Interface**: Chat and Debug panels can be moved and resized to fit your layout.
- **Visual Tweaks**: Adjustable opacity for chatboxes, messages, and backgrounds to blend into your desktop.
- **Settings Search**: Quickly find any setting with the real-time search feature.
- **Clock Display**: Optional on-screen clock.

### Advanced Settings
- **100+ Language Support**: UI translation and response language selection with AI-powered translations.
- **Transliteration**: Optional romanization (romaji) for Japanese and romanized Korean responses.
- **Debug Tools**: Comprehensive categorized logging for Live2D, AI, TTS, and Network subsystems with copy-to-clipboard.
- **Offline Mode**: Test interactions with a local fallback engine with configurable auto-activation duration.
- **15-Step Interactive Tutorial**: Guided tour for new users, translatable to any language.

## Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, etc.) with WebGL support.
- An internet connection (for AI responses and initial asset loading).

### Installation / Running Locally
Since **Waifu Companion** is a client-side web application, it requires no complex backend installation. However, due to browser security policies (CORS) regarding local file access, you must run it through a local web server.

1.  **Clone the repository**
    ```bash
    git clone https://github.com/waifuai/waifu-companion.git
    cd waifu-companion
    ```

2.  **Start a local server**
    You can use any static file server. Here are a few examples:

    *   **Using Python 3:**
        ```bash
        python -m http.server 8000
        ```
    *   **Using Node.js (http-server):**
        ```bash
        npx http-server .
        ```
    *   **VS Code Live Server:**
        Open the project folder in VS Code and click "Go Live" (requires the Live Server extension).

3.  **Open in Browser**
    Navigate to `http://localhost:8000` (or the port shown by your server).

## Usage Guide

- **Settings**: Click the gear icon in the top-left to open the comprehensive Settings Panel with categorized submenus.
- **Chat**: Type in the chat box or click the microphone icon to speak.
- **Models**: Use the model gallery to browse and switch between 50+ built-in characters, or load custom models via URL.
- **Voice**: Configure TikTok TTS, Kokoro TTS, or browser voices in Settings > Voice.
- **Radio**: Toggle the music stream via the radio icon in Settings > Audio section.
- **Tutorial**: If it's your first time, click "Launch Tutorial" in the Help section to get a guided tour.
- **Go Online**: Use the "Go Online" button in the chat header to manually reconnect after going offline.

## LLM Providers

Waifu Companion supports multiple LLM providers:

| Provider | Setup | Streaming | Free Models |
|----------|-------|-----------|-------------|
| **Groq** | API key from [console.groq.com](https://console.groq.com/) | Yes | Yes (rate limited) |
| **OpenRouter** | API key from [openrouter.ai](https://openrouter.ai/) | Yes | Yes |
| **Local Fallback** | No setup needed | No | Always free |

See [docs/providers.md](docs/providers.md) for detailed configuration.

## Documentation

- [LLM Providers](docs/providers.md) - OpenRouter and Groq configuration
- [Voice & Audio](docs/voice.md) - TTS engines, STT, radio, and sound effects
- [Memory & Context](docs/memory.md) - Conversation memory and summarization
- [Models & Visuals](docs/models.md) - Live2D model gallery, controls, and particle effects
- [Settings Panel](docs/settings.md) - Settings menu structure and search
- [Troubleshooting](docs/troubleshooting.md) - Common issues and debug tools

## Technologies Used

*   **[Live2D Cubism Web SDK](https://www.live2d.com/)**: For rendering and animating character models.
*   **[PIXI.js](https://pixijs.com/)**: Fast 2D rendering engine.
*   **[ONNX Runtime Web](https://onnxruntime.ai/)**: Local ML inference for Kokoro TTS (WebGPU/WASM).
*   **[Tone.js](https://tonejs.github.io/)**: Web Audio framework for interactive sounds.
*   **[Day.js](https://day.js.org/)**: Date and time formatting.
*   **Vanilla JavaScript (ES6+)**: Core application logic.

## License

This project is licensed under the **MIT No Attribution** license. See the [LICENSE](LICENSE) file for details.
