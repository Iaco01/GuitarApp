// Round 10: the real song (local only, copyrighted): colours, skipped sections, gaps, event-by-event comparison with a saved
// reference. Counts, times and section names only.
//   node test/e2e/round10-real.mjs save <file>     save the times of the whole file
//   node test/e2e/round10-real.mjs compare <file>  compare with a saved reference (differences > 250 ms listed)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
const DIR = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(DIR + 'american-pie.mp3')) { console.log('file reali assenti'); process.exit(0); }
const song = parseSongFromMht(readFileSync(DIR + 'american-pie.mht', 'utf-8'));
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', DIR + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
const samples = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
const evs = songEvents(song);
const res = analyseAndAlign({ samples, sampleRate: 44100, song });
const al = makeAlignment(res, song);
const st = song.sections.map((_, si) => sectionState(al, si));
const cur = { colours: st.map((s) => s[0]).join(''), eventStartSec: res.eventStartSec, confidence: res.confidence, sectionConf: res.sections.map((s) => s.confidence), gaps: res.gaps };
const [mode, file] = process.argv.slice(2);
console.log('colours ' + cur.colours + ' gaps ' + res.gaps.length + ' compute ' + res.computeMs + ' ms');
if (mode === 'save') { writeFileSync(file, JSON.stringify(cur)); console.log('saved ' + file); }
if (mode === 'compare') {
  const ref = JSON.parse(readFileSync(file, 'utf-8'));
  console.log('reference colours ' + ref.colours);
  const diffs = [];
  let max = 0;
  evs.forEach((e, j) => { const d = Math.abs(cur.eventStartSec[j] - ref.eventStartSec[j]); max = Math.max(max, d); if (d > 0.25) diffs.push(`event ${j} (section ${e.section + 1} ${song.sections[e.section].name}, chord ${e.name}): ${ref.eventStartSec[j].toFixed(2)} -> ${cur.eventStartSec[j].toFixed(2)} (${(cur.eventStartSec[j] - ref.eventStartSec[j]).toFixed(2)} s)`); });
  const within = evs.filter((_, j) => Math.abs(cur.eventStartSec[j] - ref.eventStartSec[j]) <= 0.25).length;
  console.log(`events ${evs.length}: within 250 ms ${within}, max diff ${max.toFixed(3)} s, over 250 ms: ${diffs.length}`);
  diffs.forEach((d) => console.log('  ' + d));
}
