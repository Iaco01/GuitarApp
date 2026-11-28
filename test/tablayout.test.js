import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTabMeasures, tabCursorPlace, tabRowLabels } from '../src/tablayout.js';

const meas = (len, chords = []) => ({ len, rows: Array.from({ length: 6 }, (_, r) => String(r).repeat(len)), chords });

test('measures are packed on a line while they fit, a bar after each', () => {
  const lines = layoutTabMeasures([meas(8), meas(8), meas(8)], 25);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].segs.map((s) => [s.m, s.from, s.to, s.x0]), [[0, 0, 8, 2], [1, 0, 8, 11]]);
  assert.equal(lines[0].rows[0], 'e|00000000|00000000|');
  assert.equal(lines[1].rows[5], 'E|55555555|');
  for (const l of lines) for (const r of l.rows) assert.ok(r.length <= 25);
});

test('a measure longer than the line is cut, the labels are repeated and no line is wider than the width', () => {
  const lines = layoutTabMeasures([meas(40)], 24);
  assert.ok(lines.length >= 2);
  assert.deepEqual(lines.map((l) => l.segs[0].last), [false, true]);
  for (const l of lines) { assert.ok(l.rows.every((r) => r.length <= 24)); assert.ok(l.rows[0].startsWith('e|')); }
  assert.equal(lines.map((l) => l.segs[0].to - l.segs[0].from).reduce((a, b) => a + b, 0), 40);
});

test('no line is ever wider than the width, whatever the measures', () => {
  for (const w of [12, 17, 23, 31, 44]) {
    const lens = [5, 19, 33, 54, 79, 8, 3];
    const lines = layoutTabMeasures(lens.map((l) => meas(l)), w);
    for (const l of lines) for (const r of l.rows) assert.ok(r.length <= Math.max(w, 10), `${w}: ${r.length}`);
    const total = lines.reduce((s, l) => s + l.segs.reduce((a, g) => a + g.to - g.from, 0), 0);
    assert.equal(total, lens.reduce((a, b) => a + b, 0));
  }
});

test('chord names stay over their column, also in a cut measure, and never overlap', () => {
  const m = meas(40, [{ name: 'Am', x: 2 }, { name: 'F#m7', x: 3 }, { name: 'C', x: 30 }]);
  const lines = layoutTabMeasures([m], 24);
  const all = lines.flatMap((l, li) => l.chords.map((c) => ({ ...c, li })));
  assert.deepEqual(all.map((c) => c.name), ['Am', 'F#m7', 'C']);
  assert.equal(all[0].x, 4);
  assert.ok(all[1].x >= all[0].x + 2 + 1, 'the second name moves right instead of overlapping');
  assert.equal(all[2].li, 1);
  const seg = lines[1].segs[0];
  assert.equal(all[2].x, seg.x0 + (30 - seg.from));
});

test('cursor place and row labels', () => {
  const lines = layoutTabMeasures([meas(8), meas(8)], 14);
  assert.deepEqual(tabCursorPlace(lines, 1, 3), { line: 1, col: 5 });
  assert.equal(tabCursorPlace(lines, 7, 0), null);
  assert.deepEqual(tabRowLabels(6, null), ['e', 'B', 'G', 'D', 'A', 'E']);
  assert.deepEqual(tabRowLabels(6, ['D', 'A', 'D', 'G', 'B', 'E']), ['e', 'B', 'G', 'D', 'A', 'D']);
  assert.deepEqual(tabRowLabels(4, null), ['G', 'D', 'A', 'E']);
});

test('a chord name near the end of the line does not stick out of it', () => {
  const lines = layoutTabMeasures([meas(20, [{ name: 'Fmaj7', x: 19 }])], 24);
  for (const l of lines) for (const c of l.chords) assert.ok(c.x + c.name.length <= 24, `${c.x}`);
});
