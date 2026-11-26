// Round 10 tester, C5: the whole real song analysed by the current engine and by the round-9 engine (a git worktree of 8b86705
// at /tmp/r9wt), event by event. Counts and times only.   git worktree add /tmp/r9wt 8b86705; node test/e2e/round10-tester-real-vs-r9.mjs
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const L = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(L + 'american-pie.mp3') || !existsSync('/tmp/r9wt/src')) { console.log('missing real files or /tmp/r9wt'); process.exit(0); }
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
async function go(src) {
  const { parseSongFromMht } = await import(path.join(src, 'parser.js'));
  const { analyseAndAlign, songEvents } = await import(path.join(src, 'analysis', 'autosync.js'));
  const { makeAlignment, sectionState } = await import(path.join(src, 'alignment.js'));
  const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
  const res = analyseAndAlign({ samples: X, sampleRate: 44100, song }); const al = makeAlignment(res, song);
  return { res, st: song.sections.map((_, i) => sectionState(al, i)[0]).join(''), n: songEvents(song).length, song };
}
const a = await go('/tmp/r9wt/src'); const b = await go('/home/user/guitarapp/src');
const d = a.res.eventStartSec.map((t, j) => Math.abs(t - b.res.eventStartSec[j]));
console.log(`events ${a.n} / ${b.n}; colours round 9 ${a.st} -> now ${b.st}; max time difference ${Math.max(...d).toFixed(3)} s; events differing > 250 ms: ${d.filter((x) => x > 0.25).length}; > 20 ms: ${d.filter((x) => x > 0.02).length}`);
console.log(`gaps ${a.res.gaps.length} -> ${b.res.gaps.length}; skipped ${(a.res.skipped || []).length} -> ${(b.res.skipped || []).length}; section confidences r9 ${a.res.sections.map((s) => s.confidence.toFixed(2)).join(' ')} | now ${b.res.sections.map((s) => s.confidence.toFixed(2)).join(' ')}`);
console.log(`bpm r9 ${a.res.sections.map((s) => (s.bpm === null ? '-' : s.bpm.toFixed(0))).join(' ')} | now ${b.res.sections.map((s) => (s.bpm === null ? '-' : s.bpm.toFixed(0))).join(' ')}`);
