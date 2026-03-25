# Memory & Context Settings

Waifu Companion provides sophisticated memory management to maintain conversation context while preventing token limit issues.

## Conversation Memory

### Memory Size
- **Range**: 5 to 50 messages
- **Default**: 30 messages
- Controls how many recent messages are included in the AI context

### Summary Trigger
- **Range**: 5 to 50 messages
- **Default**: 30 messages
- Automatically triggers conversation summarization after this many messages

### Summary Length Options
- **Ultra-Concise**: 1 sentence summary
- **Concise**: Short paragraph (default)
- **Detailed**: 1-2 paragraphs
- **Comprehensive**: In-depth summary

### Manual Summarization
You can manually trigger summarization by clicking "Update Summary from Chat" in Memory Settings. The summary is stored in the "Conversation Summary" text area and can be manually edited.

## Context Settings

The following information can be included in AI context:

### Time Context
- Includes current date and time in AI prompts
- Enabled by default

### Battery Status
- Provides device battery level and charging state
- Disabled by default (requires Battery API support)

### Tutorial Context
- Includes application tutorial in AI context
- Allows AI to reference feature documentation

### AI Settings Control
- Allows AI to modify application settings
- **Experimental feature** - use with caution

### JSON Emotion Format
- Forces AI to respond in JSON for emotional reactions
- May cause errors on weaker LLM models
- Disabled by default