// Splits a lyric line into segments at chord columns (pure; used by render.js).
// A segment is { index, name, mark, word, rest }: the chord label sits above `word` (the first
// word, or word fragment, of the segment) and `rest` is flowed as ordinary inline text.

export function buildLineSegments(line) {
  const lyric = line.lyric;
  const order = line.chords.map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.col - b.c.col || a.index - b.index);
  if (order.length === 0) return { lead: lyric, segs: [], instrumental: false };

  const segs = [];
  let lead = '';
  if (lyric !== '') lead = lyric.slice(0, Math.min(order[0].c.col, lyric.length));
  for (let k = 0; k < order.length; k++) {
    const { c, index } = order[k];
    const start = Math.min(c.col, lyric.length);
    const end = k + 1 < order.length ? Math.min(Math.max(order[k + 1].c.col, start), lyric.length) : lyric.length;
    const text = lyric.slice(start, end);
    const word = /^\S*/.exec(text)[0];
    segs.push({ index, name: c.name, mark: c.mark || '', word, rest: text.slice(word.length) });
  }
  return { lead, segs, instrumental: lyric === '' };
}
