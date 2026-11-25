// Round 8: calibration of the confidence on synthetic tracks with known truth (tester generator and the
// implementer's one, with several kinds of damage). Prints the table "section confidence -> share of
// changes within 250 ms of the truth".  node test/e2e/round8-confidence.mjs [--json out.json] [--quick]
import { writeFileSync } from 'node:fs';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeTrack } from './round7-tester-make.mjs';
import { makeRealistic } from '../fixtures/make-realistic.mjs';

const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const quick = argv.includes('--quick');

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function addNoise(samples, level, seed) {
  const R = rng(seed);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < out.length; i++) out[i] = samples[i] + (R() * 2 - 1) * level;
  return out;
}

const cases = [];
const seeds = quick ? [3] : [3, 11, 29];
for (const seed of seeds) {
  const t = makeTrack({ seed });
  cases.push({ gen: 'tester', variant: 'clean', seed, tr: t });
  for (const lv of [0.1, 0.25]) cases.push({ gen: 'tester', variant: `noise${lv}`, seed, tr: { ...t, samples: addNoise(t.samples, lv, seed + 5) } });
  cases.push({ gen: 'tester', variant: 'slowdecay', seed, tr: makeTrack({ seed, freeTau: 0.4, voice: true }) });
  cases.push({ gen: 'tester', variant: 'nodrums-novoice', seed, tr: makeTrack({ seed, drums: false, voice: false }) });
  cases.push({ gen: 'tester', variant: 'drop3', seed, tr: makeTrack({ seed, dropEvents: new Set([20, 41, 55]) }) });
  const tr = makeTrack({ seed });
  cases.push({ gen: 'tester', variant: 'cut60', seed, tr: { ...tr, samples: tr.samples.slice(0, Math.floor(tr.samples.length * 0.6)) } });
}
for (const seed of quick ? [1] : [1, 2, 3]) {
  const r = makeRealistic({ preset: 'long', seed });
  const tr = { samples: r.samples, sampleRate: r.sampleRate, song: r.song, truth: r.truth.eventStartSec, free: r.truth.eventFree, rest: r.truth.eventIsRest };
  cases.push({ gen: 'real-gen', variant: 'clean', seed, tr });
  for (const lv of [0.1, 0.25]) cases.push({ gen: 'real-gen', variant: `noise${lv}`, seed, tr: { ...tr, samples: addNoise(tr.samples, lv, seed + 9) } });
}

const rows = []; // one per event
for (const c of cases) {
  const { tr } = c;
  const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
  if (!res) { console.log(`${c.gen}/${c.variant}/${c.seed}: null`); continue; }
  const evs = songEvents(tr.song);
  const cutT = c.variant === 'cut60' ? tr.samples.length / tr.sampleRate : Infinity;
  evs.forEach((e, j) => {
    const t = tr.truth[j];
    if (t === null || t === undefined || t > cutT - 1) return; // not in the audio
    if (tr.rest && tr.rest[j]) return;
    rows.push({ gen: c.gen, variant: c.variant, seed: c.seed, j, sec: e.section, secBpm: res.sections[e.section].bpm, secConf: res.sections[e.section].confidence, conf: res.confidence[j], sharp: res.sharpness ? res.sharpness[j] : null, err: Math.abs(res.eventStartSec[j] - t) });
  });
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows));

// table: section confidence -> accuracy
const bySec = new Map();
for (const r of rows) {
  const k = `${r.gen}|${r.variant}|${r.seed}|${r.sec}`;
  if (!bySec.has(k)) bySec.set(k, { secConf: r.secConf, free: r.secBpm === null, n: 0, ok: 0 });
  const s = bySec.get(k);
  s.n++;
  if (r.err <= 0.25) s.ok++;
}
const bins = [[0, 0.5], [0.5, 0.65], [0.65, 0.8], [0.8, 0.9], [0.9, 1.01]];
console.log('confidence of the section -> share of changes within 250 ms (sections of all the cases)');
for (const free of [false, true]) {
  console.log(free ? ' tempo libero (nessun battito stabile)' : ' tempo stabile');
  for (const [a, b] of bins) {
    const ss = [...bySec.values()].filter((s) => s.free === free && s.secConf >= a && s.secConf < b);
    const n = ss.reduce((x, s) => x + s.n, 0);
    const ok = ss.reduce((x, s) => x + s.ok, 0);
    const worst = ss.length ? Math.min(...ss.map((s) => s.ok / s.n)) : NaN;
    console.log(`  ${a.toFixed(2)}-${Math.min(b, 1).toFixed(2)}: ${String(ss.length).padStart(3)} sections, ${String(n).padStart(4)} changes, ${n ? ((100 * ok) / n).toFixed(1).padStart(5) : '    -'}% within 250 ms; worst section ${Number.isNaN(worst) ? '-' : (100 * worst).toFixed(0) + '%'}`);
  }
}
