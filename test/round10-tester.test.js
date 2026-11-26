// Round 10 tester defects, fixed in round 11 (nudge: ticks follow, gaps are kept, anchors do not swallow the nudge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong } from '../src/model.js';
import { buildTimeline } from '../src/timeline.js';
import { makeAlignment, nudgeEvent, nudgeSection, effectiveEventTimes } from '../src/alignment.js';
import { audioTimelineOptions } from '../src/audiosync.js';

const chord = (name, beats = 4) => ({ name, col: 0, beats });
function song() {
  return createSong({
    title: 'T', bpm: 100,
    sections: [
      { name: 'A', bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [chord('G'), chord('D'), chord('Em'), chord('C')] }] },
      { name: 'B', bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'y', chords: [chord('Am'), chord('F')] }] },
    ],
  });
}
// 100 BPM (0,6 s a quarter), chords of 4 quarters; section A at 0..9,6 s, a 4 s gap of foreign music after the 4th chord, section B after
function align(withGap = false) {
  const starts = withGap ? [0, 2.4, 4.8, 7.2, 13.6, 16.0] : [0, 2.4, 4.8, 7.2, 9.6, 12.0];
  const res = {
    eventStartSec: starts, eventEndSec: starts.slice(1).concat([starts[5] + 2.4]), confidence: starts.map(() => 0.9), eventBeats: [4, 4, 4, 4, 4, 4],
    sections: [{ bpm: 100, confidence: 0.9 }, { bpm: 100, confidence: 0.9 }], transposeFound: 0, tuningCents: 0,
    gaps: withGap ? [{ before: 4, startSec: 9.6, endSec: 13.6 }] : [],
  };
  return makeAlignment(res, song());
}
const tl = (a) => buildTimeline(song(), { alignment: a });

test('baseline: a synced chord of 4 quarters has 4 ticks', () => {
  const t = tl(align());
  assert.deepEqual(t.events.map((e) => e.beats), [4, 4, 4, 4, 4, 4]);
});

test('nudge: after a nudge that shortens a chord to the 0,1 s minimum its ticks follow (no 4 ticks in 0,1 s)', () => {
  const a = align();
  const r = nudgeEvent(a, song(), 2, -2.35); // chord 2 earlier: chord 1 now lasts 0,1 s
  assert.ok(r.ok);
  const t = tl(a);
  const e1 = t.events[1];
  assert.ok(e1.durSec < 0.2);
  assert.ok(e1.beats <= Math.max(1, Math.round((e1.durSec * 100) / 60)), `chord of ${e1.durSec.toFixed(2)} s has ${e1.beats} ticks`);
});

test('nudge: a chord lengthened by +0,25 keeps ticks at about the section tempo', () => {
  const a = align();
  nudgeEvent(a, song(), 1, 1.2); // chord 0 now lasts 3,6 s, chord 1 shortened to 1,2 s: both still say 4 quarters
  const t = tl(a);
  const spacing = (e) => e.durSec / e.beats;
  assert.ok(spacing(t.events[1]) >= 0.45, `spacing of the shortened chord ${spacing(t.events[1]).toFixed(3)} s`);
});

test('nudge: moving the chord after a gap earlier keeps the gap (the 4 s of foreign music)', () => {
  const a = align(true);
  assert.equal(a.gaps.length, 1);
  const r = nudgeEvent(a, song(), 4, -0.05);
  assert.ok(r.ok);
  assert.equal(a.gaps.length, 1, 'the gap disappeared: the chord before it now lasts as long as the gap');
  const { gaps } = effectiveEventTimes(song(), a);
  assert.equal(gaps.length, 1);
});

test('nudge: nudging the first section after a gap earlier (nudgeSection) keeps the gap', () => {
  const a = align(true);
  nudgeSection(a, song(), 1, -0.25);
  assert.equal(a.gaps.length, 1);
});

test('nudge on an anchored section is not swallowed (the section moves by the requested amount)', () => {
  const a = align();
  const s = song();
  const anchors = { 1: 9.6 };
  const before = buildTimeline(s, { alignment: a, anchors }).events[4].startSec;
  const r = nudgeSection(a, s, 1, 0.25, { anchors }); // the anchor of the section moves with it
  assert.ok(r.ok);
  assert.equal(anchors[1], 9.85);
  const after = buildTimeline(s, { alignment: a, anchors }).events[4].startSec;
  assert.ok(Math.abs(after - before - 0.25) < 0.02, `first chord of the anchored section moved ${(after - before).toFixed(3)} s`);
});

import { normalizeAlignment, snapshotTimes, restoreTimes } from '../src/alignment.js';
test('a nudged alignment survives the library JSON round trip and an undo restores it exactly', () => {
  const a = align(true);
  const snap = snapshotTimes(a);
  nudgeEvent(a, song(), 3, 0.25);
  nudgeSection(a, song(), 1, 0.25);
  const back = normalizeAlignment(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(back.eventStartSec, a.eventStartSec);
  assert.equal(back.gaps.length, 1);
  assert.ok(back.sections[0].verified && back.sections[1].verified);
  restoreTimes(a, snap);
  assert.deepEqual(a.eventStartSec, align(true).eventStartSec);
});
