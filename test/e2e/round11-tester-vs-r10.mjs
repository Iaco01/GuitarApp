// Round 11 tester, B2: the whole real song analysed by the current engine and by the round-10 engine (git worktree of 0149be1 at /tmp/r10wt),
// event by event. Writes times only to test-artifacts/round-11/vs-r10.json.   git worktree add /tmp/r10wt 0149be1; node test/e2e/round11-tester-vs-r10.mjs
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const L = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(L + 'american-pie.mp3') || !existsSync('/tmp/r10wt/src')) { console.log('missing real files or /tmp/r10wt'); process.exit(0); }
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
async function go(src) {
  const { parseSongFromMht } = await import(path.join(src, 'parser.js'));
  const { analyseAndAlign, songEvents } = await import(path.join(src, 'analysis', 'autosync.js'));
  const { makeAlignment, sectionState } = await import(path.join(src, 'alignment.js'));
  const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
  const res = analyseAndAlign({ samples: X, sampleRate: 44100, song }); const al = makeAlignment(res, song);
  const ev = songEvents(song);
  return { res, al, st: song.sections.map((_, i) => sectionState(al, i)[0]).join(''), chords: ev.map((e) => e.name), secOf: ev.map((e) => e.section), lineOf: ev.map((e) => e.line), titles: song.sections.map((s) => s.name || s.title || s.label || ''), shift: res.transposeFound, beatsA: res.eventBeats };
}
const a = await go('/tmp/r10wt/src'); const b = await go('/home/user/guitarapp/src');
const d = a.res.eventStartSec.map((t, j) => b.res.eventStartSec[j] - t);
mkdirSync('/home/user/guitarapp/test-artifacts/round-11', { recursive: true });
writeFileSync('/home/user/guitarapp/test-artifacts/round-11/vs-r10.json', JSON.stringify({ r10: a.res.eventStartSec, r11: b.res.eventStartSec, r10end: a.res.endSec, r11end: b.res.endSec, sec: b.secOf, chords: b.chords, titles: b.titles, shift: b.shift, gaps10: a.res.gaps, gaps11: b.res.gaps, skipped10: a.res.skipped, skipped11: b.res.skipped }));
const ad = d.map(Math.abs);
console.log(`events ${d.length}; colours r10 ${a.st} -> r11 ${b.st}; moved >250 ms: ${ad.filter((x) => x > 0.25).length}; >100ms ${ad.filter((x) => x > 0.1).length}; >20ms ${ad.filter((x) => x > 0.02).length}`);
console.log(`gaps ${JSON.stringify(a.res.gaps)} -> ${JSON.stringify(b.res.gaps)}`);
d.forEach((x, j) => { if (Math.abs(x) > 0.25) console.log(`ev ${j} sec ${b.secOf[j]} ${b.chords[j]} r10 ${a.res.eventStartSec[j].toFixed(2)} r11 ${b.res.eventStartSec[j].toFixed(2)} d ${x.toFixed(2)}`); });
