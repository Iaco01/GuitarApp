import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSongFromMht } from '../src/parser.js';
import { createSong } from '../src/model.js';
import { transposeChord, estimateKey, transposedKey, usesFlats, displayChordName, chordDifficulty, suggestCapo, parseKeyName, difficultyLabel } from '../src/transpose.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'american-pie.mht');
const opts = existsSync(FILE) ? {} : { skip: 'file reale assente' };

const mkSong = (names, extra = {}) => createSong({
  chords: [...new Set(names)],
  sections: [{ name: 'A', bpm: null, bpmSource: null, strumIndex: null, lines: [{ lyric: '', chords: names.map((name, i) => ({ name, col: i, beats: 4 })) }] }],
  ...extra,
});

test('transposeChord moves root and bass and keeps the quality', () => {
  assert.equal(transposeChord('D/F#', 2), 'E/G#');
  assert.equal(transposeChord('Am7', 3), 'Cm7');
  assert.equal(transposeChord('F#m7b5', 1), 'Gm7b5');
  assert.equal(transposeChord('Bb', 2, { preferFlats: true }), 'C');
  assert.equal(transposeChord('A', 1, { preferFlats: true }), 'Bb');
  assert.equal(transposeChord('A', 1), 'A#');
  assert.equal(transposeChord('Gsus4', -12), 'Gsus4');
  assert.equal(transposeChord('C6/9', 5), 'F6/9');
  assert.equal(transposeChord('N.C.', 3), 'N.C.');
});

const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const QUALS = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'add9', '6', 'm6', '9', 'm7b5', 'dim', 'dim7', 'aug', '7sus4', 'm9', '5', '6/9'];
const ALL = [];
for (const r of ROOTS) for (const q of QUALS) { ALL.push(r + q); for (const b of ['E', 'G#', 'Bb', 'F#']) ALL.push(r + q + '/' + b); }

test('round trip and octave over a large list of chords', () => {
  assert.ok(ALL.length > 1500);
  for (const preferFlats of [false, true]) {
    for (const x of ALL) {
      const base = transposeChord(x, 0, { preferFlats });
      for (let n = -12; n <= 12; n++) {
        const there = transposeChord(x, n, { preferFlats });
        assert.equal(transposeChord(there, -n, { preferFlats }), base, `${x} ${n}`);
      }
      assert.equal(transposeChord(x, 12, { preferFlats }), base);
      assert.equal(transposeChord(x, -12, { preferFlats }), base);
    }
  }
});

test('usesFlats and transposedKey', () => {
  for (const k of ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']) assert.equal(usesFlats({ root: k, minor: false }), true, k);
  for (const k of ['C', 'G', 'D', 'A', 'E', 'B', 'F#']) assert.equal(usesFlats({ root: k, minor: false }), false, k);
  for (const k of ['D', 'G', 'C', 'F', 'Bb', 'Eb']) assert.equal(usesFlats({ root: k, minor: true }), true, k);
  for (const k of ['A', 'E', 'B', 'F#', 'C#', 'G#']) assert.equal(usesFlats({ root: k, minor: true }), false, k);
  assert.deepEqual(transposedKey({ root: 'G', minor: false }, 3), { root: 'Bb', minor: false });
  assert.deepEqual(transposedKey({ root: 'C', minor: false }, 6), { root: 'F#', minor: false }); // sharps for F#/Gb
  assert.deepEqual(transposedKey({ root: 'A', minor: true }, -12), { root: 'A', minor: true });
});

test('spelling follows the key: Bb and not A# in F major', () => {
  const s = mkSong(['C', 'F', 'G', 'C'], { transpose: 5 }); // C major -> F major
  assert.equal(displayChordName(s, 'C'), 'F');
  assert.equal(displayChordName(s, 'F'), 'Bb');
  assert.equal(displayChordName(s, 'G'), 'C');
  const s2 = mkSong(['C', 'F', 'G', 'C'], { transpose: 2 }); // D major: sharps
  assert.equal(displayChordName(s2, 'F'), 'G');
  const s3 = mkSong(['C', 'F', 'G', 'C'], { transpose: 6 }); // F# major
  assert.equal(displayChordName(s3, 'C'), 'F#');
  assert.equal(displayChordName(s3, 'F'), 'B');
});

test('estimateKey uses song.key, else a diatonic heuristic', () => {
  assert.deepEqual(estimateKey(mkSong(['C'], { key: 'Am' })), { root: 'A', minor: true });
  assert.deepEqual(estimateKey(mkSong(['G', 'C', 'D', 'G'])), { root: 'G', minor: false });
  assert.deepEqual(estimateKey(mkSong(['Am', 'F', 'C', 'G', 'Am'])), { root: 'A', minor: true });
  assert.deepEqual(estimateKey(mkSong(['Bb', 'Eb', 'F', 'Bb'])), { root: 'Bb', minor: false });
  assert.deepEqual(estimateKey(mkSong([])), { root: 'C', minor: false });
  assert.deepEqual(parseKeyName('F# minor'), { root: 'F#', minor: true });
  assert.deepEqual(parseKeyName('Bb'), { root: 'Bb', minor: false });
  assert.equal(parseKeyName('boh'), null);
});

test('real file: key is G major and +-1..12 returns to the original', opts, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  assert.deepEqual(estimateKey(song), { root: 'G', minor: false });
  const names = song.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.name)));
  for (let n = 1; n <= 12; n++) {
    for (const sign of [1, -1]) {
      song.transpose = sign * n;
      const shown = names.map((x) => displayChordName(song, x));
      song.transpose = 0;
      const back = shown.map((x) => transposeChord(x, -sign * n, { preferFlats: false }));
      assert.deepEqual(back, names, `shift ${sign * n}`);
    }
  }
  song.transpose = 12;
  assert.deepEqual(names.map((x) => displayChordName(song, x)), names);
  song.transpose = 3; // G major -> Bb major: flats
  assert.equal(displayChordName(song, 'Em'), 'Gm');
  assert.equal(displayChordName(song, 'G'), 'Bb');
});

test('chordDifficulty table', () => {
  for (const n of ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm']) assert.equal(chordDifficulty(n), 1, n);
  for (const n of ['G7', 'D7', 'A7', 'E7', 'C7', 'B7', 'Am7', 'Em7', 'Dm7', 'Dsus4', 'Asus2', 'Cadd9']) assert.equal(chordDifficulty(n), 1.5, n);
  for (const n of ['F', 'Fmaj7', 'Bm']) assert.equal(chordDifficulty(n), 3, n);
  for (const n of ['Bb', 'F#m', 'C#m', 'Bbm7', 'B', 'Gm']) assert.equal(chordDifficulty(n), 4, n);
  for (const n of ['D/F#', 'G/B', 'C/G', 'C/E', 'Am/G']) assert.equal(chordDifficulty(n), 2, n);
  for (const n of ['Cmaj13#11', 'xyz', 'F#/A#']) assert.equal(chordDifficulty(n), 5, n);
  assert.equal(difficultyLabel(1), 'facile');
  assert.equal(difficultyLabel(4), 'difficile');
});

test('suggestCapo on a synthetic song: Bb Eb F in F major', () => {
  const s = mkSong(['Bb', 'Eb', 'F', 'Bb']);
  const best = suggestCapo(s)[0];
  assert.equal(best.capo, 1); // shapes A D E; ties go to the lower capo
  assert.deepEqual(best.shapes, ['A', 'D', 'E']);
  assert.deepEqual(suggestCapo(s).map((x) => x.capo), [1, 3, 6]); // capo 3: G C D, capo 6: E A B
  assert.equal(suggestCapo(s, { top: 5 }).length, 5);
  const none = suggestCapo(mkSong([]));
  assert.equal(none.length, 3);
});

test('real file: capo suggestion with transpose 0 and +2', opts, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  const r0 = suggestCapo(song);
  assert.equal(r0.length, 3);
  assert.equal(r0[0].capo, 0);
  assert.deepEqual(r0[0].shapes, ['G', 'D', 'Em', 'Am', 'C', 'A']);
  song.transpose = 2;
  const r2 = suggestCapo(song);
  assert.equal(r2[0].capo, 2);
  assert.deepEqual(r2[0].shapes, ['G', 'D', 'Em', 'Am', 'C', 'A']);
  assert.ok(r2[0].score <= r2[1].score && r2[1].score <= r2[2].score);
});

test('shapes view lowers chords by the capo', () => {
  const s = mkSong(['A', 'B', 'F#m', 'D'], { transpose: 0, capo: 2, view: { ...createSong().view, showShapes: true } });
  assert.deepEqual(['A', 'B', 'F#m', 'D'].map((n) => displayChordName(s, n)), ['G', 'A', 'Em', 'C']);
  s.view.showShapes = false;
  assert.equal(displayChordName(s, 'A'), 'A');
});
