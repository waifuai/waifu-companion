// This file centralizes the large language data array, making it more manageable.
// REFACTOR: The massive inline language array has been moved to languages_full_data.js
// removed massive inline language array definition

(function() {
  // Utility: ensure each item has required properties and a typing indicator function
  function ensureTypingIndicator(entry) {
    if (typeof entry.typingIndicatorText !== 'function') {
      // Fallback typing indicator in the target language if known, else English.
      // We keep it simple: interpolate the character name.
      entry.typingIndicatorText = (name) => `${name} is typing...`;
    }
    return entry;
  }

  function ensureDefaults(entry) {
    // Fallbacks for missing fields to keep runtime robust
    if (!entry.code) entry.code = 'xx';
    if (!entry.englishName) entry.englishName = entry.code;
    if (!entry.nativeName) entry.nativeName = entry.englishName;
    if (!entry.sampleText) entry.sampleText = 'Hello';
    // defaultVoiceId is optional; voice selector logic already handles missing voices
    return ensureTypingIndicator(entry);
  }

  // Sorting: keep en-US first, then alphabetical by englishName
  function sortLanguages(arr) {
    return arr.sort((a, b) => {
      if (a.code === 'en-US') return -1;
      if (b.code === 'en-US') return 1;
      return (a.englishName || '').localeCompare(b.englishName || '');
    });
  }

  // Public API (unchanged): getLanguages()
  window.LanguageDataManager = {
    getLanguages: function() {
      // languages_full_data.js should define window.LANGUAGE_DATA_RAW as an array of objects
      const raw = Array.isArray(window.LANGUAGE_DATA_RAW) ? window.LANGUAGE_DATA_RAW : [];

      // Normalize and sort
      const normalized = raw.map(ensureDefaults);
      return sortLanguages(normalized);
    }
  };
})();