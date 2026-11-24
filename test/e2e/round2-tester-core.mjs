// Round 2 tester: pure-core checks in Node (no browser). Run: node test/e2e/round2-tester-core.mjs
// Real file used for numbers only (counts, seconds); nothing from its text is printed.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseSongFromMht } from '../../src/parser.js';
import { buildTimeline, eventIndexAtTime, beatIndexAtTime } from '../../src/timeline.js';
import { createSchedulerCore } from '../../src/player.js';
import { quantizeTaps, createTapTempo } from '../../src/taprecord.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'test/fixtures/local/american-pie.mht');
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
if (!existsSync(FILE)) { console.log('real file missing'); process.exit(2); }
const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));

// ---- B1: tempos per section (own expectation: Verse 1 = 62, Chorus = 96, Verse 2..6 = 142)
const want = song.sections.map((s) => (s.name === 'Verse 1' ? 62 : s.name === 'Chorus' ? 96 : 142));
rec('B1-section-bpm', song.sections.every((s, i) => s.bpm === want[i]), song.sections.map((s) => s.bpm).join(','));

// ---- B2: total duration recomputed from scratch with default durations (4 beats per chord)
let mine = 0;
const counts = song.sections.map((s) => s.lines.reduce((a, l) => a + l.chords.length, 0));
counts.forEach((n, i) => { mine += (n * 4 * 60) / want[i]; });
const tl = buildTimeline(song);
rec('B2-total-seconds', Math.abs(tl.totalSec - mine) < 0.001, `mine ${mine.toFixed(4)} s, timeline ${tl.totalSec.toFixed(4)} s, beats ${tl.totalBeats}, chords ${counts.reduce((a, b) => a + b, 0)}`);
const half = buildTimeline(song, { speed: 0.5 });
rec('B3-speed-half', Math.abs(half.totalSec - 2 * mine) < 0.001 && Math.abs(half.events[100].startSec - 2 * tl.events[100].startSec) < 1e-9, `${half.totalSec.toFixed(3)} vs ${(2 * mine).toFixed(3)}`);
// every event start recomputed independently
let cursor = 0; let maxErr = 0; let k = 0;
song.sections.forEach((s, si) => { for (const l of s.lines) for (const c of l.chords) { maxErr = Math.max(maxErr, Math.abs(tl.events[k].startSec - cursor)); cursor += (c.beats * 60) / want[si]; k++; } });
rec('B2-every-event-start', maxErr < 1e-9, `max err ${maxErr}`);
console.log('boundary Verse1->Chorus at', tl.sections[1].startSec.toFixed(3), 's; section starts', tl.sections.map((s) => s.startSec.toFixed(1)).join(' '), 'total', tl.totalSec.toFixed(1));

// ---- binary search at the edges
const ev = tl.events;
let bad = 0;
for (let i = 0; i < ev.length; i++) {
  if (eventIndexAtTime(tl, ev[i].startSec) !== i) bad++;
  if (i > 0 && eventIndexAtTime(tl, ev[i].startSec - 1e-9) !== i - 1) bad++;
}
rec('lookup-edges', bad === 0 && eventIndexAtTime(tl, -0.01) === -1 && eventIndexAtTime(tl, tl.totalSec + 5) === ev.length - 1, `${bad} wrong`);

// ---- C2: scheduler core, 5 minutes with a fake clock with jitter; grid must be exact
function simulate(timeline, { fromIndex = 0, offsetSec = 0, originCtx = 100, spanSec = 300, jitter = 0.03 }) {
  const core = createSchedulerCore({ beats: timeline.beats });
  core.start({ fromIndex, offsetSec, originCtx });
  let now = originCtx - 0.1;
  const got = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  while (now < originCtx + spanSec) {
    got.push(...core.pull(now));
    now += 0.025 + rnd() * jitter; // timer 25 ms late by up to `jitter`
  }
  return got;
}
const sim = simulate(tl, { spanSec: 300 });
const endIdx = tl.beats.findIndex((b) => b.timeSec > 300);
const expectedCount = endIdx === -1 ? tl.beats.length : endIdx;
let gridErr = 0; let dup = 0; let skipped = 0;
for (let i = 0; i < sim.length; i++) {
  const b = tl.beats[sim[i].index];
  gridErr = Math.max(gridErr, Math.abs(sim[i].when - (100 + b.timeSec)));
  if (i > 0) { if (sim[i].index === sim[i - 1].index) dup++; else if (sim[i].index !== sim[i - 1].index + 1) skipped += sim[i].index - sim[i - 1].index - 1; }
  if (sim[i].accent !== (b.beatInBar === 0)) gridErr = Infinity;
}
rec('C2-5min-grid-clean-clock', sim.length >= expectedCount - 2 && gridErr < 1e-9 && dup === 0 && skipped === 0, `${sim.length} clicks (${expectedCount} in 300 s), max grid err ${gridErr}, dup ${dup}, skipped ${skipped}`);
// stalled timer: 90 ms stall is still safe (lookahead 100 ms), 160 ms stall loses clicks
const _unused = (ms) => {
  const core = createSchedulerCore({ beats: tl.beats });
  core.start({ fromIndex: 0, offsetSec: 0, originCtx: 100 });
  let now = 99.9; const got = [];
  while (now < 130) { got.push(...core.pull(now)); now += now > 110 && now < 110.5 ? ms / 1000 : 0.025; }
  const exp = tl.beats.filter((b) => b.timeSec <= 30).length;
  return { got: got.length, exp };
};
const worst = (ms) => { let lost = 0; for (let k = 0; k < 40; k++) { const core = createSchedulerCore({ beats: tl.beats }); core.start({ fromIndex: 0, offsetSec: 0, originCtx: 100 }); let now = 99.9; const got = []; let stalled = false; while (now < 130) { got.push(...core.pull(now)); if (!stalled && now > 110 + k * 0.0243) { now += ms / 1000; stalled = true; } else now += 0.025; } lost = Math.max(lost, tl.beats.filter((b) => b.timeSec <= 30).length - got.length); } return lost; };
rec('C2-stall-90ms-no-loss', worst(90) === 0, 'max clicks lost over 40 phases: ' + worst(90));
console.log('INFO C2 timer stall 200 ms: max clicks lost over 40 phases =', worst(200), '; 400 ms =', worst(400));

// ---- C3/C4: count-in and tempo change at section boundary, on the pure grid
const b0 = tl.sections[1].startBeat;
const iv = (i) => tl.beats[i + 1].timeSec - tl.beats[i].timeSec;
rec('C4-interval-change-at-boundary', Math.abs(iv(b0 - 1) - 60 / 62) < 1e-9 && Math.abs(iv(b0) - 60 / 96) < 1e-9 && Math.abs(tl.beats[b0].timeSec - tl.sections[1].startSec) < 1e-9, `${iv(b0 - 1).toFixed(4)} -> ${iv(b0).toFixed(4)}`);
rec('C3-downbeat-pattern', tl.beats.every((b) => b.isDownbeat === (b.beatInBar === 0)) && tl.sections.every((s) => tl.beats[s.startBeat].beatInBar === 0 && tl.beats[s.startBeat].isDownbeat), 'beatInBar restarts at 0 per section');

// ---- E4: tap quantization with controlled timings (pure)
function tapRun(secIdx, jitterMs, { dbl = false, miss = -1 } = {}) {
  const t = buildTimeline(song);
  const first = t.events.findIndex((e) => e.sectionIndex === secIdx);
  const n = t.events.filter((e) => e.sectionIndex === secIdx).length;
  const spb = 60 / t.sections[secIdx].bpm;
  // The user taps every 4 beats (the default durations) = the exact start of chord k+1
  const taps = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 1; k <= n - 1; k++) {
    if (k === miss) continue;
    const j = jitterMs ? (rnd() * 2 - 1) * jitterMs / 1000 : 0;
    taps.push(t.events[first + k].startSec + j);
    if (dbl && k === 3) taps.push(t.events[first + k].startSec + j + 0.06);
  }
  return { out: quantizeTaps({ tapTimesSec: taps, timeline: t, firstEventIndex: first, eventCount: n, endTimeSec: t.events[first + n - 1].startSec + 4 * spb }), n };
}
for (const [sec, bpm] of [[0, 62], [2, 142]]) {
  for (const j of [0, 80]) {
    const r = tapRun(sec, j);
    rec(`E4-taps-${bpm}bpm-jitter${j}`, r.out.every((b) => b === 4), `n=${r.n} all 4? ${r.out.every((b) => b === 4)} distinct ${[...new Set(r.out)]}`);
  }
}
const dbl = tapRun(2, 0, { dbl: true });
rec('E4-double-tap-ignored', dbl.out.every((b) => b === 4), `distinct ${[...new Set(dbl.out)]}`);
const ms = tapRun(2, 0, { miss: 5 });
console.log('INFO E4 missed tap #5 at 142 BPM: durations', ms.out.slice(3, 8).join(','), '(a missing tap merges two chords: chord 5 gets 8, chord 6 keeps default)');
// worst case jitter: user plays 2-beat chords at 142 BPM with +-80 ms (spb 423 ms, jitter 0.19 beat)
{
  const t = buildTimeline(song);
  const first = t.events.findIndex((e) => e.sectionIndex === 2);
  const spb = 60 / 142;
  const taps = []; let pos = 0; let seed = 99; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const durs = [2, 1, 3, 1, 1, 2, 4, 2, 2, 1, 1, 4];
  for (const d of durs) { pos += d; taps.push(t.events[first].startSec + pos * spb + (rnd() * 2 - 1) * 0.08); }
  const out = quantizeTaps({ tapTimesSec: taps.slice(0, -1), timeline: t, firstEventIndex: first, eventCount: durs.length, endTimeSec: taps[taps.length - 1] });
  rec('E4-varied-durations-with-jitter', out.every((b, i) => b === durs[i]), `want ${durs} got ${out}`);
}
// tempo-change span: recording across Chorus->Verse 2 boundary (record whole song subset)
{
  const t = buildTimeline(song);
  const first = t.events.findIndex((e) => e.sectionIndex === 0) + 30; // 5 chords of Verse 1, then Chorus
  const n = 5 + 16 + 4;
  const taps = []; for (let k = 1; k < n; k++) taps.push(t.events[first + k].startSec - t.events[first].startSec + t.events[first].startSec + 0.05);
  const out = quantizeTaps({ tapTimesSec: taps, timeline: t, firstEventIndex: first, eventCount: n });
  rec('E4-across-tempo-change', out.every((b) => b === 4), `distinct ${[...new Set(out)]}`);
}
// ---- tap tempo: 8 taps at 500 ms -> 120
const tt = createTapTempo(); let r = null; for (let i = 0; i < 8; i++) r = tt.tap(i * 0.5);
rec('D4-tap-tempo-core', r === 120, String(r));
const tt2 = createTapTempo(); let r2 = null; for (let i = 0; i < 4; i++) r2 = tt2.tap(i * 0.5); tt2.tap(10); r2 = tt2.tap(10.4);
rec('D4-tap-tempo-reset-after-2s', r2 === 150, String(r2));
console.log(fails ? `${fails} FAILURES` : 'all passed');
process.exit(fails ? 1 : 0);
