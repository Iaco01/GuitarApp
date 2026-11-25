// Audio features for the automatic sync (pure): resampling, tuning estimate, chromagram,
// bass chromagram and onset envelope (spectral flux). Input: mono Float32Array + sample rate.

import { fftRealPairMagnitudes } from './fft.js';

export const FEATURE_RATE = 11025;
const CHROMA_WIN = 4096;
const ONSET_WIN = 1024;
const ONSET_HOP = 256;

// Mono resampling by box integration (area average). Returns the input itself if already at `target`.
export function resampleMono(samples, sampleRate, target = FEATURE_RATE) {
  if (sampleRate === target) return samples;
  const ratio = sampleRate / target;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * ratio;
    const b = a + ratio;
    let k = Math.floor(a);
    let acc = 0;
    const kEnd = Math.min(samples.length, Math.ceil(b));
    for (; k < kEnd; k++) {
      const lo = Math.max(a, k);
      const hi = Math.min(b, k + 1);
      acc += samples[k] * (hi - lo);
    }
    out[i] = acc / ratio;
  }
  return out;
}

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// Calls fn(t, magSpectrumOfFrame) for every frame t of the STFT (frame t centred on t*hop), two
// frames per FFT. The spectrum buffer is reused between calls.
function forEachFrame(x, win, hop, nFrames, fn) {
  const w = hann(win);
  const a = new Float64Array(win);
  const b = new Float64Array(win);
  const magA = new Float64Array(win / 2 + 1);
  const magB = new Float64Array(win / 2 + 1);
  const re = new Float64Array(win);
  const im = new Float64Array(win);
  const fill = (buf, t) => {
    const start = t * hop - win / 2;
    for (let i = 0; i < win; i++) {
      const p = start + i;
      buf[i] = p >= 0 && p < x.length ? x[p] * w[i] : 0;
    }
  };
  for (let t = 0; t < nFrames; t += 2) {
    fill(a, t);
    if (t + 1 < nFrames) fill(b, t + 1);
    else b.fill(0);
    fftRealPairMagnitudes(a, b, magA, magB, re, im);
    fn(t, magA);
    if (t + 1 < nFrames) fn(t + 1, magB);
  }
}

// Peaks (bin, interpolated frequency, magnitude) of a magnitude spectrum between two frequencies.
function spectralPeaks(mag, df, fLo, fHi, relThreshold, out) {
  const kLo = Math.max(2, Math.floor(fLo / df));
  const kHi = Math.min(mag.length - 2, Math.ceil(fHi / df));
  let max = 0;
  for (let k = kLo; k <= kHi; k++) if (mag[k] > max) max = mag[k];
  out.length = 0;
  if (max <= 0) return max;
  const thr = max * relThreshold;
  for (let k = kLo; k <= kHi; k++) {
    const m = mag[k];
    if (m < thr || m <= mag[k - 1] || m < mag[k + 1]) continue;
    // parabolic interpolation on the log magnitude (nearly unbiased for a Hann window)
    const a = Math.log(mag[k - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(mag[k + 1] + 1e-12);
    const den = a - 2 * b + c;
    const p = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    out.push({ f: (k + p) * df, m: m * Math.exp(-0.25 * (a - c) * p) });
  }
  return max;
}

// Tuning of the recording in cents relative to A = 440 Hz (positive = sharp), in [-50, 50).
export function estimateTuningCents(x, sampleRate = FEATURE_RATE) {
  const nFrames = Math.floor(x.length / CHROMA_WIN) * 2;
  if (nFrames < 2) return 0;
  const df = sampleRate / CHROMA_WIN;
  let sr = 0;
  let si = 0;
  const peaks = [];
  // every 5th frame
  const hop = CHROMA_WIN / 2;
  const w = hann(CHROMA_WIN);
  const a = new Float64Array(CHROMA_WIN);
  const b = new Float64Array(CHROMA_WIN);
  const magA = new Float64Array(CHROMA_WIN / 2 + 1);
  const magB = new Float64Array(CHROMA_WIN / 2 + 1);
  const re = new Float64Array(CHROMA_WIN);
  const im = new Float64Array(CHROMA_WIN);
  const step = 5;
  for (let t = 0; t + step < nFrames; t += 2 * step) {
    for (let i = 0; i < CHROMA_WIN; i++) {
      const p1 = t * hop - CHROMA_WIN / 2 + i;
      const p2 = (t + step) * hop - CHROMA_WIN / 2 + i;
      a[i] = p1 >= 0 && p1 < x.length ? x[p1] * w[i] : 0;
      b[i] = p2 >= 0 && p2 < x.length ? x[p2] * w[i] : 0;
    }
    fftRealPairMagnitudes(a, b, magA, magB, re, im);
    for (const mag of [magA, magB]) {
      spectralPeaks(mag, df, 100, 1500, 0.1, peaks);
      for (const p of peaks) {
        const midi = 69 + 12 * Math.log2(p.f / 440);
        const ang = 2 * Math.PI * midi; // phase of the fractional semitone
        const wgt = Math.sqrt(p.m);
        sr += wgt * Math.cos(ang);
        si += wgt * Math.sin(ang);
      }
    }
  }
  if (sr === 0 && si === 0) return 0;
  const frac = Math.atan2(si, sr) / (2 * Math.PI); // in [-0.5, 0.5]
  return frac * 100;
}

// Features of a mono signal. `x` must be at FEATURE_RATE (use resampleMono first).
// Returns { fps, frames, chroma, bass, onset, onsetFps, tuningCents, duration }:
//   chroma / bass: Float32Array(frames * 12), log-compressed, tuning corrected, C = 0 .. B = 11;
//   onset: spectral-flux envelope (mean 1) at onsetFps.
export function computeFeatures(x, { chromaHop = 1024, onProgress = null } = {}) {
  const sr = FEATURE_RATE;
  // level normalisation: rms 0.1
  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const rms = Math.sqrt(ss / Math.max(1, x.length));
  const g = rms > 1e-9 ? 0.1 / rms : 1;
  const xn = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) xn[i] = x[i] * g;

  const tuningCents = estimateTuningCents(xn, sr);
  const tuneSemis = tuningCents / 100;
  const frames = Math.floor(xn.length / chromaHop) + 1;
  const df = sr / CHROMA_WIN;
  const chroma = new Float32Array(frames * 12);
  const bass = new Float32Array(frames * 12);
  const peaks = [];
  const progress = (f) => { if (onProgress) onProgress(f); };

  forEachFrame(xn, CHROMA_WIN, chromaHop, frames, (t, mag) => {
    const base = t * 12;
    spectralPeaks(mag, df, 100, 2000, 0.03, peaks);
    for (const p of peaks) {
      const midi = 69 + 12 * Math.log2(p.f / 440) - tuneSemis;
      const r = Math.round(midi);
      const dev = Math.abs(midi - r);
      const wf = Math.exp(-0.5 * Math.pow(Math.log2(p.f / 350) / 1.3, 2));
      chroma[base + (((r % 12) + 12) % 12)] += p.m * wf * (1 - 1.2 * dev);
    }
    spectralPeaks(mag, df, 45, 250, 0.1, peaks);
    for (const p of peaks) {
      const midi = 69 + 12 * Math.log2(p.f / 440) - tuneSemis;
      const r = Math.round(midi);
      const dev = Math.abs(midi - r);
      bass[base + (((r % 12) + 12) % 12)] += p.m * (1 - 1.2 * dev);
    }
    if ((t & 255) === 0) progress(0.5 * (t / frames));
  });

  // log compression relative to a global reference (95th percentile of frame energy)
  const energies = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let s = 0;
    for (let c = 0; c < 12; c++) s += chroma[t * 12 + c];
    energies[t] = s;
  }
  const sorted = Array.from(energies).sort((p, q) => p - q);
  const ref = Math.max(1e-6, sorted[Math.floor(0.95 * (sorted.length - 1))]);
  for (let i = 0; i < chroma.length; i++) chroma[i] = Math.log(1 + (30 * chroma[i]) / ref);
  const bsorted = [];
  for (let t = 0; t < frames; t++) {
    let s = 0;
    for (let c = 0; c < 12; c++) s += bass[t * 12 + c];
    bsorted.push(s);
  }
  bsorted.sort((p, q) => p - q);
  const bref = Math.max(1e-6, bsorted[Math.floor(0.95 * (bsorted.length - 1))]);
  for (let i = 0; i < bass.length; i++) bass[i] = Math.log(1 + (30 * bass[i]) / bref);

  // onset envelope: positive log-spectral flux, local mean removed
  const oFrames = Math.floor(xn.length / ONSET_HOP) + 1;
  const flux = new Float32Array(oFrames);
  const kMax = Math.floor((4000 * ONSET_WIN) / sr);
  const prev = new Float32Array(kMax + 1);
  forEachFrame(xn, ONSET_WIN, ONSET_HOP, oFrames, (t, mag) => {
    let f = 0;
    for (let k = 3; k <= kMax; k++) {
      const l = Math.log(1 + 0.05 * mag[k]);
      const d = l - prev[k];
      if (d > 0 && t > 0) f += d;
      prev[k] = l;
    }
    flux[t] = f;
    if ((t & 1023) === 0) progress(0.5 + 0.5 * (t / oFrames));
  });
  const onset = detrendOnset(flux, Math.round((0.5 * sr) / ONSET_HOP));
  progress(1);
  return { fps: sr / chromaHop, frames, chroma, bass, onset, onsetFps: sr / ONSET_HOP, tuningCents, duration: x.length / sr };
}

// Subtracts a centred moving average (half-width `half`) and clips at zero; the result is
// divided by its mean (so that the mean is 1).
function detrendOnset(flux, half) {
  const n = flux.length;
  const out = new Float32Array(n);
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + flux[i];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const m = (cum[hi] - cum[lo]) / (hi - lo);
    const v = Math.max(0, flux[i] - m);
    out[i] = v;
    total += v;
  }
  const mean = total / Math.max(1, n);
  if (mean > 0) for (let i = 0; i < n; i++) out[i] /= mean;
  return out;
}
