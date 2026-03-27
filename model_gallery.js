(function(){
  const grid = ()=>document.getElementById('modelGalleryGrid');
  const overlay = ()=>document.getElementById('modelGalleryOverlay');

  function renderGrid(){
    const list = (window.availableModels || []).filter(m => m.image && String(m.image).trim()).slice();
    const html = list.map(m=>{
      const img = m.image || 'https://via.placeholder.com/400x400?text=Live2D';
      const name = m.name || 'Model';
      return `<div class="model-card" data-url="${m.url}">
                <img class="model-thumb" src="${img}" alt="${name}">
                <div class="model-name">${name}</div>
              </div>`;
    }).join('');
    const el = grid(); if (el) el.innerHTML = html;

    el?.querySelectorAll('.model-card').forEach(card=>{
      card.addEventListener('click', async ()=>{
        const url = card.dataset.url;
        try {
          await loadModel(url);
          try{ localStorage.setItem('selectedModelUrl', url); }catch(e){ debugLog(`Gallery: persist selectedModelUrl failed: ${e.message}`, 'warn', true); }
          if (typeof populateModelSelector==='function') populateModelSelector();
        } catch(e){
          debugError('Model gallery load failed', e, { url: url });
        } finally {
          closeModelGallery();
        }
      });
    });
  }

  function openModelGallery(){
    renderGrid();
    overlay()?.classList.add('visible');
    overlay()?.setAttribute('aria-hidden','false');
  }

  function closeModelGallery(){
    overlay()?.classList.remove('visible');
    overlay()?.setAttribute('aria-hidden','true');
  }

  document.addEventListener('keydown',(e)=>{
    if (e.key==='Escape' && overlay()?.classList.contains('visible')) closeModelGallery();
  });
  overlay()?.addEventListener('click',(e)=>{
    if (e.target === overlay()) closeModelGallery();
  });

  window.openModelGallery = openModelGallery;
  window.closeModelGallery = closeModelGallery;
})();