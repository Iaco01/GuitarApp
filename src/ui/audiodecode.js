// Decodes the audio file of a song and runs the automatic sync on it, in slices so the page stays alive
// (progress bar, "Annulla"). Browser only: it needs AudioContext.

import { analyseAndAlignSteps } from '../analysis/autosync.js';
import { runStepsAsync, CANCELLED } from '../analysis/steps.js';
import { resampleMono, FEATURE_RATE } from '../analysis/features.js';
import { makeAlignment } from '../alignment.js';

export const AUTOSYNC_CANCELLED = CANCELLED;

function decodeWith(ctx, bytes) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

function toMono(buffer) {
  const n = buffer.numberOfChannels;
  if (n === 1) return buffer.getChannelData(0);
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < n; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += ch[i];
  }
  for (let i = 0; i < len; i++) out[i] /= n;
  return out;
}

// Mono samples at (about) 11025 Hz. The file is decoded straight at that rate by an OfflineAudioContext
// (45 MB for a 9-minute stereo song instead of 200 MB at 48 kHz); if the browser refuses that rate the
// default one is used and the samples are resampled here.
export async function decodeForAnalysis(blob) {
  const bytes = await blob.arrayBuffer();
  let buffer = null;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (OAC) {
    try {
      buffer = await decodeWith(new OAC(1, 1, FEATURE_RATE), bytes.slice(0));
    } catch {
      buffer = null;
    }
  }
  let ctx = null;
  if (!buffer) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('no-audio-context');
    ctx = new AC();
    try {
      buffer = await decodeWith(ctx, bytes);
    } finally {
      try { ctx.close(); } catch { /* ignore */ }
    }
  }
  const mono = toMono(buffer);
  const rate = buffer.sampleRate;
  return { samples: rate === FEATURE_RATE ? mono : resampleMono(mono, rate, FEATURE_RATE), sampleRate: FEATURE_RATE, durationSec: buffer.duration };
}

// Runs decoding and analysis. onProgress(fraction, label). shouldCancel() -> true stops it (the promise
// rejects with Error(AUTOSYNC_CANCELLED)). Resolves { alignment, result, stats } where stats has the
// times in ms (decodeMs, analyseMs, totalMs) and the longest stretch without giving the page back.
export async function runAutoSync({ song, blob, onProgress = () => {}, shouldCancel = () => false, sliceMs = 40 }) {
  const t0 = performance.now();
  onProgress(0, 'Decodifico l’audio…');
  let dec;
  try {
    dec = await decodeForAnalysis(blob);
  } catch (err) {
    if (err && err.message === AUTOSYNC_CANCELLED) throw err;
    const e = new Error('decode');
    e.cause = err;
    throw e;
  }
  const decodeMs = performance.now() - t0;
  if (shouldCancel()) throw new Error(AUTOSYNC_CANCELLED);
  onProgress(0.1, 'Analizzo l’audio…');
  let lastYield = performance.now();
  let maxSlice = 0;
  let yields = 0;
  const gen = analyseAndAlignSteps({
    samples: dec.samples,
    sampleRate: dec.sampleRate,
    song,
    now: () => performance.now(),
    onProgress: (f) => onProgress(0.1 + 0.9 * f, 'Analizzo l’audio…'),
  });
  const result = await runStepsAsync(gen, {
    sliceMs,
    shouldCancel,
    now: () => performance.now(),
    yieldFn: () => new Promise((resolve) => {
      maxSlice = Math.max(maxSlice, performance.now() - lastYield);
      yields++;
      setTimeout(() => { lastYield = performance.now(); resolve(); }, 0);
    }),
  });
  maxSlice = Math.max(maxSlice, performance.now() - lastYield);
  const totalMs = performance.now() - t0;
  if (!result) {
    const e = new Error('no-alignment');
    throw e;
  }
  const alignment = makeAlignment(result, song);
  return { alignment, result, stats: { decodeMs: Math.round(decodeMs), analyseMs: Math.round(totalMs - decodeMs), totalMs: Math.round(totalMs), maxSliceMs: Math.round(maxSlice), yields, audioSec: dec.durationSec, samples: dec.samples.length } };
}
