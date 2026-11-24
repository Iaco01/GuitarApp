// Independent cross-check of src/parser.js against the real (git-ignored) file.
// Prints counts only; never prints lyrics. Run: node test/e2e/parser-independent.mjs
import { readFileSync, existsSync } from 'node:fs';
import { parseSongFromMht } from '../../src/parser.js';

const F = new URL('../fixtures/local/american-pie.mht', import.meta.url);
if (!existsSync(F)) { console.log('real file missing'); process.exit(0); }
const raw = readFileSync(F, 'utf-8');
const song = parseSongFromMht(raw);
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };

// Independent extraction: find <pre class="extra"> ... </pre> by plain indexOf.
const preStart = raw.indexOf('<pre');
const pres = []; let p = 0;
while ((p = raw.indexOf('<pre', p)) !== -1) { pres.push(p); p += 4; }
const tabIdx = raw.indexOf('js-tab-content');
const myPre = raw.indexOf('<pre', tabIdx);
const myEnd = raw.indexOf('</pre>', myPre);
let pre = raw.slice(raw.indexOf('>', myPre) + 1, myEnd);
// remove ad block: everything between first '<div class="js-ab-regular"' and the end of that line
const lines0 = pre.split('\n');
const adLines = lines0.filter((l) => /js-ab-regular|bidding/.test(l));
console.log('info: raw pre lines', lines0.length, 'ad lines', adLines.length, 'pre count in file', pres.length);
const clean = lines0.filter((l) => !/js-ab-regular|bidding/.test(l));
// how many lines had ad prefix + other content?
const adMixed = adLines.map((l) => l.replace(/<div class="js-ab-regular"[\s\S]*$/, '').trim().length);
console.log('info: ad line leading-content lengths', adMixed.join(','));

const spanRe = /<span class="tabContent-chord js-chord-chord"[^>]*data-original-chord="([^"]*)"[^>]*>([^<]*)<\/span>/g;
const allChordNames = [];
let m; while ((m = spanRe.exec(raw.slice(raw.indexOf('>', myPre) + 1, myEnd).replace(/<div class="js-ab-regular"[\s\S]*?(?=\n)/, '')))) allChordNames.push(m[1]);
check('independent chord count 328', allChordNames.length === 328, String(allChordNames.length));
check('parser chord count equals independent', song.sections.flatMap((s) => s.lines).flatMap((l) => l.chords).length === allChordNames.length);
const seq = song.sections.flatMap((s) => s.lines).flatMap((l) => l.chords).map((c) => c.name);
check('chord sequence identical in order', JSON.stringify(seq) === JSON.stringify(allChordNames));
const distinct = [...new Set(allChordNames)];
check('distinct order G D Em Am C A', distinct.join(' ') === 'G D Em Am C A', distinct.join(' '));
check('song.chords equals distinct', song.chords.join(' ') === distinct.join(' '));
// sections via independent header search on visible text
const headers = []; for (const l of clean) { const t = l.replace(/<[^>]*>/g, '').trim(); const h = /^\[(.+)\]$/.exec(t); if (h) headers.push(h[1]); }
check('12 sections', song.sections.length === 12 && headers.length === 12, headers.length + '/' + song.sections.length);
check('section names equal independent', JSON.stringify(headers) === JSON.stringify(song.sections.map((s) => s.name)));
check('order Verse n / Chorus alternating', song.sections.every((s, i) => s.name === (i % 2 === 0 ? 'Verse ' + (i / 2 + 1) : 'Chorus')));
check('title', song.title === 'American Pie', song.title);
check('artist', song.artist === 'Don McLean', song.artist);
check('difficulty', song.difficulty === 'Beginner', String(song.difficulty));
check('tuning', song.tuning === 'E A D G B E', String(song.tuning));
check('capo 0', song.capo === 0);
check('strumming 3', song.strumming.length === 3);
check('bpm 62/96/142', song.strumming.map((s) => s.bpm).join('/') === '62/96/142');
check('cells 16/8/8', song.strumming.map((s) => s.beats.length).join('/') === '16/8/8');
const rawCells = [...raw.matchAll(/<article[^>]*strumming-section[\s\S]*?<\/article>/g)].map((a) => (a[0].match(/class="strumming-beat/g) || []).length);
console.log('info: independent strumming cell counts', rawCells.join('/'));
const starLines = song.sections.flatMap((s) => s.lines).filter((l) => l.chords.some((c) => c.mark === '*'));
const starChords = song.sections.flatMap((s) => s.lines).flatMap((l) => l.chords).filter((c) => c.mark === '*');
check('22 lines with *', starLines.length === 22, String(starLines.length));
check('38 chords with *', starChords.length === 38, String(starChords.length));
// independent count of '*' in chord lines of raw pre
const starRaw = clean.filter((l) => /tabContent-chord/.test(l) && /<\/span>\s*\*/.test(l) || /tabContent-chord/.test(l) && /\*/.test(l.replace(/<[^>]*>/g, ''))).length;
const starTotal = clean.reduce((n, l) => n + (/tabContent-chord/.test(l) ? (l.replace(/<[^>]*>/g, '').match(/\*/g) || []).length : 0), 0);
console.log('info: independent: chord lines containing * =', starRaw, ' total * =', starTotal);
check('independent * lines == 22', starRaw === 22);
check('independent * total == 38', starTotal === 38);
// ad residue
const all = JSON.stringify(song);
for (const w of ['bidding', 'primis', '<', '>', '&nbsp;', '&amp;', '&#', 'js-ab', 'undefined', 'NaN']) check('no residue ' + w, !all.includes(w));
check('no U+FFFD / nbsp char in lyrics or names', !/[� ]/.test(all));
const lyrics = song.sections.flatMap((s) => s.lines);
check('no trailing spaces in lyrics', lyrics.every((l) => l.lyric === l.lyric.replace(/\s+$/, '')));
check('no tabs in lyrics', lyrics.every((l) => !l.lyric.includes('\t')));

// column check: rebuild chord row from original <pre> text
const rows = clean; // clean lines; chord lines are those with spans
// emulate pairing independently
let ci = 0, checked = 0, bad = 0; const sample = [];
const flat = song.sections.flatMap((s) => s.lines);
// Pair parser lines that have chords with raw chord lines in order
const rawChordLines = clean.map((l, i) => ({ l, i })).filter((x) => /tabContent-chord/.test(x.l));
const parserChordLines = flat.filter((l) => l.chords.length);
check('chord-line count equal', rawChordLines.length === parserChordLines.length, rawChordLines.length + '/' + parserChordLines.length);
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
rawChordLines.forEach((rc, k) => {
  const pl = parserChordLines[k];
  // independent column walk
  const cols = []; let col = 0; let rest = rc.l;
  const re = /<span class="tabContent-chord js-chord-chord"[^>]*data-original-chord="([^"]*)"[^>]*>([^<]*)<\/span>|([^<]+)|<[^>]*>/g;
  let mm; while ((mm = re.exec(rest))) {
    if (mm[1] !== undefined) { cols.push({ name: mm[1], col }); col += decode(mm[2]).length; } else if (mm[3] !== undefined) col += decode(mm[3]).length;
  }
  const same = cols.length === pl.chords.length && cols.every((c, j) => c.name === pl.chords[j].name && c.col === pl.chords[j].col);
  checked++; if (!same) { bad++; if (sample.length < 3) sample.push(k); }
});
check('every chord line: names+cols match independent walk', bad === 0, `${checked} lines, ${bad} mismatches ${sample.join(',')}`);
// lyric pairing: line after a chord line in raw is lyric? count pairs
let pairedLyric = 0, instr = 0;
rawChordLines.forEach((rc, k) => {
  const next = clean[rc.i + 1];
  const t = next === undefined ? '' : decode(next.replace(/<[^>]*>/g, ''));
  const isLyric = t.trim() !== '' && !/tabContent-chord/.test(next) && !/^\s*\[.+\]\s*$/.test(t);
  const pl = parserChordLines[k];
  if (isLyric) { pairedLyric++; if (pl.lyric !== t.replace(/\s+$/, '')) { fails++; console.log('FAIL lyric mismatch chord line', k); } } else { instr++; if (pl.lyric !== '') { fails++; console.log('FAIL expected instrumental', k); } }
});
console.log('info: chord lines with lyric', pairedLyric, 'instrumental', instr);
// lyric lines total count (text lines non-chord non-header non-blank)
const textLines = clean.filter((l) => { const t = decode(l.replace(/<[^>]*>/g, '')); return t.trim() !== '' && !/tabContent-chord/.test(l) && !/^\s*\[.+\]\s*$/.test(t); }).length;
const parserText = flat.filter((l) => l.lyric !== '').length;
check('lyric-bearing line count', textLines === parserText, textLines + '/' + parserText);
console.log(fails ? `${fails} FAILURES` : 'ALL OK');
process.exit(fails ? 1 : 0);
