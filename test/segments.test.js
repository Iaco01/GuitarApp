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

import { buildLineGroups } from '../src/segments.js';

const groupText = (g) => g.map((p) => (p.seg ? p.seg.text : p.text)).join('');
const textOfItems = (items) => items.map((it) => (it.space !== undefined ? it.space : groupText(it.group))).join('');

test('groups: line breaks are only possible at lyric whitespace', () => {
  const lyric = 'ciao mondo bello, la luna scrive';
  const l = line(lyric, [['G', 0], ['D', 6], ['Em', 8], ['Am', 13], ['C', 21], ['A', 40]]);
  const { items } = buildLineGroups(l);
  // the visible text (without labels) is the lyric, trailing spaces aside
  assert.equal(textOfItems(items).trimEnd(), lyric);
  for (const it of items) {
    if (it.space !== undefined) {
      assert.match(it.space, /^\s+$/);
    } else {
      const spaceSegs = it.group.filter((p) => p.seg && /^\s$/.test(p.seg.text));
      if (spaceSegs.length) assert.equal(it.group.length, 1);
      else assert.ok(!/\s/.test(groupText(it.group)), 'group contains whitespace: ' + JSON.stringify(groupText(it.group)));
    }
  }
  // chords inside one word end up in the same group ("mondo" holds D at col 6 and Em at col 8)
  const g = items.find((it) => it.group && groupText(it.group) === 'mondo');
  assert.deepEqual(g.group.filter((p) => p.seg).map((p) => p.seg.name), ['D', 'Em']);
});

test('groups: chord over a space anchors to the existing space, never adds one', () => {
  const { items } = buildLineGroups(line('ab  cd', [['A', 2]]));
  assert.equal(textOfItems(items), 'ab  cd');
  const g = items.find((it) => it.group && it.group[0].seg);
  assert.equal(g.group[0].seg.text, ' ');
});

test('groups: chord past the end is a group of its own; instrumental lines are separated', () => {
  const { items } = buildLineGroups(line('abc', [['C', 10]]));
  assert.equal(items.length, 2);
  assert.equal(items[1].group[0].seg.text, '');
  const ins = buildLineGroups(line('', [['G', 0], ['D', 5], ['A', 9]]));
  assert.ok(ins.instrumental);
  assert.equal(ins.items.filter((i) => i.group).length, 3);
  assert.equal(ins.items.filter((i) => i.space !== undefined).length, 2);
});
