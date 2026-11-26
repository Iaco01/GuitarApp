// Round 12 (bug 5 of the round 11 tester): the nudge of a section with a manual anchor moves only the chords of that section; the
// sections around it, which are stretched to meet the anchors, keep their chords where they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong } from '../src/model.js';
import { makeAlignment, effectiveEventTimes, nudgeSection } from '../src/alignment.js';

function songOf(sections) {
  return createSong({ title: 'T', bpm: 100, sections: sections.map(([name, chords]) => ({ name, bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: chords.map((n) => ({ name: n, col: 0, beats: 4 })) }] })) });
}
function alignmentOf(song, starts) {
  const N = starts.length;
  return makeAlignment({ eventStartSec: starts, eventEndSec: starts.slice(1).concat([starts[N - 1] + 2.4]), confidence: starts.map(() => 0.9), eventBeats: starts.map(() => 4), sections: song.sections.map(() => ({ bpm: 100, confidence: 0.9 })), transposeFound: 0, tuningCents: 0, gaps: [] }, song);
}

test('nudging an anchored section moves exactly its chords (effective times), the others stay', () => {
  const song = songOf([['A', ['G', 'D', 'Em', 'C']], ['B', ['Am', 'F', 'C', 'G']], ['C', ['D', 'Em', 'G', 'C']]]);
  const a = alignmentOf(song, [0.6, 3, 5.4, 7.8, 10, 12.4, 14.8, 17.2, 19.6, 22, 24.4, 26.8]);
  const anchors = { 1: 10.35, 2: 19.4 }; // not the same as the times of the alignment: the sections are stretched
  const E0 = effectiveEventTimes(song, a, anchors).starts;
  for (const d of [0.25, -0.05, 0.25, -0.25]) {
    const Eb = effectiveEventTimes(song, a, anchors).starts;
    const r = nudgeSection(a, song, 1, d, { anchors });
    assert.ok(r.ok);
    const Ea = effectiveEventTimes(song, a, anchors).starts;
    Ea.forEach((v, j) => {
      const want = j >= 4 && j <= 7 ? Eb[j] + r.applied : Eb[j];
      assert.ok(Math.abs(v - want) < 0.003, `d ${d}: event ${j} at ${v.toFixed(3)}, wanted ${want.toFixed(3)}`);
    });
  }
  assert.ok(Math.abs(effectiveEventTimes(song, a, anchors).starts[0] - E0[0]) < 0.003);
});
