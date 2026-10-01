# Settings Panel Guide

The Settings panel uses a category-based menu system with real-time search.

## Opening Settings
Click the gear icon in the top-left corner of the application.

## Menu Structure

### Companion
- **Character**: Select and manage Live2D models, model gallery, custom model URLs, load multiple models at once
- **Persona**: Define the character's core identity and personality instructions
- **Language**: Response language (100+ languages), transliteration, AI-translated interface

### AI
- **AI Provider**: WaifuAI Cloud (default), OpenRouter, Groq or any OpenAI-compatible API, with fallback models
- **Memory**: Conversation memory size, auto-summarization trigger, summary length, editable summary
- **Ambient & Queue**: User message queue, ambient mode (trigger delay, custom prompt, preload)

### Appearance
- **Background**: Background opacity, custom URL, background library, fit modes
- **Interface**: Clock, chatbox and message bubble opacity, open Settings on page load

### Sound
- **Voice**: TTS providers (TikTok, Kokoro, Browser), voice per provider, volume, voice input (STT)
- **Radio**: Internet radio stream and volume

### Advanced
- **AI Context**: Time, battery and tutorial context, let the AI change settings, JSON emotion format
- **Debug**: Debug panel, AI/TTS/Live2D log filters, chat context logging

### Help & About
- **Help & Tutorial**: Interactive tutorial, documentation links
- **Links**: External links and resources (GitHub, TikTok, website)

Image generation has no submenu: ask the character to draw anything in chat, or use `/image` with an optional portrait / landscape / square flag.

## Search Functionality

Use the search bar at the top of the Settings panel to filter settings by name in real-time. Searches across all categories and submenus.

## Submenus

Each menu item opens a submenu with detailed options. Use the back button to return to the main menu. The current category header is shown at the top for context.

## Persistence

All settings are saved to `localStorage` and persist across browser sessions. Changes take effect immediately without requiring a page reload.

## Draggable Panels

Both the chat panel and debug panel can be:
- Dragged to reposition
- Resized by dragging edges
- Positions are saved in localStorage
