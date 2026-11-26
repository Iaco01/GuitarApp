// Round 10 tester, A1: per-chord analysis of the recorded metronome clicks (see round10-tester-clicks.cjs).
// Prints counts, ratios and section names only. Run: node test/e2e/round10-tester-clicks-analyse.mjs [SE|13]
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dev = process.argv[2] || 'SE';
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-artifacts', 'round-10', `clicks-raw-${dev}.json`), 'utf8'));
const { al, tl, clicks, pairs } = raw;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
// media time of a click: ctx time + median (media - ctx) of the pairs within 2 s
const pc = pairs.map(([c, m]) => [c, m - c]);
const media = clicks.map(([when, f]) => { const near = pc.filter(([c]) => Math.abs(c - when) < 2).map((x) => x[1]); return { t: when + med(near), acc: f > 900, when }; }).filter((c) => Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
const skipped = new Set(al.skipped || []);
const N = al.eventStartSec.length;
const gapBefore = new Map((al.gaps || []).map((g) => [g.before, g]));
// section of each event from the timeline
const secOf = tl.ev.map((e) => e[3]);
const present = [...Array(N).keys()].filter((j) => !skipped.has(j));
const bpmOf = (si) => { const b = al.sections[si] && al.sections[si].bpm; if (Number.isFinite(b)) return b; for (let d = 1; d < al.sections.length; d++) for (const s of [si - d, si + d]) if (al.sections[s] && Number.isFinite(al.sections[s].bpm)) return al.sections[s].bpm; return 120; };
const rows = present.map((j, k) => {
  const start = al.eventStartSec[j];
  const next = present[k + 1];
  let end = next !== undefined ? al.eventStartSec[next] : al.endSec;
  const g = next !== undefined ? gapBefore.get(next) : null;
  if (g) end = Math.min(end, g.startSec);
  const si = secOf[j];
  return { j, si, start, end, dur: end - start, free: !Number.isFinite(al.sections[si].bpm), bpm: bpmOf(si), eb: al.eventBeats ? al.eventBeats[j] : null };
});
// global lag between a chord start and its first click (clock mapping error) from chords with a click within 80 ms
const lags = [];
for (const r of rows) { const c = media.find((c) => c.t >= r.start - 0.08 && c.t < r.start + 0.12); if (c) lags.push(c.t - r.start); }
const lag = med(lags);
for (const r of rows) {
  r.clicks = media.filter((c) => c.t - lag >= r.start - 0.02 && c.t - lag < r.end - 0.02);
  r.q = (r.dur * r.bpm) / 60;
  r.n = r.clicks.length;
}
const covered = rows.filter((r) => r.end <= raw.end && r.start >= raw.from);
const statBy = (arr) => {
  const d = {}; arr.forEach((r) => { const k = r.n - Math.round(r.q); d[k] = (d[k] || 0) + 1; }); return d;
};
const out = [];
const P = (s) => { out.push(s); console.log(s); };
const sl = [...lags].sort((a, b) => a - b); const iqr = sl[Math.floor(sl.length * 0.75)] - sl[Math.floor(sl.length * 0.25)];
P(`device ${dev}: ${clicks.length} oscillators, ${pairs.length} clock pairs, ${media.length} mapped, clock lag chord-start to first-click median ${(lag * 1000).toFixed(0)} ms (IQR ${(iqr * 1000).toFixed(0)} ms)`);
P(`chords present ${present.length} (skipped ${skipped.size}), covered by the playback ${covered.length}`);
P(`ticks - round(quarters) over all chords: ${JSON.stringify(statBy(covered))}`);
const stable = covered.filter((r) => !r.free), free = covered.filter((r) => r.free);
P(`stable chords ${stable.length}: ticks-round(q) ${JSON.stringify(statBy(stable))}; free-tempo chords ${free.length}: ${JSON.stringify(statBy(free))}`);
const more = covered.filter((r) => r.n > r.q + 0.5 + 1e-9);
P(`chords with more ticks than their quarters (n > q+0.5): ${more.length} (stable ${more.filter((r) => !r.free).length}, free ${more.filter((r) => r.free).length}); worst excess ${Math.max(0, ...covered.map((r) => r.n - r.q)).toFixed(2)}`);
const fewer = covered.filter((r) => r.n < r.q - 0.5 - 1e-9);
P(`chords with fewer ticks than their quarters (n < q-0.5): ${fewer.length}`);
P(`chords with ZERO ticks: ${covered.filter((r) => r.n === 0).length}`);
// spacing
let close = 0, closeBoundary = 0, sp = [], totalInt = 0;
const perSec = {};
for (let i = 1; i < media.length; i++) {
  const d = media[i].t - media[i - 1].t; if (d > 3) continue;
  const mid = (media[i].t + media[i - 1].t) / 2 - lag; const r = rows.find((r) => mid >= r.start && mid < r.end);
  const bpm = r ? r.bpm : 120; const beat = 60 / bpm; totalInt++;
  sp.push(d / beat);
  if (d < 0.6 * beat) { close++; if (r && (media[i - 1].t - lag < r.start || media[i].t - lag >= r.end)) closeBoundary++; }
  if (r) { (perSec[r.si] = perSec[r.si] || []).push(d / beat); }
}
P(`tick intervals ${totalInt}: closer than 0.6 beat: ${close} (at a chord boundary: ${closeBoundary}); median interval ${(med(sp)).toFixed(3)} beat; 5%/95% ${[...sp].sort((a, b) => a - b)[Math.floor(sp.length * .05)].toFixed(3)} / ${[...sp].sort((a, b) => a - b)[Math.floor(sp.length * .95)].toFixed(3)}; > 1.4 beat: ${sp.filter((x) => x > 1.4).length}`);
// per section
P('section | bpm | free | chords | ticks | median interval (beats) | min | max | accents');
const secs = [...new Set(covered.map((r) => r.si))];
for (const si of secs) {
  const rs = covered.filter((r) => r.si === si); const ticks = rs.reduce((a, r) => a + r.n, 0); const iv = perSec[si] || [];
  const cl = rs.flatMap((r) => r.clicks);
  const accIdx = cl.map((c, i) => (c.acc ? i : -1)).filter((i) => i >= 0);
  const gaps = accIdx.slice(1).map((v, i) => v - accIdx[i]);
  const q = rs.reduce((a, r) => a + r.q, 0);
  P(`${si + 1} | ${rs[0].bpm.toFixed(1)} | ${rs[0].free ? 'free' : 'stable'} | ${rs.length} | ${ticks} (quarters ${q.toFixed(1)}) | ${iv.length ? med(iv).toFixed(3) : '-'} | ${iv.length ? Math.min(...iv).toFixed(2) : '-'} | ${iv.length ? Math.max(...iv).toFixed(2) : '-'} | ${accIdx.length} accents, gaps ${JSON.stringify(gaps.reduce((d, g) => { d[g] = (d[g] || 0) + 1; return d; }, {}))}`);
}
// accents vs timeline downbeats
const down = tl.beats.filter((b) => b[1]).map((b) => b[0]);
let accOk = 0, accTot = 0, accOnDown = 0;
for (const c of media) { if (!c.acc) continue; accTot++; if (down.some((d) => Math.abs(d - (c.t - lag)) < 0.06)) accOnDown++; }
P(`accented clicks ${accTot}, on a timeline downbeat ${accOnDown}`);
// double ticks at chord boundaries (< 0.6 beat apart across the boundary): counted above. Also chords of 1.. quarters distribution
const dist = {}; covered.forEach((r) => { const k = Math.round(r.q); dist[k] = (dist[k] || 0) + 1; });
P(`quarters per chord (rounded): ${JSON.stringify(dist)}`);
const worst = covered.filter((r) => r.n > r.q + 0.5 || r.n < r.q - 0.5 || r.n === 0).slice(0, 12).map((r) => `s${r.si + 1}#${r.j} q=${r.q.toFixed(2)} n=${r.n} dur=${r.dur.toFixed(2)}${r.free ? ' free' : ''}`);
P('examples of mismatches: ' + worst.join('; '));
fs.writeFileSync(path.join(ROOT, 'test-artifacts', 'round-10', `clicks-analysis-${dev}.txt`), out.join('\n'));
// evenness: share of tick intervals that differ from one beat by more than 15% / 25% (stable sections), and chords whose length is not a whole number of quarters
{
  const stableSecs = new Set(covered.filter((r) => !r.free).map((r) => r.si));
  const ivs = [];
  for (let i = 1; i < media.length; i++) {
    const d = media[i].t - media[i - 1].t; if (d > 3) continue;
    const mid = (media[i].t + media[i - 1].t) / 2 - lag; const r = rows.find((r) => mid >= r.start && mid < r.end);
    if (r && !r.free) ivs.push(d / (60 / r.bpm));
  }
  const o15 = ivs.filter((v) => Math.abs(v - 1) > 0.15).length, o25 = ivs.filter((v) => Math.abs(v - 1) > 0.25).length, o40 = ivs.filter((v) => Math.abs(v - 1) > 0.4).length;
  P(`evenness (stable sections, ${ivs.length} intervals): off by >15%: ${o15} (${((100 * o15) / ivs.length).toFixed(0)}%), >25%: ${o25} (${((100 * o25) / ivs.length).toFixed(0)}%), >40%: ${o40}`);
  const nonInt = stable.filter((r) => Math.abs(r.q - Math.round(r.q)) > 0.25).length;
  P(`stable chords whose length is >0.25 quarter away from a whole number of quarters: ${nonInt}/${stable.length}`);
  const odd = stable.filter((r) => [3, 5, 7].includes(Math.round(r.q))).length;
  P(`stable chords of 3, 5 or 7 quarters: ${odd}/${stable.length}`);
  const fr = covered.filter((r) => r.free); const ivf = [];
  for (let i = 1; i < media.length; i++) { const d = media[i].t - media[i - 1].t; if (d > 3) continue; const mid = (media[i].t + media[i - 1].t) / 2 - lag; const r = rows.find((r) => mid >= r.start && mid < r.end); if (r && r.free) ivf.push(d / (60 / r.bpm)); }
  const sf = [...ivf].sort((a, b) => a - b);
  P(`free-tempo sections (${ivf.length} intervals): median ${med(ivf).toFixed(3)} beat, 5%/95% ${sf[Math.floor(sf.length * .05)].toFixed(2)}/${sf[Math.floor(sf.length * .95)].toFixed(2)}, off by >25%: ${ivf.filter((v) => Math.abs(v - 1) > 0.25).length}`);
}
