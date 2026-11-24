// Robustness probes for the parser (invented text only). Run: node test/e2e/parser-robustness.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { parseSongFromMht } from '../../src/parser.js';

let fails = 0;
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + (i ? '  ' + i : '')); if (!ok) fails++; };
const tryParse = (text) => { try { return { song: parseSongFromMht(text) }; } catch (e) { return { err: e }; } };
const readable = (e) => e instanceof Error && typeof e.message === 'string' && e.message.length > 5 && !/undefined|TypeError|Cannot read/.test(e.message) && !(e instanceof TypeError) && !(e instanceof RangeError);

// 1. Synthetic variants agree with each other
const dir = new URL('../fixtures/synthetic/', import.meta.url);
const sums = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mht'))) {
  const r = tryParse(readFileSync(new URL(f, dir), 'utf-8'));
  check('synthetic ' + f + ' parses', !!r.song, r.err && r.err.message);
  if (r.song) sums[f] = [r.song.title, r.song.sections.length, r.song.chords.join(' '), r.song.sections.flatMap((s) => s.lines).flatMap((l) => l.chords).length].join('|');
}
check('all synthetic variants give the same summary', new Set(Object.values(sums)).size === 1, JSON.stringify(sums));

// 2. Bad input must give readable errors (or an honest empty-ish song), never a crash
const mk = (html, enc = '8bit') => `From: <Saved by Blink>\nSubject: Test Song CHORDS by Nobody @ Ultimate-Guitar.Com\nMIME-Version: 1.0\nContent-Type: multipart/related; type="text/html"; boundary="BND"\n\n--BND\nContent-Type: text/html\nContent-Transfer-Encoding: ${enc}\nContent-Location: https://example.invalid/x\n\n${html}\n--BND--\n`;
const goodPre = '<pre class="x">[Verse 1]\n<span class="tabContent-chord js-chord-chord" data-original-chord="Am">Am</span>   <span class="tabContent-chord js-chord-chord" data-original-chord="F">F</span>\nhello there world\n</pre>';
const wrap = (pre) => `<html><head><title>x</title></head><body><code class="js-tab-content">${pre}</code></body></html>`;
const cases = {
  empty: '',
  whitespace: '   \n\n  ',
  randomTxt: 'Lorem ipsum dolor sit amet.\nAm F C G\nnot a page at all',
  binaryGarbage: String.fromCharCode(...Array.from({ length: 3000 }, (_, i) => (i * 7919) % 256)),
  truncatedMht: mk(wrap(goodPre)).slice(0, 180),
  truncatedMidSpan: mk(wrap(goodPre)).slice(0, mk(wrap(goodPre)).indexOf('data-original-chord="F"') + 10),
  noPre: mk('<html><body><h1>hi</h1><p>nothing</p></body></html>'),
  unclosedPre: mk('<html><body><pre>[A]\nAm  F\nhello world'),
  onlyBoundaryNoHtml: 'Content-Type: multipart/related; boundary="B"\n\n--B\nContent-Type: image/png\nContent-Transfer-Encoding: base64\n\niVBORw0KGgo=\n--B--\n',
  badBase64: mk('@@@@not-base64@@@@', 'base64'),
  badQP: mk('=ZZ=4 broken =\n=E2=82', 'quoted-printable'),
  preEmpty: mk(wrap('<pre></pre>')),
  preOnlyAd: mk(wrap('<pre><div class="js-ab-regular">ad</div></pre>')),
  hugeLine: mk(wrap('<pre>' + 'Am '.repeat(200000) + '\nxx</pre>')),
  deepNest: mk(wrap('<pre>' + '<div>'.repeat(50000) + 'x' + '</div>'.repeat(50000) + '</pre>')),
  manySpansUnclosed: mk(wrap('<pre>' + '<span class="tabContent-chord js-chord-chord">'.repeat(20000) + '</pre>')),
  weirdBoundary: 'Content-Type: multipart/related; boundary=\n\n--\n',
};
for (const [name, text] of Object.entries(cases)) {
  const t0 = Date.now();
  const r = tryParse(text);
  const dt = Date.now() - t0;
  if (r.err) check(`bad input "${name}" -> readable error`, readable(r.err), `${r.err.constructor.name}: ${r.err.message.slice(0, 80)} (${dt}ms)`);
  else check(`bad input "${name}" -> no crash`, !!r.song && Array.isArray(r.song.sections), `sections=${r.song.sections.length} chords=${r.song.chords.length} warnings=${r.song.importInfo.warnings.length} (${dt}ms)`);
  check(`  "${name}" fast (<2s)`, dt < 2000, dt + 'ms');
}

// 3. Plain HTML (non-MIME) and edge-case content
let r = tryParse(wrap(goodPre));
check('plain .html import works', !!r.song && r.song.chords.join(' ') === 'Am F', r.err && r.err.message);
// entities, inline chords, odd chord names, annotations
const odd = wrap(`<pre>[Intro]
<span class="tabContent-chord js-chord-chord" data-original-chord="C#m7/G#">C#m7/G#</span>  <span class="tabContent-chord js-chord-chord" data-original-chord="N.C.">N.C.</span> x2
Tom &amp; Jerry&#39;s &quot;song&quot;&nbsp;here
<span class="tabContent-chord js-chord-chord" data-original-chord="G">G</span>
[Verse 1]
   
<span class="tabContent-chord js-chord-chord" data-original-chord="Dsus4">Dsus4</span>      <span class="tabContent-chord js-chord-chord" data-original-chord="D">D</span>
tabs	with	tab characters
[Outro]
</pre>`);
r = tryParse(mk(odd));
check('odd content parses', !!r.song, r.err && r.err.message);
if (r.song) {
  const s = r.song; const json = JSON.stringify(s.sections);
  check('entities decoded', json.includes("Tom & Jerry's \\\"song\\\" here") || json.includes("Tom & Jerry's"), json.slice(0, 200));
  check('x2 kept as mark', s.sections[0].lines[0].chords.some((c) => /x2/.test(c.mark || '')), JSON.stringify(s.sections[0].lines[0].chords));
  check('empty trailing section [Outro] kept or dropped consistently', s.sections.length >= 2);
  console.log('info: sections', s.sections.map((x) => x.name + ':' + x.lines.length).join(', '));
}
// Header-only [Chorus] with sections that have inline text
r = tryParse(mk(wrap('<pre>Capo 2\n[Verse]\nsome plain text line\n[Chorus]\n</pre>')));
check('text-only song parses with warning', !!r.song && r.song.importInfo.warnings.length > 0, r.err && r.err.message);

// 4. Windows line endings in the whole file + QP/base64 with CRLF
const crlf = mk(wrap(goodPre)).replace(/\n/g, '\r\n');
r = tryParse(crlf);
check('CRLF mht', !!r.song && r.song.chords.join(' ') === 'Am F', r.err && r.err.message);
if (r.song) check('CRLF: lyric has no \\r', r.song.sections.every((s) => s.lines.every((l) => !/\r/.test(l.lyric))));
const b64 = mk(Buffer.from(wrap(goodPre).replace('hello there world', 'città è così'), 'utf-8').toString('base64').replace(/(.{76})/g, '$1\n'), 'base64');
r = tryParse(b64);
check('base64 + accents', !!r.song && JSON.stringify(r.song).includes('città è così'), r.err && r.err.message);

// 5. Malformed chord-ish things
for (const [n, pre] of Object.entries({
  chordSpanNoName: '<span class="tabContent-chord js-chord-chord"></span>   <span class="tabContent-chord js-chord-chord" data-original-chord="">x</span>\nlyric',
  chordAtEndOfLine: 'lyric short\n',
  chordColBeyondLyric: '                              <span class="tabContent-chord js-chord-chord" data-original-chord="C">C</span>\nab',
})) {
  const rr = tryParse(mk(wrap('<pre>[A]\n' + pre + '</pre>')));
  check('malformed ' + n + ' no crash', !!rr.song || readable(rr.err), rr.err && rr.err.message);
  if (rr.song) check('  validate-ish: names non-empty, cols >=0', rr.song.sections.every((s) => s.lines.every((l) => l.chords.every((c) => c.name !== '' && c.col >= 0))), JSON.stringify(rr.song.sections[0] && rr.song.sections[0].lines));
}
console.log(fails ? `${fails} FAILURES` : 'ALL OK');
process.exit(fails ? 1 : 0);
