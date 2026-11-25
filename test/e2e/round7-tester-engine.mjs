// Round 7 tester, part B: the analysis engine on my own synthetic track (accuracy, robustness, determinism).
// Run: node test/e2e/round7-tester-engine.mjs [accuracy|robust|determinism|all]
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeTrack, SHEET } from './round7-tester-make.mjs';

const which = process.argv[2] || 'all';
const pct = (a, th) => (100 * a.filter((v) => v <= th).length / a.length).toFixed(1);
const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };

function errorsOf(res, tr, { allowCopies = false } = {}) {
  const e = [];
  tr.truth.forEach((t, j) => {
    if (t === null || t === undefined) return;
    const cands = allowCopies && tr.truthAll ? tr.truthAll[j] : [t];
    e.push(Math.min(...cands.map((c) => Math.abs(res.eventStartSec[j] - c))));
  });
  return e;
}
function sane(res, n) {
  const s = res.eventStartSec;
  let ordered = true, finite = true;
  for (let j = 0; j < n; j++) { if (!Number.isFinite(s[j])) finite = false; if (j && s[j] < s[j - 1] - 1e-9) ordered = false; }
  return { ordered, finite };
}

function accuracy() {
  console.log('== B1 accuracy (synthetic, own generator, +1 semitone, -25 cents, drums, bass, voice, one free section, 22.05 kHz mono)');
  for (const seed of [3, 11, 29]) {
    const tr = makeTrack({ seed });
    const t0 = Date.now();
    const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
    const ms = Date.now() - t0;
    const err = errorsOf(res, tr);
    const evs = songEvents(tr.song);
    const free = [], stable = [];
    err.forEach((e, j) => (evs[j].section === 3 ? free : stable).push(e));
    const bpms = res.sections.map((s) => (s.bpm === null ? 'free' : s.bpm.toFixed(0)));
    console.log(`seed ${seed}: ${err.length} events, ${(tr.meta.durationSec).toFixed(0)} s audio, ${ms} ms | within 100/250/500 ms: ${pct(err, 0.1)} / ${pct(err, 0.25)} / ${pct(err, 0.5)} | median ${(med(err) * 1000).toFixed(0)} ms, max ${(Math.max(...err) * 1000).toFixed(0)} ms`);
    console.log(`   stable ${stable.length}: ${pct(stable, 0.1)} / ${pct(stable, 0.25)} / ${pct(stable, 0.5)}   free ${free.length}: ${pct(free, 0.1)} / ${pct(free, 0.25)} / ${pct(free, 0.5)}`);
    console.log(`   transpose found ${res.transposeFound} (true +1, margin ${res.transposeMargin.toFixed(1)}), tuning ${res.tuningCents.toFixed(1)} cents (true -25)`);
    console.log(`   BPM per section: ${bpms.join(' ')}  (true ${SHEET.map((s) => s[1] || 'free').join(' ')})`);
    const worst = err.map((e, j) => [e, j]).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([e, j]) => `#${j}(${evs[j].name},sec ${evs[j].section}) ${(e * 1000).toFixed(0)}ms conf ${res.confidence[j].toFixed(2)}`);
    console.log(`   worst: ${worst.join('; ')}`);
    const confOk = res.confidence.reduce((s, c) => s + c, 0) / res.confidence.length;
    console.log(`   mean confidence ${confOk.toFixed(2)}; section conf ${res.sections.map((s) => s.confidence.toFixed(2)).join(' ')}`);
    if (seed === 3) {
      rec('B1 >= 90% within 250 ms', Number(pct(err, 0.25)) >= 90, pct(err, 0.25));
      rec('B1 transposition found (+1)', res.transposeFound === 1, String(res.transposeFound));
      rec('B1 free section recognised as free (bpm null)', res.sections[3].bpm === null, String(res.sections[3].bpm));
      rec('B1 stable BPMs within 2 of the truth', res.sections.every((s, i) => SHEET[i][1] === null || (s.bpm !== null && Math.abs(s.bpm - SHEET[i][1]) <= 2) ), bpms.join(' '));
    }
  }
}

function robust() {
  console.log('== B2 robustness');
  const run = (label, tr, extra = {}) => {
    let res;
    const t0 = Date.now();
    try { res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song }); } catch (e) { rec(`R ${label} no crash`, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); return null; }
    const ms = Date.now() - t0;
    if (!res) { console.log(`  ${label}: engine returned null (${ms} ms)`); rec(`R ${label} no crash (null result)`, true); return null; }
    const n = songEvents(tr.song).length;
    const sn = sane(res, n);
    const cm = res.confidence.reduce((s, c) => s + c, 0) / n;
    const lowFrac = res.confidence.filter((c) => c < 0.5).length / n;
    rec(`R ${label} no crash, finite & ordered`, sn.ordered && sn.finite && res.eventStartSec.length === n, `${ms} ms; mean conf ${cm.toFixed(2)}; frac conf<0.5 ${(100 * lowFrac).toFixed(0)}%; tr ${res.transposeFound} (margin ${res.transposeMargin.toFixed(1)})`);
    return { res, n, cm, lowFrac };
  };
  const base = makeTrack({ seed: 3 });
  const baseRes = analyseAndAlign({ samples: base.samples, sampleRate: base.sampleRate, song: base.song });
  const baseConf = baseRes.confidence.reduce((s, c) => s + c, 0) / baseRes.confidence.length;
  console.log(`  baseline mean confidence ${baseConf.toFixed(2)}`);

  // shorter audio: cut at 55% of the song
  {
    const cut = Math.floor(base.samples.length * 0.55);
    const tr = { ...base, samples: base.samples.slice(0, cut) };
    const r = run('shorter audio (55%)', tr);
    if (r) {
      const tCut = cut / base.sampleRate;
      const missing = base.truth.map((t, j) => [t, j]).filter(([t]) => t > tCut);
      const before = base.truth.map((t, j) => [t, j]).filter(([t]) => t < tCut - 4);
      const eBefore = before.map(([t, j]) => Math.abs(r.res.eventStartSec[j] - t));
      const lateConf = missing.map(([, j]) => r.res.confidence[j]);
      const lateInAudio = missing.filter(([, j]) => r.res.eventStartSec[j] <= tCut + 0.1).length;
      console.log(`  shorter: ${missing.length} events after the end of the audio; of them placed inside the audio: ${lateInAudio}; events before the cut within 250 ms: ${pct(eBefore, 0.25)}%; mean conf of missing ${(lateConf.reduce((a, b) => a + b, 0) / lateConf.length).toFixed(2)}`);
      rec('R shorter: events present in the audio mostly right (>= 85% within 500 ms)', Number(pct(eBefore, 0.5)) >= 85, pct(eBefore, 0.5));
      rec('R shorter: missing events have lower confidence than the baseline mean', lateConf.reduce((a, b) => a + b, 0) / lateConf.length < baseConf, '');
    }
  }
  // longer audio: Verse played twice in the audio, plus 25 s tail of unrelated chords
  {
    const tr = makeTrack({ seed: 3, extraCopies: 1, tailSec: 25 });
    const r = run('longer audio (extra repeated Verse + 25 s tail)', tr);
    if (r) {
      const e = errorsOf(r.res, tr, { allowCopies: true });
      console.log(`  longer: within 250 ms (vs first or second copy) ${pct(e, 0.25)}%, 500 ms ${pct(e, 0.5)}%`);
      // events AFTER the repeated verse are the ones at risk
      const evs = songEvents(tr.song);
      const after = e.filter((_, j) => evs[j].section >= 2);
      console.log(`  longer: events after the extra verse: ${pct(after, 0.25)}% within 250 ms, ${pct(after, 0.5)}% within 500`);
      rec('R longer: no catastrophic drift (>= 60% within 500 ms)', Number(pct(e, 0.5)) >= 60, pct(e, 0.5));
    }
  }
  // missing chord: three chords not played in the audio
  {
    const drop = new Set([20, 41, 55]);
    const tr = makeTrack({ seed: 3, dropEvents: drop });
    const r = run('three chords missing in the audio', tr);
    if (r) {
      const others = tr.truth.map((t, j) => [t, j]).filter(([, j]) => !drop.has(j));
      const e = others.map(([t, j]) => Math.abs(r.res.eventStartSec[j] - t));
      console.log(`  missing: other events within 250 ms ${pct(e, 0.25)}%, 500 ms ${pct(e, 0.5)}%; conf of the missing: ${[...drop].map((j) => r.res.confidence[j].toFixed(2)).join(', ')} (mean ${baseConf.toFixed(2)})`);
      rec('R missing chord: other events >= 85% within 500 ms', Number(pct(e, 0.5)) >= 85, pct(e, 0.5));
      rec('R missing chord: the missing events have lower confidence than average', [...drop].every((j) => r.res.confidence[j] < baseConf), '');
    }
  }
  // 10 s of silence at the start
  {
    const tr = makeTrack({ seed: 3, lead: 10 });
    const r = run('10 s of initial silence', tr);
    if (r) {
      const e = errorsOf(r.res, tr);
      console.log(`  silence: within 100/250/500 ms ${pct(e, 0.1)} / ${pct(e, 0.25)} / ${pct(e, 0.5)}; first event at ${r.res.eventStartSec[0].toFixed(2)} s (true ${tr.truth[0].toFixed(2)})`);
      rec('R silence: first event not placed in the silence', r.res.eventStartSec[0] > 9, r.res.eventStartSec[0].toFixed(2));
      rec('R silence: >= 90% within 250 ms', Number(pct(e, 0.25)) >= 90, pct(e, 0.25));
    }
  }
  // mono 22 kHz is the default of the generator; also 8 kHz-ish (very low) and 44.1 kHz stereo-like (same samples at 44.1)
  {
    const tr = makeTrack({ seed: 3, rate: 44100 });
    const r = run('44.1 kHz source', tr);
    if (r) { const e = errorsOf(r.res, tr); console.log(`  44.1k: ${pct(e, 0.1)} / ${pct(e, 0.25)} / ${pct(e, 0.5)}`); }
    const tr2 = makeTrack({ seed: 3, rate: 8000 });
    const r2 = run('8 kHz source (very low rate)', tr2);
    if (r2) { const e = errorsOf(r2.res, tr2); console.log(`  8k: ${pct(e, 0.1)} / ${pct(e, 0.25)} / ${pct(e, 0.5)}`); }
  }
  // pure noise
  {
    const tr = makeTrack({ seed: 3, noiseOnly: 150 });
    const r = run('white noise 150 s', tr);
    if (r) {
      const pcs = r.res.sections.filter((s) => s.bpm !== null).length;
      console.log(`  noise: sections claiming a stable BPM: ${pcs}/${r.res.sections.length}; conf per section ${r.res.sections.map((s) => s.confidence.toFixed(2)).join(' ')}; baseline ${baseConf.toFixed(2)}`);
      rec('R noise: mean confidence clearly below the baseline', r.cm < baseConf - 0.15, `${r.cm.toFixed(2)} vs ${baseConf.toFixed(2)}`);
      rec('R noise: no section claims a stable tempo', pcs === 0, String(pcs));
    }
    const sil = { ...tr, samples: new Float32Array(150 * 22050) };
    const r2 = run('digital silence 150 s', sil);
    const tiny = { ...tr, samples: new Float32Array(3000) };
    run('0.14 s of audio', tiny);
    const empty = { ...tr, samples: new Float32Array(0) };
    run('empty audio', empty);
    const nan = { ...tr, samples: Float32Array.from({ length: 22050 * 20 }, (_, i) => (i % 5000 === 0 ? NaN : Math.sin(i / 20))) };
    run('audio with NaN samples', nan);
  }
}

function determinism() {
  console.log('== B3 determinism');
  const tr = makeTrack({ seed: 11 });
  const songBefore = JSON.stringify(tr.song);
  const a = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
  const b = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
  const strip = (r) => JSON.stringify({ ...r, computeMs: 0, timings: 0 });
  rec('D1 two runs in one process are identical', strip(a) === strip(b));
  const c = analyseAndAlign({ samples: tr.samples.slice(), sampleRate: tr.sampleRate, song: JSON.parse(JSON.stringify(tr.song)) });
  rec('D2 copies of the input give identical output', strip(a) === strip(c));
  rec('D3 the song object is not modified', songBefore === JSON.stringify(tr.song));
}

if (which === 'accuracy' || which === 'all') accuracy();
if (which === 'robust' || which === 'all') robust();
if (which === 'determinism' || which === 'all') determinism();
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
