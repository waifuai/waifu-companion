// Optional TikTok-style voices. Selecting one of these voices is an explicit
// opt-in: reply text is sent to an external speech service and the returned
// audio is decoded and played in the browser. The built-in browser and local
// Kokoro voices remain the default and never make a request.
(function (root) {
  'use strict';

  const API_URL = 'https://ottsy.weilbyte.dev/api/generation';
  const GROUP = 'TikTok (external)';

  // Recovered from the earlier in-repo catalog. The ids are kept unchanged so
  // saved voice choices and the language router keep working.
  const VOICES = [
    ['en_us_001', 'TikTok US English (F1)', 'en-US', 'female'],
    ['en_us_002', 'TikTok US English (F2)', 'en-US', 'female'],
    ['en_us_006', 'TikTok US English (M1)', 'en-US', 'male'],
    ['en_us_007', 'TikTok US English (M2)', 'en-US', 'male'],
    ['en_us_009', 'TikTok US English (M3)', 'en-US', 'male'],
    ['en_us_010', 'TikTok US English (M4)', 'en-US', 'male'],
    ['en_uk_001', 'TikTok UK English (M1)', 'en-GB', 'male'],
    ['en_uk_003', 'TikTok UK English (M2)', 'en-GB', 'male'],
    ['en_au_001', 'TikTok Australian English (F)', 'en-AU', 'female'],
    ['en_au_002', 'TikTok Australian English (M)', 'en-AU', 'male'],
    ['fr_001', 'TikTok French (M1)', 'fr-FR', 'male'],
    ['fr_002', 'TikTok French (M2)', 'fr-FR', 'male'],
    ['de_001', 'TikTok German (F)', 'de-DE', 'female'],
    ['de_002', 'TikTok German (M)', 'de-DE', 'male'],
    ['es_002', 'TikTok Spanish ES (M)', 'es-ES', 'male'],
    ['es_mx_002', 'TikTok Spanish MX (M)', 'es-MX', 'male'],
    ['br_001', 'TikTok Portuguese BR (F1)', 'pt-BR', 'female'],
    ['br_003', 'TikTok Portuguese BR (F2)', 'pt-BR', 'female'],
    ['br_004', 'TikTok Portuguese BR (F3)', 'pt-BR', 'female'],
    ['br_005', 'TikTok Portuguese BR (M)', 'pt-BR', 'male'],
    ['jp_001', 'TikTok Japanese (F1)', 'ja-JP', 'female'],
    ['jp_003', 'TikTok Japanese (F2)', 'ja-JP', 'female'],
    ['jp_005', 'TikTok Japanese (F3)', 'ja-JP', 'female'],
    ['jp_006', 'TikTok Japanese (M)', 'ja-JP', 'male'],
    ['kr_002', 'TikTok Korean (M1)', 'ko-KR', 'male'],
    ['kr_003', 'TikTok Korean (F)', 'ko-KR', 'female'],
    ['kr_004', 'TikTok Korean (M2)', 'ko-KR', 'male'],
    ['id_001', 'TikTok Indonesian (F)', 'id-ID', 'female'],
    ['en_us_ghostface', 'TikTok Ghost Face', 'en-US', 'male'],
    ['en_us_c3po', 'TikTok C3PO', 'en-US', 'male'],
    ['en_us_stitch', 'TikTok Stitch', 'en-US', 'male'],
    ['en_male_pirate', 'TikTok Pirate', 'en-US', 'male'],
    ['en_male_narration', 'TikTok Narrator', 'en-US', 'male'],
    ['en_female_f08_warmy_breeze', 'TikTok Warmy Breeze', 'en-US', 'female'],
    ['en_us_chewbacca', 'TikTok Chewbacca', 'en-US', 'male'],
    ['en_us_stormtrooper', 'TikTok Stormtrooper', 'en-US', 'male'],
    ['en_us_rocket', 'TikTok Rocket', 'en-US', 'male'],
    ['en_us_008', 'TikTok US English (Alt)', 'en-US', 'male'],
    ['en_male_funny', 'TikTok Funny', 'en-US', 'male'],
    ['en_male_m2_xhxs_m03_silly', 'TikTok Silly', 'en-US', 'male'],
    ['en_female_emotional', 'TikTok Emotional (F)', 'en-US', 'female'],
    ['en_female_f08_salut_damour', 'TikTok Salut Damour (Singing)', 'en-US', 'female'],
    ['en_female_f08_twinkle', 'TikTok Twinkle (Singing)', 'en-US', 'female'],
    ['en_female_ht_f08_glorious', 'TikTok Glorious (Singing)', 'en-US', 'female'],
    ['en_female_ht_f08_halloween', 'TikTok Halloween (Singing)', 'en-US', 'female'],
    ['en_female_ht_f08_newyear', 'TikTok New Year (Singing)', 'en-US', 'female'],
    ['en_female_ht_f08_wonderful_world', 'TikTok Wonderful World (Singing)', 'en-US', 'female'],
    ['en_male_m03_lobby', 'TikTok Lobby (Singing)', 'en-US', 'male'],
    ['en_male_m03_sunshine_soon', 'TikTok Sunshine Soon (Singing)', 'en-US', 'male'],
    ['en_male_m03_classical', 'TikTok Classical (Singing)', 'en-US', 'male'],
  ].map(([id, name, language, gender]) => ({ id, name, language, gender, group: GROUP, provider: 'tiktok' }));

  const IDS = new Set(VOICES.map(voice => voice.id));

  async function synthesize(text, voice, options = {}) {
    if (!IDS.has(voice)) throw new Error('Unknown TikTok voice: ' + voice);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text || ''), voice }),
      signal: options.signal,
    });
    if (!response.ok) {
      const error = new Error('TikTok TTS HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    const raw = await response.text();
    let json;
    try { json = JSON.parse(raw); } catch (e) { throw new Error('TikTok TTS returned invalid JSON'); }
    if (json.success === false) throw new Error('TikTok TTS error: ' + (json.error || 'unknown'));
    const audio = json.data || json.audio;
    if (!audio || typeof audio !== 'string') throw new Error('TikTok TTS returned no audio data');
    return audio;
  }

  async function decode(base64Audio, audioContext) {
    const Ctx = root.AudioContext || root.webkitAudioContext;
    const context = audioContext || new Ctx();
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buffer = await context.decodeAudioData(bytes.buffer);
    return { buffer, context };
  }

  root.TikTokTTS = {
    API_URL,
    GROUP,
    VOICES,
    isVoice: id => IDS.has(id),
    synthesize,
    decode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
