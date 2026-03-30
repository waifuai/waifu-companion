# LLM Providers

Waifu Companion supports multiple LLM providers for AI chat, translation, and summarization. Providers are tried in priority order.

## Provider Priority

1. **Groq** - If enabled and configured, Groq is used first
2. **OpenRouter** - If Groq is not configured, OpenRouter is used
3. **Local Fallback Engine** - If neither provider is available or both fail, a built-in heuristic engine provides basic responses

Both Groq and OpenRouter support streaming responses for real-time text feedback.

## Groq

Groq provides ultra-fast inference powered by LPU hardware. Default model: `llama-3.3-70b-versatile`.

### Setup

1. Open Settings (gear icon)
2. Navigate to **LLM / OpenRouter** in the AI & Language category
3. Check **Use Groq**
4. Enter your API key (starts with `gsk_`)
5. Set the model name

### Configuration

| Setting | Description |
|---------|-------------|
| Use Groq | Enable/disable Groq as the active provider |
| API Key | Your Groq API key from [console.groq.com](https://console.groq.com/) |
| Model Name | The model to use (e.g., `llama-3.3-70b-versatile`, `mixtral-8x7b-32768`) |

### Free Tier

Groq offers free API access with rate limits. Check [console.groq.com](https://console.groq.com/) for current limits and available models.

### JSON Mode

Groq supports `response_format: { type: 'json_object' }` for structured responses. This is used automatically for chat responses.

## OpenRouter

OpenRouter provides access to a wide variety of LLM models from different providers through a single API.

### Setup

1. Open Settings (gear icon)
2. Navigate to **LLM / OpenRouter** in the AI & Language category
3. Enter your API key (starts with `sk-or-v1-`)
4. Set the primary model name

### Configuration

| Setting | Description |
|---------|-------------|
| API Key | Your OpenRouter API key from [openrouter.ai](https://openrouter.ai/) |
| Primary Model | Main model (e.g., `stepfun/step-3.5-flash:free`) |
| Fallback Model 1 | Used if primary fails |
| Fallback Model 2 | Used if both primary and fallback 1 fail |

### JSON Mode Compatibility

Some models on OpenRouter don't support JSON response format. These are automatically detected and excluded:
- `stepfun/step-3.5-flash:free`
- `stepfun/step-1-flash`

## Local Fallback Engine

When no LLM provider is configured or all providers fail, a built-in heuristic engine provides pattern-matching responses.

### Behavior
- Matches greetings, emotions, identity questions, farewells, and more
- Provides affectionate persona-driven responses
- Always available, no API key needed
- Responses are marked with `isFallback: true`

### Activation
- Automatic: When API keys are missing or requests fail
- Manual: Enable "Force Offline Mode" in Debug Settings
- Timed: Configure automatic offline mode duration in settings

## How It Works

The AI system constructs a structured prompt containing:
- **Core persona** (system prompt defining character identity)
- **User persona** (additional personality instructions)
- **Conversation summary** (compressed memory from earlier messages)
- **Current settings** (language, voice, memory size, etc.)
- **Context info** (time, battery, tutorial content, user-provided context)
- **Conversation history** (recent messages, configurable depth)

The AI responds with a JSON object containing:
```json
{
    "reply": "The character's response text",
    "emotion": "happy",
    "gesture": "head_tilt"
}
```

Emotions (`happy`, `sad`, `surprised`, `neutral`, `thoughtful`, `excited`) trigger Live2D model expressions and animations.

## Adding a New Provider

Provider modules follow a consistent interface:
```javascript
const NewProviderAPI = {
    isConfigured() { /* returns boolean */ },
    async createCompletion({ messages, json }) {
        /* returns { content: string } */
    },
    async createCompletionStream({ messages, json }) {
        /* returns { stream: ReadableStream, response: Response } */
    }
};
window.NewProviderAPI = NewProviderAPI;
```
