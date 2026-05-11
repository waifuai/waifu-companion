// Loads help/tutorial content from docs/help.html
(function () {
  const bodyEl = document.getElementById("settingsTutorialContent");
  let englishTutorial = null;
  const translatedDetailsCache = new Map();

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

  async function render() {
    if (!bodyEl) return;

    const langCode = window.currentInterfaceLanguage || "en-US";
    const tutorial = await loadTutorialContent();

    let displaySteps = tutorial.steps;
    if (langCode !== "en-US") {
      if (window.lastTutorialLang !== langCode) {
        bodyEl.innerHTML = '<div style="text-align:center; padding: 20px; color: #aaa; font-size: 13px;">Translating guide... ⏳</div>';
      }
      displaySteps = await translateTutorialSteps(tutorial.steps, langCode);
    }

    let detailsHtml = translatedDetailsCache.get(langCode);
    if (!detailsHtml) {
      detailsHtml = langCode === "en-US"
        ? tutorial.detailsHtml
        : await translateTutorialSecondHalf(langCode, tutorial.detailsHtml);
      translatedDetailsCache.set(langCode, detailsHtml);
    }

    const stepsHtml = displaySteps
      .map((step) => `<div class="tutorial-step-card"><h4>${step.title}</h4><p>${step.body.replace(/\n/g, "<br>")}</p></div>`)
      .join("");

    bodyEl.innerHTML = `<div class="settings-item tutorial-doc-link-card"><p>Open the full guide in the docs:</p><a class="link-item tutorial-doc-link" href="docs/help.html" target="_blank" rel="noopener"><span class="link-icon">📖</span><span class="link-name">Help & Tutorial Docs</span></a></div>${stepsHtml}<div class="tutorial-details-section">${detailsHtml}</div>`;
    window.lastTutorialLang = langCode;
  }

  window.renderTutorial = async function () {
    try {
      await render();
    } catch (error) {
      console.error("Failed to render tutorial", error);
      if (bodyEl) {
        bodyEl.innerHTML = '<div class="settings-item tutorial-doc-link-card"><p>Help content could not be loaded here.</p><a class="link-item tutorial-doc-link" href="docs/help.html" target="_blank" rel="noopener"><span class="link-icon">📖</span><span class="link-name">Open Help & Tutorial Docs</span></a></div>';
      }
    }
  };

  window.rerenderTutorial = window.renderTutorial;
  loadTutorialContent().catch((error) => {
    console.error("Failed to preload tutorial content", error);
  });
})();
