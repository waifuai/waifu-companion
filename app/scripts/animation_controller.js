// Animation state tracking and update logic extracted from live2d_manager.js
let currentAnimationState = {
  eyeX: 0,
  eyeY: 0,
  targetEyeX: 0,
  targetEyeY: 0,
  bodyAngle: 0,
  targetBodyAngle: 0,
  headAngle: 0,
  targetHeadAngle: 0,
  blinkTimer: 0,
  idleTimer: 0,
  breathingTimer: 0,
  isHovering: false,
  hoverIntensity: 0,
  targetHoverIntensity: 0,
  lastInteractionTime: 0,
  interactionCooldown: 1000
};

let eyeMovementFrameId = null;
let lastFrameTime = performance.now();
let isTrackingInitialized = false;

function initializeMouseTracking() {
  // Mouse tracking for gaze is disabled as per user request
  debugLog('Mouse tracking disabled.', 'info');
}

function startAnimationLoop() {
  if (!eyeMovementFrameId) {
    lastFrameTime = performance.now();
    eyeMovementFrameId = requestAnimationFrame(updateEyeMovement);
  }
}

function stopAnimationLoop() {
  if (eyeMovementFrameId) {
    cancelAnimationFrame(eyeMovementFrameId);
    eyeMovementFrameId = null;
  }
}

function updateEyeMovement(now) {
  // Find all active Live2D models on stage
  const models = window.app.stage.children.filter(child => child && child.internalModel);
  
  if (models.length === 0) {
    eyeMovementFrameId = null;
    return;
  }

  const deltaTime = now - lastFrameTime;
  lastFrameTime = now;

  const lerp = (start, end, factor) => start + (end - start) * factor;

  // Update particle system
  if (window.updateParticles) {
    window.updateParticles();
  }

  currentAnimationState.hoverIntensity = lerp(
    currentAnimationState.hoverIntensity, 
    currentAnimationState.targetHoverIntensity, 
    0.1
  );

  const eyeLerpSpeed = 0.08 + currentAnimationState.hoverIntensity * 0.04;
  currentAnimationState.eyeX = lerp(currentAnimationState.eyeX, currentAnimationState.targetEyeX, eyeLerpSpeed);
  currentAnimationState.eyeY = lerp(currentAnimationState.eyeY, currentAnimationState.targetEyeY, eyeLerpSpeed);

  const headLerpSpeed = 0.05 + currentAnimationState.hoverIntensity * 0.03;
  const bodyLerpSpeed = 0.03 + currentAnimationState.hoverIntensity * 0.02;
  currentAnimationState.headAngle = lerp(currentAnimationState.headAngle, currentAnimationState.targetHeadAngle, headLerpSpeed);
  currentAnimationState.bodyAngle = lerp(currentAnimationState.bodyAngle, currentAnimationState.targetBodyAngle, bodyLerpSpeed);

  currentAnimationState.breathingTimer += deltaTime;
  const breathingIntensity = 0.3 + currentAnimationState.hoverIntensity * 0.2;
  const breathingCycle = Math.sin(currentAnimationState.breathingTimer * 0.001) * breathingIntensity;

  currentAnimationState.blinkTimer += deltaTime;
  let eyeOpenness = 1.0;
  
  const blinkInterval = currentAnimationState.isHovering ? 2000 + Math.random() * 3000 : 3000 + Math.random() * 5000;
  if (currentAnimationState.blinkTimer > blinkInterval) {
    eyeOpenness = 0;
    if (currentAnimationState.blinkTimer > blinkInterval + 150) {
      currentAnimationState.blinkTimer = 0;
      eyeOpenness = 1.0;
    }
  }

  currentAnimationState.idleTimer += deltaTime;
  let idleInfluence = 0;
  if (currentAnimationState.idleTimer > 10000 && !currentAnimationState.isHovering) { 
    idleInfluence = Math.sin(currentAnimationState.idleTimer * 0.0005) * 0.5;
    
    if (Math.random() < 0.001) { 
      currentAnimationState.targetHeadAngle = (Math.random() - 0.5) * 10;
      setTimeout(() => { currentAnimationState.targetHeadAngle = 0; }, 2000);
    }
  }

  const hoverEyeInfluence = currentAnimationState.hoverIntensity * 0.3;
  const finalEyeX = currentAnimationState.eyeX + idleInfluence * 0.3 + (Math.sin(currentAnimationState.breathingTimer * 0.002) * hoverEyeInfluence);
  const finalEyeY = currentAnimationState.eyeY + breathingCycle * 0.1 + (Math.cos(currentAnimationState.breathingTimer * 0.002) * hoverEyeInfluence);
  
  const headAngleMultiplier = 1.0 + currentAnimationState.hoverIntensity * 0.5;
  const bodyAngleMultiplier = 1.0 + currentAnimationState.hoverIntensity * 0.3;
  
  const alertnessBonus = currentAnimationState.hoverIntensity * 0.2;
  const browMovement = (-finalEyeY * 0.2 + breathingCycle * 0.1) * (1 + currentAnimationState.hoverIntensity * 0.5);

  // Apply updates to ALL models on stage to fix lag/stuttering in multi-model mode
  models.forEach(model => {
    if (!model.internalModel || !model.internalModel.coreModel) return;
    const core = model.internalModel.coreModel;
    
    core.setParameterValueById("ParamAngleX", (finalEyeX * 25 * headAngleMultiplier) + (currentAnimationState.headAngle * 0.5));
    core.setParameterValueById("ParamAngleY", (-finalEyeY * 25 * headAngleMultiplier) + breathingCycle * 2);
    core.setParameterValueById("ParamEyeBallX", finalEyeX * 0.8);
    core.setParameterValueById("ParamEyeBallY", -finalEyeY * 0.8);
    core.setParameterValueById("ParamBodyAngleX", currentAnimationState.bodyAngle * 0.3 * bodyAngleMultiplier);
    core.setParameterValueById("ParamBodyAngleY", (currentAnimationState.bodyAngle + breathingCycle) * bodyAngleMultiplier);
    core.setParameterValueById("ParamEyeLOpen", eyeOpenness + alertnessBonus);
    core.setParameterValueById("ParamEyeROpen", eyeOpenness + alertnessBonus);
    core.setParameterValueById("ParamBrowLY", browMovement);
    core.setParameterValueById("ParamBrowRY", browMovement);
  });

  if (Math.abs(currentAnimationState.targetEyeX - currentAnimationState.eyeX) > 0.01 || 
      Math.abs(currentAnimationState.targetEyeY - currentAnimationState.eyeY) > 0.01 ||
      currentAnimationState.isHovering) {
    currentAnimationState.idleTimer = 0;
  }

  eyeMovementFrameId = requestAnimationFrame(updateEyeMovement);
}

// Export functions and state
window.currentAnimationState = currentAnimationState;
window.initializeMouseTracking = initializeMouseTracking;
window.startAnimationLoop = startAnimationLoop;
window.stopAnimationLoop = stopAnimationLoop;
window.updateEyeMovement = updateEyeMovement;