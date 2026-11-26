// Round 9 tester: the REAL song cut / spliced (local only). Compares with the analysis of the whole file:
// wrong skips (section present in the audio but "non presente"), wrong greens (green section whose events moved > 250 ms
// from the expected place), gaps.  Counts and section numbers only.    node test/e2e/round9-tester-realcut.mjs
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised } from '../../src/alignment.js';
const L = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(L + 'american-pie.mp3')) { console.log('file reali assenti'); process.exit(0); }
const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
const evs = songEvents(song);
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
const SR = 44100; const DUR = X.length / SR;
const run = (x) => { const res = analyseAndAlign({ samples: x, sampleRate: SR, song }); const al = makeAlignment(res, song); return { res, al, st: song.sections.map((_, si) => sectionState(al, si)) }; };
const ref = run(X);
console.log(`whole: ${DUR.toFixed(1)} s colours ${ref.st.map((s) => s[0]).join('')} gaps ${ref.res.gaps.length}`);
const secOf = evs.map((e) => e.section);
function report(name, x, expected) {
  // expected(j) -> expected start time of event j in the new audio, or null if the event is not in the new audio
  const { res, al, st } = run(x);
  const per = song.sections.map(() => ({ n: 0, bad: 0 }));
  evs.forEach((e, j) => { const ex = expected(j); if (ex === null) return; per[e.section].n++; if (Math.abs(res.eventStartSec[j] - ex) > 0.25) per[e.section].bad++; });
  const wrongSkip = [], wrongGreen = [], missedSkip = [];
  st.forEach((s, si) => {
    const sec = per[si];
    if (s === 'skipped' && sec.n >= 3) wrongSkip.push(si + 1);
    if (s === 'green' && sec.n && sec.bad / sec.n > 0.1) wrongGreen.push(`${si + 1}:${sec.bad}/${sec.n}`);
    if (s !== 'skipped' && sec.n === 0) missedSkip.push(si + 1);
  });
  console.log(`${name.padEnd(28)} rec=${alignmentRecognised(al, song) ? 'SI' : 'NO'} colours ${st.map((s) => s[0]).join('')} wrong-skip [${wrongSkip}] wrong-green [${wrongGreen}] absent-but-not-skipped [${missedSkip}] gaps ${res.gaps.length}`);
}
// cuts at the end
for (const f of [0.4, 0.6, 0.8, 0.95]) {
  const n = Math.floor(X.length * f);
  report(`cut at ${f * 100}%`, X.subarray(0, n), (j) => (ref.res.eventStartSec[j] < n / SR - 1 ? ref.res.eventStartSec[j] : null));
}
// remove a middle part [a,b] seconds (a section boundary of the reference + something)
const cutMid = (a, b) => { const A = Math.floor(a * SR), B = Math.floor(b * SR); const out = new Float32Array(X.length - (B - A)); out.set(X.subarray(0, A)); out.set(X.subarray(B), A); return out; };
const secStart = (si) => ref.res.eventStartSec[evs.findIndex((e) => e.section === si)];
for (const [a, b] of [[4, 5], [6, 7], [3, 5]]) {
  const t0 = secStart(a), t1 = b < song.sections.length ? secStart(b) : DUR;
  report(`remove sections ${a + 1}..${b}`, cutMid(t0, t1), (j) => { const t = ref.res.eventStartSec[j]; if (t >= t0 - 1e-6 && t < t1 - 1e-6) return null; return t >= t1 ? t - (t1 - t0) : t; });
}
// replace a section by 30 s of the song's own other part? (a solo): silence-free foreign music is not available; use the same file's tail reversed-free: skip
