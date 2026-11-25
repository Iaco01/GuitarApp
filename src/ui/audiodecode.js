// Decodes the audio file of a song and runs the automatic sync on it, in slices so the page stays alive
// (progress bar, "Annulla"). Browser only: it needs AudioContext.

import { analyseAndAlignSteps } from '../analysis/autosync.js';
import { runStepsAsync, CANCELLED } from '../analysis/steps.js';
import { resampleMono, FEATURE_RATE } from '../analysis/features.js';
import { makeAlignment } from '../alignment.js';
import { scanMp3 } from '../mp3frames.js';

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

// An MP3 decoded in pieces of about PIECE_SEC seconds: the browser never holds more than a piece of decoded audio at
// once (the whole song at the native rate is 180 MB for a 9 minute stereo song, and arriving as one long task of the
// main thread). Every piece starts LEAD_FRAMES frames early (the decoder needs the bit reservoir of the frames before)
// and those are dropped. The first piece tells how many samples the decoder dropped at the start of the file (the Xing
// frame and the encoder delay); the others are placed with the same offset, so the timeline is the one of playback.
// Returns null for anything that is not a plain layer III stream or that decodes unexpectedly: the whole file is then
// decoded in one go.
const PIECE_SEC = 45;
const LEAD_FRAMES = 4;
async function decodeMp3InPieces(blob, shouldCancel) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const scan = scanMp3(bytes);
  if (!scan) return null;
  const { offsets, sampleRate, spf } = scan;
  const count = offsets.length - 1;
  const ratio = FEATURE_RATE / sampleRate;
  const perPiece = Math.max(50, Math.round((PIECE_SEC * sampleRate) / spf));
  const out = new Float32Array(Math.round(count * spf * ratio) + 4096);
  let end = 0;
  let delta = 0;
  for (let a = 0; a < count; a += perPiece) {
    if (shouldCancel()) throw new Error(AUTOSYNC_CANCELLED);
    const lead = a === 0 ? 0 : Math.min(LEAD_FRAMES, a);
    const b = Math.min(count, a + perPiece);
    const piece = bytes.slice(offsets[a - lead], offsets[b]);
    const buffer = await decodeWith(new OAC(1, 1, FEATURE_RATE), piece.buffer);
    const mono = await toMono(buffer, nextTask);
    const expected = (b - (a - lead)) * spf * ratio;
    let dst;
    let src;
    if (a === 0) {
      delta = Math.round(expected - mono.length);
      if (delta < 0 || delta > 0.5 * FEATURE_RATE) return null;
      dst = 0;
      src = 0;
    } else {
      if (Math.abs(mono.length - expected) > 0.01 * expected + 64) return null;
      dst = Math.round(a * spf * ratio) - delta;
      src = Math.round(lead * spf * ratio);
    }
    const n = Math.min(mono.length - src, out.length - dst);
    if (n <= 0) return null;
    out.set(mono.subarray(src, src + n), dst);
    end = Math.max(end, dst + n);
  }
  const samples = end === out.length ? out : out.subarray(0, end);
  return { samples, sampleRate: FEATURE_RATE, durationSec: end / FEATURE_RATE };
}

// Mono samples at (about) 11025 Hz. The file is decoded straight at that rate by an OfflineAudioContext
// (45 MB for a 9-minute stereo song instead of 200 MB at 48 kHz); if the browser refuses that rate the
// default one is used and the samples are resampled here.
export async function decodeForAnalysis(blob, shouldCancel = () => false) {
  try {
    const pieces = await decodeMp3InPieces(blob, shouldCancel);
    if (pieces) return pieces;
  } catch (err) {
    if (err && err.message === AUTOSYNC_CANCELLED) throw err;
    /* anything else: decode the whole file */
  }
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
export async function runAutoSync({ song, blob, onProgress = () => {}, shouldCancel = () => false, sliceMs = 30 }) {
  const t0 = performance.now();
  onProgress(0, 'Decodifico l’audio…');
  let dec;
  try {
    dec = await decodeForAnalysis(blob, shouldCancel);
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
