// Synthetic tab text and a tiny PDF writer for the tests of round 14. Everything here is invented:
// nothing comes from a real tab page.

import { Buffer } from 'node:buffer';

// ---- tab text builder ----
// A system: `bodies` = 6 strings (high string first), each starting with '|'; `chords` = [{ name, at }] with `at`
// the index in the body. wrap: width after which the rows continue in an unlabelled block.
export function tabSystem(bodies, chords = [], { wrap = 0, labels = ['e', 'B', 'G', 'D', 'A', 'E'] } = {}) {
  const width = Math.max(...bodies.map((b) => b.length));
  const padded = bodies.map((b) => b + '-'.repeat(width - b.length));
  const chunks = [];
  const w = wrap > 0 && wrap < width ? wrap : width;
  for (let s = 0; s < width; s += w) chunks.push([s, Math.min(width, s + w)]);
  const out = [];
  chunks.forEach(([from, to], ci) => {
    const here = chords.filter((c) => c.at >= from && c.at < to);
    if (here.length) {
      let line = '';
      for (const c of here) {
        const col = ci === 0 ? c.at + 1 : c.at - from;
        line = line.padEnd(col, ' ') + c.name;
      }
      out.push(line);
    }
    padded.forEach((b, r) => out.push((ci === 0 ? labels[r] : '') + b.slice(from, to)));
  });
  return out;
}

const bar = (s) => '|' + s;

// Invented measures (6 rows each, same width), joined with bars by `join`.
export function measures(list) {
  const rows = ['', '', '', '', '', ''];
  for (const m of list) {
    const w = Math.max(...m.map((r) => r.length));
    m.forEach((r, i) => { rows[i] += bar(r + '-'.repeat(w - r.length)); });
  }
  return rows.map((r) => r + '|');
}

export const M_AM7 = ['--0--0-----0--0--', '--1--1-----1--1--', '--0--0-----0--0--', '--2--2-----2--2--', '--0--0-----0--0--', '-----------------'];
export const M_FMAJ7 = ['--1--1-----1--1--', '--1--1-----1--1--', '--2--2-----2--2--', '--3--3-----3--3--', '--3--3-----3--3--', '--1--------------'];
export const M_RIFF1 = ['--5h7--7p5-------', '-----------------', '-----------------', '--------------/9-', '-----------------', '-----------------'];
export const M_RIFF2 = ['--10-12-10~~-----', '--12-------------', '-----------------', '-----------------', '--x--x-----------', '-----------------'];
// A barre shape written high on the neck (F#m-like: x 9 11 9 10 9).
export const M_BARRE = ['--9---9----9----9-', '--10--10---10---10', '--9---9----9----9-', '--11--11---11---11', '--9---9----9----9-', '------------------'];

// A long measure (54 characters, four chords one beat apart like a strummed bar written in one go).
export function longMeasure(shapes) {
  const rows = ['', '', '', '', '', ''];
  shapes.forEach((sh, k) => {
    for (let r = 0; r < 6; r++) {
      const f = sh[r];
      rows[r] += '--' + (f === null ? '-' : String(f)).padEnd(2, '-') + '-'.repeat(8 + (k === shapes.length - 1 ? 0 : 0));
    }
  });
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '-'));
}

export function syntheticTabText({ wrap = 0, noise = true, comments = true, long = false } = {}) {
  const L = [];
  L.push('Invented Song TAB by Imaginary Band');
  L.push('Standard Tuning (EADGBe)');
  L.push('Capo: 2nd fret');
  L.push('');
  L.push('This is a made up description line, not a tab.');
  L.push('');
  L.push('-----|Guitar 1|-----');
  L.push('');
  L.push('[Intro/Chorus]');
  L.push(...tabSystem(measures([M_AM7, M_FMAJ7]), [{ name: 'Am7', at: 3 }, { name: 'Fmaj7', at: 21 }], { wrap }));
  if (noise) L.push('CONTINUE IN THE APP');
  L.push(...tabSystem(measures([M_BARRE]), [{ name: 'F#m7', at: 3 }], { wrap }));
  L.push('');
  L.push('[Verse]');
  if (noise) L.push('Saving tab for offline usage is available in the app');
  L.push(...tabSystem(measures([M_FMAJ7, M_AM7]), [{ name: 'Fmaj7', at: 3 }, { name: 'Am7', at: 21 }], { wrap }));
  if (long) {
    // rows high to low: e B G D A E
    const bm = longMeasure([[9, 10, 9, 11, 9, null], [12, 14, 14, 14, 12, null], [10, 10, 11, 12, 12, 10], [9, 10, 9, 11, 9, null]]);
    L.push('');
    L.push('[Chorus]');
    L.push(...tabSystem(measures([bm, bm]), [{ name: 'F#m7', at: 3 }, { name: 'A', at: 15 }, { name: 'D', at: 27 }, { name: 'F#m7', at: 39 }, { name: 'F#m7', at: 52 }], { wrap }));
  }
  L.push('');
  L.push('-----|Guitar 2|-----');
  L.push('[Verse]');
  L.push(...tabSystem(measures([M_RIFF1, M_RIFF2]), [], { wrap }));
  L.push('');
  L.push('************************************');
  L.push('| /  Slide up');
  L.push('************************************');
  if (comments) {
    L.push('VERSIONS');
    L.push('Ver 1   55');
    L.push('21 COMMENTS');
    L.push('somebody wrote this in the comments:');
    L.push(...tabSystem(measures([M_AM7]), [{ name: 'C', at: 3 }]));
  }
  return L.join('\n');
}

// ---- PDF writer ----
async function deflate(bytes) {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

const ascii = (s) => Buffer.from(s, 'latin1');

// items: strings (one text line each, '' = blank line) or { overlay: 'text' } = a proportional-font banner on the y of the
// previous line. opts: compress, xrefStream (also puts the plain objects in an object stream), simpleFont (every line in a
// simple Courier-like font with Tj/TJ instead of a Type0 font with one glyph per Td), linesPerPage.
export async function makeTabPdf(items, { compress = true, xrefStream = false, simpleFont = false, linesPerPage = 60, title = 'Invented Song TAB by Imaginary Band @ Example.Com' } = {}) {
  const UNIT = 6; // glyph advance in points (font size 10, 600/1000 em)
  const X0 = 36;
  const STEP = 12;
  const pages = [[]];
  let y = 780;
  let count = 0;
  let lastY = y;
  for (const it of items) {
    if (count >= linesPerPage) { pages.push([]); y = 780; count = 0; }
    const page = pages[pages.length - 1];
    if (typeof it === 'object' && it.overlay) {
      page.push({ y: lastY, text: it.overlay, overlay: true, at: it.at || 10 });
      continue;
    }
    page.push({ y, text: it });
    lastY = y;
    y -= STEP;
    count++;
  }
  // font codes of the Type0 font: ascii + 100
  const CODE = (ch) => ch.charCodeAt(0) + 100;
  const hex2 = (n) => n.toString(16).padStart(4, '0');
  const hexStr = (s) => '<' + [...s].map((c) => hex2(CODE(c))).join('') + '>';
  const pageStreams = pages.map((page) => {
    const o = [];
    for (const ln of page) {
      if (ln.overlay) {
        o.push('BT', '/F2 14 Tf', `1 0 0 1 ${X0 + ln.at * UNIT} ${ln.y} Tm`, `(${ln.text}) Tj`, 'ET');
      } else if (simpleFont) {
        // words through TJ, the gap between them as a kerning number (-600 = one character)
        const parts = [];
        let col = 0;
        for (const m of ln.text.matchAll(/\S+/g)) {
          const gap = m.index - col;
          if (parts.length) parts.push(-600 * gap + 0);
          else if (m.index) parts.push(-600 * m.index);
          parts.push('(' + m[0].replace(/[()\\]/g, (c) => '\\' + c) + ')');
          col = m.index + m[0].length;
        }
        if (parts.length) o.push('BT', '/F3 10 Tf', `1 0 0 1 ${X0} ${ln.y} Tm`, `[${parts.join(' ')}] TJ`, 'ET');
      } else {
        o.push('BT', '/F1 10 Tf', `1 0 0 1 ${X0} ${ln.y} Tm`);
        let col = 0;
        for (let i = 0; i < ln.text.length; i++) {
          if (ln.text[i] === ' ') continue;
          o.push(`${(i - col) * UNIT} 0 Td ${hexStr(ln.text[i])} Tj`);
          col = i;
        }
        o.push('ET');
      }
    }
    return ascii(o.join('\n'));
  });
  // ToUnicode of F1: code = ascii + 100
  const toUni = ascii([
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '1 beginbfrange <0084> <00FE> <0020> endbfrange',
    '1 beginbfchar <0083> <0020> endbfchar',
    'endcmap end end',
  ].join('\n'));

  // objects: number -> { dict: string, stream?: Uint8Array }
  const objs = new Map();
  const add = (n, dict, stream) => objs.set(n, { dict, stream });
  const kids = [];
  const pageObjs = [];
  let next = 20;
  for (let i = 0; i < pages.length; i++) {
    const pn = next++;
    const cn = next++;
    kids.push(pn + ' 0 R');
    pageObjs.push([pn, cn, i]);
  }
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} /Resources << /Font << /F1 3 0 R /F2 7 0 R /F3 8 0 R >> >> /MediaBox [0 0 612 792] >>`);
  add(3, '<< /Type /Font /Subtype /Type0 /BaseFont /Mono /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>');
  add(4, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Mono /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 600 /W [100 [600] 132 255 600] >>');
  add(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 /Widths [' + new Array(95).fill(500).join(' ') + '] /Encoding /WinAnsiEncoding >>');
  add(8, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /FirstChar 32 /LastChar 126 /Widths [' + new Array(95).fill(600).join(' ') + '] /Encoding /WinAnsiEncoding >>');
  add(9, `<< /Title (${title.replace(/[()\\]/g, '')}) >>`);
  const streams = new Map([[6, toUni]]);
  for (const [pn, cn, i] of pageObjs) {
    add(pn, `<< /Type /Page /Parent 2 0 R /Contents ${cn} 0 R >>`);
    streams.set(cn, pageStreams[i]);
  }
  const body = async (n, extra = '') => {
    const raw = streams.get(n);
    const data = compress ? await deflate(raw) : raw;
    return { dict: `<< ${compress ? '/Filter /FlateDecode ' : ''}/Length ${data.length}${extra} >>`, data };
  };
  const chunks = [ascii('%PDF-1.5\n')];
  let pos = chunks[0].length;
  const offsets = new Map();
  const push = (b) => { chunks.push(b); pos += b.length; };
  const writeObj = async (n) => {
    offsets.set(n, pos);
    if (streams.has(n)) {
      const { dict, data } = await body(n);
      push(ascii(`${n} 0 obj\n${dict}\nstream\n`));
      push(data);
      push(ascii('\nendstream\nendobj\n'));
    } else push(ascii(`${n} 0 obj\n${objs.get(n).dict}\nendobj\n`));
  };
  const streamNums = [...streams.keys()];
  const plainNums = [...objs.keys()].filter((n) => !streams.has(n));
  if (!xrefStream) {
    for (const n of [...objs.keys(), ...streamNums].sort((a, b) => a - b)) await writeObj(n);
    const maxN = Math.max(...offsets.keys());
    const xrefPos = pos;
    let x = `xref\n0 ${maxN + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= maxN; n++) x += offsets.has(n) ? `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
    push(ascii(x + `trailer\n<< /Size ${maxN + 1} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`));
    return new Uint8Array(Buffer.concat(chunks));
  }
  // object stream with the plain objects, xref stream
  for (const n of streamNums) await writeObj(n);
  const stmNum = 100;
  let head = '';
  let bodyText = '';
  plainNums.forEach((n) => { head += `${n} ${bodyText.length} `; bodyText += objs.get(n).dict + '\n'; });
  const stmRaw = ascii(head + bodyText);
  const stmData = compress ? await deflate(stmRaw) : stmRaw;
  offsets.set(stmNum, pos);
  push(ascii(`${stmNum} 0 obj\n<< /Type /ObjStm /N ${plainNums.length} /First ${head.length} ${compress ? '/Filter /FlateDecode ' : ''}/Length ${stmData.length} >>\nstream\n`));
  push(stmData);
  push(ascii('\nendstream\nendobj\n'));
  const xrefNum = 101;
  const size = xrefNum + 1;
  const entries = [];
  for (let n = 0; n < size; n++) {
    if (offsets.has(n)) entries.push([1, offsets.get(n), 0]);
    else if (plainNums.includes(n)) entries.push([2, stmNum, plainNums.indexOf(n)]);
    else entries.push([0, 0, 0]);
  }
  const xrefPos = pos;
  entries[xrefNum] = [1, xrefPos, 0];
  const raw = new Uint8Array(entries.length * 5);
  entries.forEach(([t, a, b], i) => {
    raw[i * 5] = t;
    raw[i * 5 + 1] = (a >> 16) & 255;
    raw[i * 5 + 2] = (a >> 8) & 255;
    raw[i * 5 + 3] = a & 255;
    raw[i * 5 + 4] = b & 255;
  });
  // PNG "Up" predictor on the xref stream, to exercise it
  const rows = entries.length;
  const pred = new Uint8Array(rows * 6);
  for (let r = 0; r < rows; r++) {
    pred[r * 6] = 2;
    for (let c = 0; c < 5; c++) pred[r * 6 + 1 + c] = (raw[r * 5 + c] - (r ? raw[(r - 1) * 5 + c] : 0)) & 255;
  }
  const xdata = await deflate(pred);
  push(ascii(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${size} /W [1 3 1] /Root 1 0 R /Info 9 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >> /Length ${xdata.length} >>\nstream\n`));
  push(xdata);
  push(ascii(`\nendstream\nendobj\nstartxref\n${xrefPos}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(chunks));
}
