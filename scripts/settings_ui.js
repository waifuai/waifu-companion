// Manages the UI aspects of the settings panel, including visibility and populating selectors.

function toggleSettings() {
  // Assumes settingsPanel is accessible
  const willShow = !settingsPanel.classList.contains("visible");
  
  if (willShow && typeof trackEvent === 'function') {
    trackEvent('settings_opened');
  }

  setSettingsPanelVisible(willShow);
}

function setSettingsPanelVisible(visible) {
  settingsPanel.classList.toggle("visible", visible);
  // Reset to main menu when opening/closing
  if (visible) {
    closeSubmenu();
    // Clear search on open
    const searchInput = document.getElementById('settingsSearch');
    if (searchInput) {
      searchInput.value = '';
      filterSettings('');
    }
  }
  try {
    localStorage.setItem('settingsPanelLastOpen', visible.toString());
  } catch (e) {
    debugLog(`Could not persist settingsPanelLastOpen: ${e.message}`, 'warn');
  }
}

window.toggleSettings = toggleSettings;

function openSubmenu(submenuId) {
  if (typeof trackEvent === 'function') trackEvent('settings_submenu_opened', { submenu_id: submenuId });
  const mainMenu = document.getElementById('settingsMainMenu');
  const submenus = document.querySelectorAll('.settings-submenu');
  
  // Prevent opening submenus while searching
  if (settingsPanel.classList.contains('searching')) return;

  if (mainMenu) mainMenu.style.display = 'none';
  submenus.forEach(s => s.classList.remove('active'));
  
  const target = document.getElementById(submenuId);
  if (target) {
    target.classList.add('active');
    settingsPanel.scrollTop = 0;
    
    // Ensure data-category-name is set for search labeling
    const title = target.querySelector('h3')?.textContent || 'General';
    target.setAttribute('data-category-name', title.replace(/[^\w\s]/g, '').trim());

    // Auto-render tutorial content when opening the help submenu
    if (submenuId === 'group-help' && typeof window.renderTutorial === 'function') {
      window.renderTutorial();
    }
  }
}

function closeSubmenu() {
  const mainMenu = document.getElementById('settingsMainMenu');
  const submenus = document.querySelectorAll('.settings-submenu');
  
  if (mainMenu) mainMenu.style.display = 'flex';
  submenus.forEach(s => s.classList.remove('active'));
}

window.openSubmenu = openSubmenu;
window.closeSubmenu = closeSubmenu;

function bindSettingsPanelEvents() {
  if (!settingsPanel || settingsPanel.dataset.eventsBound === 'true') return;

  settingsPanel.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl || !settingsPanel.contains(actionEl)) return;

    const action = actionEl.dataset.action;
    switch (action) {
      case 'open-submenu':
        if (actionEl.dataset.submenu) {
          openSubmenu(actionEl.dataset.submenu);
        }
        break;
      case 'close-submenu':
        closeSubmenu();
        break;
      case 'clear-debug-log':
        if (typeof clearDebugLog === 'function') clearDebugLog();
        break;
      default:
        break;
    }
  });

  settingsPanel.addEventListener('keydown', (event) => {
    const actionEl = event.target.closest('[data-action="open-submenu"]');
    if (!actionEl || !settingsPanel.contains(actionEl)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (actionEl.dataset.submenu) {
        openSubmenu(actionEl.dataset.submenu);
      }
    }
  });

  settingsPanel.dataset.eventsBound = 'true';
}

function filterSettings(query) {
  const mainMenu = document.getElementById('settingsMainMenu');
  const searchResults = document.getElementById('settingsSearchResults');
  const normalizedQuery = query.toLowerCase().trim();
  const submenus = document.querySelectorAll('.settings-submenu');
  
  if (!normalizedQuery) {
    // Reset to normal menu view
    settingsPanel.classList.remove('searching');
    if (mainMenu) mainMenu.style.display = 'flex';
    if (searchResults) {
      searchResults.style.display = 'none';
      searchResults.innerHTML = '';
    }
    // Restore all items in their original submenus
    submenus.forEach(submenu => {
      submenu.querySelectorAll('.settings-item').forEach(item => item.style.display = 'block');
    });
    return;
  }

  // Active search state
  settingsPanel.classList.add('searching');
  closeSubmenu(); // Always go back to main panel to show flattened results
  if (mainMenu) mainMenu.style.display = 'none';
  if (searchResults) {
    searchResults.style.display = 'block';
    searchResults.innerHTML = '';
  }

  let totalMatches = 0;

  submenus.forEach(submenu => {
    const categoryTitle = submenu.querySelector('h3')?.textContent || 'General';
    const settingsItems = submenu.querySelectorAll('.settings-item');
    let categoryHasMatch = false;

    settingsItems.forEach(item => {
      const itemText = item.textContent.toLowerCase();
      // Also check if the category title matches, showing all items in it
      const categoryMatch = categoryTitle.toLowerCase().includes(normalizedQuery);
      const isItemMatch = itemText.includes(normalizedQuery) || categoryMatch;

      if (isItemMatch) {
        if (!categoryHasMatch) {
          const header = document.createElement('div');
          header.className = 'search-result-category';
          header.textContent = categoryTitle;
          searchResults.appendChild(header);
          categoryHasMatch = true;
        }
        
        // Instead of cloning (which breaks IDs/listeners), we use a placeholder 
        // to move the element temporarily or just display them where they are.
        // Actually, the CSS-only approach with some JS help is safer.
        // We'll mark the original items as matches.
        item.classList.add('search-match');
        totalMatches++;
        
        // Create a visual copy or move the element? 
        // Moving is best for events but breaks submenu structure.
        // We will just force show the submenus in CSS and hide non-matches.
      } else {
        item.classList.remove('search-match');
      }
    });
  });

  if (totalMatches === 0 && searchResults) {
    searchResults.innerHTML = '<div class="no-results" data-ui-key="noResultsFound">No matching settings found.</div>';
  } else if (searchResults) {
    searchResults.innerHTML = ''; // Clear the "header" logic if we use the CSS-only approach
  }
}

// Initialize search listener
document.addEventListener('DOMContentLoaded', () => {
  bindSettingsPanelEvents();

  // Pre-set category names for search flattening
  document.querySelectorAll('.settings-submenu').forEach(submenu => {
    const title = submenu.querySelector('h3')?.textContent || 'General';
    submenu.setAttribute('data-category-name', title.trim());
  });

  const searchInput = document.getElementById('settingsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterSettings(e.target.value);
    });
    
    // Clear search on escape key if focused
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        filterSettings('');
        searchInput.blur();
      }
    });
  }
});

function populateModelSelector() {
  // Use the container inside the settings panel instead of the separate one
  const container = document.getElementById('modelSelectorContainer');

  if (!container || !availableModels) {
    debugLog('Model selector container or available models list not found.', 'error');
    return;
  }

  // Clear previous content
  container.innerHTML = '';

  // Create the display area for the selected model
  const selectedDisplay = document.createElement('div');
  selectedDisplay.className = 'model-selector-selected';
  selectedDisplay.innerHTML = `
    <img src="" alt="Selected model" class="model-selector-selected-img">
    <span class="model-selector-selected-name">Select Model</span>
    <span class="model-selector-arrow">▼</span>
  `;
  container.appendChild(selectedDisplay);

  // Create the dropdown list
  const dropdownList = document.createElement('ul');
  dropdownList.className = 'model-selector-dropdown';
  container.appendChild(dropdownList);

  // Make container position relative for absolute positioning of dropdown
  container.style.position = 'relative';

  // Populate the dropdown list
  availableModels.forEach(model => {
    const listItem = document.createElement('li');
    listItem.dataset.value = model.url; // Store URL in data attribute
    listItem.dataset.image = model.image; // Store image path
    listItem.dataset.name = model.name; // Store name
    listItem.innerHTML = `
      <img src="${model.image}" alt="${model.name}" class="model-selector-option-img">
      <span>${model.name}</span>
    `;
    dropdownList.appendChild(listItem);

    // Add click listener to each item
    listItem.addEventListener('click', (e) => {
      const selectedUrl = e.currentTarget.dataset.value;
      const selectedImage = e.currentTarget.dataset.image;
      const selectedName = e.currentTarget.dataset.name;

      // Update the display
      selectedDisplay.querySelector('.model-selector-selected-img').src = selectedImage;
      selectedDisplay.querySelector('.model-selector-selected-name').textContent = selectedName;

      // Trigger the model load (similar to the original change event)
      // We'll need to ensure the loadModel function is accessible or trigger an event
      if (loadModel) {
        debugLog(`Model selection changed to: ${selectedUrl}`, 'info');
        loadModel(selectedUrl)
          .then(() => localStorage.setItem('selectedModelUrl', selectedUrl))
          .catch(error => {
            debugError('Failed to load selected Live2D model', error, { url: selectedUrl });
            addMessage(`Sorry, I couldn't load that model (${error.message}).`, false);
            // Optionally revert display?
          });
      } else {
        debugLog('loadModel function not found.', 'error');
      }

      // Close the dropdown
      dropdownList.style.display = 'none';
      selectedDisplay.classList.remove('open');
    });
  });

  // Add click listener to the display area to toggle the dropdown
  selectedDisplay.addEventListener('click', () => {
    const isOpen = dropdownList.style.display === 'block';
    dropdownList.style.display = isOpen ? 'none' : 'block';
    selectedDisplay.classList.toggle('open', !isOpen);
  });

  // Close dropdown if clicking outside - update selector for settings panel context
  document.addEventListener('click', (event) => {
    if (!container.contains(event.target)) {
      dropdownList.style.display = 'none';
      selectedDisplay.classList.remove('open');
    }
  });

  // Set initial selected display (using saved or default)
  const initialModelUrl = localStorage.getItem('selectedModelUrl') || defaultModelUrl;
  const initialModel = availableModels.find(m => m.url === initialModelUrl) || availableModels[0];
  if (initialModel) {
    selectedDisplay.querySelector('.model-selector-selected-img').src = initialModel.image;
    selectedDisplay.querySelector('.model-selector-selected-name').textContent = initialModel.name;
  }
  // Render the custom models list after selector is ready
  if (typeof renderCustomModelsList === 'function') renderCustomModelsList();
}

// Populate Custom Models dropdown and bind change to load selected model
function renderCustomModelsList() {
  const dropdown = document.getElementById('customModelsDropdown');
  if (!dropdown) return;
  let userModels = [];
  try { userModels = JSON.parse(localStorage.getItem('userModels') || '[]'); } catch (e) { userModels = []; }
  dropdown.innerHTML = '';
  if (!Array.isArray(userModels) || userModels.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No custom models added';
    opt.disabled = true; opt.selected = true; opt.value = '';
    dropdown.appendChild(opt);
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.textContent = 'Select a custom model';
  placeholder.disabled = true; placeholder.selected = true; placeholder.value = '';
  dropdown.appendChild(placeholder);
  userModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.url; opt.textContent = m.name || m.url;
    dropdown.appendChild(opt);
  });
  dropdown.onchange = (e) => {
    const url = e.target.value;
    const model = (window.availableModels || []).find(m => m.url === url);
    if (!url || !model) {
      updateCustomModelInfo('');
      return;
    }
    const selector = document.getElementById('modelSelectorContainer');
    const imgEl = selector?.querySelector('.model-selector-selected-img');
    const nameEl = selector?.querySelector('.model-selector-selected-name');
    if (imgEl) imgEl.src = model.image || 'https://via.placeholder.com/64?text=L2D';
    if (nameEl) nameEl.textContent = model.name || 'Custom Model';
    if (typeof loadModel === 'function') {
      loadModel(url)
        .then(() => { try { localStorage.setItem('selectedModelUrl', url); } catch (e) { debugLog(`Settings: persist selectedModelUrl failed: ${e.message}`, 'warn', true); } })
        .catch(err => debugError('Failed to load custom model from dropdown', err, { url: url }));
    }
    updateCustomModelInfo(url);
  };
  updateCustomModelInfo('');
}

function updateCustomModelInfo(url) {
  const wrap = document.getElementById('customModelInfo'); if (!wrap) return;
  if (!url) { wrap.innerHTML = ''; return; }
  let userModels = []; try { userModels = JSON.parse(localStorage.getItem('userModels') || '[]'); } catch (e) { debugLog(`Settings: userModels parse error: ${e.message}`, 'warn', true); }
  const m = userModels.find(x => x.url === url); if (!m) { wrap.innerHTML = ''; return; }
  const img = m.image || 'https://via.placeholder.com/64?text=L2D';
  wrap.innerHTML = `<div class="custom-model-info"><img src="${img}" alt="${m.name || 'Custom Model'}"><div class="meta"><div class="name">${m.name || 'Custom Model'}</div><a class="url" href="${m.url}" target="_blank" rel="noopener">${m.url}</a></div><button class="remove-btn" data-url="${m.url}">Remove</button></div>`;
  wrap.querySelector('.remove-btn')?.addEventListener('click', () => {
    const u = m.url; if (typeof handleRemoveCustomModel === 'function') handleRemoveCustomModel(u);
    renderCustomModelsList(); updateCustomModelInfo('');
    const dd = document.getElementById('customModelsDropdown'); if (dd) dd.value = '';
  });
}
window.updateCustomModelInfo = updateCustomModelInfo;

function populateLanguageSelector() {
  // Assumes languageSelector (dropdown element) and languages (config array) are accessible
  // Also assumes selectedLanguageCode (global) has been initialized from localStorage or default
  if (!languageSelector || !languages) {
    debugLog('populateLanguageSelector: languageSelector or languages array not found. Cannot populate.', 'error');
    return;
  }
  languageSelector.innerHTML = ''; // Clear existing options

  if (languages.length === 0) {
    debugLog('populateLanguageSelector: languages array is empty. Dropdown will be empty.', 'warn');
    return; // No languages to add
  }

  // Show all languages now - AI will translate any language
  languages.forEach(lang => {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = `${lang.englishName} (${lang.nativeName})`;
    languageSelector.appendChild(option);
  });

  // Set current selection based on the global selectedLanguageCode
  languageSelector.value = selectedLanguageCode;

  // Fallback if the selectedLanguageCode from localStorage isn't a valid option anymore
  if (languageSelector.selectedIndex === -1 && languages.length > 0) {
    debugLog(`Warning: selectedLanguageCode '${selectedLanguageCode}' not found in dropdown. Defaulting to first option: '${languages[0].code}'.`, 'warn');
    languageSelector.value = languages[0].code;
    selectedLanguageCode = languages[0].code; // Update global state
    localStorage.setItem('selectedLanguageCode', selectedLanguageCode); // Persist fallback
  }
  debugLog(`Language selector populated with all ${languages.length} languages. Current selected: ${selectedLanguageCode}. Dropdown actual value: ${languageSelector.value}`, 'info');

  // Update voice selector when language selector is populated
  populateVoiceSelector();
}

function populateVoiceSelector() {
  if (!voiceSelector || !voices) {
    debugLog('populateVoiceSelector: voiceSelector or voices array not found. Cannot populate.', 'error');
    return;
  }

  voiceSelector.innerHTML = ''; // Clear existing options

  // Add "None" option first
  const noneOption = document.createElement('option');
  noneOption.value = 'none';
  noneOption.textContent = 'None';
  voiceSelector.appendChild(noneOption);

  // Requirement: Display ALL WebSim TTS voices regardless of language selection.
  const uniqueVoices = new Map();
  voices.forEach(voice => {
    if (!uniqueVoices.has(voice.id)) {
      uniqueVoices.set(voice.id, voice);
    }
  });

  const availableVoices = Array.from(uniqueVoices.values());

  availableVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.id;
    const providerLabel = voice.provider === 'tiktok' ? 'TikTok' : voice.provider === 'streamelements' ? 'StreamElements' : voice.provider === 'kokoro' ? 'Kokoro' : voice.provider === 'browser' ? 'Browser' : 'Unknown';
    option.textContent = voice.provider === 'tiktok' ? voice.name : `${voice.name} (${providerLabel})`;
    voiceSelector.appendChild(option);
  });

  // Determine the best voice for the current language
  // Uses voiceLanguageOverrides to find a fallback voice for languages without native TTS
  function getDefaultVoiceForLanguage(langCode) {
    const baseLangCode = langCode.split('-')[0];

    // Check if this language has an override mapping
    const overrides = window.voiceLanguageOverrides || {};
    const overrideLang = overrides[langCode] || overrides[baseLangCode];

    // Determine which base language to look for
    const targetBaseLang = overrideLang || baseLangCode;

    // Find female voice for the target language (prefer TikTok)
    const femaleVoice = availableVoices.find(v =>
      v.language.split('-')[0] === targetBaseLang &&
      v.gender === 'female' &&
      v.provider === 'tiktok'
    );

    if (femaleVoice) {
      return femaleVoice.id;
    }

    // Fallback: check langConfig's defaultVoiceId
    const langConfig = languages.find(l => l.code === langCode);
    if (langConfig && langConfig.defaultVoiceId) {
      // Check if that defaultVoiceId is a valid voice
      if (availableVoices.some(v => v.id === langConfig.defaultVoiceId)) {
        return langConfig.defaultVoiceId;
      }
    }

    // Final fallback: English female or first available
    const enFemale = availableVoices.find(v => v.id === 'en-female');
    return enFemale ? 'en-female' : (availableVoices[0]?.id || 'none');
  }

  // Get the default voice for current language
  const defaultVoiceForLang = getDefaultVoiceForLanguage(selectedLanguageCode);

  // Check if user explicitly set to 'none'
  const savedVoiceId = localStorage.getItem('selectedVoiceId');
  if (savedVoiceId === 'none') {
    selectedVoiceId = 'none';
  } else {
    // Always use the appropriate default voice for the current language
    // This ensures voice switches when language changes
    selectedVoiceId = defaultVoiceForLang;
    localStorage.setItem('selectedVoiceId', selectedVoiceId);
  }

  voiceSelector.value = selectedVoiceId;
  debugLog(`Voice selector populated. Language: ${selectedLanguageCode}, Selected voice: ${selectedVoiceId}`, 'info');
  
  // Populate fallback selector as well
  populateFallbackVoiceSelector();
  // Populate Kokoro selector as well
  populateKokoroVoiceSelector();
}

function populateKokoroVoiceSelector() {
  const kokoroSelector = document.getElementById('kokoroVoiceSelector');
  if (!kokoroSelector || !voices) return;

  kokoroSelector.innerHTML = '';
  
  const kokoroVoices = voices.filter(v => v.provider === 'kokoro');
  
  kokoroVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = voice.name;
    kokoroSelector.appendChild(option);
  });

  kokoroSelector.value = window.selectedKokoroVoiceId || 'af_heart';
  
  debugLog(`Kokoro voice selector populated. Selected: ${kokoroSelector.value}`, 'info');
}

function populateFallbackVoiceSelector() {
  const fallbackSelector = document.getElementById('ttsFallbackVoiceSelector');
  if (!fallbackSelector || !voices) return;

  fallbackSelector.innerHTML = '';
  
  // Only show browser provider voices for fallback
  const browserVoices = voices.filter(v => v.provider === 'browser');
  
  browserVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = voice.name;
    fallbackSelector.appendChild(option);
  });

  // Set initial value from global state
  if (window.ttsFallbackVoiceId) {
    fallbackSelector.value = window.ttsFallbackVoiceId;
  } else {
    // Default to female if not set
    fallbackSelector.value = 'browser-female';
    window.ttsFallbackVoiceId = 'browser-female';
  }
  
  debugLog(`Fallback voice selector populated. Selected: ${fallbackSelector.value}`, 'info');
}



function applyBackgroundFit(mode) {
  const m = String(mode || '').toLowerCase();
  const bgLayer = document.getElementById('bgLayer');
  if (!bgLayer) return;

  // defaults
  bgLayer.style.backgroundRepeat = 'no-repeat';
  switch (m) {
    case 'contain':
    case 'contain-center':
      bgLayer.style.backgroundSize = 'contain';
      bgLayer.style.backgroundPosition = 'center center';
      break;
    case 'contain-top':
      bgLayer.style.backgroundSize = 'contain';
      bgLayer.style.backgroundPosition = 'center top';
      break;
    case 'contain-bottom':
      bgLayer.style.backgroundSize = 'contain';
      bgLayer.style.backgroundPosition = 'center bottom';
      break;
    case 'cover':
    case 'cover-center':
      bgLayer.style.backgroundSize = 'cover';
      bgLayer.style.backgroundPosition = 'center center';
      break;
    case 'cover-top':
      bgLayer.style.backgroundSize = 'cover';
      bgLayer.style.backgroundPosition = 'center top';
      break;
    case 'cover-bottom':
      bgLayer.style.backgroundSize = 'cover';
      bgLayer.style.backgroundPosition = 'center bottom';
      break;
    case 'fit-width':
      bgLayer.style.backgroundSize = '100% auto';
      bgLayer.style.backgroundPosition = 'center center';
      break;
    case 'fit-height':
      bgLayer.style.backgroundSize = 'auto 100%';
      bgLayer.style.backgroundPosition = 'center center';
      break;
    case 'stretch':
      bgLayer.style.backgroundSize = '100% 100%';
      bgLayer.style.backgroundPosition = 'center center';
      break;
    default:
      bgLayer.style.backgroundSize = 'cover';
      bgLayer.style.backgroundPosition = 'center center';
  }
  try { localStorage.setItem('bgFitMode', m || 'cover'); } catch (e) { debugLog(`Settings: persist bgFitMode failed: ${e.message}`, 'warn', true); }
  setActiveBgFitButton(m || 'cover');
}

function setActiveBgFitButton(mode) {
  const ids = [
    'bgFitContainBtn', 'bgFitCoverBtn', 'bgFitStretchBtn',
    'bgFitCoverTopBtn', 'bgFitCoverCenterBtn', 'bgFitCoverBottomBtn',
    'bgFitContainTopBtn', 'bgFitContainCenterBtn', 'bgFitContainBottomBtn',
    'bgFitFitWidthBtn', 'bgFitFitHeightBtn'
  ];
  ids.forEach(id => document.getElementById(id)?.classList.remove('active'));
  const map = {
    'contain': 'bgFitContainBtn', 'contain-center': 'bgFitContainCenterBtn', 'contain-top': 'bgFitContainTopBtn', 'contain-bottom': 'bgFitContainBottomBtn',
    'cover': 'bgFitCoverBtn', 'cover-center': 'bgFitCoverCenterBtn', 'cover-top': 'bgFitCoverTopBtn', 'cover-bottom': 'bgFitCoverBottomBtn',
    'fit-width': 'bgFitFitWidthBtn', 'fit-height': 'bgFitFitHeightBtn', 'stretch': 'bgFitStretchBtn'
  };
  const targetId = map[mode] || map['cover'];
  document.getElementById(targetId)?.classList.add('active');
}
