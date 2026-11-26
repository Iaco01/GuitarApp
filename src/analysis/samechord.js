// The boundary between two identical chords in a row (pure).
//
// The chroma cannot tell where G ends and the next G begins: the held chord and its decay look the same as the new one, so the
// alignment may put the boundary anywhere between the two attacks, and a small difference in how the browser decoded the audio
// is enough to move it. The boundary of two identical chords is the RE-ATTACK: a strong attack that follows a stretch where the
// sound was dying out. A decay or a silence belongs to the chord that produced it, never to the next one. When the first chord of
// a section lasts much longer than the first chord of its sister sections (same chords), the window is narrowed to the sisters'
// duration.

import { sisterGroups } from './coherence.js';

export const REATTACK_MIN = 4; // strength of the attack in the onset envelope (mean 1; a strummed chord is 10 or more)
export const REATTACK_RISE = 1.25; // energy after / energy before
const MIN_HOLD = 0.5; // the first chord lasts at least this long before the boundary (s)
const KEEP_TOL = 0.12; // a current boundary this close to a clear attack stays (it is on a strum, not in a decay)
const KEEP_STRENGTH = 3;
const LONG_FIRST = 2.2; // first chord longer than this times the median of its sisters' is too long
const LAST_MARGIN = 0.15;

function meanEnergy(feat, t0, t1) {
  const f0 = Math.max(0, Math.round(t0 * feat.fps));
  const f1 = Math.min(feat.frames - 1, Math.round(t1 * feat.fps));
  if (f1 < f0) return 0;
  let s = 0;
  for (let f = f0; f <= f1; f++) s += feat.energy[f];
  return s / (f1 - f0 + 1);
}

// Attacks in [t0, t1] that follow a decay: [{ t, strength, rise }]
export function reattacks(feat, t0, t1, minStrength = REATTACK_MIN) {
  const out = [];
  const i0 = Math.max(1, Math.floor(t0 * feat.onsetFps));
  const i1 = Math.min(feat.onset.length - 2, Math.ceil(t1 * feat.onsetFps));
  for (let i = i0; i <= i1; i++) {
    const v = feat.onset[i];
    if (!(v >= minStrength && v >= feat.onset[i - 1] && v > feat.onset[i + 1])) continue;
    const t = i / feat.onsetFps;
    const before = meanEnergy(feat, t - 0.35, t - 0.05);
    const after = meanEnergy(feat, t + 0.05, t + 0.35);
    out.push({ t, strength: v, rise: after / (before + 1e-9) });
  }
  return out;
}

// events: [{ name, rest, section }]; present: indices of the events that are in the audio, in order; startSec: their start
// (changed in place). endSec: end of the music. Returns the list of the changes [{ j, from, to }].
export function fixSameChordBoundaries(feat, events, present, startSec, endSec) {
  const moves = [];
  // first-chord durations of the sections, for the sisters' median
  const firstOf = new Map(); // section -> index of its first present event
  present.forEach((j, k) => { if (!firstOf.has(events[j].section)) firstOf.set(events[j].section, k); });
  const durOfFirst = (si) => {
    const k = firstOf.get(si);
    if (k === undefined) return null;
    const nx = k + 1 < present.length ? startSec[present[k + 1]] : endSec;
    return nx - startSec[present[k]];
  };
  const sisterMedian = new Map();
  for (const group of sisterGroups(events)) {
    for (const si of group) {
      const d = group.filter((o) => o !== si).map(durOfFirst).filter((x) => x !== null && x > 0).sort((a, b) => a - b);
      if (d.length) sisterMedian.set(si, d[(d.length - 1) >> 1]);
    }
  }
  for (let k = 1; k < present.length; k++) {
    const j0 = present[k - 1];
    const j1 = present[k];
    if (events[j0].rest || events[j1].rest || !events[j0].name || events[j0].name !== events[j1].name) continue;
    const tPrev = startSec[j0];
    const tCur = startSec[j1];
    const tNext = k + 1 < present.length ? startSec[present[k + 1]] : endSec;
    let lo = tPrev + MIN_HOLD;
    const hi = tNext - LAST_MARGIN;
    const isFirst = events[j0].section !== events[j1].section;
    const med = isFirst ? sisterMedian.get(events[j1].section) : undefined;
    const tooLong = med !== undefined && tNext - tCur > Math.max(1.5, LONG_FIRST * med);
    if (med !== undefined) lo = Math.max(lo, tNext - Math.max(1.5, LONG_FIRST * med));
    if (hi <= lo) continue;
    const cands = reattacks(feat, lo, hi).filter((c) => c.rise >= REATTACK_RISE);
    if (!cands.length) {
      if (!tooLong) continue;
      // no re-attack with a rise: the strongest attack of the narrowed window
      const any = reattacks(feat, lo, hi, 2).sort((a, b) => b.strength - a.strength)[0];
      if (any) { moves.push({ j: j1, from: tCur, to: any.t }); startSec[j1] = any.t; }
      continue;
    }
    if (!tooLong && reattacks(feat, tCur - KEEP_TOL, tCur + KEEP_TOL, KEEP_STRENGTH).length) continue;
    const best = cands.reduce((a, c) => (c.strength * Math.min(3, c.rise) > a.strength * Math.min(3, a.rise) ? c : a));
    if (Math.abs(best.t - tCur) < 0.02) continue;
    moves.push({ j: j1, from: tCur, to: best.t });
    startSec[j1] = best.t;
  }
  return moves;
}
