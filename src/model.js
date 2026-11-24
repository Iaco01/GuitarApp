// Song model: creation, validation, migration and small helpers (pure).

export const SONG_SCHEMA_VERSION = 2;
export const DEFAULT_BPM = 80;

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
    view: { fontScale: 1, theme: 'dark', collapseRepeats: true, beatsPerChord: 4 },
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
        if (s.bpm !== undefined && s.bpm !== null && !(typeof s.bpm === 'number' && s.bpm > 0)) errors.push(`bpm della sezione ${si} non valido`);
        l.chords.forEach((c, ci) => {
          if (!isObj(c) || typeof c.name !== 'string' || !Number.isInteger(c.col) || c.col < 0 || !Number.isInteger(c.beats) || c.beats < 1) {
            errors.push(`accordo ${si}.${li}.${ci} non valido`);
          }
        });
      });
    });
  }
  return { ok: errors.length === 0, errors };
}

// Fills in missing fields so that older or hand-edited objects load safely.
// Schema 1 -> 2: sections gain bpm/bpmSource/strumIndex and get the tempo proposed from the
// strumming patterns.
export function migrateSong(obj) {
  const base = createSong({ id: obj && obj.id ? obj.id : undefined });
  const merged = { ...base, ...obj };
  merged.view = { ...base.view, ...(obj && obj.view ? obj.view : {}) };
  merged.source = { ...base.source, ...(obj && obj.source ? obj.source : {}) };
  merged.importInfo = { ...base.importInfo, ...(obj && obj.importInfo ? obj.importInfo : {}) };
  const oldVersion = obj && Number.isInteger(obj.schemaVersion) ? obj.schemaVersion : 1;
  merged.schemaVersion = SONG_SCHEMA_VERSION;
  if (Array.isArray(merged.sections)) {
    merged.sections = merged.sections.map((sec) => ({
      ...sec,
      bpm: sec.bpm === undefined ? null : sec.bpm,
      bpmSource: sec.bpmSource === undefined ? null : sec.bpmSource,
      strumIndex: sec.strumIndex === undefined ? null : sec.strumIndex,
    }));
    if (oldVersion < 2) applySectionTempos(merged);
  }
  return merged;
}

const ONWARDS_RE = /^(.*?)\s+on(?:wards)?$/i;
const norm = (str) => String(str).trim().replace(/\s+/g, ' ').toLowerCase();

// Proposes a tempo and a rhythm pattern for every section from the Ultimate Guitar strumming
// patterns (pure). Returns [{ bpm: number|null, strumIndex: number|null }] (one per section).
// Rules, most specific first: 1) pattern named like the section ("Verse 1"); 2) pattern named
// like its base name ("Chorus"); 3) "<Name> onwards" / "<Name> on": that section and all the
// following ones not already covered by 1 or 2.
export function proposeSectionTempos(song) {
  const pats = song.strumming || [];
  const out = song.sections.map(() => ({ rule: 0, strumIndex: null }));
  const put = (i, rule, idx) => {
    if (out[i].rule === 0 || rule < out[i].rule) out[i] = { rule, strumIndex: idx };
  };
  song.sections.forEach((sec, i) => {
    const full = norm(sec.name);
    const base = norm(baseSectionName(sec.name));
    const r1 = pats.findIndex((p) => norm(p.section) === full);
    if (r1 !== -1) return put(i, 1, r1);
    const r2 = pats.findIndex((p) => norm(p.section) === base);
    if (r2 !== -1) put(i, 2, r2);
  });
  const onsets = [];
  pats.forEach((p, idx) => {
    const m = ONWARDS_RE.exec(String(p.section).trim());
    if (!m) return;
    const start = song.sections.findIndex((sec) => norm(sec.name) === norm(m[1]));
    if (start !== -1) onsets.push({ start, idx });
  });
  onsets.sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.length; i++) {
    if (out[i].rule !== 0) continue;
    let pick = null;
    for (const o of onsets) if (o.start <= i) pick = o;
    if (pick) out[i] = { rule: 3, strumIndex: pick.idx };
  }
  return out.map((o) => {
    const p = o.strumIndex === null ? null : pats[o.strumIndex];
    return { bpm: p && p.bpm > 0 ? p.bpm : null, strumIndex: o.strumIndex };
  });
}

// Writes the proposal into the sections (only where the user has not edited the tempo).
export function applySectionTempos(song) {
  const prop = proposeSectionTempos(song);
  song.sections.forEach((sec, i) => {
    sec.strumIndex = prop[i].strumIndex;
    if (sec.bpmSource === 'edited') return;
    sec.bpm = prop[i].bpm;
    sec.bpmSource = prop[i].bpm === null ? null : 'strumming';
  });
}

// Effective BPM of every section: its own, else the previous section's, else song.bpm, else 80.
export function effectiveSectionBpms(song) {
  const out = [];
  let prev = song.bpm > 0 ? song.bpm : DEFAULT_BPM;
  for (const sec of song.sections) {
    if (sec.bpm > 0) prev = sec.bpm;
    out.push(prev);
  }
  return out;
}

// Sets the beats of every chord (global "beats per chord" setting).
export function setAllChordBeats(song, beats) {
  for (const sec of song.sections) for (const l of sec.lines) for (const c of l.chords) c.beats = beats;
}

// Chord durations of the whole song as a flat array (reading order), and the inverse.
export function readChordBeats(song) {
  const out = [];
  for (const sec of song.sections) for (const l of sec.lines) for (const c of l.chords) out.push(c.beats);
  return out;
}

export function sameChordStructure(a, b) {
  if (a.sections.length !== b.sections.length) return false;
  for (let i = 0; i < a.sections.length; i++) {
    const x = a.sections[i];
    const y = b.sections[i];
    if (x.lines.length !== y.lines.length) return false;
    for (let j = 0; j < x.lines.length; j++) {
      const p = x.lines[j].chords;
      const q = y.lines[j].chords;
      if (p.length !== q.length) return false;
      for (let k = 0; k < p.length; k++) if (p[k].name !== q[k].name) return false;
    }
  }
  return true;
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

// Groups consecutive identical sections ("Chorus (x2)") and flags groups whose content already
// appeared earlier (`repeat: true`). Each group: { key, section, indices, count, repeat }.
export function groupRepeatedSections(sections) {
  const groups = [];
  sections.forEach((section, index) => {
    const key = sectionContentKey(section);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.count++;
      last.indices.push(index);
    } else {
      groups.push({ key, section, indices: [index], count: 1, repeat: false });
    }
  });
  const seen = new Set();
  for (const g of groups) {
    g.repeat = seen.has(g.key);
    seen.add(g.key);
  }
  return groups;
}

// Songs already in the library that come from the same page as `song`: same source URL (when both
// have one), else same title and artist. `stored` = full songs. Newest import first.
export function findDuplicateSongs(song, stored) {
  const norm2 = (v) => String(v || '').trim().toLowerCase();
  const out = stored.filter((s) => {
    if (!s) return false;
    const url = s.source && s.source.url;
    if (song.source && song.source.url && url) return url === song.source.url;
    return norm2(s.title) === norm2(song.title) && norm2(s.artist) === norm2(song.artist);
  });
  const when = (s) => (s.source && s.source.importedAt) || s.updatedAt || '';
  return out.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
}

// Total length in beats and in bars (rounded) of the chord sequence.
export function countBeats(song) {
  let n = 0;
  for (const s of song.sections) for (const l of s.lines) for (const c of l.chords) n += Number.isInteger(c.beats) ? c.beats : 1;
  return n;
}

export function countBars(song) {
  const perBar = Math.max(1, (song.timeSignature && song.timeSignature[0]) || 4);
  return Math.round(countBeats(song) / perBar);
}
