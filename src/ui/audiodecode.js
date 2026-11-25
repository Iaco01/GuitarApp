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

// Mono mix of a decoded buffer, in slices so the page keeps drawing (a 9 minute stereo song at 11 kHz is
// 5.6 million samples per channel).
// The first channel is mixed in place: the decoded buffer is dropped right after, no second array of that size.
async function toMono(buffer, tick) {
  const n = buffer.numberOfChannels;
  if (n === 1) return buffer.getChannelData(0);
  const len = buffer.length;
  const chans = [];
  for (let c = 0; c < n; c++) chans.push(buffer.getChannelData(c));
  const out = chans[0];
  const STEP = 1 << 19;
  for (let a = 0; a < len; a += STEP) {
    const b = Math.min(len, a + STEP);
    for (let c = 1; c < n; c++) {
      const ch = chans[c];
      for (let i = a; i < b; i++) out[i] += ch[i];
    }
    for (let i = a; i < b; i++) out[i] /= n;
    await tick();
  }
  return out;
}

// Gives the page back for one task without the 4 ms clamp of nested setTimeout calls.
let channel = null;
export function nextTask() {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  if (!channel) channel = new MessageChannel();
  return new Promise((resolve) => {
    channel.port1.onmessage = () => { channel.port1.onmessage = null; resolve(); };
    channel.port2.postMessage(0);
  });
}

// Mono samples at (about) 11025 Hz. The file is decoded straight at that rate by an OfflineAudioContext
// (45 MB for a 9-minute stereo song instead of 200 MB at 48 kHz); if the browser refuses that rate the
// default one is used and the samples are resampled here.
export async function decodeForAnalysis(blob) {
  // (decodeAudioData takes the bytes over: no copy is kept for the fallback, the file is read again if it is needed)
  let buffer = null;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (OAC) {
    try {
      buffer = await decodeWith(new OAC(1, 1, FEATURE_RATE), await blob.arrayBuffer());
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
      buffer = await decodeWith(ctx, await blob.arrayBuffer());
    } finally {
      try { ctx.close(); } catch { /* ignore */ }
    }
  }
  const mono = await toMono(buffer, nextTask);
  const rate = buffer.sampleRate;
  const durationSec = buffer.duration;
  buffer = null; // the decoded stereo audio is no longer needed
  return { samples: rate === FEATURE_RATE ? mono : resampleMono(mono, rate, FEATURE_RATE), sampleRate: FEATURE_RATE, durationSec };
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
  const audioSec = dec.durationSec;
  const nSamples = dec.samples.length;
  const gen = analyseAndAlignSteps({
    samples: dec.samples,
    sampleRate: dec.sampleRate,
    song,
    opts: { ownsSamples: true },
    now: () => performance.now(),
    onProgress: (f) => onProgress(0.1 + 0.9 * f, 'Analizzo l’audio…'),
  });
  dec.samples = null; // the analysis releases the audio as soon as the features are computed
  const result = await runStepsAsync(gen, {
    sliceMs,
    shouldCancel,
    now: () => performance.now(),
    yieldFn: () => new Promise((resolve) => {
      maxSlice = Math.max(maxSlice, performance.now() - lastYield);
      yields++;
      nextTask().then(() => { lastYield = performance.now(); resolve(); });
    }),
  });
  maxSlice = Math.max(maxSlice, performance.now() - lastYield);
  const totalMs = performance.now() - t0;
  if (!result) {
    const e = new Error('no-alignment');
    throw e;
  }
  const alignment = makeAlignment(result, song);
  return { alignment, result, stats: { decodeMs: Math.round(decodeMs), analyseMs: Math.round(totalMs - decodeMs), totalMs: Math.round(totalMs), maxSliceMs: Math.round(maxSlice), yields, audioSec, samples: nSamples } };
}
