// MHTML / MIME decoding (pure; uses TextDecoder, atob and TextEncoder, available in Node 22 and browsers).

function makeDecoder(charset) {
  try {
    return new TextDecoder(charset || 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

function hexVal(c) {
  return /^[0-9a-fA-F]$/.test(c) ? parseInt(c, 16) : -1;
}

export function decodeQuotedPrintable(str, charset = 'utf-8') {
  const src = str.replace(/=\r?\n/g, '');
  const enc = new TextEncoder();
  const bytes = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '=' && hexVal(src[i + 1] ?? '') >= 0 && hexVal(src[i + 2] ?? '') >= 0) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (ch.charCodeAt(0) < 128) {
      bytes.push(ch.charCodeAt(0));
    } else {
      // Already-decoded non-ASCII character in the source: keep it as UTF-8.
      const cp = src.codePointAt(i);
      for (const b of enc.encode(String.fromCodePoint(cp))) bytes.push(b);
      if (cp > 0xffff) i++;
    }
  }
  return makeDecoder(charset).decode(Uint8Array.from(bytes));
}

export function decodeBase64(str, charset = 'utf-8') {
  const clean = str.replace(/[^A-Za-z0-9+/_=-]/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bin;
  try {
    bin = atob(clean);
  } catch {
    throw new Error('Il file contiene dati base64 non validi');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return makeDecoder(charset).decode(bytes);
}

export function decodeEncodedWords(str) {
  if (!str || !str.includes('=?')) return str;
  // Whitespace between two adjacent encoded words is dropped (RFC 2047).
  const joined = str.replace(/(\?=)\s+(?==\?)/g, '$1');
  return joined.replace(/=\?([^?\s]+)\?([QqBb])\?([^?]*)\?=/g, (whole, charset, enc, text) => {
    try {
      const cs = charset.split('*')[0];
      if (enc.toUpperCase() === 'B') return decodeBase64(text, cs);
      return decodeQuotedPrintable(text.replace(/_/g, ' '), cs);
    } catch {
      return whole;
    }
  });
}

function parseHeaderBlock(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    if (!(name in headers)) headers[name] = line.slice(idx + 1).trim();
  }
  return headers;
}

function splitHeadBody(text) {
  if (/^\r?\n/.test(text)) return { head: '', body: text.replace(/^\r?\n/, '') };
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return { head: text, body: '' };
  return { head: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

function paramOf(headerValue, name) {
  if (!headerValue) return null;
  const re = new RegExp('(?:^|[;\\s])' + name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i');
  const m = re.exec(headerValue);
  return m ? (m[1] ?? m[2]) : null;
}

function decodeBody(body, headers, charset) {
  const cte = (headers['content-transfer-encoding'] || '7bit').toLowerCase();
  if (cte === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  if (cte === 'base64') return decodeBase64(body, charset);
  return body; // binary, 8bit, 7bit: the file was already read as text
}

function makePart(head, body) {
  const headers = parseHeaderBlock(head);
  const contentType = (headers['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase();
  const charset = paramOf(headers['content-type'], 'charset') || 'utf-8';
  const isText = /^text\//.test(contentType) || contentType.includes('xml') || contentType.includes('json');
  let decoded = '';
  if (isText) {
    try {
      decoded = decodeBody(body, headers, charset);
    } catch {
      decoded = body;
    }
  }
  return { headers, contentType, charset, location: headers['content-location'] || '', body: decoded };
}

export function parseMht(text) {
  const normalized = text.replace(/^﻿/, '');
  const { head, body } = splitHeadBody(normalized);
  const headers = parseHeaderBlock(head);
  const ct = headers['content-type'] || '';
  const boundary = paramOf(ct, 'boundary');
  const parts = [];
  if (/^multipart\//i.test(ct) && boundary) {
    const chunks = body.split('--' + boundary);
    // chunks[0] is the preamble; the closing delimiter is followed by "--".
    for (let i = 1; i < chunks.length; i++) {
      let chunk = chunks[i];
      if (chunk.startsWith('--')) break;
      chunk = chunk.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, '');
      const hb = splitHeadBody(chunk);
      parts.push(makePart(hb.head, hb.body));
    }
  } else {
    parts.push(makePart(head, body));
  }
  return { headers, parts };
}

function looksLikeMime(text) {
  const start = text.replace(/^﻿/, '').slice(0, 4000);
  if (/^\s*</.test(start)) return false;
  return /^(?:MIME-Version|Content-Type):/im.test(start);
}

export function extractMainHtml(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Il file è vuoto');
  }
  if (!looksLikeMime(text)) {
    return { html: text, subject: '', url: '' };
  }
  const mht = parseMht(text);
  const part = mht.parts.find((p) => p.contentType === 'text/html' && p.body.trim() !== '');
  if (!part) throw new Error('Il file non contiene una pagina HTML');
  const subject = decodeEncodedWords(mht.headers.subject || '');
  const url = mht.headers['snapshot-content-location'] || part.location || '';
  return { html: part.body, subject, url };
}
