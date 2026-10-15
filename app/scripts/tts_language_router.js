// Shared speech-language policy. Keep this file identical to the Sprites copy.
// A reply owns one route; conversation state is only a hint for ambiguous text.
(function (global) {
  'use strict';
  const TAGS = { en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', id: 'id-ID', ru: 'ru-RU', ar: 'ar-SA', zh: 'zh-CN', th: 'th-TH', hi: 'hi-IN', he: 'he-IL', el: 'el-GR' };
  const OPTIONS = new Set(['en-US', 'en-GB', 'en-AU', 'ja-JP', 'ko-KR', 'es-ES', 'es-MX', 'fr-FR', 'de-DE', 'pt-BR', 'id-ID']);
  const HINTS = {
    en: 'the and you that have for not with this but what your just like how are was can it is to of in my me we so do if on or at be as an his her they them their would could should there here from about when then than some one all out up who why will well yeah okay ok love want know think feel really very much good happy sad please thanks thank sorry hello hey cute pretty beautiful little big day night morning time right back down over again still only even more most too oh yes no say speak word words means meaning',
    id: 'yang dan itu ini dari apa siapa kenapa bagaimana kapan dimana mana tidak tak bukan jangan aku kamu kau saya anda awak dia kita kami mereka orang dengan untuk pada dalam akan sudah udah belum bisa dapat boleh harus mau ingin suka sayang cinta hati senang sedih lucu cantik manis baik besar kecil banyak semua juga tapi karena kalau jadi adalah ada tahu tau lihat kasih buat bikin makan gambar minum tidur rumah kerja teman nama kabar khabar halo terima maaf tolong selamat banget nggak gak nih dong sih deh kok yuk ayo oke sekarang nanti besok pagi malam hari ang mga ako ikaw niya tayo kayo sila ito dito saan paano bakit hindi wala dahil kasi naman lang talaga salamat kamusta kumusta mahal ganda masaya lahat ingat mahu jom',
    de: 'der die das dem den und oder aber ich wir ihr mich dich sich uns dein sein ihre nicht kein keine ein eine einem einen ist bin bist sind war waren wird werden kann kannst können muss will willst möchte habe hast hat haben für auf von bei nach über unter vor durch ohne wie was wer warum wo wann jetzt dann wenn weil dass doch mal schon nur auch noch immer wieder sehr gut ja nein danke bitte hallo liebe schatz herz tag nacht morgen gern gerne',
    pt: 'não nao sim você voce vocês sou eu ele ela nós mas com para isso isto aqui muito bem tudo nada bom boa dia noite tarde olá ola oi obrigado obrigada desculpa amor querido querida saudade coração coracao beijo gosto gente então entao também tambem quando onde tá né acho vou vai está estão',
    es: 'hola gracias muy usted ustedes eres del ellos ellas nosotros puedo puedes quiero quieres tengo tienes dime dónde donde quién quien bueno buena buenas buenos esto eso siempre nunca mañana noche feliz triste encanta corazón corazon beso lindo linda amiga amigo casa vida tiempo favor cariño estoy estás están somos son mucho hermosa hermoso juntos sabes amo cómo aquí qué siento contigo hablar hablas español espanol perdón adiós necesitas porque también',
    fr: 'bonjour salut merci oui non vous nous tu je suis est et une un des les le la de du au aux pour pas avec dans sur comme mais mon ma mes ton ta tes son sa ses votre notre très bien tout rien ici ça cette ce ces que qui quoi quand où comment pourquoi peux peut aime amour parler français francaise français désolé bonsoir bonne journée revoir contente heureux toi moi il elle ils elles avez avons',
    ja: 'watashi watashino anata kimi boku suki desu masu arigatou arigato konnichiwa konbanwa ohayou oyasumi nihongo daijoubu kawaii sou ne',
  };
  const SETS = Object.fromEntries(Object.entries(HINTS).map(([k, v]) => [k, new Set(v.split(' '))]));
  const ANCHORS = { es: /\b(hola|gracias|español)\b/i, fr: /\b(bonjour|bonsoir|merci|français)\b/i, de: /\b(danke|dankeschön)\b/i, pt: /\b(obrigad[oa])\b|\bolá\b/i, id: /\bterima\s+kasih\b|\bsalamat\b/i };
  const base = lang => String(lang || '').split('-')[0].toLowerCase();
  function clean(text) {
    return String(text || '')
      .replace(/\[(?:IMAGE|画像|صورة)\s*:[^\]]*\]\s*(?:\(translation:[^)]*\))?/gi, ' ')
      .replace(/\((?:sent a picture\s*(?::|of)|image\s*:)[^)]*\)/gi, ' ')
      .replace(/(?:^|\n)\s*Sent a picture:[^\n]*/gi, ' ')
      .replace(/!?\[([^\]]*)\]\(https?:\/\/[^)]*\)/gi, '$1')
      .replace(/https?:\/\/[^\s)]+/gi, ' ')
      .replace(/[ \t]{2,}/g, ' ').trim();
  }
  function analyze(text) {
    const whole = clean(text);
    const prose = whole.replace(/"[^"\n]{1,200}"|“[^”\n]{1,200}”|(?<!\p{L})'[^'\n]{1,80}'(?!\p{L})/gu, ' ');
    const tokens = (prose.toLowerCase().match(/[\p{Script=Latin}]+/gu) || []);
    const unique = new Set(tokens);
    const scores = Object.fromEntries(Object.entries(SETS).map(([lang, set]) => [lang, [...unique].filter(t => set.has(t)).length]));
    const chars = {
      ru: (prose.match(/[\u0400-\u04ff]/g) || []).length,
      ar: (prose.match(/[\u0600-\u06ff]/g) || []).length,
      ja: (prose.match(/[\u3040-\u30ff]/g) || []).length,
      ko: (prose.match(/[\uac00-\ud7af]/g) || []).length,
      zh: (prose.match(/[\u4e00-\u9fff]/g) || []).length,
      th: (prose.match(/[\u0e00-\u0e7f]/g) || []).length,
      hi: (prose.match(/[\u0900-\u097f]/g) || []).length,
      he: (prose.match(/[\u0590-\u05ff]/g) || []).length,
      el: (prose.match(/[\u0370-\u03ff]/g) || []).length,
    };
    if (chars.ja) { chars.ja += chars.zh; chars.zh = 0; }
    const latinChars = tokens.join('').length;
    const total = latinChars + Object.values(chars).reduce((a, b) => a + b, 0);
    const scripts = Object.entries(chars).sort((a, b) => b[1] - a[1]);
    const script = scripts[0][1] ? scripts[0][0] : null;
    const mixedScript = script && scripts[0][1] >= 6 && latinChars >= 12 && scripts[0][1] / total >= .25 && latinChars / total >= .25;
    if (script && scripts[0][1] / Math.max(1, total) >= .65) {
      return { lang: TAGS[script], strong: !mixedScript, needsDecision: !!mixedScript, reason: mixedScript ? 'mixed-script' : 'dominant-script', scores, words: tokens.length };
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [winner, score] = ranked[0], second = ranked[1][1];
    const competing = second >= 3 && second >= score * .65;
    const neutral = /^(?:ok(?:ay)?|yes|no|yeah|sure|hmm|haha|lol|thanks|thank you)[\s.!?,…]*$/i.test(whole);
    if (neutral || !total) return { lang: null, strong: false, needsDecision: false, reason: 'neutral-short', scores, words: tokens.length };
    if (!mixedScript && !competing) {
      const anchor = Object.entries(ANCHORS).find(([lang, pattern]) => pattern.test(prose) && scores[lang] >= scores.en && (tokens.length <= 3 || scores[lang] >= 2));
      if (anchor) return { lang: TAGS[anchor[0]], strong: true, needsDecision: false, reason: 'distinctive-phrase', scores, words: tokens.length };
      if (score >= 3 && score - second >= 2 && score / Math.max(1, unique.size) >= .15) {
        return { lang: TAGS[winner], strong: true, needsDecision: false, reason: 'latin-clear', scores, words: tokens.length };
      }
      if (score >= 2 && second === 0 && unique.size <= 8) {
        return { lang: TAGS[winner], strong: true, needsDecision: false, reason: 'latin-clear', scores, words: tokens.length };
      }
    }
    return { lang: score > second ? TAGS[winner] : null, strong: false, needsDecision: tokens.length >= 3 || !!mixedScript, reason: mixedScript ? 'mixed-script' : competing ? 'competing-latin' : 'weak-latin', scores, words: tokens.length };
  }
  function selectVoice(voices, voiceId, lang, auto = true) {
    const original = voices.find(v => v.id === voiceId) || { id: voiceId, language: 'en-US', provider: 'tiktok', gender: 'female' };
    if (!auto || !lang) return { voiceId, lang: null, provider: original.provider, gender: original.gender };
    if (base(original.language) === base(lang)) return { voiceId, lang: original.language, provider: original.provider, gender: original.gender };
    if (original.provider === 'browser') return { voiceId, lang, provider: 'browser', gender: original.gender };
    const matches = voices.filter(v => v.provider === 'tiktok' && base(v.language) === base(lang));
    const pinned = base(lang) === 'ja' && original.gender !== 'male' && matches.find(v => v.id === 'jp_003');
    const chosen = pinned || matches.find(v => v.gender === original.gender);
    if (chosen) return { voiceId: chosen.id, lang: chosen.language, provider: chosen.provider, gender: chosen.gender };
    return { voiceId, lang, provider: 'browser', gender: original.gender, unsupportedPrimary: true };
  }
  // SpeechSynthesis has no standard gender field. Accept explicit metadata or
  // recognized voice names; never let an unknown system default choose for her.
  function browserVoiceForGender(voices, gender = 'female') {
    const female = /\b(female|woman|girl|zira|hazel|susan|samantha|karen|moira|tessa|fiona|kate|victoria|princess|alice|hortense|julie|helena|monica|mónica|sabina|paulina|zena|hedda|katja|denise|elsa|nanami|haruka|ayumi|heami|sunhi|xiaoxiao|huihui|yaoyao|hanhan|hui min|siti|gadis)\b/i;
    const male = /\b(male|man|boy|david|mark|james|daniel|thomas|george|alex|fred|ralph|paul|pablo|jorge|henri|stefan|ichiro)\b/i;
    const matches = v => v.gender ? v.gender.toLowerCase() === gender : (gender === 'male' ? male : female).test(v.name || '');
    return voices.find(matches) || null;
  }
  function create() {
    const conversations = new Map(), replies = new Map();
    function remember(plan) {
      const state = conversations.get(plan.key);
      if (state && state.sequence === plan.sequence && plan.lang && plan.auto) {
        state.lang = plan.lang;
        state.confirmed = plan.strong || plan.source === 'decision' || (plan.source === 'decision-keep' && state.confirmed);
      }
    }
    function prepare(text, opts = {}) {
      const { key = 'default', voiceId = 'en_us_001', voices = [], auto = true, enabled = true, fingerprint = '' } = opts;
      const spoken = clean(text), signature = JSON.stringify([key, voiceId, auto, fingerprint]);
      const cacheKey = JSON.stringify([signature, spoken]);
      let state = conversations.get(key);
      if (!state || state.signature !== signature) {
        state = { signature, sequence: 0, lang: null, confirmed: false };
        conversations.set(key, state);
        if (conversations.size > 32) conversations.delete(conversations.keys().next().value);
      }
      const cached = replies.get(cacheKey);
      if (enabled && auto && cached && !['neutral-short'].includes(cached.reason) &&
          (!['local-fallback', 'decision-keep'].includes(cached.source) || base(cached.previousLang) === base(state.lang || cached.previousLang))) {
        const reused = { ...cached, cacheHit: true, decisionRequested: false };
        if (cached.pending && !cached.finished) reused.pending = cached.pending.then(plan => ({ ...plan, cacheHit: true, decisionRequested: false }));
        return reused;
      }
      const analysis = analyze(spoken);
      const original = voices.find(v => v.id === voiceId);
      let lang = analysis.strong ? analysis.lang : state.lang || analysis.lang || (original && original.language) || 'en-US';
      let needsDecision = enabled && auto && analysis.needsDecision;
      if (state.confirmed && analysis.reason === 'weak-latin' && (base(analysis.lang) === base(state.lang) || analysis.scores[base(state.lang)] > 0 || Math.max(...Object.values(analysis.scores)) === 0)) needsDecision = false;
      if (analysis.reason === 'neutral-short') lang = state.lang || (original && original.language) || 'en-US';
      const plan = { text: spoken, key, signature, sequence: ++state.sequence, voiceId, auto, lang: auto ? lang : null, previousLang: state.lang || (original && original.language) || 'en-US', strong: analysis.strong, needsDecision, reason: analysis.reason, source: enabled && auto ? 'local' : 'manual', decisionRequested: false, waitMs: 0, finished: !needsDecision, pending: null };
      if (enabled && auto) {
        if (analysis.reason !== 'neutral-short') replies.set(cacheKey, plan);
        if (replies.size > 100) replies.delete(replies.keys().next().value);
        if (analysis.strong) remember(plan);
      }
      return plan;
    }
    function settle(plan, request, task, valid = () => true, deadlineMs = 2000) {
      if (!plan.needsDecision || plan.finished) return Promise.resolve(plan);
      if (plan.pending) return plan.pending;
      plan.decisionRequested = true;
      const started = Date.now();
      plan.pending = new Promise(resolve => {
        let done = false;
        const finish = answers => {
          if (done) return;
          done = true; clearTimeout(timer); plan.finished = true; plan.waitMs = Date.now() - started;
          const answer = answers && answers[task];
          if (valid() && answer && (answer.choice_id === 'keep' || OPTIONS.has(answer.choice_id))) {
            plan.lang = answer.choice_id === 'keep' ? plan.previousLang : answer.choice_id;
            plan.source = answer.choice_id === 'keep' ? 'decision-keep' : 'decision'; remember(plan);
          } else plan.source = valid() ? 'local-fallback' : 'stale';
          resolve(plan);
        };
        const timer = setTimeout(() => finish(null), deadlineMs);
        Promise.resolve(request).then(finish, () => finish(null));
      });
      return plan.pending;
    }
    function reset(key) { conversations.delete(key); for (const [k, p] of replies) if (p.key === key) replies.delete(k); }
    return { prepare, settle, reset };
  }
  global.TTSLanguageRouter = { clean, analyze, selectVoice, browserVoiceForGender, create, base, TAGS };
})(window);
