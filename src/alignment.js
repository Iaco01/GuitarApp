// The sheet aligned on the audio (pure, runs in Node): what is stored in song.audio.alignment, the
// colour state of every section, the correction of one section from taps, the export of the verified
// sections as ground truth, and the adoption of the measured tempos and durations.

export const ALIGNMENT_VERSION = 1;
// section state from the mean confidence of its events (a free tempo, with no stable beat, counts one step less)
export const CONF_GREEN = 0.8;
export const CONF_YELLOW = 0.65;
const MIN_GAP_SEC = 0.05;

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
    gaps: (result.gaps || []).filter((g) => g.endSec - g.startSec >= 1).map((g) => ({ before: g.before, startSec: r3(g.startSec), endSec: r3(g.endSec) })),
    sections: song.sections.map((_, si) => {
      const s = result.sections[si] || {};
      const i0 = idx[si][0];
      return {
        startSec: i0 === undefined ? null : r3(result.eventStartSec[i0]),
        bpm: Number.isFinite(s.bpm) ? s.bpm : null,
        confidence: r2(Number.isFinite(s.confidence) ? s.confidence : 0),
        verified: false,
      };
    }),
    transposeFound: result.transposeFound || 0,
    tuningCents: Math.round((result.tuningCents || 0) * 10) / 10,
    shiftSec: 0,
    accepted: false,
    createdAt,
  };
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
    gaps: Array.isArray(raw.gaps) ? raw.gaps.filter((g) => g && Number.isInteger(g.before) && g.before >= 1 && g.before < N && Number.isFinite(g.startSec) && Number.isFinite(g.endSec) && g.endSec >= g.startSec && g.startSec >= raw.eventStartSec[g.before - 1] && g.endSec <= raw.eventStartSec[g.before] + 1e-6).map((g) => ({ before: g.before, startSec: g.startSec, endSec: g.endSec })) : [],
    sections: raw.sections.map((s) => ({
      startSec: s && Number.isFinite(s.startSec) ? s.startSec : null,
      bpm: s && Number.isFinite(s.bpm) ? s.bpm : null,
      confidence: s && Number.isFinite(s.confidence) ? Math.min(1, Math.max(0, s.confidence)) : 0,
      verified: !!(s && s.verified),
    })),
    transposeFound: Number.isInteger(raw.transposeFound) ? raw.transposeFound : 0,
    tuningCents: Number.isFinite(raw.tuningCents) ? raw.tuningCents : 0,
    shiftSec: Number.isFinite(raw.shiftSec) ? Math.max(-5, Math.min(5, raw.shiftSec)) : 0,
    accepted: !!raw.accepted,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

// Does the alignment still describe this sheet? (same number of events, same chord names)
export function alignmentFits(alignment, song) {
  if (!alignment || !song || !Array.isArray(song.sections)) return false;
  const refs = eventRefs(song);
  if (refs.length !== alignment.eventStartSec.length || alignment.sections.length !== song.sections.length) return false;
  if (alignment.names) for (let j = 0; j < refs.length; j++) if (alignment.names[j] !== refs[j].name) return false;
  return true;
}

// 'verified' | 'green' | 'yellow' | 'red'
export function sectionState(alignment, si) {
  const s = alignment.sections[si];
  if (!s) return 'red';
  if (s.verified) return 'verified';
  let level = s.confidence >= CONF_GREEN ? 2 : s.confidence >= CONF_YELLOW ? 1 : 0;
  if (s.bpm === null && level > 0) level--; // no stable beat: harder to trust
  return level === 2 ? 'green' : level === 1 ? 'yellow' : 'red';
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
  const gapEndOf = new Map((alignment.gaps || []).map((g) => [g.before - 1, g]));
  const endLast = alignment.endSec + shift;
  const warnings = [];
  const idx = sectionEventIndices(song);
  const secs = [];
  idx.forEach((list, si) => { if (list.length) secs.push({ si, i0: list[0], i1: list[list.length - 1] }); });
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
export function replaceSectionStarts(alignment, song, si, startsSec) {
  const idx = sectionEventIndices(song)[si];
  if (!idx || !idx.length) return { ok: false, reason: 'La sezione non ha accordi' };
  if (startsSec.length !== idx.length) return { ok: false, reason: `Servono ${idx.length} tocchi, ne hai fatti ${startsSec.length}` };
  for (let k = 0; k < startsSec.length; k++) {
    if (!Number.isFinite(startsSec[k]) || startsSec[k] < 0 || (k > 0 && startsSec[k] <= startsSec[k - 1])) return { ok: false, reason: 'I tocchi non sono in ordine' };
  }
  const shift = alignment.shiftSec || 0;
  const first = idx[0];
  const last = idx[idx.length - 1];
  const prevEnd = first > 0 ? alignment.eventStartSec[first - 1] + shift : -Infinity;
  const nextStart = last + 1 < alignment.eventStartSec.length ? alignment.eventStartSec[last + 1] + shift : Infinity;
  if (startsSec[0] <= prevEnd + MIN_GAP_SEC) return { ok: false, reason: 'Il primo tocco cade prima della fine della sezione precedente' };
  if (startsSec[startsSec.length - 1] >= nextStart - MIN_GAP_SEC) return { ok: false, reason: 'L’ultimo tocco cade dopo l’inizio della sezione successiva' };
  idx.forEach((j, k) => {
    alignment.eventStartSec[j] = r3(startsSec[k] - shift);
    alignment.confidence[j] = 1;
    alignment.eventBeats[j] = null;
  });
  const s = alignment.sections[si];
  s.startSec = r3(startsSec[0] - shift);
  s.confidence = 1;
  s.verified = true;
  return { ok: true };
}

// Copy of the alignment with the starts of a section replaced (preview before saving). Same result shape.
export function previewReplace(alignment, song, si, startsSec) {
  const copy = JSON.parse(JSON.stringify(alignment));
  const r = replaceSectionStarts(copy, song, si, startsSec);
  return r.ok ? { ok: true, alignment: copy } : r;
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
// metronome with the real timing). Returns { sections, events } changed.
export function applyMeasuredTiming(song, alignment) {
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
      const b = alignment.eventBeats[j];
      if (!Number.isFinite(b) || b < 1) continue;
      const r = refs[j];
      song.sections[r.section].lines[r.line].chords[r.chord].beats = b;
      events++;
    }
  });
  if (events) song.timingSource = 'edited';
  return { sections, events };
}
