// Chord shape dictionary and barre generator (pure, runs in Node).
//
// Shape: { frets: [6 x 'x' | 0..n, from the low E string], baseFret, barres?: [{ fret, from, to }],
// fingers?: [...], bass?: 'F#' }. Fret numbers are absolute; `baseFret` is the first fret drawn
// (1 = open position, drawn with a nut). Standard tuning E A D G B E.
// Open shapes are written by hand below; barre shapes come from E-form and A-form models.

import { parseChord } from './chord.js';
import { pitchClassOf } from './transpose.js';

export const DB_OPEN_PCS = [4, 9, 2, 7, 11, 4];

// Quality aliases -> canonical quality.
const DB_ALIASES = {
  '': '', maj: '', M: '', major: '',
  m: 'm', min: 'm', '-': 'm', minor: 'm',
  7: '7', dom7: '7',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', maj: '',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4', '7sus4': '7sus4',
  add9: 'add9', '(add9)': 'add9', '2': 'add9',
  6: '6', m6: 'm6', min6: 'm6',
  9: '9', m9: 'm9',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', min7b5: 'm7b5',
  dim: 'dim', '°': 'dim', dim7: 'dim7', '°7': 'dim7',
  aug: 'aug', '+': 'aug',
  5: '5',
};

export function canonicalQuality(q) {
  const cleaned = String(q).replace(/^\(|\)$/g, '');
  return Object.prototype.hasOwnProperty.call(DB_ALIASES, cleaned) ? DB_ALIASES[cleaned] : null;
}

// First fret drawn: 1 when the shape has open strings (or fits in 5 frets from the nut), otherwise
// the lowest fretted fret.
function baseFretOf(frets) {
  const played = frets.filter((x) => x !== 'x');
  const pos = played.filter((x) => x > 0);
  if (!pos.length || played.includes(0)) return 1;
  const low = Math.min(...pos);
  return Math.max(...pos) <= 5 && low === 1 ? 1 : low;
}

function parseShape(text, extra = {}) {
  const frets = text.split(' ').map((t) => (t === 'x' ? 'x' : Number(t)));
  return { frets, ...extra };
}

// Hand-written open shapes: key "<root><quality>" or "<root><quality>/<bass>" with sharp spelling.
const DB_OPEN = {
  C: ['x 3 2 0 1 0'], D: ['x x 0 2 3 2'], E: ['0 2 2 1 0 0'], G: ['3 2 0 0 0 3', '3 2 0 0 3 3'], A: ['x 0 2 2 2 0'],
  F: ['1 3 3 2 1 1', 'x x 3 2 1 1'], B: ['x 2 4 4 4 2'],
  Cm: ['x 3 5 5 4 3'], Am: ['x 0 2 2 1 0'], Em: ['0 2 2 0 0 0'], Dm: ['x x 0 2 3 1'], Bm: ['x 2 4 4 3 2'],
  C7: ['x 3 2 3 1 0'], D7: ['x x 0 2 1 2'], E7: ['0 2 0 1 0 0', '0 2 2 1 3 0'], G7: ['3 2 0 0 0 1'], A7: ['x 0 2 0 2 0'], B7: ['x 2 1 2 0 2'],
  Am7: ['x 0 2 0 1 0'], Em7: ['0 2 0 0 0 0', '0 2 2 0 3 0'], Dm7: ['x x 0 2 1 1'],
  Cmaj7: ['x 3 2 0 0 0'], Dmaj7: ['x x 0 2 2 2'], Emaj7: ['0 2 1 1 0 0'], Fmaj7: ['x x 3 2 1 0'], Gmaj7: ['3 2 0 0 0 2'], Amaj7: ['x 0 2 1 2 0'],
  Asus2: ['x 0 2 2 0 0'], Dsus2: ['x x 0 2 3 0'], Gsus2: ['3 0 0 0 3 3'],
  Asus4: ['x 0 2 2 3 0'], Dsus4: ['x x 0 2 3 3'], Esus4: ['0 2 2 2 0 0'], Csus4: ['x 3 3 0 1 1'], Gsus4: ['3 3 0 0 1 3'],
  Cadd9: ['x 3 2 0 3 0'], Gadd9: ['3 2 0 2 0 3'], Aadd9: ['x 0 2 4 2 0'], Eadd9: ['0 2 4 1 0 0'], Dadd9: ['x 5 4 2 3 0'], Fadd9: ['x x 3 2 1 3'],
  'D/F#': ['2 0 0 2 3 2'], 'G/B': ['x 2 0 0 0 3'], 'C/G': ['3 3 2 0 1 0'], 'C/E': ['0 3 2 0 1 0'], 'Am/G': ['3 0 2 2 1 0'],
  'A/C#': ['x 4 2 2 2 0'], 'F/C': ['x 3 3 2 1 1'], 'Em/D': ['x x 0 0 0 0'], 'D/A': ['x 0 0 2 3 2'], 'G/D': ['x x 0 0 0 3'],
};
// Barre of each hand shape, by key and shape index.
const DB_BARRES = {
  F: [[{ fret: 1, from: 0, to: 5 }], [{ fret: 1, from: 4, to: 5 }]],
  B: [[{ fret: 2, from: 1, to: 5 }]], Cm: [[{ fret: 3, from: 1, to: 5 }]], Bm: [[{ fret: 2, from: 1, to: 5 }]],
};

// Index of hand shapes by "pc|quality|bassPc".
const DB_INDEX = new Map();
for (const [key, list] of Object.entries(DB_OPEN)) {
  const c = parseChord(key);
  const k = `${pitchClassOf(c.root)}|${canonicalQuality(c.quality)}|${c.bass ? pitchClassOf(c.bass) : ''}`;
  DB_INDEX.set(k, list.map((t, i) => {
    const shape = parseShape(t);
    shape.baseFret = baseFretOf(shape.frets);
    if (DB_BARRES[key] && DB_BARRES[key][i]) shape.barres = DB_BARRES[key][i];
    return shape;
  }));
}

// Barre models: offsets from the barre fret (root on the low E string = "E form", on the A string =
// "A form"), 'x' = muted.
const DB_E_FORM = {
  '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, 2, 1, 1, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0], '7sus4': [0, 2, 0, 2, 0, 0], 6: [0, 2, 2, 1, 2, 0], m6: [0, 2, 2, 0, 2, 0], 9: [0, 2, 0, 1, 0, 2], 5: [0, 2, 2, 'x', 'x', 'x'],
  aug: [0, 3, 2, 1, 1, 0], add9: [0, 2, 4, 1, 0, 0], m9: [0, 2, 0, 0, 0, 2],
};
const DB_A_FORM = {
  '': ['x', 0, 2, 2, 2, 0], m: ['x', 0, 2, 2, 1, 0], 7: ['x', 0, 2, 0, 2, 0], m7: ['x', 0, 2, 0, 1, 0], maj7: ['x', 0, 2, 1, 2, 0],
  sus4: ['x', 0, 2, 2, 3, 0], sus2: ['x', 0, 2, 2, 0, 0], 6: ['x', 0, 2, 2, 2, 2], m6: ['x', 0, 2, 2, 1, 2], 9: ['x', 0, 2, 4, 2, 3], aug: ['x', 0, 3, 2, 2, 1], add9: ['x', 0, 2, 4, 2, 0],
  m7b5: ['x', 0, 1, 0, 1, 'x'], dim7: ['x', 0, 1, -1, 1, 'x'], dim: ['x', 0, 1, 2, 1, 'x'], '7sus4': ['x', 0, 2, 0, 3, 0], 5: ['x', 0, 2, 2, 'x', 'x'],
};

function barreShape(model, rootFret) {
  let f = rootFret;
  const lowest = Math.min(...model.filter((o) => o !== 'x'));
  if (f + lowest < 1 && !(f === 0 && lowest >= 0)) f += 12;
  const frets = model.map((o) => (o === 'x' ? 'x' : f + o));
  const shape = { frets, baseFret: baseFretOf(frets) };
  if (f >= 1) {
    const idx = frets.map((x, i) => (x === f ? i : -1)).filter((i) => i >= 0);
    const from = idx[0];
    const to = idx[idx.length - 1];
    const between = frets.slice(from, to + 1);
    if (idx.length >= 2 && between.every((x) => x !== 'x' && x >= f) && frets.filter((x) => x !== 'x' && x > 0).every((x) => x >= f)) {
      shape.barres = [{ fret: f, from, to }];
    }
  }
  return shape;
}

function generated(pc, quality) {
  const out = [];
  if (DB_E_FORM[quality]) out.push(barreShape(DB_E_FORM[quality], (pc - 4 + 12) % 12));
  if (DB_A_FORM[quality]) out.push(barreShape(DB_A_FORM[quality], (pc - 9 + 12) % 12));
  return out.sort((a, b) => a.baseFret - b.baseFret || Math.max(...a.frets.filter((x) => x !== 'x')) - Math.max(...b.frets.filter((x) => x !== 'x')));
}

const sameFrets = (a, b) => a.frets.join(' ') === b.frets.join(' ');

// All known shapes of a chord, best first (hand-written, then barre forms). Slash chords missing
// from the table use the shapes of the base chord with `bass` set to the written bass note.
// Unknown chords: [].
export function getChordShapes(name) {
  const c = parseChord(name);
  if (!c) return [];
  const q = canonicalQuality(c.quality);
  if (q === null) return [];
  const pc = pitchClassOf(c.root);
  const bassPc = c.bass ? pitchClassOf(c.bass) : null;
  const exact = DB_INDEX.get(`${pc}|${q}|${bassPc === null ? '' : bassPc}`);
  if (exact && (bassPc === null || exact.length)) {
    const list = exact.map((s) => ({ ...s, frets: s.frets.slice() }));
    if (bassPc === null) {
      for (const g of generated(pc, q)) if (!list.some((s) => sameFrets(s, g))) list.push(g);
    }
    return list;
  }
  const baseKey = `${pc}|${q}|`;
  const hand = DB_INDEX.get(baseKey) || [];
  const list = hand.map((s) => ({ ...s, frets: s.frets.slice() }));
  for (const g of generated(pc, q)) if (!list.some((s) => sameFrets(s, g))) list.push(g);
  if (bassPc !== null) for (const s of list) s.bass = c.bass;
  return list;
}

export function getChordShape(name) {
  const all = getChordShapes(name);
  return all.length ? all[0] : null;
}
