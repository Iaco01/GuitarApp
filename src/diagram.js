// Chord shape -> inline SVG string (pure). Everything is drawn with currentColor so the diagram
// follows the page theme; `theme` ('light' | 'dark') forces a colour for use outside a themed page.

const DG_W = 100;
const DG_GRID_X = 30; // left edge of the first string
const DG_STRING_GAP = 11.2;
const DG_ROW_H = 17;
const DG_ROWS = 5;
const DG_TOP = 34; // top of the grid (without label)
const DG_LABEL_H = 20;

function dgNum(n) {
  return String(Math.round(n * 100) / 100);
}

function dgEscape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Options: size = width in px (height follows the aspect ratio), label = chord name drawn on top,
// theme = 'light' | 'dark' (optional).
export function renderDiagramSvg(shape, { size = 64, label = '', theme = '' } = {}) {
  const top = DG_TOP + (label ? DG_LABEL_H : 0);
  const gridH = DG_ROWS * DG_ROW_H;
  const height = top + gridH + 8;
  const sx = (i) => DG_GRID_X + i * DG_STRING_GAP;
  const rowY = (fret) => top + (fret - shape.baseFret + 0.5) * DG_ROW_H;
  const parts = [];
  const color = theme === 'dark' ? ' style="color:#eceff3"' : theme === 'light' ? ' style="color:#1d2127"' : '';
  const aspect = height / DG_W;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DG_W} ${dgNum(height)}" width="${dgNum(size)}" height="${dgNum(size * aspect)}" role="img" aria-label="${dgEscape(label ? 'Diagramma ' + label : 'Diagramma accordo')}" class="dg"${color}>`);
  if (label) parts.push(`<text x="${DG_W / 2}" y="15" text-anchor="middle" font-size="17" font-weight="700" fill="currentColor" font-family="ui-monospace,Menlo,Consolas,monospace">${dgEscape(label)}</text>`);
  const left = sx(0);
  const right = sx(5);
  // frets (horizontal lines) and strings
  for (let r = 0; r <= DG_ROWS; r++) {
    const y = top + r * DG_ROW_H;
    const thick = r === 0 && shape.baseFret === 1;
    parts.push(`<line x1="${dgNum(left)}" y1="${dgNum(y)}" x2="${dgNum(right)}" y2="${dgNum(y)}" stroke="currentColor" stroke-width="${thick ? 5 : 1.4}" stroke-linecap="${thick ? 'butt' : 'round'}"${thick ? '' : ' opacity="0.75"'}/>`);
  }
  for (let i = 0; i < 6; i++) {
    parts.push(`<line x1="${dgNum(sx(i))}" y1="${top}" x2="${dgNum(sx(i))}" y2="${top + gridH}" stroke="currentColor" stroke-width="1.4" opacity="0.75"/>`);
  }
  if (shape.baseFret > 1) {
    parts.push(`<text x="${left - 9}" y="${dgNum(top + DG_ROW_H * 0.5 + 6)}" text-anchor="end" font-size="19" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">${shape.baseFret}</text>`);
  }
  // barres
  for (const b of shape.barres || []) {
    const y = rowY(b.fret);
    parts.push(`<rect x="${dgNum(sx(b.from) - 5.6)}" y="${dgNum(y - 5.6)}" width="${dgNum(sx(b.to) - sx(b.from) + 11.2)}" height="11.2" rx="5.6" fill="currentColor"/>`);
  }
  // dots and markers
  shape.frets.forEach((f, i) => {
    const x = sx(i);
    if (f === 'x') {
      parts.push(`<path d="M${dgNum(x - 4)} ${top - 12}l8 8m0-8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`);
    } else if (f === 0) {
      parts.push(`<circle cx="${dgNum(x)}" cy="${top - 8}" r="4" fill="none" stroke="currentColor" stroke-width="2"/>`);
    } else {
      parts.push(`<circle cx="${dgNum(x)}" cy="${dgNum(rowY(f))}" r="5.6" fill="currentColor"/>`);
    }
  });
  parts.push('</svg>');
  return parts.join('');
}
