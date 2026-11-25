// Automatic sync orchestrator (pure): from the decoded audio and the song, finds the start of every
// chord event, the tempo of every section and the transposition/tuning of the recording.

import { resampleMono, computeFeaturesSteps, FEATURE_RATE } from './features.js';
import { runSteps } from './steps.js';
import { tempoCurves, curveOfRange, pickTempo, trackBeats, summariseBeats } from './beats.js';
import { alignEventsSteps, snapToOnsets, snapToBeats, gridBonusFrames, chordTemplate, shiftedTemplate } from './align.js';
import { freeBoundary, FREE_CONF_MAX } from './refine.js';
import { estimateSongDurations } from '../durations.js';
import { effectiveSectionBpms } from '../model.js';
import { GAP_MIN_SEC } from '../alignment.js';

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
// changes whose implied tempo is more than 15% off lose confidence (none left at 60% off); a section where more than
// BAD_SHARE_LO of the changes are off cannot be green
const TEMPO_TOL = 0.15;
const TEMPO_BAD = 0.6;
const BAD_SHARE_LO = 0.1;
const BAD_SHARE_HI = 0.35;
// share of the stable sections that must agree with their own tempo for the durations of the sheet to be trusted
const PRIOR_FIT_MIN = 0.6;
const EVID_LO = 0.08;
const EVID_FULL = 0.3;
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

// Tempo implied by the changes of a section: beats of the sheet / seconds between the chosen starts. `ref` is the
// tempo of the section (stable beat) or, without one, the median of the implied tempos. Returns the factor (0..1) of
// every change and the share of the changes more than TEMPO_BAD off the reference.
// Only the changes whose end is the start of the next chord count (`measured[k]`): the last chord of the song, or one
// before a gap, ends with the audio or the music not in the sheet. A tempo twice or half the estimated one is the same
// beat counted differently: it is not an error of the alignment.
function tempoConsistency(idx, events, startSec, endSec, ref, measured) {
  const dev = idx.map((j, k) => {
    if (!measured[k]) return 0;
    const v = (events[j].priorBeats * 60) / Math.max(1e-3, endSec[j] - startSec[j]);
    return Math.min(Math.abs(Math.log(v / ref)), Math.abs(Math.log(v / (2 * ref))), Math.abs(Math.log((2 * v) / ref)));
  });
  const factor = dev.map((d) => 1 - ramp(d, Math.log(1 + TEMPO_TOL), Math.log(1 + TEMPO_BAD)));
  const n = measured.filter(Boolean).length;
  const bad = dev.filter((d) => d > Math.log(1 + TEMPO_TOL)).length;
  return { factor, badShare: n ? bad / n : 0 };
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
// opts.ownsSamples: the samples are not needed by the caller afterwards (the app): they are normalised in place and
// released as soon as the features are computed.
export function* analyseAndAlignSteps({ samples, sampleRate, song, onProgress = null, now = () => Date.now(), opts = {} }) {
  const t0 = now();
  const timings = {};
  const lap = (k, since) => { timings[k] = now() - since; return now(); };
  let tk = now();
  let x = resampleMono(samples, sampleRate, FEATURE_RATE);
  const inPlace = !!opts.ownsSamples && x === samples;
  tk = lap('resample', tk);
  yield;
  const feat = yield* computeFeaturesSteps(x, { ...(opts.feat || {}), inPlace, onProgress: onProgress ? (f) => onProgress(0.05 + 0.45 * f) : null });
  x = null;
  if (opts.ownsSamples) samples = null;
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
  let { startSec, endSec, sections, eventBeats, grids, confidence, gaps, skipped } = yield* describe(al);
  let finalAl = al;
  if (opts.regrid && grids.length) {
    // second pass: the boundaries of the stable stretches are drawn to the beat / half-beat grid
    const gb = gridBonusFrames(grids, feat.fps, feat.frames, { gamma: opts.gridGamma ?? 4, width: opts.gridWidth ?? 0.3 });
    const al2 = yield* alignEventsSteps(feat, events, { onset: feat.onset, ...(opts.align || {}), shift: al.shift, gridBonus: gb });
    if (al2) { finalAl = al2; ({ startSec, endSec, sections, eventBeats, grids, confidence, gaps, skipped } = yield* describe(al2)); }
  }
  tk = lap('regrid', tk);

  // tempo, beat grid and boundary refinement from an alignment
  function* describe(a0) {
    const sections = [];
    const grids = [];
    // boundaries refined on the attacks (the DP grid is 93 ms)
    const skipped = a0.skipped || new Array(N).fill(false);
    const present = [];
    for (let j = 0; j < N; j++) if (!skipped[j]) present.push(j);
    if (!present.length) return null;
    const startSec = new Array(N).fill(0);
    const endSec = new Array(N).fill(0);
    const snapped = snapToOnsets(present.map((j) => a0.startSec[j]), feat.onset, feat.onsetFps, { lead: ONSET_LEAD });
    present.forEach((j, k) => { startSec[j] = snapped[k]; });
    // events that are not in the audio have no time: they sit, with no duration, where the next event starts
    // (or at the end of the last one); the stretch of audio they would fill is a gap before them
    const placeSkipped = () => {
      let nextStart = null;
      for (let j = N - 1; j >= 0; j--) {
        if (!skipped[j]) { nextStart = startSec[j]; continue; }
        startSec[j] = nextStart === null ? endSec[present[present.length - 1]] : nextStart;
        endSec[j] = startSec[j];
      }
    };
    // (stretches shorter than GAP_MIN_SEC are not gaps: the previous chord lasts until the next one)
    const bigGaps = (a0.gaps || []).filter((g) => g.endSec - g.startSec >= GAP_MIN_SEC);
    const gapEnd = new Map(bigGaps.map((g) => [g.prev, g.startSec]));
    // a chord before music that is not in the sheet ends where that music starts: the tempo of its section is measured
    // without the gap
    present.forEach((j, k) => {
      const nx = k + 1 < present.length ? startSec[present[k + 1]] : null;
      endSec[j] = nx === null ? Math.max(startSec[j], a0.endSec[j]) : gapEnd.has(j) ? Math.min(nx, Math.max(startSec[j], gapEnd.get(j))) : nx;
    });
    const eventBeats = new Array(N).fill(null);
    const pendingBeats = [];
    const consList = [];
    const confidence = Array.from(a0.confidence);
    for (let si = 0; si < song.sections.length; si++) {
      yield;
      const idx = [];
      let inSection = 0;
      events.forEach((e, j) => { if (e.section === si) { inSection++; if (!skipped[j]) idx.push(j); } });
      if (!idx.length) {
        sections.push({ startSec: null, endSec: null, bpm: null, confidence: 0, bpmConfidence: 0, beatGrid: false, skipped: inSection > 0 });
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
      // free tempo: every change is refined on the bass and the attacks (the arpeggio shows the chord late), and its
      // confidence comes from the agreement of the two estimators
      const freeConf = new Map();
      if (!beatGrid && opts.refine !== false) {
        const tpl = (j) => { const t = events[j].rest ? null : chordTemplate(events[j].name); return t ? shiftedTemplate(t, ((a0.shift % 12) + 12) % 12) : null; };
        for (let k = 0; k < idx.length; k++) {
          const j = idx[k];
          const next = tpl(j);
          if (!next) continue;
          const pj = present[present.indexOf(j) - 1];
          const minT = pj === undefined ? 0 : startSec[pj] + 0.3;
          const nj = present[present.indexOf(j) + 1];
          const maxT = nj === undefined ? Infinity : startSec[nj] - 0.3;
          if (maxT <= minT) continue;
          const fb = freeBoundary(feat, startSec[j], a0.sharpness ? a0.sharpness[j] : 0, next, pj === undefined ? null : tpl(pj), { minT, maxT });
          startSec[j] = fb.t;
          freeConf.set(j, fb.conf);
        }
      }
      // confidence of the changes (stable beat or not), and of the section: the median of its changes
      for (const j of idx) {
        const sh = a0.sharpness ? a0.sharpness[j] : Infinity;
        confidence[j] = Math.min(a0.confidence[j], beatGrid ? ramp(sh, SHARP_LO, SHARP_FULL) : freeConf.has(j) ? freeConf.get(j) : FREE_CONF_MAX * ramp(sh, FREE_SHARP_LO, FREE_SHARP_FULL));
        // the very first event: its start is judged by what is heard before it (see startEvidence in align.js)
        if (a0.startEvidence && Number.isFinite(a0.startEvidence[j])) confidence[j] = Math.min(a0.confidence[j], ramp(a0.startEvidence[j], EVID_LO, EVID_FULL)) * (beatGrid ? 1 : FREE_CONF_MAX);
      }
      // consistency of the tempo: the tempo implied by the durations of the changes (beats of the sheet / seconds chosen)
      // must stay close to the tempo of the section; changes squeezed or stretched beyond that are not trusted
      // (only on stable-beat sections, and only if the sheet's own durations fit the audio: see below)
      const gapAfter = new Set((a0.gaps || []).map((g) => g.prev));
      const measured = idx.map((j) => present[present.indexOf(j) + 1] === j + 1 && !gapAfter.has(j));
      const cons = beatGrid ? tempoConsistency(idx, events, startSec, endSec, bpm, measured) : null;
      if (cons) consList.push({ si: sections.length, idx, cons });
      const conf = median(idx.map((j) => confidence[j]));
      sections.push({ startSec: secStart, endSec: secEnd, bpm, confidence: conf, badTempoShare: cons ? cons.badShare : 0, bpmConfidence: bpmConf, beatGrid, tempoCandidate: pick.bpm, regularity: reg, beatTimes });
      if (beatGrid) {
        const snapped = snapToBeats(idx.map((j) => startSec[j]), beatTimes, bpm, opts.snapTol ?? 0.2, !!opts.snapHalf);
        idx.forEach((j, k) => { startSec[j] = snapped[k]; });
        pendingBeats.push({ idx, bpm });
      }
    }
    // The durations of the sheet are a reliable yardstick only when most stable sections agree with themselves (exact
    // durations, edited or measured): with guessed durations every section would look off, so nothing is penalised.
    if (consList.length && consList.filter((c) => c.cons.badShare <= 0.2).length / consList.length >= PRIOR_FIT_MIN) {
      for (const { si, idx, cons } of consList) {
        idx.forEach((j, k) => { confidence[j] *= cons.factor[k]; });
        sections[si].confidence = median(idx.map((j) => confidence[j])) * (1 - ramp(cons.badShare, BAD_SHARE_LO, BAD_SHARE_HI));
      }
    }
    // an event that precedes music not in the sheet ends where that music starts
    present.forEach((j, k) => {
      if (k + 1 >= present.length) return;
      const nx = startSec[present[k + 1]];
      endSec[j] = gapEnd.has(j) ? Math.min(nx, Math.max(startSec[j], gapEnd.get(j))) : nx;
    });
    placeSkipped();
    for (const { idx, bpm } of pendingBeats) for (const j of idx) eventBeats[j] = Math.max(1, Math.round(((endSec[j] - startSec[j]) * bpm) / 60));
    sections.forEach((s, i) => {
      const e = events.map((ev, j) => (ev.section === i && !skipped[j] ? j : -1)).filter((j) => j >= 0);
      if (e.length) { s.startSec = startSec[e[0]]; s.endSec = endSec[e[e.length - 1]]; }
    });
    const gaps = bigGaps.map((g) => ({ before: g.prev + 1, startSec: endSec[g.prev], endSec: startSec[g.before] })).filter((g) => g.endSec - g.startSec >= GAP_MIN_SEC);
    return { startSec, endSec, sections, eventBeats, grids, confidence, gaps, skipped };
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
    gaps,
    skipped,
    transposeFound: wrapSemis(al.shift),
    transposeMargin: al.shiftMargin,
    transposeScore: al.shiftScore,
    tuningCents: feat.tuningCents,
    computeMs: now() - t0,
    timings,
  };
}
