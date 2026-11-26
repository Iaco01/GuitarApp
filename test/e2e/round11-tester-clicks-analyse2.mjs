// Round 11: analysis of the recorded metronome clicks (round10-tester-clicks.cjs writes test-artifacts/round-10/clicks-raw-<dev>.json):
// counts, ratios and times only. Run: node test/e2e/round11-clicks-analyse.mjs [SE|13] [synth]
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dev = process.argv[2] || 'SE';
const file = path.join(ROOT, 'test-artifacts', 'round-11', `clicks-raw-${process.argv[3] === 'synth' ? 'synth-' : ''}${dev}.json`);
const { al, tl, clicks, pairs, from, end } = JSON.parse(fs.readFileSync(file, 'utf8'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pc = pairs.map(([c, m]) => [c, m - c]);
const media = clicks.map(([when, f]) => ({ t: when + med(pc.filter(([c]) => Math.abs(c - when) < 2).map((x) => x[1])), acc: f > 900 })).filter((c) => Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
const beats = tl.beats.map(([t, d, e, s]) => ({ t, d: !!d, e, s })).filter((b) => b.t >= from + 1 && b.t <= end - 1);
// the clock mapping error: median of (click - nearest beat)
const near = (t) => { let best = null; for (const b of beats) { if (b.t > t + 1) break; if (best === null || Math.abs(b.t - t) < Math.abs(best.t - t)) best = b; } return best; };
const lags = media.map((c) => { const b = near(c.t); return b ? c.t - b.t : NaN; }).filter((v) => Math.abs(v) < 0.2);
const lag = med(lags);
const cl = media.filter((c) => c.t >= from + 1 && c.t <= end - 1).map((c) => ({ ...c, t: c.t - lag }));
const errs = cl.map((c) => { const b = near(c.t); return b ? Math.abs(c.t - b.t) : NaN; }).filter(Number.isFinite);
console.log(`clicks ${cl.length} beats of the timeline ${beats.length} (clock offset ${(lag * 1000).toFixed(0)} ms)`);
console.log(`error against the timeline beat: median ${(med(errs) * 1000).toFixed(1)} ms, p90 ${(pct(errs, 0.9) * 1000).toFixed(1)}, max ${(Math.max(...errs) * 1000).toFixed(0)}; beats without a click ${beats.filter((b) => !cl.some((c) => Math.abs(c.t - b.t) < 0.06)).length}, clicks without a beat ${cl.filter((c) => !beats.some((b) => Math.abs(c.t - b.t) < 0.06)).length}`);
// intervals in the stable sections (from the clicks), relative to the median of the section
let iv = 0, o15 = 0, o25 = 0, o40 = 0;
tl.sec.forEach(([s, e, bpm], si) => {
  if (!(al.sections[si] && Number.isFinite(al.sections[si].bpm))) return;
  const cs = cl.filter((c) => c.t >= s - 0.05 && c.t < e);
  const d = cs.slice(1).map((c, i) => c.t - cs[i].t);
  const m = med(d);
  d.forEach((v) => { iv++; if (Math.abs(v / m - 1) > 0.15) o15++; if (Math.abs(v / m - 1) > 0.25) o25++; if (Math.abs(v / m - 1) > 0.4) o40++; });
});
console.log(`intervals in the stable sections: ${iv}; beyond +-15% ${o15} (${((100 * o15) / iv).toFixed(1)}%), +-25% ${o25}, +-40% ${o40}`);
let close = 0;
for (let i = 1; i < cl.length; i++) { const b = near(cl[i].t); const per = b ? 60 / Math.max(60, (tl.sec[b.s] || [0, 0, 100])[2] || 100) : 0.43; if (cl[i].t - cl[i - 1].t < 0.6 * per) close++; }
console.log(`clicks closer than 0.6 beat to the previous: ${close}`);
// ticks per chord: the clicks heard in each chord against the ticks of the timeline
let exact = 0, tot = 0;
tl.ev.forEach(([s, d, n, si, sk], j) => { if (sk || s < from + 1 || s + d > end - 1) return; tot++; const c = cl.filter((x) => x.t >= s - 0.04 && x.t < s + d - 0.04).length; if (c === n) exact++; });
console.log(`chords whose heard clicks equal the ticks of the timeline: ${exact}/${tot}`);
const accents = cl.filter((c) => c.acc).length;
console.log(`accents ${accents}; last click ${cl.length ? cl[cl.length - 1].t.toFixed(2) : '-'} s, music ends ${al.musicEndSec}, window ${from}-${end}`);
