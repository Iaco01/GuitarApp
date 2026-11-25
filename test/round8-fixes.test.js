// Round 8: partial correction by ear, colour of a section without a stable beat, "not recognised", transposition margin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong } from '../src/model.js';
import { makeAlignment, sectionState, alignmentRecognised, transposeTrusted, replaceSectionStarts, previewReplace, CONF_GREEN } from '../src/alignment.js';

const chord = (name, beats = 4) => ({ name, col: 0, beats });
const song = () => createSong({
  title: 'T', bpm: 100,
  sections: [
    { name: 'A', bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [chord('G'), chord('D'), chord('Em'), chord('C')] }] },
    { name: 'B', bpm: 120, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'z', chords: [chord('Am'), chord('F')] }] },
  ],
});
const result = (extra = {}) => ({
  eventStartSec: [1, 3, 5, 7, 9, 11], eventEndSec: [3, 5, 7, 9, 11, 13], confidence: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9], eventBeats: [4, 4, 4, 4, 4, 4],
  sections: [{ bpm: 100, confidence: 0.9 }, { bpm: 120, confidence: 0.9 }], transposeFound: 0, tuningCents: 0, ...extra,
});

test('a section without a stable beat is never green, and yellow only above the free threshold', () => {
  const s = song();
  const a = makeAlignment(result({ sections: [{ bpm: null, confidence: 0.55 }, { bpm: null, confidence: 0.2 }] }), s);
  assert.equal(sectionState(a, 0), 'yellow');
  assert.equal(sectionState(a, 1), 'red');
  const b = makeAlignment(result({ sections: [{ bpm: null, confidence: 1 }, { bpm: 100, confidence: CONF_GREEN }] }), s);
  assert.equal(sectionState(b, 0), 'yellow');
  assert.equal(sectionState(b, 1), 'green');
});

test('"not recognised" when nearly every section is red', () => {
  const s = song();
  assert.ok(alignmentRecognised(makeAlignment(result(), s), s));
  const red = makeAlignment(result({ sections: [{ bpm: 100, confidence: 0.1 }, { bpm: 100, confidence: 0.2 }] }), s);
  assert.ok(!alignmentRecognised(red, s));
  const half = makeAlignment(result({ sections: [{ bpm: 100, confidence: 0.1 }, { bpm: 100, confidence: 0.9 }] }), s);
  assert.ok(alignmentRecognised(half, s));
});

test('a transposition is proposed only if the best beats the second best by 10% of the score', () => {
  assert.ok(transposeTrusted({ transposeMargin: 2000, transposeScore: 8000 }));
  assert.ok(!transposeTrusted({ transposeMargin: 50, transposeScore: 5000 }));
  assert.ok(transposeTrusted({ transposeMargin: Infinity, transposeScore: 100 }));
  assert.ok(transposeTrusted({ transposeMargin: 1 })); // no score: older result
  const s = song();
  assert.equal(makeAlignment(result({ transposeFound: 3, transposeMargin: 10, transposeScore: 5000 }), s).transposeFound, 0);
  assert.equal(makeAlignment(result({ transposeFound: 3, transposeMargin: 1500, transposeScore: 5000 }), s).transposeFound, 3);
});

test('correction with missing taps: the tapped chords move, the others keep their time, the section is not verified', () => {
  const s = song();
  const a = makeAlignment(result(), s);
  const r = replaceSectionStarts(a, s, 0, [1.2, 3.1, 5.3], { partial: true });
  assert.ok(r.ok);
  assert.deepEqual(r.missing, [3]);
  assert.deepEqual(a.eventStartSec.slice(0, 4), [1.2, 3.1, 5.3, 7]);
  assert.equal(a.confidence[0], 1);
  assert.equal(a.confidence[3], 0.9);
  assert.equal(a.sections[0].verified, false);
  // without `partial` fewer taps are refused, as before
  assert.equal(replaceSectionStarts(makeAlignment(result(), s), s, 0, [1.2, 3.1, 5.3]).ok, false);
  // taps that run into the automatic time of the first untimed chord are refused with a hint
  const bad = replaceSectionStarts(makeAlignment(result(), s), s, 0, [1.2, 3.1, 7.5], { partial: true });
  assert.ok(!bad.ok && /saltato un tocco/.test(bad.reason));
  // all taps: verified as before
  const full = makeAlignment(result(), s);
  assert.deepEqual(replaceSectionStarts(full, s, 0, [1.1, 3.1, 5.1, 7.1], { partial: true }).missing, []);
  assert.equal(full.sections[0].verified, true);
  // preview does not touch the original and reports the missing ones
  const orig = makeAlignment(result(), s);
  const pr = previewReplace(orig, s, 1, [9.2], { partial: true });
  assert.ok(pr.ok);
  assert.deepEqual(pr.missing, [1]);
  assert.equal(orig.eventStartSec[4], 9);
  assert.equal(pr.alignment.eventStartSec[4], 9.2);
});
