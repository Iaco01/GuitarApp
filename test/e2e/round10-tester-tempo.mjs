// Round 10 tester, A1: independent tempo check of the measured section BPM (decodes the mp3 with ffmpeg, onset envelope,
// autocorrelation per section). Reports whether the app's BPM is the strongest periodicity or a half/double of it.
// Input: test-artifacts/round-10/clicks-raw-<dev>.json (alignment). Run: node test/e2e/round10-tester-tempo.mjs [SE]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dev = process.argv[2] || 'SE';
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-artifacts', 'round-10', `clicks-raw-${dev}.json`), 'utf8'));
const al = raw.al;
const SR = 11025;
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3'), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
const HOP = Math.round(SR * 0.01);
const env = [];
let prev = 0;
for (let i = 0; i + 441 < x.length; i += HOP) {
  let e = 0, d = 0;
  for (let k = 0; k < 441; k++) { const v = x[i + k]; e += v * v; if (k) { const w = v - x[i + k - 1]; d += w * w; } } // energy of the high-passed signal
  const l = Math.log(1e-6 + d / 441);
  env.push(Math.max(0, l - prev)); prev = l;
}
const secs = al.sections;
const starts = al.eventStartSec;
const bounds = []; // section start/end from sectionEventIndices equivalent: sections[i].startSec / next
secs.forEach((s, i) => bounds.push([s.startSec, i + 1 < secs.length ? secs[i + 1].startSec : al.endSec]));
console.log('section | measured BPM | strongest periodicity BPM (80-190) | ratio strength(measured)/(best) | strength at ½× and 2× measured');
for (let i = 0; i < secs.length; i++) {
  const [a, b] = bounds[i]; if (!(b - a > 8)) { console.log(`${i + 1} | too short`); continue; }
  const seg = env.slice(Math.floor(a * 100), Math.floor(b * 100)); const m = seg.reduce((s, v) => s + v, 0) / seg.length; const z = seg.map((v) => v - m);
  const ac = (lagS) => { const L = lagS * 100; const l0 = Math.floor(L), f = L - l0; let s = 0, n = 0; for (let k = 0; k + l0 + 1 < z.length; k++) { s += z[k] * (z[k + l0] * (1 - f) + z[k + l0 + 1] * f); n++; } return s / n; };
  const norm = ac(0.0001) || 1;
  let best = 0, bestBpm = 0;
  for (let bpm = 80; bpm <= 190; bpm += 0.5) { const v = ac(60 / bpm); if (v > best) { best = v; bestBpm = bpm; } }
  const mb = secs[i].bpm;
  if (!Number.isFinite(mb)) { console.log(`${i + 1} | free | best ${bestBpm} (${(best / norm).toFixed(2)})`); continue; }
  // the measured bpm may sit outside 80-190; compare at lags
  const v = Math.max(ac(60 / mb), ac(60 / (mb * 1.01)), ac(60 / (mb * 0.99)));
  console.log(`${i + 1} | ${mb.toFixed(1)} | ${bestBpm} (${(best / norm).toFixed(2)}) | ${(v / best).toFixed(2)} | ½: ${(ac(120 / mb) / best).toFixed(2)}, 2×: ${(ac(30 / mb) / best).toFixed(2)} | ${Math.abs(bestBpm - mb) < 3 ? 'same' : (Math.abs(bestBpm * 2 - mb) < 4 ? 'app = 2× best' : Math.abs(bestBpm / 2 - mb) < 3 ? 'app = ½ best' : 'differs')}`);
}
