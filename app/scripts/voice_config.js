// Voice configuration data for TTS
window.voices = [
  // The default follows the reply language. Optional choices load below.
  // Legacy id kept so saved settings still resolve; it now selects a browser
  // SpeechSynthesis voice that follows the reply language.
  { id: 'cloud', name: 'Browser Voice (auto language)', language: 'en-US', gender: 'female', provider: 'browser' },
  // Optional external TikTok-style voices. Selecting one is an explicit opt-in:
  // reply text is sent to an external speech service. None is selected by default.
  ...(window.TikTokTTS ? window.TikTokTTS.VOICES : []),
  // Browser SpeechSynthesis Voices (built-in, no rate limits)
  { id: 'browser-female', name: 'Browser Voice (Female)', language: 'en-US', gender: 'female', provider: 'browser' },
  { id: 'browser-male', name: 'Browser Voice (Male)', language: 'en-US', gender: 'male', provider: 'browser' },

  // Kokoro TTS Voices (Local ONNX)
  { id: 'af_heart', name: 'Kokoro: Heart (Female)', language: 'en-US', gender: 'female', provider: 'kokoro' },
  { id: 'af_bella', name: 'Kokoro: Bella (Female)', language: 'en-US', gender: 'female', provider: 'kokoro' },
  { id: 'af_nicole', name: 'Kokoro: Nicole (Female)', language: 'en-US', gender: 'female', provider: 'kokoro' },
  { id: 'af_sarah', name: 'Kokoro: Sarah (Female)', language: 'en-US', gender: 'female', provider: 'kokoro' },
  { id: 'af_sky', name: 'Kokoro: Sky (Female)', language: 'en-US', gender: 'female', provider: 'kokoro' },
  { id: 'am_adam', name: 'Kokoro: Adam (Male)', language: 'en-US', gender: 'male', provider: 'kokoro' },
  { id: 'am_michael', name: 'Kokoro: Michael (Male)', language: 'en-US', gender: 'male', provider: 'kokoro' },
  { id: 'bf_alice', name: 'Kokoro: Alice (Female, UK)', language: 'en-GB', gender: 'female', provider: 'kokoro' },
  { id: 'bf_emma', name: 'Kokoro: Emma (Female, UK)', language: 'en-GB', gender: 'female', provider: 'kokoro' },
  { id: 'bm_george', name: 'Kokoro: George (Male, UK)', language: 'en-GB', gender: 'male', provider: 'kokoro' },
  { id: 'bm_lewis', name: 'Kokoro: Lewis (Male, UK)', language: 'en-GB', gender: 'male', provider: 'kokoro' }
];

// Map languages to a base language whose voice characteristics they inherit.
window.voiceLanguageOverrides = {
  ace: 'id', ban: 'id', btx: 'id', bts: 'id', bbc: 'id', bew: 'id',
  jv: 'id', mak: 'id', 'ms-MS': 'id', 'ms-Arab': 'id', min: 'id', su: 'id',
  'id-ID': 'id', 'tl': 'id',
  bik: 'id', ceb: 'id', hil: 'id', ilo: 'id', pam: 'id', pag: 'id',
  fj: 'id', sm: 'id', mi: 'id', haw: 'id', tet: 'id', mg: 'id',
  uk: 'ru', be: 'ru',
  bg: 'ru', mk: 'ru', sr: 'ru', bs: 'ru', hr: 'ru', sl: 'ru',
  ab: 'ru', ba: 'ru', bua: 'ru', cv: 'ru', crh: 'ru',
  kk: 'ru', ky: 'ru', tt: 'ru', tk: 'ru', uz: 'ru', az: 'ru', tr: 'ru',
  mn: 'ru', chm: 'ru', tg: 'ru', ka: 'ru', hy: 'ru',
  yue: 'zh', my: 'zh', lo: 'zh', th: 'zh', km: 'zh', vi: 'zh', dz: 'zh',
  bn: 'hi', as: 'hi', gu: 'hi', mr: 'hi', pa: 'hi', 'pa-Arab': 'hi',
  ne: 'hi', or: 'hi', sa: 'hi', bho: 'hi', mai: 'hi', awa: 'hi',
  doi: 'hi', gom: 'hi', sd: 'hi', ur: 'hi', 'new': 'hi', si: 'hi', dv: 'hi',
  ta: 'hi', te: 'hi', kn: 'hi', ml: 'hi',
  'mni-Mtei': 'hi', lus: 'hi', cnh: 'hi', shn: 'hi',
  ca: 'gl', gl: 'es', qu: 'es', ay: 'es', gn: 'es', yua: 'es',
  pap: 'es', ht: 'fr', scn: 'it', lij: 'it', lmo: 'it', co: 'it',
  oc: 'fr', br: 'fr', 'fr-CA': 'fr', ro: 'it', pt: 'pt', la: 'it',
  nl: 'de', af: 'de', fy: 'de', lb: 'de', li: 'de', hrx: 'de', yi: 'de',
  da: 'en', sv: 'en', no: 'en', is: 'en',
  ga: 'en', gd: 'en', cy: 'en',
  fi: 'en', et: 'en', hu: 'en', lv: 'en', lt: 'en', ltg: 'en', eo: 'en',
  pl: 'de', cs: 'de', sk: 'de', szl: 'de',
  ar: 'en', he: 'en', am: 'en', ti: 'en', om: 'en', so: 'en', ha: 'en', mt: 'en',
  sw: 'en', zu: 'en', xh: 'en', sn: 'en', rw: 'en', rn: 'en',
  lg: 'en', ny: 'en', ts: 'en', tn: 'en', st: 'en', ss: 'en', nr: 'en',
  bem: 'en', cgg: 'en', luo: 'en', nso: 'en', ktu: 'en',
  bm: 'ff', ff: 'fr', ln: 'fr', sg: 'fr',
  yo: 'en', ig: 'en', ee: 'en', ak: 'en', gaa: 'en', kri: 'en',
  din: 'en', nus: 'en', ach: 'en', alz: 'en', crs: 'fr', dov: 'en',
  fa: 'en', ps: 'en', ku: 'en', ckb: 'en',
  'ko-KR': 'ja',
  ug: 'ru', hmn: 'zh', el: 'it', rom: 'ru', eu: 'es', sq: 'it'
};
// Voice choices are application data. Keep the saved choice when the catalog
// is temporarily unavailable, including while the page is starting up.
// Saved `cloud:<id>` choices are honored as legacy ids: they resolve to a
// browser voice, never to a fetched catalog. No /voices request is made.
window.isCloudVoiceChoice = id => /^cloud:[a-z0-9-]{1,40}$/.test(id || '');
window.showCloudVoiceStatus = message => {
  const element=document.getElementById('cloudVoiceStatus');
  if(element)element.textContent=message || '';
};
window.loadCloudVoiceChoices = async () => {
  // Retired public service: the catalog endpoint is gone. Keep the saved
  // choice as-is; fetchTTSBuffer maps it to a browser voice at playback time.
  window.showCloudVoiceStatus?.('');
};

// Voice events are local only; there is no /events reporting endpoint.
window.reportVoiceEvent = () => {};
