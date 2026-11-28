// Reflow of tab measures to a width in characters (pure, runs in Node).
//
// A line holds the string labels ("e|") and as many whole measures as fit; a measure longer than the line is cut into
// pieces, one per line, and every line repeats the labels. Chord names stay over their column.

export const TAB_LABEL_WIDTH = 2;
const TAB_MIN_WIDTH = 10;

// Letters of the rows from the top: from the tuning notes (low to high) when they are known, else the standard ones.
export function tabRowLabels(rowCount, tuningNotes) {
  if (Array.isArray(tuningNotes) && tuningNotes.length === rowCount) {
    return tuningNotes.slice().reverse().map((n, i) => (i === 0 && n === 'E' ? 'e' : n));
  }
  if (rowCount === 6) return ['e', 'B', 'G', 'D', 'A', 'E'];
  if (rowCount === 4) return ['G', 'D', 'A', 'E'];
  if (rowCount === 5) return ['e', 'B', 'G', 'D', 'A'];
  if (rowCount === 7) return ['e', 'B', 'G', 'D', 'A', 'E', 'B'];
  return Array.from({ length: rowCount }, () => '-');
}

// measures: [{ rows: [string], len, chords: [{ name, x }] }]. width: characters of the line (labels included).
// Returns [{ width, segs: [{ m, from, to, x0, last }], rows: [string], chords: [{ name, x, m, index }] }] where `x` is the
// column of the line and `index` the position of the chord in its measure.
export function layoutTabMeasures(measures, width, { labels = null } = {}) {
  const W = Math.max(TAB_MIN_WIDTH, Math.floor(width));
  const lines = [];
  let line = null;
  const start = () => {
    line = { width: TAB_LABEL_WIDTH, segs: [], rows: [], chords: [] };
    lines.push(line);
  };
  measures.forEach((meas, m) => {
    const len = Math.max(1, meas.len);
    let from = 0;
    while (from < len) {
      if (!line) start();
      const room = W - line.width;
      const remaining = len - from;
      if (remaining + 1 <= room) {
        line.segs.push({ m, from, to: len, x0: line.width, last: true });
        line.width += remaining + 1;
        break;
      }
      if (line.segs.length) { line = null; continue; }
      const to = from + (W - TAB_LABEL_WIDTH - 1);
      line.segs.push({ m, from, to, x0: line.width, last: false });
      line.width += to - from;
      from = to;
      line = null;
    }
  });
  for (const ln of lines) {
    const n = measures[ln.segs[0].m].rows.length;
    const lab = labels || tabRowLabels(n, null);
    ln.rows = Array.from({ length: n }, (_, r) => {
      let t = (lab[r] || '-') + '|';
      for (const sg of ln.segs) {
        const row = measures[sg.m].rows[r] || '';
        t += row.slice(sg.from, sg.to).padEnd(sg.to - sg.from, '-') + (sg.last ? '|' : '');
      }
      return t;
    });
    let prevEnd = -1;
    for (const sg of ln.segs) {
      measures[sg.m].chords.forEach((c, index) => {
        const inSeg = c.x >= sg.from && (c.x < sg.to || (sg.last && c.x <= sg.to));
        if (!inSeg) return;
        // a name that would stick out of the line moves left, but never over the previous one
        const x = Math.max(Math.min(sg.x0 + (c.x - sg.from), W - c.name.length), prevEnd + 1);
        ln.chords.push({ name: c.name, x, m: sg.m, index });
        prevEnd = x + c.name.length;
      });
    }
  }
  return lines;
}

// Where the cursor of measure `m` at character `x` (of the measure) goes: { line, col } in the layout, or null.
export function tabCursorPlace(lines, m, x) {
  for (let li = 0; li < lines.length; li++) {
    for (const sg of lines[li].segs) {
      if (sg.m !== m) continue;
      if (x >= sg.from && (x < sg.to || (sg.last && x <= sg.to))) return { line: li, col: sg.x0 + (x - sg.from) };
    }
  }
  return null;
}
