// Chord name parsing and validation (pure).

const CHORD_RE = new RegExp(
  '^([A-G][#b]?)' +
  '((?:maj|min|dim|aug|sus|add|m|M|\\+|\\u00b0|\\u00f8|-|\\d|[#b]\\d|\\/\\d|\\(|\\))*)' +
  '(?:\\/([A-G][#b]?))?$'
);

export function parseChord(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 24) return null;
  const m = CHORD_RE.exec(name);
  if (!m) return null;
  return { root: m[1], quality: m[2], bass: m[3] ?? null };
}

export function isChordName(str) {
  return parseChord(str) !== null;
}
