// Beat grid of the synced audio (pure, runs in Node): a smooth, continuous grid of beats per stable-tempo section,
// its compact storage form, and the clicks (ticks) that every chord gets from it.
//
// Stored form of a grid (per section, in the alignment): { t0, per, dev } where beat k (0-based) is at
// t0 + k * per + dev[k] / 1000 seconds, dev being whole milliseconds (small when the tempo is steady).

const round3dp = (v) => Math.round(v * 1000) / 1000;

// Smooth beat times from tracked ones (Ellis DP beats wobble by tens of ms and skip beats): beat numbers are assigned
// sequentially, then each beat is the value of a locally weighted line through its neighbours (Gaussian, sigma beats),
// so the intervals change slowly and every beat number has a time. The grid is extended to cover [fromSec - margin, toSec + margin].
// Returns a stored-form grid or null when there is not enough to go on.
export function smoothBeatGrid(beatTimes, bpm, fromSec, toSec, { sigma = 3, margin = 0.6 } = {}) {
  if (!Array.isArray(beatTimes) || beatTimes.length < 4 || !(bpm > 0)) return null;
  const p0 = 60 / bpm;
  const t = beatTimes.slice().sort((a, b) => a - b);
  const ks = [0];
  for (let i = 1; i < t.length; i++) ks.push(ks[i - 1] + Math.max(1, Math.round((t[i] - t[i - 1]) / p0)));
  // weighted line fit around beat number k: returns { at, slope } (time and local period at k)
  const fitAt = (k, rejectBelow = Infinity) => {
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    const lo = k - 3 * sigma;
    const hi = k + 3 * sigma;
    for (let i = 0; i < t.length; i++) {
      if (ks[i] < lo || ks[i] > hi) continue;
      const d = (ks[i] - k) / sigma;
      const w = Math.exp(-0.5 * d * d);
      sw += w; sk += w * ks[i]; st += w * t[i]; skk += w * ks[i] * ks[i]; skt += w * ks[i] * t[i];
    }
    if (sw < 1.5) return null;
    const den = sw * skk - sk * sk;
    if (den <= 1e-9) return null;
    const slope = (sw * skt - sk * st) / den;
    const icpt = (st - slope * sk) / sw;
    return { at: icpt + slope * k, slope: Math.min(1.5 * p0, Math.max(0.67 * p0, slope)) };
  };
  const kFirst = ks[0];
  const kLast = ks[ks.length - 1];
  const edgeLo = fitAt(kFirst);
  const edgeHi = fitAt(kLast);
  if (!edgeLo || !edgeHi) return null;
  const timeOf = (k) => {
    if (k < kFirst) return edgeLo.at + (k - kFirst) * edgeLo.slope;
    if (k > kLast) return edgeHi.at + (k - kLast) * edgeHi.slope;
    const f = fitAt(k);
    if (f) return f.at;
    // no neighbours (a long hole in the tracked beats): interpolate between the surrounding tracked ones
    let i = 0;
    while (i + 1 < ks.length && ks[i + 1] < k) i++;
    const j = Math.min(i + 1, ks.length - 1);
    return ks[j] === ks[i] ? t[i] : t[i] + ((k - ks[i]) / (ks[j] - ks[i])) * (t[j] - t[i]);
  };
  let kA = kFirst;
  while (timeOf(kA - 1) >= fromSec - margin * p0 && kFirst - kA < 64) kA--;
  let kB = kLast;
  while (timeOf(kB + 1) <= toSec + margin * p0 && kB - kLast < 64) kB++;
  const times = [];
  for (let k = kA; k <= kB; k++) times.push(timeOf(k));
  return packGrid(times);
}

// Stored form from a list of beat times (one per beat number, increasing).
export function packGrid(times) {
  const n = times.length;
  if (n < 2) return null;
  const per = Math.round(((times[n - 1] - times[0]) / (n - 1)) * 1e4) / 1e4;
  const t0 = round3dp(times[0]);
  return { t0, per, dev: times.map((v, i) => Math.round((v - t0 - i * per) * 1000)) };
}

export function gridTimes(grid) {
  return grid.dev.map((d, i) => grid.t0 + i * grid.per + d / 1000);
}

// A regular grid (start + k * period) for a stable section that has no stored grid (older alignments, hand-made ones):
// the phase is the circular mean of the offsets of the chord starts, weighted by their confidence.
export function regularGridTimes(starts, weights, bpm, fromSec, toSec, margin = 0.6) {
  const per = 60 / bpm;
  let cs = 0, sn = 0;
  starts.forEach((s, i) => {
    const w = weights ? weights[i] : 1;
    const a = (2 * Math.PI * (s % per)) / per;
    cs += w * Math.cos(a);
    sn += w * Math.sin(a);
  });
  const phase = starts.length && (cs || sn) ? ((Math.atan2(sn, cs) / (2 * Math.PI)) * per + per) % per : (starts.length ? starts[0] % per : 0);
  const out = [];
  let k = Math.ceil((fromSec - margin * per - phase) / per);
  for (let t = phase + k * per; t <= toSec + margin * per; t = phase + ++k * per) out.push(t);
  return out;
}

// Ticks of the chords of a stable-tempo section from its grid. `events`: [{ start, end }] of the chords of the section
// that are in the audio, in order (end = where the chord stops sounding). A beat of the grid belongs to the chord whose
// start is the nearest at or after it, to within TICK_TOL of a period: chord starts found a little early or late still
// get the beat that is theirs. Returns { ticks[][]: per event, [{ timeSec, k }], per, phase } where k is the beat number in
// `times`. `perBar` and the downbeat: every perBar beats, from the phase that puts most chord starts on a downbeat
// (ties: the one that makes the first beat of the section a downbeat).
export const TICK_TOL = 0.45;
const END_TOL = 0.15;
export function gridTicks(times, per, events, perBar) {
  const ticks = events.map(() => []);
  let k = 0;
  events.forEach((ev, j) => {
    const lo = ev.start - TICK_TOL * per;
    const next = events[j + 1];
    // the window of a chord ends where the next one's begins; the last chord of a stretch (music end, a gap) a little before its end
    const hi = next && !ev.stop ? next.start - TICK_TOL * per : ev.end - (ev.stop ? END_TOL : TICK_TOL) * per;
    while (k < times.length && times[k] < lo - 1e-9) k++;
    let q = k;
    while (q < times.length && times[q] < hi - 1e-9) { ticks[j].push({ timeSec: times[q], k: q }); q++; }
    k = Math.max(k, q);
  });
  return { ticks, phase: barPhase(ticks, perBar) };
}

function barPhase(ticks, perBar) {
  const firsts = ticks.filter((t) => t.length).map((t) => t[0].k);
  if (!firsts.length) return 0;
  const k0 = firsts[0];
  let best = ((k0 % perBar) + perBar) % perBar;
  let bestScore = -1;
  for (let off = 0; off < perBar; off++) {
    const p = (((k0 + off) % perBar) + perBar) % perBar; // off 0 first: the first beat a downbeat wins ties
    const score = firsts.filter((k) => (((k - p) % perBar) + perBar) % perBar === 0).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

export const barPosition = (k, phase, perBar) => (((k - phase) % perBar) + perBar) % perBar;

// Ticks of a free-tempo section: ONE accented tick at every chord start and nothing in between (round 12: ticks at a constant period
// do not fall on the beats of a passage played freely, so they sounded out of time). `events`: [{ start, end }]. Returns
// [[{ timeSec, bar }]] per event. (`per` and `perBar` are kept for the callers: they no longer matter here.)
export function freeTicks(events) {
  return events.map(({ start }) => [{ timeSec: start, bar: 0 }]);
}
