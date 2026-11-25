// Round 5: fixes of the audio sync found by the round 4 tester (tempo suggestions, anchors and stretches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSongFromMht } from '../src/parser.js';
import { createSong, effectiveSectionBpms } from '../src/model.js';
import { buildTimeline, eventIndexAtTime } from '../src/timeline.js';
import { suggestSectionBpms, applyBpmSuggestion, audioAnchors } from '../src/audiosync.js';

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

test('applying a suggestion over sections with different tempos keeps their ratios', () => {
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

test('an anchor tapped 70 ms late does not produce a tempo suggestion', () => {
  const s = song3();
  const t2 = 2 + natural([70, 96]) + 0.07;
  s.audio = { offsetSec: 2, anchors: { 2: t2 }, endSec: t2 + (8 * 60) / 142 };
  // the drift the suggestion would fix is 70 ms at most: below what the user can see (100 ms)
  assert.deepEqual(suggestSectionBpms(s, s.audio), []);
});

test('sections that end before the next anchor are stretched to it, like the ones that overflow are squeezed', () => {
  const s = song3();
  s.sections[1].bpm = 100; // the sheet says 100, the recording is at 96
  const ponte = 2 + natural([70, 96]);
  s.audio = { offsetSec: 2, anchors: { 2: ponte } };
  const tl = buildTimeline(s, { anchors: audioAnchors(s.audio) });
  // no hole between the end of the Strofa and the anchor of the Ponte
  assert.ok(Math.abs(tl.sections[1].endSec - tl.sections[2].startSec) < 1e-6, `gap ${(tl.sections[2].startSec - tl.sections[1].endSec).toFixed(3)} s`);
});

test('walking through anchored stretches never skips or goes back over an event', () => {
  for (const bpm1 of [92, 100]) {
    const s = song3();
    s.sections[1].bpm = bpm1;
    const ponte = 2 + natural([70, 96]);
    s.audio = { offsetSec: 2, anchors: { 2: ponte } };
    const tl = buildTimeline(s, { anchors: audioAnchors(s.audio) });
    let prev = eventIndexAtTime(tl, 2);
    for (let t = 2; t < tl.totalSec; t += 0.01) {
      const i = eventIndexAtTime(tl, t);
      assert.ok(i === prev || i === prev + 1, `jump ${prev} -> ${i} at ${t.toFixed(2)} s`);
      prev = i;
    }
    assert.equal(prev, tl.events.length - 1);
  }
});

const REAL = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'american-pie.mht');
const real = existsSync(REAL) ? {} : { skip: 'file reale assente' };

test('real file: "Fine brano" + Apply with a recording 0.5% shorter keeps the section ratios', real, () => {
  const s = parseSongFromMht(readFileSync(REAL, 'utf-8'));
  const before = effectiveSectionBpms(s);
  assert.deepEqual([before[0], before[1], before[2]], [62, 96, 142]);
  const nat = (bpms) => s.sections.reduce((t, sec, i) => t + (sec.lines.reduce((n, l) => n + l.chords.reduce((m, c) => m + c.beats, 0), 0) * 60) / bpms[i], 0);
  const end = 3 + nat(before) * 0.995;
  s.audio = { offsetSec: 3, anchors: {}, endSec: end };
  const sug = suggestSectionBpms(s, s.audio);
  assert.equal(sug.length, 1);
  assert.deepEqual([sug[0].from, sug[0].to], [0, 11]);
  applyBpmSuggestion(s, sug[0]);
  const after = effectiveSectionBpms(s);
  assert.deepEqual([after[0], after[1], after[2]], [62.3, 96.5, 142.7]);
  // error at the end of the song after applying: < 50 ms
  assert.ok(Math.abs(3 + nat(after) - end) < 0.05, `end error ${(3 + nat(after) - end) * 1000} ms`);
  assert.deepEqual(suggestSectionBpms(s, s.audio), []);
});
