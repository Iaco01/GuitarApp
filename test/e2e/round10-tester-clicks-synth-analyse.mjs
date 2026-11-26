// Round 10 tester, A2/A3: synthetic song with chords of 1,2,3,4,8 quarters: exact click count per chord and click time error
// against the true beat grid (stable sections); free-tempo section: count and spacing. Input: clicks-raw-synth-<dev>.json
// Run: node test/e2e/round10-tester-make.mjs && node test/e2e/round10-tester-clicks.cjs SE 0 1000 synth && node test/e2e/round10-tester-clicks-synth-analyse.mjs [SE]
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dev = process.argv[2] || 'SE';
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-artifacts', 'round-10', `clicks-raw-synth-${dev}.json`), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-artifacts', 'round-10', 'synth', 'r10-truth.json'), 'utf8')).events;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pc = raw.pairs.map(([c, m]) => [c, m - c]);
const clicks = raw.clicks.map(([when, f]) => { const near = pc.filter(([c]) => Math.abs(c - when) < 2).map((x) => x[1]); return { t: when + med(near), acc: f > 900 }; }).filter((c) => Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
const out = []; const P = (s) => { out.push(s); console.log(s); };
const free = new Set(truth.filter((e) => e.bpm === null).map((e) => e.section));
// chord-level
let exact = 0, tot = 0; const bad = [];
const errs = [];
truth.forEach((e, i) => {
  const end = i + 1 < truth.length ? truth[i + 1].t0 : e.t0 + e.dur;
  const cl = clicks.filter((c) => c.t >= e.t0 - 0.06 && c.t < end - 0.06);
  const isFree = e.bpm === null;
  if (!isFree) {
    tot++;
    if (cl.length === e.beats) exact++; else bad.push(`#${i} ${e.name} sec${e.section + 1} true ${e.beats} got ${cl.length}`);
    cl.forEach((c) => { const b = Math.round((c.t - e.t0) / (60 / e.bpm)); errs.push(c.t - (e.t0 + b * 60 / e.bpm)); });
  }
});
const lag = med(errs); const adj = errs.map((x) => Math.abs(x - lag));
P(`stable chords ${tot}: exact click count ${exact}/${tot}; mismatches: ${bad.join('; ') || 'none'}`);
const s = [...adj].sort((a, b) => a - b);
P(`click time error vs true beat grid (clock bias ${(lag * 1000).toFixed(0)} ms removed): median ${(med(adj) * 1000).toFixed(0)} ms, 90% ${(s[Math.floor(s.length * .9)] * 1000).toFixed(0)} ms, max ${(s[s.length - 1] * 1000).toFixed(0)} ms; over 30 ms: ${adj.filter((x) => x > 0.03).length}/${adj.length}; raw (no bias removal) median ${(med(errs.map(Math.abs)) * 1000).toFixed(0)} ms`);
// per truth chord of the free section
const fr = truth.filter((e) => e.bpm === null);
if (fr.length) {
  const t0 = fr[0].t0, t1 = fr[fr.length - 1].t0 + fr[fr.length - 1].dur;
  const cl = clicks.filter((c) => c.t >= t0 && c.t < t1);
  const iv = cl.slice(1).map((c, i) => c.t - cl[i].t).filter((d) => d < 3);
  P(`free-tempo section ${t0.toFixed(1)}-${t1.toFixed(1)} s (${(t1 - t0).toFixed(1)} s, ${fr.length} chords of ${fr.map((e) => e.dur.toFixed(2)).join('/')} s): ${cl.length} clicks, spacing median ${(med(iv) * 1000).toFixed(0)} ms, min ${(Math.min(...iv) * 1000).toFixed(0)}, max ${(Math.max(...iv) * 1000).toFixed(0)}; clicks per chord ${fr.map((e, i) => clicks.filter((c) => c.t >= e.t0 - 0.06 && c.t < (fr[i + 1] ? fr[i + 1].t0 : t1) - 0.06).length).join('/')}`);
}
const al = raw.al; P(`alignment: section bpm ${al.sections.map((x) => (x.bpm === null ? 'free' : x.bpm.toFixed(1))).join(' ')}; eventBeats ${JSON.stringify(al.eventBeats)}`);
P(`measured vs truth eventBeats mismatches (stable): ${truth.filter((e, i) => e.bpm !== null && al.eventBeats[i] !== e.beats).map((e, i) => `#${truth.indexOf(e)} true ${e.beats} meas ${al.eventBeats[truth.indexOf(e)]}`).join('; ') || 'none'}`);
fs.writeFileSync(path.join(ROOT, 'test-artifacts', 'round-10', `clicks-synth-analysis-${dev}.txt`), out.join('\n'));
