import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, normalizeAudio } from '../src/model.js';
import { buildTimeline, eventIndexAtTime, beatPositionAtTime, timeAtBeatPosition } from '../src/timeline.js';
import { makeAlignment, normalizeAlignment, alignmentFits, sectionState, effectiveEventTimes, replaceSectionStarts, previewReplace, shiftAlignment, exportTruth, applyMeasuredTiming, countVerified } from '../src/alignment.js';
import { tapsToStarts } from '../src/taprecord.js';
import { audioTimelineOptions } from '../src/audiosync.js';
import { stripAudio } from '../src/libio.js';

const chord = (name, beats = 4) => ({ name, col: 0, beats });
function song() {
  return createSong({
    title: 'T', bpm: 100,
    sections: [
      { name: 'A', bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [chord('G'), chord('D')] }, { lyric: 'y', chords: [chord('Em', 2), { name: 'N.C.', rest: true, beats: 2, col: 0 }] }] },
      { name: 'B', bpm: 120, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'z', chords: [chord('C'), chord('G', 8)] }] },
      { name: 'C', bpm: 90, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'w', chords: [chord('Am')] }] },
    ],
  });
}
// 7 events; starts at free instants
const STARTS = [1, 3.5, 6, 7.2, 9, 11, 15];
function result() {
  return {
    eventStartSec: STARTS, eventEndSec: STARTS.slice(1).concat([17]), confidence: [0.9, 0.9, 0.7, 0.7, 0.5, 0.5, 0.3],
    eventBeats: [4, 4, 2, null, 4, 8, null],
    sections: [{ bpm: 98.7, confidence: 0.85 }, { bpm: null, confidence: 0.85 }, { bpm: 90, confidence: 0.5 }],
    transposeFound: 2, tuningCents: 12.34,
  };
}

test('makeAlignment / normalizeAlignment round trip, validation', () => {
  const s = song();
  const a = makeAlignment(result(), s, '2026-01-01T00:00:00.000Z');
  assert.equal(a.version, 1);
  assert.equal(a.eventStartSec.length, 7);
  assert.deepEqual(a.names, ['G', 'D', 'Em', 'N.C.', 'C', 'G', 'Am']);
  assert.ok(alignmentFits(a, s));
  assert.deepEqual(normalizeAlignment(JSON.parse(JSON.stringify(a))), a);
  assert.equal(normalizeAlignment({ ...a, eventStartSec: [3, 1] }), null);
  assert.equal(normalizeAlignment({ ...a, version: 2 }), null);
  assert.equal(normalizeAlignment(null), null);
  assert.equal(normalizeAlignment({ ...a, eventStartSec: [1, NaN, 3, 4, 5, 6, 7] }), null);
  // the sheet changed: no longer fits
  const s2 = song();
  s2.sections[1].lines[0].chords[0].name = 'F';
  assert.ok(!alignmentFits(a, s2));
});

test('section states: confidence and free tempo', () => {
  const a = makeAlignment(result(), song());
  assert.equal(sectionState(a, 0), 'green');
  assert.equal(sectionState(a, 1), 'yellow'); // green confidence but a free tempo
  assert.equal(sectionState(a, 2), 'yellow'); // 0.5: first yellow value
  a.sections[2].confidence = 0.3;
  assert.equal(sectionState(a, 2), 'red');
  a.sections[2].verified = true;
  assert.equal(sectionState(a, 2), 'verified');
  assert.equal(countVerified(a), 1);
});

test('aligned timeline: events at the aligned instants, beats evenly spread, highlight follows the real timing', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  const tl = buildTimeline(s, { speed: 1, alignment: a });
  assert.ok(tl.aligned);
  assert.deepEqual(tl.events.map((e) => e.startSec), STARTS);
  assert.equal(tl.events[0].ref, '0.0.0');
  assert.equal(tl.events[3].ref, '0.1.1');
  // event 0: 4 beats in 2.5 s
  const b0 = tl.beats.filter((b) => b.eventIndex === 0);
  assert.equal(b0.length, 4);
  assert.ok(Math.abs(b0[1].timeSec - 1.625) < 1e-9);
  assert.equal(eventIndexAtTime(tl, 3.49), 0);
  assert.equal(eventIndexAtTime(tl, 3.5), 1);
  assert.equal(eventIndexAtTime(tl, 0.5), -1);
  // last event ends at alignment.endSec
  assert.ok(Math.abs(tl.totalSec - a.endSec) < 1e-9);
  // beat position <-> time are inverse even with different tempos per event
  for (const t of [1.2, 4.0, 6.5, 7.3, 9.9, 12, 16]) assert.ok(Math.abs(timeAtBeatPosition(tl, beatPositionAtTime(tl, t)) - t) < 1e-6, String(t));
  // sections: start/end and measured tempo
  assert.equal(tl.sections[0].startSec, 1);
  assert.equal(tl.sections[0].endSec, 9);
  assert.ok(Math.abs(tl.sections[0].bpm - (12 * 60) / 8) < 1e-9);
  assert.equal(tl.sections[0].savedBpm, 100);
  // not used for the metronome-only timeline (speed != 1) or when it does not fit
  assert.ok(!buildTimeline(s, { speed: 0.8, alignment: a }).aligned);
  const s2 = song();
  s2.sections[2].lines[0].chords.push(chord('C'));
  assert.ok(!buildTimeline(s2, { speed: 1, alignment: a }).aligned);
});

test('anchors of sections 1.. move their section; the anchor of section 0 is ignored; shift is global', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  const base = effectiveEventTimes(s, a, null).starts;
  assert.deepEqual(base, STARTS);
  const r = effectiveEventTimes(s, a, { 0: 50, 1: 9.5 });
  assert.equal(r.starts[0], 1);
  assert.equal(r.starts[4], 9.5); // section B starts at its anchor
  assert.ok(r.starts[5] > 9.5 && r.starts[5] < 15);
  assert.ok(r.starts.every((v, i) => i === 0 || v > r.starts[i - 1]));
  assert.equal(r.starts[6], 15); // next section untouched
  // an anchor before the previous section is ignored with a warning
  const bad = effectiveEventTimes(s, a, { 1: 0.5 });
  assert.deepEqual(bad.starts, STARTS);
  assert.ok(bad.warnings.length);
  shiftAlignment(a, 0.1);
  assert.ok(Math.abs(effectiveEventTimes(s, a, null).starts[2] - 6.1) < 1e-9);
  assert.ok(Math.abs(buildTimeline(s, { speed: 1, alignment: a }).events[2].startSec - 6.1) < 1e-9);
});

test('replaceSectionStarts: validates, replaces, marks verified; previewReplace leaves the original alone', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  const before = JSON.stringify(a);
  assert.ok(!replaceSectionStarts(a, s, 1, [9.2]).ok); // wrong count
  assert.ok(!replaceSectionStarts(a, s, 1, [9.2, 9.1]).ok); // not increasing
  assert.ok(!replaceSectionStarts(a, s, 1, [5, 10]).ok); // before the previous section
  assert.ok(!replaceSectionStarts(a, s, 1, [9.2, 15.1]).ok); // after the next one
  assert.equal(JSON.stringify(a), before);
  const p = previewReplace(a, s, 1, [9.2, 12]);
  assert.ok(p.ok);
  assert.equal(JSON.stringify(a), before);
  assert.deepEqual(p.alignment.eventStartSec.slice(4, 6), [9.2, 12]);
  const r = replaceSectionStarts(a, s, 1, [9.2, 12]);
  assert.ok(r.ok);
  assert.deepEqual(a.eventStartSec.slice(4, 6), [9.2, 12]);
  assert.equal(a.sections[1].verified, true);
  assert.equal(a.sections[1].startSec, 9.2);
  assert.deepEqual(a.confidence.slice(4, 6), [1, 1]);
  assert.equal(sectionState(a, 1), 'verified');
  // the timeline picks it up
  assert.equal(buildTimeline(s, { speed: 1, alignment: a }).events[5].startSec, 12);
});

test('tapsToStarts: reaction delay, double taps, count check', () => {
  const r = tapsToStarts({ tapTimesSec: [10.3, 12.3, 12.35, 14.3], eventCount: 3, reactionSec: 0.1 });
  assert.equal(r.count, 3);
  assert.equal(r.ignored, 1);
  assert.ok(r.ok);
  assert.deepEqual(r.starts.map((v) => Math.round(v * 100) / 100), [10.2, 12.2, 14.2]);
  assert.ok(!tapsToStarts({ tapTimesSec: [1, 2], eventCount: 3 }).ok);
  assert.deepEqual(tapsToStarts({ tapTimesSec: [3, 1, 2], eventCount: 3 }).starts, [1, 2, 3]);
});

test('exportTruth: verified sections only, times and chord names', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  assert.deepEqual(exportTruth(s, a).sections, []);
  replaceSectionStarts(a, s, 1, [9.2, 12]);
  const t = exportTruth(s, a);
  assert.equal(t.kind, 'alignment-truth');
  assert.deepEqual(t.sections, [{ index: 1, name: 'B', chords: ['C', 'G'], eventStartSec: [9.2, 12], verified: true }]);
  assert.equal(t.eventCount, 7);
});

test('applyMeasuredTiming: tempos and beats of stable sections only', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  const r = applyMeasuredTiming(s, a);
  assert.equal(r.sections, 2); // section B has a free tempo
  assert.equal(s.sections[0].bpm, 98.7);
  assert.equal(s.sections[1].bpm, 120);
  assert.equal(s.sections[2].bpm, 90);
  assert.equal(s.sections[0].lines[1].chords[0].beats, 2);
  assert.equal(s.timingSource, 'edited');
});

test('alignment survives normalizeAudio, library export (stripAudio) and audioTimelineOptions', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  s.audio = normalizeAudio({ fileName: 'x.mp3', mimeType: 'audio/mpeg', size: 10, durationSec: 20, offsetSec: 1, anchors: {}, alignment: a });
  assert.deepEqual(s.audio.alignment, a);
  assert.equal(audioTimelineOptions(s).alignment, s.audio.alignment);
  const out = stripAudio(s);
  assert.deepEqual(normalizeAudio(JSON.parse(JSON.stringify(out.audio))).alignment, a);
  assert.equal(normalizeAudio({ fileName: 'x', alignment: { version: 1, eventStartSec: [2, 1] } }).alignment, undefined);
});
