// Round 7 tester, A3: first chords of a section on the real file (counts only, no text printed).
// Run: node test/e2e/round7-tester-core.mjs
import { readFileSync, existsSync } from 'node:fs';
import { parseSongFromMht } from '../../src/parser.js';
import { estimateSongDurations } from '../../src/durations.js';

const MHT = '/home/user/guitarapp/test/fixtures/local/american-pie.mht';
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
if (!existsSync(MHT)) { console.log('real file missing: skip'); process.exit(0); }
const song = parseSongFromMht(readFileSync(MHT, 'utf-8'));
const est = estimateSongDurations(song);
const firstBeats = est.sections.map((s) => { for (const l of s.lines) for (const c of l.chords) if (!c.rest) return c.beats; return null; });
console.log('first chord beats per section:', firstBeats.join(' '));
rec('A3a every section: first chord >= 2 beats', firstBeats.every((b) => b >= 2), `${firstBeats.filter((b) => b < 2).length} below 2`);

// pick-up: prepend a long lyric prefix to the first line that holds a chord of each section; durations must not change
const mod = JSON.parse(JSON.stringify(song));
let shifted = 0;
const prefix = 'uno due tre quattro cinque sei sette otto ';
mod.sections.forEach((s) => {
  const li = s.lines.findIndex((l) => l.chords.some((c) => !c.rest) && l.lyric && l.lyric.trim());
  if (li < 0) return;
  s.lines[li].lyric = prefix + s.lines[li].lyric;
  s.lines[li].chords.forEach((c) => { c.col += prefix.length; });
  shifted++;
});
const est2 = estimateSongDurations(mod);
let diffSec = 0, diffCh = 0;
est.sections.forEach((s, si) => {
  let d = 0;
  s.lines.forEach((l, li) => l.chords.forEach((c, ci) => { if (c.beats !== est2.sections[si].lines[li].chords[ci].beats) d++; }));
  const instr = s.lines.some((l) => l.chords.some((c) => !c.rest) && !(l.lyric && l.lyric.trim()));
  if (d && !instr) { diffSec++; diffCh += d; }
  if (d && instr) console.log(`  (section ${si + 1} changed too, but it has an instrumental chord line: its unit depends on the total syllable count, expected)`);
});
console.log(`pick-up test: ${shifted} sections modified; sections whose durations changed: ${diffSec}, chords changed: ${diffCh}`);
rec('A3b prefix before the first chord does not change durations (sections without instrumental lines)', diffSec === 0);

// only the FIRST chord of a section may be < 4 because of the rule; also count 1-beat chords and first-chord distribution
const hist = {};
firstBeats.forEach((b) => { hist[b] = (hist[b] || 0) + 1; });
console.log('histogram of first chord beats:', JSON.stringify(hist));
let ones = 0, n = 0;
est.sections.forEach((s) => s.lines.forEach((l) => l.chords.forEach((c) => { n++; if (c.beats === 1) ones++; })));
console.log(`chords of 1 beat: ${ones}/${n}`);
// a section with a single chord
const one = { ...song, sections: [{ name: 'X', lines: [{ lyric: 'ab', chords: [{ name: 'G', col: 0, beats: 4 }] }] }], timingSource: 'default' };
const e1 = estimateSongDurations(one);
rec('A3c single-chord section >= 2 beats', e1.sections[0].lines[0].chords[0].beats >= 2, String(e1.sections[0].lines[0].chords[0].beats));
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
