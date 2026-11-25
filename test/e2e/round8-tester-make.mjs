// Round 8 tester helpers: foreign music (chords that are not in the sheet), splicing, fades.
// Builds on the round 7 tester generator; no song text anywhere.
import { makeTrack } from './round7-tester-make.mjs';
export { makeTrack };

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pcs(name) {
  const m = /^([A-G])([#b]?)(m?)/.exec(name);
  const root = (NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return [root, (root + (m[3] ? 3 : 4)) % 12, (root + 7) % 12];
}
// Foreign music: list of chord names, each `beatsEach` beats at `bpm`; strummed every beat with drums.
export function makeForeign({ chords, bpm = 100, beatsEach = 4, seed = 99, rate = 22050, semis = 1, cents = -25, drums = true }) {
  const R = rng(seed);
  const spb = 60 / bpm;
  const total = chords.length * beatsEach * spb;
  const N = Math.ceil(total * rate);
  const x = new Float32Array(N);
  const a440 = 440 * 2 ** (cents / 1200);
  const fOf = (pc, oct) => a440 * 2 ** ((pc + 12 * (oct - 4) - 9) / 12);
  const note = (f, t0, amp, tau, dur) => {
    const i0 = Math.floor(t0 * rate);
    const n = Math.min(Math.floor(dur * rate), N - i0);
    if (i0 < 0 || n <= 0) return;
    const nh = Math.min(8, Math.floor(rate / 2.2 / f));
    for (let h = 1; h <= nh; h++) {
      const w = (2 * Math.PI * f * h) / rate; const ah = amp / h ** 1.1; const th = tau / (1 + 0.35 * (h - 1)); const ph = R() * 6.28;
      for (let i = 0; i < n; i++) { const tt = i / rate; x[i0 + i] += ah * Math.exp(-tt / th) * Math.min(1, tt / 0.003) * Math.sin(w * i + ph); }
    }
  };
  chords.forEach((c, k) => {
    const p = pcs(c).map((q) => (q + semis + 12) % 12);
    for (let b = 0; b < beatsEach; b++) {
      const t0 = (k * beatsEach + b) * spb;
      [[p[0], 2], [p[2], 2], [p[0], 3], [p[1], 3], [p[2], 3], [p[0], 4]].forEach(([q, o], s) => note(fOf(q, o), t0 + s * 0.012, b === 0 ? 0.16 : 0.1, 0.9, 1.0));
      if (drums) {
        const i0 = Math.floor(t0 * rate);
        for (let i = 0; i < Math.floor(0.1 * rate) && i0 + i < N; i++) x[i0 + i] += (b % 2 ? 0.14 : 0.0) * (R() * 2 - 1) * Math.exp(-i / rate / 0.025) + (b % 2 ? 0 : 0.3 * Math.sin(2 * Math.PI * 60 * i / rate) * Math.exp(-i / rate / 0.05));
      }
    }
  });
  return { samples: x, sampleRate: rate, durationSec: total };
}
export function concat(parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function peakNorm(x, peak = 0.9) { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }
export function fadeOut(x, rate, sec) { const n = Math.floor(sec * rate); const o = x.slice(); for (let i = 0; i < n; i++) { const g = 1 - i / n; o[o.length - n + i] *= g * g; } return o; }
export function addWhite(x, level, seed) { const R = rng(seed); const o = new Float32Array(x.length); for (let i = 0; i < o.length; i++) o[i] = x[i] + (R() * 2 - 1) * level; return o; }
export function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }
// add white noise for a given SNR in dB (relative to the RMS of the signal)
export function addNoiseSnr(x, snrDb, seed) { const sig = rms(x); const lvl = sig / 10 ** (snrDb / 20); const R = rng(seed); const o = new Float32Array(x.length); const k = lvl * Math.sqrt(3); for (let i = 0; i < o.length; i++) o[i] = x[i] + (R() * 2 - 1) * k; return o; }
export function secOfEvents(evs, si) { return evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0); }
