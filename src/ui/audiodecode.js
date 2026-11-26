// Decodes the audio file of a song and runs the automatic sync on it, in slices so the page stays alive
// (progress bar, "Annulla"). Browser only: it needs AudioContext.

import { analyseAndAlignSteps } from '../analysis/autosync.js';
import { runStepsAsync, CANCELLED } from '../analysis/steps.js';
import { resampleMono, FEATURE_RATE } from '../analysis/features.js';
import { makeAlignment } from '../alignment.js';
import { scanMp3 } from '../mp3frames.js';
import { mp3Layout } from '../mp3seek.js';
import { correlateShift } from '../analysis/stitch.js';

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
// main thread). The pieces do not depend on what the decoder reports:
//  - every piece is cut at an exact frame, and the Xing frame is never given to the decoder, so the first sample of the
//    first piece is the start of the first audio frame; the timeline is the formula of mp3seek.js (the one the exact seek
//    of the player uses), not a delay measured on the decoder;
//  - every piece starts LEAD_FRAMES (bit reservoir, dropped) plus OVERLAP_SEC before the part that it adds, and it is
//    placed by the correlation of that overlap with what is already placed. A shift of more than MAX_SHIFT_SEC, or a
//    weak correlation, means that the decoder does something unexpected: null (the whole file is decoded in one go).
// Returns { samples, sampleRate, durationSec, method: 'pieces', pieceShiftsMs } or null.
const PIECE_SEC = 45;
const LEAD_FRAMES = 4;
const OVERLAP_SEC = 1;
const MAX_SHIFT_SEC = 0.03;
const MIN_CORR = 0.9;
async function decodeMp3InPieces(blob, shouldCancel) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const scan = scanMp3(bytes);
  if (!scan) return null;
  const layout = mp3Layout(bytes, scan);
  const { offsets, sampleRate, spf } = scan;
  const count = offsets.length - 1;
  const ratio = FEATURE_RATE / sampleRate;
  const perPiece = Math.max(50, Math.round((PIECE_SEC * sampleRate) / spf));
  const overlapFrames = Math.max(4, Math.round((OVERLAP_SEC * sampleRate) / spf));
  const maxShift = Math.round(MAX_SHIFT_SEC * FEATURE_RATE);
  // sample index (at FEATURE_RATE) of the start of frame f on the timeline of the whole file
  const at = (f) => Math.round((f * spf - layout.frontSamples) * ratio);
  const out = new Float32Array(Math.max(0, at(count)) + 4096);
  let end = 0;
  const shifts = [];
  for (let a = layout.firstAudio; a < count; a += perPiece) {
    if (shouldCancel()) throw new Error(AUTOSYNC_CANCELLED);
    const first = a === layout.firstAudio;
    const start = first ? a : Math.max(layout.firstAudio, a - overlapFrames - LEAD_FRAMES);
    const lead = first ? 0 : Math.min(LEAD_FRAMES, start - layout.firstAudio);
    const b = Math.min(count, a + perPiece);
    const piece = bytes.slice(offsets[start], offsets[b]);
    const buffer = await decodeWith(new OAC(1, 1, FEATURE_RATE), piece.buffer);
    const mono = await toMono(buffer, nextTask);
    const expected = (b - start) * spf * ratio;
    if (Math.abs(mono.length - expected) > 0.01 * expected + 64) return null;
    let nominal = at(start); // where mono[0] belongs
    let src = Math.round(lead * spf * ratio);
    if (!first) {
      // the stretch that the previous pieces already placed: [at(start) + src, at(a))
      const len = Math.min(Math.round(overlapFrames * spf * ratio), Math.max(0, end - (nominal + src)));
      if (len < FEATURE_RATE / 4) return null;
      const r = correlateShift(out, nominal + src, mono, src, len, maxShift);
      if (r.corr < MIN_CORR || Math.abs(r.shift) > maxShift) return null;
      nominal += r.shift;
      shifts.push(Math.round((r.shift / FEATURE_RATE) * 1000 * 10) / 10);
    }
    let dst = nominal + src;
    if (dst < 0) { src -= dst; dst = 0; } // (the first frames before the timeline starts)
    const n = Math.min(mono.length - src, out.length - dst);
    if (n <= 0) return null;
    out.set(mono.subarray(src, src + n), dst);
    end = Math.max(end, dst + n);
  }
  const samples = end === out.length ? out : out.subarray(0, end);
  return { samples, sampleRate: FEATURE_RATE, durationSec: end / FEATURE_RATE, method: 'pieces', pieceShiftsMs: shifts };
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
  return { samples: rate === FEATURE_RATE ? mono : resampleMono(mono, rate, FEATURE_RATE), sampleRate: FEATURE_RATE, durationSec, method: 'whole', pieceShiftsMs: [] };
}

// Runs decoding and analysis. onProgress(fraction, label). shouldCancel() -> true stops it (the promise
// rejects with Error(AUTOSYNC_CANCELLED)). Resolves { alignment, result, stats } where stats has the
// times in ms (decodeMs, analyseMs, totalMs) and the longest stretch without giving the page back.
export async function runAutoSync({ song, blob, onProgress = () => {}, shouldCancel = () => false, sliceMs = 12 }) {
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
  const decodeInfo = { method: dec.method, pieceShiftsMs: dec.pieceShiftsMs };
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
  alignment.decode = decodeInfo; // (for the exported diagnostics: how this audio was decoded)
  return { alignment, result, stats: { decodeMs: Math.round(decodeMs), analyseMs: Math.round(totalMs - decodeMs), totalMs: Math.round(totalMs), maxSliceMs: Math.round(maxSlice), yields, audioSec, samples: nSamples, decode: decodeInfo } };
}
