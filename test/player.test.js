import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSchedulerCore, firstBeatIndexFrom } from '../src/player.js';
import { buildTimeline } from '../src/timeline.js';
import { createSong } from '../src/model.js';

const song = () => createSong({
  bpm: 60,
  sections: [
    { name: 'A', bpm: 60, bpmSource: 'edited', strumIndex: null, lines: [{ lyric: 'x', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 1, beats: 4 }] }] },
    { name: 'B', bpm: 120, bpmSource: 'edited', strumIndex: null, lines: [{ lyric: 'x', chords: [{ name: 'C', col: 0, beats: 4 }] }] },
  ],
});

test('scheduler core returns each beat once, inside the lookahead window, with accents', () => {
  const tl = buildTimeline(song());
  const core = createSchedulerCore({ beats: tl.beats, lookahead: 0.1 });
  core.start({ fromIndex: 0, offsetSec: 0, originCtx: 10 });
  assert.deepEqual(core.pull(9.8).map((b) => b.index), []); // 10.0 is beyond 9.8 + 0.1
  const first = core.pull(9.95); // 10.0 < 9.95 + 0.1
  assert.deepEqual(first.map((b) => b.index), [0]);
  const all = [];
  for (let t = 10; t < 20; t += 0.025) all.push(...core.pull(t));
  const idx = [...first, ...all].map((b) => b.index);
  assert.deepEqual(idx, Array.from(new Set(idx))); // no duplicates
  assert.equal(idx[idx.length - 1], 11);
  const byIdx = Object.fromEntries([...first, ...all].map((b) => [b.index, b]));
  assert.equal(byIdx[0].accent, true);
  assert.equal(byIdx[4].accent, true); // 1st beat of the 2nd bar
  assert.equal(byIdx[1].accent, false);
  assert.ok(Math.abs(byIdx[8].when - 18) < 1e-9); // tempo change: section B starts at 8 s
  assert.ok(Math.abs(byIdx[9].when - 18.5) < 1e-9);
});

test('scheduler core skips beats that are too late and starts mid-song', () => {
  const tl = buildTimeline(song());
  const core = createSchedulerCore({ beats: tl.beats });
  core.start({ fromIndex: 4, offsetSec: 4, originCtx: 5 });
  const out = core.pull(7); // beats 4 (5.0), 5 (6.0) are in the past, 6 (7.0) is due
  assert.deepEqual(out.map((b) => b.index), [6]);
});

test('scheduler core loop keeps the clock continuous across the wrap', () => {
  const tl = buildTimeline(song());
  const s = tl.sections[1]; // 4 beats at 120 bpm: 2 s
  const core = createSchedulerCore({ beats: tl.beats, loop: { fromIdx: s.startBeat, toIdx: s.endBeat, startSec: s.startSec, endSec: s.endSec } });
  core.start({ fromIndex: s.startBeat, offsetSec: s.startSec, originCtx: 100 });
  const got = [];
  for (let t = 100; t < 105; t += 0.02) got.push(...core.pull(t));
  assert.deepEqual(got.slice(0, 10).map((b) => b.index), [8, 9, 10, 11, 8, 9, 10, 11, 8, 9]);
  assert.deepEqual(got.slice(0, 6).map((b) => Math.round(b.when * 1000) / 1000), [100, 100.5, 101, 101.5, 102, 102.5]);
  assert.deepEqual(got.slice(0, 6).map((b) => b.accent), [true, false, false, false, true, false]);
});

test('firstBeatIndexFrom picks the first beat at or after a time', () => {
  const tl = buildTimeline(song());
  assert.equal(firstBeatIndexFrom(tl, 0), 0);
  assert.equal(firstBeatIndexFrom(tl, 2), 2);
  assert.equal(firstBeatIndexFrom(tl, 2.2), 3);
  assert.equal(firstBeatIndexFrom(tl, -5), 0);
});
