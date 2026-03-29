// Manages preloading of the next sentence buffer for TTS
window.TTSPreloader = {
  cache: {
    index: -1,
    buffer: null,
    voiceId: null,
    text: null,
    promise: null // Current pending fetch promise
  },

  async preloadNext(index, text, voiceId) {
    // If we're already preloading this specific index/text, don't restart
    if (this.cache.index === index && this.cache.text === text && this.cache.voiceId === voiceId) {
      return;
    }

    debugLog(`TTS: Preloading next sentence [${index}]...`, 'info', true);
    
    // Clear previous cache
    this.cache = { index, text, voiceId, buffer: null, promise: null };

    // Use the fetch function from audio_player.js (we'll expose it shortly)
    if (typeof window.fetchTTSBuffer === 'function') {
      this.cache.promise = window.fetchTTSBuffer(text, voiceId);
      try {
        this.cache.buffer = await this.cache.promise;
        debugLog(`TTS: Preload successful for sentence [${index}]`, 'info', true);
      } catch (err) {
        debugLog(`TTS: Preload failed for sentence [${index}]: ${err.message}`, 'warn', true);
        this.cache.buffer = null;
      } finally {
        this.cache.promise = null;
      }
    }
  },

  async getPreloadedBuffer(index, text, voiceId) {
    // Check if we have a match
    if (this.cache.index === index && this.cache.text === text && this.cache.voiceId === voiceId) {
      // If it's still loading, wait for it
      if (this.cache.promise) {
        debugLog(`TTS: Waiting for pending preload [${index}]...`, 'info', true);
        await this.cache.promise;
      }
      
      const buffer = this.cache.buffer;
      // Clear cache after use
      this.cache = { index: -1, buffer: null, voiceId: null, text: null, promise: null };
      return buffer;
    }
    
    return null;
  },

  clear() {
    this.cache = { index: -1, buffer: null, voiceId: null, text: null, promise: null };
  }
};

