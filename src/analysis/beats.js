// Tempo and beat tracking on the onset envelope (pure): windowed tempogram with confidence,
// per-range tempo choice (with octave correction) and dynamic-programming beat tracking
// (Ellis 2007) inside a range of stable tempo.

import { runSteps } from './steps.js';

export const TEMPO_MIN = 55;
export const TEMPO_MAX = 210;
const TEMPO_STEP = 0.5;
const TEMPO_CENTER = 115; // weak prior, in BPM
const ACF_WEIGHTS = [1, 0.55, 0.35, 0.25];

function tempoGrid() {
  const g = [];
  for (let b = TEMPO_MIN; b <= TEMPO_MAX + 1e-9; b += TEMPO_STEP) g.push(b);
  return Float32Array.from(g);
}

// Tempogram: for every window (winSec long, one every hopSec) the "comb-ACF" score of each BPM of
// the grid: sum of the normalised autocorrelation at 1..4 beat periods.
// Returns { bpms, times, curves: Float32Array(windows * bpms.length) }.
export function tempoCurves(onset, fps, opts = {}) {
  return runSteps(tempoCurvesSteps(onset, fps, opts));
}

// Same as a generator (yields after every window: a 9 minute song is 260 of them).
export function* tempoCurvesSteps(onset, fps, { winSec = 10, hopSec = 2 } = {}) {
  const bpms = tempoGrid();
  const nb = bpms.length;
  const W = Math.round(winSec * fps);
  const hop = Math.round(hopSec * fps);
  const maxLag = Math.ceil((4 * 60 * fps) / TEMPO_MIN) + 2;
  const nWin = Math.max(1, Math.floor((onset.length - W) / hop) + 1);
  const times = new Float32Array(nWin);
  const curves = new Float32Array(nWin * nb);
  const taper = new Float64Array(W);
  for (let i = 0; i < W; i++) taper[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / W);
  const x = new Float64Array(W);
  const acf = new Float64Array(maxLag + 2);
  for (let w = 0; w < nWin; w++) {
    if (w > 0 && (w & 1) === 0) yield;
    const s0 = w * hop;
    times[w] = (s0 + W / 2) / fps;
    let mean = 0;
    for (let i = 0; i < W; i++) mean += onset[Math.min(onset.length - 1, s0 + i)] || 0;
    mean /= W;
    for (let i = 0; i < W; i++) x[i] = ((onset[s0 + i] || 0) - mean) * taper[i];
    const lagMax = Math.min(maxLag, W - 8);
    let a0 = 0;
    for (let i = 0; i < W; i++) a0 += x[i] * x[i];
    if (a0 < 1e-9) continue;
    for (let l = 0; l <= lagMax; l++) {
      let s = 0;
      for (let i = 0; i + l < W; i++) s += x[i] * x[i + l];
      acf[l] = s / a0; // tapered signal: the taper already lowers the long-lag overlap
    }
    for (let l = lagMax + 1; l < acf.length; l++) acf[l] = 0;
    for (let k = 0; k < nb; k++) {
      const L = (60 * fps) / bpms[k];
      let sc = 0;
      let wsum = 0;
      for (let m = 1; m <= ACF_WEIGHTS.length; m++) {
        const lag = m * L;
        if (lag > lagMax) break;
        const i0 = Math.floor(lag);
        const fr = lag - i0;
        sc += ACF_WEIGHTS[m - 1] * (acf[i0] * (1 - fr) + acf[i0 + 1] * fr);
        wsum += ACF_WEIGHTS[m - 1];
      }
      curves[w * nb + k] = wsum > 0 ? sc / wsum : 0;
    }
  }
  return { bpms, times, curves, fps, winSec };
}

// Mean tempo curve of the windows whose centre is in [t0, t1] (nearest window if none).
export function curveOfRange(tg, t0, t1) {
  const nb = tg.bpms.length;
  const out = new Float32Array(nb);
  let n = 0;
  let nearest = 0;
  let best = Infinity;
  for (let w = 0; w < tg.times.length; w++) {
    const c = tg.times[w];
    const d = Math.abs(c - (t0 + t1) / 2);
    if (d < best) { best = d; nearest = w; }
    if (c >= t0 && c <= t1) {
      for (let k = 0; k < nb; k++) out[k] += tg.curves[w * nb + k];
      n++;
    }
  }
  if (n === 0) {
    for (let k = 0; k < nb; k++) out[k] = tg.curves[nearest * nb + k];
    n = 1;
  }
  for (let k = 0; k < nb; k++) out[k] /= n;
  return out;
}

// Picks the tempo from a curve. `hints` are weak BPM hints (e.g. the ones written on the sheet):
// a candidate at 1x, 2x or 1/2x of a hint is favoured a little. Returns { bpm, conf, score }:
// conf in [0, 1] = how much the peak stands out of the curve.
export function pickTempo(bpms, curve, { hints = [] } = {}) {
  const nb = bpms.length;
  const adj = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    const oct = Math.log2(bpms[k] / TEMPO_CENTER);
    let prior = Math.exp(-0.5 * (oct / 0.9) ** 2);
    for (const h of hints) {
      if (!(h > 0)) continue;
      for (const f of [0.5, 1, 2]) {
        const d = Math.log2(bpms[k] / (h * f));
        if (Math.abs(d) < 0.06) prior *= f === 1 ? 1.12 : 1.06;
      }
    }
    adj[k] = curve[k] * prior;
  }
  let best = 0;
  for (let k = 1; k < nb; k++) if (adj[k] > adj[best]) best = k;
  // parabolic interpolation on the raw curve around the best bin
  let bpm = bpms[best];
  if (best > 0 && best < nb - 1) {
    const a = curve[best - 1];
    const b = curve[best];
    const c = curve[best + 1];
    const den = a - 2 * b + c;
    if (den < 0) bpm += TEMPO_STEP * Math.max(-1, Math.min(1, (0.5 * (a - c)) / den));
  }
  const sorted = Array.from(curve).sort((p, q) => p - q);
  const med = sorted[Math.floor(sorted.length / 2)];
  const peak = curve[best];
  const conf = Math.max(0, Math.min(1, peak > 0 ? (peak - med) / (0.35 + 0.0 * peak) : 0));
  return { bpm, conf, score: peak };
}

// Beat tracking by dynamic programming (Ellis 2007) on onset[i0..i1) with a period of
// 60 * fps / bpm frames; the tempo may drift (tightness `alpha`). Returns beat times in seconds
// (sub-frame refined) and their mean onset strength relative to the range mean.
export function trackBeats(onset, fps, t0, t1, bpm, { alpha = 90 } = {}) {
  const i0 = Math.max(0, Math.floor(t0 * fps));
  const i1 = Math.min(onset.length, Math.ceil(t1 * fps));
  const n = i1 - i0;
  const p = (60 * fps) / bpm;
  if (n < 4 * p) return { times: [], strength: 0 };
  const cs = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i0 + i];
  mean /= n;
  const lo = Math.max(1, Math.floor(p / 2));
  const hi = Math.ceil(2 * p);
  for (let i = 0; i < n; i++) {
    const o = onset[i0 + i] / (mean + 1e-9);
    let best = 0;
    let arg = -1;
    for (let d = lo; d <= hi && i - d >= 0; d++) {
      const r = Math.log(d / p);
      const v = cs[i - d] - alpha * r * r;
      if (v > best) { best = v; arg = i - d; }
    }
    cs[i] = o + best;
    back[i] = arg;
  }
  // best end among the last period
  let end = n - 1;
  for (let i = Math.max(0, n - Math.ceil(p)); i < n; i++) if (cs[i] > cs[end]) end = i;
  const idx = [];
  for (let i = end; i >= 0; i = back[i]) {
    idx.push(i);
    if (back[i] < 0) break;
  }
  idx.reverse();
  const times = [];
  let sum = 0;
  for (const i of idx) {
    // parabolic refinement of the peak position
    const a = onset[i0 + i - 1] ?? 0;
    const b = onset[i0 + i];
    const c = onset[i0 + i + 1] ?? 0;
    const den = a - 2 * b + c;
    const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    times.push((i0 + i + off) / fps);
    sum += b / (mean + 1e-9);
  }
  return { times, strength: idx.length ? sum / idx.length : 0 };
}

// Summary of a beat sequence: tempo from a robust line fit (beat number vs time), regularity =
// fraction of inter-beat intervals within 10% of the median. Returns { bpm, regularity, count }.
export function summariseBeats(times) {
  const n = times.length;
  if (n < 6) return { bpm: null, regularity: 0, count: n };
  const ibis = [];
  for (let i = 1; i < n; i++) ibis.push(times[i] - times[i - 1]);
  const sorted = ibis.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const reg = ibis.filter((v) => Math.abs(v / med - 1) <= 0.1).length / ibis.length;
  // fit time = a + b * k, with k the beat number (counting skipped beats)
  const ks = times.map((t) => Math.round((t - times[0]) / med));
  let keep = ks.map((_, i) => i);
  let slope = med;
  for (let iter = 0; iter < 3; iter++) {
    let sk = 0, st = 0, skk = 0, skt = 0;
    for (const i of keep) { sk += ks[i]; st += times[i]; skk += ks[i] * ks[i]; skt += ks[i] * times[i]; }
    const m = keep.length;
    const den = m * skk - sk * sk;
    if (den <= 0) break;
    slope = (m * skt - sk * st) / den;
    const icpt = (st - slope * sk) / m;
    keep = keep.filter((i) => Math.abs(times[i] - (icpt + slope * ks[i])) <= 0.2 * slope);
    if (keep.length < 6) break;
  }
  return { bpm: 60 / slope, regularity: reg, count: n };
}
