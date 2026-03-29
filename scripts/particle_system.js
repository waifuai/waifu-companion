// Particle system for interaction effects extracted from live2d_manager.js
let particleContainer = null;
let particles = [];

function createParticleSystem() {
  if (particleContainer) {
    app.stage.removeChild(particleContainer);
    particleContainer.destroy();
  }
  
  particleContainer = new PIXI.Container();
  app.stage.addChild(particleContainer);
  particles = [];
}

function createInteractionParticles(x, y, color = 0xFFFFFF, count = 8) {
  for (let i = 0; i < count; i++) {
    const particle = new PIXI.Graphics();
    particle.beginFill(color);
    particle.drawCircle(0, 0, Math.random() * 3 + 2);
    particle.endFill();
    
    particle.x = x;
    particle.y = y;
    particle.vx = (Math.random() - 0.5) * 8;
    particle.vy = (Math.random() - 0.5) * 8 - 2;
    particle.life = 1.0;
    particle.decay = 0.02 + Math.random() * 0.02;
    
    particleContainer.addChild(particle);
    particles.push(particle);
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.2; // gravity
    particle.life -= particle.decay;
    particle.alpha = particle.life;
    particle.scale.set(particle.life);
    
    if (particle.life <= 0) {
      particleContainer.removeChild(particle);
      particle.destroy();
      particles.splice(i, 1);
    }
  }
}

function destroyParticleSystem() {
  if (particleContainer) {
    particles.forEach(particle => particle.destroy());
    particles = [];
    app.stage.removeChild(particleContainer);
    particleContainer.destroy();
    particleContainer = null;
  }
}

// Export functions
window.createParticleSystem = createParticleSystem;
window.createInteractionParticles = createInteractionParticles;
window.updateParticles = updateParticles;
window.destroyParticleSystem = destroyParticleSystem;