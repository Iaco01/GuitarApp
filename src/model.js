// Song model: creation, validation, migration and small helpers (pure).

export const SONG_SCHEMA_VERSION = 1;

function modelUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createSong(partial = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SONG_SCHEMA_VERSION,
    id: modelUuid(),
    title: '',
    artist: '',
    difficulty: null,
    tuning: null,
    capo: 0,
    key: null,
    bpm: null,
    timeSignature: [4, 4],
    strumming: [],
    chords: [],
    sections: [],
    transpose: 0,
    timingSource: 'default',
    view: { fontScale: 1, theme: 'dark', collapseRepeats: true },
    source: { fileName: '', importedAt: now },
    importInfo: { method: 'spans', warnings: [] },
    updatedAt: now,
    audio: null,
    ...partial,
  };
}

export function validateSong(obj) {
  const errors = [];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(obj)) return { ok: false, errors: ['Il brano non è un oggetto'] };
  if (typeof obj.id !== 'string' || !obj.id) errors.push('id mancante');
  if (typeof obj.title !== 'string') errors.push('title deve essere una stringa');
  if (typeof obj.artist !== 'string') errors.push('artist deve essere una stringa');
  if (obj.bpm !== null && !(typeof obj.bpm === 'number' && obj.bpm > 0)) errors.push('bpm non valido');
  if (!Array.isArray(obj.timeSignature) || obj.timeSignature.length !== 2) errors.push('timeSignature non valida');
  if (!Array.isArray(obj.chords)) errors.push('chords deve essere un array');
  if (!Array.isArray(obj.strumming)) errors.push('strumming deve essere un array');
  if (!Array.isArray(obj.sections)) {
    errors.push('sections deve essere un array');
  } else {
    obj.sections.forEach((s, si) => {
      if (!isObj(s) || typeof s.name !== 'string' || !Array.isArray(s.lines)) {
        errors.push(`sezione ${si} non valida`);
        return;
      }
      s.lines.forEach((l, li) => {
        if (!isObj(l) || typeof l.lyric !== 'string' || !Array.isArray(l.chords)) {
          errors.push(`riga ${si}.${li} non valida`);
          return;
        }
        l.chords.forEach((c, ci) => {
          if (!isObj(c) || typeof c.name !== 'string' || !Number.isInteger(c.col) || c.col < 0 || !(c.beats > 0)) {
            errors.push(`accordo ${si}.${li}.${ci} non valido`);
          }
        });
      });
    });
  }
  return { ok: errors.length === 0, errors };
}

// Fills in missing fields so that older or hand-edited objects load safely.
export function migrateSong(obj) {
  const base = createSong({ id: obj && obj.id ? obj.id : undefined });
  const merged = { ...base, ...obj };
  merged.view = { ...base.view, ...(obj && obj.view ? obj.view : {}) };
  merged.source = { ...base.source, ...(obj && obj.source ? obj.source : {}) };
  merged.importInfo = { ...base.importInfo, ...(obj && obj.importInfo ? obj.importInfo : {}) };
  merged.schemaVersion = SONG_SCHEMA_VERSION;
  return merged;
}

export function countChords(song) {
  let n = 0;
  for (const s of song.sections) for (const l of s.lines) n += l.chords.length;
  return n;
}

export function listChordNames(song) {
  const seen = [];
  for (const s of song.sections) {
    for (const l of s.lines) {
      for (const c of l.chords) if (!seen.includes(c.name)) seen.push(c.name);
    }
  }
  return seen;
}

// Chord names in order, used to recognise identical choruses.
export function sectionSignature(section) {
  const names = [];
  for (const l of section.lines) for (const c of l.chords) names.push(c.name);
  return names.join(' ');
}

// Signature that also covers lyrics and chord columns (identical repeated sections).
export function sectionContentKey(section) {
  return baseSectionName(section.name) + '\n' + section.lines
    .map((l) => l.lyric + '\u0001' + l.chords.map((c) => c.name + '@' + c.col + (c.mark || '')).join(','))
    .join('\n');
}

export function baseSectionName(name) {
  return name.replace(/\s*\d+\s*$/, '').trim();
}
