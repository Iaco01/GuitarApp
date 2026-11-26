// Round 10: the REAL recording cut at the end (local fixture only, skipped when it is absent). The sections after the cut are
// "not in the audio" (not red), the recognition counts only the others. Asserts counts and section numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentRecognised } from '../src/alignment.js';
import { realSkip, loadReal, wrongGreens } from './fixtures/real-helper.mjs';

for (const frac of [0.3, 0.4, 0.5, 0.6, 0.8, 0.95]) {
  test(`REAL song cut at ${frac * 100}%: recognised, the sections after the cut are skipped, no green section is wrong`, { skip: realSkip }, () => {
    const real = loadReal();
    const n = Math.floor(real.X.length * frac);
    const cutSec = n / real.SR;
    const { res, al, st } = real.run(real.X.subarray(0, n));
    assert.ok(alignmentRecognised(al, real.song), `recognised (colours ${st.map((s) => s[0]).join('')})`);
    const expected = (j) => (real.whole.res.eventStartSec[j] < cutSec - 1 ? real.whole.res.eventStartSec[j] : null);
    // a section that starts (by the whole file) more than a second after the cut is not in the audio: skipped, not red
    real.song.sections.forEach((_, si) => {
      const first = real.evs.findIndex((e) => e.section === si);
      const inAudio = real.evs.filter((e, j) => e.section === si && expected(j) !== null).length;
      if (real.whole.res.eventStartSec[first] > cutSec + 1) assert.equal(st[si], 'skipped', `section ${si + 1} is ${st[si]}`);
      if (inAudio >= 3) assert.notEqual(st[si], 'skipped', `section ${si + 1} is in the audio`);
    });
    assert.deepEqual(wrongGreens(real, res, st, expected), []);
    // the events that are in the audio are where the whole file has them (a section cut in the middle may keep its last chords)
    const here = real.evs.map((_, j) => j).filter((j) => expected(j) !== null);
    const off = here.filter((j) => Math.abs(res.eventStartSec[j] - expected(j)) > 0.25).length;
    assert.ok(off / here.length <= (frac === 0.8 ? 0.15 : 0.05), `${off}/${here.length} events off by more than 250 ms`);
  });
}
