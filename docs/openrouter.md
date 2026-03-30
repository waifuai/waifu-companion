# OpenRouter Integration

OpenRouter provides access to a wide variety of LLM models through a single API. It is one of two supported LLM providers (the other being [Groq](providers.md)).

## Enabling OpenRouter

1. Open the Settings panel (click the gear icon)
2. Navigate to **LLM / OpenRouter** in the AI & Language category
3. Enter your API key and model name

OpenRouter is used automatically when:
- Groq is not enabled or not configured
- An OpenRouter API key is set

## Configuration Options

### API Key
- Input field for your OpenRouter API key (starts with `sk-or-v1-`)
- Stored locally in your browser only
- Sent directly to openrouter.ai over HTTPS

### Model Selection

**Primary Model**: The main LLM model to use (default: `stepfun/step-3.5-flash:free`)

**Fallback Models** (up to 2):
- First fallback: Used if primary model fails
- Second fallback: Used if primary and first fallback both fail

### Example Free Models

Popular free models available on OpenRouter:
- `stepfun/step-3.5-flash:free`
- `nvidia/nemotron-3-super-120b-a12b:free`
- `z-ai/glm-4.5-air:free`

## Features

### Streaming Mode
Both streaming and non-streaming completions are supported. Streaming provides real-time character-by-character text feedback for a more natural conversation flow.

### JSON Mode
The API requests structured JSON responses for chat. Some models don't support JSON response format and are automatically handled:
- `stepfun/step-3.5-flash:free`
- `stepfun/step-1-flash`

### Request Headers
OpenRouter requests include standard headers for tracking:
- `HTTP-Referer`: https://waifuai.com
- `X-OpenRouter-Title`: Waifu AI
- `X-Title`: Waifu AI
- `X-OpenRouter-Categories`: character-chat

### Usage Tracking
Response metadata is logged (when debug is enabled):
- Prompt tokens
- Completion tokens
- Total tokens
- Request duration

## API Wrapper

The OpenRouter integration is implemented as a standalone module (`openrouter.js`) with a consistent interface:

```javascript
window.OpenRouterAPI.isConfigured()    // Returns true if API key is set
window.OpenRouterAPI.createCompletion({ messages, json })
window.OpenRouterAPI.createCompletionStream({ messages, json })
```

## Troubleshooting

- **API Key Error**: Ensure your key is valid and has sufficient credits
- **Model Not Found**: Check the model name is correct (case-sensitive)
- **Fallback Not Working**: Ensure fallback models are properly configured in settings
- **JSON Parse Errors**: Some models may return plain text instead of JSON; the app handles this with emotion detection fallback
- **Rate Limits**: Free models have rate limits; try a different model or add credits

See [troubleshooting.md](troubleshooting.md) for general troubleshooting.
