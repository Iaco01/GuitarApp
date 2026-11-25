// Round 6 tester: robustness of the duration estimate on random and degenerate sections (Node only).
// Run: node test/e2e/round6-tester-fuzz.mjs
import { estimateSectionDurations, estimateSongDurations } from '../../src/durations.js';
import { readFileSync, existsSync } from 'node:fs';
import { parseSongFromMht } from '../../src/parser.js';
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const words = ['a', 'the', 'love', 'amore', 'beautiful', 'cuore', 'sole', 'strange', 'x', 'Ciao,', "don't", 'hours', 'ia', 'oui', '—', '...', 'été', 'naïve', 'rhythm', 'queue'];
const mkLyric = () => Array.from({ length: Math.floor(rnd() * 9) }, () => words[Math.floor(rnd() * words.length)]).join(' ');
function mkSection() {
  const lines = [];
  const nl = 1 + Math.floor(rnd() * 5);
  for (let i = 0; i < nl; i++) {
    const lyric = rnd() < 0.2 ? '' : mkLyric();
    const nc = Math.floor(rnd() * 5);
    const cols = Array.from({ length: nc }, () => Math.floor(rnd() * (lyric.length + 12))).sort((a, b) => a - b);
    lines.push({ lyric, chords: cols.map((col, k) => ({ name: 'C', col, beats: 4, ...(rnd() < 0.08 ? { rest: true } : {}) })) });
  }
  return { name: 'S', lines };
}
let bad = [], n = 0;
for (let it = 0; it < 4000; it++) {
  const sec = mkSection();
  const avg = [2, 4, 8][it % 3];
  const ts = it % 5 === 0 ? [3, 4] : it % 7 === 0 ? [6, 8] : [4, 4];
  let out;
  try { out = estimateSectionDurations(sec, { timeSignature: ts, beatsPerChordAvg: avg }); } catch (e) { bad.push('throw ' + e.message); continue; }
  const chords = sec.lines.flatMap((l) => l.chords);
  if (!chords.length) continue;
  n++;
  const nonRest = chords.map((c, i) => [c, out[i]]).filter(([c]) => !c.rest);
  if (out.length !== chords.length) bad.push('len');
  if (out.some((b, i) => !Number.isFinite(b) || b <= 0)) bad.push('nan/neg ' + JSON.stringify(out));
  if (nonRest.length) {
    const sum = nonRest.reduce((a, [, b]) => a + b, 0);
    if (sum % ts[0] !== 0) bad.push(`total ${sum} not multiple of ${ts[0]} (n=${nonRest.length}, avg ${avg})`);
    if (nonRest.some(([, b]) => b < 1)) bad.push('<1');
    if (nonRest.some(([, b]) => !Number.isInteger(b))) bad.push('non-integer ' + JSON.stringify(out));
  }
  chords.forEach((c, i) => { if (c.rest && out[i] !== c.beats) bad.push('rest changed'); });
}
const kinds = {}; bad.forEach((b) => { const k = b.split(' ')[0] + (b.startsWith('total') ? '' : ''); kinds[k] = (kinds[k] || 0) + 1; });
rec('F1 4000 random sections: no throw, finite, integer, total multiple of bar, rests untouched', bad.length === 0, `${n} non-empty; ${bad.length} violations ${JSON.stringify(kinds)}; first: ${bad.slice(0, 3).join(' | ')}`);
// degenerate
const one = { name: 'x', lines: [{ lyric: 'hello', chords: [{ name: 'G', col: 0, beats: 4 }] }] };
rec('F2 one chord -> multiple of bar', estimateSectionDurations(one)[0] % 4 === 0, String(estimateSectionDurations(one)));
const empty = { name: 'x', lines: [{ lyric: 'only words', chords: [] }] };
rec('F3 no chords -> []', estimateSectionDurations(empty).length === 0);
const hostile = { name: 'x', lines: [{ lyric: '😀'.repeat(50) + ' ' + 'ab'.repeat(5000), chords: [{ name: 'G', col: 3, beats: 4 }, { name: 'C', col: 9000, beats: 4 }] }] };
const t0 = performance.now(); const h = estimateSectionDurations(hostile);
rec('F4 hostile long line is fast and sane', performance.now() - t0 < 100 && h.every(Number.isFinite), `${(performance.now() - t0).toFixed(1)} ms ${h}`);
// whole song, avg 2 and 8 on the real file
const REAL = new URL('../fixtures/local/american-pie.mht', import.meta.url).pathname;
if (existsSync(REAL)) {
  const song = parseSongFromMht(readFileSync(REAL, 'utf-8'));
  for (const avg of [2, 8]) {
    const e = estimateSongDurations(song, { beatsPerChordAvg: avg });
    const tot = e.sections.map((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
    const ok = tot.every((b) => b.reduce((a, c) => a + c, 0) % 4 === 0 && b.every((v) => v >= 1 && Number.isInteger(v)));
    const means = tot.map((b) => b.reduce((a, c) => a + c, 0) / b.length);
    rec(`F5 real file avg ${avg}: totals multiple of 4, ints >= 1`, ok, `means ${Math.min(...means).toFixed(2)}..${Math.max(...means).toFixed(2)}, distinct ${new Set(tot.flat()).size}`);
  }
  // idempotent / does not mutate
  const snap = JSON.stringify(song);
  estimateSongDurations(song);
  rec('F6 does not mutate its input', JSON.stringify(song) === snap);
  // estimate is independent of previous durations (re-estimate from edited durations gives same)
  const e1 = estimateSongDurations(song).sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
  const m = JSON.parse(JSON.stringify(song)); m.sections[0].lines[0].chords[0].beats = 9;
  const e2 = estimateSongDurations(m).sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
  rec('F7 estimate does not depend on the previous beats', JSON.stringify(e1) === JSON.stringify(e2));
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
