// The sheet aligned on the audio (pure, runs in Node): what is stored in song.audio.alignment, the
// colour state of every section, the correction of one section from taps, the export of the verified
// sections as ground truth, and the adoption of the measured tempos and durations.

export const ALIGNMENT_VERSION = 1;
// section state from the confidence of the section (median of its changes); a free tempo (no stable beat) is yellow at most
export const CONF_GREEN = 0.75;
export const CONF_YELLOW = 0.5;
// without a stable beat the colour is yellow at most (the engine caps the confidence of those changes at 0.55); from 0.30 (round 10: 0.35 made 53% of the changes of the red sections right on the tester bench, 47% on all benches)
export const CONF_YELLOW_FREE = 0.3;
const MIN_GAP_SEC = 0.05;
// music not in the sheet shorter than this (a bar of passage the sheet does not write) is not a gap: the previous chord
// simply lasts longer
export const GAP_MIN_SEC = 3;
// a transposition is proposed only if the best one beats the second best by this share of its score
// (true recordings: 0.19-0.25 on the synthetic benches; noise, silence or another song: below 0.02)
export const TRANSPOSE_MIN_RATIO = 0.1;
// The same ratio tells the right song from noise or another song even when the audio is very noisy: it grows with the
// noise for the right song (0.30-0.39 at -5..-12 dB white noise, 0.16 clean) and stays at 0.00-0.07 for white noise, silence
// or another song. Above this the audio is recognised whatever the colours say (round 9; before: -5 dB was the limit).
export const RECOGNISED_MATCH = 0.12;
// the audio is not recognised when this share of the sections (with chords) is red
export const NOT_RECOGNISED_RED = 0.75;

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// Chord events of the song in reading order (the order of the timeline and of the analysis).
export function eventRefs(song) {
  const out = [];
  song.sections.forEach((sec, si) => {
    sec.lines.forEach((line, li) => {
      line.chords.forEach((c, ci) => out.push({ section: si, line: li, chord: ci, name: c.name, rest: !!c.rest }));
    });
  });
  return out;
}

// Indices (into the event list) of the events of every section.
export function sectionEventIndices(song) {
  const out = song.sections.map(() => []);
  eventRefs(song).forEach((e, j) => out[e.section].push(j));
  return out;
}

// How much the best transposition of the sheet beats the second best, relative to the score (null: not known).
export function matchRatio(result) {
  const m = result.transposeMargin;
  const sc = result.transposeScore;
  if (!Number.isFinite(sc) || !Number.isFinite(m) || sc === 0) return null;
  return m / Math.abs(sc);
}

export function transposeTrusted(result) {
  const m = result.transposeMargin;
  const sc = result.transposeScore;
  if (!Number.isFinite(sc) || !(m <= Infinity)) return true; // no margin information (older results)
  return m >= TRANSPOSE_MIN_RATIO * Math.abs(sc);
}

// Alignment to store, from the result of analyseAndAlign.
export function makeAlignment(result, song, createdAt = new Date().toISOString()) {
  const refs = eventRefs(song);
  const N = refs.length;
  const idx = sectionEventIndices(song);
  const endSec = result.eventEndSec ? result.eventEndSec[N - 1] : result.eventStartSec[N - 1] + 2;
  return {
    version: ALIGNMENT_VERSION,
    eventStartSec: result.eventStartSec.map(r3),
    confidence: result.confidence.map(r2),
    names: refs.map((e) => e.name),
    endSec: r3(Math.max(endSec, result.eventStartSec[N - 1] + 0.2)),
    eventBeats: (result.eventBeats || []).map((b) => (Number.isFinite(b) ? b : null)),
    // music that is not in the sheet (a repeat, a solo...) between the end of event before-1 and the start of `before`
    // events (indices) that the audio does not have: the audio is shorter than the sheet, or a whole section is missing
    skipped: (result.skipped || []).map((v, j) => (v ? j : -1)).filter((j) => j >= 0),
    gaps: (result.gaps || []).filter((g) => g.endSec - g.startSec >= GAP_MIN_SEC).map((g) => ({ before: g.before, startSec: r3(g.startSec), endSec: r3(g.endSec) })),
    sections: song.sections.map((_, si) => {
      const s = result.sections[si] || {};
      const i0 = idx[si][0];
      return {
        startSec: i0 === undefined ? null : r3(result.eventStartSec[i0]),
        bpm: Number.isFinite(s.bpm) ? s.bpm : null,
        confidence: r2(Number.isFinite(s.confidence) ? s.confidence : 0),
        verified: false,
        skipped: !!s.skipped,
        // why a section cannot be trusted besides its own tempo: 'sisters' (it lasts differently from the sections with the same
        // chords), 'offgrid' (its changes miss the beats); null otherwise
        why: s.why === 'sisters' || s.why === 'offgrid' || s.why === 'cut' ? s.why : null,
        // continuous grid of beats of a stable-tempo section (see beatgrid.js): the clicks of the metronome sit on it
        grid: normalizeGrid(s.grid),
      };
    }),
    // where the music of the audio ends (the clicks stop there); null: not known
    musicEndSec: Number.isFinite(result.musicEndSec) ? r3(result.musicEndSec) : null,
    match: matchRatio(result) === null ? null : r3(matchRatio(result)),
    // the alignment was found in a transposition that does not clearly beat the others: it may be a different song
    // that shares some chords (not recognised, see alignmentRecognised)
    shiftUntrusted: !transposeTrusted(result) && (result.transposeFound || 0) !== 0,
    forced: false,
    transposeFound: transposeTrusted(result) ? result.transposeFound || 0 : 0,
    tuningCents: Math.round((result.tuningCents || 0) * 10) / 10,
    shiftSec: 0,
    accepted: false,
    createdAt,
  };
}

// A stored grid { t0, per, dev[] } is kept only when it is sound (see beatgrid.js).
function normalizeGrid(g) {
  if (!g || !Number.isFinite(g.t0) || !(g.per > 0.1 && g.per < 2) || !Array.isArray(g.dev) || g.dev.length < 2 || g.dev.length > 5000 || !g.dev.every((d) => Number.isFinite(d))) return null;
  return { t0: g.t0, per: g.per, dev: g.dev.map((d) => Math.round(d)) };
}

// Cleans a stored alignment (import, migration). Returns null for anything unusable.
export function normalizeAlignment(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== ALIGNMENT_VERSION) return null;
  const ok = (a) => Array.isArray(a) && a.length > 0 && a.every((v) => Number.isFinite(v));
  if (!ok(raw.eventStartSec) || !Array.isArray(raw.confidence) || raw.confidence.length !== raw.eventStartSec.length) return null;
  for (let i = 1; i < raw.eventStartSec.length; i++) if (raw.eventStartSec[i] < raw.eventStartSec[i - 1]) return null;
  if (!Array.isArray(raw.sections)) return null;
  const N = raw.eventStartSec.length;
  const last = raw.eventStartSec[N - 1];
  return {
    version: ALIGNMENT_VERSION,
    eventStartSec: raw.eventStartSec.slice(),
    confidence: raw.confidence.map((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)),
    names: Array.isArray(raw.names) && raw.names.length === N ? raw.names.map((n) => String(n).slice(0, 20)) : null,
    endSec: Number.isFinite(raw.endSec) && raw.endSec > last ? raw.endSec : last + 2,
    eventBeats: Array.isArray(raw.eventBeats) && raw.eventBeats.length === N ? raw.eventBeats.map((b) => (Number.isFinite(b) && b >= 1 ? Math.round(b) : null)) : new Array(N).fill(null),
    skipped: Array.isArray(raw.skipped) ? Array.from(new Set(raw.skipped.filter((j) => Number.isInteger(j) && j >= 0 && j < N))).sort((a, b) => a - b) : [],
    gaps: Array.isArray(raw.gaps) ? raw.gaps.filter((g) => g && Number.isInteger(g.before) && g.before >= 1 && g.before < N && Number.isFinite(g.startSec) && Number.isFinite(g.endSec) && g.endSec >= g.startSec && g.startSec >= raw.eventStartSec[g.before - 1] && g.endSec <= raw.eventStartSec[g.before] + 1e-6).map((g) => ({ before: g.before, startSec: g.startSec, endSec: g.endSec })) : [],
    sections: raw.sections.map((s) => ({
      startSec: s && Number.isFinite(s.startSec) ? s.startSec : null,
      bpm: s && Number.isFinite(s.bpm) ? s.bpm : null,
      confidence: s && Number.isFinite(s.confidence) ? Math.min(1, Math.max(0, s.confidence)) : 0,
      verified: !!(s && s.verified),
      skipped: !!(s && s.skipped),
      why: s && (s.why === 'sisters' || s.why === 'offgrid' || s.why === 'cut') ? s.why : null,
      grid: normalizeGrid(s && s.grid),
    })),
    musicEndSec: Number.isFinite(raw.musicEndSec) && raw.musicEndSec > last ? raw.musicEndSec : null,
    match: Number.isFinite(raw.match) ? raw.match : null,
    shiftUntrusted: !!raw.shiftUntrusted,
    forced: !!raw.forced,
    transposeFound: Number.isInteger(raw.transposeFound) ? raw.transposeFound : 0,
    tuningCents: Number.isFinite(raw.tuningCents) ? raw.tuningCents : 0,
    shiftSec: Number.isFinite(raw.shiftSec) ? Math.max(-5, Math.min(5, raw.shiftSec)) : 0,
    accepted: !!raw.accepted,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    ...(normalizeDecode(raw.decode) ? { decode: normalizeDecode(raw.decode) } : {}),
  };
}

// How the audio was decoded for the analysis (diagnostics only): { method: 'pieces' | 'whole', pieceShiftsMs: [] }
function normalizeDecode(d) {
  if (!d || typeof d !== 'object' || (d.method !== 'pieces' && d.method !== 'whole')) return null;
  const shifts = Array.isArray(d.pieceShiftsMs) ? d.pieceShiftsMs.filter((v) => Number.isFinite(v)).slice(0, 200) : [];
  return { method: d.method, pieceShiftsMs: shifts };
}

// Does the alignment still describe this sheet? (same number of events, same chord names)
export function alignmentFits(alignment, song) {
  if (!alignment || !song || !Array.isArray(song.sections)) return false;
  const refs = eventRefs(song);
  if (refs.length !== alignment.eventStartSec.length || alignment.sections.length !== song.sections.length) return false;
  if (alignment.names) for (let j = 0; j < refs.length; j++) if (alignment.names[j] !== refs[j].name) return false;
  return true;
}

// 'verified' | 'green' | 'yellow' | 'red' | 'skipped' (the audio does not have the section)
export function sectionState(alignment, si) {
  const s = alignment.sections[si];
  if (!s) return 'red';
  if (s.skipped) return 'skipped';
  if (s.verified) return 'verified';
  if (s.bpm === null) return s.confidence >= CONF_YELLOW_FREE ? 'yellow' : 'red'; // no stable beat: never green
  return s.confidence >= CONF_GREEN ? 'green' : s.confidence >= CONF_YELLOW ? 'yellow' : 'red';
}

// Is the audio the song of the sheet? false when almost every section is red (wrong file, noise, silence).
export function alignmentRecognised(alignment, song) {
  if (alignment.shiftUntrusted) return false;
  const idx = sectionEventIndices(song);
  let n = 0;
  let red = 0;
  let skippedSecs = 0;
  let good = 0;
  let yellow = 0;
  idx.forEach((list, si) => {
    if (!list.length) return;
    const st = sectionState(alignment, si);
    if (st === 'skipped') { skippedSecs++; return; }
    n++;
    if (st === 'red') red++;
    if (st === 'green' || st === 'verified') good++;
    if (st === 'yellow') yellow++;
  });
  // almost everything skipped: nothing of the sheet is in the audio
  if (n === 0) return skippedSecs === 0;
  // (when part of the sheet is not in the audio, the rest must show some sign of the right song: a section that is sure,
  // or at least two to check: a different song gets one yellow stretch at the start and the rest skipped)
  if (red / n < NOT_RECOGNISED_RED) return skippedSecs === 0 || good >= 1 || yellow >= 2;
  // mostly red (a very noisy recording): still the right song if the sheet fits the audio far better in its best
  // transposition than in any other, and it is not mostly skipped
  return Number.isFinite(alignment.match) && alignment.match >= RECOGNISED_MATCH && skippedSecs <= n;
}

// "Usa comunque": keeps an alignment that was not recognised, with every section yellow or red at most.
export function capAtYellow(alignment) {
  const top = CONF_GREEN - 0.01;
  alignment.confidence = alignment.confidence.map((c) => Math.min(c, top));
  alignment.sections.forEach((s) => { if (!s.verified) s.confidence = Math.min(s.confidence, top); });
  alignment.forced = true;
  return alignment;
}

export function countVerified(alignment) {
  return alignment.sections.filter((s) => s.verified).length;
}

// Event times seen by the timeline: the aligned ones plus the global shift, with the manual anchors
// of sections 1.. on top. An anchored section starts exactly at its anchor; its events are stretched
// between the anchor and the (possibly also anchored) start of the next section, so nothing overlaps.
// Returns { starts[], ends[], endSec, gaps[], warnings }: `ends[j]` is where event j stops sounding (the start of
// the next one, or the start of a stretch of music not in the sheet), `gaps` the stretches [{ startSec, endSec }].
export function effectiveEventTimes(song, alignment, anchors = null) {
  const shift = alignment.shiftSec || 0;
  const starts = alignment.eventStartSec.map((t) => t + shift);
  const gapEndOf = new Map((alignment.gaps || []).filter((g) => g.endSec - g.startSec >= GAP_MIN_SEC).map((g) => [g.before - 1, g]));
  const skippedSet = new Set(alignment.skipped || []);
  const endLast = alignment.endSec + shift;
  const warnings = [];
  const idx = sectionEventIndices(song);
  const secs = [];
  idx.forEach((list, si) => { if (list.length && !list.every((j) => skippedSet.has(j))) secs.push({ si, i0: list[0], i1: list[list.length - 1] }); });
  const hasAnchors = anchors && secs.some((m) => m.si > 0 && Number.isFinite(anchors[m.si]));
  const finish = (endSec) => {
    const ends = starts.map((t, j) => (j + 1 < starts.length ? starts[j + 1] : endSec));
    const gaps = [];
    gapEndOf.forEach((g, j) => {
      if (!(j + 1 < starts.length)) return;
      // the gap keeps its proportions inside the span between the (possibly moved) event j and j+1
      const o0 = alignment.eventStartSec[j] + shift;
      const o1 = alignment.eventStartSec[j + 1] + shift;
      const f = o1 > o0 ? (starts[j + 1] - starts[j]) / (o1 - o0) : 1;
      const a = starts[j] + (g.startSec + shift - o0) * f;
      if (a > starts[j] && a < starts[j + 1]) { ends[j] = a; gaps.push({ startSec: a, endSec: starts[j + 1] }); }
    });
    return { starts, ends, endSec, gaps, warnings };
  };
  if (!hasAnchors) return finish(endLast);
  const bOld = secs.map((m) => starts[m.i0]).concat([endLast]);
  const bNew = bOld.slice();
  secs.forEach((m, k) => {
    if (m.si === 0) return;
    const a = Number(anchors[m.si]);
    if (!Number.isFinite(a)) return;
    const prev = k > 0 ? bNew[k - 1] : -Infinity;
    if (a <= prev + MIN_GAP_SEC) { warnings.push(`ancora della sezione ${m.si + 1} ignorata: non è dopo la sezione precedente`); return; }
    bNew[k] = a;
  });
  for (let k = 1; k <= secs.length; k++) if (bNew[k] <= bNew[k - 1] + MIN_GAP_SEC) { bNew[k] = Math.max(bOld[k], bNew[k - 1] + MIN_GAP_SEC); warnings.push('ancore troppo vicine alla sezione successiva: spostata'); }
  secs.forEach((m, k) => {
    const o0 = bOld[k];
    const o1 = bOld[k + 1];
    const n0 = bNew[k];
    const n1 = bNew[k + 1];
    const f = o1 > o0 ? (n1 - n0) / (o1 - o0) : 1;
    for (let j = m.i0; j <= m.i1; j++) starts[j] = n0 + (starts[j] - o0) * f;
  });
  return finish(bNew[secs.length]);
}

// Replaces the start times of the events of section `si` (e.g. from the taps of "Correggi a orecchio").
// `startsSec` must have one entry per event of the section, strictly increasing, after the end of the previous
// section and before the start of the next. Mutates `alignment` only when ok; the section becomes verified.
// With `partial` fewer entries are accepted (the person stopped before the end): they go to the first events of the
// section, the others keep their automatic time (which must come after the last of them), and the section is not
// marked verified. With `from` the taps start at that event of the section (the person began from a chord in the
// middle): they go to the events from..from+m-1, and the ones before and after keep their automatic times.
// Returns { ok, reason? } or, when ok, { ok, missing } with the section positions left untimed.
export function replaceSectionStarts(alignment, song, si, startsSec, { partial = false, from = 0 } = {}) {
  const idx = sectionEventIndices(song)[si];
  if (!idx || !idx.length) return { ok: false, reason: 'La sezione non ha accordi' };
  const m = startsSec.length;
  const first0 = Math.max(0, Math.min(idx.length - 1, Math.floor(from) || 0));
  const room = idx.length - first0;
  if (m === 0 || m > room || (m < idx.length && !partial)) return { ok: false, reason: `Servono ${idx.length} tocchi, ne hai fatti ${m}` };
  for (let k = 0; k < m; k++) {
    if (!Number.isFinite(startsSec[k]) || startsSec[k] < 0 || (k > 0 && startsSec[k] <= startsSec[k - 1])) return { ok: false, reason: 'I tocchi non sono in ordine' };
  }
  const shift = alignment.shiftSec || 0;
  const first = idx[0];
  const prevEnd = first0 > 0 ? alignment.eventStartSec[idx[first0 - 1]] + shift : first > 0 ? alignment.eventStartSec[first - 1] + shift : -Infinity;
  const nextStart = idx[idx.length - 1] + 1 < alignment.eventStartSec.length ? alignment.eventStartSec[idx[idx.length - 1] + 1] + shift : Infinity;
  if (startsSec[0] <= prevEnd + MIN_GAP_SEC) return { ok: false, reason: first0 > 0 ? 'Il primo tocco cade prima dell’accordo che lo precede: hai toccato troppo presto?' : 'Il primo tocco cade prima della fine della sezione precedente' };
  const lastK = first0 + m - 1;
  const limit = lastK < idx.length - 1 ? alignment.eventStartSec[idx[lastK + 1]] + shift : nextStart;
  if (startsSec[m - 1] >= limit - MIN_GAP_SEC) {
    return { ok: false, reason: lastK < idx.length - 1 ? 'Gli ultimi tocchi cadono dopo l’inizio automatico degli accordi che mancano: hai saltato un tocco?' : 'L’ultimo tocco cade dopo l’inizio della sezione successiva' };
  }
  for (let k = 0; k < m; k++) {
    const j = idx[first0 + k];
    alignment.eventStartSec[j] = r3(startsSec[k] - shift);
    alignment.confidence[j] = 1;
    alignment.eventBeats[j] = null;
  }
  const s = alignment.sections[si];
  if (first0 === 0) s.startSec = r3(startsSec[0] - shift);
  const complete = first0 === 0 && m === idx.length;
  if (complete) {
    s.confidence = 1;
    s.verified = true;
  }
  // a gap that sat before an event that was moved is no longer reliable: drop the ones that no longer fit
  if (alignment.gaps) alignment.gaps = alignment.gaps.filter((g) => g.startSec >= alignment.eventStartSec[g.before - 1] && g.endSec <= alignment.eventStartSec[g.before] + 1e-6);
  const missing = [];
  for (let k = 0; k < idx.length; k++) if (k < first0 || k > lastK) missing.push(k);
  return { ok: true, missing };
}

// Copy of the alignment with the starts of a section replaced (preview before saving). Same result shape.
export function previewReplace(alignment, song, si, startsSec, options = {}) {
  const copy = JSON.parse(JSON.stringify(alignment));
  const r = replaceSectionStarts(copy, song, si, startsSec, options);
  return r.ok ? { ok: true, alignment: copy, missing: r.missing } : r;
}

// Global shift of the whole alignment (fine adjustment of "everything a bit earlier / later").
export function shiftAlignment(alignment, deltaSec) {
  alignment.shiftSec = r3(Math.max(-5, Math.min(5, (alignment.shiftSec || 0) + deltaSec)));
}

// Verified sections as ground truth for the engine: only times and chord names, no text.
// [{ index, name, chords[], eventStartSec[], verified: true }]
export function exportTruth(song, alignment) {
  const idx = sectionEventIndices(song);
  const refs = eventRefs(song);
  const shift = alignment.shiftSec || 0;
  const sections = [];
  song.sections.forEach((sec, si) => {
    if (!alignment.sections[si].verified || !idx[si].length) return;
    sections.push({
      index: si,
      name: sec.name || `Sezione ${si + 1}`,
      chords: idx[si].map((j) => refs[j].name),
      eventStartSec: idx[si].map((j) => r3(alignment.eventStartSec[j] + shift)),
      verified: true,
    });
  });
  return { app: 'guitarapp', kind: 'alignment-truth', version: 1, eventCount: refs.length, sections };
}

// Brings the measured tempos and the durations in beats into the song (for studying with the
// metronome with the real timing); `counts` (alignedEventBeats) are the quarters of every chord as the metronome plays them. Returns { sections, events } changed.
export function applyMeasuredTiming(song, alignment, counts = null) {
  const idx = sectionEventIndices(song);
  const refs = eventRefs(song);
  let sections = 0;
  let events = 0;
  song.sections.forEach((sec, si) => {
    const s = alignment.sections[si];
    if (!s || !Number.isFinite(s.bpm) || !idx[si].length) return;
    sec.bpm = Math.min(300, Math.max(30, Math.round(s.bpm * 10) / 10));
    sec.bpmSource = 'edited';
    sections++;
    for (const j of idx[si]) {
      const b = counts ? counts[j] : alignment.eventBeats[j];
      if (!Number.isFinite(b) || b < 1) continue;
      const r = refs[j];
      song.sections[r.section].lines[r.line].chords[r.chord].beats = b;
      events++;
    }
  });
  if (events) song.timingSource = 'edited';
  return { sections, events };
}

// ---- quick fine correction (round 10): move a chord, the rest of its section, or a whole section a little ----
// No chord may last less than this after a nudge, and the order of the times is never inverted.
export const NUDGE_MIN_DUR_SEC = 0.1;

// Copy of what a nudge changes (to undo it).
export function snapshotTimes(alignment) {
  return JSON.parse(JSON.stringify({ eventStartSec: alignment.eventStartSec, confidence: alignment.confidence, eventBeats: alignment.eventBeats, gaps: alignment.gaps || [], sections: alignment.sections, endSec: alignment.endSec }));
}
export function restoreTimes(alignment, snap) {
  const c = JSON.parse(JSON.stringify(snap));
  alignment.eventStartSec = c.eventStartSec;
  alignment.confidence = c.confidence;
  alignment.eventBeats = c.eventBeats;
  alignment.gaps = c.gaps;
  alignment.sections = c.sections;
  alignment.endSec = c.endSec;
}

// Events (indices) that are really in the audio, in time order.
function presentSet(alignment) {
  const sk = new Set(alignment.skipped || []);
  return alignment.eventStartSec.map((_, j) => j).filter((j) => !sk.has(j));
}

// Moves the events `list` (indices, consecutive among the present ones) by `deltaSec`, clamped so that the one before keeps
// NUDGE_MIN_DUR_SEC and the one after too. Returns { ok, applied } (applied: the delta really used, 0 when there is no room).
function shiftEvents(alignment, list, deltaSec) {
  const present = presentSet(alignment);
  const t = alignment.eventStartSec;
  const first = present.indexOf(list[0]);
  const last = present.indexOf(list[list.length - 1]);
  if (first < 0 || last < 0) return { ok: false, reason: 'L’accordo non è nell’audio', applied: 0 };
  const before = first > 0 ? t[present[first - 1]] + NUDGE_MIN_DUR_SEC : 0;
  let after = last + 1 < present.length ? t[present[last + 1]] - NUDGE_MIN_DUR_SEC : Infinity;
  // the chord before a stretch of music that is not in the sheet must keep its length up to the start of that stretch
  const gaps = alignment.gaps || [];
  const gapAfterLast = gaps.find((g) => g.before - 1 === list[list.length - 1]);
  if (gapAfterLast) after = Math.min(after, gapAfterLast.startSec - NUDGE_MIN_DUR_SEC);
  let d = deltaSec;
  if (t[list[0]] + d < before) d = before - t[list[0]];
  if (t[list[list.length - 1]] + d > after) d = after - t[list[list.length - 1]];
  // (a clamp that would reverse the direction of the request means there is no room)
  if (Math.sign(d) !== Math.sign(deltaSec) && d !== 0) d = 0;
  d = Math.round(d * 1000) / 1000;
  if (d === 0) return { ok: false, reason: 'Non c’è spazio per spostare di più', applied: 0 };
  const moved = new Set(list);
  for (const j of list) t[j] = Math.round((t[j] + d) * 1000) / 1000;
  // a stretch of music that is not in the sheet follows the chord after it (it gets shorter or longer) and moves with the one
  // before it; it disappears only when it falls under the minimum length
  if (alignment.gaps) {
    alignment.gaps = alignment.gaps.filter((g) => {
      const a = g.before - 1;
      const b = g.before;
      if (moved.has(b) && moved.has(a)) { g.startSec = r3(g.startSec + d); g.endSec = r3(g.endSec + d); } else if (moved.has(b)) g.endSec = t[b];
      return g.endSec - g.startSec >= GAP_MIN_SEC && g.startSec >= t[a] && g.endSec <= t[b] + 1e-6;
    });
  }
  if (list[list.length - 1] === t.length - 1) alignment.endSec = Math.max(alignment.endSec + d, t[t.length - 1] + 0.2);
  return { ok: true, applied: d };
}

function touch(alignment, song, si) {
  const s = alignment.sections[si];
  s.verified = true; // moved by hand: same weight as "verificata"
  s.confidence = 1;
  const j0 = sectionEventIndices(song)[si][0];
  if (j0 !== undefined && !(alignment.skipped || []).includes(j0)) s.startSec = alignment.eventStartSec[j0];
}

// A manual anchor pins the start of its section: when a nudge moves that start the anchor moves by the same amount (the nudge
// wins; otherwise the anchor would swallow it). `anchors` ({ section index: sec }) is changed in place.
function followAnchor(anchors, alignment, song, si, moved, applied) {
  if (!anchors || si <= 0 || !Number.isFinite(anchors[si])) return;
  const first = (sectionEventIndices(song)[si] || []).find((k) => !(alignment.skipped || []).includes(k));
  if (first === undefined || !moved.includes(first)) return;
  const next = anchors[si] + applied;
  for (const [k, v] of Object.entries(anchors)) {
    const i = Number(k);
    if ((i < si && next <= v + MIN_GAP_SEC) || (i > si && next >= v - MIN_GAP_SEC)) return;
  }
  anchors[si] = r3(next);
}

// Moves chord `j` (index in reading order) by `deltaSec`; with `following` also the chords after it in its section.
export function nudgeEvent(alignment, song, j, deltaSec, { following = false, anchors = null } = {}) {
  const refs = eventRefs(song);
  if (!refs[j]) return { ok: false, reason: 'Accordo inesistente', applied: 0 };
  const si = refs[j].section;
  const idx = sectionEventIndices(song)[si];
  const sk = new Set(alignment.skipped || []);
  const list = (following ? idx.filter((k) => k >= j) : [j]).filter((k) => !sk.has(k));
  if (!list.length) return { ok: false, reason: 'L’accordo non è nell’audio', applied: 0 };
  const r = shiftEvents(alignment, list, deltaSec);
  if (r.ok) { touch(alignment, song, si); followAnchor(anchors, alignment, song, si, list, r.applied); }
  return r;
}

// Moves the whole section `si` by `deltaSec`.
export function nudgeSection(alignment, song, si, deltaSec, { anchors = null } = {}) {
  const sk = new Set(alignment.skipped || []);
  const list = (sectionEventIndices(song)[si] || []).filter((k) => !sk.has(k));
  if (!list.length) return { ok: false, reason: 'La sezione non è nell’audio', applied: 0 };
  // a section with an anchor: the sections around it are stretched to meet the anchors, so a plain move would also move their chords a
  // little; the times are corrected so that only the chords of this section move (round 12)
  const anchored = !!anchors && si > 0 && Number.isFinite(anchors[si]);
  const before = anchored ? effectiveEventTimes(song, alignment, anchors) : null;
  const old = anchored ? alignment.eventStartSec.slice() : null;
  const r = shiftEvents(alignment, list, deltaSec);
  if (r.ok) {
    touch(alignment, song, si);
    followAnchor(anchors, alignment, song, si, list, r.applied);
    if (anchored) keepNeighbours(alignment, song, si, anchors, before, old, list);
  }
  return r;
}

// After the nudge of an anchored section: sets the alignment times of its chords so that the stretched (effective) times of the other
// sections do not change and those of this section move exactly as asked. Gives up (leaving the plain move) if the result would not
// keep the order of the chords.
function keepNeighbours(alignment, song, si, anchors, before, old, list) {
  const shift = alignment.shiftSec || 0;
  const skipped = new Set(alignment.skipped || []);
  const secs = [];
  sectionEventIndices(song).forEach((l, k) => { if (l.length && !l.every((j) => skipped.has(j))) secs.push({ si: k, i0: l[0], i1: l[l.length - 1] }); });
  const k = secs.findIndex((m) => m.si === si);
  if (k <= 0 || k + 1 >= secs.length) return;
  const t = alignment.eventStartSec;
  const prev = secs[k - 1];
  const next = secs[k + 1];
  const aOld = before.starts[list[0]];
  const aNew = Number(anchors[si]);
  if (!Number.isFinite(aNew) || Math.abs(aNew - aOld) < 1e-9) return;
  const oPrev = t[prev.i0] + shift;
  const nPrev = before.starts[prev.i0];
  const oNext = t[next.i0] + shift;
  const nNext = before.starts[next.i0];
  const s0Old = old[list[0]] + shift;
  if (!(s0Old > oPrev) || !(oNext > s0Old)) return;
  const fPrev = (aOld - nPrev) / (s0Old - oPrev);
  if (!(fPrev > 0)) return;
  const s0New = oPrev + (aNew - nPrev) / fPrev;
  const fOld = (nNext - aOld) / (oNext - s0Old);
  const fNew = (nNext - aNew) / (oNext - s0New);
  if (!(fOld > 0) && !(fNew > 0)) return;
  const nt = list.map((j) => r3(s0New + ((old[j] + shift) - s0Old) * (fOld / fNew) - shift));
  const ok = nt.every((v, i) => Number.isFinite(v) && (i === 0 || v > nt[i - 1])) && nt[0] > t[prev.i1] && nt[nt.length - 1] < t[next.i0];
  if (!ok) return;
  list.forEach((j, i) => { t[j] = nt[i]; });
  touch(alignment, song, si);
}
