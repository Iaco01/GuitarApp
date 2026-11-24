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

// Groups a line for rendering so that it can wrap only at whitespace of the lyric.
// Returns { instrumental, items }, where each item is either { space: ' ' } (whitespace between
// words, a legal break point) or { group: [ { text } | { seg } ] } (a word with every chord
// segment that falls inside it; rendered as one nowrap container). A seg is
// { index, name, mark, text }; `text` is ' ' for a chord sitting on a space (it anchors to the
// existing character) and '' for a chord past the end of the lyric (group of its own).
export function buildLineGroups(line) {
  const { lead, segs, instrumental } = buildLineSegments(line);
  const items = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.length) items.push({ group: cur });
    cur = null;
  };
  const addText = (str) => {
    for (const tok of str.split(/(\s+)/)) {
      if (tok === '') continue;
      if (/^\s+$/.test(tok)) {
        flush();
        items.push({ space: tok });
      } else {
        if (!cur) cur = [];
        cur.push({ text: tok });
      }
    }
  };
  if (instrumental) {
    segs.forEach((s, k) => {
      if (k > 0) items.push({ space: ' ' });
      items.push({ group: [{ seg: { index: s.index, name: s.name, mark: s.mark, text: '' } }] });
    });
    return { instrumental, items };
  }
  addText(lead);
  for (const s of segs) {
    let word = s.word;
    let rest = s.rest;
    if (word === '' && /^\s/.test(rest)) {
      // chord over whitespace: anchor to the first space char (no placeholder is inserted)
      flush();
      items.push({ group: [{ seg: { index: s.index, name: s.name, mark: s.mark, text: rest[0] } }] });
      addText(rest.slice(1));
      continue;
    }
    if (word === '') {
      flush();
      items.push({ group: [{ seg: { index: s.index, name: s.name, mark: s.mark, text: '' } }] });
      addText(rest);
      continue;
    }
    if (!cur) cur = [];
    cur.push({ seg: { index: s.index, name: s.name, mark: s.mark, text: word } });
    addText(rest);
  }
  flush();
  return { instrumental, items };
}
