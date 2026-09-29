// Helper to split text into sentences. This is a basic approach.
function splitIntoSentences(text) {
    if (!text) return [];
    // Updated regex to include common Japanese sentence terminators: 。 ？！
    // It tries to split by common sentence terminators, keeping the terminator with the sentence.
    const sentences = text.match(/[^.!?…。？！]+[.!?…。？！]?\s*|[^.!?…。？！]+$/g);
    return sentences ? sentences.map(s => s.trim()).filter(s => s.length > 0) : [text.trim()];
}

// Export function to window for global access
window.splitIntoSentences = splitIntoSentences;

// Prepares text for speech: drops whole *multi-word action* spans (they are for the eyes only),
// keeps single-word emphasis words, strips emoji - so TTS never narrates stage directions.
// NOTE: the symbol range stops before U+3000; the previous U+2000-U+329F range swallowed all Hiragana and Katakana.
// Built with a fresh RegExp each call: a shared /g regex carries lastIndex state.
function stripForTTS(text) {
    const emojiRegex = new RegExp(
        '([\\u2700-\\u27BF]|[\\uE000-\\uF8FF]|\\uD83C[\\uDC00-\\uDFFF]|' +
        '\\uD83D[\\uDC00-\\uDFFF]|[\\u2000-\\u2FFF]|\\uD83E[\\uDD00-\\uDFFF])',
        'g'
    );
    return String(text || '')
        .replace(/\*\s*[^*\n]*\s[^*\n]*\s*\*/g, ' ')  // Drop whole *action* spans: a space inside = stage direction, so speech never narrates them
        .replace(/\*\s*\*/g, ' ')             // Empty ** pairs
        .replace(/\*/g, '')                     // Single-word emphasis keeps its word, bare glyphs go
        .replace(emojiRegex, '')
        .replace(/[ \t]{2,}/g, ' ')             // Collapse spaces/tabs left behind by removals
        .replace(/ ?\n ?\n( ?\n)+/g, '\n\n')   // Collapse blank-line runs left behind by removals
        .replace(/\n[ \t]+(?=\S)/g, '\n')      // Tidy leading spaces on continuation lines
        .replace(/[ \t]+\n/g, '\n')            // Tidy trailing spaces before line breaks
        .trim();
}

window.stripForTTS = stripForTTS;
