// Chord durations estimated from where each chord sits over the sung text (pure, runs in Node).
// The file only tells us on which syllable a chord falls: the number of syllables between two chords
// is taken as a proxy for how long the first one lasts.

const VOWELS = 'aeiouyàèéìòùáíóúâêîôû';
const isVowel = (ch) => VOWELS.includes(ch);

// Rough syllable count for English and Italian words (>= 1 for any word with letters, 0 otherwise).
// Vowel groups, minus a silent final "e" (not after "l": "little").
export function countSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-zàèéìòùáíóúâêîôû]/g, '');
  if (!w) return 0;
  let n = 0;
  let prev = false;
  for (const ch of w) {
    const v = isVowel(ch);
    if (v && !prev) n++;
    prev = v;
  }
  if (n > 1 && w.endsWith('e') && !isVowel(w[w.length - 2]) && !w.endsWith('le')) n--;
  return Math.max(1, n);
}

// Column interval [start, end) of every syllable of a lyric line. A word is split evenly.
export function syllableMap(lyric) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(String(lyric || ''))) !== null) {
    const n = countSyllables(m[0]);
    if (n === 0) continue;
    const len = m[0].length;
    for (let k = 0; k < n; k++) {
      out.push({ start: m.index + Math.floor((k * len) / n), end: m.index + Math.floor(((k + 1) * len) / n) });
    }
  }
  return out;
}

// Index of the syllable a chord at column `col` falls on: the one covering it, else the next one
// (chord over a space), else the end of the line (= syllables.length).
function syllableIndexAt(map, col) {
  for (let i = 0; i < map.length; i++) {
    if (col < map[i].end) return i;
  }
  return map.length;
}

const CLOSE_COLS = 4; // instrumental chords this close on a line last half a bar
const FAST_SPAN = 3; // 3+ chords within this many syllables: fine grid

// Position of every chord of the section in the continuous flow of syllables.
// Returns { items: [{ ref index, pos, fast? }], end } for non-rest chords only, in order.
function flowOfSection(section) {
  const lines = section.lines;
  const lyricSyl = lines.map((l) => syllableMap(l.lyric));
  let nChords = 0;
  let lyricChords = 0;
  lines.forEach((l, li) => {
    for (const c of l.chords) {
      if (c.rest) continue;
      nChords++;
      if (lyricSyl[li].length) {
        lyricChords++;
      }
    }
  });
  if (nChords === 0) return { items: [], end: 0 };
  // an instrumental chord is worth as many syllables as a lyric one lasts on average
  const lyricTotal = lyricSyl.reduce((a, m) => a + m.length, 0);
  const unit = lyricChords > 0 ? Math.max(1, lyricTotal / lyricChords) : 1;
  const items = [];
  let cur = 0;
  lines.forEach((l, li) => {
    const map = lyricSyl[li];
    const real = l.chords.filter((c) => !c.rest);
    if (map.length) {
      for (const c of real) items.push({ line: li, chord: l.chords.indexOf(c), pos: cur + syllableIndexAt(map, c.col) });
      cur += map.length;
    } else {
      real.forEach((c, k) => {
        items.push({ line: li, chord: l.chords.indexOf(c), pos: cur });
        const next = real[k + 1];
        cur += next && next.col - c.col <= CLOSE_COLS ? unit / 2 : unit;
      });
    }
  });
  return { items, end: cur };
}

function snap(v, grid) {
  return Math.round(v / grid + 1e-9) * grid;
}

// Beats of every non-rest chord of the section (in order), estimated from the syllable positions.
// One factor r (beats per syllable) makes the mean duration `avg`; the cumulative positions are
// rounded to the grid (not the single durations) and the section ends on a bar line.
function estimateFlow(flow, { perBar, grid, minBeats, avg }) {
  const items = flow.items;
  const n = items.length;
  if (n === 0) return [];
  // the syllables sung before the first chord are a pick-up (levare): they do not count; the first chord
  // starts on the downbeat of the section
  const p0 = items[0].pos;
  const pos = items.map((it) => it.pos - p0);
  const total = Math.max(flow.end - p0, pos[n - 1] + 1e-6, 1e-6);
  const r = (avg * n) / total;
  // 3+ chords within FAST_SPAN syllables: quick changes, fine grid
  const fast = pos.map(() => false);
  for (let k = 0; k + 2 < n; k++) {
    if (pos[k + 2] - pos[k] <= FAST_SPAN) fast[k] = fast[k + 1] = fast[k + 2] = true;
  }
  const bounds = [0];
  for (let k = 1; k < n; k++) {
    const g = fast[k - 1] && fast[k] ? 1 : grid;
    const min = k === 1 ? Math.max(2, minBeats) : fast[k - 1] ? 1 : minBeats; // first chord: at least 2 beats
    bounds.push(Math.max(bounds[k - 1] + min, snap(pos[k] * r, g)));
  }
  const lastMin = n === 1 ? Math.max(2, minBeats) : fast[n - 1] ? 1 : minBeats;
  let end = Math.round((avg * n) / perBar) * perBar;
  if (end < bounds[n - 1] + lastMin) end = Math.ceil((bounds[n - 1] + lastMin) / perBar) * perBar;
  bounds.push(end);
  return bounds.slice(1).map((b, k) => b - bounds[k]);
}

// Estimated beats of every chord of a section, in reading order (rest chords keep their beats).
export function estimateSectionDurations(section, { timeSignature = [4, 4], grid = 2, minBeats = 2, beatsPerChordAvg = 4 } = {}) {
  const perBar = Math.max(1, (timeSignature && timeSignature[0]) || 4);
  const flow = flowOfSection(section);
  const beats = estimateFlow(flow, { perBar, grid, minBeats, avg: beatsPerChordAvg });
  const out = [];
  let k = 0;
  const byKey = new Map(flow.items.map((it, i) => [it.line + '.' + it.chord, i]));
  section.lines.forEach((l, li) => {
    l.chords.forEach((c, ci) => {
      if (c.rest) out.push(c.beats);
      else out.push(beats[byKey.get(li + '.' + ci)] ?? beats[k]);
      k++;
    });
  });
  return out;
}

// New song with the estimated durations; the original is not touched.
export function estimateSongDurations(song, opts = {}) {
  const o = { timeSignature: song.timeSignature, ...opts };
  const copy = JSON.parse(JSON.stringify(song));
  copy.sections.forEach((sec, si) => {
    const beats = estimateSectionDurations(song.sections[si], o);
    let k = 0;
    for (const l of sec.lines) for (const c of l.chords) c.beats = beats[k++];
  });
  copy.timingSource = 'estimated';
  return copy;
}
