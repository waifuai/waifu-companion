// Load Live2D model
async function loadModel(modelUrl) {
  debugLog(`Loading Live2D model from: ${modelUrl}`, 'info');
  try {
    // Cancel previous animation loop if running
    if (!window.allowMultipleModels && window.stopAnimationLoop) {
      window.stopAnimationLoop();
    }

    // Remove and destroy the previous model if it exists
    if (!window.allowMultipleModels && currentModel) {
      app.stage.removeChild(currentModel);
      currentModel.destroy({ children: true, texture: true, baseTexture: true });
      currentModel = null;
      currentModelName = "";
      debugLog('Previous model removed and destroyed.', 'info');
    }

    const model = await PIXI.live2d.Live2DModel.from(modelUrl);
    debugLog('New model loaded successfully', 'info');

    currentModel = model;
    // Find the model configuration to get the name
    const modelConfig = availableModels.find(m => m.url === modelUrl);
    if (modelConfig) {
        currentModelName = modelConfig.name;
        debugLog(`Current model name set to: ${currentModelName}`, 'info');
    } else {
        currentModelName = "Character";
        debugLog(`Could not find model name for URL: ${modelUrl}, using fallback "Character"`, 'warn');
    }

    if (typeof trackEvent === 'function') {
        trackEvent('model_changed', { model_name: currentModelName });
    }

    model.__modelUrl = modelUrl;

    // Model Setup
    model.scale.set(0.4);
    model.position.set(window.innerWidth / 2, window.innerHeight / 2);
    model.anchor.set(0.5, 0.25);

    model.interactive = true;
    model.buttonMode = true;

    // Restore saved position if available
    window.currentModelUrl = modelUrl;
    try {
      const saved = (typeof loadModelSavedPosition==='function') ? loadModelSavedPosition(modelUrl) : null;
      if (saved && typeof saved.x==='number' && typeof saved.y==='number') {
        model.position.set(saved.x, saved.y);
        debugLog(`Restored model position to (${saved.x.toFixed(0)}, ${saved.y.toFixed(0)})`, 'info');
      }
    } catch(e){ debugLog('Failed to restore model position: '+e,'warn'); }

    // Restore saved zoom if available
    window.currentModelUrl = modelUrl;
    try {
      const savedScale = (typeof loadModelSavedZoom==='function') ? loadModelSavedZoom(modelUrl) : null;
      if (savedScale && typeof savedScale === 'number') {
        model.scale.set(savedScale);
        debugLog(`Restored model zoom to scale ${savedScale.toFixed(2)}`, 'info');
      }
    } catch(e){ debugLog('Failed to restore model zoom: '+e,'warn'); }

    app.stage.addChild(model);

    // Create particle system
    if (window.createParticleSystem) {
      window.createParticleSystem();
    }

    // Setup all interactions using extracted handlers
    if (window.setupModelInteractions) {
      window.setupModelInteractions(model);
    }
    if (window.setupDragging) {
      window.setupDragging(model);
    }
    if (window.setupZooming) {
      window.setupZooming(model);
    }

    // start animation loop if not already running
    if (window.startAnimationLoop) {
      window.startAnimationLoop();
      window.__animLoopStarted = true;
    }

    if (window.setupWindowResize) {
      window.setupWindowResize();
    }

  } catch (err) {
    debugLog(`Failed to load model from ${modelUrl}: ${err}`, 'error');
    currentModelName = ""; 
    throw err;
  }
}

// Remove all Live2D models from the stage
function clearAllModels() {
  try {
    const models = app.stage.children.filter(c => c && c.__modelUrl);
    models.forEach(m => { app.stage.removeChild(m); try { m.destroy({ children:true, texture:true, baseTexture:true }); } catch(_) {} });
    if (typeof destroyParticleSystem === 'function') destroyParticleSystem();
    if (typeof stopAnimationLoop === 'function') stopAnimationLoop();
    window.__animLoopStarted = false;
    currentModel = null; currentModelName = ""; currentModelUrl = null;
    debugLog(`Cleared ${models.length} model(s) from stage.`, 'info');
  } catch (e) {
    debugLog('ClearAllModels error: ' + e, 'error');
  }
}
window.clearAllModels = clearAllModels;