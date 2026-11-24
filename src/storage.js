// Library storage on top of localStorage (injectable for tests).

const KEY_INDEX = 'gapp.index.v1';
const KEY_SETTINGS = 'gapp.settings.v1';
const KEY_SONG_PREFIX = 'gapp.song.';

export function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function needStorage(storage) {
  const st = storage || defaultStorage();
  if (!st) throw new Error('Il browser non permette di salvare i brani (archiviazione non disponibile)');
  return st;
}

function readJson(st, key, fallback) {
  try {
    const raw = st.getItem(key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(st, key, value) {
  try {
    st.setItem(key, JSON.stringify(value));
  } catch (err) {
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(String(err.message)));
    throw new Error(quota
      ? 'Spazio esaurito: elimina qualche brano dalla libreria e riprova'
      : 'Impossibile salvare i dati nel browser');
  }
}

function indexEntry(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    difficulty: song.difficulty,
    importedAt: song.source ? song.source.importedAt : song.updatedAt,
    updatedAt: song.updatedAt,
  };
}

export function listSongs(storage) {
  const st = storage || defaultStorage();
  if (!st) return [];
  const idx = readJson(st, KEY_INDEX, []);
  return Array.isArray(idx) ? idx : [];
}

export function getSong(id, storage) {
  const st = storage || defaultStorage();
  if (!st) return null;
  return readJson(st, KEY_SONG_PREFIX + id, null);
}

export function saveSong(song, storage) {
  const st = needStorage(storage);
  const saved = { ...song, updatedAt: new Date().toISOString() };
  writeJson(st, KEY_SONG_PREFIX + saved.id, saved);
  const idx = listSongs(st).filter((e) => e.id !== saved.id);
  idx.unshift(indexEntry(saved));
  writeJson(st, KEY_INDEX, idx);
  return saved;
}

export function deleteSong(id, storage) {
  const st = needStorage(storage);
  try {
    st.removeItem(KEY_SONG_PREFIX + id);
  } catch {
    throw new Error('Impossibile eliminare il brano');
  }
  writeJson(st, KEY_INDEX, listSongs(st).filter((e) => e.id !== id));
}

export function getSettings(storage) {
  const st = storage || defaultStorage();
  if (!st) return {};
  const s = readJson(st, KEY_SETTINGS, {});
  return s && typeof s === 'object' ? s : {};
}

export function saveSettings(settings, storage) {
  writeJson(needStorage(storage), KEY_SETTINGS, settings);
}
