// Ultimate Guitar page HTML -> Song (pure, string based, no DOM).

import { visibleText, collapseSpaces, getAttr, classTokens, findElementEnd, removeElements } from './html-text.js';
import { extractMainHtml } from './mht.js';
import { isChordName } from './chord.js';
import { createSong, listChordNames } from './model.js';

const CHORD_CLASS_RE = /js-chord-chord|tabContent-chord/;
const ADS_ELEMENTS_RE = /div|bidding-[a-z0-9-]+|img|svg|script|style|iframe|noscript|ins/;
const SPAN_OPEN_RE = /<span\b[^>]*>/gi;
const ANNOTATION_TOKEN_RE = /^(?:\*+|\||-+|\(|\)|x\d+|\(x\d+\)|\d+x|\(\d+x\)|n\.?c\.?|\/|\.+)$/i;

// ---- <pre> isolation ------------------------------------------------------

function findPreInner(html) {
  const marker = /class\s*=\s*"[^"]*\bjs-tab-content\b[^"]*"/.exec(html);
  if (marker) {
    const preIdx = html.indexOf('<pre', marker.index);
    if (preIdx !== -1) {
      const inner = preInnerAt(html, preIdx);
      if (inner !== null) return inner;
    }
  }
  // Fallback: the longest <pre> of the page.
  let best = null;
  let from = 0;
  for (;;) {
    const idx = html.indexOf('<pre', from);
    if (idx === -1) break;
    const inner = preInnerAt(html, idx);
    if (inner !== null && (best === null || inner.length > best.length)) best = inner;
    from = idx + 4;
  }
  return best;
}

function preInnerAt(html, preIdx) {
  const openEnd = html.indexOf('>', preIdx);
  if (openEnd === -1) return null;
  const end = findElementEnd(html, preIdx, 'pre');
  if (end === -1) return null;
  const closeStart = html.lastIndexOf('</pre', end);
  return html.slice(openEnd + 1, closeStart);
}

// ---- line analysis --------------------------------------------------------

function isBlank(text) {
  return text.replace(/[\s ]+/g, '') === '';
}

// Splits a line of annotation text into tokens; returns null if some token is not an annotation.
function annotationTokens(text) {
  const tokens = text.split(/[\s ]+/).filter(Boolean);
  for (const t of tokens) if (!ANNOTATION_TOKEN_RE.test(t)) return null;
  return tokens;
}

// Analyses a line when chord spans are present. Returns { chords, text } where `chords` is the
// list of { name, col, mark? } or null if the line is not a chord line.
function analyseSpanLine(line) {
  const chords = [];
  let visible = '';
  let outside = []; // text pieces outside chord spans, with the chord index they follow
  let pos = 0;
  SPAN_OPEN_RE.lastIndex = 0;
  let m;
  let mixedText = false;
  while ((m = SPAN_OPEN_RE.exec(line))) {
    const tag = m[0];
    const cls = getAttr(tag, 'class') || '';
    const isChord = CHORD_CLASS_RE.test(cls) || getAttr(tag, 'data-original-chord') !== null || getAttr(tag, 'data-name') !== null;
    if (!isChord) continue;
    const end = findElementEnd(line, m.index, 'span');
    if (end === -1) continue;
    const before = visibleText(line.slice(pos, m.index));
    visible += before;
    if (before) outside.push({ after: chords.length - 1, text: before });
    const inner = visibleText(line.slice(m.index + tag.length, end));
    const name = (getAttr(tag, 'data-original-chord') ?? getAttr(tag, 'data-name') ?? inner).trim();
    chords.push({ name, col: visible.length });
    visible += inner;
    pos = end;
    SPAN_OPEN_RE.lastIndex = end;
  }
  const tail = visibleText(line.slice(pos));
  visible += tail;
  if (tail) outside.push({ after: chords.length - 1, text: tail });
  if (chords.length === 0) return null;
  for (const piece of outside) {
    if (isBlank(piece.text)) continue;
    const tokens = annotationTokens(piece.text);
    if (!tokens) {
      mixedText = true;
      break;
    }
    if (piece.after >= 0) {
      const c = chords[piece.after];
      c.mark = c.mark ? c.mark + ' ' + tokens.join(' ') : tokens.join(' ');
    }
  }
  if (mixedText) return { chords: null, text: visible };
  return { chords, text: visible };
}

// Fallback analysis on plain text: every word must be a chord (optionally followed by marks).
function analyseTextLine(text) {
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) words.push({ word: m[0], col: m.index });
  if (words.length === 0) return null;
  const chords = [];
  for (const { word, col } of words) {
    const mm = /^(.*?)(\*+)?$/.exec(word);
    const base = mm[1];
    if (base !== '' && isChordName(base)) {
      const c = { name: base, col };
      if (mm[2]) c.mark = mm[2];
      chords.push(c);
    } else if (ANNOTATION_TOKEN_RE.test(word)) {
      if (chords.length > 0 && /^\*+$/.test(word)) {
        const last = chords[chords.length - 1];
        last.mark = last.mark ? last.mark + ' ' + word : word;
      }
    } else {
      return null;
    }
  }
  return chords.length > 0 ? chords : null;
}

// ---- metadata -------------------------------------------------------------

function titleCaseIfShouting(str) {
  if (str !== str.toUpperCase() || str === str.toLowerCase()) return str;
  return str.toLowerCase().replace(/(^|[\s(\-"'])([a-zà-ù])/g, (w, a, b) => a + b.toUpperCase());
}

const TYPE_WORDS = '(?:ukulele|bass|power|guitar|pro|official|chords?|tabs?|tab)';

function stripTypeSuffix(title) {
  let t = title.trim();
  t = t.replace(/\s+by\s*$/i, '');
  for (let i = 0; i < 4; i++) {
    const next = t.replace(new RegExp('\\s*\\((?:ver(?:sion)?\\.?\\s*\\d+)\\)\\s*$', 'i'), '')
      .replace(new RegExp('\\s+' + TYPE_WORDS + '\\s*$', 'i'), '')
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function parseSubject(subject) {
  if (!subject) return null;
  const m = /^(.*?)\s+(?:(?:ukulele|bass|power|guitar|pro|official)\s+)*(?:chords?|tabs?)(?:\s*\(ver(?:sion)?\.?\s*\d+\))?\s+by\s+(.*?)\s*(?:@\s*Ultimate-Guitar\.Com)?\s*$/i.exec(subject.trim());
  if (!m) return null;
  return { title: titleCaseIfShouting(m[1].trim()), artist: m[2].trim() };
}

function parseHeading(html) {
  const h1Idx = html.search(/<h1\b[^>]*class\s*=\s*"[^"]*tabHeader-h1/i);
  if (h1Idx === -1) return null;
  const end = findElementEnd(html, h1Idx, 'h1');
  if (end === -1) return null;
  const h1 = html.slice(h1Idx, end);
  const h2Idx = h1.search(/<[a-z0-9]+\b[^>]*class\s*=\s*"[^"]*tabHeader-h2/i);
  let artist = '';
  let titlePart = h1;
  if (h2Idx !== -1) {
    const tagName = /^<([a-z0-9]+)/i.exec(h1.slice(h2Idx))[1];
    const h2End = findElementEnd(h1, h2Idx, tagName);
    artist = collapseSpaces(visibleText(h1.slice(h2Idx, h2End === -1 ? undefined : h2End)));
    titlePart = h1.slice(0, h2Idx);
  }
  const title = stripTypeSuffix(collapseSpaces(visibleText(titlePart)));
  if (!title) return null;
  return { title, artist };
}

function parseTitleTag(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const text = collapseSpaces(visibleText(m[1]));
  return parseSubject(text) || (text ? { title: stripTypeSuffix(text), artist: '' } : null);
}

// Value following a `tabHeader-name` label such as "Difficulty:".
function headerValue(html, label) {
  const re = new RegExp('<span[^>]*class\\s*=\\s*"[^"]*tabHeader-name[^"]*"[^>]*>\\s*' + label + '\\s*:?\\s*</span>', 'i');
  const m = re.exec(html);
  if (!m) return null;
  const rest = html.slice(m.index + m[0].length, m.index + m[0].length + 1500);
  const stop = rest.search(/<span[^>]*tabHeader-name|<\/li>|<\/tr>|<\/div>|<\/dd>|<\/td>/i);
  const value = collapseSpaces(visibleText(stop === -1 ? rest : rest.slice(0, stop)));
  return value || null;
}

function parseCapo(value) {
  if (value === null) return 0;
  if (/no\s*capo/i.test(value)) return 0;
  const m = /(\d+)/.exec(value);
  return m ? parseInt(m[1], 10) : 0;
}

function parseStrumming(html) {
  const out = [];
  const openRe = /<([a-z0-9]+)\b[^>]*class\s*=\s*"[^"]*"[^>]*>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    if (!classTokens(m[0]).includes('strumming-section')) continue;
    const end = findElementEnd(html, m.index, m[1]);
    if (end === -1) continue;
    const block = html.slice(m.index, end);
    openRe.lastIndex = end;
    const labelM = /<span[^>]*class\s*=\s*"[^"]*buttonElement-label[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const bpmM = /<span[^>]*class\s*=\s*"[^"]*strumming-bpm[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const bpmNum = bpmM ? /(\d+(?:[.,]\d+)?)/.exec(visibleText(bpmM[1])) : null;
    const beats = [];
    const cellRe = /<div\b[^>]*class\s*=\s*"([^"]*)"[^>]*>/gi;
    let c;
    while ((c = cellRe.exec(block))) {
      const toks = c[1].split(/\s+/);
      if (!toks.includes('strumming-beat')) continue;
      beats.push({
        dir: toks.includes('strumming-down') ? 'D' : toks.includes('strumming-up') ? 'U' : '',
        onBeat: toks.includes('strumming-footer'),
      });
    }
    if (beats.length === 0) continue;
    out.push({
      section: labelM ? collapseSpaces(visibleText(labelM[1])) : '',
      bpm: bpmNum ? parseFloat(bpmNum[1].replace(',', '.')) : null,
      beats,
    });
  }
  return out;
}

function carouselChords(html) {
  const out = [];
  const re = /<span[^>]*class\s*=\s*"[^"]*chordCarousel-highlighted[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = collapseSpaces(visibleText(m[1]));
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// ---- main -----------------------------------------------------------------

export function parseSong({ html, subject = '', url = '' }) {
  const warnings = [];
  const rawPre = findPreInner(html);
  if (rawPre === null) throw new Error('Non trovo il testo con gli accordi in questa pagina');

  const cleanPre = removeElements(rawPre, ADS_ELEMENTS_RE).replace(/\r\n?/g, '\n');
  const hasSpans = /js-chord-chord|tabContent-chord|data-original-chord/.test(cleanPre);
  const method = hasSpans ? 'spans' : 'text-fallback';

  const rows = cleanPre.split('\n').map((line) => {
    if (hasSpans) {
      const a = analyseSpanLine(line);
      if (a && a.chords) return { kind: 'chords', chords: a.chords };
      const t = a ? a.text : visibleText(line);
      return classifyText(t);
    }
    const text = visibleText(line);
    const chords = analyseTextLine(text);
    return chords ? { kind: 'chords', chords } : classifyText(text);
  });

  function classifyText(t) {
    if (isBlank(t)) return { kind: 'blank' };
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(t.replace(/ /g, ' '));
    if (h) return { kind: 'header', name: h[1].trim() };
    return { kind: 'text', text: t.replace(/ /g, ' ').replace(/\s+$/, '') };
  }

  const sections = [];
  let current = null;
  const ensureSection = (name) => {
    current = { name, lines: [] };
    sections.push(current);
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === 'blank') continue;
    if (row.kind === 'header') {
      ensureSection(row.name);
      continue;
    }
    if (!current) ensureSection('');
    if (row.kind === 'chords') {
      const next = rows[i + 1];
      if (next && next.kind === 'text') {
        current.lines.push({ lyric: next.text, chords: row.chords.map(finishChord) });
        i++;
      } else {
        current.lines.push({ lyric: '', chords: row.chords.map(finishChord) });
      }
    } else {
      current.lines.push({ lyric: row.text, chords: [] });
    }
  }
  const finalSections = sections.filter((s) => s.name !== '' || s.lines.length > 0);

  // Metadata lives outside the <pre>.
  const pagePreStripped = html.replace(rawPre, '');
  const heading = parseHeading(pagePreStripped);
  const fromSubject = parseSubject(subject);
  const fromTitleTag = parseTitleTag(pagePreStripped);
  const names = heading || fromSubject || fromTitleTag || { title: '', artist: '' };
  const title = names.title || (fromSubject && fromSubject.title) || 'Senza titolo';
  const artist = names.artist || (fromSubject && fromSubject.artist) || '';

  const strumming = parseStrumming(pagePreStripped);
  const bpm = strumming.map((s) => s.bpm).find((b) => b !== null && b > 0) ?? null;

  const song = createSong({
    title,
    artist,
    difficulty: headerValue(pagePreStripped, 'Difficulty'),
    tuning: headerValue(pagePreStripped, 'Tuning'),
    capo: parseCapo(headerValue(pagePreStripped, 'Capo')),
    key: headerValue(pagePreStripped, 'Key'),
    bpm,
    strumming,
    sections: finalSections,
    importInfo: { method, warnings },
  });
  song.chords = listChordNames(song);

  if (song.chords.length === 0) warnings.push('Nel brano non sono stati trovati accordi');
  const carousel = carouselChords(pagePreStripped);
  if (carousel.length > 0 && carousel.join(' ') !== [...song.chords].sort((a, b) => carousel.indexOf(a) - carousel.indexOf(b)).join(' ')) {
    const missing = carousel.filter((c) => !song.chords.includes(c));
    const extra = song.chords.filter((c) => !carousel.includes(c));
    if (missing.length || extra.length) {
      warnings.push(`L'elenco accordi della pagina differisce da quello trovato nel testo (mancanti: ${missing.join(' ') || '-'}, in più: ${extra.join(' ') || '-'})`);
    }
  }
  if (strumming.length === 0) warnings.push('Ritmo e BPM non trovati nella pagina');
  return song;
}

function finishChord(c) {
  const out = { name: c.name, col: c.col, beats: 4 };
  if (c.mark) out.mark = c.mark;
  return out;
}

export function parseSongFromMht(text) {
  return parseSong(extractMainHtml(text));
}
