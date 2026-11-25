// Automatic sync orchestrator (pure): from the decoded audio and the song, finds the start of every
// chord event, the tempo of every section and the transposition/tuning of the recording.

import { resampleMono, computeFeaturesSteps, FEATURE_RATE } from './features.js';
import { runSteps } from './steps.js';
import { tempoCurves, curveOfRange, pickTempo, trackBeats, summariseBeats } from './beats.js';
import { alignEventsSteps, snapToOnsets, snapToBeats, gridBonusFrames } from './align.js';
import { estimateSongDurations } from '../durations.js';
import { effectiveSectionBpms } from '../model.js';

const ONSET_LEAD = 0;
const BPM_CONF_MIN = 0.35;
const BPM_REGULARITY_MIN = 0.8;
// Confidence of a change from the sharpness of its boundary (how much worse the path gets when it is moved,
// per frame of displacement; correct changes of the synthetic benches: 3.4 at the 10th percentile, 5 median).
// With a stable beat 3 or more is full confidence; without one (free tempo: the chords arrive one note at a time
// and the path can sit on a wrong but sharp boundary) the confidence tops at FREE_CONF_MAX and needs 4.5.
const SHARP_LO = 0.8;
const SHARP_FULL = 3;
const FREE_SHARP_LO = 2;
const FREE_SHARP_FULL = 4.5;
export const FREE_CONF_MAX = 0.55;
const ramp = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));

// Flat list of the chord events of the song in reading order (the timeline order), with the prior
// duration in beats: the stored ones, or the estimate from the text if the song has default ones.
export function songEvents(song) {
  const base = song.timingSource === 'default' ? estimateSongDurations(song) : song;
  const out = [];
  song.sections.forEach((sec, si) => {
    sec.lines.forEach((line, li) => {
      line.chords.forEach((c, ci) => {
        const b = base.sections[si].lines[li].chords[ci].beats;
        out.push({ name: c.name, rest: !!c.rest, priorBeats: Math.max(1, Number(b) || 4), section: si, line: li, chord: ci });
      });
    });
  });
  return out;
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Semitones in (-6, 6].
function wrapSemis(n) {
  const m = ((n % 12) + 12) % 12;
  return m > 6 ? m - 12 : m;
}

// samples: mono Float32Array at sampleRate. Returns
// { eventStartSec[], eventEndSec[], confidence[], sections: [{ startSec, endSec, bpm, confidence,
//   bpmConfidence, beatGrid }], eventBeats[], transposeFound, transposeMargin, tuningCents,
//   computeMs, timings }
export function analyseAndAlign(args) {
  return runSteps(analyseAndAlignSteps(args));
}

// Same computation as a generator (yields every few tens of ms of work): drive it with runSteps (all at
// once) or runStepsAsync (slices with an await between them, progress bar and cancel in the app).
// onProgress(0..1) is called along the way.
export function* analyseAndAlignSteps({ samples, sampleRate, song, onProgress = null, now = () => Date.now(), opts = {} }) {
  const t0 = now();
  const timings = {};
  const lap = (k, since) => { timings[k] = now() - since; return now(); };
  let tk = now();
  const x = resampleMono(samples, sampleRate, FEATURE_RATE);
  tk = lap('resample', tk);
  yield;
  const feat = yield* computeFeaturesSteps(x, { ...(opts.feat || {}), onProgress: onProgress ? (f) => onProgress(0.05 + 0.45 * f) : null });
  tk = lap('features', tk);
  const events = songEvents(song);
  // the capo is not considered: the written chords are the sounding ones (see transpose.js)
  let al = yield* alignEventsSteps(feat, events, { onset: feat.onset, onProgress: onProgress ? (f) => onProgress(0.5 + 0.3 * f) : null, ...(opts.align || {}) });
  tk = lap('align', tk);
  if (onProgress) onProgress(0.8);
  yield;
  if (!al) return null;
  const N = events.length;
  const hints = effectiveSectionBpms(song);
  const tg = tempoCurves(feat.onset, feat.onsetFps);
  yield;
  let { startSec, endSec, sections, eventBeats, grids, confidence } = yield* describe(al);
  let finalAl = al;
  if (opts.regrid && grids.length) {
    // second pass: the boundaries of the stable stretches are drawn to the beat / half-beat grid
    const gb = gridBonusFrames(grids, feat.fps, feat.frames, { gamma: opts.gridGamma ?? 4, width: opts.gridWidth ?? 0.3 });
    const al2 = yield* alignEventsSteps(feat, events, { onset: feat.onset, ...(opts.align || {}), shift: al.shift, gridBonus: gb });
    if (al2) { finalAl = al2; ({ startSec, endSec, sections, eventBeats, grids, confidence } = yield* describe(al2)); }
  }
  tk = lap('regrid', tk);

  // tempo, beat grid and boundary refinement from an alignment
  function* describe(a0) {
    const sections = [];
    const grids = [];
    // boundaries refined on the attacks (the DP grid is 93 ms)
    const startSec = snapToOnsets(a0.startSec, feat.onset, feat.onsetFps, { lead: ONSET_LEAD });
    const endSec = startSec.slice(1).concat([Math.max(startSec[N - 1], a0.endSec[N - 1])]);
    const eventBeats = new Array(N).fill(null);
    const pendingBeats = [];
    const confidence = Array.from(a0.confidence);
    for (let si = 0; si < song.sections.length; si++) {
      yield;
      const idx = [];
      events.forEach((e, j) => { if (e.section === si) idx.push(j); });
      if (!idx.length) {
        sections.push({ startSec: null, endSec: null, bpm: null, confidence: 0, bpmConfidence: 0, beatGrid: false });
        continue;
      }
      const secStart = startSec[idx[0]];
      const secEnd = endSec[idx[idx.length - 1]];
      // tempo: the part of the section after its first beat of settling
      const a = secStart + Math.min(1.5, (secEnd - secStart) * 0.1);
      const curve = curveOfRange(tg, a, secEnd);
      const pick = pickTempo(tg.bpms, curve, { hints: [hints[si]] });
      let bpm = null;
      let beatGrid = false;
      let beatTimes = null;
      let bpmConf = pick.conf;
      let reg = 0;
      if (secEnd - secStart >= 6) {
        const tb = trackBeats(feat.onset, feat.onsetFps, a, secEnd, pick.bpm);
        const sm = summariseBeats(tb.times);
        reg = sm.regularity;
        if (sm.bpm && Math.abs(sm.bpm / pick.bpm - 1) < 0.06 && pick.conf >= BPM_CONF_MIN && reg >= BPM_REGULARITY_MIN) {
          bpm = Math.round(sm.bpm * 10) / 10;
          beatGrid = true;
          beatTimes = tb.times;
          grids.push({ times: tb.times, bpm: sm.bpm, from: secStart, to: secEnd });
        }
        bpmConf = Math.min(1, pick.conf) * (0.5 + 0.5 * reg);
      }
      // confidence of the changes (stable beat or not), and of the section: the median of its changes
      for (const j of idx) {
        const sh = a0.sharpness ? a0.sharpness[j] : Infinity;
        confidence[j] = Math.min(a0.confidence[j], beatGrid ? ramp(sh, SHARP_LO, SHARP_FULL) : FREE_CONF_MAX * ramp(sh, FREE_SHARP_LO, FREE_SHARP_FULL));
      }
      const conf = median(idx.map((j) => confidence[j]));
      sections.push({ startSec: secStart, endSec: secEnd, bpm, confidence: conf, bpmConfidence: bpmConf, beatGrid, tempoCandidate: pick.bpm, regularity: reg, beatTimes });
      if (beatGrid) {
        const snapped = snapToBeats(idx.map((j) => startSec[j]), beatTimes, bpm, opts.snapTol ?? 0.2, !!opts.snapHalf);
        idx.forEach((j, k) => { startSec[j] = snapped[k]; });
        pendingBeats.push({ idx, bpm });
      }
    }
    // an event that precedes music not in the sheet ends where that music starts
    const gapEnd = new Map((a0.gaps || []).map((g) => [g.before - 1, g.startSec]));
    for (let j = 0; j < N; j++) endSec[j] = j + 1 < N ? (gapEnd.has(j) ? Math.min(startSec[j + 1], Math.max(startSec[j], gapEnd.get(j))) : startSec[j + 1]) : endSec[j];
    for (const { idx, bpm } of pendingBeats) for (const j of idx) eventBeats[j] = Math.max(1, Math.round(((endSec[j] - startSec[j]) * bpm) / 60));
    sections.forEach((s, i) => {
      const e = events.map((ev, j) => (ev.section === i ? j : -1)).filter((j) => j >= 0);
      if (e.length) { s.startSec = startSec[e[0]]; s.endSec = endSec[e[e.length - 1]]; }
    });
    return { startSec, endSec, sections, eventBeats, grids, confidence };
  }
  al = finalAl;
  if (onProgress) onProgress(1);
  return {
    eventStartSec: startSec,
    eventEndSec: endSec,
    confidence,
    sharpness: Array.from(al.sharpness),
    sections,
    eventBeats,
    gaps: (al.gaps || []).map((g) => ({ before: g.before, startSec: endSec[g.before - 1], endSec: startSec[g.before] })).filter((g) => g.endSec - g.startSec >= 1),
    transposeFound: wrapSemis(al.shift),
    transposeMargin: al.shiftMargin,
    transposeScore: al.shiftScore,
    tuningCents: feat.tuningCents,
    computeMs: now() - t0,
    timings,
  };
}
