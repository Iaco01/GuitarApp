// Round 10 tester, A1: do the recorded clicks fall on audible onsets of the mp3? Onset envelope (high-passed energy, 10 ms hop)
// sampled at each click (max within +-35 ms) against the same clicks shifted by half a beat and a quarter beat (control).
// Prints per-section ratios only. Run: node test/e2e/round10-tester-phase.mjs [SE]  (needs clicks-raw-<dev>.json)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dev = process.argv[2] || 'SE';
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-artifacts', 'round-10', `clicks-raw-${dev}.json`), 'utf8'));
const { al, clicks, pairs, tl } = raw;
const SR = 11025;
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3'), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
const env = []; let prev = 0;
for (let i = 0; i + 220 < x.length; i += 110) { let d = 0; for (let k = 1; k < 220; k++) { const w = x[i + k] - x[i + k - 1]; d += w * w; } const l = Math.log(1e-6 + d / 220); env.push(Math.max(0, l - prev)); prev = l; }
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const pc = pairs.map(([c, m]) => [c, m - c]);
const cl = clicks.map(([when]) => when + med(pc.filter(([c]) => Math.abs(c - when) < 2).map((p) => p[1]))).sort((a, b) => a - b);
const at = (t) => { const i = Math.round(t * 100); let m = 0; for (let k = i - 3; k <= i + 3; k++) if (env[k] > m) m = env[k]; return m; };
const secOfT = (t) => { for (let i = al.sections.length - 1; i >= 0; i--) if (t >= al.sections[i].startSec) return i; return 0; };
console.log('section | bpm | clicks | env on click | env at +1/2 beat | env at +1/4 beat | on/half ratio | median click offset to the nearest strong onset (ms)');
for (let si = 0; si < al.sections.length; si++) {
  const cs = cl.filter((t) => secOfT(t) === si); if (cs.length < 8) continue;
  const bpm = Number.isFinite(al.sections[si].bpm) ? al.sections[si].bpm : null; const T = 60 / (bpm || 100);
  const a = cs.reduce((s, t) => s + at(t), 0) / cs.length, b = cs.reduce((s, t) => s + at(t + T / 2), 0) / cs.length, q = cs.reduce((s, t) => s + at(t + T / 4), 0) / cs.length;
  // offset to the strongest onset within +-0.15 s
  const offs = cs.map((t) => { let best = -1, bi = 0; for (let k = -15; k <= 15; k++) { const v = env[Math.round(t * 100) + k]; if (v > best) { best = v; bi = k; } } return bi * 10; });
  console.log(`${si + 1} | ${bpm ? bpm.toFixed(1) : 'free'} | ${cs.length} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${q.toFixed(2)} | ${(a / b).toFixed(2)} | ${med(offs)} (spread ${Math.round(offs.map(Math.abs).sort((p, q2) => p - q2)[Math.floor(offs.length * 0.75)])} ms 75th pct abs)`);
}
