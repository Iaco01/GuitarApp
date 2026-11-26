// Pure logic of the synchronised audio (runs in Node): anchors, BPM suggestions, media time to
// AudioContext time conversion for the metronome clicks over the audio, loop wrap, file matching.

import { effectiveSectionBpms } from './model.js';
import { buildTimeline } from './timeline.js';

// A tempo suggestion needs a timing error above both limits (a tap is never more precise than this).
export const SYNC_ERR_MIN_SEC = 0.15;
export const SYNC_ERR_REL = 0.003;
export const LATENCY_MIN_MS = -100;
export const LATENCY_MAX_MS = 400;

// Anchors handed to buildTimeline: the offset anchors section 0.
export function audioAnchors(audio) {
  if (!audio) return null;
  return { ...(audio.anchors || {}), 0: Number(audio.offsetSec) || 0 };
}

// "1:42,3" (minutes, seconds, tenths); negative values get a minus sign.
export function formatClock(sec) {
  const neg = sec < 0;
  const t = Math.round(Math.abs(Number(sec) || 0) * 10) / 10;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).replace('.', ',');
  return `${neg ? '−' : ''}${m}:${s.length < 4 ? '0' + s : s}`;
}

export function clampLatencyMs(ms) {
  const v = Math.round(Number(ms));
  if (!Number.isFinite(v)) return 0;
  return Math.min(LATENCY_MAX_MS, Math.max(LATENCY_MIN_MS, v));
}

// Starting value of the calibration slider: stored value, else the browser's own estimate.
export function initialLatencyMs(stored, outputLatencySec) {
  if (Number.isFinite(stored)) return clampLatencyMs(stored);
  if (Number.isFinite(outputLatencySec) && outputLatencySec > 0) return clampLatencyMs(outputLatencySec * 1000);
  return 0;
}

// Sets (or moves) the anchor of a section. Section 0 is the offset. The time must stay between the
// neighbouring anchors. Returns { ok, reason? }; mutates `audio` only when ok.
export function setAnchor(audio, sectionIndex, sec, sectionCount) {
  if (!Number.isFinite(sec) || sec < 0) return { ok: false, reason: 'Istante non valido' };
  const all = audioAnchors(audio);
  let prev = -Infinity;
  let next = Infinity;
  for (const [k, v] of Object.entries(all)) {
    const i = Number(k);
    if (i < sectionIndex && v > prev) prev = v;
    if (i > sectionIndex && v < next) next = v;
  }
  if (sectionIndex < 0 || sectionIndex >= sectionCount) return { ok: false, reason: 'Sezione inesistente' };
  if (sec <= prev) return { ok: false, reason: 'L’inizio deve cadere dopo la sezione precedente' };
  if (sec >= next) return { ok: false, reason: 'L’inizio deve cadere prima della sezione successiva' };
  if (sectionIndex === 0) audio.offsetSec = sec;
  else audio.anchors = { ...audio.anchors, [sectionIndex]: sec };
  return { ok: true };
}

export function removeAnchor(audio, sectionIndex) {
  if (sectionIndex <= 0 || !audio.anchors) return;
  const next = { ...audio.anchors };
  delete next[sectionIndex];
  audio.anchors = next;
}

const round1 = (v) => Math.round(v * 10) / 10;

// Compares the length of every stretch between consecutive anchors (the offset counts as the anchor of
// section 0; `audio.endSec`, if set, closes the last stretch) with the length the saved tempos give it.
// A suggestion is returned when |t2 - t1 - expected| > max(SYNC_ERR_MIN_SEC, SYNC_ERR_REL * expected):
// { from, to (sections, inclusive), beats, seconds, expected, factor, suggested, current } where
// factor = expected / seconds multiplies the tempo of every section of the stretch, and
// current / suggested are the beat-weighted mean tempo before / after.
export function suggestSectionBpms(song, audio) {
  if (!audio) return [];
  const bpms = effectiveSectionBpms(song);
  const beatsOf = song.sections.map((s) => {
    let n = 0;
    for (const l of s.lines) for (const c of l.chords) n += Math.max(1, Math.round(Number(c.beats) || 1));
    return n;
  });
  const points = Object.entries(audioAnchors(audio))
    .map(([k, v]) => [Number(k), v])
    .filter(([k]) => k >= 0 && k < song.sections.length)
    .sort((a, b) => a[0] - b[0]);
  const stops = points.map(([k, t]) => ({ section: k, t }));
  const last = stops[stops.length - 1];
  const closing = Number.isFinite(audio.endSec) && last && audio.endSec > last.t ? { section: song.sections.length, t: audio.endSec } : null;
  if (closing) stops.push(closing);
  const out = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const to = b.section - 1;
    let beats = 0;
    let expected = 0;
    for (let s = a.section; s <= to; s++) {
      beats += beatsOf[s];
      expected += (beatsOf[s] * 60) / bpms[s];
    }
    const seconds = b.t - a.t;
    if (beats <= 0 || seconds <= 0) continue;
    if (Math.abs(seconds - expected) > Math.max(SYNC_ERR_MIN_SEC, SYNC_ERR_REL * expected)) {
      const factor = expected / seconds;
      const current = (beats / expected) * 60;
      out.push({ from: a.section, to, beats, seconds, expected, factor, suggested: round1(current * factor), current: round1(current) });
    }
  }
  return out;
}

// Makes the correction permanent: every section of the stretch gets its tempo times the same factor
// (rounded to 0.1), so the ratios between sections stay what they were.
export function applyBpmSuggestion(song, suggestion) {
  const bpms = effectiveSectionBpms(song);
  for (let s = suggestion.from; s <= suggestion.to; s++) {
    song.sections[s].bpm = Math.min(300, Math.max(30, round1(bpms[s] * suggestion.factor)));
    song.sections[s].bpmSource = 'edited';
  }
}

// ---- metronome over the audio ----

// Context time at which media time `mediaSec` is heard, given where the media is now.
export function mediaToCtxTime(mediaSec, { ctxNow, mediaNow, rate = 1 }) {
  return ctxNow + (mediaSec - mediaNow) / (rate > 0 ? rate : 1);
}

function firstBeatAtOrAfter(beats, sec) {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].timeSec < sec - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Decides which clicks to schedule while an audio plays. Each call converts the media time of the
// next beats into context time with the current media position and playback rate, so a seek, a
// pause or a rate change only needs `reset(mediaSec)` (the caller also cancels the clicks already
// scheduled). `limitSec` (optional, a loop end) stops the clicks at that media time.
export function createMediaClickCore({ beats, lookahead = 0.1, lateTolerance = 0.05 }) {
  let next = 0;
  return {
    // a beat up to lateTolerance behind the position is still due (a seek lands a few ms after its target: the first beat of a
    // loop or of a section would be lost otherwise)
    reset(mediaSec) {
      next = firstBeatAtOrAfter(beats, mediaSec - lateTolerance);
    },
    pull({ ctxNow, mediaNow, rate = 1, limitSec = Infinity }) {
      const out = [];
      while (next < beats.length) {
        const b = beats[next];
        if (b.timeSec >= limitSec - 1e-9) break;
        const when = mediaToCtxTime(b.timeSec, { ctxNow, mediaNow, rate });
        if (when >= ctxNow + lookahead) break;
        if (when >= ctxNow - lateTolerance) out.push({ index: b.index, when, accent: b.isDownbeat, mediaTime: b.timeSec });
        next++;
      }
      return out;
    },
    nextIndex: () => next,
  };
}

// A loop restarts this long before the first beat of the section: the seek takes a few tens of ms to land and the first
// click of every lap must not be lost.
export const LOOP_PREROLL_SEC = 0.06;

// Where to seek when a looped section has ended: its start, or null while still inside.
export function loopSeekTarget(sec, section, slack = 0) {
  if (!section || !(section.endSec > section.startSec)) return null;
  return sec >= section.endSec - slack ? section.startSec : null;
}

// Does a file chosen for a song that lost its audio match the stored metadata?
export function matchAudioFile(audio, file) {
  if (!audio || !file) return 'different';
  return audio.fileName === file.name && audio.size === file.size ? 'same' : 'different';
}

// Timing of the "ascolta da qui" check: start 2 s before the offset.
export function listenFromSec(offsetSec, lead = 2) {
  return Math.max(0, offsetSec - lead);
}

// Seconds from the start of the first audio event (the offset) to the first chord that is not a rest
// bar, with the saved tempos: "Primo accordo!" subtracts it from the tap, so an intro that starts with
// a pause does not shift everything by the length of the pause.
export function firstChordOffsetSec(song) {
  const tl = buildTimeline(song, { speed: 1, anchors: { 0: 0 } });
  const ev = tl.events.find((e) => !e.rest);
  return ev ? ev.startSec : 0;
}

// Options for buildTimeline when the song plays with its audio: anchors, and the automatic alignment if any.
export function audioTimelineOptions(song) {
  const audio = song.audio;
  return { speed: 1, anchors: audioAnchors(audio), alignment: audio && audio.alignment ? audio.alignment : null };
}
