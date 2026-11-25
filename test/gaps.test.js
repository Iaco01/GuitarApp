// Round 8: music that is not in the sheet (gaps) in the stored alignment and in the timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong } from '../src/model.js';
import { buildTimeline } from '../src/timeline.js';
import { makeAlignment, normalizeAlignment, effectiveEventTimes } from '../src/alignment.js';

const chord = (name, beats = 4) => ({ name, col: 0, beats });
function song() {
  return createSong({
    title: 'T', bpm: 100,
    sections: [
      { name: 'A', bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [chord('G'), chord('D')] }] },
      { name: 'B', bpm: 120, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'z', chords: [chord('C'), chord('G', 8)] }] },
    ],
  });
}
// B starts at 12 s, but A stops sounding at 6 s: 6-12 s is a repeat that is not in the sheet
const result = () => ({
  eventStartSec: [1, 3.5, 12, 14], eventEndSec: [3.5, 6, 14, 18], confidence: [0.9, 0.9, 0.8, 0.8], eventBeats: [4, 4, 4, 8],
  sections: [{ bpm: 100, confidence: 0.9 }, { bpm: 120, confidence: 0.8 }],
  gaps: [{ before: 2, startSec: 6, endSec: 12 }], transposeFound: 0, tuningCents: 0,
});

test('the alignment stores the gaps and normalizeAlignment keeps only the consistent ones', () => {
  const a = makeAlignment(result(), song(), 'x');
  assert.deepEqual(a.gaps, [{ before: 2, startSec: 6, endSec: 12 }]);
  assert.deepEqual(normalizeAlignment(JSON.parse(JSON.stringify(a))).gaps, a.gaps);
  const bad = JSON.parse(JSON.stringify(a));
  bad.gaps = [{ before: 2, startSec: 2, endSec: 12 }, { before: 9, startSec: 6, endSec: 12 }, { before: 2, startSec: 8, endSec: 7 }, null];
  assert.deepEqual(normalizeAlignment(bad).gaps, []);
  const old = JSON.parse(JSON.stringify(a));
  delete old.gaps;
  assert.deepEqual(normalizeAlignment(old).gaps, []);
});

test('the event before a gap ends where the gap starts; sections and timeline follow', () => {
  const s = song();
  const a = makeAlignment(result(), s, 'x');
  const eff = effectiveEventTimes(s, a);
  assert.deepEqual(eff.ends, [3.5, 6, 14, a.endSec]);
  assert.deepEqual(eff.gaps, [{ startSec: 6, endSec: 12 }]);
  const tl = buildTimeline(s, { alignment: a });
  assert.ok(tl.aligned);
  assert.equal(tl.events[1].durSec, 2.5);
  assert.equal(tl.events[2].startSec, 12);
  assert.equal(tl.sections[0].endSec, 6);
  assert.equal(tl.sections[1].startSec, 12);
  assert.deepEqual(tl.gaps, [{ startSec: 6, endSec: 12 }]);
  // beats of the event before the gap stay inside it
  const lastBeat = tl.beats.filter((b) => b.eventIndex === 1).pop();
  assert.ok(lastBeat.timeSec < 6);
});

test('an anchor on the section after the gap moves the gap with it', () => {
  const s = song();
  const a = makeAlignment(result(), s, 'x');
  const eff = effectiveEventTimes(s, a, { 1: 13 });
  assert.equal(eff.starts[2], 13);
  assert.ok(eff.ends[1] > 6 && eff.ends[1] < 13);
  assert.equal(eff.gaps.length, 1);
  assert.equal(eff.gaps[0].endSec, 13);
});
