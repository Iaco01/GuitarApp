// Automatic sync orchestrator (pure): from the decoded audio and the song, finds the start of every
// chord event, the tempo of every section and the transposition/tuning of the recording.

import { resampleMono, computeFeaturesSteps, FEATURE_RATE } from './features.js';
import { runSteps } from './steps.js';
import { tempoCurvesSteps, curveOfRange, pickTempo, trackBeats, summariseBeats } from './beats.js';
import { alignEventsSteps, snapToOnsets, snapToBeats, gridBonusFrames, chordTemplate, shiftedTemplate } from './align.js';
import { freeBoundary, FREE_CONF_MAX } from './refine.js';
import { estimateSongDurations } from '../durations.js';
import { effectiveSectionBpms } from '../model.js';
import { GAP_MIN_SEC, sectionState } from '../alignment.js';
import { smoothBeatGrid, gridTimes } from '../beatgrid.js';
import { sisterGroups, sisterFlags, offGridShare } from './coherence.js';

const ONSET_LEAD = 0;
// The onsets and chord starts the engine finds sit this much after the real attack (median 16-42 ms on the synthetic benches
// with and without drums, whatever the tempo): every time is moved back by it, so that the clicks fall on the attacks
const ENGINE_LAG_SEC = 0.025;
// the last chord is held until its sound has dropped to this share of its level at the attack (or the audio ends): the clicks stop there
const MUSIC_END_SHARE = 0.3;
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
// coherence checks that do not depend on the durations of the sheet (see coherence.js): a section that cannot be green
// is capped just under the green threshold; one that is certainly wrong (far from its sisters) is capped in the red
const COH_CAP_YELLOW = 0.7;
const COH_CAP_RED = 0.4;
// a stable-beat section whose changes mostly miss the beat grid cannot be green
const OFF_GRID_MAX = 0.5;
// the section that is far shorter than its sisters is tried again with a cheaper skip (per event)
const SKIP_SUSPECT = 2;
// the audio may be shorter than the sheet: fractions of the sheet that the audio is supposed to cover, tried when the
// result with the whole sheet looks poor (see alignEventsSteps: s0Frac) and covering the whole sheet would need a tempo
// above COVER_MIN_BPM (the beats of the sheet divided by the length of the audio): a recording of the whole song, even a
// noisy one, does not need these extra runs
const COVER_TRIES = [0.7, 0.45, 0.28, 0.18, 0.1];
const COVER_MIN_BPM = 190;
// share of the sections (not skipped) that must not be red for the result to be called decent
const DECENT_SHARE = 0.6;
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

// Where the sound of the last chord (struck at `t`) has dropped below MUSIC_END_SHARE of its level at the attack, but never after
// the music (see features.js) ends and not before a beat has passed.
function lastChordEnd(feat, t) {
  const fps = feat.fps;
  const i0 = Math.max(0, Math.min(feat.frames - 1, Math.floor(t * fps)));
  const att = [];
  for (let i = i0; i <= Math.min(feat.frames - 1, i0 + Math.ceil(0.6 * fps)); i++) att.push(feat.energy[i]);
  const level = median(att);
  let end = i0;
  for (let i = i0; i < feat.frames; i++) if (feat.energy[i] >= MUSIC_END_SHARE * level) end = i;
  return Math.min(feat.musicEndSec, Math.max(feat.musicEndSec * 0, ((end + 1) / fps)));
}

// Is the stretch of a gap the decay of the chord before it? Its mean chroma is closer to that chord than to any other chord of
// the sheet (an echo, a held chord dying out), or the energy has fallen to a few percent of the attack (a pause).
const GAP_TAIL_COS = 0.7;
const GAP_SILENT_SHARE = 0.08;
function gapIsTail(feat, g, events, shift) {
  const fps = feat.fps;
  const f0 = Math.max(0, Math.floor(g.startSec * fps));
  const f1 = Math.min(feat.frames, Math.ceil(g.endSec * fps));
  if (f1 <= f0) return false;
  const m = new Float64Array(12);
  let en = 0;
  for (let t = f0; t < f1; t++) { for (let c = 0; c < 12; c++) m[c] += feat.chroma[t * 12 + c]; en += feat.energy[t]; }
  en /= f1 - f0;
  // level of the chord before it at its attack
  const a0f = Math.max(0, Math.floor((g.startSec - 1.5) * fps));
  let att = 0;
  for (let t = a0f; t < f0 && t < feat.frames; t++) att = Math.max(att, feat.energy[t]);
  if (att > 0 && en < GAP_SILENT_SHARE * att) return true;
  const cosOf = (name) => {
    const tp = events.some((e) => e.name === name) ? chordTemplate(name) : null;
    if (!tp) return -1;
    const w = shiftedTemplate(tp, ((shift % 12) + 12) % 12).weights;
    let sd = 0, a = 0, b = 0;
    for (let i = 0; i < 12; i++) { sd += w[i] * m[i]; a += w[i] * w[i]; b += m[i] * m[i]; }
    return sd / Math.sqrt(a * b + 1e-12);
  };
  const prev = events[g.prev];
  if (!prev || prev.rest) return false;
  const cp = cosOf(prev.name);
  let best = -1;
  for (const name of new Set(events.filter((e) => !e.rest).map((e) => e.name))) if (name !== prev.name) best = Math.max(best, cosOf(name));
  return cp >= GAP_TAIL_COS && cp >= best;
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
  const tg = yield* tempoCurvesSteps(feat.onset, feat.onsetFps);
  yield;
  const first = yield* describe(al);
  if (!first) return null;
  let cur = { al, ...first };
  // two situations that the first pass can get wrong, both seen on a real recording (see searchBetter):
  // the audio is shorter than the sheet (the sections are squeezed into it) and a whole section of the sheet is not in
  // the audio (its neighbours are squeezed instead)
  if (opts.search !== false) cur = yield* searchBetter(al, cur);
  al = cur.al;
  const searchLog = cur.searchLog || [];
  let { startSec, endSec, sections, eventBeats, grids, confidence, gaps, skipped, sisters } = cur;
  let finalAl = al;
  if (opts.regrid && grids.length) {
    // second pass: the boundaries of the stable stretches are drawn to the beat / half-beat grid
    const gb = gridBonusFrames(grids, feat.fps, feat.frames, { gamma: opts.gridGamma ?? 4, width: opts.gridWidth ?? 0.3 });
    const al2 = yield* alignEventsSteps(feat, events, { onset: feat.onset, ...(opts.align || {}), shift: al.shift, gridBonus: gb });
    if (al2) { finalAl = al2; ({ startSec, endSec, sections, eventBeats, grids, confidence, gaps, skipped, sisters } = yield* describe(al2)); }
  }
  tk = lap('regrid', tk);

  // How many events every section has, and how well a described alignment fits: events of green sections count 1, of
  // yellow ones 0.5 (a small share of the confidences breaks the ties); skipped sections count nothing.
  function sectionSizes() {
    const n = song.sections.map(() => 0);
    events.forEach((e) => { n[e.section]++; });
    return n;
  }
  function fit(d, except = null) {
    const sizes = sectionSizes();
    let g = 0;
    d.sections.forEach((s, si) => {
      if (!sizes[si] || s.skipped || (except && except.includes(si))) return;
      const st = sectionState({ sections: d.sections }, si);
      g += sizes[si] * (st === 'green' ? 1 : st === 'yellow' ? 0.5 : 0) + 0.02 * sizes[si] * s.confidence;
    });
    return g;
  }
  function decent(d) {
    const sizes = sectionSizes();
    let n = 0;
    let red = 0;
    d.sections.forEach((s, si) => {
      if (!sizes[si] || s.skipped) return;
      n++;
      if (sectionState({ sections: d.sections }, si) === 'red') red++;
    });
    return n > 0 && 1 - red / n >= DECENT_SHARE;
  }
  // sections that are far shorter than their sisters (same chords): a section that the audio lacks leaves its neighbours
  // squeezed, and the engine pays 12 per event to skip it
  function suspects(d) {
    const out = [];
    (d.sisters || []).forEach((f, si) => { if (f && f.kind === 'short' && !d.sections[si].skipped) out.push(si); });
    return out;
  }
  function* searchBetter(a1, d1) {
    let best = { al: a1, ...d1 };
    const dbg = [];
    dbg.push(`first: fit ${fit(d1).toFixed(1)}, ${decent(d1) ? 'decent' : 'poor'}`);
    // (1) a result that is poor as a whole: the audio may cover only the first part of the sheet. The frames per beat that
    // the first pass starts from assume that the audio covers the whole sheet; try shorter parts
    const sumPrior = events.reduce((a, e) => a + e.priorBeats, 0);
    const audioSec = feat.frames / feat.fps;
    const impliedBpm = (f) => (60 * sumPrior * f) / audioSec;
    if (!decent(best) && impliedBpm(1) > COVER_MIN_BPM) {
      const share = (d) => {
        let all = 0;
        let here = 0;
        events.forEach((e, k) => { all += e.priorBeats; if (!d.skipped[k]) here += e.priorBeats; });
        return all > 0 ? here / all : 1;
      };
      const tryCover = function* (f) {
        // (the transposition is searched again: with the sections squeezed it may have been chosen wrongly)
        const a = yield* alignEventsSteps(feat, events, { onset: feat.onset, ...(opts.align || {}), s0Frac: f });
        if (!a) return null;
        a.s0Frac = f;
        const d = yield* describe(a);
        return d ? { al: a, ...d } : null;
      };
      for (const f of COVER_TRIES.filter((x) => impliedBpm(x) <= COVER_MIN_BPM)) {
        let c = yield* tryCover(f);
        if (!c) continue;
        // (only a result that leaves the end of the sheet out is a cut recording: otherwise it is a different explanation of
        // an audio that is not shorter)
        if (!c.skipped[events.length - 1]) { dbg.push(`cover ${f}: end of the sheet not skipped`); continue; }
        dbg.push(`cover ${f}: fit ${fit(c).toFixed(1)} decent ${decent(c)} share ${share(c).toFixed(2)}`);
        if (decent(c)) {
          // the share of the sheet that the result puts in the audio is a better guess than the one it started from
          const f2 = share(c);
          if (Math.abs(f2 / f - 1) > 0.1) {
            const c2 = yield* tryCover(f2);
            if (c2) dbg.push(`refined ${f2.toFixed(2)}: fit ${fit(c2).toFixed(1)} decent ${decent(c2)}`);
            if (c2 && fit(c2) >= fit(c) - 1) c = c2;
          }
        }
        if (fit(c) > fit(best) * 1.1 + 5) best = c;
        if (decent(best)) break;
        yield;
      }
    }
    // (2) a section much shorter than its sisters: it may be a neighbour squeezed because a section is missing
    for (let round = 0; round < 2; round++) {
      const sus = suspects(best).filter((si) => !(best.al.skipCost && best.al.skipCost[si] !== undefined));
      if (!sus.length) break;
      const skipCost = { ...(best.al.skipCost || {}) };
      sus.forEach((si) => { skipCost[si] = SKIP_SUSPECT; });
      const a = yield* alignEventsSteps(feat, events, { onset: feat.onset, ...(opts.align || {}), shift: best.al.shift, s0Frac: best.al.s0Frac, skipCost });
      if (!a) break;
      a.skipCost = skipCost;
      a.s0Frac = best.al.s0Frac;
      const d = yield* describe(a);
      if (!d) break;
      dbg.push(`suspects ${sus.map((x) => x + 1)}: fit ${fit(d, sus).toFixed(1)} vs ${fit(best, sus).toFixed(1)}, suspects after ${suspects(d).map((x) => x + 1)}`);
      // better when fewer sections are wrong in length and the others are not worse (the suspects themselves do not count:
      // a section squeezed into the wrong place would otherwise score as a yellow one)
      if (suspects(d).length < suspects(best).length && fit(d, sus) >= fit(best, sus) - 1) best = { al: a, ...d };
      else break;
      yield;
    }
    best.searchLog = dbg;
    return best;
  }

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
    // (a stretch that is the tail of the chord before it, or silence, is not music that the sheet lacks: that chord just lasts)
    const bigGaps = (a0.gaps || []).filter((g) => g.endSec - g.startSec >= GAP_MIN_SEC && !gapIsTail(feat, g, events, a0.shift));
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
      yield;
      const pick = pickTempo(tg.bpms, curve, { hints: [hints[si]] });
      yield;
      let bpm = null;
      let beatGrid = false;
      let beatTimes = null;
      let grid = null;
      let bpmConf = pick.conf;
      let reg = 0;
      if (secEnd - secStart >= 6) {
        const tb = trackBeats(feat.onset, feat.onsetFps, a, secEnd, pick.bpm);
        yield;
        const sm = summariseBeats(tb.times);
        reg = sm.regularity;
        if (sm.bpm && Math.abs(sm.bpm / pick.bpm - 1) < 0.06 && pick.conf >= BPM_CONF_MIN && reg >= BPM_REGULARITY_MIN) {
          bpm = Math.round(sm.bpm * 10) / 10;
          beatGrid = true;
          beatTimes = tb.times;
          grid = smoothBeatGrid(tb.times, bpm, secStart, secEnd);
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
          if ((k & 3) === 3) yield;
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
      sections.push({ startSec: secStart, endSec: secEnd, bpm, confidence: conf, badTempoShare: cons ? cons.badShare : 0, bpmConfidence: bpmConf, beatGrid, tempoCandidate: pick.bpm, regularity: reg, beatTimes, grid });
      if (beatGrid) {
        sections[sections.length - 1].offGrid = offGridShare(idx.map((j) => startSec[j]), beatTimes, bpm);
        // the changes are drawn to the beats of the smooth grid (the same ones the metronome clicks on), not to the raw tracked ones
        const snapped = snapToBeats(idx.map((j) => startSec[j]), grid ? gridTimes(grid) : beatTimes, bpm, opts.snapTol ?? 0.2, !!opts.snapHalf);
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
    // coherence that does not depend on the durations of the sheet (see coherence.js)
    const secInfo = song.sections.map((_, si) => {
      const all = events.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0);
      const here = all.filter((j) => !skipped[j]);
      return { all, here, spanSec: here.length ? startSec[here[here.length - 1]] - startSec[here[0]] : 0, bpm: sections[si] ? sections[si].bpm : null, complete: here.length > 0 && here.length === all.length };
    });
    const sisters = sisterFlags(sisterGroups(events), secInfo);
    const capSection = (si, cap, why) => {
      const s = sections[si];
      if (!s || s.skipped || !(s.confidence > cap)) return;
      s.confidence = cap;
      secInfo[si].here.forEach((j) => { confidence[j] = Math.min(confidence[j], cap); });
      s.capped = true;
      s.why = why;
    };
    sisters.forEach((f, si) => {
      if (!f) return;
      capSection(si, f.severe ? COH_CAP_RED : COH_CAP_YELLOW, 'sisters');
      // the boundary with a wrong section is not reliable on either side
      if (f.severe) for (const nb of [si - 1, si + 1]) if (nb >= 0 && nb < sections.length) capSection(nb, COH_CAP_YELLOW, 'sisters');
    });
    sections.forEach((s, si) => { if (s && s.beatGrid && s.offGrid > OFF_GRID_MAX) capSection(si, COH_CAP_YELLOW, 'offgrid'); });
    // a section the audio starts or stops in the middle of (some of its chords are not in the audio): its length cannot be
    // compared with its sisters', and the squeezing of the part that is there (the recording ends or starts inside a chord, the
    // chord sequence repeats) cannot be told from a good fit: never "sicura", and the neighbour that shares the cut is not either
    secInfo.forEach((m, si) => {
      if (!m.here.length || m.complete) return;
      capSection(si, COH_CAP_YELLOW, 'cut');
      // (the neighbour on the side of the cut: before it when the end of the section is missing, after it when the start is)
      const nb = m.here[0] === m.all[0] ? si - 1 : si + 1;
      if (nb >= 0 && nb < sections.length && secInfo[nb].here.length > 0) capSection(nb, COH_CAP_YELLOW, 'cut');
    });
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
    return { startSec, endSec, sections, eventBeats, grids, confidence, gaps, skipped, sisters };
  }
  al = finalAl;
  if (onProgress) onProgress(1);
  const lastPresent = (() => { for (let j = skipped.length - 1; j >= 0; j--) if (!skipped[j]) return j; return -1; })();
  const musicEndSec = lastPresent >= 0 ? lastChordEnd(feat, startSec[lastPresent]) : feat.musicEndSec;
  const lag = opts.lag ?? ENGINE_LAG_SEC;
  if (lag) {
    for (let j = 0; j < startSec.length; j++) {
      startSec[j] = Math.max(0, startSec[j] - lag);
      endSec[j] = Math.max(startSec[j], endSec[j] - lag);
    }
    for (const g of gaps) { g.startSec -= lag; g.endSec -= lag; }
    for (const sc of sections) {
      if (Number.isFinite(sc.startSec)) sc.startSec -= lag;
      if (Number.isFinite(sc.endSec)) sc.endSec -= lag;
      if (sc.grid) sc.grid = { ...sc.grid, t0: Math.round((sc.grid.t0 - lag) * 1000) / 1000 };
    }
  }
  return {
    eventStartSec: startSec,
    eventEndSec: endSec,
    confidence,
    sharpness: Array.from(al.sharpness),
    sections,
    eventBeats,
    musicEndSec,
    gaps,
    skipped,
    searchLog,
    sisters: sisters.map((f) => (f ? { ratio: Math.round(f.ratio * 100) / 100, kind: f.kind, severe: f.severe } : null)),
    transposeFound: wrapSemis(al.shift),
    transposeMargin: al.shiftMargin,
    transposeScore: al.shiftScore,
    tuningCents: feat.tuningCents,
    computeMs: now() - t0,
    timings,
  };
}
