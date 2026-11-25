// Round 7 tester: known defects as `todo` tests (they run but do not fail the suite until fixed).
// Not part of `npm test` (which only globs test/*.test.js). Run: node --test "test/regression/*.test.js"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseAndAlign } from '../../src/analysis/autosync.js';
import { makeTrack } from '../e2e/round7-tester-make.mjs';

test('free-tempo arpeggiated section: events within 250 ms of the truth, or low confidence', { todo: 'bug 1 (round 7 tester): 0-33% within 250 ms with confidence 1.00' }, () => {
  const tr = makeTrack({ seed: 3 });
  const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
  // events 28-32 of the synthetic song (the section "Free"); 27 repeats the last chord of the previous section and is excluded
  for (const j of [28, 29, 30, 31, 32]) {
    const err = Math.abs(res.eventStartSec[j] - tr.truth[j]);
    assert.ok(err <= 0.25 || res.confidence[j] < 0.6, `event ${j}: error ${(err * 1000).toFixed(0)} ms with confidence ${res.confidence[j].toFixed(2)}`);
  }
});

test('disabled buttons look disabled (Salva, Anteprima, Esporta correzioni with nothing to save)', { todo: 'bug 3 (round 7 tester): no :disabled style for .btn' }, () => {
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /(\.btn|button)(\.[a-z-]+)*:disabled|\[disabled\]/);
});

test('audio longer than the sheet with repeated music still aligns (no null result)', { todo: 'bug 1 (round 7 tester): null at 1.25x when the extra music repeats chords of the sheet' }, () => {
  const tr = makeTrack({ seed: 3 });
  const n = tr.samples.length;
  const longer = new Float32Array(Math.floor(1.25 * n));
  longer.set(tr.samples);
  longer.set(tr.samples.subarray(0, longer.length - n), n); // the first 25% of the song again at the end
  const res = analyseAndAlign({ samples: longer, sampleRate: tr.sampleRate, song: tr.song });
  assert.ok(res, 'analyseAndAlign returned null');
});
