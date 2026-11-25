// Round 4 tester: known problems of the audio sync, written as `todo` tests (they fail today).
// When one is fixed, remove `todo` and move the test next to the module tests.
// Run: node --test "test/regression/*.test.js"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, effectiveSectionBpms } from '../../src/model.js';
import { buildTimeline } from '../../src/timeline.js';
import { suggestSectionBpms, applyBpmSuggestion, audioAnchors } from '../../src/audiosync.js';

// three sections at 70 / 96 / 142 BPM, 8 beats each (synthetic)
function song3() {
  return createSong({
    id: 't',
    title: 'T',
    artist: 'A',
    bpm: 70,
    sections: [70, 96, 142].map((bpm, i) => ({
      name: ['Intro', 'Strofa', 'Ponte'][i],
      bpm,
      bpmSource: 'edited',
      strumIndex: null,
      lines: [{ lyric: 'la', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'C', col: 2, beats: 4 }] }],
    })),
  });
}
const natural = (bpms) => bpms.reduce((t, b) => t + (8 * 60) / b, 0);

test('applying a suggestion over sections with different tempos keeps their ratios', { todo: 'round 4 bug: "Applica" flattens 70/96/142 to one BPM' }, () => {
  const s = song3();
  // the recording is 1% slower everywhere; offset 2 s, "Fine brano" set
  s.audio = { offsetSec: 2, anchors: {}, endSec: 2 + natural([70, 96, 142]) * 1.01 };
  const sug = suggestSectionBpms(s, s.audio);
  assert.equal(sug.length, 1);
  applyBpmSuggestion(s, sug[0]);
  const after = effectiveSectionBpms(s);
  // each section ~1% slower, not all equal
  [70, 96, 142].forEach((b, i) => assert.ok(Math.abs(after[i] - b / 1.01) < 0.3, `section ${i}: ${after[i]} vs ${(b / 1.01).toFixed(2)}`));
});

test('an anchor tapped 70 ms late does not produce a tempo suggestion', { todo: 'round 4: 0.3 BPM tolerance fires on normal tap jitter' }, () => {
  const s = song3();
  const t2 = 2 + natural([70, 96]) + 0.07;
  s.audio = { offsetSec: 2, anchors: { 2: t2 }, endSec: t2 + (8 * 60) / 142 };
  // the drift the suggestion would fix is 70 ms at most: below what the user can see (100 ms)
  assert.deepEqual(suggestSectionBpms(s, s.audio), []);
});

test('sections that end before the next anchor are stretched to it, like the ones that overflow are squeezed', { todo: 'round 4: a gap is left, the last chord is held and the clicks stop' }, () => {
  const s = song3();
  s.sections[1].bpm = 100; // the sheet says 100, the recording is at 96
  const ponte = 2 + natural([70, 96]);
  s.audio = { offsetSec: 2, anchors: { 2: ponte } };
  const tl = buildTimeline(s, { anchors: audioAnchors(s.audio) });
  // no hole between the end of the Strofa and the anchor of the Ponte
  assert.ok(Math.abs(tl.sections[1].endSec - tl.sections[2].startSec) < 1e-6, `gap ${(tl.sections[2].startSec - tl.sections[1].endSec).toFixed(3)} s`);
});
