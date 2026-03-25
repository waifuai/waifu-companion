// Voice configuration data for TTS
window.voices = [
  // Websim TTS Voices
  { id: 'en-male', name: 'WebSim English (Male)', language: 'en-US', gender: 'male', provider: 'websim' },
  { id: 'en-female', name: 'WebSim English (Female)', language: 'en-US', gender: 'female', provider: 'websim' },
  { id: 'ja-male', name: 'WebSim Japanese (Male)', language: 'ja-JP', gender: 'male', provider: 'websim' },
  { id: 'ja-female', name: 'WebSim Japanese (Female)', language: 'ja-JP', gender: 'female', provider: 'websim' },
  { id: 'de-male', name: 'WebSim German (Male)', language: 'de-DE', gender: 'male', provider: 'websim' },
  { id: 'de-female', name: 'WebSim German (Female)', language: 'de-DE', gender: 'female', provider: 'websim' },
  { id: 'pt-male', name: 'WebSim Portuguese (Male)', language: 'pt-BR', gender: 'male', provider: 'websim' },
  { id: 'pt-female', name: 'WebSim Portuguese (Female)', language: 'pt-BR', gender: 'female', provider: 'websim' },
  { id: 'es-male', name: 'WebSim Spanish (Male)', language: 'es-ES', gender: 'male', provider: 'websim' },
  { id: 'es-female', name: 'WebSim Spanish (Female)', language: 'es-ES', gender: 'female', provider: 'websim' },
  { id: 'fr-male', name: 'WebSim French (Male)', language: 'fr-FR', gender: 'male', provider: 'websim' },
  { id: 'fr-female', name: 'WebSim French (Female)', language: 'fr-FR', gender: 'female', provider: 'websim' },
  { id: 'zh-male', name: 'WebSim Chinese (Male)', language: 'zh', gender: 'male', provider: 'websim' },
  { id: 'zh-female', name: 'WebSim Chinese (Female)', language: 'zh', gender: 'female', provider: 'websim' },
  { id: 'zh-tw-male', name: 'WebSim Chinese (TW, Male)', language: 'zh-TW', gender: 'male', provider: 'websim' },
  { id: 'zh-tw-female', name: 'WebSim Chinese (TW, Female)', language: 'zh-TW', gender: 'female', provider: 'websim' },
  { id: 'tl-male', name: 'WebSim Filipino (Male)', language: 'tl', gender: 'male', provider: 'websim' },
  { id: 'tl-female', name: 'WebSim Filipino (Female)', language: 'tl', gender: 'female', provider: 'websim' },
  { id: 'it-male', name: 'WebSim Italian (Male)', language: 'it', gender: 'male', provider: 'websim' },
  { id: 'it-female', name: 'WebSim Italian (Female)', language: 'it', gender: 'female', provider: 'websim' },
  { id: 'ru-male', name: 'WebSim Russian (Male)', language: 'ru', gender: 'male', provider: 'websim' },
  { id: 'ru-female', name: 'WebSim Russian (Female)', language: 'ru', gender: 'female', provider: 'websim' },
  { id: 'hi-male', name: 'WebSim Hindi (Male)', language: 'hi', gender: 'male', provider: 'websim' },
  { id: 'hi-female', name: 'WebSim Hindi (Female)', language: 'hi', gender: 'female', provider: 'websim' },

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

// Map languages to a proxy base language whose voices they should inherit
// Based on phonetic similarity, language family, and prosodic features
window.voiceLanguageOverrides = {
  // === AUSTRONESIAN LANGUAGES → Filipino (tl) ===
  // Indonesian/Malay family (no Indonesian voice, Filipino is closest Austronesian)
  ace: 'tl', ban: 'tl', btx: 'tl', bts: 'tl', bbc: 'tl', bew: 'tl',
  jv: 'tl', mak: 'tl', 'ms-MS': 'tl', 'ms-Arab': 'tl', min: 'tl', su: 'tl',
  'id-ID': 'tl', // Indonesian
  // Philippine languages
  bik: 'tl', ceb: 'tl', hil: 'tl', ilo: 'tl', pam: 'tl', pag: 'tl',
  // Pacific Austronesian
  fj: 'tl', sm: 'tl', mi: 'tl', haw: 'tl', tet: 'tl', mg: 'tl',

  // === SLAVIC & POST-SOVIET LANGUAGES → Russian (ru) ===
  // East Slavic
  uk: 'ru', be: 'ru',
  // South Slavic (closer to Russian than Western European)
  bg: 'ru', mk: 'ru', sr: 'ru', bs: 'ru', hr: 'ru', sl: 'ru',
  // Turkic languages (historically Russian-influenced, Cyrillic scripts)
  ab: 'ru', ba: 'ru', bua: 'ru', cv: 'ru', crh: 'ru',
  kk: 'ru', ky: 'ru', tt: 'ru', tk: 'ru', uz: 'ru', az: 'ru', tr: 'ru',
  // Mongolic
  mn: 'ru',
  // Uralic (phonetically closer to Russian than English)
  chm: 'ru',
  // Iranian (Tajik uses Cyrillic, Persian-influenced)
  tg: 'ru',
  // Caucasian
  ka: 'ru', hy: 'ru',

  // === SINO-TIBETAN LANGUAGES → Chinese ===
  yue: 'zh', // Cantonese
  my: 'zh', // Burmese (tonal, similar prosody)
  lo: 'zh', // Lao (tonal)
  th: 'zh', // Thai (tonal)
  km: 'zh', // Khmer (regional proximity)
  vi: 'zh', // Vietnamese (tonal, Chinese influence)
  dz: 'zh', // Dzongkha (Tibeto-Burman)

  // === INDO-ARYAN LANGUAGES → Hindi (hi) ===
  bn: 'hi', as: 'hi', // Bengali, Assamese  
  gu: 'hi', mr: 'hi', // Gujarati, Marathi
  pa: 'hi', 'pa-Arab': 'hi', // Punjabi
  ne: 'hi', // Nepali
  or: 'hi', // Odia
  sa: 'hi', // Sanskrit
  bho: 'hi', mai: 'hi', awa: 'hi', // Bhojpuri, Maithili, Awadhi
  doi: 'hi', gom: 'hi', // Dogri, Konkani
  sd: 'hi', ur: 'hi', // Sindhi, Urdu
  'new': 'hi', // Newari
  si: 'hi', // Sinhala
  dv: 'hi', // Divehi (Maldivian)
  // Dravidian (Hindi is closest available)
  ta: 'hi', te: 'hi', kn: 'hi', ml: 'hi',
  // Other South Asian
  'mni-Mtei': 'hi', lus: 'hi', cnh: 'hi', shn: 'hi',

  // === ROMANCE LANGUAGES → Spanish/French/Portuguese/Italian ===
  // Iberian Romance → Spanish
  ca: 'es', gl: 'es', // Catalan, Galician
  // Latin American indigenous with Spanish influence
  qu: 'es', ay: 'es', gn: 'es', yua: 'es',
  // Caribbean Creoles
  pap: 'es', ht: 'fr', // Papiamento (Spanish-based), Haitian (French-based)
  // Italian dialects → Italian
  scn: 'it', lij: 'it', lmo: 'it', co: 'it',
  // French-influenced
  oc: 'fr', br: 'fr', // Occitan, Breton
  'fr-CA': 'fr',
  // Romanian (Romance but Eastern)
  ro: 'it',
  // Portuguese varieties
  pt: 'pt',
  // Latin → Italian (ecclesiastical pronunciation)
  la: 'it',

  // === GERMANIC LANGUAGES → German/English ===
  // Continental Germanic → German
  nl: 'de', // Dutch
  af: 'de', // Afrikaans (Dutch-based)
  fy: 'de', // Frisian
  lb: 'de', // Luxembourgish
  li: 'de', // Limburgish
  hrx: 'de', // Hunsrik (German dialect in Brazil)
  yi: 'de', // Yiddish
  // North Germanic → English (closer prosody than German)
  da: 'en', sv: 'en', no: 'en', is: 'en',
  // Celtic → English
  ga: 'en', gd: 'en', cy: 'en',
  // Uralic/Baltic (English as fallback)
  fi: 'en', et: 'en', hu: 'en',
  lv: 'en', lt: 'en', ltg: 'en',
  // Constructed
  eo: 'en',

  // === WEST SLAVIC LANGUAGES → German (geographical/phonetic) ===
  pl: 'de', cs: 'de', sk: 'de', szl: 'de',

  // === SEMITIC & AFROASIATIC → English (best available) ===
  ar: 'en', he: 'en', am: 'en', ti: 'en', om: 'en', so: 'en', ha: 'en',
  mt: 'en', // Maltese (Semitic but European influence)

  // === AFRICAN LANGUAGES → English/French (colonial influence) ===
  // Bantu languages
  sw: 'en', zu: 'en', xh: 'en', sn: 'en', rw: 'en', rn: 'en',
  lg: 'en', ny: 'en', ts: 'en', tn: 'en', st: 'en', ss: 'en', nr: 'en',
  bem: 'en', cgg: 'en', luo: 'en', nso: 'en', ktu: 'en',
  // West African (French-influenced)
  bm: 'fr', ff: 'fr', ln: 'fr', sg: 'fr',
  // West African (English-influenced)
  yo: 'en', ig: 'en', ee: 'en', ak: 'en', gaa: 'en', kri: 'en',
  // Nilotic
  din: 'en', nus: 'en', ach: 'en', alz: 'en',
  // Creoles
  crs: 'fr', // Seychellois (French-based)
  dov: 'en',

  // === IRANIAN LANGUAGES → Russian/English ===
  fa: 'en', // Persian
  ps: 'en', // Pashto
  ku: 'en', ckb: 'en', // Kurdish

  // === EAST ASIAN (non-Chinese) → Japanese ===
  'ko-KR': 'ja', // Korean (similar prosody, vowel system)

  // === UYGHUR/CENTRAL ASIAN ISOLATES ===
  ug: 'ru', // Uyghur (Turkic)

  // === HMONG-MIEN → Chinese (tonal) ===
  hmn: 'zh',

  // === GREEK → Italian (Mediterranean phonetics) ===
  el: 'it',

  // === ROMANI → Russian (geographic) ===
  rom: 'ru',

  // === BASQUE (isolate) → Spanish (geographic) ===
  eu: 'es',

  // === ALBANIAN → Italian (Balkan/Mediterranean) ===
  sq: 'it'
};