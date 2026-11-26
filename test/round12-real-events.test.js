// Round 12: the defect of the round 11 tester (bug 1, event 306) is fixed and these are normal tests now. Real (copyrighted, gitignored)
// song, times only; skipped without the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReal, realSkip } from './fixtures/real-helper.mjs';

const opts = { skip: realSkip };

test('real song: event 306 (D, Verse 6) stays within 0.3 s of where the G ends (round 10: 473.83 s, round 11: 473.15 s)', opts, () => {
  const { whole } = loadReal();
  const t = whole.res.eventStartSec;
  // independent check (numpy flux + chroma, tester round 11): attack at 473.80 s, G chroma collapses at 473.85-473.90 s
  assert.ok(Math.abs(t[306] - 473.83) <= 0.3, `event 306 at ${t[306]}`);
});

test('real song: event 32 (Em to C), moved by round 11, sits on the attack and the chroma/bass rise', { skip: realSkip }, () => {
  const { whole } = loadReal();
  const t = whole.res.eventStartSec;
  // event 32 (Em to C) improved: attack at 52.96 s, bass C and chroma C rise at 53.0-53.2 s
  assert.ok(t[32] >= 52.9 && t[32] <= 53.3, `event 32 at ${t[32]}`);
});
