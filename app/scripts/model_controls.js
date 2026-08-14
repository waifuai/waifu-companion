// Model control functions extracted from live2d_manager.js
const moveStep = 20; 
const zoomFactorBtn = 0.1; 
const minScale = 0.1; 
const maxScale = 2.0; 

function moveModel(direction) { 
  if (!currentModel) return;
  switch (direction) {
    case 'up':
      currentModel.y -= moveStep;
      break;
    case 'down':
      currentModel.y += moveStep;
      break;
    case 'left':
      currentModel.x -= moveStep;
      break;
    case 'right':
      currentModel.x += moveStep;
      break;
  }
  debugLog(`Model moved ${direction} to (${currentModel.x.toFixed(0)}, ${currentModel.y.toFixed(0)})`, 'info');
  if (window.currentModelUrl) saveModelPosition(window.currentModelUrl, currentModel.x, currentModel.y);
}

function zoomModel(direction) { 
  if (!currentModel) return;
  const scaleDirection = direction === 'in' ? 1 : -1;
  let newScale = currentModel.scale.x * (1 + scaleDirection * zoomFactorBtn);
  newScale = Math.max(minScale, Math.min(maxScale, newScale));
  currentModel.scale.set(newScale);
  debugLog(`Model zoomed ${direction} to scale ${newScale.toFixed(2)}`, 'info');
  if (window.currentModelUrl) saveModelZoom(window.currentModelUrl, newScale);
}

// Bound once. loadModel calls this on every model load, so without the guard
// each switch added another resize handler.
let __resizeBound = false;
function setupWindowResize() {
  if (__resizeBound) return;
  __resizeBound = true;
  window.addEventListener("resize", () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    // Deliberately does NOT re-centre the model: that discarded the position
    // the user had dragged it to (and their saved position) on every resize.
  });
}

function saveModelPosition(url, x, y){
  try {
    const map = JSON.parse(localStorage.getItem('modelPositions')||'{}');
    map[url] = { x, y };
    localStorage.setItem('modelPositions', JSON.stringify(map));
  } catch(e){ debugError('Save model position failed', e, { url: url }); }
}

function loadModelSavedPosition(url){
  try { return (JSON.parse(localStorage.getItem('modelPositions')||'{}'))[url] || null; }
  catch(e){ debugLog(`Load model position: parse error for ${url}: ${e.message}`, 'warn', true); return null; }
}

function resetCurrentModelPosition(){
  if (!currentModel) return;
  currentModel.position.set(window.innerWidth/2, window.innerHeight/2);
  currentModel.scale.set(0.4);
  try {
    const map = JSON.parse(localStorage.getItem('modelPositions')||'{}');
    if (window.currentModelUrl && map[window.currentModelUrl]) { delete map[window.currentModelUrl]; }
    localStorage.setItem('modelPositions', JSON.stringify(map));
    const z = JSON.parse(localStorage.getItem('modelZooms')||'{}');
    if (window.currentModelUrl && z[window.currentModelUrl]) { delete z[window.currentModelUrl]; }
    localStorage.setItem('modelZooms', JSON.stringify(z));
  } catch(e){ debugError('Reset model position persist failed', e); }
}

// Bound once against app.view, and always acts on whichever model is current.
//
// This used to add a fresh wheel listener per loadModel() call and close over
// that specific `model`, so after switching models N times a single scroll
// applied N zoom steps — to N different models, including destroyed ones.
let __zoomBound = false;
function setupZooming() {
  if (__zoomBound) return;
  __zoomBound = true;

  const zoomFactor = 0.1;
  app.view.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (!currentModel) return;
    const direction = event.deltaY < 0 ? 1 : -1;
    const oldScale = currentModel.scale.x;
    let newScale = oldScale * (1 + direction * zoomFactor);
    newScale = Math.max(minScale, Math.min(maxScale, newScale));
    if (newScale !== oldScale && window.playSound) {
      window.playSound('zoom', direction === 1 ? 'C4' : 'G3', '16n');
    }
    currentModel.scale.set(newScale);
    if (window.currentModelUrl) saveModelZoom(window.currentModelUrl, newScale);
  }, { passive: false });
}
window.setupZooming = setupZooming;

function saveModelZoom(url, scale){
  try {
    const map = JSON.parse(localStorage.getItem('modelZooms')||'{}');
    map[url] = { scale };
    localStorage.setItem('modelZooms', JSON.stringify(map));
  } catch(e){ debugError('Save model zoom failed', e, { url: url }); }
}

function loadModelSavedZoom(url){
  try { return (JSON.parse(localStorage.getItem('modelZooms')||'{}'))[url]?.scale || null; }
  catch(e){ debugLog(`Load model zoom: parse error for ${url}: ${e.message}`, 'warn', true); return null; }
}

// Export functions
window.moveModel = moveModel;
window.zoomModel = zoomModel;
window.setupWindowResize = setupWindowResize;
window.saveModelPosition = saveModelPosition;
window.loadModelSavedPosition = loadModelSavedPosition;
window.resetCurrentModelPosition = resetCurrentModelPosition;
window.saveModelZoom = saveModelZoom;
window.loadModelSavedZoom = loadModelSavedZoom;