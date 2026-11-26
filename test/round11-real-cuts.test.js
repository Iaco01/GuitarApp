// Round 11 on the real (copyrighted, gitignored) song: audio cut at the beginning or in the middle of a section. Counts and section
// numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionEventIndices, sectionState } from '../src/alignment.js';
import { loadReal, realSkip } from './fixtures/real-helper.mjs';

const opts = { skip: realSkip };

test('real song without the first 60 s: the sections that play are present, the first one (cut) is not green', opts, () => {
  const real = loadReal();
  const { song, X, SR, run, whole, evs } = real;
  const { res, al, st } = run(X.subarray(60 * SR));
  assert.equal(st.length, 12);
  // sections 2..12 all play in the audio: none is "non presente"
  for (let si = 1; si < 12; si++) assert.notEqual(st[si], 'skipped', `section ${si + 1} is present in the audio`);
  assert.notEqual(st[0], 'green');
  // the events that play are where the full analysis has them (shifted by the cut), for almost all of them
  const idx = sectionEventIndices(song);
  let n = 0;
  let bad = 0;
  idx.forEach((list, si) => {
    if (si === 0) return;
    list.forEach((j) => { n++; if (Math.abs(res.eventStartSec[j] - (whole.res.eventStartSec[j] - 60)) > 0.25) bad++; });
  });
  assert.ok(bad / n < 0.15, `${bad}/${n} events more than 250 ms from where they are in the whole recording`);
  assert.ok(evs.length === 328);
  void al;
});

test('real song cut in the middle of a section: the cut section is partial (final events skipped) and never "sicura"', opts, () => {
  const { X, run, song } = loadReal();
  for (const frac of [0.3, 0.45, 0.5, 0.7]) {
    const { al, st } = run(X.subarray(0, Math.floor(X.length * frac)));
    const idx = sectionEventIndices(song);
    const sk = new Set(al.skipped);
    idx.forEach((list, si) => {
      const here = list.filter((j) => !sk.has(j)).length;
      if (here > 0 && here < list.length) assert.ok(['yellow', 'red'].includes(st[si]), `cut ${frac}: section ${si + 1} is partial (${here}/${list.length}) and ${st[si]}`);
    });
    assert.ok(st.some((s) => s === 'skipped'));
  }
});
