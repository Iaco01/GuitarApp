import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSongFromMht } from '../src/parser.js';
import { parseChord } from '../src/chord.js';
import { getChordShape, getChordShapes } from '../src/chords-db.js';
import { renderDiagramSvg } from '../src/diagram.js';
import { transposeChord } from '../src/transpose.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'american-pie.mht');
const opts = existsSync(FILE) ? {} : { skip: 'file reale assente' };

// Independent music theory used to check the shapes (not shared with the module under test).
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const TUNING = [4, 9, 2, 7, 11, 4]; // E A D G B E
const TONES = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus2: [0, 2, 7], sus4: [0, 5, 7],
  add9: [0, 4, 7, 2], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 2], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
  dim: [0, 3, 6], '7sus4': [0, 5, 7, 10], 5: [0, 7], aug: [0, 4, 8], m9: [0, 3, 7, 10, 2],
};
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function playedPcs(shape) {
  return shape.frets.map((f, i) => (f === 'x' ? null : (TUNING[i] + f) % 12));
}

function checkShape(name, shape, quality) {
  const c = parseChord(name);
  const root = PC[c.root];
  const tones = TONES[quality].map((t) => (root + t) % 12);
  const played = playedPcs(shape);
  assert.equal(shape.frets.length, 6, name);
  shape.frets.forEach((f) => assert.ok(f === 'x' || (Number.isInteger(f) && f >= 0 && f <= 24), `${name} fret ${f}`));
  assert.ok(Number.isInteger(shape.baseFret) && shape.baseFret >= 1, name);
  const fretted = shape.frets.filter((f) => f !== 'x');
  assert.ok(fretted.length >= 2, `${name}: too few strings`);
  for (const f of fretted) assert.ok(f <= shape.baseFret + 4, `${name}: fret ${f} beyond baseFret ${shape.baseFret}`);
  if (shape.baseFret > 1) assert.ok(!fretted.includes(0), `${name}: open string with baseFret > 1`);
  const bad = played.filter((p) => p !== null && !tones.includes(p));
  assert.deepEqual(bad, [], `${name} ${shape.frets.join(' ')}: notes outside the chord`);
  assert.ok(played.includes(root), `${name} ${shape.frets.join(' ')}: root missing`);
  // lowest sounded string is the root, or a chord tone for hand-written slash-less shapes
  const lowest = played.find((p) => p !== null);
  if (!c.bass && quality !== '5') assert.ok(tones.includes(lowest), name);
  for (const b of shape.barres || []) {
    assert.ok(b.fret >= 1 && b.from < b.to && b.to <= 5, `${name} barre`);
    for (let i = b.from; i <= b.to; i++) assert.ok(shape.frets[i] !== 'x' && shape.frets[i] >= b.fret, `${name} barre string ${i}`);
  }
}

test('every shape of every root x quality has valid frets and only chord notes', () => {
  let shapes = 0;
  for (const r of ROOTS) {
    for (const q of Object.keys(TONES)) {
      const name = r + q;
      for (const s of getChordShapes(name)) {
        checkShape(name, s, q);
        shapes++;
      }
    }
  }
  assert.ok(shapes > 300);
});

test('every root has a shape for the required qualities', () => {
  for (const r of ROOTS) {
    for (const q of ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2', 'm7b5', 'dim7', '6', 'm6', '9', 'aug', 'add9']) {
      assert.ok(getChordShape(r + q), r + q);
    }
  }
});

test('hand-written open shapes exist and are sensible', () => {
  const open = { C: 'x32010', G: '320003', D: 'xx0232', A: 'x02220', E: '022100', Am: 'x02210', Em: '022000', Dm: 'xx0231', E7: '020100' };
  for (const [n, f] of Object.entries(open)) {
    assert.equal(getChordShape(n).frets.join(''), f, n);
    assert.equal(getChordShape(n).baseFret, 1);
  }
  for (const n of ['Am7', 'Em7', 'Dm7', 'Cmaj7', 'Dmaj7', 'Gmaj7', 'Amaj7', 'Asus2', 'Dsus4', 'Cadd9', 'Gadd9', 'C7', 'G7', 'D7', 'A7', 'B7']) assert.ok(getChordShape(n), n);
  for (const n of ['D/F#', 'G/B', 'C/G', 'C/E', 'Am/G', 'A/C#', 'F/C', 'Em/D', 'D/A', 'G/D']) {
    const s = getChordShape(n);
    const c = parseChord(n);
    assert.ok(s, n);
    assert.equal(playedPcs(s).find((p) => p !== null), PC[c.bass], `${n}: bass is the lowest note`);
    assert.equal(s.bass, undefined, `${n} is a table entry`);
  }
});

test('aug, add9 and m9 shapes also exist off the open position', () => {
  for (const r of ROOTS) {
    assert.ok(getChordShape(r + 'aug'), r + 'aug');
    assert.ok(getChordShape(r + 'add9'), r + 'add9');
    assert.ok(getChordShape(r + 'm9'), r + 'm9');
  }
  assert.ok(getChordShape('Dadd9') && getChordShape('Fadd9') && getChordShape('F#add9'));
  assert.equal(getChordShape('Faug').barres[0].fret, 1);
});

test('barre choice and enharmonics', () => {
  assert.equal(getChordShape('F').frets.join(''), '133211');
  assert.deepEqual(getChordShape('A#').frets, getChordShape('Bb').frets);
  assert.deepEqual(getChordShape('Db').frets, getChordShape('C#').frets);
  const bb = getChordShape('Bb');
  assert.ok(bb.baseFret <= 6);
  assert.ok(getChordShapes('G').length >= 2, 'alternative shapes');
});

test('slash chords outside the table use the base shape with a bass note', () => {
  const s = getChordShape('A/E');
  assert.equal(s.bass, 'E');
  assert.deepEqual(s.frets, getChordShape('A').frets);
  assert.equal(getChordShape('C#m/G#').bass, 'G#');
});

test('unknown chords give null', () => {
  assert.equal(getChordShape('Zz'), null);
  assert.equal(getChordShape('N.C.'), null);
  assert.equal(getChordShape('C13#11'), null);
  assert.deepEqual(getChordShapes(''), []);
});

test('real file: all 6 chords and every transposition +-12 have a diagram', opts, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  for (let n = -12; n <= 12; n++) {
    for (const flats of [false, true]) {
      for (const name of song.chords) {
        const t = transposeChord(name, n, { preferFlats: flats });
        assert.ok(getChordShape(t), `${name} ${n} -> ${t}`);
      }
    }
  }
});

test('renderDiagramSvg', () => {
  const svg = renderDiagramSvg(getChordShape('G'), { size: 64, label: 'G' });
  assert.match(svg, /^<svg /);
  assert.match(svg, /currentColor/);
  assert.match(svg, /width="64"/);
  assert.ok(!/NaN|undefined/.test(svg));
  // open + muted markers, thick nut at baseFret 1
  assert.match(renderDiagramSvg(getChordShape('D')), /M[\d.]+ [\d.]+l8 8/);
  assert.match(renderDiagramSvg(getChordShape('D')), /stroke-width="5"/);
  const high = getChordShape('F#m');
  const svg2 = renderDiagramSvg({ ...high, frets: [7, 9, 9, 7, 7, 7], baseFret: 7, barres: [{ fret: 7, from: 0, to: 5 }] });
  assert.match(svg2, />7<\/text>/);
  assert.match(svg2, /<rect /);
  assert.ok(!/stroke-width="5"/.test(svg2));
  assert.match(renderDiagramSvg(getChordShape('A'), { theme: 'dark' }), /color:#eceff3/);
  assert.match(renderDiagramSvg(getChordShape('A'), { label: 'A<b>' }), /A&lt;b&gt;/);
});
