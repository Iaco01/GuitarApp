// Tab songs -> play timeline (pure, runs in Node). Same shape as the one of buildTimeline (events, beats,
// sections, totalSec) so that the player and the click scheduler work unchanged: one event per measure, one
// timeline section per entry of the arrangement (the order in which the sections of the guide part are played).

import { tabArrangement, tabSectionTitle, TAB_DEFAULT_BPM, TAB_BEATS } from './tab.js';

export const TAB_BPM_MIN = 30;
export const TAB_BPM_MAX = 300;

// Tempo of a section of the guide part: its own, else the one of the song.
export function tabSectionBpm(song, section) {
  const own = section && Number(section.bpm);
  if (own >= TAB_BPM_MIN && own <= TAB_BPM_MAX) return own;
  const all = Number(song.tab.bpm);
  return all >= TAB_BPM_MIN && all <= TAB_BPM_MAX ? all : TAB_DEFAULT_BPM;
}

// Label of a measure for the play panel: the chords written over it, else "Batt. n".
export function tabMeasureLabel(measure, index) {
  if (measure.chords && measure.chords.length) return measure.chords.map((c) => c.name).join(' ');
  return `Batt. ${index + 1}`;
}

export function buildTabTimeline(song, { speed = 1, guide = null } = {}) {
  const sp = speed > 0 ? speed : 1;
  const gi = guide === null ? song.tab.guide : guide;
  const part = song.tab.parts[gi];
  const arr = part ? tabArrangement(song, gi) : [];
  const events = [];
  const beats = [];
  const sections = [];
  let beatCursor = 0;
  let secCursor = 0;
  arr.forEach((secIdx, k) => {
    const sec = part.sections[secIdx];
    const bpm = tabSectionBpm(song, sec);
    const spb = 60 / bpm / sp;
    const startBeat = beatCursor;
    const startSec = secCursor;
    sec.measures.forEach((m, mi) => {
      const n = Math.max(1, Math.round(Number(m.beats) || TAB_BEATS));
      const eventIndex = events.length;
      const rel = beatCursor - startBeat;
      events.push({
        ref: `${k}.${mi}`,
        name: tabMeasureLabel(m, mi),
        mark: '',
        rest: false,
        sectionIndex: k,
        sectionRef: secIdx,
        measureIndex: mi,
        startBeat: beatCursor,
        beats: n,
        startSec: startSec + rel * spb,
        durSec: n * spb,
        bpm,
      });
      for (let b = 0; b < n; b++) {
        beats.push({ index: beatCursor + b, timeSec: startSec + (rel + b) * spb, sectionIndex: k, eventIndex, beatInBar: b, isDownbeat: b === 0 });
      }
      beatCursor += n;
    });
    secCursor = startSec + (beatCursor - startBeat) * spb;
    sections.push({ index: k, sectionRef: secIdx, name: tabSectionTitle(sec, secIdx), startSec, endSec: secCursor, startBeat, endBeat: beatCursor, bpm, savedBpm: bpm, scale: 1, spb, anchored: false });
  });
  return { events, beats, sections, totalBeats: beatCursor, totalSec: secCursor, speed: sp, warnings: [], tab: true };
}

// Column of the measure that is sounding at `progress` (0..1 of the measure): the last one that starts at or
// before it, or -1 before the first one.
export function tabColumnAt(measure, progress) {
  let ans = -1;
  for (let i = 0; i < measure.columns.length; i++) {
    if (measure.columns[i].pos <= progress + 1e-9) ans = i;
    else break;
  }
  return ans;
}

// Chord of the measure at `progress`: the last chord that starts at or before that point; before the first one
// (the measure starts with a few empty columns) the first chord already counts. Null: no chord in the measure.
export function tabChordAt(measure, progress) {
  let ans = measure.chords[0] || null;
  for (const c of measure.chords) {
    const pos = c.x / Math.max(1, measure.len);
    if (pos <= progress + 1e-9) ans = c;
  }
  return ans;
}

// ---- arrangement editing (a list of section indices of the guide part) ----
export function arrangementRepeat(arr, i) {
  if (i < 0 || i >= arr.length) return arr.slice();
  const out = arr.slice();
  out.splice(i + 1, 0, arr[i]);
  return out;
}

export function arrangementRemove(arr, i) {
  if (i < 0 || i >= arr.length) return arr.slice();
  const out = arr.slice();
  out.splice(i, 1);
  return out;
}

export function arrangementMove(arr, i, dir) {
  const j = i + dir;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr.slice();
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function arrangementAdd(arr, sectionIndex) {
  return [...arr, sectionIndex];
}
