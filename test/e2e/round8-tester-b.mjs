// Round 8 tester B: confidence calibration on my own bench (>= 40 sections incl. free tempo with arpeggio, rubato, rapid
// changes, chords that share notes, strong noise, 1-beat chords).  Table state/colour -> share within 250 ms, wrong greens,
// rank correlation of event confidence vs error.   node test/e2e/round8-tester-b.mjs [--quick]
import { writeFileSync } from 'node:fs';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeBench } from './round8-tester-bench.mjs';

const quick = process.argv.includes('--quick');
const S = (name, kind, bpm, chords) => ({ name, kind, bpm, chords });
const hard = [['C', 4], ['Am', 4], ['Em', 4], ['G', 4], ['C', 4], ['Am', 4], ['F', 4], ['G', 4]]; // shared notes
const hard2 = [['Am', 4], ['C', 4], ['Em', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['Em', 4]];
const rapidA = [['C', 1], ['G', 1], ['Am', 1], ['Em', 1], ['F', 1], ['C', 1], ['G', 1], ['G', 1], ['Dm', 1], ['Am', 1], ['C', 1], ['G', 1]];
const rapidB = [['Em', 2], ['G', 1], ['D', 1], ['Em', 1], ['C', 1], ['Am', 2], ['D', 1], ['G', 1], ['C', 1], ['Em', 1]];
const free = [['Em', 4], ['A', 4], ['D', 4], ['G', 4], ['Bm', 4], ['E', 4]];
const free2 = [['C', 4], ['Dm', 4], ['G', 4], ['Am', 4], ['F', 4]];
const TRACKS = [
  { id: 'hard-clean', secs: [S('H1', 'stable', 84, hard), S('H2', 'stable', 100, hard2), S('H3', 'stable', 120, hard), S('H4', 'stable', 140, hard2), S('H5', 'stable', 92, hard), S('H6', 'stable', 110, hard2)], opt: {} },
  { id: 'hard-snr10', secs: [S('N1', 'stable', 90, hard), S('N2', 'stable', 110, hard2), S('N3', 'stable', 130, hard), S('N4', 'stable', 100, hard2), S('N5', 'stable', 120, hard)], opt: { snrDb: 10 } },
  { id: 'hard-snr3', secs: [S('M1', 'stable', 90, hard), S('M2', 'stable', 110, hard2), S('M3', 'stable', 130, hard), S('M4', 'stable', 100, hard2), S('M5', 'stable', 120, hard)], opt: { snrDb: 3 } },
  { id: 'rapid', secs: [S('R1', 'rapid', 100, rapidA), S('R2', 'rapid', 120, rapidB), S('R3', 'rapid', 90, rapidA), S('R4', 'rapid', 140, rapidB), S('R5', 'stable', 100, hard)], opt: {} },
  { id: 'free-arp', secs: [S('F1', 'free', null, free), S('S1', 'stable', 100, hard), S('F2', 'free', null, free2), S('S2', 'stable', 120, hard2), S('F3', 'free', null, free), S('F4', 'free', null, free2)], opt: {} },
  { id: 'rubato', secs: [S('B1', 'rubato', 90, hard), S('B2', 'rubato', 110, hard2), S('B3', 'rubato', 100, hard), S('B4', 'stable', 120, hard2), S('B5', 'rubato', 80, hard2), S('B6', 'rubato', 130, hard)], opt: {} },
  { id: 'rubato-snr10', secs: [S('Q1', 'rubato', 100, hard), S('Q2', 'free', null, free), S('Q3', 'rapid', 110, rapidA), S('Q4', 'stable', 100, hard2), S('Q5', 'rapid', 100, rapidB)], opt: { snrDb: 10 } },
];
const seeds = quick ? [3] : [3, 14, 27];
const rows = []; const secRows = [];
for (const tr of TRACKS) for (const seed of seeds) {
  const b = makeBench(tr.secs, { seed, ...tr.opt });
  const res = analyseAndAlign({ samples: b.samples, sampleRate: b.sampleRate, song: b.song });
  if (!res) { console.log(`${tr.id}/${seed}: null`); continue; }
  const al = makeAlignment(res, b.song);
  const evs = songEvents(b.song);
  const per = tr.secs.map(() => ({ n: 0, ok: 0, ok500: 0, maxErr: 0 }));
  evs.forEach((e, j) => {
    const err = Math.abs(res.eventStartSec[j] - b.truth[j]);
    rows.push({ track: tr.id, seed, j, kind: b.kind[j], conf: res.confidence[j], err });
    const p = per[e.section]; p.n++; if (err <= 0.25) p.ok++; if (err <= 0.5) p.ok500++; p.maxErr = Math.max(p.maxErr, err);
  });
  tr.secs.forEach((s, si) => secRows.push({ track: tr.id, seed, si, name: s.name, kind: s.kind, state: sectionState(al, si), conf: al.sections[si].confidence, bpm: al.sections[si].bpm, ...per[si], share: per[si].ok / per[si].n }));
  console.log(`${tr.id}/${seed}: ${tr.secs.map((s, si) => `${s.name}:${sectionState(al, si)[0]}${(100 * per[si].ok / per[si].n).toFixed(0)}`).join(' ')}`);
}
console.log(`\nsections: ${secRows.length}, events: ${rows.length}`);
const kinds = ['stable', 'rapid', 'rubato', 'free'];
console.log('\nstate x kind -> sections / changes / share within 250 ms / worst section');
for (const group of ['stable-beat (stable+rapid+rubato with bpm)', 'free (no stable beat)']) {
  const isFree = group.startsWith('free');
  for (const st of ['green', 'yellow', 'red']) {
    const ss = secRows.filter((s) => (s.bpm === null) === isFree && s.state === st);
    const n = ss.reduce((a, s) => a + s.n, 0), ok = ss.reduce((a, s) => a + s.ok, 0);
    const worst = ss.length ? Math.min(...ss.map((s) => s.share)) : NaN;
    console.log(`${group.padEnd(42)} ${st.padEnd(6)} ${String(ss.length).padStart(3)} sec ${String(n).padStart(4)} ch ${n ? (100 * ok / n).toFixed(1).padStart(5) + '%' : '    -'} worst ${Number.isNaN(worst) ? '-' : (100 * worst).toFixed(0) + '%'}`);
  }
}
console.log('\nby generated kind (any colour): sections / share within 250 ms / colours');
for (const k of kinds) {
  const ss = secRows.filter((s) => s.kind === k); if (!ss.length) continue;
  const n = ss.reduce((a, s) => a + s.n, 0), ok = ss.reduce((a, s) => a + s.ok, 0);
  const cnt = { green: 0, yellow: 0, red: 0 }; ss.forEach((s) => cnt[s.state]++);
  console.log(`  ${k.padEnd(7)} ${ss.length} sec ${(100 * ok / n).toFixed(1)}%  g/y/r ${cnt.green}/${cnt.yellow}/${cnt.red}  detected-as-free ${ss.filter((s) => s.bpm === null).length}`);
}
// wrong greens
console.log('\nGREEN sections with a share below 90% within 250 ms, or any change wrong by > 500 ms:');
const wg = secRows.filter((s) => s.state === 'green' && (s.share < 0.9 || s.maxErr > 0.5));
wg.forEach((s) => console.log(`  ${s.track}/${s.seed} ${s.name} (${s.kind}) conf ${s.conf} bpm ${s.bpm} share ${(100 * s.share).toFixed(0)}% max err ${s.maxErr.toFixed(2)} s`));
if (!wg.length) console.log('  none');
console.log('\nRED sections with >= 50% within 250 ms (red too pessimistic, informational): ' + secRows.filter((s) => s.state === 'red' && s.share >= 0.5).map((s) => `${s.track}/${s.seed}/${s.name}:${(100 * s.share).toFixed(0)}%`).join(' ') || 'none');
// Spearman rank correlation conf vs error
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const rk = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = rk; i = j + 1; } return r; }
function spearman(a, b) { const ra = ranks(a), rb = ranks(b); const n = a.length; const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; } return c / Math.sqrt(va * vb); }
const sub = (f) => rows.filter(f);
for (const [nm, f] of [['all events', () => true], ['stable (non-free) events', (r) => r.kind !== 'free'], ['free events', (r) => r.kind === 'free'], ['hard-snr3 track', (r) => r.track === 'hard-snr3'], ['rubato track', (r) => r.track === 'rubato']]) {
  const r = sub(f); if (r.length < 5) continue;
  console.log(`Spearman(conf, error) ${nm}: ${spearman(r.map((x) => x.conf), r.map((x) => x.err)).toFixed(3)} (n=${r.length})`);
}
// conf bins -> share within 250 ms (events)
console.log('\nevent confidence bin -> share within 250 ms (all / free only)');
for (const [a, b] of [[0, 0.2], [0.2, 0.4], [0.4, 0.55], [0.55, 0.75], [0.75, 0.9], [0.9, 1.01]]) {
  const r = rows.filter((x) => x.conf >= a && x.conf < b), rf = r.filter((x) => x.kind === 'free');
  console.log(`  ${a.toFixed(2)}-${Math.min(b, 1).toFixed(2)}: ${String(r.length).padStart(4)} ev ${r.length ? (100 * r.filter((x) => x.err <= 0.25).length / r.length).toFixed(0) : '-'}%   free ${String(rf.length).padStart(3)} ev ${rf.length ? (100 * rf.filter((x) => x.err <= 0.25).length / rf.length).toFixed(0) : '-'}%`);
}
writeFileSync(new URL('../../test-artifacts/round-8/tester-b.json', import.meta.url), JSON.stringify({ secRows, rows }));
