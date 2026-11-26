// Round 10: coherence between sections with the same chords, skip + gap (a section replaced by a solo).
// The `todo` test of the round 9 tester about the solo lives here now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseAndAlign, songEvents } from '../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../src/alignment.js';
import { sisterGroups, sisterFlags, offGridShare, SISTER_MIN_EVENTS } from '../src/analysis/coherence.js';
import { makeTrack, makeForeign, concat, secOfEvents } from './e2e/round8-tester-make.mjs';

const ev = (section, names) => names.map((name) => ({ name, rest: false, section }));

test('sisterGroups: sections with exactly the same chords, at least four chords', () => {
  const events = [...ev(0, ['G', 'D', 'Em', 'C']), ...ev(1, ['C', 'G', 'C', 'G']), ...ev(2, ['G', 'D', 'Em', 'C']), ...ev(3, ['G', 'D', 'Em']), ...ev(4, ['G', 'D', 'Em']), ...ev(5, ['C', 'G', 'C', 'G', 'D'])];
  assert.deepEqual(sisterGroups(events), [[0, 2]]);
  assert.equal(SISTER_MIN_EVENTS, 4);
});

test('sisterFlags: a section far shorter than its sisters is flagged (severe at half), the others are not', () => {
  const groups = [[0, 2, 4, 6]];
  const secs = [];
  secs[0] = { spanSec: 30, bpm: 120, complete: true }; // 60 beats
  secs[2] = { spanSec: 31, bpm: 120, complete: true };
  secs[4] = { spanSec: 12, bpm: 120, complete: true }; // 24 beats: 0.4
  secs[6] = { spanSec: 24, bpm: 120, complete: true }; // 0.8: not flagged at the limit
  const f = sisterFlags(groups, secs);
  assert.equal(f[0], null);
  assert.equal(f[2], null);
  assert.equal(f[4].kind, 'short');
  assert.equal(f[4].severe, true);
  assert.equal(f[6], null);
});

test('sisterFlags: seconds differ but beats are the same (a slower take); a tempo counted double is the same beat', () => {
  const groups = [[0, 1, 2]];
  const secs = [{ spanSec: 20, bpm: 100, complete: true }, { spanSec: 14.3, bpm: 140, complete: true }, { spanSec: 10, bpm: 200, complete: true }];
  assert.deepEqual(sisterFlags(groups, secs), [null, null, null]);
  // the same, with a 50 bpm reading of a 100 bpm section
  const slow = [{ spanSec: 20, bpm: 100, complete: true }, { spanSec: 20.4, bpm: 50, complete: true }, { spanSec: 19.5, bpm: 100, complete: true }];
  assert.deepEqual(sisterFlags(groups, slow), [null, null, null]);
});

test('sisterFlags: incomplete sections are ignored, a free-tempo section is flagged only when far off, a pair flags the shorter', () => {
  const part = sisterFlags([[0, 1, 2]], [{ spanSec: 30, bpm: 120, complete: true }, { spanSec: 5, bpm: 120, complete: false }, { spanSec: 31, bpm: 120, complete: true }]);
  assert.deepEqual(part, [null, null, null]);
  const free = sisterFlags([[0, 1, 2]], [{ spanSec: 30, bpm: 120, complete: true }, { spanSec: 22, bpm: null, complete: true }, { spanSec: 30, bpm: 120, complete: true }]);
  assert.equal(free[1], null); // 22 s of 30: not enough to say anything without a stable beat
  const pair = sisterFlags([[0, 1]], [{ spanSec: 30, bpm: 120, complete: true }, { spanSec: 12, bpm: 120, complete: true }]);
  assert.equal(pair[0], null);
  assert.equal(pair[1].kind, 'short');
});

test('offGridShare: changes on the half beats are on the grid, others are not', () => {
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5); // 120 bpm
  assert.equal(offGridShare([1, 2.25, 3.5, 6], beats, 120), 0);
  assert.equal(offGridShare([1.12, 2.37, 3.12, 6.12], beats, 120), 1); // an eighth of a second off on a quarter second half beat
  assert.equal(offGridShare([], beats, 120), 0);
});

// one section of the sheet replaced in the audio by 20 s of music that is not in the sheet: the section is "not in the
// audio" and the solo is ONE continuous gap (it was split in two pieces that covered two thirds of it)
test('one section replaced by a 20 s solo: the section is skipped and the gap covers at least 90% of the solo', () => {
  const base = makeTrack({ seed: 61, semis: 0, cents: 0, rate: 11025 });
  const sr = base.sampleRate;
  const evs = songEvents(base.song);
  const l = secOfEvents(evs, 5);
  const a = base.truth[l[0]];
  const b = base.truth[l[l.length - 1] + 1];
  const ch = ['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A'];
  const solo = makeForeign({ chords: Array.from({ length: 60 }, (_, i) => ch[i % 8]), bpm: 96, seed: 66, semis: 0, cents: 0, rate: sr }).samples.subarray(0, 20 * sr);
  const sl = (x, y) => base.samples.subarray(Math.floor(x * sr), Math.floor(y * sr));
  const res = analyseAndAlign({ samples: concat([sl(0, a), solo, sl(b, base.meta.durationSec)]), sampleRate: sr, song: base.song });
  const al = makeAlignment(res, base.song);
  assert.equal(sectionState(al, 5), 'skipped');
  assert.equal(base.song.sections.filter((_, si) => sectionState(al, si) === 'skipped').length, 1);
  const inSolo = res.gaps.filter((g) => g.endSec > a && g.startSec < a + 20);
  assert.equal(inSolo.length, 1, 'one gap');
  const covered = inSolo.reduce((s, g) => s + Math.max(0, Math.min(g.endSec, a + 20) - Math.max(g.startSec, a)), 0);
  assert.ok(covered >= 18, `the gap covers ${covered.toFixed(1)} s of the 20 s solo`);
  // the sections around it stay put
  base.song.sections.forEach((_, si) => {
    if (si === 5 || sectionState(al, si) !== 'green') return;
    const idx = evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0);
    const exp = (j) => base.truth[j] - (base.truth[j] > a ? (b - a) - 20 : 0);
    const bad = idx.filter((j) => Math.abs(res.eventStartSec[j] - exp(j)) > 0.25).length;
    assert.ok(bad / idx.length <= 0.1, `section ${si + 1} green with ${bad}/${idx.length} wrong`);
  });
});
