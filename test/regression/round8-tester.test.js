// Round 8 tester: defects still open, as `todo` tests (they do not fail the run). Not part of `npm test`
// (that runs test/*.test.js only): node --test "test/regression/*.test.js"
// They use the tester's synthetic generator (no song text). Each track takes a few seconds to render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised } from '../../src/alignment.js';
import { makeTrack, makeForeign, concat, addNoiseSnr } from '../e2e/round8-tester-make.mjs';

const base = makeTrack({ seed: 5, semis: 0, cents: 0 });
const sr = base.sampleRate;
const evs = songEvents(base.song);

// Bug 1 (media): audio shorter than the sheet (cut at 70%): a section marked green has most of its audible changes wrong.
test('audio cut at 70%: no green section with more than 10% of its audible changes off by > 250 ms', { todo: 'round 8 tester bug 1' }, () => {
  const cut = base.meta.durationSec * 0.7;
  const res = analyseAndAlign({ samples: base.samples.subarray(0, Math.floor(cut * sr)), sampleRate: sr, song: base.song });
  const al = makeAlignment(res, base.song);
  base.song.sections.forEach((_, si) => {
    if (sectionState(al, si) !== 'green') return;
    const idx = evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0 && base.truth[j] < cut - 1);
    if (!idx.length) return;
    const bad = idx.filter((j) => Math.abs(res.eventStartSec[j] - base.truth[j]) > 0.25).length;
    assert.ok(bad / idx.length <= 0.1, `section ${si} is green with ${bad}/${idx.length} wrong`);
  });
});

// Bug 2 (bassa): 15 s of foreign music before the song: the first chord of the sheet starts 3 s early, with confidence 1, and no leading gap is reported.
test('foreign intro of 15 s: the first event starts where the sheet really starts (within 0.5 s)', { todo: 'round 8 tester bug 2' }, () => {
  const intro = makeForeign({ chords: ['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A'], bpm: 110, seed: 8, semis: 0, cents: 0 }).samples.subarray(0, 15 * sr);
  const res = analyseAndAlign({ samples: concat([intro, base.samples]), sampleRate: sr, song: base.song });
  assert.ok(Math.abs(res.eventStartSec[0] - (base.truth[0] + 15)) < 0.5, `first event at ${res.eventStartSec[0].toFixed(2)} s, true ${(base.truth[0] + 15).toFixed(2)} s`);
});

// Bug 3 (bassa): the right song under very strong noise is still aligned exactly, but it is refused as "not recognised".
test('right song at SNR -10 dB (aligned within 250 ms) is not refused as "not recognised"', { todo: 'round 8 tester bug 3' }, () => {
  const res = analyseAndAlign({ samples: addNoiseSnr(base.samples, -10, 77), sampleRate: sr, song: base.song });
  const ok = evs.filter((e, j) => e.section !== 3 && Math.abs(res.eventStartSec[j] - base.truth[j]) <= 0.25).length;
  const total = evs.filter((e) => e.section !== 3).length;
  assert.ok(ok / total >= 0.9, 'precondition: still aligned');
  assert.ok(alignmentRecognised(makeAlignment(res, base.song), base.song), `aligned ${ok}/${total} within 250 ms but refused`);
});
