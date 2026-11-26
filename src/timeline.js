// Song -> timeline of chord events and beat grid (pure, runs in Node).
// Times are computed section by section with the effective BPM; `speed` (0.5-1) stretches time.

import { effectiveSectionBpms } from './model.js';
import { alignmentFits, effectiveEventTimes } from './alignment.js';
import { gridTimes, regularGridTimes, gridTicks, freeTicks, barPosition } from './beatgrid.js';

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
  const shift = alignment.shiftSec || 0;
  const skippedSet = new Set(alignment.skipped || []);
  // the clicks stop where the music ends (the last chord of a sheet is often held over a silent tail)
  const musicEnd = Number.isFinite(alignment.musicEndSec) ? alignment.musicEndSec + shift : Infinity;
  const refs = [];
  song.sections.forEach((sec, si) => sec.lines.forEach((line, li) => line.chords.forEach((c, ci) => refs.push({ si, li, ci, c }))));
  const presentIdx = starts.map((_, j) => j).filter((j) => !skippedSet.has(j));
  const lastPresent = presentIdx.length ? presentIdx[presentIdx.length - 1] : -1;
  const endOf = (j) => (j === lastPresent ? Math.max(starts[j] + 1e-3, Math.min(ends[j], musicEnd)) : ends[j]);
  // does music that is not in the sheet (or the end) follow chord j?
  const nextPresent = new Int32Array(starts.length).fill(-1);
  for (let q = presentIdx.length - 2; q >= 0; q--) nextPresent[presentIdx[q]] = presentIdx[q + 1];
  const stopsAfter = (j) => {
    if (j === lastPresent) return true;
    const nx = nextPresent[j];
    return nx < 0 || starts[nx] - endOf(j) > 1e-3;
  };
  // tempo that counts the quarters of a section: the measured one; a free-tempo section (none) takes the one of the nearest
  // section that has it, else the saved one
  const measured = song.sections.map((_, si) => (alignment.sections[si] && Number.isFinite(alignment.sections[si].bpm) ? alignment.sections[si].bpm : null));
  const refBpm = (si) => {
    if (measured[si] !== null) return measured[si];
    for (let d = 1; d < measured.length; d++) {
      if (si - d >= 0 && measured[si - d] !== null) return measured[si - d];
      if (si + d < measured.length && measured[si + d] !== null) return measured[si + d];
    }
    return bpms[si];
  };
  // 1. the ticks of every chord from the grid of its section (stable tempo) or from its own start (free tempo)
  const ticksOf = new Array(refs.length).fill(null);
  const perOf = new Array(refs.length).fill(0);
  const freeSecs = new Set(); // sections without a stable tempo: one tick per change
  let j0 = 0;
  song.sections.forEach((sec, si) => {
    const list = [];
    while (j0 < refs.length && refs[j0].si === si) { if (!skippedSet.has(j0)) list.push(j0); j0++; }
    if (!list.length) return;
    const evs = list.map((j) => ({ start: starts[j], end: endOf(j), stop: stopsAfter(j) }));
    if (measured[si] !== null) {
      const stored = alignment.sections[si].grid;
      const secFrom = evs[0].start;
      const secTo = evs[evs.length - 1].end;
      let times;
      let per;
      if (stored) {
        times = gridTimes(stored).map((t) => t + shift);
        per = stored.per;
        // anchors stretch the section: the grid follows
        const o0 = alignment.eventStartSec[list[0]] + shift;
        const o1 = alignment.eventStartSec[list[list.length - 1]] + shift;
        const n0 = starts[list[0]];
        const n1 = starts[list[list.length - 1]];
        if (o1 - o0 > 1e-6 && (Math.abs(n0 - o0) > 1e-9 || Math.abs(n1 - n0 - (o1 - o0)) > 1e-9)) {
          const f = (n1 - n0) / (o1 - o0);
          times = times.map((t) => n0 + (t - o0) * f);
          per *= f;
        }
      } else {
        per = 60 / measured[si];
        times = regularGridTimes(list.map((j) => starts[j]), list.map((j) => alignment.confidence[j] || 0.5), measured[si], secFrom, secTo);
      }
      const { ticks, phase } = gridTicks(times, per, evs, perBar);
      list.forEach((j, i) => {
        perOf[j] = per;
        ticksOf[j] = ticks[i].map((t, q) => ({ timeSec: t.timeSec, bar: barPosition(t.k, phase, perBar), first: q === 0, accent: barPosition(t.k, phase, perBar) === 0 }));
      });
    } else {
      freeSecs.add(si);
      const per = 60 / refBpm(si);
      const ticks = freeTicks(evs);
      list.forEach((j, i) => {
        perOf[j] = per;
        ticksOf[j] = ticks[i].map((t, q) => ({ timeSec: t.timeSec, bar: t.bar, first: q === 0, accent: q === 0 }));
      });
    }
  });
  // 2. two ticks closer than 0.6 beat (the seam of two grids): the one at a chord start wins, else the later one goes
  const flat = [];
  presentIdx.forEach((j) => ticksOf[j].forEach((t) => flat.push({ j, t })));
  const dead = new Set();
  let prev = null;
  for (const cur of flat) {
    if (prev && cur.t.timeSec - prev.t.timeSec < 0.6 * Math.min(perOf[prev.j], perOf[cur.j])) {
      if (cur.t.first && !prev.t.first) { dead.add(prev.t); prev = cur; } else dead.add(cur.t);
    } else prev = cur;
  }
  // 3. events, beats and sections
  const events = [];
  const beats = [];
  const sections = [];
  let beatCursor = 0;
  let k = 0;
  let prevEnd = 0;
  song.sections.forEach((sec, si) => {
    const startBeat = beatCursor;
    const first = k;
    let present = 0;
    sec.lines.forEach((line, li) => {
      line.chords.forEach((c, ci) => {
        const start = starts[k];
        const eventIndex = events.length;
        if (skippedSet.has(k)) {
          // not in the audio: no time, no beats (the metronome and the highlight pass over it)
          events.push({ ref: `${si}.${li}.${ci}`, name: c.name, mark: c.mark || '', rest: !!c.rest, sectionIndex: si, startBeat: beatCursor, beats: 0, startSec: start, durSec: 0, bpm: 0, skipped: true });
          k++;
          return;
        }
        present++;
        const dur = Math.max(endOf(k) - start, 1e-3);
        const mine = ticksOf[k].filter((t) => !dead.has(t));
        events.push({ ref: `${si}.${li}.${ci}`, name: c.name, mark: c.mark || '', rest: !!c.rest, sectionIndex: si, startBeat: beatCursor, beats: mine.length, startSec: start, durSec: dur, bpm: 60 / perOf[k] });
        for (const t of mine) {
          beats.push({ index: beatCursor, timeSec: t.timeSec, spb: perOf[k], sectionIndex: si, eventIndex, beatInBar: t.bar, isDownbeat: t.accent });
          beatCursor++;
        }
        k++;
      });
    });
    const count = beatCursor - startBeat;
    let firstP;
    let lastP;
    for (let i = first; i < k; i++) if (!skippedSet.has(i)) { if (firstP === undefined) firstP = i; lastP = i; }
    const secStart = present ? starts[firstP] : prevEnd;
    const secEnd = present ? endOf(lastP) : prevEnd;
    prevEnd = secEnd;
    const dur = Math.max(secEnd - secStart, 1e-3);
    // the tempo shown is the measured one (the sync screen shows the same); a free-tempo section has the one of its neighbour
    const bpm = present ? Math.round(refBpm(si) * 10) / 10 : 60 / (count > 0 ? dur / count : 60 / bpms[si]);
    sections.push({ index: si, startSec: secStart, endSec: secEnd, startBeat, endBeat: beatCursor, bpm, savedBpm: bpms[si], scale: bpms[si] / bpm, spb: 60 / bpm, anchored: !!(anchors && si > 0 && Number.isFinite(anchors[si])), aligned: true, free: freeSecs.has(si), skipped: sec.lines.length > 0 && present === 0 && k > first });
  });
  return { events, beats, sections, totalBeats: beatCursor, totalSec: endSec, speed: 1, warnings, aligned: true, gaps };
}

// Ticks of every chord event of an aligned song (null for the ones not in the audio): the quarters the audio has.
export function alignedEventBeats(song, alignment) {
  const tl = buildTimeline(song, { alignment });
  return tl.aligned ? tl.events.map((e) => (e.skipped ? null : e.beats)) : null;
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
