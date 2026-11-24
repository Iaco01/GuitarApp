// Pure string helpers for working with serialized HTML (no DOM, runs in Node).

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Egrave: 'È', Eacute: 'É', Agrave: 'À',
};

export function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

// Removes every tag; the input must have balanced angle brackets.
export function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

// Visible text of an HTML fragment: tags removed, entities decoded.
export function visibleText(html) {
  return decodeEntities(stripTags(html));
}

export function collapseSpaces(str) {
  return str.replace(/[\s\u00a0]+/g, ' ').trim();
}

// Returns the value of an attribute inside a single opening tag string, or null.
export function getAttr(tag, name) {
  const re = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
}

export function classTokens(tag) {
  const cls = getAttr(tag, 'class');
  return cls ? cls.split(/\s+/).filter(Boolean) : [];
}

// Given the index of an opening tag `<name ...>` in html, returns the index just after the
// matching `</name>` (counting nested elements of the same name), or -1 if unbalanced.
export function findElementEnd(html, openIdx, tagName) {
  const open = html.indexOf('>', openIdx);
  if (open === -1) return -1;
  if (html[open - 1] === '/') return open + 1;
  const re = new RegExp('<(/?)' + tagName + '(?=[\\s>/])', 'gi');
  re.lastIndex = open + 1;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      depth--;
      if (depth === 0) {
        const close = html.indexOf('>', m.index);
        return close === -1 ? -1 : close + 1;
      }
    } else {
      const gt = html.indexOf('>', m.index);
      if (gt !== -1 && html[gt - 1] !== '/') depth++;
    }
  }
  return -1;
}

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);

// Removes whole elements (with their content, nesting-aware) whose tag name matches `nameRe`.
export function removeElements(html, nameRe) {
  const openRe = new RegExp('<(' + nameRe.source + ')(?=[\\s>/])[^>]*>', 'gi');
  let out = '';
  let pos = 0;
  openRe.lastIndex = 0;
  let m;
  while ((m = openRe.exec(html))) {
    if (m.index < pos) continue;
    const name = m[1].toLowerCase();
    let end = m.index + m[0].length;
    if (!VOID_TAGS.has(name) && !m[0].endsWith('/>')) {
      const e = findElementEnd(html, m.index, name);
      if (e !== -1) end = e;
    }
    out += html.slice(pos, m.index);
    pos = end;
    openRe.lastIndex = end;
  }
  return out + html.slice(pos);
}
