// Round 6 tester: independent Node checks of the estimated durations on the real file.
// Own syllable counter (not src/durations.js countSyllables), own position logic. Prints only
// chord names, counts and beats (no lyrics). Compares with the table of docs/reports/round-6-impl.md.
// Run: node test/e2e/round6-tester-core.mjs
import { readFileSync, existsSync } from 'node:fs';
import { parseSongFromMht } from '../../src/parser.js';
import { migrateSong, sectionContentKey } from '../../src/model.js';
import { estimateSongDurations } from '../../src/durations.js';

let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);

// ---- independent syllable counter: vowel groups with English silent-e / -ed / -es rules ----
function syl(word) {
  let w = word.toLowerCase().replace(/[^a-zà-ü]/g, '');
  if (!w) return 0;
  const V = /[aeiouyà-ü]/;
  // initial y and vowel+y counted as consonant-ish only at start
  let s = w.replace(/^y/, 'j');
  let groups = (s.match(/[aeiouyà-ü]+/g) || []).length;
  if (groups > 1) {
    if (/[^aeiouy]ed$/.test(s) && !/[td]ed$/.test(s)) groups--;
    else if (/[^aeiouy]es$/.test(s) && !/(s|x|z|ch|sh|c|g)es$/.test(s)) groups--;
    else if (/[^aeiouy]e$/.test(s) && !/[^aeiouy]le$/.test(s)) groups--;
  }
  return Math.max(1, groups);
}
// syllable index of a chord at column col on a line: syllables fully before + fraction inside word
function lineSyl(lyric) {
  const words = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(lyric)) !== null) { const n = syl(m[0]); if (n) words.push({ s: m.index, e: m.index + m[0].length, n }); }
  return words;
}
function posOnLine(words, col, before) {
  let acc = 0;
  for (const w of words) {
    if (col < w.s) return acc;                     // over a space: next syllable
    if (col < w.e) return acc + Math.min(w.n - 1, Math.floor(((col - w.s) / (w.e - w.s)) * w.n));
    acc += w.n;
  }
  return acc;
}
const total = (words) => words.reduce((a, w) => a + w.n, 0);

// my flow: per section, chord positions (non-rest) in syllables; instrumental chord = mean syll per lyric chord
function myFlow(sec) {
  const L = sec.lines.map((l) => lineSyl(l.lyric || ''));
  let nl = 0, ts = 0;
  sec.lines.forEach((l, i) => { if (L[i].length) { nl += l.chords.filter((c) => !c.rest).length; ts += total(L[i]); } });
  const unit = nl ? Math.max(1, ts / nl) : 1;
  const items = []; let cur = 0;
  sec.lines.forEach((l, i) => {
    const real = l.chords.filter((c) => !c.rest);
    if (L[i].length) { for (const c of real) items.push({ c, pos: cur + posOnLine(L[i], c.col) }); cur += total(L[i]); }
    else real.forEach((c, k) => { items.push({ c, pos: cur }); const nx = real[k + 1]; cur += nx && nx.col - c.col <= 4 ? unit / 2 : unit; });
  });
  return { items, end: cur };
}
const mySyll = (f) => f.items.map((it, i) => (i === f.items.length - 1 ? f.end : f.items[i + 1].pos) - (i === 0 ? 0 : it.pos));

const REAL = new URL('../fixtures/local/american-pie.mht', import.meta.url).pathname;
if (!existsSync(REAL)) { console.log('real file absent'); process.exit(0); }
const song = parseSongFromMht(readFileSync(REAL, 'utf-8'));
const secs = song.sections;

// ---- A1: table in the report ----
const rep = readFileSync(new URL('../../docs/reports/round-6-impl.md', import.meta.url), 'utf-8');
function tableOf(title) {
  const i = rep.indexOf('### ' + title);
  const rows = [];
  for (const ln of rep.slice(i).split("\n").slice(4)) { const m = ln.match(/^\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/); if (!m) break; rows.push({ name: m[2], syl: +m[3], beats: +m[4] }); }
  return rows;
}
for (const [si, title] of [[0, 'Verse 1'], [1, 'Chorus']]) {
  const t = tableOf(title);
  const f = myFlow(secs[si]);
  const mine = mySyll(f).map((v) => Math.round(v));
  const actual = secs[si].lines.flatMap((l) => l.chords.filter((c) => !c.rest).map((c) => c.beats));
  const names = f.items.map((it) => it.c.name);
  rec(`A1 ${title}: report table has the same chords/beats as the app`, t.length === names.length && t.every((r, i) => r.name === names[i] && r.beats === actual[i]), `${t.length} rows vs ${names.length}`);
  const diffs = t.map((r, i) => [i + 1, names[i], r.syl, mine[i]]).filter(([, , a, b]) => a !== b);
  const off2 = diffs.filter(([, , a, b]) => Math.abs(a - b) >= 2);
  info(`A1 ${title}`, `${t.length} chords; syllable counts differ on ${diffs.length} (|diff|>=2 on ${off2.length}); total report ${t.reduce((a, r) => a + r.syl, 0)} vs mine ${mine.reduce((a, b) => a + b, 0)}`);
  info(`A1 ${title} diffs`, diffs.map(([i, n, a, b]) => `#${i} ${n} rep ${a} mine ${b}`).join('; '));
}

// ---- A2: properties on the whole real file ----
let v = { mult4: 0, min1: 0, avg: 0, mono: 0, monoPairs: 0 };
const vals = [];
secs.forEach((sec, si) => {
  const bs = sec.lines.flatMap((l) => l.chords.map((c) => c.beats));
  const sum = bs.reduce((a, b) => a + b, 0);
  if (sum % 4) v.mult4++;
  if (bs.some((b) => b < 1)) v.min1++;
  const avg = sum / bs.length;
  if (avg < 3 || avg > 5) v.avg++;
  vals.push(...bs);
  const f = myFlow(sec); const ms = mySyll(f);
  const actual = f.items.map((it) => it.c.beats);
  for (let i = 0; i < ms.length; i++) for (let j = 0; j < ms.length; j++) {
    if (Math.round(ms[i]) > Math.round(ms[j])) { v.monoPairs++; if (actual[i] < actual[j] - 2) v.mono++; }
  }
});
rec('A2 section totals multiple of 4', v.mult4 === 0, `${v.mult4} violations of ${secs.length}`);
rec('A2 no duration < 1', v.min1 === 0, `${v.min1}`);
rec('A2 section mean in [3,5]', v.avg === 0, `${v.avg}`);
const hist = {}; vals.forEach((b) => { hist[b] = (hist[b] || 0) + 1; });
info('A2 histogram of beats', JSON.stringify(hist));
info('A2 monotonicity with MY syllable counts', `${v.mono} violations over ${v.monoPairs} ordered pairs (tolerance 2 beats)`);
// pairs with strictly more syllables (>=2 more) -> the real signal
let strict = 0, strictPairs = 0;
secs.forEach((sec) => { const f = myFlow(sec); const ms = mySyll(f); const a = f.items.map((it) => it.c.beats);
  for (let i = 0; i < ms.length; i++) for (let j = 0; j < ms.length; j++) if (ms[i] >= ms[j] + 3) { strictPairs++; if (a[i] < a[j] - 2) strict++; } });
info('A2 monotonicity (>=3 syllables more)', `${strict} violations over ${strictPairs} pairs`);
// identical choruses
const byKey = new Map();
secs.forEach((s, i) => { const k = sectionContentKey(s); (byKey.get(k) || byKey.set(k, []).get(k)).push(i); });
let groupsViol = 0, groupsN = 0;
for (const ids of byKey.values()) if (ids.length > 1) { groupsN++; const ref = secs[ids[0]].lines.flatMap((l) => l.chords.map((c) => c.beats)).join(','); if (ids.some((i) => secs[i].lines.flatMap((l) => l.chords.map((c) => c.beats)).join(',') !== ref)) groupsViol++; }
info('A2 identical-content groups', `${groupsN} groups of identical sections, ${groupsViol} with different durations`);
rec('A2 identical sections same durations', groupsViol === 0);
// chorus names: how many sections share the name Chorus; are their durations all equal?
const choruses = secs.map((s, i) => [s, i]).filter(([s]) => /^chorus/i.test(s.name));
const sigs = choruses.map(([s]) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)).join(','));
info('A2 choruses', `${choruses.length} sections named Chorus, ${new Set(sigs).size} distinct duration patterns; chord counts ${choruses.map(([s]) => s.lines.reduce((n, l) => n + l.chords.length, 0)).join('/')}`);

// ---- A3: extremes and short first chords ----
const sorted = [...Object.keys(hist)].map(Number).sort((a, b) => a - b);
info('A3 values', sorted.join(','));
let short1 = 0, firstShort = 0, firstPair = [];
secs.forEach((sec, si) => {
  const real = sec.lines.flatMap((l) => l.chords.filter((c) => !c.rest));
  if (real[0].beats < 4) { firstShort++; }
  if (real[0].beats >= 3 && real[1].beats === 1) firstPair.push(`${sec.name}#${si + 1}:${real[0].name}${real[0].beats}/${real[1].name}${real[1].beats}`);
  short1 += real.filter((c) => c.beats === 1).length;
});
info('A3 durations of 1 beat', `${short1} of ${vals.length}`);
info('A3 first chord < 4 beats', `${firstShort} of ${secs.length} sections`);
info('A3 "first >=3 then 1" pattern', `${firstPair.length}: ${firstPair.join(' ')}`);
// extremes: for each of the 10 longest and 1-beat chords report my syllables, gap to next chord in columns
const ext = [];
secs.forEach((sec, si) => { const f = myFlow(sec); const ms = mySyll(f); f.items.forEach((it, i) => ext.push({ si, i, name: it.c.name, beats: it.c.beats, syl: ms[i] })); });
const long = [...ext].sort((a, b) => b.beats - a.beats).slice(0, 12);
info('A3 longest', long.map((e) => `${e.name}@S${e.si + 1}#${e.i + 1}=${e.beats}b/${e.syl.toFixed(1)}syl`).join(' '));
const short = ext.filter((e) => e.beats === 1);
info('A3 1-beat chords with my syllables', short.map((e) => `${e.name}@S${e.si + 1}#${e.i + 1}/${e.syl.toFixed(1)}syl`).join(' '));
// correlation beats vs my syllables
const mx = ext.reduce((a, e) => a + e.syl, 0) / ext.length, my = ext.reduce((a, e) => a + e.beats, 0) / ext.length;
const cov = ext.reduce((a, e) => a + (e.syl - mx) * (e.beats - my), 0), vx = ext.reduce((a, e) => a + (e.syl - mx) ** 2, 0), vy = ext.reduce((a, e) => a + (e.beats - my) ** 2, 0);
info('A3 correlation beats~syllables', (cov / Math.sqrt(vx * vy)).toFixed(3));
// long beats with few syllables / short with many
info('A3 oddities', `long(>=6) with <=2 syl: ${ext.filter((e) => e.beats >= 6 && e.syl <= 2).length}; short(<=2) with >=5 syl: ${ext.filter((e) => e.beats <= 2 && e.syl >= 5).length}`);

// ---- A4: migration ----
{
  const raw = JSON.parse(JSON.stringify(song));
  raw.schemaVersion = 2; raw.timingSource = 'default';
  raw.sections.forEach((s) => s.lines.forEach((l) => l.chords.forEach((c) => { c.beats = 4; })));
  const m = migrateSong(raw);
  const mb = m.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
  rec('A4 schema 2 default -> estimated', m.schemaVersion === 3 && m.timingSource === 'estimated' && new Set(mb).size >= 3, `${m.timingSource} ${new Set(mb).size} distinct`);
  const exp = estimateSongDurations(raw).sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
  rec('A4 migrated durations = estimate', JSON.stringify(exp) === JSON.stringify(mb));
  for (const src of ['edited', 'recorded']) {
    const r2 = JSON.parse(JSON.stringify(raw)); r2.timingSource = src; r2.sections[0].lines[0].chords[0].beats = 7;
    const m2 = migrateSong(r2);
    const b2 = m2.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
    rec(`A4 schema 2 ${src} untouched`, m2.timingSource === src && b2[0] === 7 && b2.slice(1).every((x) => x === 4), `${m2.timingSource} first=${b2[0]}`);
  }
  // already schema 3 estimated is not re-estimated; schema 2 without timingSource
  const r3 = JSON.parse(JSON.stringify(raw)); delete r3.timingSource;
  const m3 = migrateSong(r3);
  info('A4 schema 2 without timingSource', `-> ${m3.timingSource}, ${new Set(m3.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)))).size} distinct`);
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
