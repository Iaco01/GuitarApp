// Round 10: texts of the sync summary and the correction that starts from a chord in the middle of a section.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionWhy, gapLabel, AS_STATE_TEXT, AS_FREE_TEXT } from '../src/syncwords.js';
import { makeAlignment, replaceSectionStarts, previewReplace, sectionState, normalizeAlignment } from '../src/alignment.js';

test('states: whole words, the same ones everywhere', () => {
  assert.deepEqual([AS_STATE_TEXT.green, AS_STATE_TEXT.yellow, AS_STATE_TEXT.red, AS_FREE_TEXT], ['sicura', 'da controllare', 'incerta', 'tempo libero']);
});

test('sectionWhy: the reason of a yellow or red section in one line, nothing for the others', () => {
  assert.equal(sectionWhy({ bpm: null }, 'red'), 'tempo libero: i cambi sono stimati');
  assert.equal(sectionWhy({ bpm: null }, 'yellow'), 'tempo libero: i cambi sono stimati');
  assert.equal(sectionWhy({ bpm: 120, why: 'sisters' }, 'yellow'), 'dura diversamente dalle sezioni uguali');
  assert.equal(sectionWhy({ bpm: 120, why: 'offgrid' }, 'yellow'), 'i cambi non cadono sui battiti');
  assert.equal(sectionWhy({ bpm: 120, why: null }, 'red'), 'tempi poco netti');
  assert.equal(sectionWhy({ bpm: 120 }, 'green'), null);
  assert.equal(sectionWhy({ bpm: null }, 'verified'), null);
  assert.equal(sectionWhy({ bpm: null }, 'skipped'), null);
});

test('gapLabel: under 6 s a passage with its length, from 6 s a part', () => {
  assert.equal(gapLabel(59.2, 63.4), '0:59–1:03: passaggio non scritto nel foglio (4 s)');
  assert.equal(gapLabel(10, 14.9), '0:10–0:14: passaggio non scritto nel foglio (5 s)');
  assert.equal(gapLabel(42, 70), '0:42–1:10: parte non presente nel foglio');
  assert.equal(gapLabel(0, 6), '0:00–0:06: parte non presente nel foglio');
});

// a section of 6 chords, starts 10 20 30 40 50 60, between a section before (0..) and one after (starting at 70)
function setup() {
  const song = { sections: [
    { name: 'A', lines: [{ chords: [{ name: 'G' }, { name: 'D' }] }] },
    { name: 'B', lines: [{ chords: [{ name: 'Em' }, { name: 'C' }, { name: 'G' }, { name: 'D' }, { name: 'Am' }, { name: 'F' }] }] },
    { name: 'C', lines: [{ chords: [{ name: 'G' }] }] },
  ] };
  const N = 9;
  const starts = [0, 5, 10, 20, 30, 40, 50, 60, 70];
  const result = { eventStartSec: starts, confidence: new Array(N).fill(0.4), eventEndSec: starts.map((t) => t + 5), eventBeats: new Array(N).fill(null), sections: [{ bpm: 100, confidence: 0.4 }, { bpm: 100, confidence: 0.4 }, { bpm: 100, confidence: 0.4 }], skipped: new Array(N).fill(false), gaps: [], transposeFound: 0, transposeMargin: Infinity, transposeScore: 1, tuningCents: 0 };
  return { song, al: makeAlignment(result, song) };
}

test('replaceSectionStarts from a chord in the middle: only those chords move, the section is not verified', () => {
  const { song, al } = setup();
  const r = replaceSectionStarts(al, song, 1, [31, 41.5, 52], { partial: true, from: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(al.eventStartSec, [0, 5, 10, 20, 31, 41.5, 52, 60, 70]);
  assert.deepEqual(r.missing, [0, 1, 5]);
  assert.equal(al.sections[1].verified, false);
  assert.equal(sectionState(al, 1), 'red');
  assert.equal(al.confidence[4], 1);
  assert.equal(al.confidence[3], 0.4);
});

test('replaceSectionStarts from a chord: a tap before the previous chord, or after the next automatic one, is refused', () => {
  const { song, al } = setup();
  assert.equal(replaceSectionStarts(al, song, 1, [19.9, 30], { partial: true, from: 2 }).ok, false); // before the chord that precedes (starts at 20)
  assert.equal(replaceSectionStarts(al, song, 1, [31, 49.97], { partial: true, from: 2 }).ok, false); // too close to the automatic start of the chord after the last tap (50)
  assert.equal(replaceSectionStarts(al, song, 1, [31, 41, 52, 61, 69], { partial: true, from: 2 }).ok, false); // more taps than chords from there on
  assert.deepEqual(al.eventStartSec, [0, 5, 10, 20, 30, 40, 50, 60, 70], 'nothing changed');
});

test('replaceSectionStarts from the start with all the taps verifies the section (as before); the preview does not touch the original', () => {
  const { song, al } = setup();
  const pr = previewReplace(al, song, 1, [21, 31, 41, 51, 61, 66], { partial: true, from: 0 });
  assert.equal(pr.ok, true);
  assert.deepEqual(pr.missing, []);
  assert.equal(pr.alignment.sections[1].verified, true);
  assert.equal(al.sections[1].verified, false);
  const r = replaceSectionStarts(al, song, 1, [21, 31, 41, 51, 61, 66]);
  assert.equal(r.ok, true);
  assert.equal(al.sections[1].verified, true);
  assert.equal(sectionState(al, 1), 'verified');
});

test('the reason of a section survives normalizeAlignment (and unknown ones are dropped)', () => {
  const { al } = setup();
  al.sections[0].why = 'sisters';
  al.sections[1].why = 'offgrid';
  al.sections[2].why = 'nonsense';
  const n = normalizeAlignment(JSON.parse(JSON.stringify(al)));
  assert.deepEqual(n.sections.map((s) => s.why), ['sisters', 'offgrid', null]);
});

import { nudgeEvent, nudgeSection, snapshotTimes, restoreTimes, NUDGE_MIN_DUR_SEC } from '../src/alignment.js';

test('nudgeEvent: moves one chord, clamps between the neighbours, section becomes verified', () => {
  const { song, al } = setup();
  const r = nudgeEvent(al, song, 4, 0.25);
  assert.equal(r.ok, true);
  assert.equal(r.applied, 0.25);
  assert.equal(al.eventStartSec[4], 30.25);
  assert.equal(al.sections[1].verified, true);
  const big = nudgeEvent(al, song, 4, 50); // clamps at next (40) - 0.1
  assert.equal(big.ok, true);
  assert.equal(al.eventStartSec[4], 40 - NUDGE_MIN_DUR_SEC);
  assert.equal(nudgeEvent(al, song, 4, 1).ok, false); // no room
  const back = nudgeEvent(al, song, 3, -50); // clamps at previous (10) + 0.1
  assert.equal(al.eventStartSec[3], 10.1);
  assert.equal(back.ok, true);
  const t = al.eventStartSec;
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= NUDGE_MIN_DUR_SEC - 1e-9, `order at ${i}`);
});

test('nudgeEvent following: the rest of the section moves together; limited by the next section', () => {
  const { song, al } = setup();
  const r = nudgeEvent(al, song, 4, 3, { following: true }); // events 4..7 (7 = F at 60): next section starts at 70
  assert.equal(r.ok, true);
  assert.equal(r.applied, 3);
  assert.deepEqual(al.eventStartSec.slice(3), [20, 33, 43, 53, 63, 70]);
  const big = nudgeEvent(al, song, 4, 20, { following: true });
  assert.equal(al.eventStartSec[7], 70 - NUDGE_MIN_DUR_SEC);
  assert.equal(big.ok, true);
});

test('nudgeSection: moves every chord of the section, never before the previous one; undo restores', () => {
  const { song, al } = setup();
  const snap = snapshotTimes(al);
  const r = nudgeSection(al, song, 1, -0.05);
  assert.equal(r.ok, true);
  assert.deepEqual(al.eventStartSec.slice(2, 8), [9.95, 19.95, 29.95, 39.95, 49.95, 59.95]);
  assert.equal(al.sections[1].startSec, 9.95);
  assert.equal(nudgeSection(al, song, 1, -50).ok, true);
  assert.ok(al.eventStartSec[2] >= 5 + NUDGE_MIN_DUR_SEC - 1e-9);
  restoreTimes(al, snap);
  assert.deepEqual(al.eventStartSec, [0, 5, 10, 20, 30, 40, 50, 60, 70]);
  assert.equal(al.sections[1].verified, false);
  // a section that is skipped can not move
  al.skipped = [8];
  assert.equal(nudgeSection(al, song, 2, 1).ok, false);
});
