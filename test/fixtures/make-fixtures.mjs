// Generates the synthetic .mht fixtures. All text is invented (no real song lyrics).
// Run with: npm run fixtures
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'synthetic');
mkdirSync(OUT, { recursive: true });

const TITLE = 'Città di Carta';
const ARTIST = 'Gruppo Immaginario';
const BOUNDARY = '----MultipartBoundary--SyntheticFixtureBoundary0123456789----';
const AD_MARKER = 'ADVERTISEMENTMARKER';

// Chord lines use {X} markers; "*" after a marker is an annotation outside the span.
const SONG = [
  ['Intro', [['{Am}   {F}   {C}   {G} *', null]]],
  ['Verse 1', [
    [' ', 'blank'],
    ['{Am}          {F}', 'Il gatto scrive numeri sul tetto'],
    ['{C}      {G}*', 'e la città dorme sotto un ombrello'],
    ['AD', 'ad'],
    ['{Am}      {F}          {C}', 'ogni finestra ha un nome di fantasia'],
    ['{G}', null],
  ]],
  ['Chorus', [
    ['{F}     {C}    {G}', 'Canta con me, canta piano'],
    ['{Am}   {F}   {C} * {G}', 'la strada è lunga ma il passo è leggero'],
  ]],
  ['Verse 2', [
    ['{Am}         {F}', 'Una bicicletta senza ruote'],
    ['{C}     {G}', 'racconta storie al lampione stanco'],
    ['{Am}', 'più di così non so dire'],
  ]],
  ['Chorus', [
    ['{F}     {C}    {G}', 'Canta con me, canta piano'],
    ['{Am}   {F}   {C} * {G}', 'la strada è lunga ma il passo è leggero'],
  ]],
  ['Outro', [['{Am}  {F}  {Am}', null]]],
];

const STRUM = [
  { name: 'Verse 1', bpm: 70, cells: 'D D D - D - D - D - D - - - - -'.split(' ') },
  { name: 'Chorus', bpm: 104, cells: 'D U D U D U D U'.split(' ') },
  { name: 'Verse 2 onwards', bpm: 128, cells: 'D U D U D U D U'.split(' ') },
];

function adLine() {
  const filler = 'x'.repeat(20000);
  return `<div class="js-ab-regular"><bidding-wrapper id="b1"><bidding-unit data-x="1"><div class="inner"><div>${AD_MARKER} acquista adesso</div>` +
    `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><svg width="10" height="10"><path d="M0 0L10 10"/></svg>` +
    `<div style="a:b">${filler}</div></div></bidding-unit></bidding-wrapper></div>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function chordLine(template, spans) {
  return template.replace(/\{([^}]+)\}/g, (w, name) =>
    spans ? `<span class="tabContent-chord js-chord-chord" data-original-chord="${name}">${name}</span>` : name);
}

function preContent({ spans }) {
  const out = [];
  for (const [name, lines] of SONG) {
    out.push(`[${name}]`);
    for (const [a, b] of lines) {
      if (b === 'blank') out.push(a);
      else if (b === 'ad') out.push(adLine());
      else if (b === null) out.push(chordLine(a, spans));
      else {
        out.push(chordLine(a, spans));
        out.push(escapeHtml(b));
      }
    }
    out.push('');
  }
  return out.join('\n');
}

function strumHtml() {
  const arts = STRUM.map((s) => {
    const cells = s.cells.map((c, i) => {
      const cls = ['strumming-beat'];
      if (c === 'D') cls.push('strumming-down');
      if (c === 'U') cls.push('strumming-up');
      if (i % 2 === 0) cls.push('strumming-footer', 'strumming-footer-4');
      return `<div class="${cls.join(' ')}">${i + 1}</div>`;
    }).join('');
    return `<article class="strumming-section strumming-mobileSection"><header class="strumming-header"><button type="button" class="strumming-buttonPlay"><svg viewBox="0 0 16 16"><path d="M0 0"/></svg><span class="buttonElement-label buttonElement-inverted">${s.name}</span><span class="strumming-bpm strumming-mobileBpm"> ${s.bpm} bpm</span></button></header><section class="strumming-beats">${cells}</section></article>`;
  });
  return `<section class="strumming-container">${arts.join('')}</section>`;
}

function carouselHtml() {
  const names = ['Am', 'F', 'C', 'G'];
  return '<div class="chordCarousel-wrap">' + names.map((n) =>
    `<div class="chordCarousel-chord"><header class="chordCarousel-header"><span class="chordCarousel-highlighted">${n}</span></header></div>`).join('') + '</div>';
}

function pageHtml({ spans = true, strum = true } = {}) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${TITLE} Chords by ${ARTIST} @ Ultimate-Guitar.Com</title>
<style>.tabHeader-h1 { display: inline; } .strumming-section { margin: 0; }</style>
<script>window.__x = "<pre>not a song</pre>";</script></head>
<body><nav class="top"><a href="/">Home</a><pre>nav noise</pre></nav>
<main class="tab-page"><article>
<section class="tabHeader-section"><header class="tabHeader-title"><h1 class="tabHeader-h1">${TITLE} Chords by <span class="tabHeader-h2"><a class="link-link" href="/artist/x">${ARTIST}</a></span></h1></header>
<ul class="tabHeader-info">
<li class="tabHeader-item"><span class="tabHeader-name">Rating: </span> 4.5 / 5</li>
<li class="tabHeader-item"><span class="tabHeader-name">Difficulty: </span>Beginner            </li>
<li class="tabHeader-item"><span class="tabHeader-name">Tuning: </span>
<a href="/tools/tuner" class="link-link">E A D G B E</a>
</li>
</ul></section>
${strum ? strumHtml() : ''}
${carouselHtml()}
<section class="tab-content"><code class="js-tab-content tabContent-code "><pre class="extra">${preContent({ spans })}</pre><span class="js-hidden-char tabContent-char">X</span></code></section>
</article></main><footer><pre>footer
noise</pre></footer></body></html>`;
}

function qpEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '';
  let lineLen = 0;
  const push = (token) => {
    if (lineLen + token.length > 75) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += token;
    lineLen += token.length;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 10) {
      out += '\r\n';
      lineLen = 0;
    } else if (b === 13) {
      continue;
    } else if ((b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && bytes[i + 1] !== 10 && i + 1 < bytes.length)) {
      push(String.fromCharCode(b));
    } else {
      push('=' + b.toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return out;
}

function base64Wrapped(str) {
  const b64 = Buffer.from(str, 'utf-8').toString('base64');
  return b64.match(/.{1,76}/g).join('\r\n');
}

function mime({ html, encoding, subject }) {
  const encodedBody = encoding === 'quoted-printable' ? qpEncode(html)
    : encoding === 'base64' ? base64Wrapped(html)
    : html;
  const nl = encoding === 'binary' ? '\n' : '\r\n';
  const head = [
    'From: <Saved by Blink>',
    'Snapshot-Content-Location: https://example.invalid/tab/gruppo-immaginario/citta-di-carta-chords-1',
    `Subject: ${subject}`,
    'Date: Tue, 24 Nov 2026 18:54:25 GMT',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related;',
    '\ttype="text/html";',
    `\tboundary="${BOUNDARY}"`,
  ].join(nl);
  const htmlPart = [
    `--${BOUNDARY}`,
    'Content-Type: text/html' + (encoding === 'binary' ? '' : '; charset="utf-8"'),
    'Content-ID: <frame-0001@mhtml.blink>',
    `Content-Transfer-Encoding: ${encoding}`,
    'Content-Location: https://example.invalid/tab/gruppo-immaginario/citta-di-carta-chords-1',
    '',
    encodedBody,
  ].join(nl);
  const cssPart = [`--${BOUNDARY}`, 'Content-Type: text/css', 'Content-Transfer-Encoding: binary', 'Content-Location: https://example.invalid/a.css', '', 'body { color: #000; }'].join(nl);
  const imgPart = [`--${BOUNDARY}`, 'Content-Type: image/gif', 'Content-Transfer-Encoding: base64', 'Content-Location: https://example.invalid/a.gif', '', 'R0lGODlhAQABAAAAACw='].join(nl);
  return [head, '', htmlPart, cssPart, imgPart, `--${BOUNDARY}--`, ''].join(nl);
}

const SUBJECT_PLAIN = `${TITLE.toUpperCase()} CHORDS (ver 2) by ${ARTIST} @ Ultimate-Guitar.Com`;
function encodeWordQ(str) {
  const body = [...new TextEncoder().encode(str)].map((b) => (b === 32 ? '_' : (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0'))).join('');
  return `=?utf-8?Q?${body}?=`;
}
// Two encoded words (Q and B) to exercise RFC 2047 joining.
const SUBJECT_ENCODED = encodeWordQ(SUBJECT_PLAIN.slice(0, 20)) + ' =?utf-8?B?' + Buffer.from(SUBJECT_PLAIN.slice(20), 'utf-8').toString('base64') + '?=';

const files = {
  'song-binary.mht': mime({ html: pageHtml(), encoding: 'binary', subject: SUBJECT_PLAIN }),
  'song-qp.mht': mime({ html: pageHtml(), encoding: 'quoted-printable', subject: SUBJECT_ENCODED }),
  'song-base64.mht': mime({ html: pageHtml(), encoding: 'base64', subject: SUBJECT_PLAIN }),
  'song-nospans.mht': mime({ html: pageHtml({ spans: false }), encoding: 'binary', subject: SUBJECT_PLAIN }),
  'song-nostrum.mht': mime({ html: pageHtml({ strum: false }), encoding: 'binary', subject: SUBJECT_PLAIN }),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content, 'utf-8');
console.log('Wrote', Object.keys(files).length, 'fixtures to', OUT);
