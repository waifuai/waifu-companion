// Model interaction handlers extracted from live2d_manager.js
function setupModelInteractions(model) {
  // Gaze tracking and other mouse-follow interactions remain disabled as per previous request.
}

function setupDragging(model) {
  model.on('mousedown', onDragStart)
       .on('touchstart', onDragStart)
       .on('mouseup', onDragEnd)
       .on('mouseupoutside', onDragEnd)
       .on('touchend', onDragEnd)
       .on('touchendoutside', onDragEnd)
       .on('mousemove', onDragMove)
       .on('touchmove', onDragMove);

  function onDragStart(event) {
    // Store drag data and initial offset
    this.data = event.data;
    this.dragging = true;
    const localPos = this.data.getLocalPosition(this.parent);
    this.dragOffset = {
      x: localPos.x - this.x,
      y: localPos.y - this.y
    };
    
    // Add particle feedback for the grab action
    if (window.createInteractionParticles) {
      window.createInteractionParticles(event.data.global.x, event.data.global.y, 0x007bff, 12);
    }
    
    debugLog(`Dragging started for model: ${this.__modelUrl}`, 'info', true);
  }

  function onDragEnd() {
    if (this.dragging) {
      this.dragging = false;
      this.data = null;
      
      // Persist the new position
      if (typeof window.saveModelPosition === 'function' && this.__modelUrl) {
        window.saveModelPosition(this.__modelUrl, this.x, this.y);
      }
      
      debugLog(`Dragging ended. Model saved at: ${this.x.toFixed(0)}, ${this.y.toFixed(0)}`, 'info', true);
    }
  }

  function onDragMove() {
    if (this.dragging) {
      const newPosition = this.data.getLocalPosition(this.parent);
      this.x = newPosition.x - this.dragOffset.x;
      this.y = newPosition.y - this.dragOffset.y;
    }
  }
}

function setupZooming(model) {
  // Zooming via mouse wheel remains disabled as per previous request.
}

// Export functions
window.setupModelInteractions = setupModelInteractions;
window.setupDragging = setupDragging;
window.setupZooming = setupZooming;