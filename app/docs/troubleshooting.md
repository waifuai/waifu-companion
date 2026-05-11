# Troubleshooting Guide

## Common Issues

### Chat Not Working
1. Check your internet connection
2. Verify API keys are correctly configured in Settings > LLM / OpenRouter
3. Check that at least one provider is enabled (Groq checkbox or OpenRouter key)
4. Try clicking "Go Online" in the chat header
5. Check Debug Panel for error messages

### Groq Provider Issues
- **API Key Error**: Ensure your key starts with `gsk_` and is valid at [console.groq.com](https://console.groq.com/)
- **Model Not Found**: Check the model name is correct (e.g., `llama-3.3-70b-versatile`)
- **Rate Limit**: Free tier has rate limits; wait or switch to OpenRouter
- **No Response**: Verify the "Use Groq" checkbox is checked in LLM settings

### OpenRouter Issues
- **API Key Error**: Ensure your key starts with `sk-or-v1-` and has sufficient credits
- **Model Not Found**: Model names are case-sensitive; check [openrouter.ai/models](https://openrouter.ai/models)
- **JSON Errors**: Some models don't support JSON mode; the app falls back to text parsing with emotion detection

### Live2D Model Not Loading
- Verify the model URL points to a valid `.model3.json` file
- Check browser console for CORS errors
- Ensure the model is compatible with Cubism SDK
- Try loading a built-in model from the gallery first

### Voice Not Working
- Check microphone permissions for STT
- Verify TTS is enabled in Voice Settings (TikTok, Kokoro, or Browser)
- **Kokoro issues**: Requires WebGPU or WASM support. Check browser compatibility. Disabled on low RAM (<4GB) or slow networks
- **TikTok issues**: Depends on external API availability
- Try switching between TTS providers

### Lip-Sync Not Working
- Ensure TTS is enabled and producing audio
- A Live2D model must be loaded with mouth parameters (`ParamMouthOpenY`)
- Check that audio is actually playing (TTS volume not muted)

### Offline Mode Activated
The app automatically switches to offline mode after connection errors. To reset:
1. Click "Go Online" button in chat header
2. Or go to Debug Settings and uncheck "Offline Mode"
3. Disable automatic offline mode in Debug Settings if issues persist

The local fallback engine provides basic affectionate responses when offline.

### Background Not Loading
- Verify the image URL is publicly accessible
- Check for CORS restrictions on the image host
- Try a different image source
- Use the background library for pre-tested images

### Ambient Mode Not Triggering
- Verify ambient mode is enabled in Settings > Automation
- Check the trigger delay setting (default: 10 seconds)
- Ensure an ambient prompt is configured
- Ambient mode only triggers after the AI finishes responding

### Model Gallery Issues
- Thumbnails load from external CDNs; check internet connection
- If a model fails to load, try another or check the browser console for errors
- Some models may have CORS restrictions on their hosting CDN

## Debug Panel

The Debug Panel provides detailed logs for troubleshooting:
- **Live2D logs**: Model loading and rendering issues
- **AI logs**: API calls, responses, and provider selection
- **TTS logs**: Voice synthesis status and queue state
- **Network logs**: HTTP requests, response times, and errors
- **Chat Context**: View the full prompt sent to the AI (enable in Debug Settings)

### Debug Settings
- **Enable Debug Panel**: Show/hide the debug log viewer
- **Show AI Logs**: Filter AI-related debug messages
- **Show TTS Logs**: Filter TTS-related debug messages
- **Show Verbose Logs**: Include detailed/verbose messages
- **Show Chat Context**: Log the full system prompt and conversation sent to AI
- **Copy Debug Log**: Copy all debug history to clipboard
- **Auto-scroll**: Automatically scroll to newest log entries

Access via Settings > Debug Settings.

### Categorized Log Filtering
Logs are automatically categorized:
- AI completions, translations, and summarization
- TTS synthesis, queue, and preloading
- Network requests and responses
- Live2D model operations
- General application events

## Getting Help

If issues persist:
1. Check the Debug Panel for specific error messages (enable verbose logging)
2. Review Settings > Help & Tutorial for the interactive guide
3. Check the [GitHub issues](https://github.com/waifuai/waifu-companion/issues) for known problems
4. Visit [waifuai.com](https://waifuai.com) for the latest version
