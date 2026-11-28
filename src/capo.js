// Capo from the text of a page (pure): English and Italian forms.
//   "Capo: 2nd fret", "Capo 2", "Capo on 2", "capo II", "Capo: no capo", "capotasto al 2° tasto", "Capotasto: 3"
// Returns the fret 0-12 (0 = none or not found).

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

export function parseCapoText(text) {
  const t = String(text || '');
  const m = /capo(?:tasto)?\s*[:=\-]?\s*(?:(?:on|al|alla|sul|sulla|at|the)\s+)*(?:(\d{1,2})|(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b)/i.exec(t);
  if (!m) return 0;
  if (/no\s*capo|senza\s*capo|nessun\s*capo/i.test(t.slice(m.index, m.index + 24))) return 0;
  const v = m[1] ? parseInt(m[1], 10) : ROMAN[m[2].toUpperCase()];
  return v >= 1 && v <= 12 ? v : 0;
}
