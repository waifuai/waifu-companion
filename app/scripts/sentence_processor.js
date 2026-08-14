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

// Strips markdown emphasis and emoji so TTS engines don't read them aloud.
// Built with a fresh RegExp each call: a shared /g regex carries lastIndex state.
function stripForTTS(text) {
    const emojiRegex = new RegExp(
        '([\\u2700-\\u27BF]|[\\uE000-\\uF8FF]|\\uD83C[\\uDC00-\\uDFFF]|' +
        '\\uD83D[\\uDC00-\\uDFFF]|[\\u2000-\\u329F]|\\uD83E[\\uDD00-\\uDFFF])',
        'g'
    );
    return String(text || '').replace(/\*/g, '').replace(emojiRegex, '').trim();
}

window.stripForTTS = stripForTTS;