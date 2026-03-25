# Troubleshooting Guide

## Common Issues

### Chat Not Working
1. Check your internet connection
2. Verify API keys are correctly configured in Settings > LLM / OpenRouter
3. Try clicking "Go Online" in the chat header
4. Check Debug Panel for error messages

### Live2D Model Not Loading
- Verify the model URL points to a valid `.model3.json` file
- Check browser console for CORS errors
- Ensure the model is compatible with Cubism SDK

### Voice Not Working
- Check microphone permissions for STT
- Verify TTS is enabled in Voice Settings
- Try switching between Kokoro and WebSim TTS

### Offline Mode Activated
The app automatically switches to offline mode after connection errors. To reset:
1. Click "Go Online" button in chat header
2. Or go to Debug Settings and uncheck "Offline Mode"
3. Disable automatic offline mode in Debug Settings if issues persist

### Background Not Loading
- Verify the image URL is publicly accessible
- Check for CORS restrictions on the image host
- Try a different image source

## Debug Panel

The Debug Panel provides detailed logs for troubleshooting:
- **Live2D logs**: Model loading and rendering issues
- **AI logs**: API calls and responses
- **TTS logs**: Voice synthesis status
- **Network logs**: Connection status

Access via Settings > Debug Settings > Enable Debug Panel

## Getting Help

If issues persist:
1. Check the Debug Panel for specific error messages
2. Review Settings > Help & Tutorial
3. Visit the links section for official resources