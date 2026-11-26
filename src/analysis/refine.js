// Refinement of the change boundaries of the sections without a stable beat (pure).
//
// In a free-tempo passage played as an arpeggio the new chord shows up in the chromagram only after a few notes, so the
// boundary chosen by the alignment sits late. The bass moves first: the first strong attack in a window around the
// chosen boundary where the bass passes to the root of the new chord is the better estimate. If there is none, the
// strongest attack that makes the chroma look more like the new chord. The two boundaries (the one from the chroma and
// the refined one) are two estimators of the same instant: where they agree the change is trusted more.

export const REFINE_BEFORE = 1.0;
export const REFINE_AFTER = 0.3;
const ATTACK_MIN = 2;
const BASS_AFTER_MIN = 0.35;
const BASS_RISE_MIN = 0.15;
const COMPAT_MIN = 0.05;
const TONE_AFTER_MIN = 0.3;
const TONE_RISE_MIN = 0.2;

// mean of the bass share of pitch class `pc` over the frames [t0, t1] (seconds)
function bassShare(feat, pc, t0, t1) {
  const f0 = Math.max(0, Math.round(t0 * feat.fps));
  const f1 = Math.min(feat.frames - 1, Math.round(t1 * feat.fps));
  let own = 0;
  let all = 0;
  for (let f = f0; f <= f1; f++) {
    own += feat.bass[f * 12 + pc];
    for (let k = 0; k < 12; k++) all += feat.bass[f * 12 + k];
  }
  return own / (all + 1e-6);
}

// share of the chroma energy that lies on the pitch classes of `set` (a Set), over the frames of [t0, t1] seconds
function chromaShare(feat, set, t0, t1) {
  const f0 = Math.max(0, Math.round(t0 * feat.fps));
  const f1 = Math.min(feat.frames - 1, Math.round(t1 * feat.fps));
  let own = 0;
  let all = 0;
  for (let f = f0; f <= f1; f++) {
    for (let k = 0; k < 12; k++) {
      const v = feat.chroma[f * 12 + k];
      all += v;
      if (set.has(k)) own += v;
    }
  }
  return own / (all + 1e-6);
}

function tonesOf(chord) {
  const max = Math.max(...chord.weights);
  const out = new Set();
  for (let k = 0; k < 12; k++) if (chord.weights[k] >= 0.5 * max) out.add(k);
  return out;
}

function chromaCos(feat, weights, t0, t1) {
  const f0 = Math.max(0, Math.round(t0 * feat.fps));
  const f1 = Math.min(feat.frames - 1, Math.round(t1 * feat.fps));
  let s = 0;
  let n2 = 0;
  for (let f = f0; f <= f1; f++) {
    for (let k = 0; k < 12; k++) {
      const v = feat.chroma[f * 12 + k];
      s += v * weights[k];
      n2 += v * v;
    }
  }
  return s / (Math.sqrt(n2) + 0.3 * (f1 - f0 + 1));
}

// Local maxima of the onset envelope in [t0, t1] seconds: [{ t, strength }].
function attacks(feat, t0, t1) {
  const out = [];
  const i0 = Math.max(1, Math.floor(t0 * feat.onsetFps));
  const i1 = Math.min(feat.onset.length - 2, Math.ceil(t1 * feat.onsetFps));
  for (let i = i0; i <= i1; i++) {
    const v = feat.onset[i];
    if (v >= ATTACK_MIN && v >= feat.onset[i - 1] && v > feat.onset[i + 1]) out.push({ t: i / feat.onsetFps, strength: v });
  }
  return out;
}

// Earliest instant in [from, t - LEAD_MIN] where the chroma looks clearly more like the new chord than the old one (by
// LEAD_DIFF, and still on average over the next 0.3 s), or null. The attack is a little before the chroma shows it.
const LEAD_MIN = 0.3;
const LEAD_DIFF = 0.1;
const LEAD_AVG = 0.08;
// Round 12 (event 306: G -> D, D is inside G and the passing notes of the bass raised the chroma of D 0.6 s early): the lead only counts when
// the new chord has a note that the old one lacks and that note rises in the chroma, AND the bass moves to the root of the new chord at
// that instant (a passing note is not a change of chord). (An attack at the instant would be the natural test, but these changes are
// the ones where the onset envelope has none.)
const LEAD_NOTE_RISE = 0.1;
const LEAD_BASS_RISE = 0.05; // the bass share of the new root rises (event 32: +0.11; event 306: -0.12)
function chromaLead(feat, t, next, prev, from) {
  if (!prev) return null;
  const dist = [...tonesOf(next)].filter((k) => !tonesOf(prev).has(k));
  if (!dist.length) return null;
  const distSet = new Set(dist);
  const cosAt = (w, f) => {
    let sd = 0;
    let n2 = 0;
    for (let k = 0; k < 12; k++) { const v = feat.chroma[f * 12 + k]; sd += v * w[k]; n2 += v * v; }
    return sd / (Math.sqrt(n2) + 0.3);
  };
  const diff = (f) => cosAt(next.weights, f) - cosAt(prev.weights, f);
  const f0 = Math.max(0, Math.ceil(from * feat.fps));
  const f1 = Math.min(feat.frames - 4, Math.floor((t - LEAD_MIN) * feat.fps));
  const ahead = Math.ceil(0.3 * feat.fps);
  for (let f = f0; f <= f1; f++) {
    if (diff(f) < LEAD_DIFF) continue;
    let m = 0;
    for (let q = 0; q < ahead; q++) m += diff(f + q);
    if (m / ahead < LEAD_AVG) continue;
    const at = Math.max(0, f / feat.fps - 0.05);
    const rise = chromaShare(feat, distSet, at + 0.05, at + 0.35) - chromaShare(feat, distSet, at - 0.4, at - 0.05);
    if (rise < LEAD_NOTE_RISE) continue;
    if (prev.bass !== next.bass) {
      const rootAfter = bassShare(feat, next.bass, at + 0.05, at + 0.4);
      const rootBefore = bassShare(feat, next.bass, at - 0.4, at - 0.05);
      if (rootAfter - rootBefore < LEAD_BASS_RISE) continue;
    }
    return at;
  }
  return null;
}

// feat: features (fps, frames, chroma, bass, onset, onsetFps). t: the boundary chosen by the alignment (seconds).
// next: chord of the event ({ bass, weights } already shifted to the recording), prev: chord before it (or null).
// Returns { t, found: 'bass' | 'attack' | null, strength } (t is `t` itself when nothing better is found).
export function refineBoundary(feat, t, next, prev, { before = REFINE_BEFORE, after = REFINE_AFTER, minT = 0, maxT = Infinity } = {}) {
  const cand = attacks(feat, Math.max(minT, t - before), Math.min(maxT, t + after));
  let bestCompat = null;
  // the notes that tell the new chord from the old one
  const nt = tonesOf(next);
  const pt = prev ? tonesOf(prev) : new Set();
  const dist = new Set([...nt].filter((k) => !pt.has(k)));
  for (const a of cand) {
    const rootAfter = bassShare(feat, next.bass, a.t + 0.05, a.t + 0.4);
    const rootBefore = bassShare(feat, next.bass, a.t - 0.4, a.t - 0.05);
    const sameBass = prev && prev.bass === next.bass;
    if (!sameBass && rootAfter >= BASS_AFTER_MIN && rootAfter - rootBefore >= BASS_RISE_MIN) return { t: a.t, found: 'bass', strength: a.strength, rootAfter, rise: rootAfter - rootBefore };
    if (dist.size) {
      const toneAfter = chromaShare(feat, dist, a.t + 0.05, a.t + 0.35);
      const toneRise = toneAfter - chromaShare(feat, dist, a.t - 0.4, a.t - 0.05);
      if (toneAfter >= TONE_AFTER_MIN && toneRise >= TONE_RISE_MIN) return { t: a.t, found: 'tone', strength: a.strength, rootAfter, rise: toneRise };
    }
    const gain = chromaCos(feat, next.weights, a.t + 0.05, a.t + 0.5) - chromaCos(feat, next.weights, a.t - 0.5, a.t - 0.05);
    if (gain > COMPAT_MIN && (!bestCompat || a.strength > bestCompat.strength)) bestCompat = { ...a, gain, rootAfter, rise: rootAfter - rootBefore };
  }
  if (!bestCompat) {
    // no attack at all (a soft arpeggio): the new chord may still stand out in the chroma well before the chosen boundary
    const c = chromaLead(feat, t, next, prev, Math.max(minT, t - Math.min(before, 0.8)));
    if (c !== null) return { t: c, found: 'chroma', strength: 0 };
  }
  if (bestCompat) return { t: bestCompat.t, found: 'attack', strength: bestCompat.strength, gain: bestCompat.gain, rootAfter: bestCompat.rootAfter, rise: bestCompat.rise };
  return { t, found: null, strength: 0 };
}

const rampRefine = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
// A strong attack (a chord strummed, not a single note) that agrees with the chroma boundary; calibrated on the benches
// of the tester and of the implementer (see the round 9 report).
const STRUM_STRENGTH = 10;
export const FREE_CONF_MAX = 0.55;
// confidence given by the sharpness of the chroma boundary alone (a crisp boundary is right 82-100% of the time from 6 on)
const REFINE_SHARP_LO = 3.5;
const REFINE_SHARP_HI = 6.5;

// The boundary of one event of a section without a stable beat, from the two estimators: the one of the alignment
// (`tChroma`, with its sharpness) and the refined one. Returns { t, conf, kind }:
//   bass-agree / attack-agree: the estimators agree within 150 ms (the refined one is the better of the two)  -> high
//   bass-big / tone-big: the bass (or a note of the new chord only) comes in 0.4-1 s before the chroma boundary: the
//                         arpeggio showed the chord late; the refined time is used                              -> medium
//   anything else: the chroma boundary is kept, with the confidence of its sharpness (low)
export function freeBoundary(feat, tChroma, sharpness, next, prev, bounds = {}) {
  const r = refineBoundary(feat, tChroma, next, prev, bounds);
  const d = r.t - tChroma;
  const ad = Math.abs(d);
  const cs = FREE_CONF_MAX * rampRefine(sharpness, REFINE_SHARP_LO, REFINE_SHARP_HI);
  const bassStrong = r.found === 'bass' && r.strength >= 3 && r.rise >= 0.3;
  if (bassStrong) {
    if (ad <= 0.15) return { t: r.t, conf: FREE_CONF_MAX, kind: 'bass-agree' };
    if (ad >= 0.4) return { t: r.t, conf: 0.45, kind: 'bass-big' };
    return { t: tChroma, conf: Math.min(cs, 0.25), kind: 'bass-mid' };
  }
  if (r.found === 'tone' && r.strength >= 5) {
    if (ad >= 0.4) return { t: r.t, conf: 0.4, kind: 'tone-big' };
    return { t: tChroma, conf: Math.max(cs, 0.25), kind: 'tone-small' };
  }
  if (r.found === 'chroma') return { t: r.t, conf: 0.3, kind: 'chroma-lead' };
  if (r.found === 'attack' && ad <= 0.15 && r.strength >= STRUM_STRENGTH) return { t: tChroma, conf: 0.5, kind: 'attack-agree' };
  return { t: tChroma, conf: Math.max(cs, 0.1), kind: 'keep' };
}
