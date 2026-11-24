// Library helpers (pure, storage injected): search, sorting, JSON export and import.

import { getSong, listSongs, putSong, getSettings, saveSettings } from './storage.js';
import { migrateSong, validateSong } from './model.js';

export const EXPORT_APP = 'guitarapp';
export const EXPORT_VERSION = 1;

// ---- search and sort ----

// Lower case, no accents.
export function foldText(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function filterLibrary(entries, query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return entries.slice();
  return entries.filter((e) => {
    const hay = foldText(`${e.title} ${e.artist}`);
    return words.every((w) => hay.includes(w));
  });
}

const DIFFICULTY_RANK = { beginner: 1, novice: 2, easy: 2, intermediate: 3, advanced: 4, expert: 5 };

export function difficultyRank(text) {
  const key = foldText(text);
  return DIFFICULTY_RANK[key] || 99;
}

export const SORT_MODES = [
  ['opened', 'Ultimo aperto'],
  ['title', 'Titolo'],
  ['artist', 'Artista'],
  ['imported', 'Data di import'],
  ['difficulty', 'Difficoltà'],
];

export function sortLibrary(entries, mode) {
  const cmpText = (a, b) => foldText(a).localeCompare(foldText(b), 'it');
  const dateDesc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
  const out = entries.slice();
  const opened = (e) => e.openedAt || e.updatedAt || e.importedAt || '';
  const by = {
    opened: (a, b) => dateDesc(opened(a), opened(b)),
    title: (a, b) => cmpText(a.title, b.title) || cmpText(a.artist, b.artist),
    artist: (a, b) => cmpText(a.artist, b.artist) || cmpText(a.title, b.title),
    imported: (a, b) => dateDesc(a.importedAt || '', b.importedAt || ''),
    difficulty: (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty) || cmpText(a.title, b.title),
  };
  const cmp = by[mode] || by.opened;
  return out.sort((a, b) => cmp(a, b) || cmpText(a.title, b.title));
}

// ---- export ----

// Audio is not exported (round 4 keeps the files in IndexedDB); only plain metadata stays.
export function stripAudio(song) {
  if (!song.audio || typeof song.audio !== 'object') return song;
  const meta = {};
  for (const [k, v] of Object.entries(song.audio)) {
    if (k === 'anchors' && v && typeof v === 'object' && !Array.isArray(v)) {
      meta.anchors = Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'number' && Number.isFinite(t)));
    } else if (v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)) meta[k] = v;
  }
  return { ...song, audio: meta };
}

export function buildExport(storage, now = new Date()) {
  const songs = [];
  for (const e of listSongs(storage)) {
    const s = getSong(e.id, storage);
    if (s) songs.push(stripAudio(s));
  }
  return { app: EXPORT_APP, exportVersion: EXPORT_VERSION, exportedAt: now.toISOString(), songs, settings: getSettings(storage) };
}

export function exportFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `accordi-a-tempo-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

// ---- import ----

// Reads and validates an export. Returns { error } for a file that cannot be used at all, else
// { songs: [valid Song], invalid: [{ label, errors }], settings }. Nothing is written here.
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'Il file non è un JSON valido: scegli un file esportato da questa app.' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== EXPORT_APP) {
    return { error: 'Il file non è un’esportazione di Accordi a tempo.' };
  }
  if (data.exportVersion !== EXPORT_VERSION) {
    return { error: `Versione di esportazione sconosciuta (${data.exportVersion === undefined ? 'mancante' : data.exportVersion}): aggiorna l’app e riprova.` };
  }
  if (!Array.isArray(data.songs)) return { error: 'Il file non contiene l’elenco dei brani.' };
  const songs = [];
  const invalid = [];
  const seen = new Set();
  data.songs.forEach((raw, i) => {
    const label = raw && typeof raw === 'object' && typeof raw.title === 'string' && raw.title ? `«${raw.title}»` : `brano ${i + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalid.push({ label, errors: ['non è un oggetto'] });
      return;
    }
    let song;
    try {
      song = migrateSong(raw);
    } catch (err) {
      invalid.push({ label, errors: [String(err && err.message ? err.message : err)] });
      return;
    }
    const v = validateSong(song);
    const errors = v.errors.slice();
    if (Array.isArray(song.sections) && song.sections.length === 0) errors.push('nessuna sezione');
    if (seen.has(song.id)) errors.push('id duplicato nel file');
    if (errors.length) {
      invalid.push({ label, errors });
      return;
    }
    seen.add(song.id);
    songs.push(song);
  });
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {};
  return { songs, invalid, settings };
}

// Which songs of the file are new and which are already in the library (same id).
// present: [{ song, existingUpdatedAt, newer }] where newer = the file copy is more recent.
export function planImport(parsed, storage) {
  const idx = new Map(listSongs(storage).map((e) => [e.id, e]));
  const fresh = [];
  const present = [];
  for (const song of parsed.songs) {
    const e = idx.get(song.id);
    if (!e) fresh.push(song);
    else present.push({ song, existingUpdatedAt: e.updatedAt, newer: String(song.updatedAt) > String(e.updatedAt) });
  }
  return { fresh, present, invalid: parsed.invalid };
}

// Writes the plan. mode: 'newer' (replace present songs only if the file copy is newer), 'all'
// (replace all present songs) or 'skip' (keep present songs). Everything was validated before, and
// if a write fails the songs already written are restored: the library is never left half way.
// Returns { added, replaced, skipped }.
export function applyImport(plan, mode, parsedSettings, storage) {
  const writes = plan.fresh.map((song) => ({ song, kind: 'added' }));
  let skipped = 0;
  for (const p of plan.present) {
    if (mode === 'all' || (mode === 'newer' && p.newer)) writes.push({ song: p.song, kind: 'replaced' });
    else skipped++;
  }
  // raw values of every key the import may touch, to restore them if a write fails
  const st = storage || globalThis.localStorage;
  const keys = ['gapp.index.v1', 'gapp.settings.v1', ...writes.map((w) => 'gapp.song.' + w.song.id)];
  const raw = keys.map((k) => [k, st.getItem(k)]);
  try {
    for (const w of writes) putSong(w.song, storage);
    if (parsedSettings && Object.keys(parsedSettings).length) {
      saveSettings({ ...parsedSettings, ...getSettings(storage) }, storage);
    }
  } catch (err) {
    for (const [k, v] of raw) {
      try {
        if (v === null) st.removeItem(k);
        else st.setItem(k, v);
      } catch { /* best effort */ }
    }
    throw err;
  }
  return { added: plan.fresh.length, replaced: writes.length - plan.fresh.length, skipped };
}
