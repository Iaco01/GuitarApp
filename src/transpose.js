// Transposition, key estimate and capo suggestion (pure, runs in Node).
//
// Conventions
// - Chord names are the ones in the song (parsed with chord.js). Only root and bass are moved; the
//   quality text is kept verbatim ("m7b5", "sus4", "add9", ...).
// - Spelling: sharps or flats follow the key of the result (`usesFlats`). F#/Gb major is spelled
//   with sharps (F#), a documented choice: both are equally awkward and F# is the more common name.
// - The written chord names are treated as the sounding chords. The capo only changes which shapes
//   are shown (`view.showShapes`): shape = written chord (+ transpose) lowered by `capo` semitones.

import { parseChord } from './chord.js';

const TR_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TR_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const TR_LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Canonical key names by pitch class.
const TR_MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const TR_MINOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

export function pitchClassOf(note) {
  const m = /^([A-G])([#b]?)$/.exec(note);
  if (!m) return -1;
  return (TR_LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

export function noteNameOf(pc, preferFlats) {
  const i = ((pc % 12) + 12) % 12;
  return (preferFlats ? TR_FLAT : TR_SHARP)[i];
}

// Moves a chord name by `semitones`. Unknown names come back unchanged.
export function transposeChord(name, semitones, { preferFlats = false } = {}) {
  const c = parseChord(name);
  if (!c) return name;
  const root = noteNameOf(pitchClassOf(c.root) + semitones, preferFlats);
  const bass = c.bass ? '/' + noteNameOf(pitchClassOf(c.bass) + semitones, preferFlats) : '';
  return root + c.quality + bass;
}

// "G", "Am", "F#m", "Bb minor" -> { root, minor }, or null.
export function parseKeyName(text) {
  const m = /^\s*([A-G][#b]?)\s*(m|min|minor|maj|major)?\s*$/i.exec(String(text || ''));
  if (!m) return null;
  const root = m[1][0].toUpperCase() + m[1].slice(1);
  const minor = m[2] === 'm' || /^min/i.test(m[2] || '');
  return { root, minor };
}

const TR_MAJOR_DEGREES = [[0, 'maj'], [2, 'min'], [4, 'min'], [5, 'maj'], [7, 'maj'], [9, 'min'], [11, 'dim']];
const TR_MINOR_DEGREES = [[0, 'min'], [2, 'dim'], [3, 'maj'], [5, 'min'], [7, 'min'], [7, 'maj'], [8, 'maj'], [10, 'maj']];

function chordKind(quality) {
  if (/^(dim|°|ø)/.test(quality) || /^m7b5/.test(quality)) return 'dim';
  if (/^(m|min|-)(?!aj)/.test(quality)) return 'min';
  return 'maj';
}

// Estimated key: `song.key` when present, otherwise the best of the 24 keys by diatonic chords
// weighted by beats, with a bonus when the first or last chord is the tonic.
export function estimateKey(song) {
  const given = song.key ? parseKeyName(song.key) : null;
  if (given) return given;
  const chords = [];
  for (const sec of song.sections || []) {
    for (const line of sec.lines) {
      for (const c of line.chords) {
        const p = parseChord(c.name);
        if (p && !c.rest) chords.push({ pc: pitchClassOf(p.root), kind: chordKind(p.quality), beats: c.beats || 1 });
      }
    }
  }
  if (!chords.length) return { root: 'C', minor: false };
  const total = chords.reduce((a, c) => a + c.beats, 0);
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const degrees = minor ? TR_MINOR_DEGREES : TR_MAJOR_DEGREES;
      let score = 0;
      for (const c of chords) {
        if (degrees.some(([d, k]) => (tonic + d) % 12 === c.pc && k === c.kind)) score += c.beats;
      }
      const isTonic = (c) => c.pc === tonic && c.kind === (minor ? 'min' : 'maj');
      if (isTonic(chords[0])) score += total * 0.05;
      if (isTonic(chords[chords.length - 1])) score += total * 0.05;
      if (!minor) score += total * 0.001; // ties go to the major key
      if (!best || score > best.score) best = { score, tonic, minor };
    }
  }
  const table = best.minor ? TR_MINOR_KEYS : TR_MAJOR_KEYS;
  return { root: table[best.tonic], minor: best.minor };
}

export function transposedKey(key, semitones) {
  const pc = (pitchClassOf(key.root) + semitones + 12 * 10) % 12;
  return { root: (key.minor ? TR_MINOR_KEYS : TR_MAJOR_KEYS)[pc], minor: key.minor };
}

// Flat keys: F Bb Eb Ab Db Gb (major), Dm Gm Cm Fm Bbm Ebm (minor); an explicit flat root (Gb) counts too.
export function usesFlats(key) {
  if (key.root.includes('b')) return true;
  if (key.root.includes('#')) return false;
  return key.minor ? ['D', 'G', 'C', 'F'].includes(key.root) : key.root === 'F';
}

// Semitones applied to the written chords for display: transpose, minus the capo in shapes view.
export function displayShift(song) {
  const t = Number.isInteger(song.transpose) ? song.transpose : 0;
  const capo = Number.isInteger(song.capo) ? song.capo : 0;
  return t - (song.view && song.view.showShapes ? capo : 0);
}

const TR_KEY_CACHE = new WeakMap();

// Name shown for a written chord: applies song.transpose and, in shapes view, the capo.
export function displayChordName(song, name) {
  const shift = displayShift(song);
  if (shift === 0) return name;
  let entry = TR_KEY_CACHE.get(song);
  const sig = (song.key || '') + '|' + song.chords.join(',') + '|' + song.sections.length;
  if (!entry || entry.sig !== sig) {
    entry = { sig, key: estimateKey(song) };
    TR_KEY_CACHE.set(song, entry);
  }
  const preferFlats = usesFlats(transposedKey(entry.key, shift));
  return transposeChord(name, shift, { preferFlats });
}

// ---- capo ----

const TR_OPEN_MAJOR = ['C', 'G', 'D', 'A', 'E'];
const TR_COMMON_QUALITIES = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'add9', '6', 'm6', '9', 'm7b5', 'dim', 'dim7', 'aug', '7sus4', 'm9', '5', 'maj9', 'add11', '6/9'];
const TR_EASY_SLASH = ['D/F#', 'G/B', 'C/G', 'C/E', 'Am/G'];
const TR_OK_SLASH = ['A/C#', 'F/C', 'Em/D', 'D/A', 'G/D', 'Am/E', 'C/B', 'Em/B'];

function qualityKey(q) {
  return q.replace(/^min/, 'm').replace(/^-/, 'm').replace(/^M7/, 'maj7').replace(/^maj$/, '').replace(/[()]/g, '');
}

// Difficulty of a chord shape: open basics 1, open sevenths/sus/add9 1.5, open slash 2, F/Fmaj7/Bm 3,
// other barre chords 4, rare or unknown 5. Lower is easier.
export function chordDifficulty(name) {
  const c = parseChord(name);
  if (!c) return 5;
  const root = c.root;
  const q = qualityKey(c.quality);
  if (c.bass) {
    const full = root + q + '/' + c.bass;
    if (TR_EASY_SLASH.includes(full)) return 2;
    if (TR_OK_SLASH.includes(full)) return 3;
    return 5;
  }
  if (q === '') {
    if (TR_OPEN_MAJOR.includes(root)) return 1;
    return root === 'F' ? 3 : 4;
  }
  if (q === 'm') {
    if (['A', 'E', 'D'].includes(root)) return 1;
    return root === 'B' ? 3 : 4;
  }
  if (q === '7') return ['G', 'D', 'A', 'E', 'C', 'B'].includes(root) ? 1.5 : 4;
  if (q === 'm7') return ['A', 'E', 'D'].includes(root) ? 1.5 : 4;
  if (q === 'maj7') {
    if (root === 'F') return 3;
    return ['C', 'D', 'A', 'G', 'E'].includes(root) ? 1.5 : 4;
  }
  if (['sus2', 'sus4', 'add9', 'sus', '7sus4'].includes(q)) return ['A', 'C', 'D', 'E', 'G'].includes(root) ? 1.5 : 4;
  return TR_COMMON_QUALITIES.includes(q) ? 4 : 5;
}

export function difficultyLabel(score) {
  if (score <= 1.6) return 'facile';
  if (score <= 2.6) return 'abbastanza facile';
  if (score <= 3.6) return 'medio';
  return 'difficile';
}

// Best capo positions. For each capo c the shapes are the chords (already moved by song.transpose)
// lowered by c semitones. Score = average difficulty weighted by beats (lower is better); ties go
// to the lower capo. Returns [{ capo, shapes, score }].
export function suggestCapo(song, { maxCapo = 7, top = 3 } = {}) {
  const t = Number.isInteger(song.transpose) ? song.transpose : 0;
  const key = estimateKey(song);
  const weights = new Map(); // written name -> beats
  for (const sec of song.sections || []) {
    for (const line of sec.lines) {
      for (const c of line.chords) {
        if (c.rest) continue;
        weights.set(c.name, (weights.get(c.name) || 0) + (c.beats || 1));
      }
    }
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const out = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    const flats = usesFlats(transposedKey(key, t - capo));
    let score = 0;
    const shapes = [];
    for (const [name, beats] of weights) {
      const shape = transposeChord(name, t - capo, { preferFlats: flats });
      score += chordDifficulty(shape) * beats;
      if (!shapes.includes(shape)) shapes.push(shape);
    }
    out.push({ capo, shapes, score: Math.round((score / total) * 1000) / 1000 });
  }
  out.sort((a, b) => a.score - b.score || a.capo - b.capo);
  return out.slice(0, top);
}
