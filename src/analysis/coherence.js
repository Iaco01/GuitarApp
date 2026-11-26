// Coherence checks of an alignment that do not depend on the durations written in the sheet (pure).
//
// The durations of the sheet are often guessed from the text, so they cannot tell a right alignment from a wrong one. Two
// checks use only what the engine measured in the audio:
//  - sections with the same chord sequence (the choruses, the verses) must last about the same number of beats;
//  - in a section with a stable beat the changes fall near the beats (or half beats).

// sisters need at least this many chords to be compared (a two chord vamp repeats everywhere)
export const SISTER_MIN_EVENTS = 4;
// ratio of the span of a section to the median of its sisters (in beats) outside which it is suspect, and well outside
// which it is certainly wrong
export const SISTER_SHORT = 0.8;
export const SISTER_LONG = 1.35;
export const SISTER_SHORT_SEVERE = 0.55;
export const SISTER_LONG_SEVERE = 1.8;
// a change is off the grid when it is farther than this (in beats) from the nearest half beat
export const GRID_TOL_BEATS = 0.15;

function medianOf(a) {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// events: [{ name, rest, section }] in reading order. Returns the groups (arrays of section indices, at least two) of
// sections with exactly the same chord sequence.
export function sisterGroups(events) {
  const seq = new Map();
  events.forEach((e) => {
    if (e.section === undefined) return;
    if (!seq.has(e.section)) seq.set(e.section, []);
    seq.get(e.section).push(e.rest ? '-' : e.name);
  });
  const byKey = new Map();
  seq.forEach((names, si) => {
    if (names.length < SISTER_MIN_EVENTS) return;
    const key = names.join('|');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(si);
  });
  return Array.from(byKey.values()).filter((g) => g.length >= 2);
}

// secs[si] = { spanSec, bpm, complete }: the time from the first to the last chord start of the section, its measured
// tempo (null: free) and whether every chord of it is in the audio. Returns, for every section, null or
// { ratio, kind: 'short' | 'long', severe, group }: the span in beats compared with the median of the sisters.
// A tempo that is twice or half the one of the sisters is the same beat counted differently. Without a stable beat the
// span is compared in seconds (with the tempo of the sisters) and only a large difference counts.
export function sisterFlags(groups, secs) {
  const out = secs.map(() => null);
  for (const g of groups) {
    const m = g.filter((si) => secs[si] && secs[si].complete && secs[si].spanSec > 0);
    if (m.length < 2) continue;
    const tempos = m.map((si) => secs[si].bpm).filter(Number.isFinite);
    const ref = tempos.length ? medianOf(tempos) : 60;
    const beats = m.map((si) => {
      let b = Number.isFinite(secs[si].bpm) ? secs[si].bpm : ref;
      // (only a tempo close to double or half is the same beat counted differently)
      if (b / ref > 1.7 && b / ref < 2.3) b /= 2;
      else if (b / ref > 0.43 && b / ref < 0.59) b *= 2;
      return (secs[si].spanSec * b) / 60;
    });
    // two sisters: the longer one is the reference (a squeezed section is the usual fault)
    const mid = m.length === 2 ? Math.max(...beats) : medianOf(beats);
    m.forEach((si, k) => {
      const ratio = beats[k] / mid;
      const free = !Number.isFinite(secs[si].bpm);
      const short = ratio < (free ? SISTER_SHORT_SEVERE : SISTER_SHORT);
      const long = ratio > (free ? SISTER_LONG_SEVERE : SISTER_LONG);
      if (!short && !long) return;
      out[si] = { ratio, kind: short ? 'short' : 'long', severe: ratio < SISTER_SHORT_SEVERE || ratio > SISTER_LONG_SEVERE, group: m.slice() };
    });
  }
  return out;
}

// Share of the changes (times in seconds) that fall farther than GRID_TOL_BEATS from the nearest half beat of the
// tracked beats (beatTimes, period 60 / bpm).
export function offGridShare(times, beatTimes, bpm) {
  if (!times.length || !beatTimes.length) return 0;
  const per = 60 / bpm;
  let off = 0;
  for (const t of times) {
    let d = Infinity;
    for (const b of beatTimes) {
      d = Math.min(d, Math.abs(b - t), Math.abs(b + per / 2 - t));
      if (b > t + per) break;
    }
    if (d / per > GRID_TOL_BEATS) off++;
  }
  return off / times.length;
}
