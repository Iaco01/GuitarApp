import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, isChordName } from '../src/chord.js';

const VALID = ['A', 'Am', 'D/F#', 'Cmaj7', 'F#m7b5', 'Bb', 'Gsus4', 'Esus2', 'A7sus4', 'C6/9', 'Em7', 'Dadd9', 'Cdim7', 'Gaug', 'G+', 'Bbm', 'Abmaj7', 'C#dim', 'Am/G', 'E7', 'Dm'];
const INVALID = ['And', 'Bad', 'Em,', 'Go', 'Dad', '', 'H', 'a', 'x2', 'N.C.', 'Add', 'C/', '/G', 'Am7 ', 'Verse'];

test('valid chord names are accepted', () => {
  for (const name of VALID) assert.ok(isChordName(name), name);
});

test('invalid chord names are rejected', () => {
  for (const name of INVALID) assert.ok(!isChordName(name), JSON.stringify(name));
});

test('parseChord splits root, quality and bass', () => {
  assert.deepEqual(parseChord('D/F#'), { root: 'D', quality: '', bass: 'F#' });
  assert.deepEqual(parseChord('F#m7b5'), { root: 'F#', quality: 'm7b5', bass: null });
  assert.deepEqual(parseChord('Bb'), { root: 'Bb', quality: '', bass: null });
  assert.deepEqual(parseChord('C6/9'), { root: 'C', quality: '6/9', bass: null });
  assert.equal(parseChord(null), null);
});
