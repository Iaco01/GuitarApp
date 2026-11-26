// Round 10: the REAL recording with whole sections removed from the audio (local fixture only, skipped when it is absent).
// The three round 9 tester `todo` tests on the real song became tests here. Asserts counts and section numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentRecognised } from '../src/alignment.js';
import { realSkip, loadReal, withoutSections, wrongGreens, sisterSections } from './fixtures/real-helper.mjs';

test('REAL song, whole: unchanged (no section skipped, colours as in round 9 but the last free-tempo section, yellow with the new threshold, no gap since round 11: the 59-63 s "gap" was the held G dying out)', { skip: realSkip }, () => {
  const real = loadReal();
  assert.equal(real.whole.st.map((s) => s[0]).join(''), 'rgygygygggry');
  assert.equal(real.whole.res.skipped.filter(Boolean).length, 0);
  assert.equal(real.whole.res.gaps.length, 0);
  assert.ok(alignmentRecognised(real.whole.al, real.song));
  // (nothing is flagged: the choruses and the verses last the same number of beats)
  assert.deepEqual(real.whole.res.sisters.filter(Boolean), []);
});

// a section from the middle removed (Verse 3, the one of the round 9 tester, a chorus, a verse near the end)
for (const si of [4, 5, 8]) {
  test(`REAL song without section ${si + 1}: it is "not in the audio", no green section is wrong`, { skip: realSkip }, () => {
    const real = loadReal();
    const { samples, expected } = withoutSections(real, [si]);
    const { res, al, st } = real.run(samples);
    assert.ok(alignmentRecognised(al, real.song), 'recognised');
    assert.equal(st[si], 'skipped', `section ${si + 1} is ${st[si]}`);
    assert.equal(st.filter((s) => s === 'skipped').length, 1, `skipped: ${st.map((s, k) => (s === 'skipped' ? k + 1 : null)).filter(Boolean)}`);
    assert.deepEqual(wrongGreens(real, res, st, expected), []);
    // the others stay where they were (the audio of a sister section may stand in for it)
    const kept = real.evs.map((_, j) => j).filter((j) => expected(j) !== null);
    const off = kept.filter((j) => Math.abs(res.eventStartSec[j] - expected(j)) > 0.25).length;
    assert.ok(off / kept.length < 0.06, `${off}/${kept.length} events off by more than 250 ms`);
  });
}

test('REAL song without two sections (Verse 3 and the chorus before it): two sections are skipped, no green section is wrong', { skip: realSkip }, () => {
  const real = loadReal();
  const list = [3, 4];
  const { samples, expected } = withoutSections(real, list);
  const { res, al, st } = real.run(samples);
  assert.ok(alignmentRecognised(al, real.song), 'recognised');
  // sections with the same chords are interchangeable: what counts is how many of each kind are skipped
  const kinds = new Set(list.flatMap((si) => sisterSections(real, si)));
  const skippedOfKind = [...kinds].filter((k) => st[k] === 'skipped').length;
  assert.equal(skippedOfKind, 2, `skipped: ${st.map((s, k) => (s === 'skipped' ? k + 1 : null)).filter(Boolean)}`);
  assert.equal(st.filter((s) => s === 'skipped').length, 2);
  assert.deepEqual(wrongGreens(real, res, st, expected), []);
});
