// Round 10 tester, A6: without alignment everything is as before (the ticks of a chord are the beats of the sheet, estimated
// durations), and a saved schema-2 song on default durations receives the estimates. Real song: counts only.
// Run: node test/e2e/round10-tester-noalign.mjs
import { readFileSync, existsSync } from 'node:fs';
import { migrateSong } from '../../src/model.js';
import { parseSongFromMht } from '../../src/parser.js';
import { buildTimeline } from '../../src/timeline.js';
const hist = (a) => JSON.stringify(a.reduce((d, x) => { d[x] = (d[x] || 0) + 1; return d; }, {}));
// synthetic schema 2 on default durations
const lib = JSON.parse(readFileSync('test-artifacts/round-10/synth/r10-song.json', 'utf8'));
const s2 = lib.songs[0];
const before = s2.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
const m = migrateSong({ ...s2, schemaVersion: 2 });
const after = m.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
console.log(`schema 2 song, default durations: beats before ${hist(before)} -> after migration ${hist(after)}; timingSource ${s2.timingSource} -> ${m.timingSource}`);
const t = buildTimeline(m, {});
console.log(`  timeline without alignment: ticks per chord equal the chord beats: ${t.events.every((e, i) => e.beats === after[i])}; total ticks ${t.totalBeats} = sum of beats ${after.reduce((a, b) => a + b, 0)}`);
const L = 'test/fixtures/local/american-pie.mht';
if (existsSync(L)) {
  const song = parseSongFromMht(readFileSync(L, 'utf-8'));
  const b = song.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.beats)));
  const tt = buildTimeline(song, {});
  console.log(`real song (not aligned): chord beats ${hist(b)}; ticks per chord equal the beats: ${tt.events.every((e, i) => e.beats === b[i])}; timing source ${song.timingSource}`);
}
