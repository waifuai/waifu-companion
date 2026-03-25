# OpenRouter Integration

Waifu Companion supports custom LLM models through OpenRouter, allowing you to use a wide variety of AI models beyond the default WebSim LLM.

## Enabling OpenRouter

1. Open the Settings panel (click the gear icon)
2. Navigate to **LLM / OpenRouter** (second item in AI & Language category)
3. Check "Use OpenRouter instead of built-in WebSim LLM"
4. Enter your API key and model name

## Configuration Options

### API Key
- Input field for your OpenRouter API key (starts with `sk-or-v1-`)
- Stored locally in your browser only
- Sent directly to openrouter.ai over HTTPS

### Model Selection

**Primary Model**: The main LLM model to use (e.g., `stepfun/step-3.5-flash:free`)

**Fallback Models** (up to 2):
- First fallback: Used if primary model fails
- Second fallback: Used if primary and first fallback fail

### Example Models

Some popular free models available on OpenRouter:
- `stepfun/step-3.5-flash:free`
- `openrouter/free`
- `arcee-ai/trinity-large-preview:free`
- `nvidia/nemotron-3-super-120b-a12b:free`

## Streaming Mode

When OpenRouter is enabled and configured, the app can use streaming responses for real-time text feedback. This provides a more natural conversation flow as the AI response appears incrementally.

## Troubleshooting

- **API Key Error**: Ensure your key is valid and has sufficient credits
- **Model Not Found**: Check the model name is correct (case-sensitive)
- **Fallback Not Working**: Ensure fallback models are properly configured in settings