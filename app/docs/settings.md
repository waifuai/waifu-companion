# Settings Panel Guide

The Settings panel uses a category-based menu system with real-time search.

## Opening Settings
Click the gear icon in the top-left corner of the application.

## Menu Structure

### AI & Language Category
- **Language Settings**: UI translation and response language selection (100+ languages)
- **LLM / OpenRouter**: Configure LLM providers (Groq and OpenRouter API keys, model selection, fallback models)
- **Persona System Prompt**: Define character core identity and additional personality instructions
- **Memory Settings**: Conversation memory size, auto-summarization trigger, summary length preference
- **Context Settings**: Time context, battery status, tutorial context, user background context, AI settings control
- **Automation Settings**: Auto-response, ambient mode (trigger delay, custom prompt, preload toggle)

### Models & Visuals Category
- **Model Settings**: Select and manage Live2D models, custom model URL, model gallery access
- **Display Settings**: Panel positions, visibility, clock display, transliteration toggle
- **Background Image**: AI-generated backgrounds, custom URL, background library, fit modes, opacity

### Audio Category
- **Voice Settings**: TTS provider selection (TikTok, Kokoro, Browser), voice selection per provider
- **Audio Settings**: Master volume, TTS volume, radio volume, sound effects toggle, internet radio

### System Category
- **Preferences**: General application preferences (language, theme, auto-save)
- **Debug Settings**: Enable debug panel, AI/TTS/verbose log filters, chat context logging, offline mode toggle, copy debug log

### Additional Sections
- **Links**: External links and resources (GitHub, TikTok, website)
- **Help & Tutorial**: 15-step interactive tutorial, documentation links

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
