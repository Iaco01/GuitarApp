// Round 11 on the real (copyrighted, gitignored) song: clicks on a continuous grid. Counts and times only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../src/timeline.js';
import { sisterGroups } from '../src/analysis/coherence.js';
import { loadReal, realSkip } from './fixtures/real-helper.mjs';

const opts = { skip: realSkip };
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

test('real song: steady clicks in the stable sections, none closer than 0.6 beat, accents every bar, stop with the music', opts, () => {
  const { song, whole } = loadReal();
  const al = whole.al;
  const tl = buildTimeline(song, { alignment: al });
  assert.ok(tl.aligned);
  let intervals = 0;
  let off = 0;
  tl.sections.forEach((s, si) => {
    if (al.sections[si].bpm === null) return;
    const b = tl.beats.filter((x) => x.sectionIndex === si);
    const iv = b.slice(1).map((x, i) => x.timeSec - b[i].timeSec);
    const m = med(iv);
    intervals += iv.length;
    off += iv.filter((v) => Math.abs(v / m - 1) > 0.15).length;
    // the median interval is the measured tempo
    assert.ok(Math.abs(60 / m - al.sections[si].bpm) < 2, `section ${si + 1}: ${60 / m} against ${al.sections[si].bpm}`);
    // accents: every 4 beats of the grid
    const downs = b.filter((x) => x.isDownbeat).map((x) => b.indexOf(x));
    assert.ok(downs.slice(1).every((v, i) => (v - downs[i]) % 4 === 0 || v - downs[i] <= 5), `section ${si + 1} accents`);
  });
  assert.ok(intervals > 600);
  assert.ok(off / intervals < 0.02, `${off}/${intervals} intervals more than 15% off`);
  for (let i = 1; i < tl.beats.length; i++) {
    const per = Math.min(tl.beats[i].spb, tl.beats[i - 1].spb);
    assert.ok(tl.beats[i].timeSec - tl.beats[i - 1].timeSec >= 0.6 * per - 1e-9, `ticks ${i - 1}/${i} closer than 0.6 beat`);
  }
  const last = tl.beats[tl.beats.length - 1].timeSec;
  assert.ok(al.musicEndSec > last && al.musicEndSec - last < 2, `last tick ${last}, music ends ${al.musicEndSec}`);
  assert.ok(al.musicEndSec <= tl.totalSec);
  // every chord in the audio and in a stable section has a tick except the very short ones
  const none = tl.events.filter((e) => !e.skipped && e.beats === 0).length;
  assert.ok(none <= 3, `${none} chords without a tick`);
});

test('real song: sister sections have nearly the same number of clicks (the differences are real music or chord times found off by a beat)', opts, () => {
  const { song, evs, whole } = loadReal();
  const tl = buildTimeline(song, { alignment: whole.al });
  for (const g of sisterGroups(evs)) {
    const totals = g.map((si) => tl.events.filter((e) => e.sectionIndex === si).reduce((a, e) => a + e.beats, 0));
    assert.ok(Math.max(...totals) - Math.min(...totals) <= 3, `sisters ${g.map((x) => x + 1)}: ${totals}`);
  }
});
