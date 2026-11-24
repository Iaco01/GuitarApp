import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, beatPositionAtTime, timeAtBeatPosition } from '../src/timeline.js';
import { quantizeTaps, createTapTempo } from '../src/taprecord.js';
import { createSong } from '../src/model.js';

const mkSong = (sections) => createSong({
  bpm: 142,
  sections: sections.map(([name, bpm, n]) => ({
    name, bpm, bpmSource: 'edited', strumIndex: null,
    lines: [{ lyric: 'x', chords: Array.from({ length: n }, (_, i) => ({ name: 'C', col: i, beats: 4 })) }],
  })),
});

// Simulated player: chord k lasts durs[k] beats; returns the song time of the start of chord k.
function tapsFor(tl, durs, jitterSec = () => 0) {
  const taps = [];
  let beat = 0;
  for (const d of durs) {
    beat += d;
    taps.push(timeAtBeatPosition(tl, beat) + jitterSec(taps.length));
  }
  return taps;
}

test('beat position and time are inverse functions across a tempo change', () => {
  const tl = buildTimeline(mkSong([['A', 60, 2], ['B', 120, 2]]));
  for (const pos of [0, 1.5, 7.99, 8, 9.25, 15.5]) {
    assert.ok(Math.abs(beatPositionAtTime(tl, timeAtBeatPosition(tl, pos)) - pos) < 1e-9, String(pos));
  }
  assert.equal(beatPositionAtTime(tl, tl.events[2].startSec), 8);
  assert.ok(beatPositionAtTime(tl, -1) < 0);
});

test('exact taps give exact durations (last chord ends at the extra tap)', () => {
  const tl = buildTimeline(mkSong([['A', 142, 5]]));
  const durs = [4, 2, 8, 1, 3];
  assert.deepEqual(quantizeTaps({ tapTimesSec: tapsFor(tl, durs), timeline: tl, firstEventIndex: 0, eventCount: 5 }), durs);
});

test('jitter of +-80 ms at 142 BPM is absorbed by the rounding', () => {
  const tl = buildTimeline(mkSong([['A', 142, 8]]));
  const durs = [4, 4, 2, 2, 4, 1, 3, 4];
  const jit = [0.08, -0.08, 0.05, -0.07, 0.08, -0.08, 0.02, 0.06];
  const taps = tapsFor(tl, durs, (i) => jit[i]);
  assert.deepEqual(quantizeTaps({ tapTimesSec: taps, timeline: tl, firstEventIndex: 0, eventCount: 8 }), durs);
});

test('double taps are ignored', () => {
  const tl = buildTimeline(mkSong([['A', 120, 3]]));
  const taps = tapsFor(tl, [4, 4, 4]);
  const withDouble = [taps[0], taps[0] + 0.1, taps[1], taps[1] + 0.2, taps[2]];
  assert.deepEqual(quantizeTaps({ tapTimesSec: withDouble, timeline: tl, firstEventIndex: 0, eventCount: 3 }), [4, 4, 4]);
});

test('missing taps keep the current durations; "Fine" ends the last chord', () => {
  const tl = buildTimeline(mkSong([['A', 120, 4]]));
  const taps = tapsFor(tl, [2, 6]);
  assert.deepEqual(quantizeTaps({ tapTimesSec: taps, timeline: tl, firstEventIndex: 0, eventCount: 4 }), [2, 6, 4, 4]);
  const end = timeAtBeatPosition(tl, 2 + 6 + 3);
  assert.deepEqual(quantizeTaps({ tapTimesSec: taps, timeline: tl, firstEventIndex: 0, eventCount: 3, endTimeSec: end }), [2, 6, 3]);
});

test('recording a span in the middle of the song and across a tempo change', () => {
  const tl = buildTimeline(mkSong([['A', 62, 4], ['B', 96, 4]]));
  // record chords 2..5 (spans the A -> B boundary at chord 4)
  const first = 2;
  const durs = [4, 3, 5, 4];
  const startBeat = tl.events[first].startBeat;
  const taps = [];
  let b = startBeat;
  for (const d of durs) { b += d; taps.push(timeAtBeatPosition(tl, b) + 0.03); }
  assert.deepEqual(quantizeTaps({ tapTimesSec: taps, timeline: tl, firstEventIndex: first, eventCount: 4 }), durs);
});

test('durations are never below 1 even for fast taps', () => {
  const tl = buildTimeline(mkSong([['A', 120, 3]]));
  const taps = [timeAtBeatPosition(tl, 1), timeAtBeatPosition(tl, 2), timeAtBeatPosition(tl, 3)];
  assert.deepEqual(quantizeTaps({ tapTimesSec: taps, timeline: tl, firstEventIndex: 0, eventCount: 3 }), [1, 1, 1]);
});

test('tap tempo averages the last 4 intervals and resets after 2 s', () => {
  const t = createTapTempo();
  assert.equal(t.tap(0), null);
  assert.equal(t.tap(0.5), 120);
  t.tap(1.0); t.tap(1.5);
  assert.equal(t.tap(2.0), 120);
  assert.equal(t.tap(2.4), Math.round((60 / ((2.4 - 0.5) / 4)) * 10) / 10); // oldest tap dropped
  assert.equal(t.tap(10), null); // reset
  assert.equal(t.tap(10.6), 100);
});
