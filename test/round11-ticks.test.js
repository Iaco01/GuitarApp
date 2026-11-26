// Round 11: the metronome clicks sit on a continuous grid of beats (beatgrid.js, timeline.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothBeatGrid, packGrid, gridTimes, regularGridTimes, gridTicks, freeTicks, barPosition } from '../src/beatgrid.js';
import { createSong } from '../src/model.js';
import { buildTimeline } from '../src/timeline.js';
import { makeAlignment, normalizeAlignment } from '../src/alignment.js';
import { analyseAndAlign } from '../src/analysis/autosync.js';
import { build } from './e2e/round10-tester-make.mjs';

const wobble = (n, per, amp, seed = 1) => { let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; return Array.from({ length: n }, (_, k) => 2 + k * per + amp * r()); };

test('smoothBeatGrid: wobbling beats (and a missing one) become a grid with steady intervals that covers the section', () => {
  const t = wobble(40, 0.43, 0.07);
  t.splice(12, 1); // a beat the tracker skipped
  const g = smoothBeatGrid(t, 60 / 0.43, 0.5, 20);
  const times = gridTimes(g);
  assert.ok(times[0] <= 2 - 0.25 && times[times.length - 1] >= 2 + 39 * 0.43 - 0.1);
  const iv = times.slice(1).map((v, i) => v - times[i]);
  const m = iv.slice().sort((a, b) => a - b)[iv.length >> 1];
  assert.ok(iv.every((v) => Math.abs(v / m - 1) < 0.05), 'intervals within 5%');
  assert.ok(Math.abs(m - 0.43) < 0.01);
  assert.ok(g.dev.every((d) => Math.abs(d) < 60), 'small deviations');
  assert.equal(smoothBeatGrid([1, 2], 60, 0, 5), null);
  assert.deepEqual(gridTimes(packGrid([1, 1.5, 2.01, 2.5])).map((v) => Math.round(v * 100) / 100), [1, 1.5, 2.01, 2.5]);
});

test('smoothBeatGrid follows a slow tempo drift', () => {
  const t = []; let x = 0; for (let k = 0; k < 60; k++) { t.push(x); x += 0.4 + 0.00132 * k; }
  const g = gridTimes(smoothBeatGrid(t, 150, 0, x));
  const worst = Math.max(...t.map((v, k) => Math.abs(g.reduce((best, w) => (Math.abs(w - v) < Math.abs(best) ? w - v : best), 9))));
  assert.ok(worst < 0.03, `worst ${worst}`);
});

test('gridTicks: a chord gets the beats of the grid that fall in it; accent every bar from the phase that suits the changes', () => {
  const times = Array.from({ length: 30 }, (_, k) => 1 + k * 0.5);
  // chords change on beats 2, 6, 8 (in beats from the first beat) with 0.1 s of noise
  const evs = [{ start: 2.05, end: 4.0 }, { start: 3.95, end: 5.0 }, { start: 5.0, end: 7.0, stop: true }].map((e, i) => ({ ...e, i }));
  evs[0].start = 2; evs[1].start = 4.1; evs[1].end = 5; evs[2].start = 5; // 2..4.1, 4.1..5, 5..7
  const { ticks, phase } = gridTicks(times, 0.5, evs, 4);
  assert.deepEqual(ticks.map((t) => t.map((x) => x.timeSec)), [[2, 2.5, 3, 3.5], [4, 4.5], [5, 5.5, 6, 6.5]]);
  assert.equal(phase, 2); // two of the three changes are on k = 2 and 6: the downbeat is k = 2 mod 4
});

test('freeTicks: a tick on every change, more only for a chord of at least two beats, never close to the next change', () => {
  const t = freeTicks([{ start: 0, end: 0.9 }, { start: 0.9, end: 2.1 }, { start: 2.1, end: 5 }], 0.5, 4);
  assert.deepEqual(t.map((x) => x.map((y) => Math.round(y.timeSec * 100) / 100)), [[0], [0.9, 1.4], [2.1, 2.6, 3.1, 3.6, 4.1, 4.6]]);
  assert.deepEqual(t[2].map((y) => y.bar), [0, 1, 2, 3, 0, 1]);
  assert.equal(barPosition(5, 1, 4), 0);
});

function songOf(sections) {
  return createSong({ title: 'T', bpm: 100, sections: sections.map(([name, chords]) => ({ name, bpm: 100, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: chords.map((n) => ({ name: n, col: 0, beats: 4 })) }] })) });
}
function alignOf(song, starts, grids, bpms = grids.map(() => 100), extra = {}) {
  const N = starts.length;
  return makeAlignment({ eventStartSec: starts, eventEndSec: starts.slice(1).concat([starts[N - 1] + 2.4]), confidence: starts.map(() => 0.9), eventBeats: starts.map(() => 4), sections: grids.map((g, i) => ({ bpm: bpms[i], confidence: 0.9, grid: g })), transposeFound: 0, tuningCents: 0, gaps: [], ...extra }, song);
}

test('a stored grid survives normalizeAlignment and drives the clicks: continuous across chords, accent every 4 from the first change', () => {
  const song = songOf([['A', ['G', 'D', 'Em']]]);
  const grid = packGrid(Array.from({ length: 30 }, (_, k) => 1 + k * 0.6));
  const a = alignOf(song, [1.02, 3.4, 6.05], [grid], [100], { musicEndSec: 9.5 });
  const b = normalizeAlignment(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(b.sections[0].grid, a.sections[0].grid);
  assert.equal(b.musicEndSec, 9.5);
  const tl = buildTimeline(song, { alignment: b });
  assert.deepEqual(tl.events.map((e) => e.beats), [4, 4, 5]);
  const all = tl.beats.map((x) => x.timeSec);
  for (let i = 1; i < all.length; i++) assert.ok(Math.abs(all[i] - all[i - 1] - 0.6) < 1e-6, 'one steady grid');
  assert.deepEqual(tl.beats.filter((x) => x.isDownbeat).map((x) => x.index), [0, 4, 8, 12]);
  assert.ok(all[all.length - 1] <= 9.5, 'no click after the music ends');
});

test('synthetic song: the clicks of stable chords fall on the true beats (error < 30 ms) and the number of clicks is the true one', () => {
  const { tr, song } = build();
  const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song });
  const al = makeAlignment(res, song);
  const tl = buildTimeline(song, { alignment: al });
  const truth = tr.meta.timeline.filter((e) => e.sheetIdx >= 0);
  let exact = 0;
  let stable = 0;
  const errs = [];
  truth.forEach((e, i) => {
    if (!e.secBpm) return;
    stable++;
    const mine = tl.beats.filter((b) => b.eventIndex === i).map((b) => b.timeSec);
    if (mine.length === e.beats) exact++;
    const trueTicks = Array.from({ length: e.beats + 1 }, (_, k) => e.t0 + (k * 60) / e.secBpm);
    for (const t of mine) errs.push(Math.min(...trueTicks.map((x) => Math.abs(x - t))));
  });
  errs.sort((a, b) => a - b);
  assert.ok(exact / stable >= 0.85, `${exact}/${stable} chords with the exact number of clicks`);
  assert.ok(errs[Math.floor(errs.length * 0.9)] < 0.03, `p90 error ${errs[Math.floor(errs.length * 0.9)]}`);
  assert.ok(errs[errs.length >> 1] < 0.015, `median error ${errs[errs.length >> 1]}`);
  // the last chord lasts 8 quarters and the audio has a long tail: the clicks stop when the sound is gone
  assert.equal(tl.events[tl.events.length - 1].beats, 8);
});

import { createMediaClickCore, LOOP_PREROLL_SEC } from '../src/audiosync.js';
test('click core: after a seek the beat that sits a few ms behind the landing position is not lost (first click of a loop lap)', () => {
  const beats = [10, 10.5, 11, 11.5].map((t, index) => ({ index, timeSec: t, isDownbeat: index === 0 }));
  const core = createMediaClickCore({ beats });
  core.reset(10.03); // the seek landed 30 ms after the section start
  const out = core.pull({ ctxNow: 5, mediaNow: 10.03 });
  assert.deepEqual(out.map((b) => b.index), [0]);
  assert.ok(LOOP_PREROLL_SEC > 0.03 && LOOP_PREROLL_SEC < 0.2);
});

import { nudgeEvent, nudgeSection } from '../src/alignment.js';
test('nudges never put ticks closer than 0.6 beat, the grid stays where the music is, a gap is shortened or lengthened and goes only under 3 s', () => {
  const song = songOf([['A', ['G', 'D', 'Em', 'C']], ['B', ['Am', 'F']]]);
  const grid = packGrid(Array.from({ length: 60 }, (_, k) => 0.5 + k * 0.6));
  const a = alignOf(song, [0.6, 3, 5.4, 7.8, 13.8, 16.2], [grid, packGrid(Array.from({ length: 20 }, (_, k) => 13.8 + k * 0.6))], [100, 100], { gaps: [{ before: 4, startSec: 10.2, endSec: 13.8 }] });
  a.gaps = [{ before: 4, startSec: 10.2, endSec: 13.8 }];
  const check = () => {
    const tl = buildTimeline(song, { alignment: a });
    for (let i = 1; i < tl.beats.length; i++) assert.ok(tl.beats[i].timeSec - tl.beats[i - 1].timeSec >= 0.6 * 0.6 - 1e-9, `ticks ${i}`);
    for (const e of tl.events) if (e.durSec < 0.2) assert.ok(e.beats <= 1);
  };
  check();
  for (let n = 0; n < 40; n++) {
    nudgeEvent(a, song, 2, -0.25); // chord 2 earlier and earlier: chord 1 shrinks to 0.1 s
    check();
  }
  assert.equal(a.gaps.length, 1);
  const g0 = a.gaps[0].endSec - a.gaps[0].startSec;
  nudgeEvent(a, song, 4, 0.25);
  assert.ok(Math.abs(a.gaps[0].endSec - a.gaps[0].startSec - (g0 + 0.25)) < 1e-9, 'the gap is lengthened');
  nudgeEvent(a, song, 4, -0.25);
  nudgeEvent(a, song, 4, -0.25);
  assert.ok(Math.abs(a.gaps[0].endSec - a.gaps[0].startSec - (g0 - 0.25)) < 1e-9, 'the gap is shortened');
  nudgeSection(a, song, 1, -0.25); // the whole section after the gap
  assert.equal(a.gaps.length, 1);
  for (let n = 0; n < 4; n++) nudgeSection(a, song, 1, -0.25);
  assert.equal(a.gaps.length, 0, 'under 3 s it is not a gap any more');
  check();
});
