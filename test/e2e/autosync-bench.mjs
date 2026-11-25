// Long synthetic bench for the automatic sync (known truth). node test/e2e/autosync-bench.mjs [seeds]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRealistic, wavBytes } from '../fixtures/make-realistic.mjs';
import { analyseAndAlign } from '../../src/analysis/autosync.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'test-artifacts');
mkdirSync(dir, { recursive: true });
const seeds = (process.argv[2] || '1,2,3').split(',').map(Number);
let failed = false;
for (const seed of seeds) {
  const r = makeRealistic({ preset: 'long', seed });
  if (seed === seeds[0]) {
    writeFileSync(join(dir, 'realistic-long.wav'), wavBytes(r.samples, r.sampleRate));
    writeFileSync(join(dir, 'realistic-long.json'), JSON.stringify({ truth: r.truth, song: r.song }));
  }
  const res = analyseAndAlign({ samples: r.samples, sampleRate: r.sampleRate, song: r.song });
  const err = res.eventStartSec.map((s, i) => Math.abs(s - r.truth.eventStartSec[i]));
  const pct = (th, f) => {
    const a = err.filter((_, i) => f(i));
    return (100 * a.filter((e) => e <= th).length) / a.length;
  };
  const free = (i) => r.truth.eventFree[i];
  const stable = (i) => !r.truth.eventFree[i];
  const all = () => true;
  const med = err.slice().sort((a, b) => a - b)[err.length >> 1];
  console.log(`seed ${seed}: ${err.length} events, ${res.computeMs} ms; transpose ${res.transposeFound} (true ${r.truth.transpose}), tuning ${res.tuningCents.toFixed(1)} (true ${r.truth.tuningCents})`);
  console.log(`  within 100/250/500 ms: all ${[0.1, 0.25, 0.5].map((t) => pct(t, all).toFixed(1)).join('/')}, stable ${[0.1, 0.25, 0.5].map((t) => pct(t, stable).toFixed(1)).join('/')}, free ${[0.1, 0.25, 0.5].map((t) => pct(t, free).toFixed(1)).join('/')}; median ${(med * 1000).toFixed(0)} ms`);
  const bpmOk = res.sections.every((s, i) => (r.truth.sections[i].bpm === null ? s.bpm === null : s.bpm !== null && Math.abs(s.bpm - r.truth.sections[i].bpm) <= 1));
  console.log('  bpm: ' + res.sections.map((s, i) => `${s.bpm ?? 'free'}/${r.truth.sections[i].bpm ?? 'free'}`).join(' '));
  if (!(pct(0.25, stable) >= 90 && pct(0.25, free) >= 70 && bpmOk && res.transposeFound === r.truth.transpose)) failed = true;
}
console.log(failed ? 'GOALS NOT MET' : 'goals met');
process.exit(failed ? 1 : 0);
