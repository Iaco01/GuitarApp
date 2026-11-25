// Round 8 tester, section A (engine): music not in the sheet, with my own generator and seeds.
// node test/e2e/round8-tester-a.mjs [seed ...]     (default seeds 5 17 42; the report of the implementer used 3 / 11 / 29)
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeTrack, makeForeign, concat, fadeOut, peakNorm, secOfEvents } from './round8-tester-make.mjs';

const seeds = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [5, 17, 42];
const pct = (a, th) => (a.length ? (100 * a.filter((v) => v <= th).length / a.length) : NaN);
const f1 = (v) => (Number.isNaN(v) ? '-' : v.toFixed(1));
const COL = { green: 'g', yellow: 'y', red: 'r', verified: 'v' };
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL ' + m); };

for (const seed of seeds) {
  const base = makeTrack({ seed });
  const sr = base.sampleRate;
  const evs = songEvents(base.song);
  const idx = (si) => secOfEvents(evs, si);
  const tStart = (si) => base.truth[idx(si)[0]];
  const tEnd = (si) => { const l = idx(si); return l[l.length - 1] + 1 < base.truth.length ? base.truth[l[l.length - 1] + 1] : base.meta.durationSec - 2; };
  const slice = (a, b) => base.samples.subarray(Math.floor(a * sr), Math.floor(b * sr));
  const fx = (chords, dur, s2, bpm = 100) => { const f = makeForeign({ chords, bpm, seed: s2 }); return f.samples.subarray(0, Math.floor(dur * sr)); };
  const cases = [];
  // 1. instrumental intro 15 s, chords not in the sheet
  { const intro = fx(['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A'], 15, seed + 1, 110);
    cases.push({ name: 'intro 15s foreign', samples: concat([intro, base.samples]), trueGaps: [[0, 15 + base.truth[0]]], map: (j) => [base.truth[j] + 15] }); }
  // 2. solo 20 s between section 1 (Verse) and 2 (Chorus), different progression
  { const t = tStart(2); const solo = fx(['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A'], 20, seed + 2, 96);
    cases.push({ name: 'solo 20s between Verse and Chorus', samples: concat([slice(0, t), solo, slice(t, base.meta.durationSec)]), trueGaps: [[t, t + 20]], map: (j) => [base.truth[j] + (base.truth[j] >= t - 1e-6 ? 20 : 0)] }); }
  // 3. final chorus (section 6) played 3 times in all
  { const a = tStart(6), b = tEnd(6), L = b - a;
    cases.push({ name: 'final Chorus twice more', samples: concat([slice(0, b), slice(a, b), slice(a, b), slice(b, base.meta.durationSec)]),
      trueGaps: [[b, b + 2 * L]], map: (j) => { const t = base.truth[j]; if (t < a - 1e-6) return [t]; if (t < b - 1e-6) return [t, t + L, t + 2 * L]; return [t + 2 * L]; } }); }
  // 4. repeated middle: Bridge (5) once more; and Verse 2 (4, periodic) once more
  for (const [si, nm] of [[5, 'Bridge'], [4, 'Verse2']]) {
    const a = tStart(si), b = tEnd(si), L = b - a;
    cases.push({ name: `middle ${nm} repeated once`, samples: concat([slice(0, b), slice(a, b), slice(b, base.meta.durationSec)]),
      trueGaps: [[b, b + L]], map: (j) => { const t = base.truth[j]; if (t < a - 1e-6) return [t]; if (t < b - 1e-6) return [t, t + L]; return [t + L]; } }); }
  // 5. audio cut at 70% (whole sheet)
  { const cut = base.meta.durationSec * 0.7;
    cases.push({ name: 'audio cut at 70%', samples: base.samples.subarray(0, Math.floor(cut * sr)), cut, trueGaps: [], map: (j) => [base.truth[j]] }); }
  // 6. fade out over the last 15 s
  { cases.push({ name: 'fade-out 15 s', samples: fadeOut(base.samples, sr, 15), trueGaps: [], map: (j) => [base.truth[j]] }); }
  // control
  cases.push({ name: 'control (plain)', samples: base.samples, trueGaps: [], map: (j) => [base.truth[j]] });

  console.log(`\n=== seed ${seed}: ${evs.length} events, ${base.meta.durationSec.toFixed(1)} s`);
  for (const c of cases) {
    const t0 = Date.now();
    const res = analyseAndAlign({ samples: c.samples, sampleRate: sr, song: base.song });
    const ms = Date.now() - t0;
    if (!res) { console.log(`${c.name}: NULL`); fail(c.name + ' null'); continue; }
    const err = []; const errStable = [];
    base.truth.forEach((t, j) => {
      if (c.cut && t > c.cut - 1) return;
      const e = Math.min(...c.map(j).map((x) => Math.abs(res.eventStartSec[j] - x)));
      err.push(e); if (evs[j].section !== 3) errStable.push(e);
    });
    const al = makeAlignment(res, base.song);
    const colors = base.song.sections.map((_, si) => COL[sectionState(al, si)]).join('');
    const gaps = res.gaps.map((g) => `${g.startSec.toFixed(1)}-${g.endSec.toFixed(1)}`).join(' ') || '-';
    const tg = c.trueGaps.map((g) => `${g[0].toFixed(1)}-${g[1].toFixed(1)}`).join(' ') || '-';
    // gap error: best-matching found gap against each true gap
    const gapErr = c.trueGaps.map(([a, b]) => { if (!res.gaps.length) return 'missed'; const best = res.gaps.reduce((m, g) => { const d = Math.abs(g.startSec - a) + Math.abs(g.endSec - b); return d < m.d ? { d, g } : m; }, { d: 1e9 }); return `d(start)=${(best.g.startSec - a).toFixed(1)} d(end)=${(best.g.endSec - b).toFixed(1)}`; }).join('; ');
    const firstErr = (res.eventStartSec[0] - c.map(0)[0]).toFixed(2);
    console.log(`${c.name.padEnd(36)} ${String(ms).padStart(5)} ms | stable ${f1(pct(errStable, 0.1))}/${f1(pct(errStable, 0.25))}/${f1(pct(errStable, 0.5))} (all ${f1(pct(err, 0.25))}) | first ev err ${firstErr}s | true gaps ${tg} found ${gaps} ${gapErr ? '(' + gapErr + ')' : ''} | colors ${colors} | transp ${res.transposeFound}`);
    if (!/control|cut|fade/.test(c.name) && pct(errStable, 0.25) < 90) fail(`${c.name} stable < 90% within 250 ms`);
    if (/control/.test(c.name) && res.gaps.length) fail('false-positive gap on the control');
  }
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
