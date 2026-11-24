// Song -> timeline of chord events and beat grid (pure, runs in Node).
// Times are computed section by section with the effective BPM; `speed` (0.5-1) stretches time.

import { effectiveSectionBpms } from './model.js';

export function buildTimeline(song, { speed = 1 } = {}) {
  const sp = speed > 0 ? speed : 1;
  const bpms = effectiveSectionBpms(song);
  const perBar = Math.max(1, (song.timeSignature && song.timeSignature[0]) || 4);
  const events = [];
  const beats = [];
  const sections = [];
  let beatCursor = 0;
  let secCursor = 0;
  song.sections.forEach((sec, si) => {
    const bpm = bpms[si];
    const spb = 60 / bpm / sp;
    const startBeat = beatCursor;
    const startSec = secCursor;
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
          bpm,
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
    sections.push({ index: si, startSec, endSec: secCursor, startBeat, endBeat: beatCursor, bpm });
  });
  return { events, beats, sections, totalBeats: beatCursor, totalSec: secCursor, speed: sp };
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
  return lastAtOrBefore(timeline.events, 'startSec', sec);
}

export function beatIndexAtTime(timeline, sec) {
  return lastAtOrBefore(timeline.beats, 'timeSec', sec);
}
