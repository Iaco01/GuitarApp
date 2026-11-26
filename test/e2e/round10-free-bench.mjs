// Round 10: calibration of the colours of the free-tempo sections (no stable beat) on three benches with known truth:
// the round 9 tester's (B4: arpeggio with shared notes, held chords, rare chords), the round 8 tester's (round8-tester-b)
// and the implementer's (round8-confidence). Collects, for every section without a stable beat, its confidence and how many
// of its changes are within 250 ms of the truth; then prints the table for the thresholds of the colours.
//   node test/e2e/round10-free-bench.mjs collect [out.json]    (a few minutes)
//   node test/e2e/round10-free-bench.mjs table [in.json]       (the table for the current thresholds and a sweep)
import { writeFileSync, readFileSync } from 'node:fs';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, CONF_YELLOW_FREE } from '../../src/alignment.js';
import { makeBench } from './round8-tester-bench.mjs';
import { makeTrack } from './round7-tester-make.mjs';
import { makeRealistic } from '../fixtures/make-realistic.mjs';

const [mode = 'table', file = 'test-artifacts/round-10/free-rows.json'] = process.argv.slice(2);
const S = (name, kind, bpm, chords) => ({ name, kind, bpm, chords });

function collect() {
  const rows = [];
  const add = (src, tag, res, truthOf, evs, secKind) => {
    const per = new Map();
    evs.forEach((e, j) => {
      const t = truthOf(j);
      if (t === null || t === undefined) return;
      const p = per.get(e.section) || { n: 0, ok: 0, evs: [] };
      const good = Math.abs(res.eventStartSec[j] - t) <= 0.25;
      p.n++; if (good) p.ok++;
      p.evs.push([Math.round(res.confidence[j] * 1000) / 1000, good ? 1 : 0, Math.round((res.sharpness ? res.sharpness[j] : 0) * 100) / 100]);
      per.set(e.section, p);
    });
    per.forEach((p, si) => {
      const s = res.sections[si];
      if (s.bpm !== null || s.skipped) return;
      rows.push({ src, tag, si, kind: secKind ? secKind(si) : null, conf: s.confidence, n: p.n, ok: p.ok, evs: p.evs });
    });
  };
  // 1. round 9 tester, B4
  const stable = [['C', 4], ['Am', 4], ['Em', 4], ['G', 4], ['C', 4], ['Am', 4], ['F', 4], ['G', 4]];
  const shared = [['Am', 4], ['C', 4], ['Am', 4], ['F', 4], ['C', 4], ['Em', 4], ['G', 4], ['Em', 4]];
  const held = [['Em', 8], ['A', 8], ['D', 8], ['G', 8], ['Em', 8]];
  const rare = [['Em', 4], ['D', 12], ['C', 4], ['G', 16], ['Am', 4]];
  const defs = [
    ['arp-shared', (k) => [S('A1' + k, 'free', null, shared), S('T1', 'stable', 100, stable), S('A2' + k, 'free', null, shared.slice().reverse())]],
    ['rubato', (k) => [S('R1' + k, 'rubato', 90, stable), S('T2', 'stable', 110, stable), S('R2' + k, 'rubato', 120, stable)]],
    ['held', (k) => [S('H1' + k, 'free', null, held), S('T3', 'stable', 100, stable), S('H2' + k, 'free', null, held.slice(1))]],
    ['voice-rare', (k) => [S('V1' + k, 'free', null, rare), S('T4', 'stable', 120, stable), S('V2' + k, 'free', null, rare.slice().reverse())]],
  ];
  for (const [id, mk] of defs) for (const seed of [41, 52, 67, 15, 23, 88, 101, 127]) {
    const secs = mk(seed); const b = makeBench(secs, { seed });
    const res = analyseAndAlign({ samples: b.samples, sampleRate: b.sampleRate, song: b.song });
    add('B4:' + id, seed, res, (j) => b.truth[j], songEvents(b.song), (si) => secs[si].kind);
  }
  // 2. round 8 tester
  const hard = [['C', 4], ['Am', 4], ['Em', 4], ['G', 4], ['C', 4], ['Am', 4], ['F', 4], ['G', 4]];
  const hard2 = [['Am', 4], ['C', 4], ['Em', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['Em', 4]];
  const rapidA = [['C', 1], ['G', 1], ['Am', 1], ['Em', 1], ['F', 1], ['C', 1], ['G', 1], ['G', 1], ['Dm', 1], ['Am', 1], ['C', 1], ['G', 1]];
  const rapidB = [['Em', 2], ['G', 1], ['D', 1], ['Em', 1], ['C', 1], ['Am', 2], ['D', 1], ['G', 1], ['C', 1], ['Em', 1]];
  const free = [['Em', 4], ['A', 4], ['D', 4], ['G', 4], ['Bm', 4], ['E', 4]];
  const free2 = [['C', 4], ['Dm', 4], ['G', 4], ['Am', 4], ['F', 4]];
  const TRACKS = [
    { id: 'rapid', secs: [S('R1', 'rapid', 100, rapidA), S('R2', 'rapid', 120, rapidB), S('R3', 'rapid', 90, rapidA), S('R4', 'rapid', 140, rapidB), S('R5', 'stable', 100, hard)], opt: {} },
    { id: 'free-arp', secs: [S('F1', 'free', null, free), S('S1', 'stable', 100, hard), S('F2', 'free', null, free2), S('S2', 'stable', 120, hard2), S('F3', 'free', null, free), S('F4', 'free', null, free2)], opt: {} },
    { id: 'rubato', secs: [S('B1', 'rubato', 90, hard), S('B2', 'rubato', 110, hard2), S('B3', 'rubato', 100, hard), S('B4', 'stable', 120, hard2), S('B5', 'rubato', 80, hard2), S('B6', 'rubato', 130, hard)], opt: {} },
    { id: 'rubato-snr10', secs: [S('Q1', 'rubato', 100, hard), S('Q2', 'free', null, free), S('Q3', 'rapid', 110, rapidA), S('Q4', 'stable', 100, hard2), S('Q5', 'rapid', 100, rapidB)], opt: { snrDb: 10 } },
    { id: 'hard-snr3', secs: [S('M1', 'stable', 90, hard), S('M2', 'stable', 110, hard2), S('M3', 'stable', 130, hard), S('M4', 'stable', 100, hard2), S('M5', 'stable', 120, hard)], opt: { snrDb: 3 } },
  ];
  for (const tr of TRACKS) for (const seed of [3, 14, 27, 33, 45]) {
    const b = makeBench(tr.secs, { seed, ...tr.opt });
    const res = analyseAndAlign({ samples: b.samples, sampleRate: b.sampleRate, song: b.song });
    add('R8T:' + tr.id, seed, res, (j) => b.truth[j], songEvents(b.song), (si) => tr.secs[si].kind);
  }
  // 3. implementer's
  for (const seed of [3, 11, 29]) {
    const t = makeTrack({ seed });
    for (const variant of ['clean', 'slowdecay']) {
      const tr = variant === 'clean' ? t : makeTrack({ seed, freeTau: 0.4, voice: true });
      const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
      add('R8I:tester-' + variant, seed, res, (j) => tr.truth[j], songEvents(tr.song), null);
    }
  }
  for (const seed of [1, 2, 3, 4]) {
    const r = makeRealistic({ preset: 'long', seed });
    const res = analyseAndAlign({ samples: r.samples, sampleRate: r.sampleRate, song: r.song });
    add('R8I:real-gen', seed, res, (j) => (r.truth.eventIsRest[j] ? null : r.truth.eventStartSec[j]), songEvents(r.song), null);
  }
  return rows;
}

function table(rows) {
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
  const stat = (rs) => { const n = rs.reduce((a, r) => a + r.n, 0); const ok = rs.reduce((a, r) => a + r.ok, 0); return `${String(rs.length).padStart(3)} sections ${String(n).padStart(4)} changes ${pct(ok, n).padStart(6)} within 250 ms`; };
  const sources = ['B4', 'R8T', 'R8I'];
  const cols = ['yellow', 'red'];
  const state = (r, y) => (r.conf >= y ? 'yellow' : 'red');
  const sweep = [CONF_YELLOW_FREE, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
  for (const y of [...new Set(sweep)].sort((a, b) => a - b)) {
    console.log(`\nfree yellow from ${y}${y === CONF_YELLOW_FREE ? ' (current)' : ''}`);
    for (const src of ['all', ...sources]) {
      const rs = rows.filter((r) => src === 'all' || r.src.startsWith(src));
      console.log(`  ${src.padEnd(4)} ` + cols.map((c) => `${c}: ${stat(rs.filter((r) => state(r, y) === c))}`).join(' | '));
    }
  }
  console.log('\nsection confidence -> share within 250 ms (all benches)');
  for (const [a, b] of [[0, 0.1], [0.1, 0.2], [0.2, 0.25], [0.25, 0.3], [0.3, 0.35], [0.35, 0.4], [0.4, 0.45], [0.45, 0.5], [0.5, 0.56]]) console.log(`  ${a.toFixed(2)}-${b.toFixed(2)}: ${stat(rows.filter((r) => r.conf >= a && r.conf < b))}`);
}

if (mode === 'collect') { const rows = collect(); writeFileSync(file, JSON.stringify(rows)); console.log('saved', rows.length, 'free sections to', file); table(rows); }
else table(JSON.parse(readFileSync(file, 'utf-8')));
