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