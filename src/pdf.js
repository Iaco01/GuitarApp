// Minimal PDF text reader (pure: no DOM, runs in Node and in the browser, zero dependencies).
//
// What it does: finds the objects (xref table or xref stream, object streams, with a scan fallback),
// inflates FlateDecode streams with DecompressionStream, runs the text operators of every page
// (BT/ET, Tf, Td/TD/Tm/T*, Tj/TJ/'/") and decodes the glyphs with the ToUnicode CMap of the font
// (Type0/Identity-H included). Every glyph keeps its position, so the lines AND the character columns
// can be rebuilt: in a tab the alignment is the content.
//
// Entry point: `await readPdfText(bytes)` -> { title, pages: [{ lines: [{ text, y, size }] }], lines, warnings }.

const PDF_WS = new Set([0, 9, 10, 12, 13, 32]);
const PDF_DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

class PdfName { constructor(n) { this.n = n; } }
class PdfStr { constructor(bytes) { this.bytes = bytes; } }
class PdfRef { constructor(num, gen) { this.num = num; this.gen = gen; } }
class PdfOp { constructor(op) { this.op = op; } }
class PdfStream { constructor(dict, raw) { this.dict = dict; this.raw = raw; } }

const pdfIsName = (v, n) => v instanceof PdfName && (n === undefined || v.n === n);

// ---- lexer / object parser ----
class PdfLexer {
  constructor(bytes, pos = 0) {
    this.b = bytes;
    this.p = pos;
  }

  skipWs() {
    const b = this.b;
    while (this.p < b.length) {
      const c = b[this.p];
      if (PDF_WS.has(c)) this.p++;
      else if (c === 37) { while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++; } else break;
    }
  }

  eof() {
    this.skipWs();
    return this.p >= this.b.length;
  }

  word() {
    const b = this.b;
    const s = this.p;
    while (this.p < b.length && !PDF_WS.has(b[this.p]) && !PDF_DELIM.has(b[this.p])) this.p++;
    let out = '';
    for (let i = s; i < this.p; i++) out += String.fromCharCode(b[i]);
    return out;
  }

  // One object. With `refs`, "N G R" becomes a PdfRef. Keywords come back as PdfOp. `undefined` at the end.
  value(refs) {
    this.skipWs();
    const b = this.b;
    if (this.p >= b.length) return undefined;
    const c = b[this.p];
    if (c === 47) {
      this.p++;
      const w = this.word();
      return new PdfName(w.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === 40) return this.litString();
    if (c === 60) {
      if (b[this.p + 1] === 60) {
        this.p += 2;
        const d = Object.create(null);
        for (;;) {
          this.skipWs();
          if (this.p >= b.length) break;
          if (b[this.p] === 62 && b[this.p + 1] === 62) { this.p += 2; break; }
          const k = this.value(refs);
          if (!(k instanceof PdfName)) { if (k === undefined) break; continue; }
          const v = this.value(refs);
          if (v instanceof PdfOp) continue;
          d[k.n] = v;
        }
        return d;
      }
      return this.hexString();
    }
    if (c === 91) {
      this.p++;
      const arr = [];
      for (;;) {
        this.skipWs();
        if (this.p >= b.length) break;
        if (b[this.p] === 93) { this.p++; break; }
        const v = this.value(refs);
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { this.p++; return new PdfOp(String.fromCharCode(c)); }
    const w = this.word();
    if (w === '') { this.p++; return new PdfOp(''); }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      const n = parseFloat(w);
      if (refs && Number.isInteger(n) && n >= 0 && /^\d+$/.test(w)) {
        const save = this.p;
        this.skipWs();
        const g = this.word();
        if (/^\d+$/.test(g)) {
          this.skipWs();
          if (b[this.p] === 82 && (this.p + 1 >= b.length || PDF_WS.has(b[this.p + 1]) || PDF_DELIM.has(b[this.p + 1]))) {
            this.p++;
            return new PdfRef(n, parseInt(g, 10));
          }
        }
        this.p = save;
      }
      return n;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new PdfOp(w);
  }

  litString() {
    const b = this.b;
    this.p++;
    const out = [];
    let depth = 1;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 92) {
        const d = b[this.p++];
        if (d === 110) out.push(10);
        else if (d === 114) out.push(13);
        else if (d === 116) out.push(9);
        else if (d === 98) out.push(8);
        else if (d === 102) out.push(12);
        else if (d >= 48 && d <= 55) {
          let v = d - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + (b[this.p++] - 48);
          out.push(v & 255);
        } else if (d === 13) { if (b[this.p] === 10) this.p++; } else if (d === 10) { /* line continuation */ } else out.push(d);
      } else if (c === 40) { depth++; out.push(c); } else if (c === 41) {
        depth--;
        if (depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return new PdfStr(Uint8Array.from(out));
  }

  hexString() {
    const b = this.b;
    this.p++;
    let hex = '';
    while (this.p < b.length && b[this.p] !== 62) {
      const ch = String.fromCharCode(b[this.p++]);
      if (/[0-9a-fA-F]/.test(ch)) hex += ch;
    }
    this.p++;
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return new PdfStr(out);
  }
}

function pdfIndexOf(b, str, from = 0, to = b.length) {
  const n = str.length;
  const first = str.charCodeAt(0);
  outer: for (let i = from; i <= to - n; i++) {
    if (b[i] !== first) continue;
    for (let k = 1; k < n; k++) if (b[i + k] !== str.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

function pdfLastIndexOf(b, str, from = b.length) {
  const n = str.length;
  outer: for (let i = Math.min(from, b.length - n); i >= 0; i--) {
    for (let k = 0; k < n; k++) if (b[i + k] !== str.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

// ---- stream decoding ----
export function inflateSupported() {
  return typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
}

async function pdfInflate(bytes) {
  if (!inflateSupported()) throw new Error('Questo browser non sa decomprimere i PDF (DecompressionStream mancante)');
  const run = async (format, data) => {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const written = writer.write(data).then(() => writer.close()).catch(() => {});
    const out = await new Response(ds.readable).arrayBuffer();
    await written;
    return new Uint8Array(out);
  };
  try {
    return await run('deflate', bytes);
  } catch (err) {
    // a damaged tail: try the raw deflate data after the 2 byte zlib header
    try { return await run('deflate-raw', bytes.subarray(2)); } catch { throw err; }
  }
}

function pdfUnpredict(data, columns, colors, bpc) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const f = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const x = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[dst - rowLen + i] : 0;
      const c = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

// ---- document ----
class PdfDoc {
  constructor(bytes) {
    this.b = bytes;
    this.xref = new Map(); // num -> { off } | { stm, idx }
    this.cache = new Map();
    this.trailer = null;
    this.objStms = new Map();
    this.warnings = [];
  }

  async load() {
    let ok = false;
    try {
      ok = await this.readXrefChain();
    } catch { ok = false; }
    if (ok) {
      try {
        const root = await this.resolve(this.trailer.Root);
        if (!root || !root.Pages) ok = false;
      } catch { ok = false; }
    }
    if (!ok) {
      this.xref.clear();
      this.cache.clear();
      this.objStms.clear();
      await this.reconstruct();
      this.warnings.push('Tabella dei riferimenti del PDF non leggibile: struttura ricostruita');
    }
  }

  async readXrefChain() {
    const b = this.b;
    const sx = pdfLastIndexOf(b, 'startxref');
    if (sx < 0) return false;
    const lx = new PdfLexer(b, sx + 9);
    let off = lx.value(false);
    const seen = new Set();
    while (typeof off === 'number' && !seen.has(off)) {
      seen.add(off);
      const lex = new PdfLexer(b, off);
      lex.skipWs();
      let trailer;
      if (b[lex.p] === 120) { // "xref"
        lex.word();
        for (;;) {
          lex.skipWs();
          const save = lex.p;
          const w = lex.word();
          if (w === 'trailer') break;
          if (!/^\d+$/.test(w)) { lex.p = save; return false; }
          const start = parseInt(w, 10);
          lex.skipWs();
          const count = parseInt(lex.word(), 10);
          for (let i = 0; i < count; i++) {
            lex.skipWs();
            const o = parseInt(lex.word(), 10);
            lex.skipWs();
            lex.word();
            lex.skipWs();
            const t = lex.word();
            if (t === 'n' && !this.xref.has(start + i)) this.xref.set(start + i, { off: o });
          }
        }
        trailer = lex.value(true);
        if (trailer && typeof trailer.XRefStm === 'number') {
          // hybrid file: the stream carries the compressed objects
          const stm = await this.readXrefStream(trailer.XRefStm);
          if (!stm) return false;
        }
      } else {
        trailer = await this.readXrefStream(off);
        if (!trailer) return false;
      }
      if (!this.trailer) this.trailer = trailer;
      off = trailer && typeof trailer.Prev === 'number' ? trailer.Prev : null;
    }
    return !!(this.trailer && this.trailer.Root);
  }

  async readXrefStream(off) {
    const obj = this.parseIndirectAt(off);
    if (!obj || !(obj.value instanceof PdfStream)) return null;
    const st = obj.value;
    const d = st.dict;
    const data = await this.decodeStream(st);
    const w = d.W;
    if (!Array.isArray(w)) return null;
    const index = Array.isArray(d.Index) ? d.Index : [0, d.Size];
    let p = 0;
    const rd = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + data[p++]; return v; };
    for (let s = 0; s < index.length; s += 2) {
      for (let i = 0; i < index[s + 1]; i++) {
        const t = w[0] ? rd(w[0]) : 1;
        const f2 = rd(w[1]);
        const f3 = rd(w[2]);
        const num = index[s] + i;
        if (this.xref.has(num)) continue;
        if (t === 1) this.xref.set(num, { off: f2 });
        else if (t === 2) this.xref.set(num, { stm: f2, idx: f3 });
      }
    }
    return d;
  }

  // Scans the whole file for "N G obj" (damaged or unusual xref).
  async reconstruct() {
    const b = this.b;
    let latin = '';
    const CH = 1 << 16;
    for (let i = 0; i < b.length; i += CH) latin += String.fromCharCode.apply(null, b.subarray(i, Math.min(b.length, i + CH)));
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(latin))) this.xref.set(parseInt(m[1], 10), { off: m.index });
    // trailer: last "trailer" dict with a Root, else the Catalog (or an xref stream dict)
    let trailer = null;
    const tre = /trailer/g;
    while ((m = tre.exec(latin))) {
      const d = new PdfLexer(b, m.index + 7).value(true);
      if (d && d.Root) trailer = d;
    }
    // object streams
    const nums = [...this.xref.keys()];
    for (const n of nums) {
      let obj;
      try { obj = await this.getObject(n); } catch { continue; }
      if (obj instanceof PdfStream && pdfIsName(obj.dict.Type, 'ObjStm')) {
        try {
          const objs = await this.loadObjStm(n);
          objs.forEach((_, k) => { if (!this.xref.has(objs.nums[k]) || this.xref.get(objs.nums[k]).off === undefined) this.xref.set(objs.nums[k], { stm: n, idx: k }); });
        } catch { /* skip */ }
      }
      if (!trailer && obj instanceof PdfStream && pdfIsName(obj.dict.Type, 'XRef') && obj.dict.Root) trailer = obj.dict;
    }
    if (!trailer) {
      for (const n of this.xref.keys()) {
        let obj;
        try { obj = await this.getObject(n); } catch { continue; }
        if (obj && !(obj instanceof PdfStream) && typeof obj === 'object' && pdfIsName(obj.Type, 'Catalog')) { trailer = { Root: new PdfRef(n, 0) }; break; }
      }
    }
    if (!trailer) throw new Error('Il file non sembra un PDF leggibile');
    this.trailer = trailer;
  }

  parseIndirectAt(off) {
    const lex = new PdfLexer(this.b, off);
    const n = lex.value(false);
    const g = lex.value(false);
    const kw = lex.value(false);
    if (typeof n !== 'number' || typeof g !== 'number' || !(kw instanceof PdfOp) || kw.op !== 'obj') return null;
    let v = lex.value(true);
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PdfName) && !(v instanceof PdfStr) && !(v instanceof PdfRef) && !(v instanceof PdfOp)) {
      lex.skipWs();
      const save = lex.p;
      const w = lex.word();
      if (w === 'stream') {
        let s = lex.p;
        if (this.b[s] === 13) s++;
        if (this.b[s] === 10) s++;
        let len = v.Length;
        if (len instanceof PdfRef) len = this.peekLength(len);
        let end = -1;
        if (typeof len === 'number' && len >= 0 && s + len <= this.b.length) {
          const l2 = new PdfLexer(this.b, s + len);
          l2.skipWs();
          if (this.b[l2.p] === 101 && l2.word() === 'endstream') end = s + len;
        }
        if (end < 0) {
          const e = pdfIndexOf(this.b, 'endstream', s);
          end = e < 0 ? this.b.length : e;
          // drop the end of line before "endstream"
          if (end > s && this.b[end - 1] === 10) end--;
          if (end > s && this.b[end - 1] === 13) end--;
        }
        v = new PdfStream(v, this.b.subarray(s, end));
      } else lex.p = save;
    }
    return { num: n, gen: g, value: v };
  }

  // Length given as a reference: read it from a plain object, without resolving streams.
  peekLength(ref) {
    const e = this.xref.get(ref.num);
    if (!e || e.off === undefined) return undefined;
    const lex = new PdfLexer(this.b, e.off);
    lex.value(false); lex.value(false); lex.value(false);
    const v = lex.value(false);
    return typeof v === 'number' ? v : undefined;
  }

  async getObject(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    const e = this.xref.get(num);
    let value = null;
    if (e && e.off !== undefined) {
      const o = this.parseIndirectAt(e.off);
      if (o && o.num === num) value = o.value;
      else if (o) value = o.value;
    } else if (e && e.stm !== undefined) {
      const list = await this.loadObjStm(e.stm);
      const k = list.nums.indexOf(num);
      value = k >= 0 ? list[k] : null;
    }
    this.cache.set(num, value);
    return value;
  }

  async loadObjStm(stmNum) {
    if (this.objStms.has(stmNum)) return this.objStms.get(stmNum);
    const st = await this.getObject(stmNum);
    const data = await this.decodeStream(st);
    const n = st.dict.N;
    const first = st.dict.First;
    const lex = new PdfLexer(data, 0);
    const nums = [];
    const offs = [];
    for (let i = 0; i < n; i++) { nums.push(lex.value(false)); offs.push(lex.value(false)); }
    const out = [];
    out.nums = nums;
    for (let i = 0; i < n; i++) out.push(new PdfLexer(data, first + offs[i]).value(true));
    this.objStms.set(stmNum, out);
    return out;
  }

  async resolve(v) {
    let guard = 0;
    while (v instanceof PdfRef && guard++ < 20) v = await this.getObject(v.num);
    return v === undefined ? null : v;
  }

  async decodeStream(st) {
    let data = st.raw;
    let filters = await this.resolve(st.dict.Filter || st.dict.F);
    let parms = await this.resolve(st.dict.DecodeParms || st.dict.DP);
    if (filters === null || filters === undefined) return data;
    if (!Array.isArray(filters)) { filters = [filters]; parms = [parms]; } else if (!Array.isArray(parms)) parms = filters.map(() => null);
    for (let i = 0; i < filters.length; i++) {
      const f = await this.resolve(filters[i]);
      const name = f instanceof PdfName ? f.n : '';
      const pr = await this.resolve(parms[i]);
      if (name === 'FlateDecode' || name === 'Fl') {
        data = await pdfInflate(data);
        if (pr && Number(pr.Predictor) >= 10) data = pdfUnpredict(data, Number(pr.Columns) || 1, Number(pr.Colors) || 1, Number(pr.BitsPerComponent) || 8);
      } else if (name === 'ASCIIHexDecode') {
        let hex = '';
        for (const c of data) { const ch = String.fromCharCode(c); if (ch === '>') break; if (/[0-9a-fA-F]/.test(ch)) hex += ch; }
        if (hex.length % 2) hex += '0';
        data = Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
      } else {
        throw new Error(`Filtro PDF non supportato: ${name || '?'}`);
      }
    }
    return data;
  }

  async dictOf(v) {
    const r = await this.resolve(v);
    if (r instanceof PdfStream) return r.dict;
    return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
  }
}

// ---- fonts ----
function pdfUtf16be(bytes) {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  if (bytes.length === 1) s = String.fromCharCode(bytes[0]);
  return s;
}

const pdfHexToNum = (bytes) => { let v = 0; for (const c of bytes) v = v * 256 + c; return v; };

export function parseToUnicode(data) {
  const map = new Map();
  let codeBytes = 0;
  const lex = new PdfLexer(data, 0);
  const stack = [];
  for (;;) {
    const t = lex.value(false);
    if (t === undefined) break;
    if (!(t instanceof PdfOp)) { stack.push(t); if (stack.length > 4000) stack.splice(0, 2000); continue; }
    if (t.op === 'endcodespacerange') {
      const strs = stack.filter((s) => s instanceof PdfStr);
      if (strs.length) codeBytes = Math.max(codeBytes, strs[0].bytes.length);
      stack.length = 0;
    } else if (t.op === 'endbfchar') {
      const strs = stack.filter((s) => s instanceof PdfStr);
      for (let i = 0; i + 1 < strs.length; i += 2) map.set(pdfHexToNum(strs[i].bytes), pdfUtf16be(strs[i + 1].bytes));
      stack.length = 0;
    } else if (t.op === 'endbfrange') {
      let i = 0;
      while (i + 2 < stack.length + 0 && i < stack.length) {
        const lo = stack[i];
        const hi = stack[i + 1];
        const dst = stack[i + 2];
        if (!(lo instanceof PdfStr) || !(hi instanceof PdfStr)) { i++; continue; }
        const a = pdfHexToNum(lo.bytes);
        const z = pdfHexToNum(hi.bytes);
        if (Array.isArray(dst)) {
          for (let c = a; c <= z && c - a < dst.length; c++) if (dst[c - a] instanceof PdfStr) map.set(c, pdfUtf16be(dst[c - a].bytes));
        } else if (dst instanceof PdfStr) {
          const base = pdfUtf16be(dst.bytes);
          const lastCh = base.charCodeAt(base.length - 1);
          for (let c = a; c <= z && c - a < 65536; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(lastCh + (c - a)));
        }
        i += 3;
      }
      stack.length = 0;
    } else if (/^(begin|end|def|dict|findresource|usecmap|pop|dup|currentdict|defineresource)/.test(t.op)) {
      if (t.op.startsWith('end') || t.op.startsWith('begin')) stack.length = 0;
    }
  }
  return { map, codeBytes };
}

const PDF_GLYPH_NAMES = {
  space: ' ', hyphen: '-', minus: '-', bar: '|', slash: '/', backslash: '\\', period: '.', comma: ',', colon: ':', semicolon: ';',
  parenleft: '(', parenright: ')', bracketleft: '[', bracketright: ']', numbersign: '#', asterisk: '*', plus: '+', equal: '=',
  underscore: '_', quotesingle: "'", quotedbl: '"', exclam: '!', question: '?', at: '@', percent: '%', ampersand: '&', less: '<', greater: '>',
  asciitilde: '~', asciicircum: '^', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

function pdfGlyphChar(n) {
  if (n.length === 1) return n;
  if (PDF_GLYPH_NAMES[n]) return PDF_GLYPH_NAMES[n];
  const m = /^uni([0-9A-Fa-f]{4})$/.exec(n);
  return m ? String.fromCharCode(parseInt(m[1], 16)) : '';
}

let pdfFontSeq = 0;

async function pdfLoadFont(doc, ref) {
  const fd = await doc.dictOf(ref);
  const font = { id: ++pdfFontSeq, codeBytes: 1, widths: new Map(), dw: 1000, uni: null, dict: fd, fm: 0.001 };
  if (!fd) return font;
  const subtype = (await doc.resolve(fd.Subtype)) || null;
  const sub = subtype instanceof PdfName ? subtype.n : '';
  let tu = null;
  if (fd.ToUnicode) {
    try {
      const st = await doc.resolve(fd.ToUnicode);
      if (st instanceof PdfStream) tu = parseToUnicode(await doc.decodeStream(st));
    } catch { tu = null; }
  }
  font.uni = tu && tu.map.size ? tu.map : null;
  if (sub === 'Type0') {
    font.codeBytes = tu && tu.codeBytes ? tu.codeBytes : 2;
    const desc = await doc.resolve(fd.DescendantFonts);
    const df = await doc.dictOf(Array.isArray(desc) ? desc[0] : desc);
    if (df) {
      if (typeof df.DW === 'number') font.dw = df.DW;
      const w = await doc.resolve(df.W);
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length;) {
          const c = await doc.resolve(w[i]);
          const nx = await doc.resolve(w[i + 1]);
          if (Array.isArray(nx)) {
            for (let k = 0; k < nx.length; k++) font.widths.set(c + k, Number(await doc.resolve(nx[k])));
            i += 2;
          } else {
            const wd = Number(await doc.resolve(w[i + 2]));
            for (let k = c; k <= nx && k - c < 70000; k++) font.widths.set(k, wd);
            i += 3;
          }
        }
      }
    }
    font.type0 = true;
  } else {
    const first = Number(await doc.resolve(fd.FirstChar)) || 0;
    const ws = await doc.resolve(fd.Widths);
    if (sub === 'Type3') {
      const fm = await doc.resolve(fd.FontMatrix);
      font.fm = Array.isArray(fm) && typeof fm[0] === 'number' ? fm[0] : 0.001;
    }
    if (Array.isArray(ws)) for (let i = 0; i < ws.length; i++) font.widths.set(first + i, Number(await doc.resolve(ws[i])) * (font.fm / 0.001));
    const fdesc = await doc.dictOf(fd.FontDescriptor);
    font.dw = fdesc && typeof fdesc.MissingWidth === 'number' && fdesc.MissingWidth > 0 ? fdesc.MissingWidth : 600;
    if (!font.uni) {
      // simple font without ToUnicode: Differences over a Latin-1 base
      const enc = await doc.resolve(fd.Encoding);
      const diff = new Map();
      const encDict = enc && !(enc instanceof PdfName) && typeof enc === 'object' ? enc : null;
      if (encDict && Array.isArray(encDict.Differences)) {
        let code = 0;
        for (const it of encDict.Differences) {
          const v = await doc.resolve(it);
          if (typeof v === 'number') code = v;
          else if (v instanceof PdfName) diff.set(code++, pdfGlyphChar(v.n));
        }
      }
      font.uni = new Map();
      for (let c = 32; c < 256; c++) font.uni.set(c, diff.has(c) ? diff.get(c) : String.fromCharCode(c));
      for (const [c, s] of diff) font.uni.set(c, s);
    }
  }
  return font;
}

// ---- content stream interpreter ----
const pdfMul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

async function pdfRunContent(doc, data, resources, ctm0, out, fontCache, depth) {
  const lex = new PdfLexer(data, 0);
  const stack = [];
  let ctm = ctm0.slice();
  const gstack = [];
  let font = null;
  let fs = 1;
  let tc = 0;
  let tw = 0;
  let th = 1;
  let tl = 0;
  let trise = 0;
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  const fonts = resources ? await doc.dictOf(resources.Font) : null;
  const xobjs = resources ? await doc.dictOf(resources.XObject) : null;

  const showBytes = (bytes) => {
    const cb = font ? font.codeBytes : 1;
    for (let i = 0; i + cb <= bytes.length; i += cb) {
      let code = 0;
      for (let k = 0; k < cb; k++) code = code * 256 + bytes[i + k];
      const w = font ? (font.widths.has(code) ? font.widths.get(code) : font.dw) : 600;
      const trm = pdfMul(tm, ctm);
      const hs = Math.hypot(trm[0], trm[1]);
      const vs = Math.hypot(trm[2], trm[3]);
      const adv = (w / 1000) * fs * th;
      let ch = font && font.uni ? font.uni.get(code) : undefined;
      if (ch === undefined) ch = font && font.type0 ? '�' : String.fromCharCode(code);
      out.push({ ch, x: trm[4], y: trm[5] + trise * vs, adv: Math.abs(adv * hs), size: fs * vs, f: font ? font.id : 0 });
      const tx = (adv + (tc * th) + (code === 32 && cb === 1 ? tw * th : 0));
      tm = pdfMul([1, 0, 0, 1, tx, 0], tm);
    }
  };
  const moveLine = (tx, ty) => {
    tlm = pdfMul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm.slice();
  };
  const num = (v) => (typeof v === 'number' ? v : 0);

  for (;;) {
    const t = lex.value(false);
    if (t === undefined) break;
    if (!(t instanceof PdfOp)) { stack.push(t); if (stack.length > 512) stack.splice(0, 256); continue; }
    const op = t.op;
    const a = stack;
    switch (op) {
      case 'q': gstack.push({ ctm: ctm.slice(), font, fs, tc, tw, th, tl, trise }); break;
      case 'Q': { const g = gstack.pop(); if (g) ({ font, fs, tc, tw, th, tl, trise } = g), ctm = g.ctm; break; }
      case 'cm': if (a.length >= 6) ctm = pdfMul(a.slice(-6).map(num), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Tf': {
        const nm = a[a.length - 2];
        fs = num(a[a.length - 1]);
        if (nm instanceof PdfName && fonts && fonts[nm.n] !== undefined) {
          const ref = fonts[nm.n];
          const key = ref instanceof PdfRef ? 'r' + ref.num : null;
          if (key && fontCache.has(key)) font = fontCache.get(key);
          else {
            font = await pdfLoadFont(doc, ref);
            if (key) fontCache.set(key, font);
          }
        } else font = null;
        break;
      }
      case 'Tc': tc = num(a[a.length - 1]); break;
      case 'Tw': tw = num(a[a.length - 1]); break;
      case 'Tz': th = num(a[a.length - 1]) / 100; break;
      case 'TL': tl = num(a[a.length - 1]); break;
      case 'Ts': trise = num(a[a.length - 1]); break;
      case 'Td': moveLine(num(a[a.length - 2]), num(a[a.length - 1])); break;
      case 'TD': tl = -num(a[a.length - 1]); moveLine(num(a[a.length - 2]), num(a[a.length - 1])); break;
      case 'Tm': if (a.length >= 6) { tm = a.slice(-6).map(num); tlm = tm.slice(); } break;
      case 'T*': moveLine(0, -tl); break;
      case 'Tj': { const s = a[a.length - 1]; if (s instanceof PdfStr) showBytes(s.bytes); break; }
      case "'": { moveLine(0, -tl); const s = a[a.length - 1]; if (s instanceof PdfStr) showBytes(s.bytes); break; }
      case '"': { tw = num(a[a.length - 3]); tc = num(a[a.length - 2]); moveLine(0, -tl); const s = a[a.length - 1]; if (s instanceof PdfStr) showBytes(s.bytes); break; }
      case 'TJ': {
        const arr = a[a.length - 1];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            if (it instanceof PdfStr) showBytes(it.bytes);
            else if (typeof it === 'number') tm = pdfMul([1, 0, 0, 1, (-it / 1000) * fs * th, 0], tm);
          }
        }
        break;
      }
      case 'Do': {
        const nm = a[a.length - 1];
        if (nm instanceof PdfName && xobjs && xobjs[nm.n] !== undefined && depth < 4) {
          const xo = await doc.resolve(xobjs[nm.n]);
          if (xo instanceof PdfStream && pdfIsName(await doc.resolve(xo.dict.Subtype), 'Form')) {
            try {
              const m = await doc.resolve(xo.dict.Matrix);
              const fm = Array.isArray(m) && m.length === 6 ? m.map(num) : [1, 0, 0, 1, 0, 0];
              const res = (await doc.dictOf(xo.dict.Resources)) || resources;
              await pdfRunContent(doc, await doc.decodeStream(xo), res, pdfMul(fm, ctm), out, fontCache, depth + 1);
            } catch { /* a form that cannot be read: skip */ }
          }
        }
        break;
      }
      default: break;
    }
    stack.length = 0;
  }
}

async function pdfCollectPages(doc, node, inherited, pages, guard = 0) {
  const d = await doc.dictOf(node);
  if (!d || guard > 40) return;
  const res = d.Resources !== undefined ? d.Resources : inherited;
  const type = await doc.resolve(d.Type);
  if (d.Kids && !(type instanceof PdfName && type.n === 'Page')) {
    const kids = await doc.resolve(d.Kids);
    if (Array.isArray(kids)) for (const k of kids) await pdfCollectPages(doc, k, res, pages, guard + 1);
  } else {
    pages.push({ dict: d, resources: res });
  }
}

// ---- glyphs -> lines with columns ----
const pdfMedian = (xs) => { const s = xs.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function pdfModeOf(xs, step) {
  const counts = new Map();
  for (const v of xs) {
    const k = Math.round(v / step);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = 0;
  let bk = 0;
  for (const [k, c] of counts) if (c > best) { best = c; bk = k; }
  return bk * step;
}

// Rebuilds the lines of one page. Characters are placed in columns of the width of the line's glyphs
// (the one of the monospaced font), so that what is aligned on the page stays aligned in the text.
export function glyphsToLines(glyphs) {
  const gl = glyphs.filter((g) => g.ch !== '' && Number.isFinite(g.x) && Number.isFinite(g.y));
  if (!gl.length) return [];
  // page up = larger y (after the matrices of the page): lines from top to bottom
  gl.sort((p, q) => q.y - p.y || p.x - q.x);
  const rows = [];
  for (const g of gl) {
    const last = rows[rows.length - 1];
    const tol = Math.max(1, 0.35 * Math.min(g.size || 10, last ? last.size : 10));
    if (last && Math.abs(last.y - g.y) <= tol) {
      last.glyphs.push(g);
      last.size = Math.max(last.size, g.size);
    } else rows.push({ y: g.y, size: g.size || 10, glyphs: [g] });
  }
  // an overlay (banner, button) printed over a line has another font and lands on the same y: it becomes a line of its own
  const split = [];
  for (const r of rows) {
    const groups = new Map();
    for (const g of r.glyphs) {
      const k = `${g.f}|${Math.round(g.size)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(g);
    }
    if (groups.size < 2) { split.push(r); continue; }
    const list = [...groups.values()].sort((p, q) => q.length - p.length);
    const main = list[0];
    const keep = [main];
    const sorted = (xs) => xs.slice().sort((p, q) => p.x - q.x);
    const overlaps = (xs) => {
      const m = sorted(main);
      let n = 0;
      let j = 0;
      for (const g of sorted(xs)) {
        while (j < m.length && m[j].x < g.x - 0.5 * Math.max(g.adv, 1)) j++;
        if (j < m.length && Math.abs(m[j].x - g.x) < 0.5 * Math.max(Math.min(g.adv, m[j].adv), 1)) n++;
      }
      return n;
    };
    const extra = [];
    for (const g of list.slice(1)) (overlaps(g) >= 2 ? extra : keep).push(g);
    const merged = keep.flat();
    split.push({ y: r.y, size: r.size, glyphs: merged });
    extra.forEach((g, i) => split.push({ y: r.y - (i + 1) * 1e-3, size: Math.max(...g.map((x) => x.size)), glyphs: g }));
  }
  rows.length = 0;
  rows.push(...split);
  const pageUnit = pdfModeOf(gl.filter((g) => g.ch !== ' ' && g.adv > 0).map((g) => g.adv), 0.05);
  const x0 = Math.min(...gl.map((g) => g.x));
  const lines = [];
  for (const r of rows) {
    r.glyphs.sort((p, q) => p.x - q.x);
    const own = pdfModeOf(r.glyphs.filter((g) => g.ch !== ' ' && g.adv > 0).map((g) => g.adv), 0.05);
    const unit = own && pageUnit && Math.abs(own - pageUnit) / pageUnit < 0.04 ? pageUnit : own || pageUnit || 1;
    const cells = [];
    let prev = -1;
    for (const g of r.glyphs) {
      let col = Math.round((g.x - x0) / unit);
      if (col <= prev) col = prev + 1;
      if (g.ch === ' ') { prev = col; continue; }
      cells[col] = g.ch;
      prev = col;
    }
    let text = '';
    for (let i = 0; i < cells.length; i++) text += cells[i] === undefined ? ' ' : cells[i];
    lines.push({ text: text.replace(/\s+$/, ''), y: r.y, size: r.size, unit });
  }
  return lines.filter((l) => l.text !== '');
}

function pdfTitleOf(info) {
  return info && info.Title instanceof PdfStr ? pdfDecodeText(info.Title.bytes) : '';
}

function pdfDecodeText(bytes) {
  if (bytes[0] === 254 && bytes[1] === 255) return pdfUtf16be(bytes.subarray(2));
  let s = '';
  for (const c of bytes) s += String.fromCharCode(c);
  return s;
}

// Reads the text of a PDF. `bytes`: Uint8Array / ArrayBuffer. Rejects with a readable (Italian) message when the file
// cannot be read (not a PDF, encrypted, no DecompressionStream).
export async function readPdfText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || pdfIndexOf(bytes, '%PDF-', 0, Math.min(bytes.length, 1024)) < 0) throw new Error('Il file non è un PDF');
  if (!inflateSupported()) throw new Error('Questo browser non sa leggere i PDF (manca DecompressionStream). Incolla il testo della tab');
  const doc = new PdfDoc(bytes);
  await doc.load();
  if (doc.trailer.Encrypt) throw new Error('Il PDF è protetto da password: non posso leggerlo. Incolla il testo della tab');
  const root = await doc.dictOf(doc.trailer.Root);
  const pageNodes = [];
  if (root) await pdfCollectPages(doc, root.Pages, null, pageNodes);
  if (!pageNodes.length) throw new Error('Nessuna pagina trovata nel PDF');
  const warnings = [...doc.warnings];
  const pages = [];
  const fontCache = new Map();
  for (const pn of pageNodes) {
    const glyphs = [];
    try {
      let contents = await doc.resolve(pn.dict.Contents);
      if (!Array.isArray(contents)) contents = [contents];
      const parts = [];
      for (const c of contents) {
        const st = await doc.resolve(c);
        if (st instanceof PdfStream) parts.push(await doc.decodeStream(st));
      }
      const total = parts.reduce((s, p) => s + p.length + 1, 0);
      const data = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { data.set(p, o); o += p.length; data[o++] = 10; }
      const res = await doc.dictOf(pn.resources);
      await pdfRunContent(doc, data, res, [1, 0, 0, 1, 0, 0], glyphs, fontCache, 0);
    } catch (err) {
      warnings.push(`Pagina ${pages.length + 1}: ${err.message}`);
    }
    pages.push({ lines: glyphsToLines(glyphs) });
  }
  const lines = [];
  pages.forEach((p, pi) => {
    let prev = null;
    for (const l of p.lines) {
      // an empty line where the gap is bigger than a line
      if (prev && prev.y - l.y > 1.9 * Math.min(prev.size, l.size) * 1.0 && lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(l.text);
      prev = l;
    }
    if (pi < pages.length - 1 && lines.length && lines[lines.length - 1] !== '') lines.push('');
  });
  const info = await doc.dictOf(doc.trailer.Info);
  return { title: pdfTitleOf(info), pages, lines, text: lines.join('\n'), warnings, medianUnit: pdfMedian(pages.flatMap((p) => p.lines.map((l) => l.unit))) };
}
