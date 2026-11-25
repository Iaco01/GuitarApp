// Song -> timeline of chord events and beat grid (pure, runs in Node).
// Times are computed section by section with the effective BPM; `speed` (0.5-1) stretches time.

import { effectiveSectionBpms } from './model.js';
import { alignmentFits, effectiveEventTimes } from './alignment.js';

// Keeps the anchors (section index -> seconds into the audio) that are usable: finite, for an
// existing section and strictly increasing with the section index. Others are dropped with a
// warning. Returns { valid: Map(sectionIndex -> sec), warnings }.
export function usableAnchors(anchors, sectionCount) {
  const valid = new Map();
  const warnings = [];
  const keys = Object.keys(anchors || {}).map(Number).filter((k) => Number.isInteger(k)).sort((x, y) => x - y);
  let last = -Infinity;
  for (const k of keys) {
    const v = Number(anchors[k]);
    if (k < 0 || k >= sectionCount) {
      warnings.push(`ancora della sezione ${k + 1} ignorata: la sezione non esiste`);
    } else if (!Number.isFinite(v) || v < 0) {
      warnings.push(`ancora della sezione ${k + 1} ignorata: istante non valido`);
    } else if (v <= last) {
      warnings.push(`ancora della sezione ${k + 1} ignorata: non è dopo la precedente`);
    } else {
      valid.set(k, v);
      last = v;
    }
  }
  return { valid, warnings };
}

// With `alignment` (song.audio.alignment, audio mode only) every event starts at its aligned instant: the
// beats of an event are spread evenly between its start and the next one, so the highlight follows the
// real timing, free-tempo stretches included. Anchors of sections 1.. then move their section (see
// effectiveEventTimes); the anchor of section 0 is not used (the alignment carries its own start).
//
// `anchors` ({ [sectionIndex]: sec }) pins sections to instants of the audio: an anchored section
// starts exactly there. Between two consecutive anchors the sections are scaled uniformly (one factor,
// same for all of them) so that they fill the stretch exactly: no gap, no jump. After the last anchor
// the saved tempos apply. Without anchors: round 2 times. Each timeline section reports the effective
// `bpm` (scaled) and the saved one as `savedBpm`.
export function buildTimeline(song, { speed = 1, anchors = null, alignment = null } = {}) {
  const sp = speed > 0 ? speed : 1;
  const bpms = effectiveSectionBpms(song);
  const perBar = Math.max(1, (song.timeSignature && song.timeSignature[0]) || 4);
  if (alignment && sp === 1 && alignmentFits(alignment, song)) return buildAlignedTimeline(song, alignment, anchors, bpms, perBar);
  const { valid, warnings } = usableAnchors(anchors, song.sections.length);
  // natural length of every section in seconds at its tempo
  const nat = song.sections.map((sec, si) => {
    let n = 0;
    for (const l of sec.lines) for (const c of l.chords) n += Math.max(1, Math.round(Number(c.beats) || 1));
    return n * (60 / bpms[si] / sp);
  });
  // scale of each section: the stretch between two anchors is filled exactly
  const scale = song.sections.map(() => 1);
  let from = 0;
  let start = 0;
  const fit = (to, end) => {
    let total = 0;
    for (let i = from; i < to; i++) total += nat[i];
    if (total > 0) for (let i = from; i < to; i++) scale[i] = Math.max(end - start, 1e-6) / total;
  };
  for (const [k, sec] of valid) {
    if (k > from) fit(k, sec);
    from = k;
    start = sec;
  }
  const events = [];
  const beats = [];
  const sections = [];
  let beatCursor = 0;
  let secCursor = 0;
  song.sections.forEach((sec, si) => {
    const bpm = bpms[si];
    const spb = (60 / bpm / sp) * scale[si];
    const startBeat = beatCursor;
    const startSec = valid.has(si) ? valid.get(si) : secCursor;
    sec.lines.forEach((line, li) => {
      line.chords.forEach((c, ci) => {
        const n = Math.max(1, Math.round(Number(c.beats) || 1));
        const rel = beatCursor - startBeat;
        const eventIndex = events.length;
        events.push({
          ref: `${si}.${li}.${ci}`,
          name: c.name,
          mark: c.mark || '',
          rest: !!c.rest,
          sectionIndex: si,
          startBeat: beatCursor,
          beats: n,
          startSec: startSec + rel * spb,
          durSec: n * spb,
          bpm: bpm / scale[si],
        });
        for (let b = 0; b < n; b++) {
          beats.push({
            index: beatCursor + b,
            timeSec: startSec + (rel + b) * spb,
            sectionIndex: si,
            eventIndex,
            beatInBar: (rel + b) % perBar,
            isDownbeat: (rel + b) % perBar === 0,
          });
        }
        beatCursor += n;
      });
    });
    const count = beatCursor - startBeat;
    secCursor = startSec + count * spb;
    sections.push({ index: si, startSec, endSec: secCursor, startBeat, endBeat: beatCursor, bpm: bpm / scale[si], savedBpm: bpm, scale: scale[si], spb, anchored: valid.has(si) });
  });
  return { events, beats, sections, totalBeats: beatCursor, totalSec: secCursor, speed: sp, warnings };
}

function buildAlignedTimeline(song, alignment, anchors, bpms, perBar) {
  const { starts, ends, endSec, gaps, warnings } = effectiveEventTimes(song, alignment, anchors);
  const N = starts.length;
  const events = [];
  const beats = [];
  const sections = [];
  const skippedSet = new Set(alignment.skipped || []);
  let beatCursor = 0;
  let k = 0;
  let prevEnd = 0;
  song.sections.forEach((sec, si) => {
    const startBeat = beatCursor;
    const first = k;
    let present = 0;
    sec.lines.forEach((line, li) => {
      line.chords.forEach((c, ci) => {
        const n = Math.max(1, Math.round(Number(c.beats) || 1));
        const rel = beatCursor - startBeat;
        const start = starts[k];
        const end = ends[k];
        const dur = Math.max(end - start, 1e-3);
        const spb = dur / n;
        const eventIndex = events.length;
        if (skippedSet.has(k)) {
          // not in the audio: no time, no beats (the metronome and the highlight pass over it)
          events.push({ ref: `${si}.${li}.${ci}`, name: c.name, mark: c.mark || '', rest: !!c.rest, sectionIndex: si, startBeat: beatCursor, beats: 0, startSec: start, durSec: 0, bpm: 0, skipped: true });
          k++;
          return;
        }
        present++;
        events.push({ ref: `${si}.${li}.${ci}`, name: c.name, mark: c.mark || '', rest: !!c.rest, sectionIndex: si, startBeat: beatCursor, beats: n, startSec: start, durSec: dur, bpm: 60 / spb });
        for (let b = 0; b < n; b++) {
          beats.push({ index: beatCursor + b, timeSec: start + b * spb, spb, sectionIndex: si, eventIndex, beatInBar: (rel + b) % perBar, isDownbeat: (rel + b) % perBar === 0 });
        }
        beatCursor += n;
        k++;
      });
    });
    const count = beatCursor - startBeat;
    const firstP = Array.from({ length: k - first }, (_, i) => first + i).find((i) => !skippedSet.has(i));
    const lastP = Array.from({ length: k - first }, (_, i) => k - 1 - i).find((i) => !skippedSet.has(i));
    const secStart = present ? starts[firstP] : prevEnd;
    const secEnd = present ? ends[lastP] : prevEnd;
    prevEnd = secEnd;
    const dur = Math.max(secEnd - secStart, 1e-3);
    const spb = count > 0 ? dur / count : 60 / bpms[si];
    const bpm = 60 / spb;
    sections.push({ index: si, startSec: secStart, endSec: secEnd, startBeat, endBeat: beatCursor, bpm, savedBpm: bpms[si], scale: bpms[si] / bpm, spb, anchored: !!(anchors && si > 0 && Number.isFinite(anchors[si])), aligned: true, skipped: sec.lines.length > 0 && present === 0 && k > first });
  });
  return { events, beats, sections, totalBeats: beatCursor, totalSec: endSec, speed: 1, warnings, aligned: true, gaps };
}

// Greatest index i with list[i][key] <= value, or -1.
function lastAtOrBefore(list, key, value) {
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][key] <= value) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

// Index of the chord event playing at `sec` (-1 before the start; the last one after the end).
export function eventIndexAtTime(timeline, sec) {
  let i = lastAtOrBefore(timeline.events, 'startSec', sec);
  // events that are not in the audio (the last ones of a sheet longer than the audio) are never the current one
  while (i >= 0 && timeline.events[i].skipped) i--;
  return i;
}

export function beatIndexAtTime(timeline, sec) {
  return lastAtOrBefore(timeline.beats, 'timeSec', sec);
}

// Seconds per beat of the section with the given index in this timeline.
function secPerBeatOfSection(timeline, sectionIndex) {
  return timeline.sections[sectionIndex].spb;
}

// Seconds per beat at beat `b` (aligned timelines have a different one for every event).
function spbOfBeat(timeline, b) {
  return b.spb !== undefined ? b.spb : secPerBeatOfSection(timeline, b.sectionIndex);
}

// Fractional beat position (0 = first beat of the song) at `sec`; negative before the start and
// extrapolated at the last tempo after the end. Independent of `speed`.
export function beatPositionAtTime(timeline, sec) {
  if (timeline.beats.length === 0) return 0;
  const idx = beatIndexAtTime(timeline, sec);
  const i = Math.max(0, idx);
  const b = timeline.beats[i];
  const spb = spbOfBeat(timeline, b);
  const frac = (sec - b.timeSec) / spb;
  return b.index + (idx === -1 ? frac : Math.min(frac, 1 - 1e-12));
}

// Inverse of beatPositionAtTime.
export function timeAtBeatPosition(timeline, pos) {
  if (timeline.beats.length === 0) return 0;
  const i = Math.min(timeline.beats.length - 1, Math.max(0, Math.floor(pos)));
  const b = timeline.beats[i];
  return b.timeSec + (pos - b.index) * spbOfBeat(timeline, b);
}
