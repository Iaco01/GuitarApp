// Automatic sync orchestrator (pure): from the decoded audio and the song, finds the start of every
// chord event, the tempo of every section and the transposition/tuning of the recording.

import { resampleMono, computeFeatures, FEATURE_RATE } from './features.js';
import { tempoCurves, curveOfRange, pickTempo, trackBeats, summariseBeats } from './beats.js';
import { alignEvents, snapToOnsets, snapToBeats, gridBonusFrames } from './align.js';
import { estimateSongDurations } from '../durations.js';
import { effectiveSectionBpms } from '../model.js';

const ONSET_LEAD = 0;
const BPM_CONF_MIN = 0.35;
const BPM_REGULARITY_MIN = 0.8;

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

// Semitones in (-6, 6].
function wrapSemis(n) {
  const m = ((n % 12) + 12) % 12;
  return m > 6 ? m - 12 : m;
}

// samples: mono Float32Array at sampleRate. Returns
// { eventStartSec[], eventEndSec[], confidence[], sections: [{ startSec, endSec, bpm, confidence,
//   bpmConfidence, beatGrid }], eventBeats[], transposeFound, transposeMargin, tuningCents,
//   computeMs, timings }
export function analyseAndAlign({ samples, sampleRate, song, onProgress = null, now = () => Date.now(), opts = {} }) {
  const t0 = now();
  const timings = {};
  const lap = (k, since) => { timings[k] = now() - since; return now(); };
  let tk = now();
  const x = resampleMono(samples, sampleRate, FEATURE_RATE);
  tk = lap('resample', tk);
  const feat = computeFeatures(x, { ...(opts.feat || {}), onProgress: onProgress ? (f) => onProgress(0.05 + 0.45 * f) : null });
  tk = lap('features', tk);
  const events = songEvents(song);
  // the capo is not considered: the written chords are the sounding ones (see transpose.js)
  let al = alignEvents(feat, events, { onset: feat.onset, ...(opts.align || {}) });
  tk = lap('align', tk);
  if (onProgress) onProgress(0.8);
  if (!al) return null;
  const N = events.length;
  const hints = effectiveSectionBpms(song);
  const tg = tempoCurves(feat.onset, feat.onsetFps);
  let { startSec, endSec, sections, eventBeats, grids } = describe(al);
  let finalAl = al;
  if (opts.regrid && grids.length) {
    // second pass: the boundaries of the stable stretches are drawn to the beat / half-beat grid
    const gb = gridBonusFrames(grids, feat.fps, feat.frames, { gamma: opts.gridGamma ?? 4, width: opts.gridWidth ?? 0.3 });
    const al2 = alignEvents(feat, events, { onset: feat.onset, ...(opts.align || {}), shift: al.shift, gridBonus: gb });
    if (al2) { finalAl = al2; ({ startSec, endSec, sections, eventBeats, grids } = describe(al2)); }
  }
  tk = lap('regrid', tk);

  // tempo, beat grid and boundary refinement from an alignment
  function describe(a0) {
    const sections = [];
    const grids = [];
    // boundaries refined on the attacks (the DP grid is 93 ms)
    const startSec = snapToOnsets(a0.startSec, feat.onset, feat.onsetFps, { lead: ONSET_LEAD });
    const endSec = startSec.slice(1).concat([Math.max(startSec[N - 1], a0.endSec[N - 1])]);
    const eventBeats = new Array(N).fill(null);
    const pendingBeats = [];
    song.sections.forEach((sec, si) => {
      const idx = [];
      events.forEach((e, j) => { if (e.section === si) idx.push(j); });
      if (!idx.length) {
        sections.push({ startSec: null, endSec: null, bpm: null, confidence: 0, bpmConfidence: 0, beatGrid: false });
        return;
      }
      const secStart = startSec[idx[0]];
      const secEnd = endSec[idx[idx.length - 1]];
      let conf = 0;
      for (const j of idx) conf += a0.confidence[j];
      conf /= idx.length;
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
      sections.push({ startSec: secStart, endSec: secEnd, bpm, confidence: conf, bpmConfidence: bpmConf, beatGrid, tempoCandidate: pick.bpm, regularity: reg, beatTimes });
      if (beatGrid) {
        const snapped = snapToBeats(idx.map((j) => startSec[j]), beatTimes, bpm, opts.snapTol ?? 0.2, !!opts.snapHalf);
        idx.forEach((j, k) => { startSec[j] = snapped[k]; });
        pendingBeats.push({ idx, bpm });
      }
    });
    for (let j = 0; j < N; j++) endSec[j] = j + 1 < N ? startSec[j + 1] : endSec[j];
    for (const { idx, bpm } of pendingBeats) for (const j of idx) eventBeats[j] = Math.max(1, Math.round(((endSec[j] - startSec[j]) * bpm) / 60));
    sections.forEach((s, i) => {
      const e = events.map((ev, j) => (ev.section === i ? j : -1)).filter((j) => j >= 0);
      if (e.length) { s.startSec = startSec[e[0]]; s.endSec = endSec[e[e.length - 1]]; }
    });
    return { startSec, endSec, sections, eventBeats, grids };
  }
  al = finalAl;
  return {
    eventStartSec: startSec,
    eventEndSec: endSec,
    confidence: Array.from(al.confidence),
    sections,
    eventBeats,
    transposeFound: wrapSemis(al.shift),
    transposeMargin: al.shiftMargin,
    tuningCents: feat.tuningCents,
    computeMs: now() - t0,
    timings,
  };
}
