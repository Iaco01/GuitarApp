// Round 8: audio longer than the sheet (extra music, repeats). Synthetic only (tester generator).
// node test/e2e/round8-long.mjs [seed]
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeTrack } from './round7-tester-make.mjs';

const seed = Number(process.argv[2] || 3);
const base = makeTrack({ seed });
const evs = songEvents(base.song);
const pct = (a, th) => (a.length ? (100 * a.filter((v) => v <= th).length / a.length).toFixed(1) : '-');

function concat(parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const n = base.samples.length;
const sr = base.sampleRate;
const cases = [];
cases.push({ name: 'x1 (control)', tr: base, copies: [base.truth.map((t) => [t])] });
// repeated material at the end: first part of the song again (truth stays at the first copy)
for (const f of [1.25, 1.35]) {
  const extra = base.samples.subarray(0, Math.floor((f - 1) * n));
  cases.push({ name: `x${f} (start repeated at the end)`, tr: { ...base, samples: concat([base.samples, extra]) } });
}
cases.push({ name: 'x2 (song twice)', tr: { ...base, samples: concat([base.samples, base.samples]) }, twice: n / sr });
cases.push({ name: 'x1.5 (song and a half)', tr: { ...base, samples: concat([base.samples, base.samples.subarray(0, n >> 1)]) } });
// a whole section played one or two extra times in the middle (splice of the audio, truth shifts after it)
function splice(si, copies) {
  const idx = evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0);
  const t0 = base.truth[idx[0]];
  const t1 = base.truth[idx[idx.length - 1] + 1];
  const a = Math.floor(t0 * sr);
  const b = Math.floor(t1 * sr);
  const parts = [base.samples.subarray(0, b)];
  for (let k = 0; k < copies; k++) parts.push(base.samples.subarray(a, b));
  parts.push(base.samples.subarray(b));
  const L = t1 - t0;
  const truthAll = base.truth.map((t, j) => (j < idx[0] ? [t] : j <= idx[idx.length - 1] ? Array.from({ length: copies + 1 }, (_, k) => t + k * L) : [t + copies * L]));
  return { tr: { ...base, samples: concat(parts), truthAll }, all: true };
}
cases.push({ name: 'Chorus (section 3) played once more', ...splice(2, 1) });
cases.push({ name: 'Bridge (section 6) played twice more', ...splice(5, 2) });
cases.push({ name: 'Outro (last section) played once more', ...splice(7, 1) });
// extra verse copy in the middle + 25 s of tail
const mid = makeTrack({ seed, extraCopies: 1, tailSec: 25 });
cases.push({ name: 'verse repeated in the middle + 25 s tail (periodic: informational)', tr: mid, all: true, info: true });
const mid2 = makeTrack({ seed, extraCopies: 2 });
cases.push({ name: 'verse repeated twice in the middle (periodic: informational)', tr: mid2, all: true, info: true });
// intro of 20 s of other music before the song (the first 20 s of the tail material)
const pre = makeTrack({ seed: seed + 1, tailSec: 0, lead: 0.5 });
cases.push({ name: '20 s of other music before + the song', tr: { ...base, samples: concat([pre.samples.subarray(0, Math.floor(20 * sr)), base.samples]) }, shift: 20 });

let fails = 0;
for (const c of cases) {
  const t0 = Date.now();
  const res = analyseAndAlign({ samples: c.tr.samples, sampleRate: sr, song: base.song });
  const ms = Date.now() - t0;
  if (!res) { console.log(`${c.name}: NULL (${ms} ms)`); fails++; continue; }
  const e = [];
  const eStable = [];
  base.truth.forEach((t, j) => {
    const cands = c.all ? c.tr.truthAll[j] : c.twice ? [t, t + c.twice] : [t + (c.shift || 0)];
    const err = Math.min(...cands.map((x) => Math.abs(res.eventStartSec[j] - x)));
    e.push(err);
    if (evs[j].section !== 3) eStable.push(err);
  });
  const gaps = (res.gaps || []).map((g) => `${g.startSec.toFixed(1)}-${g.endSec.toFixed(1)}`).join(' ');
  console.log(`${c.name}: ${ms} ms | all 250/500 ms ${pct(e, 0.25)}/${pct(e, 0.5)} | stable ${pct(eStable, 0.25)}/${pct(eStable, 0.5)} | gaps ${gaps || '-'}`);
  if (!c.info && Number(pct(eStable, 0.25)) < 90) fails++;
}
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
