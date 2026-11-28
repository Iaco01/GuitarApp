// Tab songs (pure, runs in Node): text of an Ultimate Guitar tab page (from a PDF or pasted) -> song model.
//
//   song.kind = 'tab', song.tab = { tuning, capo, bpm, guide, arrangement, legend, parts }
//   parts[] -> sections[] -> measures[] -> columns[] -> notes[] { string, fret, tech }
//
// `string` counts from the top row of the tab (0 = the highest string, as written). A measure keeps the text of its
// rows (`rows`, what is drawn), its `columns` (one per character position that has notes: `x`, `pos` = x / length,
// `notes`) and the chord names written above it (`chords`: name, x, column, shape). A measure has `beats` (default 4)
// and the spare `startSec` / `endSec` that the audio sync of round 15 fills.

import { createSong } from './model.js';
import { parseChord } from './chord.js';
import { defaultFingers } from './chords-db.js';
import { parseCapoText } from './capo.js';

export const TAB_BEATS = 4;
export const TAB_DEFAULT_BPM = 100;
const TAB_MAX_FRET = 24;
// A diagram draws 5 frets: a voicing that spans more is not shown from the tab.
const TAB_DIAGRAM_SPAN = 4;

export const TAB_TECHNIQUES = {
  h: 'Hammer-on: suona la nota seguente col dito, senza plettro',
  p: 'Pull-off: stacca il dito e suona la nota seguente',
  b: 'Bend: tira la corda verso l’alto',
  r: 'Rilascio del bend',
  '/': 'Slide verso l’alto',
  '\\': 'Slide verso il basso',
  '~': 'Vibrato',
  '^': 'Bend (curvatura)',
  s: 'Slide',
  x: 'Nota muta (smorzata)',
};
const TAB_TECH_CHARS = 'hprb/\\~^sx';

// ---- lines ----
const squash = (l) => l.replace(/\s+/g, '').toLowerCase();

// Page furniture of the Ultimate Guitar page that ends up in the middle of the tab.
const NOISE_PARTS = ['savingtab', 'continueintheapp', 'autoscroll', 'reportbadtab', 'availableintheapp', 'getthefullexperience', 'openinapp', 'downloadtheapp', 'ultimateguitar.com', 'https://', 'http://', 'cookie'];
const NOISE_EXACT = new Set(['listen', 'pdf', 'print', 'send', 'show all', 'saveinthe app', '+', 'edit', 'share', 'menu', 'favorites', 'save']);
const STOP_RE = /^(versions|relatedtabs|(\d+)?comments|commentsend|showall\(\d+\)|reportbadtab|print)$/;

export function isTabNoise(line) {
  const s = squash(line);
  if (!s) return false;
  if (NOISE_EXACT.has(line.trim().toLowerCase()) || NOISE_EXACT.has(s)) return true;
  if (/^page\d+(of|\/)\d+$/.test(s) || /^\d+\/\d+$/.test(s)) return true;
  if (/^[★☆\d./()\s]+$/.test(line) && /[★☆]/.test(line)) return true;
  return NOISE_PARTS.some((p) => s.includes(p));
}

const TAB_ROW_CHARS = /^[-0-9|:hpbrxsvVSt/\\~^()*<>=.\s]+$/;

// Labelled row: "e|--5--|" (the string name, the bar, the content).
export function parseLabelledRow(line) {
  const m = /^(\s*)([A-Ga-g][#b]?)\s?([|:])(.*)$/.exec(line);
  if (!m) return null;
  const body = m[3] + m[4];
  if (!TAB_ROW_CHARS.test(body) || (body.match(/-/g) || []).length < 3) return null;
  return { label: m[2], base: m[1].length + m[2].length + (m[0].charAt(m[1].length + m[2].length) === ' ' ? 1 : 0), body };
}

// Row of a continuation (no label): only tab characters, with a run of dashes.
export function isContinuationRow(line) {
  const t = line.trim();
  if (t.length < 4 || !TAB_ROW_CHARS.test(t)) return false;
  return /-{2,}/.test(t) || (/\|/.test(t) && /-/.test(t));
}

const ANNOT_RE = /^[(\[]?(x\d+|\d+x)[)\]]?$|^[|%.\-–—>~*()/]+$|^(N\.?C\.?|riff|tacet)$/i;

// A line made only of chord names (and repeat marks): [{ name, col }], else null.
export function parseChordLine(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  let others = 0;
  while ((m = re.exec(line))) {
    const tok = m[0].replace(/^\(+|\)+$/g, '');
    if (tok && parseChord(tok)) out.push({ name: tok, col: m.index + (m[0].length - m[0].replace(/^\(+/, '').length) });
    else if (ANNOT_RE.test(m[0])) others++;
    else return null;
  }
  return out.length ? out : (others ? null : null);
}

const SECTION_WORDS = /^(intro|verse|chorus|pre-?chorus|bridge|solo|outro|interlude|riff|refrain|break|instrumental|ritornello|strofa|ponte|coda|hook|main|lick)\b/i;

export function parseSectionHeader(line) {
  const t = line.trim();
  let m = /^\[([^\]]{1,60})\]\s*:?$/.exec(t);
  if (!m) {
    if (t.length <= 28 && SECTION_WORDS.test(t) && !/\|/.test(t)) m = [t, t.replace(/:$/, '')];
    else return null;
  }
  const inner = m[1].trim();
  if (/^(guitar|gtr)\.?\s*\d*$/i.test(inner)) return null;
  const names = inner.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  return names.length ? { names, label: names.join(' / ') } : null;
}

const PART_RE = /^(guitar|gtr\.?|chitarra|lead|rhythm|ritmica|bass|basso|acoustic|electric|riff|solo|keys?|piano)\b[^|]*$/i;

export function parsePartHeader(line) {
  const t = line.trim();
  let m = /^[-=_*~#\s]*\|\s*([^|]+?)\s*\|[-=_*~#\s]*$/.exec(t);
  if (m && /[-=]{2,}/.test(t) && PART_RE.test(m[1])) return partInfo(m[1]);
  m = /^[-=_*~#]{3,}\s*([^-=_*~#|][^|]*?)\s*[-=_*~#]{3,}$/.exec(t);
  if (m && PART_RE.test(m[1])) return partInfo(m[1]);
  m = /^\[?((?:guitar|gtr\.?|chitarra)\s*\d+)\]?\s*:?$/i.exec(t);
  if (m) return partInfo(m[1]);
  m = /^(lead|rhythm|ritmica)\s*(guitar|gtr\.?)?\s*\d*\s*:$/i.exec(t);
  if (m) return partInfo(t.replace(/:$/, ''));
  return null;
}

function partInfo(name) {
  const n = name.trim().replace(/\s+/g, ' ');
  const num = /(\d+)\s*$/.exec(n);
  let label = n;
  if (/^(guitar|gtr\.?|chitarra)\b/i.test(n)) label = 'Chitarra' + (num ? ' ' + num[1] : '');
  else if (/^rhythm/i.test(n)) label = 'Ritmica' + (num ? ' ' + num[1] : '');
  else if (/^lead/i.test(n)) label = 'Solista' + (num ? ' ' + num[1] : '');
  else if (/^bass/i.test(n)) label = 'Basso';
  return { name: n, label };
}

// ---- tuning and capo ----
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = (s) => {
  const base = NOTE_PC[s[0].toUpperCase()];
  if (base === undefined) return null;
  return (base + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12;
};

export const TAB_STANDARD_MIDI = [40, 45, 50, 55, 59, 64];
const TAB_NAMED_TUNINGS = [
  [/drop\s*d/i, [38, 45, 50, 55, 59, 64], 'Drop D'],
  [/dadgad/i, [38, 45, 50, 55, 57, 62], 'DADGAD'],
  [/open\s*g/i, [38, 43, 50, 55, 59, 62], 'Open G'],
  [/open\s*d\b/i, [38, 45, 50, 54, 57, 62], 'Open D'],
  [/open\s*e/i, [40, 47, 52, 56, 59, 64], 'Open E'],
  [/(half\s*step|1\/2\s*step|semitone)\s*down|\be\s?flat|\beb\s*standard/i, TAB_STANDARD_MIDI.map((m) => m - 1), 'Mezzo tono sotto'],
  [/(full|whole)\s*step\s*down|\bd\s*standard/i, TAB_STANDARD_MIDI.map((m) => m - 2), 'Un tono sotto'],
  [/standard/i, TAB_STANDARD_MIDI, 'Standard'],
];

// Ascending open-string pitches from the note names ("E A D G B E").
export function tabTuningFromNotes(names) {
  const midi = [];
  for (const n of names) {
    const pc = pcOf(n);
    if (pc === null) return null;
    let m;
    if (!midi.length) {
      m = 36 + pc;
      if (m > 47) m -= 12;
    } else {
      m = midi[midi.length - 1] + 1;
      while (((m % 12) + 12) % 12 !== pc) m++;
    }
    midi.push(m);
  }
  return midi;
}

export function parseTuningText(text) {
  const t = String(text || '');
  const spaced = /tuning[^\n(]{0,16}?((?:[A-G][#b]?\s+){5}[A-G][#b]?)(?![A-Za-z])/i.exec(t);
  const paren = /tuning[^()\n]{0,30}\(\s*([A-Ga-g][#b]?(?:\s*[A-Ga-g][#b]?){3,7})\s*\)/i.exec(t);
  const src = (paren && paren[1]) || (spaced && spaced[1]) || null;
  let notes = null;
  if (src) notes = (src.match(/[A-Ga-g][#b]?/g) || []).map((s) => s[0].toUpperCase() + s.slice(1));
  const hasWord = /tuning|accordatura/i.test(t);
  const named = TAB_NAMED_TUNINGS.find(([re]) => re.test(t) && (hasWord || !/standard/.test(re.source)));
  if (notes && notes.length >= 4 && notes.length <= 8) {
    const midi = tabTuningFromNotes(notes);
    if (midi) {
      const same = TAB_NAMED_TUNINGS.find(([, m]) => m.join() === midi.join());
      return { name: same ? same[2] : notes.join(' '), notes, midi };
    }
  }
  if (named) return { name: named[2], notes: null, midi: named[1].slice() };
  return null;
}

// ---- notes of a measure ----
function parseMeasureRow(text, string, columns) {
  let i = 0;
  let pendingPre = '';
  let last = null;
  while (i < text.length) {
    const c = text[i];
    if (c >= '0' && c <= '9') {
      let v = c;
      if (text[i + 1] >= '0' && text[i + 1] <= '9' && parseInt(c + text[i + 1], 10) <= TAB_MAX_FRET && c !== '0') v = c + text[i + 1];
      const note = { string, fret: parseInt(v, 10), tech: pendingPre };
      if (pendingPre) note.pre = true; // the technique was written before the number ("/9": a slide into the 9)
      pendingPre = '';
      addNote(columns, i, note);
      last = note;
      i += v.length;
    } else if (TAB_TECH_CHARS.includes(c)) {
      if (c === 'x' && !(last && last.end === i)) {
        // a muted note
        const note = { string, fret: null, tech: 'x' };
        addNote(columns, i, note);
        last = null;
      } else if (last && (last.tech === '' || last.tech === undefined) && c !== 'x') {
        last.tech = c;
        pendingPre = '';
      } else if (!last || last.string !== string) {
        pendingPre = c;
      }
      i++;
    } else {
      if (c === '-' ) last = null;
      i++;
    }
  }
}

function addNote(columns, x, note) {
  let col = columns.find((k) => k.x === x);
  if (!col) {
    col = { x, pos: 0, notes: [] };
    columns.push(col);
  }
  col.notes.push(note);
}

// ---- voicings from the tab ----
const lowEIndex = (row, n) => n - 1 - row;

// Shape (as in chords-db: frets from the low E string) of the notes of the columns from `colIndex` on, up to the
// next chord of the measure. The stack at the chord column is the voicing; with fewer than 3 strings the following
// columns add the strings still missing. Null when the notes do not make a drawable shape.
export function voicingFromColumns(columns, colIndex, untilX, rowCount) {
  if (rowCount !== 6 || colIndex < 0) return null;
  const frets = new Array(6).fill('x');
  const seen = new Set();
  let strings = 0;
  for (let k = colIndex; k < columns.length; k++) {
    const col = columns[k];
    if (k > colIndex && (col.x >= untilX || strings >= 3)) break;
    for (const nt of col.notes) {
      if (seen.has(nt.string) || nt.fret === null) continue;
      seen.add(nt.string);
      frets[lowEIndex(nt.string, rowCount)] = nt.fret;
      strings++;
    }
  }
  return shapeFromFrets(frets);
}

export function shapeFromFrets(frets) {
  const played = frets.filter((f) => f !== 'x');
  if (played.length < 2) return null;
  const pos = played.filter((f) => f > 0);
  let baseFret = 1;
  if (pos.length) {
    const low = Math.min(...pos);
    const high = Math.max(...pos);
    if (high - low > TAB_DIAGRAM_SPAN) return null;
    if (played.includes(0)) {
      if (high > 5) return null;
    } else if (!(high <= 5 && low === 1)) baseFret = low;
  }
  const shape = { frets: frets.slice(), baseFret, fromTab: true };
  if (pos.length) {
    const f = Math.min(...pos);
    const idx = frets.map((x, i) => (x === f ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) {
      const from = idx[0];
      const to = idx[idx.length - 1];
      const between = frets.slice(from, to + 1);
      if (between.every((x) => x !== 'x' && x >= f)) shape.barres = [{ fret: f, from, to }];
    }
  }
  const fingers = defaultFingers(shape);
  if (fingers) shape.fingers = fingers;
  return shape;
}

// Pitch classes (0-11) sounded by a measure: from the frets, the tuning and the capo (the frets of a tab are written
// relative to the capo; prepared for the audio sync of round 15).
export function tabNoteProfile(measure, tuningMidi, rowCount = 6, capo = 0) {
  const tun = tabRowTuning(tuningMidi, rowCount);
  const pcs = new Array(12).fill(0);
  for (const col of measure.columns) {
    for (const n of col.notes) {
      if (n.fret === null || tun[n.string] === undefined) continue;
      pcs[(tun[n.string] + capo + n.fret) % 12]++;
    }
  }
  return pcs;
}

// Open-string pitch of each row of the tab, from the top row.
export function tabRowTuning(tuningMidi, rowCount) {
  const std = tuningMidi && tuningMidi.length === 6 ? tuningMidi : TAB_STANDARD_MIDI;
  let low;
  if (rowCount === 6) low = std;
  else if (rowCount === 7) low = [std[0] - 5, ...std];
  else if (rowCount === 5) low = std.slice(1);
  else if (rowCount === 4) low = [28, 33, 38, 43];
  else low = std.slice(-rowCount);
  return low.slice().reverse();
}

// ---- systems ----
// A system is a block of rows (one per string) with its wrapped continuations.
function newSystem(part, section, label, base) {
  return { part, section, labels: [label], bases: [base], chunks: [{ rows: [], chord: null, base: 0 }], open: true, n: 0 };
}

function segmentSystem(sys) {
  const n = sys.n;
  // join the chunks row by row
  const rows = new Array(n).fill('');
  const chordMarks = [];
  let offset = 0;
  sys.chunks.forEach((ch) => {
    const width = Math.max(...ch.rows.map((r) => r.length), 0);
    ch.rows.forEach((r, i) => { rows[i] += r + '-'.repeat(width - r.length); });
    if (ch.chord) for (const c of ch.chord) chordMarks.push({ name: c.name, p: offset + c.col - ch.base });
    offset += width;
  });
  // bars: columns where (almost) every row has one
  const len = Math.max(...rows.map((r) => r.length));
  const need = Math.max(1, n <= 3 ? n : n - 1);
  const isBar = new Array(len).fill(false);
  for (let x = 0; x < len; x++) {
    let cnt = 0;
    for (const r of rows) if (r[x] === '|') cnt++;
    isBar[x] = cnt >= need;
  }
  const segs = [];
  let start = 0;
  for (let x = 0; x <= len; x++) {
    if (x === len || isBar[x]) {
      if (x > start) segs.push({ from: start, to: x });
      start = x + 1;
    }
  }
  const measures = [];
  for (const sg of segs) {
    const mrows = rows.map((r) => r.slice(sg.from, sg.to).replace(/[|]/g, '-'));
    const columns = [];
    mrows.forEach((r, i) => parseMeasureRow(r, i, columns));
    const L = Math.max(...mrows.map((r) => r.length));
    // an empty tail after the last bar (only dashes) is not a measure
    if (!columns.length && (L < 3 || (sg === segs[segs.length - 1] && sg.to === len))) continue;
    columns.sort((a, b) => a.x - b.x);
    for (const col of columns) {
      col.pos = Math.round((col.x / L) * 1000) / 1000;
      col.notes.sort((a, b) => a.string - b.string);
    }
    measures.push({ from: sg.from, to: sg.to, rows: mrows, len: L, beats: TAB_BEATS, columns, chords: [], startSec: null, endSec: null });
  }
  // chord names: onto the measure that holds their column
  for (const mk of chordMarks) {
    let p = Math.max(0, mk.p);
    let m = measures.find((q) => p >= q.from && p < q.to);
    if (!m) m = measures.find((q) => q.from >= p) || measures[measures.length - 1];
    if (!m) continue;
    p = Math.min(Math.max(p, m.from), m.to);
    m.chords.push({ name: mk.name, x: p - m.from, col: -1, shape: null });
  }
  for (const m of measures) {
    m.chords.sort((a, b) => a.x - b.x);
    m.chords.forEach((c, i) => {
      // column of the chord: the one at its position, else the first after it (up to 1 before), else the last
      let k = m.columns.findIndex((col) => col.x === c.x);
      if (k < 0) k = m.columns.findIndex((col) => col.x > c.x);
      if (k < 0 && m.columns.length) k = m.columns.length - 1;
      c.col = k;
      const next = m.chords[i + 1];
      c.shape = voicingFromColumns(m.columns, k, next ? next.x : Infinity, n);
    });
    delete m.from;
    delete m.to;
  }
  return measures;
}

// ---- main parser ----
function titleFromPdf(title) {
  const t = String(title || '').trim();
  const m = /^(.*?)\s+(?:TAB|CHORDS|BASS TAB|UKULELE|PRO TAB|OFFICIAL)\b.*?\s+by\s+(.*?)\s*(?:@.*)?$/i.exec(t) || /^(.*?)\s+by\s+(.*?)\s*(?:@.*)?$/i.exec(t);
  if (!m) return { title: t.replace(/\s*@.*$/, ''), artist: '' };
  return { title: m[1], artist: m[2] };
}

function nice(s) {
  const t = String(s).trim();
  if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) return t.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return t;
}

// text: lines of the page (one string); opts: { title, artist, fileName, pdfTitle }
export function parseTabText(text, opts = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\t/g, '    ').replace(/\s+$/, ''));
  const warnings = [];
  const parts = [];
  let curPart = null;
  let curSection = null;
  let sys = null;
  let last = null;
  let chunkRows = null;
  let pendingChord = null;
  const systems = [];
  let seenTab = false;
  let headerText = '';
  let starred = false;
  const legend = new Set();

  const ensurePart = () => {
    if (!curPart) {
      curPart = { id: 'p' + (parts.length + 1), name: 'Guitar', label: 'Chitarra', sections: [] };
      parts.push(curPart);
    }
    return curPart;
  };
  const ensureSection = () => {
    const p = ensurePart();
    if (!curSection) {
      curSection = { names: [], label: '', bpm: null, measures: [] };
      p.sections.push(curSection);
    }
    return curSection;
  };
  let knownN = 0;
  const closeSystem = () => {
    if (sys && sys.open) {
      sys.n = sys.chunks[0].rows.length;
      sys.open = false;
      knownN = sys.n;
    }
  };

  for (const raw of lines) {
    const line = raw;
    if (!line.trim()) continue;
    if (seenTab && STOP_RE.test(squash(line))) break;
    if (isTabNoise(line)) continue;
    if (/^\s*\*{8,}\s*$/.test(line)) { starred = !starred; closeSystem(); sys = null; chunkRows = null; continue; }
    if (starred) {
      for (const m of line.matchAll(/(?:^|[\s|])([hpbr/\\~^])\s*(?:=|-|:)?\s+[A-Za-z]/g)) legend.add(m[1]);
      continue;
    }
    const lab = parseLabelledRow(line);
    if (lab) {
      seenTab = true;
      let startNew = !sys || !sys.open;
      if (sys && sys.open) {
        const rows = sys.chunks[0].rows.length;
        // a new system starts when the rows of the previous one are all there (or, the first time, when the labels start over)
        if (knownN ? rows >= knownN : rows >= 7 || (rows >= 4 && lab.label === sys.labels[0] && !(rows === 5 && sys.labels[0] === 'E'))) startNew = true;
      }
      if (startNew) {
        closeSystem();
        const sec = ensureSection();
        sys = newSystem(curPart, sec, lab.label, lab.base);
        sys.chunks[0].base = lab.base;
        sys.chunks[0].chord = pendingChord;
        pendingChord = null;
        systems.push(sys);
        last = sys;
      } else {
        sys.labels.push(lab.label);
      }
      sys.chunks[0].rows.push(lab.body);
      chunkRows = null;
      continue;
    }
    if (last && isContinuationRow(line)) {
      seenTab = true;
      closeSystem();
      if (!chunkRows || chunkRows.rows.length >= last.n) {
        chunkRows = { rows: [], chord: pendingChord, base: 0 };
        pendingChord = null;
        last.chunks.push(chunkRows);
      }
      chunkRows.rows.push(line);
      continue;
    }
    // anything else ends the current block
    closeSystem();
    sys = null;
    chunkRows = null;
    const part = parsePartHeader(line);
    if (part) {
      last = null;
      curPart = { id: 'p' + (parts.length + 1), name: part.name, label: part.label, sections: [] };
      parts.push(curPart);
      curSection = null;
      pendingChord = null;
      continue;
    }
    const sec = parseSectionHeader(line);
    if (sec && (seenTab || /\[/.test(line))) {
      last = null;
      const p = ensurePart();
      curSection = { names: sec.names, label: sec.label, bpm: null, measures: [] };
      p.sections.push(curSection);
      pendingChord = null;
      continue;
    }
    const chords = parseChordLine(line);
    if (chords) {
      pendingChord = chords;
      continue;
    }
    pendingChord = null;
    if (!seenTab) headerText += line + '\n';
  }
  closeSystem();

  for (const s of systems) {
    if (!s.chunks[0].rows.length) continue;
    // a continuation chunk with fewer rows than the system is incomplete: dropped
    s.chunks = s.chunks.filter((c, i) => i === 0 || c.rows.length === s.n);
    for (const c of s.chunks.slice(1)) {
      const lead = Math.min(...c.rows.map((r) => /^\s*/.exec(r)[0].length));
      c.base = lead;
      c.rows = c.rows.map((r) => r.slice(lead));
    }
    if (!s.n) s.n = s.chunks[0].rows.length;
    const ms = segmentSystem(s);
    s.section.measures.push(...ms.map((m) => ({ ...m, rowCount: s.n })));
  }
  // empty sections and parts go away
  for (const p of parts) p.sections = p.sections.filter((s) => s.measures.length);
  const realParts = parts.filter((p) => p.sections.length);
  realParts.forEach((p, i) => { p.id = 'p' + (i + 1); });

  const tuning = parseTuningText(headerText + ' ' + (opts.tuningText || '')) || { name: 'Standard', notes: null, midi: TAB_STANDARD_MIDI.slice() };
  const capo = parseCapoText(headerText);
  const fromPdf = titleFromPdf(opts.pdfTitle);
  const title = opts.title || nice(fromPdf.title) || '';
  const artist = opts.artist || nice(fromPdf.artist) || '';
  const chordNames = [];
  for (const p of realParts) for (const s of p.sections) for (const m of s.measures) for (const c of m.chords) if (!chordNames.includes(c.name)) chordNames.push(c.name);
  const arrangement = {};
  realParts.forEach((p, i) => { arrangement[i] = p.sections.map((_, k) => k); });
  const measureTotal = realParts.reduce((n, p) => n + p.sections.reduce((a, s) => a + s.measures.length, 0), 0);
  if (!measureTotal) warnings.push('Nessuna tablatura riconosciuta nel testo');
  const song = createSong({
    kind: 'tab',
    title: title || 'Tab senza titolo',
    artist,
    capo,
    tuning: tuning.name,
    chords: chordNames,
    bpm: null,
    tab: {
      tuning,
      capo,
      bpm: TAB_DEFAULT_BPM,
      guide: 0,
      arrangement,
      legend: [...legend],
      parts: realParts,
    },
    importInfo: { method: opts.method || 'tab-text', warnings },
  });
  if (opts.fileName) song.source.fileName = opts.fileName;
  return song;
}

// ---- queries on a tab song ----
export function isTabSong(song) {
  return !!song && song.kind === 'tab' && !!song.tab && Array.isArray(song.tab.parts);
}

export function tabMeasureCount(song) {
  return song.tab.parts.reduce((n, p) => n + p.sections.reduce((a, s) => a + s.measures.length, 0), 0);
}

// Techniques that the tab really uses (for the legend), in a stable order.
export function tabTechniquesUsed(song) {
  const used = new Set();
  for (const p of song.tab.parts) for (const s of p.sections) for (const m of s.measures) for (const c of m.columns) for (const n of c.notes) if (n.tech && TAB_TECHNIQUES[n.tech]) used.add(n.tech);
  for (const k of song.tab.legend || []) if (TAB_TECHNIQUES[k]) used.add(k);
  return Object.keys(TAB_TECHNIQUES).filter((k) => used.has(k));
}

// The chords of the tab with the shape written in it: one entry per (name, frets), in order of first appearance.
// `partIndex` null = all the parts. [{ name, shape, key }]; shape null when the voicing could not be read.
export function tabChordVoices(song, partIndex = null) {
  const out = [];
  const seen = new Set();
  song.tab.parts.forEach((p, pi) => {
    if (partIndex !== null && pi !== partIndex) return;
    for (const s of p.sections) {
      for (const m of s.measures) {
        for (const c of m.chords) {
          const key = c.name + '|' + (c.shape ? c.shape.frets.join('.') : '');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ name: c.name, shape: c.shape, key });
        }
      }
    }
  });
  return out;
}

export function tabPartHasChords(part) {
  return part.sections.some((s) => s.measures.some((m) => m.chords.length));
}

// Arrangement of a part: the list of its section indices in play order.
export function tabArrangement(song, partIndex) {
  const part = song.tab.parts[partIndex];
  if (!part) return [];
  const raw = song.tab.arrangement && song.tab.arrangement[partIndex];
  const valid = Array.isArray(raw) ? raw.filter((k) => Number.isInteger(k) && k >= 0 && k < part.sections.length) : [];
  return valid.length || (Array.isArray(raw) && raw.length === 0) ? valid : part.sections.map((_, k) => k);
}

export function tabDefaultArrangement(song, partIndex) {
  const part = song.tab.parts[partIndex];
  return part ? part.sections.map((_, k) => k) : [];
}

export function tabSectionTitle(section, index) {
  return section.label || `Sezione ${index + 1}`;
}

// Fills in what a stored tab song may lack (older or edited objects).
export function normalizeTab(song) {
  const t = song.tab;
  if (!t || !Array.isArray(t.parts)) {
    song.tab = { tuning: { name: 'Standard', notes: null, midi: TAB_STANDARD_MIDI.slice() }, capo: 0, bpm: TAB_DEFAULT_BPM, guide: 0, arrangement: {}, legend: [], parts: [] };
    return song;
  }
  if (!t.tuning || !Array.isArray(t.tuning.midi)) t.tuning = { name: 'Standard', notes: null, midi: TAB_STANDARD_MIDI.slice() };
  if (!(t.bpm > 0)) t.bpm = TAB_DEFAULT_BPM;
  if (!Number.isInteger(t.guide) || t.guide < 0 || t.guide >= t.parts.length) t.guide = 0;
  if (!t.arrangement || typeof t.arrangement !== 'object') t.arrangement = {};
  if (!Array.isArray(t.legend)) t.legend = [];
  t.parts.forEach((p, i) => {
    if (!Array.isArray(t.arrangement[i])) t.arrangement[i] = p.sections.map((_, k) => k);
    for (const s of p.sections) {
      if (s.bpm === undefined) s.bpm = null;
      for (const m of s.measures) {
        if (!Number.isInteger(m.beats) || m.beats < 1) m.beats = TAB_BEATS;
        if (m.startSec === undefined) m.startSec = null;
        if (m.endSec === undefined) m.endSec = null;
      }
    }
  });
  return song;
}
