// Round 11 on the real (copyrighted, gitignored) song: the end of Verse 1 and the start of Chorus 1 (events 30-35, 0-based):
// the held G is not a gap, the C is not half a second late, the Chorus attack is where it is. Times and counts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../src/timeline.js';
import { loadReal, realSkip } from './fixtures/real-helper.mjs';

const opts = { skip: realSkip };

test('real song: no gap between Verse 1 and Chorus 1, the held G lasts to the Chorus, C and the Chorus attack are in place', opts, () => {
  const { whole, song } = loadReal();
  const t = whole.res.eventStartSec;
  assert.equal(whole.res.gaps.length, 0, 'the held chord is not music that the sheet lacks');
  assert.equal(whole.al.gaps.length, 0);
  assert.ok(t[34] < 59 && whole.res.eventEndSec[34] > 62.5, `event 34 lasts from ${t[34]} to ${whole.res.eventEndSec[34]}`);
  assert.ok(t[32] >= 53.0 && t[32] <= 53.5, `event 32 at ${t[32]}`);
  assert.ok(t[35] >= 62.9 && t[35] <= 63.6, `event 35 at ${t[35]}`);
  // in play the highlight does not vanish at 59.3 s: no gap in the timeline, and the G still has clicks after 62 s
  const tl = buildTimeline(song, { alignment: whole.al });
  assert.equal(tl.gaps.length, 0);
  assert.ok(tl.beats.some((b) => b.eventIndex === 34 && b.timeSec > 61));
});
