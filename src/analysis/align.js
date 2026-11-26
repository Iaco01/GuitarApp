// Forced alignment of the chord sequence of the sheet on the audio (pure).
//
// The sheet gives the exact sequence of chords. States are the events in order (left-to-right:
// each state stays or goes to the next one) and the model is a segmental Viterbi: every event
// covers a stretch of frames, scored by the cosine similarity between the chromagram and the chord
// template (root, third, fifth, a little of the seventh) plus the bass, minus a soft penalty for
// durations far from the prior (beats from the sheet x a local seconds-per-beat scale estimated
// from the previous pass). The 12 transpositions of the sheet are tried (candidates ranked on the
// global chroma first). Start and end of the recording are free.

import { parseChord } from '../chord.js';
import { pitchClassOf } from '../transpose.js';
import { runSteps } from './steps.js';

const G_CHROMA = 15;
const G_BASS = 2.5;
const COS_EPS = 0.3;
const GAP_START = 4;
const GAP_FRAME = 1;
const INTRO_FRAME = 0.3;
// after the last event: less generous than before the first (a repeated chorus, a reprise, a second take after the end of
// the sheet should not make it worth to leave the last sections unmatched)
const TRAIL_FRAME = 0.7;
// cost of skipping an event / one event of a whole section that the audio does not have: the last events of the sheet
// (audio shorter than the sheet) cost less than a section in the middle
const SKIP_TAIL = 5;
const SKIP_MID = 12;
// a stretch of music that is not in the sheet right after a skipped section (a solo in place of a section) costs this more
// than a gap after a section that is played: otherwise any section that matches poorly could be explained away as
// "skipped, and its audio is a gap"
const SKIP_GAP_EXTRA = 30;
// the last events are skipped only when what is left of the audio is shorter than this share of their expected length
const TAIL_LEFT_FRAC = 0.35;
// the first events of the sheet may be missing from the audio (it starts late: a recording cut at the beginning): they are skipped
// like the last ones, at the same cost each, when the first event in the audio starts earlier than this share of the length
// the skipped ones are expected to have
const SKIP_HEAD = 8;
const HEAD_START_FRAC = 0.35;
// grid units at the end of the audio where an event may be cut short (see viterbi)
const TRUNC_UNITS = 2;
const MARGIN_SHIFTS = [0.25, 0.5, 1];
// inner-loop steps of the Viterbi between two yields (about 5-10 ms of work in Node)
const VITERBI_SLICE_WORK = 0.2e6;

const mod12 = (n) => ((n % 12) + 12) % 12;

// Chord template (12 weights, L2 normalised) and bass pitch class; null for unknown names.
export function chordTemplate(name) {
  const c = parseChord(name);
  if (!c) return null;
  const root = pitchClassOf(c.root);
  if (root < 0) return null;
  const q = c.quality || '';
  const w = new Float64Array(12);
  const minor = /^(m(?!aj)|min|dim|-)/.test(q);
  const dim = /dim|°/.test(q);
  const aug = /aug|\+/.test(q);
  const sus2 = /sus2/.test(q);
  const sus4 = /sus4|sus(?!2)/.test(q);
  const power = /^5$/.test(q);
  w[root] = 1;
  if (!power) {
    if (sus2) w[mod12(root + 2)] = 0.85;
    else if (sus4) w[mod12(root + 5)] = 0.85;
    else w[mod12(root + (minor ? 3 : 4))] = 0.85;
  }
  w[mod12(root + (dim ? 6 : aug ? 8 : 7))] = 0.9;
  if (/maj7|M7/.test(q)) w[mod12(root + 11)] = 0.5;
  else if (/7/.test(q)) w[mod12(root + 10)] = 0.5;
  if (/6/.test(q)) w[mod12(root + 9)] = 0.4;
  if (/9|add9|add2/.test(q)) w[mod12(root + 2)] = Math.max(w[mod12(root + 2)], 0.4);
  let n = 0;
  for (let i = 0; i < 12; i++) n += w[i] * w[i];
  n = Math.sqrt(n);
  for (let i = 0; i < 12; i++) w[i] /= n;
  return { root, bass: c.bass ? pitchClassOf(c.bass) : root, weights: w, key: root + '|' + Array.from(w, (v) => v.toFixed(2)).join(',') + '|' + (c.bass ? pitchClassOf(c.bass) : root) };
}

// Shifted copy of a template (the recording is `shift` semitones above the sheet).
export function shiftedTemplate(t, shift) {
  const w = new Float64Array(12);
  for (let i = 0; i < 12; i++) w[mod12(i + shift)] = t.weights[i];
  return { root: mod12(t.root + shift), bass: mod12(t.bass + shift), weights: w };
}

// events: [{ name, rest }] -> { chordOf: Int32Array (index in `chords`, -1 for rests/unknown), chords: [template] }
export function buildChordSet(events) {
  const chords = [];
  const byKey = new Map();
  const chordOf = new Int32Array(events.length).fill(-1);
  events.forEach((ev, j) => {
    if (ev.rest) return;
    const t = chordTemplate(ev.name);
    if (!t) return;
    let idx = byKey.get(t.key);
    if (idx === undefined) {
      idx = chords.length;
      chords.push(t);
      byKey.set(t.key, idx);
    }
    chordOf[j] = idx;
  });
  return { chordOf, chords };
}

// Per-frame cosine of every chord (cos) and the centred emission (em), as flat arrays
// [chord * frames + t], plus cumulative sums with `frames + 1` entries per chord.
function* emissions(feat, chords, shift, gC = G_CHROMA, gB = G_BASS) {
  const T = feat.frames;
  const D = chords.length;
  const cos = new Float32Array(D * T);
  const em = new Float32Array(D * T);
  const tpl = chords.map((c) => shiftedTemplate(c, shift));
  const zc = new Float64Array(D);
  const zb = new Float64Array(D);
  for (let t = 0; t < T; t++) {
    if ((t & 255) === 255) yield;
    let n2 = 0;
    for (let k = 0; k < 12; k++) n2 += feat.chroma[t * 12 + k] ** 2;
    const inv = 1 / (Math.sqrt(n2) + COS_EPS);
    let bs = 0;
    for (let k = 0; k < 12; k++) bs += feat.bass[t * 12 + k];
    const binv = 1 / (bs + 0.5);
    let mc = 0;
    let mb = 0;
    for (let c = 0; c < D; c++) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += feat.chroma[t * 12 + k] * tpl[c].weights[k];
      zc[c] = s * inv;
      zb[c] = feat.bass[t * 12 + tpl[c].bass] * binv;
      mc += zc[c];
      mb += zb[c];
    }
    mc /= D;
    mb /= D;
    for (let c = 0; c < D; c++) {
      cos[c * T + t] = zc[c];
      em[c * T + t] = gC * (zc[c] - mc) + gB * (zb[c] - mb);
    }
  }
  return { cos, em, D, T };
}

function cumulative(a, D, T) {
  const out = new Float64Array(D * (T + 1));
  for (let c = 0; c < D; c++) {
    let s = 0;
    for (let t = 0; t < T; t++) {
      out[c * (T + 1) + t] = s;
      s += a[c * T + t];
    }
    out[c * (T + 1) + T] = s;
  }
  return out;
}

// Segmental Viterbi over boundaries on a grid of `stride` frames. Event j ends at boundary
// u in [lo[j], hi[j]]; its length in grid units is in [dmin[j], dmax[j]]. Returns the start
// and end boundary (in grid units) of every event, with the total score.
// Music that is not in the sheet: where gapBefore[j] is set, event j may start after a gap that
// follows the end of event j-1 (a neutral emission: it costs `gapStart` once and `gapFrame` per
// frame; a running maximum keeps this linear in the number of boundaries).
function* viterbi({ cumE, cumG, cumG0 = null, cumGT = null, T, chordOf, N, stride, lo, hi, dmin, dmax, expected, sigma, lambda, bonus, kappa, gapBefore = null, gapStart = 0, segs = null, tailCost = null, headCost = null, skipGapExtra = SKIP_GAP_EXTRA }) {
  const U = Math.floor(T / stride);
  const Tp = T + 1;
  const back = new Int16Array(N * (U + 1)).fill(-1);
  const hbits = headCost ? new Uint8Array(N * (U + 1)) : null; // the first events (0..j-1) are skipped and event j starts at this boundary
  const expPrefix = new Float64Array(N + 1);
  for (let j = 0; j < N; j++) expPrefix[j + 1] = expPrefix[j] + expected[j];
  const gbits = gapBefore ? new Uint8Array(N * (U + 1)) : null; // bit 0: starts after a gap; bit 1: the gap extends the one ending at u-1
  let prev = new Float64Array(U + 1);
  let cur = new Float64Array(U + 1);
  const start = new Float64Array(U + 1);
  // frames outside the events (before the first, after the last, between sections) score like the best chord
  // of the sheet minus gapFrame: the music not in the sheet is neither rewarded nor punished by the sheet's chords
  const gcum = (u) => cumG[u * stride];
  // before the first event the frames score without the gapFrame deficit: nothing is gained by starting the first chord
  // early, on music that is not in the sheet
  const g0 = cumG0 || cumG;
  const gT = cumGT || cumG;
  for (let u = 0; u <= U; u++) prev[u] = kappa * (bonus ? bonus[u * stride] : 0) + g0[u * stride];
  let work = 0;
  // sections that may be skipped (not in the audio): at the first event the scores are kept, at the last one the
  // skipped alternative (same position, a cost) competes with the normal one
  const segStart = new Int32Array(N).fill(-1);
  const segEnd = new Int32Array(N).fill(-1);
  const skipFlag = segs ? segs.map(() => new Uint8Array(U + 1)) : null;
  if (segs) segs.forEach((g, k) => { segStart[g.a] = k; segEnd[g.b] = k; });
  let pre = null;
  // the best scores of the last skippable section before it was merged with its skipped alternative: a gap may not start
  // from a skip (a section that is skipped leaves no room for other music: otherwise any poorly matching section could be
  // explained away as skipped, with its audio as a gap)
  let normalPrev = null;
  let skippedAlt = null; // the scores of the last skippable section when it is skipped
  const endScore = tailCost ? new Float64Array(N) : null;
  const endAt = tailCost ? new Int32Array(N) : null;
  for (let j = 0; j < N; j++) {
    if (segStart[j] >= 0) pre = Float64Array.from(prev);
    cur.fill(-Infinity);
    const c = chordOf[j];
    const base = c >= 0 ? c * Tp : -1;
    const dlo = Math.max(1, dmin[j]);
    const dhi = Math.max(dlo, dmax[j]);
    const pen = new Float64Array(dhi - dlo + 1);
    for (let d = dlo; d <= dhi; d++) {
      const r = Math.log((d * stride) / expected[j]);
      pen[d - dlo] = (lambda * r * r) / (2 * sigma * sigma);
    }
    let from = prev;
    if (j > 0 && gapBefore && gapBefore[j]) {
      let gg = -Infinity;
      const afterSeg = segEnd[j - 1] >= 0 && normalPrev;
      const gapSrc = afterSeg ? normalPrev : prev;
      for (let u = 0; u <= U; u++) {
        let flags = 0;
        if (u > 0) {
          const stN = gapSrc[u - 1] - gapStart;
          // (a gap right after a skipped section: the section was replaced by music that is not in the sheet)
          const stS = afterSeg && skippedAlt ? skippedAlt[u - 1] - gapStart - skipGapExtra : -Infinity;
          const st = Math.max(stN, stS);
          if (gg >= st) flags |= 2;
          else { gg = st; if (stS > stN) flags |= 4; }
          gg += gcum(u) - gcum(u - 1);
        }
        if (gg > prev[u]) { start[u] = gg; flags |= 1; } else start[u] = prev[u];
        gbits[j * (U + 1) + u] = flags;
      }
      from = start;
    }
    if (headCost && j > 0) {
      // the audio may start with event j (the ones before it are not in it): a fresh start at a boundary close enough to the
      // start of the audio, at the cost of skipping them (`from` is a scratch array here: the score row of the event before)
      for (let u = 0; u <= U; u++) {
        const frames = u * stride;
        if (frames > HEAD_START_FRAC * expPrefix[j]) break;
        const v = kappa * (bonus ? bonus[frames] : 0) + g0[frames] - headCost[j] * j;
        if (v > from[u]) { from[u] = v; hbits[j * (U + 1) + u] = 1; }
      }
    }
    const last = j === N - 1;
    let inner = 0;
    for (let u = lo[j]; u <= Math.min(U, hi[j]); u++) {
      let best = -Infinity;
      let arg = -1;
      const dEnd = Math.min(dhi, u);
      // an event cut by the end of the audio may be shorter than any chord lasts (and costs nothing for it): the recording stops
      // inside the chord
      const dFrom = u >= U - TRUNC_UNITS ? 1 : dlo;
      if (base >= 0) {
        // (the hot loop of the whole analysis: the cumulative index moves by one stride per step)
        const eu = cumE[base + u * stride];
        let ci = base + (u - dlo) * stride;
        for (let d = dlo; d <= dEnd; d++, ci -= stride) {
          const fp = from[u - d];
          if (fp === -Infinity) continue;
          const v = fp + (eu - cumE[ci]) - pen[d - dlo];
          if (v > best) { best = v; arg = d; }
        }
        for (let d = dFrom; d < dlo && d <= dEnd; d++) {
          const fp = from[u - d];
          if (fp === -Infinity) continue;
          const v = fp + (eu - cumE[base + (u - d) * stride]);
          if (v > best) { best = v; arg = d; }
        }
      } else {
        for (let d = dlo; d <= dEnd; d++) {
          const fp = from[u - d];
          if (fp === -Infinity) continue;
          const v = fp - pen[d - dlo];
          if (v > best) { best = v; arg = d; }
        }
        for (let d = dFrom; d < dlo && d <= dEnd; d++) {
          const fp = from[u - d];
          if (fp === -Infinity) continue;
          if (fp > best) { best = fp; arg = d; }
        }
      }
      if (arg >= 0) {
        cur[u] = best + (last ? 0 : kappa * (bonus ? bonus[u * stride] : 0));
        back[j * (U + 1) + u] = arg;
      }
      // (one event can be long: give the page back inside it too)
      inner += dhi - dlo + 1;
      if (inner > VITERBI_SLICE_WORK) { inner = 0; yield; }
    }
    const t = prev; prev = cur; cur = t;
    if (segEnd[j] >= 0) {
      const k = segEnd[j];
      const cost = segs[k].cost;
      normalPrev = Float64Array.from(prev);
      skippedAlt = Float64Array.from(pre, (v) => v - cost);
      for (let u = 0; u <= U; u++) {
        const v = pre[u] - cost;
        if (v > prev[u]) { prev[u] = v; skipFlag[k][u] = 1; }
      }
    }
    if (tailCost) {
      let bj = -Infinity;
      let ba = -1;
      for (let u = 0; u <= U; u++) {
        const v = prev[u] + gT[U * stride] - gT[u * stride];
        if (v > bj) { bj = v; ba = u; }
      }
      endScore[j] = bj;
      endAt[j] = ba;
    }
    work += (Math.min(U, hi[j]) - lo[j] + 1) * (dhi - dlo + 1) + U;
    if (work > VITERBI_SLICE_WORK) {
      work = 0;
      yield;
    }
  }
  let bu = -1;
  let bv = -Infinity;
  let lastEvent = N - 1;
  for (let u = 0; u <= U; u++) {
    const v = prev[u] + gT[U * stride] - gT[u * stride];
    if (v > bv) { bv = v; bu = u; }
  }
  if (tailCost) {
    // the sheet may go on after the end of the audio: the last events are skipped, at a cost each
    // (only if the audio really ends: what is left after the last event is much shorter than the skipped events)
    let acc = 0;
    let exp = 0;
    let bestTail = bv;
    for (let j = N - 2; j >= 0; j--) {
      acc += tailCost[j + 1];
      exp += expected[j + 1];
      const left = T - endAt[j] * stride;
      if (left >= TAIL_LEFT_FRAC * exp) continue;
      const v = endScore[j] - acc;
      if (v > bestTail + 1e-9) { bestTail = v; lastEvent = j; bu = endAt[j]; }
    }
    bv = bestTail;
  }
  if (bu < 0) return null;
  const ends = new Int32Array(N);
  const starts = new Int32Array(N);
  const skipped = new Uint8Array(N);
  for (let j = lastEvent + 1; j < N; j++) { ends[j] = bu; starts[j] = bu; skipped[j] = 1; }
  let u = bu;
  let skipBefore = false; // the gap that was just walked back started right after a skipped section
  for (let j = lastEvent; j >= 0; j--) {
    if (segEnd[j] >= 0 && (skipFlag[segEnd[j]][u] || skipBefore)) {
      skipBefore = false;
      const g = segs[segEnd[j]];
      for (let k = g.a; k <= g.b; k++) { ends[k] = u; starts[k] = u; skipped[k] = 1; }
      j = g.a;
      continue;
    }
    ends[j] = u;
    u -= back[j * (U + 1) + u];
    starts[j] = u;
    if (hbits && hbits[j * (U + 1) + u]) {
      for (let k = 0; k < j; k++) { ends[k] = u; starts[k] = u; skipped[k] = 1; }
      break;
    }
    if (gbits && (gbits[j * (U + 1) + u] & 1)) {
      // walk back over the gap: it began right after the end of event j-1
      while (gbits[j * (U + 1) + u] & 2) u--;
      skipBefore = (gbits[j * (U + 1) + u] & 4) !== 0;
      u--;
    }
  }
  return { ends, starts, skipped, start0: starts[0], score: bv, stride };
}

// Local seconds-per-prior-beat of every event (median of d / prior over +-`half` neighbours).
function localScales(durFrames, priorBeats, rest, half, fallback, skipped = null) {
  const N = durFrames.length;
  const out = new Float64Array(N);
  const ratios = durFrames.map((d, j) => (rest[j] || (skipped && skipped[j]) || !(priorBeats[j] > 0) ? NaN : d / priorBeats[j]));
  const all = ratios.filter(Number.isFinite).sort((a, b) => a - b);
  const g = all.length ? all[Math.floor(all.length / 2)] : fallback;
  for (let j = 0; j < N; j++) {
    const w = [];
    for (let k = Math.max(0, j - half); k <= Math.min(N - 1, j + half); k++) if (Number.isFinite(ratios[k])) w.push(ratios[k]);
    w.sort((a, b) => a - b);
    const m = w.length ? w[Math.floor(w.length / 2)] : g;
    out[j] = Math.min(g * 4, Math.max(g / 4, m));
  }
  return out;
}

// Bonus for a boundary at every frame boundary: strongest onset within +-win seconds.
function boundaryBonus(onset, onsetFps, fps, T, win, cap) {
  const b = new Float32Array(T + 1);
  for (let f = 0; f <= T; f++) {
    const tc = (f - 0.5) / fps;
    const i0 = Math.max(0, Math.floor((tc - win) * onsetFps));
    const i1 = Math.min(onset.length - 1, Math.ceil((tc + win) * onsetFps));
    let m = 0;
    for (let i = i0; i <= i1; i++) if (onset[i] > m) m = onset[i];
    b[f] = Math.min(cap, m);
  }
  return b;
}

// Global ranking of the 12 transpositions from the mean chroma: returns the shifts sorted by
// decreasing correlation between the mean chroma and the chord-weighted template profile.
export function rankTranspositions(feat, events, chordSet, priorBeats) {
  const T = feat.frames;
  const mean = new Float64Array(12);
  for (let t = 0; t < T; t++) for (let k = 0; k < 12; k++) mean[k] += feat.chroma[t * 12 + k];
  const prof = new Float64Array(12);
  events.forEach((ev, j) => {
    const c = chordSet.chordOf[j];
    if (c < 0) return;
    const w = priorBeats[j] > 0 ? priorBeats[j] : 1;
    for (let k = 0; k < 12; k++) prof[k] += w * chordSet.chords[c].weights[k];
  });
  const corr = (a, b) => {
    let ma = 0, mb = 0;
    for (let k = 0; k < 12; k++) { ma += a[k]; mb += b[k]; }
    ma /= 12; mb /= 12;
    let s = 0, na = 0, nb = 0;
    for (let k = 0; k < 12; k++) { s += (a[k] - ma) * (b[k] - mb); na += (a[k] - ma) ** 2; nb += (b[k] - mb) ** 2; }
    return s / (Math.sqrt(na * nb) + 1e-12);
  };
  const out = [];
  for (let sh = 0; sh < 12; sh++) {
    const shifted = new Float64Array(12);
    for (let k = 0; k < 12; k++) shifted[mod12(k + sh)] = prof[k];
    out.push({ shift: sh, corr: corr(mean, shifted) });
  }
  return out.sort((a, b) => b.corr - a.corr);
}

// Aligns `events` ([{ name, rest, priorBeats }]) on the features. Options:
//   shift: semitones the recording is above the sheet (default: search),
//   candidates: how many transpositions are tried in full (default 3, plus 0).
// Returns { startSec[], endSec[], confidence[], shift, shiftMargin, score, scales } or null.
export function alignEvents(feat, events, options = {}) {
  return runSteps(alignEventsSteps(feat, events, options));
}

// Same as alignEvents, as a generator (yields between the Viterbi runs; options.onProgress(0..1)).
export function* alignEventsSteps(feat, events, options = {}) {
  const N = events.length;
  if (N === 0 || feat.frames < 10) return null;
  const fps = feat.fps;
  const T = feat.frames;
  const priorBeats = events.map((e) => (e.priorBeats > 0 ? e.priorBeats : 4));
  const rest = events.map((e) => !!e.rest);
  // music not in the sheet may sit between two sections (events carry `section`)
  const gapBefore = new Uint8Array(N);
  if (options.gaps !== false) for (let j = 1; j < N; j++) if (events[j].section !== undefined && events[j].section !== events[j - 1].section) gapBefore[j] = 1;
  const chordSet = buildChordSet(events);
  let bonus = options.onset ? boundaryBonus(options.onset, feat.onsetFps, fps, T, 0.06, 6) : null;
  if (options.gridBonus) {
    const g = new Float32Array(T + 1);
    for (let f = 0; f <= T; f++) g[f] = (bonus ? bonus[f] : 0) + options.gridBonus[f];
    bonus = g;
  }
  // sections that can be skipped, and the cost of skipping the last events (null: nothing is skipped)
  let segs = null;
  let tailCost = null;
  let headCost = null;
  if (options.skips !== false && events.some((e) => e.section !== undefined)) {
    segs = [];
    for (let j = 0; j < N; j++) {
      if (events[j].section === undefined) continue;
      let b = j;
      while (b + 1 < N && events[b + 1].section === events[j].section) b++;
      // (the last sections are skipped by the tail rule only, which checks that the audio really ends)
      if (b < N - 1) {
        const per = options.skipCost && options.skipCost[events[j].section] !== undefined ? options.skipCost[events[j].section] : options.skipMid ?? SKIP_MID;
        segs.push({ a: j, b, cost: per * (b - j + 1) });
      }
      j = b;
    }
    tailCost = new Float64Array(N).fill(options.skipTail ?? SKIP_TAIL);
    headCost = options.skipHead === false ? null : new Float64Array(N).fill(options.skipHead ?? SKIP_HEAD);
  }
  const kappa = options.kappa ?? 0.5;
  const sumPrior = priorBeats.reduce((a, b) => a + b, 0);
  const s0 = options.s0Frac ? (T * 0.95) / (sumPrior * options.s0Frac) : (T * 0.95) / sumPrior; // frames per prior beat, whole recording

  const total = (options.candidates ?? 3) + 1 + 3; // runs, upper bound (progress only)
  let done = 0;
  const step = () => { done++; if (options.onProgress) options.onProgress(Math.min(1, done / total)); };
  const run = function* (shift, stages, skipsOn = true) {
    const em = yield* emissions(feat, chordSet.chords, shift, options.gChroma ?? G_CHROMA, options.gBass ?? G_BASS);
    yield;
    const cumE = cumulative(em.em, em.D, T);
    yield;
    const cumG = new Float64Array(T + 1);
    const cumG0 = new Float64Array(T + 1);
    const cumGT = new Float64Array(T + 1);
    // best chord of every frame (chord by chord: sequential reads)
    const best = new Float32Array(T).fill(-Infinity);
    for (let c = 0; c < em.D; c++) {
      const base = c * T;
      for (let t = 0; t < T; t++) if (em.em[base + t] > best[t]) best[t] = em.em[base + t];
      if ((c & 7) === 7) yield;
    }
    for (let t = 0; t < T; t++) {
      const m = best[t];
      cumG[t + 1] = cumG[t] + (Number.isFinite(m) ? Math.max(0, m - (options.gapFrame ?? GAP_FRAME)) : 0);
      cumG0[t + 1] = cumG0[t] + (Number.isFinite(m) ? Math.max(0, m - (options.introFrame ?? INTRO_FRAME)) : 0);
      cumGT[t + 1] = cumGT[t] + (Number.isFinite(m) ? Math.max(0, m - (options.trailFrame ?? TRAIL_FRAME)) : 0);
    }
    yield;
    let scales = new Float64Array(N).fill(s0);
    let res = null;
    let strideNow = 2;
    let lastExpected = null;
    let lastSigma = 1;
    for (const st of stages) {
      const stride = st.stride;
      const U = Math.floor(T / stride);
      const lo = new Int32Array(N);
      const hi = new Int32Array(N).fill(U);
      const dmin = new Int32Array(N);
      const dmax = new Int32Array(N);
      const expected = new Float64Array(N);
      for (let j = 0; j < N; j++) {
        const m = rest[j] ? Math.max(priorBeats[j] * scales[j], 1) : priorBeats[j] * scales[j];
        expected[j] = Math.max(m, stride);
        dmin[j] = Math.max(1, Math.floor((st.dminF * m) / stride));
        dmax[j] = Math.max(dmin[j] + 1, Math.ceil((st.dmaxF * m) / stride));
        if (res && st.band) {
          // the previous path must stay feasible inside the band
          const dp = ((res.ends[j] - res.starts[j]) * res.stride) / stride;
          dmin[j] = Math.max(1, Math.min(dmin[j], Math.floor(dp)));
          dmax[j] = Math.max(dmax[j], Math.ceil(dp));
          const centre = (res.ends[j] * res.stride) / stride;
          const w = (st.band * fps) / stride;
          lo[j] = Math.max(0, Math.floor(centre - w));
          hi[j] = Math.min(U, Math.ceil(centre + w));
        }
      }
      const r = yield* viterbi({ cumE, cumG, cumG0, cumGT, T, chordOf: chordSet.chordOf, N, stride, lo, hi, dmin, dmax, expected, sigma: st.sigma, lambda: options.lambda ?? 8, bonus, kappa, gapBefore, gapStart: options.gapStart ?? GAP_START, segs: skipsOn ? segs : null, tailCost: skipsOn ? tailCost : null, headCost: skipsOn ? headCost : null, skipGapExtra: options.skipGapExtra ?? SKIP_GAP_EXTRA });
      if (!r) return null;
      res = r;
      strideNow = stride;
      lastExpected = expected;
      lastSigma = st.sigma;
      const durs = Array.from(res.ends, (e, j) => (e - res.starts[j]) * stride);
      scales = localScales(durs, priorBeats, rest, 6, s0, res.skipped);
      step();
      yield;
    }
    return { res, em, cumE, cumG, cumG0, cumGT, scales, stride: strideNow, expected: lastExpected, sigma: lastSigma };
  };

  let shifts;
  if (Number.isInteger(options.shift)) shifts = [options.shift];
  else {
    const rank = rankTranspositions(feat, events, chordSet, priorBeats);
    const set = new Set(rank.slice(0, options.candidates ?? 3).map((r) => r.shift));
    set.add(0);
    shifts = Array.from(set);
  }
  const coarse = [{ stride: 2, dminF: 0.2, dmaxF: 5, sigma: 1.0 }];
  const results = [];
  for (const sh of shifts) {
    // (the choice of the transposition and its margin are made without skips: they would make every wrong one look decent)
    const r = yield* run(sh, coarse, false);
    if (r) results.push({ shift: sh, score: r.res.score });
  }
  if (!results.length) return null;
  results.sort((a, b) => b.score - a.score);
  const shift = results[0].shift;
  const shiftMargin = results.length > 1 ? results[0].score - results[1].score : Infinity;
  const stages = [
    { stride: 2, dminF: 0.2, dmaxF: 5, sigma: 1.0 },
    { stride: 1, dminF: 0.3, dmaxF: 3.2, sigma: 0.6, band: 3 },
    { stride: 1, dminF: 0.35, dmaxF: 2.8, sigma: 0.5, band: 1.5 },
  ];
  const fin = yield* run(shift, stages);
  if (!fin) return null;
  const { res } = fin;
  const stride = res.stride;
  const toSec = (u) => Math.max(0, (u * stride - 0.5) / fps);
  const startSec = Array.from(res.starts, toSec);
  const endSec = Array.from(res.ends, toSec);
  const startFrame = Array.from(res.starts, (u) => u * stride);
  const endFrame = Array.from(res.ends, (u) => u * stride);
  // confidence per event
  yield;
  const cumCos = cumulative(fin.em.cos, fin.em.D, T);
  yield;
  const Tp = T + 1;
  const confidence = new Float64Array(N);
  const skipped = Array.from(res.skipped || new Uint8Array(N), (v) => !!v);
  for (let j = 0; j < N; j++) {
    if ((j & 7) === 7) yield;
    const c = chordSet.chordOf[j];
    const a = startFrame[j];
    const b = endFrame[j];
    if (skipped[j]) { confidence[j] = 0; continue; }
    if (c < 0 || b - a < 1) { confidence[j] = 0.3; continue; }
    const mean = (cc) => (cumCos[cc * Tp + b] - cumCos[cc * Tp + a]) / (b - a);
    const own = mean(c);
    let other = -Infinity;
    for (let cc = 0; cc < fin.em.D; cc++) if (cc !== c) other = Math.max(other, mean(cc));
    let conf = Number.isFinite(other) ? Math.max(0, Math.min(1, (own - other) / 0.2 + 0.5)) : 0.5;
    const same = (k) => k >= 0 && k < N && chordSet.chordOf[k] === c;
    if (same(j - 1) || same(j + 1)) conf *= 0.6;
    confidence[j] = conf;
  }
  // sharpness of every start boundary: how much worse the path gets when that change is moved by
  // +-0.25 / 0.5 / 1 s (the two events around it keep their other end), per frame of displacement
  const lambda = options.lambda ?? 8;
  const penOf = (j, d) => (d < 1 ? Infinity : (lambda * Math.log(d / fin.expected[j]) ** 2) / (2 * fin.sigma * fin.sigma));
  const segOf = (j, a, b) => (chordSet.chordOf[j] >= 0 ? fin.cumE[chordSet.chordOf[j] * Tp + b] - fin.cumE[chordSet.chordOf[j] * Tp + a] : 0);
  const sharpness = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    if ((j & 7) === 7) yield;
    if (skipped[j]) continue;
    const b0 = startFrame[j];
    let pj = j - 1;
    while (pj >= 0 && skipped[pj]) pj--;
    const coupled = pj === j - 1 && j > 0 && startFrame[j] - endFrame[j - 1] <= 0; // no gap before: the previous event stretches too
    // the gap before (or the free stretch before the first event) scores its frames: moving the start changes it too
    const G = pj < 0 ? fin.cumG0 : fin.cumG;
    const S = (b) => {
      let v = segOf(j, b, endFrame[j]) - penOf(j, endFrame[j] - b) + (kappa * (bonus ? bonus[b] : 0));
      if (coupled) v += segOf(j - 1, startFrame[j - 1], b) - penOf(j - 1, b - startFrame[j - 1]);
      else v += G[b] - G[b0];
      return v;
    };
    let lowLimit = coupled ? startFrame[j - 1] + 1 : Math.max(0, b0 - Math.ceil(fps * 1.5));
    if (!coupled && pj >= 0) lowLimit = Math.max(lowLimit, endFrame[pj]);
    const highLimit = endFrame[j] - 1;
    const base = S(b0);
    const ms = [];
    for (const dsec of MARGIN_SHIFTS) {
      const df = Math.round(dsec * fps);
      for (const sg of [-1, 1]) {
        const b = b0 + sg * df;
        if (b < lowLimit || b > highLimit) continue;
        const v = S(b);
        if (Number.isFinite(v)) ms.push((base - v) / df);
      }
    }
    ms.sort((a, c) => a - c);
    sharpness[j] = ms.length ? Math.max(0, ms[ms.length >> 1]) : 0;
  }
  const gaps = [];
  // the first event has no neighbour that stretches with it: its start is believed when its chord is heard after the
  // start and not before it (silence, or other music: an intro of the recording that is not in the sheet)
  const startEvidence = new Float64Array(N).fill(NaN);
  for (let j = 0; j < N; j++) {
    if (skipped[j]) continue;
    const c = chordSet.chordOf[j];
    const a = startFrame[j];
    const w = Math.max(2, Math.round(fps));
    if (c >= 0 && a > 0 && endFrame[j] - a >= 1) {
      const m = (x0, x1) => (x1 > x0 ? (cumCos[c * Tp + x1] - cumCos[c * Tp + x0]) / (x1 - x0) : 0);
      startEvidence[j] = m(a, Math.min(endFrame[j], a + w)) - m(Math.max(0, a - w), a);
    } else if (c >= 0 && a === 0) startEvidence[j] = 1;
    break;
  }
  let lastPresent = -1;
  for (let j = 0; j < N; j++) {
    if (skipped[j]) continue;
    if (lastPresent >= 0 && (res.starts[j] - res.ends[lastPresent]) * stride >= fps) gaps.push({ before: j, prev: lastPresent, startSec: endSec[lastPresent], endSec: startSec[j] });
    lastPresent = j;
  }
  return { startSec, endSec, confidence, sharpness, startEvidence, gaps, skipped, shift, shiftMargin, shiftScore: results[0].score, score: res.score, scales: fin.scales, chordSet, features: null };
}

// Moves every boundary to the strongest onset within +-win seconds (if strong enough). The
// onset envelope peaks a little before the attack in the STFT frame: `lead` seconds are added.
// `startSec` has one entry per event; entry 0 is refined too. Returns a new array.
export function snapToOnsets(startSec, onset, onsetFps, { win = 0.14, minStrength = 1.8, lead = 0 } = {}) {
  const out = Array.from(startSec);
  for (let j = 0; j < out.length; j++) {
    const prevT = j ? out[j - 1] : -Infinity;
    const nextT = j + 1 < startSec.length ? startSec[j + 1] : Infinity;
    const w = Math.min(win, 0.4 * (startSec[j] - (j ? startSec[j - 1] : startSec[j] - 1)), win);
    const i0 = Math.max(1, Math.floor((startSec[j] - win) * onsetFps));
    const i1 = Math.min(onset.length - 2, Math.ceil((startSec[j] + win) * onsetFps));
    let best = -1;
    let bv = 0;
    for (let i = i0; i <= i1; i++) {
      if (onset[i] < onset[i - 1] || onset[i] <= onset[i + 1]) continue;
      const dt = Math.abs(i / onsetFps - startSec[j]);
      const v = onset[i] * (1 - 0.5 * (dt / win));
      if (v > bv) { bv = v; best = i; }
    }
    if (best >= 0 && onset[best] >= minStrength && w >= 0) {
      const t = best / onsetFps + lead;
      if (t > prevT + 0.15 && t < nextT - 0.15) out[j] = t;
    }
  }
  return out;
}

// Moves the boundaries lying within `tol` beats of a tracked beat (or, with `half`, of a half
// beat) onto it.
export function snapToBeats(times, beatTimes, bpm, tol = 0.2, half = false) {
  const p = 60 / bpm;
  const grid = [];
  for (let i = 0; i < beatTimes.length; i++) {
    grid.push(beatTimes[i]);
    if (half && i + 1 < beatTimes.length) grid.push((beatTimes[i] + beatTimes[i + 1]) / 2);
  }
  return times.map((t) => {
    let best = null;
    let bd = Infinity;
    for (const b of grid) {
      const d = Math.abs(b - t);
      if (d < bd) { bd = d; best = b; }
      else if (b > t) break;
    }
    return best !== null && bd <= tol * p ? best : t;
  });
}

// Boundary bonus from beat grids (an array of { times, bpm, from, to } for stretches of stable
// tempo): up to `gamma` for a boundary right on a beat or half beat, falling to 0 at `width`
// seconds (relative to the half-beat period) from it. Indexed like the Viterbi boundaries (frame).
export function gridBonusFrames(grids, fps, T, { gamma = 4, width = 0.3 } = {}) {
  const out = new Float32Array(T + 1);
  for (const g of grids) {
    const half = 30 / g.bpm;
    const pts = [];
    for (let i = 0; i < g.times.length; i++) {
      pts.push(g.times[i]);
      pts.push(g.times[i] + half);
    }
    let k = 0;
    const f0 = Math.max(0, Math.floor(g.from * fps));
    const f1 = Math.min(T, Math.ceil(g.to * fps));
    for (let f = f0; f <= f1; f++) {
      const t = (f - 0.5) / fps;
      while (k + 1 < pts.length && pts[k + 1] < t) k++;
      let d = Math.abs(pts[k] - t);
      if (k + 1 < pts.length) d = Math.min(d, Math.abs(pts[k + 1] - t));
      out[f] += gamma * Math.max(0, 1 - d / (width * half * 2));
    }
  }
  return out;
}
