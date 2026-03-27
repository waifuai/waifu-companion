// Simple step-by-step tutorial modal
(function () {
  const steps = [
    {
      title: "👋 Welcome",
      body: "This app pairs a Live2D character 🎭 with a chat 🗨️ powered by an AI model 🤖. You can move 🖱️ and zoom 🔍 the character, chat 💬, and even listen to radio 🎶 while using TTS 🔊."
    },
    {
      title: "💬 Chat & AI",
      body: "Type your message ⌨️ and press Enter ↩️. The AI processes your input and responds with text, emotion, and gestures 🎭. Your conversation history is saved locally 💾. Use Reset Chat 🗑️ to clear it and start fresh."
    },
    {
      title: "🤖 LLM Provider",
      body: "Configure your AI model in Settings → LLM Provider. You can use **OpenRouter** or **Groq** - both support free models. Provide your API key 🔑 and a model name. They support **Streaming** ⚡ for real-time replies!"
    },
    {
      title: "🧠 Persona & Memory",
      body: "Customize your AI's identity 🆔 and personality 🎭 in Persona Settings. The AI has **Long-Term Memory** 🧵: it remembers the last few dozen messages and automatically creates a **Conversation Summary** 📝 to retain important facts even after they leave immediate memory."
    },
    {
      title: "🧩 Live2D Models",
      body: "Switch characters in Settings → Model Settings 🧩. You can pick from built-in models or add your own via a `.model3.json` URL 🔗. The AI can trigger **Emotions** (Happy, Sad, Surprised, etc.) and **Gestures** (Nod, Shake Head) automatically during chat ✨."
    },
    {
      title: "🔊 Voice (TTS)",
      body: "Enable Voice 🔈 to hear the AI. You can choose a different voice 🎙️ for each response language. TikTok TTS offers high-quality voices for many languages 🌎. Adjust volume 🔉 and chunk limits in Voice Settings."
    },
    {
      title: "🖼️ Backgrounds",
      body: "Generate custom backgrounds 🎨 from prompts or the current chat context in Settings → Background Image 🖼️. Manage your collection in the **Background Library** 📚, use the fullscreen viewer 🖥️, and choose how the image fits your screen (Contain, Cover, etc.)."
    },
    {
      title: "📻 Audio & Radio",
      body: "Listen to an anime radio stream 🎶 while you chat. Controls are in Settings → Audio Settings 🎧. Volume is saved automatically 💾. Click the play button ▶️ to start the music!"
    },
    {
      title: "🎙️ Voice Input (STT)",
      body: "Click the Microphone 🎤 icon in the chatbox to talk instead of typing. It uses your browser's speech recognition ✍️. Make sure to allow microphone permissions in your browser 🔐."
    },
    {
      title: "🌐 Languages & UI",
      body: "Set the AI's response language 🗣️ and optionally show **Transliteration** 🔤 (Romaji/Romanization) for Japanese or Korean. You can also enable **UI Translation** 🈯 to have the AI translate the entire app interface for you!"
    },
    {
      title: "⚙️ Preferences & Context",
      body: "In Preferences ⚙️, you can choose to include the current **Time** ⏱️ and **Battery** 🔋 level in the AI's context so it can make comments about your day or device status 🧠. You can also adjust chatbox and bubble opacities 🎨."
    },
    {
      title: "🔌 Offline Mode",
      body: "If the AI connection fails or you're offline, the app switches to a **Local Fallback Engine** 🔌. It uses basic heuristics to keep the conversation going until you're back online 🌐. You can also force Offline Mode in Debug Settings."
    },
    {
      title: "🐞 Debug Panel",
      body: "Troubleshoot issues with the **Debug Panel** 🧰. See real-time logs 📋 for AI calls, model loading, and system events. You can even see the full context 📄 being sent to the AI to understand how it thinks."
    },
    {
      title: "🖱️ Drag & Resize",
      body: "The Chat window is fully flexible! Drag it by the header 🪟 and resize from the edges ↔️↕️. Your layout is saved 💾 so it stays consistent between visits."
    },
    {
      title: "💡 Pro Tips",
      body: "• Click/Tap the character to interact 🖱️\n• Use mouse wheel to zoom 🌀\n• Drag the character to reposition 📍\n• Enable 'Always show Settings' 🪄 if you tweak often\n• Check the **Links** 🔗 section for more from Waifu AI!"
    }
  ];

  let idx = 0;

  const bodyEl = document.getElementById("settingsTutorialContent");

  // Cache for the translated second half
  let cachedSecondHalf = null;

  async function render() {
    if (!bodyEl) return;
    const langCode = window.currentInterfaceLanguage || "en-US";

    // Translate steps if language is not English
    let displaySteps = steps;
    if (langCode !== "en-US") {
      // Show short-lived loading indicator if it's the first render for this lang
      if (window.lastTutorialLang !== langCode) {
        bodyEl.innerHTML = '<div style="text-align:center; padding: 20px; color: #aaa; font-size: 13px;">Translating guide... ⏳</div>';
      }
      displaySteps = await translateTutorialSteps(steps, langCode);
    }

    // Get the second half content (translated)
    let secondHalf = cachedSecondHalf;
    const lastLang = window.lastTutorialLang;

    if (!secondHalf || lastLang !== langCode) {
      secondHalf = await translateTutorialSecondHalf(langCode);
      cachedSecondHalf = secondHalf;
      window.lastTutorialLang = langCode;
    }

    const stepsHtml = displaySteps
      .map(step => `<div class="tutorial-step-card"><h4>${step.title}</h4><p>${step.body}</p></div>`)
      .join("");

    bodyEl.innerHTML = stepsHtml + `<div class="tutorial-details-section">${secondHalf}</div>`;
  }

  // Expose for programmatic access
  window.renderTutorial = render;
  window.rerenderTutorial = render;
  window.TUTORIAL_STEPS = steps;
})();