# Waifu Companion

![License: MIT-0](https://img.shields.io/badge/License-MIT--0-purple.svg)

**Waifu Companion** is a fully customizable, browser-based intelligent assistant that brings your favorite characters to life using Live2D technology. It combines interactive visuals with advanced AI capabilities to create a personalized desktop companion experience.

## ✨ Key Features

### 🎭 Interactive Live2D Models
- **Full Cubism SDK Support**: Seamlessly renders standard Live2D Cubism models.
- **Custom Model Loading**: Add your own models by providing a URL to their `.model3.json` file.
- **Model Gallery**: Built-in gallery to manage and switch between different characters.
- **Multi-Model Support**: Display interactions between multiple characters simultaneously.

### 🧠 Smart AI Persona
- **Customizable Identity**: Define your companion's core personality and roleplay traits via system prompts.
- **Contextual Memory**: The AI remembers previous interactions (configurable memory depth).
- **Context Awareness**: Aware of real-time context like current time and device battery status.

### 🗣️ Voice & Audio
- **Text-to-Speech (TTS)**: Fully integrated TTS with support for multiple languages and voice providers.
- **Speech-to-Text (STT)**: Talk to your companion using your microphone.
- **Internet Radio**: Integrated music player streaming from [Listen.moe](https://listen.moe/).
- **Sound Effects**: UI interactions are enhanced with subtle sound effects handled by Tone.js.

### 🎨 Visual & UI Customization
- **Dynamic Backgrounds**:
  - **AI Generation**: Generate unique backgrounds on the fly using text prompts.
  - **Custom URLs**: Set any image from the web as your background.
  - **Background Library**: Save and manage your favorite scenes.
- **Draggable Interface**: Chat and Debug panels can be moved and resized to fit your layout.
- **Visual Tweaks**: Adjustable opacity for chatboxes, messages, and backgrounds to blend into your desktop.

### 🛠️ Advanced Settings
- **Language Support**: UI translation and response language selection.
- **Transliteration**: Optional romanization for Japanese and Korean responses.
- **Debug Tools**: Comprehensive logging for Live2D, AI, and TTS subsystems for developers and enthusiasts.
- **Offline Mode**: Test interactions with a local fallback engine.

## 🚀 Getting Started

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

## 📖 Usage Guide

- **Settings**: Click the generic "gear" icon or the circle button in the top-left to open the comprehensive Settings Panel.
- **Chat**: Type in the chat box or click the microphone icon to speak.
- **Radio**: Toggle the music stream via the radio icon in the Settings > Audio section.
- **Tutorial**: If it's your first time, click "Launch Tutorial" in the Help section to get a guided tour.

## 💻 Technologies Used

*   **[Live2D Cubism Web SDK](https://www.live2d.com/)**: For rendering and animating character models.
*   **[PIXI.js](https://pixijs.com/)**: Fast 2D rendering engine.
*   **[Tone.js](https://tonejs.github.io/)**: Web Audio framework for interactive sounds.
*   **[Day.js](https://day.js.org/)**: Date and time formatting.
*   **Vanilla JavaScript (ES6+)**: Core application logic.

## 📄 License

This project is licensed under the **MIT No Attribution** license. See the [LICENSE](LICENSE) file for details.
