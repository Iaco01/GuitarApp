// Library storage on top of localStorage (injectable for tests).

import { countBars } from './model.js';

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

function indexEntry(song, openedAt) {
  const entry = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    difficulty: song.difficulty,
    importedAt: song.source ? song.source.importedAt : song.updatedAt,
    updatedAt: song.updatedAt,
    timingSource: song.timingSource || 'default',
    bars: Array.isArray(song.sections) ? countBars(song) : 0,
  };
  if (song.kind === 'tab') entry.kind = 'tab';
  if (song.audio) entry.hasAudio = true;
  if (openedAt) entry.openedAt = openedAt;
  return entry;
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
  return putSong(saved, st);
}

// Writes the song exactly as given (updatedAt kept: used by the JSON import) and updates the index.
export function putSong(song, storage) {
  const st = needStorage(storage);
  writeJson(st, KEY_SONG_PREFIX + song.id, song);
  const all = listSongs(st);
  const old = all.find((e) => e.id === song.id);
  const idx = all.filter((e) => e.id !== song.id);
  idx.unshift(indexEntry(song, old && old.openedAt));
  writeJson(st, KEY_INDEX, idx);
  return song;
}

// Remembers when a song was last opened (index only: the song itself is not rewritten).
export function markOpened(id, storage) {
  const st = storage || defaultStorage();
  if (!st) return;
  try {
    const idx = listSongs(st);
    const e = idx.find((x) => x.id === id);
    if (!e) return;
    e.openedAt = new Date().toISOString();
    writeJson(st, KEY_INDEX, idx);
  } catch { /* the library still works without it */ }
}

// Index entries, completing the fields added after round 2 (bars, timingSource) from the songs.
export function listLibrary(storage) {
  const st = storage || defaultStorage();
  const idx = listSongs(st);
  let dirty = false;
  const out = idx.map((e) => {
    if (e.bars !== undefined && e.timingSource !== undefined) return e;
    const song = getSong(e.id, st);
    if (!song) return e;
    dirty = true;
    return { ...indexEntry(song, e.openedAt), ...e, bars: countBars(song), timingSource: song.timingSource || 'default' };
  });
  if (dirty) {
    try { writeJson(st, KEY_INDEX, out); } catch { /* ignore */ }
  }
  return out;
}

// Estimated space used by the library in localStorage, in bytes (two bytes per character).
export function storageUsedBytes(storage) {
  const st = storage || defaultStorage();
  if (!st) return 0;
  let chars = 0;
  const len = (key) => {
    try {
      const v = st.getItem(key);
      return v ? v.length : 0;
    } catch {
      return 0;
    }
  };
  chars += len(KEY_INDEX) + len(KEY_SETTINGS);
  for (const e of listSongs(st)) chars += len(KEY_SONG_PREFIX + e.id);
  return chars * 2;
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

// ---- device settings (not tied to a song): output latency, round 4 ----

const KEY_DEVICE = 'gapp.device.v1';

// { latencyMs?: number } (missing = never calibrated)
export function getDevice(storage) {
  const st = storage || defaultStorage();
  if (!st) return {};
  const d = readJson(st, KEY_DEVICE, {});
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

export function saveDevice(device, storage) {
  writeJson(needStorage(storage), KEY_DEVICE, device);
}

// ---- diagnostics (round 12): what the audio player measured in the last session, for "Informazioni tecniche" ----

const KEY_DIAG = 'gapp.diag.v1';

export function getDiag(storage) {
  const st = storage || defaultStorage();
  if (!st) return null;
  const d = readJson(st, KEY_DIAG, null);
  return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
}

export function saveDiag(diag, storage) {
  writeJson(needStorage(storage), KEY_DIAG, diag);
}
