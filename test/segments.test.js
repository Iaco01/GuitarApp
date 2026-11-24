import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineSegments } from '../src/segments.js';

const line = (lyric, chords) => ({ lyric, chords: chords.map(([name, col, mark]) => ({ name, col, beats: 4, ...(mark ? { mark } : {}) })) });
const rebuild = (r) => r.lead + r.segs.map((s) => s.word + s.rest).join('');

test('segments split at chord columns and keep the text intact', () => {
  const l = line('la luna scrive numeri', [['G', 0], ['D', 3], ['Em', 15]]);
  const r = buildLineSegments(l);
  assert.equal(rebuild(r), l.lyric);
  assert.deepEqual(r.segs.map((s) => [s.name, s.word, s.rest]),
    [['G', 'la', ' '], ['D', 'luna', ' scrive '], ['Em', 'numeri', '']]);
  assert.equal(r.lead, '');
});

test('text before the first chord is the lead; mid-word chords keep the fragment', () => {
  const r = buildLineSegments(line('ciao mondo', [['Am', 7]]));
  assert.equal(r.lead, 'ciao mo');
  assert.deepEqual(r.segs[0], { index: 0, name: 'Am', mark: '', word: 'ndo', rest: '' });
});

test('chords past the end of the text and chords at the same column', () => {
  const r = buildLineSegments(line('abc', [['C', 10], ['G', 10, '*']]));
  assert.equal(rebuild(r), 'abc');
  assert.deepEqual(r.segs.map((s) => [s.name, s.word, s.mark]), [['C', '', ''], ['G', '', '*']]);
});

test('chord over a space yields an empty word and the spaces in the rest', () => {
  const r = buildLineSegments(line('ab cd', [['A', 2]]));
  assert.deepEqual([r.lead, r.segs[0].word, r.segs[0].rest], ['ab', '', ' cd']);
});

test('instrumental and plain lines; unsorted chords keep their original index', () => {
  assert.equal(buildLineSegments(line('', [['G', 0], ['D', 5]])).instrumental, true);
  assert.deepEqual(buildLineSegments(line('solo testo', [])), { lead: 'solo testo', segs: [], instrumental: false });
  const r = buildLineSegments(line('abcdef', [['B', 3], ['A', 0]]));
  assert.deepEqual(r.segs.map((s) => [s.name, s.index]), [['A', 1], ['B', 0]]);
});
