# Models & Visuals

Waifu Companion renders Live2D Cubism character models with interactive features, particle effects, and a full gallery system.

## Model Gallery

The model gallery provides a fullscreen overlay for browsing and selecting characters.

### Opening the Gallery
- Click the gallery icon or access from Settings > Model Settings
- Browse the thumbnail grid showing all 50+ built-in models
- Click a thumbnail to load that model

### Built-in Models

50+ models are included.
Each model has a thumbnail image for gallery browsing.

## Custom Model Loading

Load any Live2D Cubism model by providing a URL:

1. Open Settings > Model Settings
2. Enter a URL pointing to a `.model3.json` file
3. The model will load and render on the canvas

### Requirements
- The model must be compatible with Live2D Cubism SDK
- The URL must be publicly accessible (no CORS restrictions)
- The `.model3.json` file must reference valid texture and physics files

## Model Controls

### Positioning
- **Drag**: Click and drag the model to reposition it
- **Zoom**: Use the zoom controls to scale the model up/down
- **Save Position**: Model position is saved in localStorage and persists across sessions
- **Window Resize**: Models automatically adjust on window resize

### Expressions & Motions
The AI's emotional state drives model animations:
- **happy**: Bright expressions, upbeat motions
- **sad**: Melancholy expressions
- **surprised**: Wide-eyed reactions
- **thoughtful**: Contemplative poses
- **excited**: Energetic animations
- **neutral**: Default idle state

Models support standard Cubism expression files (`f00`-`f04`) and motion groups.

## Multi-Model Support

Enable multiple characters on screen simultaneously:
1. Go to Settings > Model Settings
2. Enable multi-model mode
3. Load additional models

Characters can interact and appear together in conversations.

## Particle Effects

Clicking or interacting with models triggers PIXI-based particle effects:
- Particles spawn at the interaction point
- Visual feedback enhances the interactive feel
- Effects are lightweight and GPU-accelerated

## Animation System

### Idle Animations
- **Breathing**: Subtle body movement simulating breathing
- **Blinking**: Periodic eye blinking with configurable timing
- **Head Tracking**: Model eyes/head can follow cursor position

### Animation Loop
The animation controller runs a continuous loop managing:
- Idle breathing and blinking cycles
- Smooth transitions between expressions
- Head and body angle interpolation
- Eye tracking updates

## Lip-Sync

During TTS playback, the model's mouth animates in real-time:
- Audio frequency analysis drives `ParamMouthOpenY` and `ParamMouthForm`
- Vocal frequency range (10-100 Hz band) is analyzed
- Smooth volume interpolation prevents jittery movement
- Works with all TTS providers (TikTok, Kokoro, Browser)
