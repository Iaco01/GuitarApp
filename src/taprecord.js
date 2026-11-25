// Pure cores for tap-based recording of chord durations and for tap tempo (runs in Node).

import { beatPositionAtTime } from './timeline.js';

// Converts the taps recorded while playing the timeline into chord durations (in beats).
//   tapTimesSec: song-time of each tap; tap k marks the start of chord k+1 of the recorded span.
//   endTimeSec:  optional song-time of "Fine": the end of the last chord.
//   firstEventIndex / eventCount: the span of chords being recorded.
// The first chord starts on the first beat of the span (the metronome starts there). Each tap is
// converted to a beat position with the timeline grid (tempo changes included) and rounded to
// the nearest beat. Durations are the differences, at least 1. A tap is ignored when it falls
// less than half a beat after the previous accepted tap or rounds to the same beat (double tap).
// Chords without a tap keep their current duration; the last chord ends at the tap after it, at
// `endTimeSec`, or else keeps its duration.
export function quantizeTaps({ tapTimesSec, timeline, firstEventIndex, eventCount, endTimeSec = null }) {
  const events = timeline.events;
  const out = [];
  for (let k = 0; k < eventCount; k++) out.push(events[firstEventIndex + k].beats);
  const startPos = events[firstEventIndex].startBeat;
  const marks = tapTimesSec.slice();
  if (endTimeSec !== null && endTimeSec !== undefined) marks.push(endTimeSec);
  let prevPos = startPos;
  let prevRaw = startPos;
  let chord = 0; // index (within the span) of the chord whose end the next accepted mark gives
  for (const t of marks) {
    if (chord >= eventCount) break;
    const raw = beatPositionAtTime(timeline, t);
    if (raw - prevRaw < 0.5) continue;
    const rounded = Math.round(raw);
    if (rounded <= prevPos) continue;
    out[chord] = Math.max(1, rounded - prevPos);
    prevPos += out[chord];
    prevRaw = raw;
    chord++;
  }
  return out;
}

// Tap tempo: average of the last `window` intervals, reset after `resetSec` of silence.
export function createTapTempo({ window = 4, resetSec = 2 } = {}) {
  let times = [];
  return {
    // Registers a tap at `nowSec`; returns the BPM estimate or null while it needs more taps.
    tap(nowSec) {
      if (times.length && nowSec - times[times.length - 1] > resetSec) times = [];
      times.push(nowSec);
      if (times.length > window + 1) times = times.slice(times.length - window - 1);
      if (times.length < 2) return null;
      const avg = (times[times.length - 1] - times[0]) / (times.length - 1);
      return avg > 0 ? Math.round((60 / avg) * 10) / 10 : null;
    },
    reset() {
      times = [];
    },
  };
}

// Flags durations that look like a skipped (or extra) tap: at least twice or at most half of the
// median duration of the recorded span. Returns one boolean per duration.
export function suspiciousDurations(durations) {
  if (durations.length < 3) return durations.map(() => false);
  const sorted = durations.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return durations.map((d) => d >= 2 * median || d <= median / 2);
}

// Taps made on "Cambio!" while a stretch of audio plays -> start times of the chords of that stretch.
//   tapTimesSec: display time of every tap (device latency already compensated by the player);
//   reactionSec: average reaction delay of the person, subtracted from every tap (default 0);
//   eventCount: how many chord starts are expected; minGapSec: a tap closer than this to the previous
//   accepted one is a double tap and is ignored.
// Returns { starts (taps in order, reaction removed), count, ignored, ok } with ok = (count === eventCount).
export function tapsToStarts({ tapTimesSec, eventCount, reactionSec = 0, minGapSec = 0.15 }) {
  const taps = tapTimesSec.slice().sort((a, b) => a - b);
  const starts = [];
  let ignored = 0;
  let prevRaw = -Infinity;
  for (const t of taps) {
    if (t - prevRaw < minGapSec) { ignored++; continue; }
    prevRaw = t;
    starts.push(t - reactionSec);
  }
  return { starts, count: starts.length, ignored, ok: starts.length === eventCount };
}
