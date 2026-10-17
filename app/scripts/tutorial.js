// Loads help/tutorial content from docs/help.html
(function () {
  const bodyEl = document.getElementById("settingsTutorialContent");
  let englishTutorial = null;

  // Interface string lookup with an English fallback, so this file still reads
  // correctly when the i18n runtime is not loaded.
  const tr = (key, fallback) => {
    const api = typeof window !== 'undefined' && window.WaifuI18n;
    try { return api && api.has(key) ? api.t(key) : fallback; } catch (e) { return fallback; }
  };

  async function loadTutorialContent() {
    if (englishTutorial) return englishTutorial;

    const response = await fetch("docs/help.html");
    if (!response.ok) {
      throw new Error(`Failed to load help docs: ${response.status}`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const root = doc.getElementById("tutorialDocContent");
    const detailSection = doc.getElementById("tutorialDocDetails");

    if (!root || !detailSection) {
      throw new Error("Help docs missing tutorial content sections");
    }

    const steps = Array.from(root.querySelectorAll(".tutorial-step-card")).map((card) => ({
      title: card.getAttribute("data-step-title") || card.querySelector("h4")?.textContent || "",
      body: card.getAttribute("data-step-body") || card.querySelector("p")?.textContent || ""
    }));

    englishTutorial = {
      steps,
      detailsHtml: detailSection.innerHTML
    };

    window.TUTORIAL_STEPS = steps;
    return englishTutorial;
  }

  // The guide prose itself lives in docs/help.html and stays English: the docs
  // pages are out of the localization scope, and the guide is no longer sent to
  // a model for translation. Only the chrome around it is localized.
  async function render() {
    if (!bodyEl) return;

    const tutorial = await loadTutorialContent();
    const stepsHtml = tutorial.steps
      .map((step) => `<div class="tutorial-step-card"><h4>${step.title}</h4><p>${step.body.replace(/\n/g, "<br>")}</p></div>`)
      .join("");

    bodyEl.innerHTML = `<div class="settings-item tutorial-doc-link-card"><p data-i18n="help.docsIntro">${tr('help.docsIntro', 'Open the full guide in the docs:')}</p><a class="link-item tutorial-doc-link" href="docs/help.html" target="_blank" rel="noopener"><span class="link-icon">📖</span><span class="link-name" data-i18n="help.docsLink">${tr('help.docsLink', 'Help & Tutorial Docs')}</span></a></div>${stepsHtml}<div class="tutorial-details-section">${tutorial.detailsHtml}</div>`;
  }

  window.renderTutorial = async function () {
    try {
      await render();
    } catch (error) {
      console.error("Failed to render tutorial", error);
      if (bodyEl) {
        bodyEl.innerHTML = `<div class="settings-item tutorial-doc-link-card"><p data-i18n="help.loadFailed">${tr('help.loadFailed', 'Help content could not be loaded here.')}</p><a class="link-item tutorial-doc-link" href="docs/help.html" target="_blank" rel="noopener"><span class="link-icon">📖</span><span class="link-name" data-i18n="help.openDocs">${tr('help.openDocs', 'Open Help & Tutorial Docs')}</span></a></div>`;
      }
    }
  };

  window.rerenderTutorial = window.renderTutorial;
  loadTutorialContent().catch((error) => {
    console.error("Failed to preload tutorial content", error);
  });
})();
