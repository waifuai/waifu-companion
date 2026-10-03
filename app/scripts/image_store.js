// Keeps generated images that arrive without a URL on this device, in
// IndexedDB. Chats and the background library save them as "idb:<id>" in
// place of a URL; resolve()/apply() turn that into a blob: URL that <img> and
// CSS can use. Ordinary URLs pass through unchanged.

const ImageStore = (() => {
  const DB_NAME = 'waifuImages';
  const STORE = 'images';
  const PREFIX = 'idb:';
  let dbPromise = null;
  const objectUrls = new Map();

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  function isLocal(url) {
    return typeof url === 'string' && url.startsWith(PREFIX);
  }

  // Saves blob under id and resolves with the "idb:<id>" value to persist.
  async function put(id, blob) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    objectUrls.set(id, URL.createObjectURL(blob));
    return PREFIX + id;
  }

  // Resolves a displayable URL, or null when the image is gone from this
  // device (site data cleared, or saved in another browser).
  async function resolve(url) {
    if (!isLocal(url)) return url;
    const id = url.slice(PREFIX.length);
    if (objectUrls.has(id)) return objectUrls.get(id);
    const db = await openDb();
    const blob = await new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
    if (!blob) return null;
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.set(id, objectUrl);
    return objectUrl;
  }

  // Calls set(displayUrl) right away for ordinary URLs, or once a local image
  // has been read. Missing local images are left unset.
  function apply(url, set) {
    if (!isLocal(url)) { set(url); return; }
    resolve(url).then(u => { if (u) set(u); }).catch(e => {
      if (typeof debugError === 'function') debugError('ImageStore: could not load ' + url, e);
    });
  }

  return { put, resolve, apply, isLocal };
})();

window.ImageStore = ImageStore;
