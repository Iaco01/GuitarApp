// Audio files in IndexedDB (database "gapp-audio", object store "files", key = song id).
// Everything is asynchronous and fails soft: callers get null / false / 0 when IndexedDB is missing.

const AUDIO_DB_NAME = 'gapp-audio';
const AUDIO_DB_STORE = 'files';

let audioDbPromise = null;

function audioDbOpen() {
  if (audioDbPromise) return audioDbPromise;
  audioDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB non disponibile'));
      return;
    }
    const req = indexedDB.open(AUDIO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(AUDIO_DB_STORE)) req.result.createObjectStore(AUDIO_DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Impossibile aprire l’archivio audio'));
    req.onblocked = () => reject(new Error('Archivio audio bloccato'));
  });
  audioDbPromise.catch(() => { audioDbPromise = null; });
  return audioDbPromise;
}

async function audioDbRun(mode, fn) {
  const db = await audioDbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_DB_STORE, mode);
    const store = tx.objectStore(AUDIO_DB_STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Errore dell’archivio audio'));
    tx.onabort = () => reject(tx.error || new Error('Spazio insufficiente per salvare l’audio'));
  });
}

export async function audioStorePut(id, blob) {
  await audioDbRun('readwrite', (s) => s.put(blob, id));
}

export async function audioStoreGet(id) {
  try {
    const v = await audioDbRun('readonly', (s) => s.get(id));
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

export async function audioStoreHas(id) {
  try {
    return (await audioDbRun('readonly', (s) => s.getKey(id))) !== undefined;
  } catch {
    return false;
  }
}

export async function audioStoreDelete(id) {
  try {
    await audioDbRun('readwrite', (s) => s.delete(id));
  } catch { /* nothing to delete */ }
}

// Number of stored files and their total size in bytes.
export async function audioStoreTotals() {
  try {
    const db = await audioDbOpen();
    return await new Promise((resolve) => {
      let count = 0;
      let bytes = 0;
      const tx = db.transaction(AUDIO_DB_STORE, 'readonly');
      const req = tx.objectStore(AUDIO_DB_STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        count++;
        bytes += c.value && c.value.size ? c.value.size : 0;
        c.continue();
      };
      tx.oncomplete = () => resolve({ count, bytes });
      tx.onerror = () => resolve({ count: 0, bytes: 0 });
    });
  } catch {
    return { count: 0, bytes: 0 };
  }
}

// Browser estimate of the space used and available, in bytes, or null.
export async function audioStoreQuota() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }
  } catch { /* not available */ }
  return null;
}
