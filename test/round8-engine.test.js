// Round 8: robustness of the automatic sync on synthetic audio (tester generator, 11 kHz to keep it quick).
// Replaces the three `todo` tests of the round 7 tester (free-tempo confidence, disabled buttons, longer audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseAndAlign, songEvents } from '../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised, transposeTrusted } from '../src/alignment.js';
import { makeTrack } from './e2e/round7-tester-make.mjs';

const tr = makeTrack({ seed: 3, rate: 11025 });
const evs = songEvents(tr.song);
const base = analyseAndAlign({ samples: tr.samples, sampleRate: tr.sampleRate, song: tr.song });
const within = (res, th, filter = () => true) => {
  const e = tr.truth.map((t, j) => [Math.abs(res.eventStartSec[j] - t), j]).filter(([, j]) => filter(j));
  return e.filter(([x]) => x <= th).length / e.length;
};
const concat = (...parts) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const stable = (j) => evs[j].section !== 3;

test('baseline: stable sections within 250 ms, transposition found, free section marked free', () => {
  assert.ok(within(base, 0.25, stable) >= 0.97);
  assert.equal(base.transposeFound, 1);
  assert.equal(base.sections[3].bpm, null);
});

test('free-tempo arpeggiated section: events within 250 ms of the truth, or low confidence', () => {
  // events 28-32 (section "Free"); 27 repeats the last chord of the previous section and is excluded
  for (const j of [28, 29, 30, 31, 32]) {
    const err = Math.abs(base.eventStartSec[j] - tr.truth[j]);
    assert.ok(err <= 0.25 || base.confidence[j] < 0.6, `event ${j}: error ${(err * 1000).toFixed(0)} ms with confidence ${base.confidence[j].toFixed(2)}`);
  }
  const a = makeAlignment(base, tr.song);
  assert.notEqual(sectionState(a, 3), 'green', 'a section without a stable beat is never green');
  assert.equal(sectionState(a, 1), 'green');
});

test('disabled buttons look disabled (Salva, Anteprima, Esporta correzioni with nothing to save)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /(\.btn|button)(\.[a-z-]+)*:disabled|\[disabled\]/);
});

test('audio longer than the sheet with repeated music still aligns: 1.25x, 1.5x and 2x', () => {
  const n = tr.samples.length;
  for (const [name, samples] of [
    ['1.25x', concat(tr.samples, tr.samples.subarray(0, Math.floor(0.25 * n)))],
    ['1.5x', concat(tr.samples, tr.samples.subarray(0, n >> 1))],
    ['2x', concat(tr.samples, tr.samples)],
  ]) {
    const res = analyseAndAlign({ samples, sampleRate: tr.sampleRate, song: tr.song });
    assert.ok(res, `${name}: analyseAndAlign returned null`);
    const copies = name === '2x' ? [0, n / tr.sampleRate] : [0];
    const ok = tr.truth.filter((t, j) => stable(j) && copies.some((c) => Math.abs(res.eventStartSec[j] - (t + c)) <= 0.25)).length;
    assert.ok(ok / tr.truth.filter((t, j) => stable(j)).length >= 0.95, `${name}: ${ok} stable events within 250 ms`);
  }
});

test('a section played once more in the middle is reported as music not in the sheet', () => {
  const idx = evs.map((e, j) => (e.section === 2 ? j : -1)).filter((j) => j >= 0);
  const t0 = tr.truth[idx[0]];
  const t1 = tr.truth[idx[idx.length - 1] + 1];
  const sr = tr.sampleRate;
  const a = Math.floor(t0 * sr);
  const b = Math.floor(t1 * sr);
  const res = analyseAndAlign({ samples: concat(tr.samples.subarray(0, b), tr.samples.subarray(a, b), tr.samples.subarray(b)), sampleRate: sr, song: tr.song });
  const L = t1 - t0;
  const after = tr.truth.map((t, j) => [Math.abs(res.eventStartSec[j] - (j > idx[idx.length - 1] ? t + L : t)), j]).filter(([, j]) => j > idx[idx.length - 1] && stable(j));
  assert.ok(after.filter(([e]) => e <= 0.25).length / after.length >= 0.95);
  assert.ok(res.gaps.some((g) => g.endSec - g.startSec > 0.7 * L), 'the repeated section shows up as a gap');
  const g = res.gaps.find((x) => x.endSec - x.startSec > 0.7 * L);
  // either copy of the chorus can be the one that is matched: the gap is the other one
  assert.ok(g.startSec >= t0 - 1.5 && g.endSec <= t1 + L + 1.5, `the gap ${g.startSec.toFixed(1)}-${g.endSec.toFixed(1)} sits where the repeat is (${t0.toFixed(1)}-${(t1 + L).toFixed(1)})`);
});

test('noise or another song: no transposition proposed and "not recognised"', () => {
  const n = 150 * 11025;
  let s = 7;
  const R = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const noise = Float32Array.from({ length: n }, () => (R() * 2 - 1) * 0.3);
  const res = analyseAndAlign({ samples: noise, sampleRate: 11025, song: tr.song });
  assert.ok(!transposeTrusted(res), 'margin of the noise result is far below the threshold');
  const a = makeAlignment(res, tr.song);
  assert.equal(a.transposeFound, 0);
  assert.ok(!alignmentRecognised(a, tr.song));
  assert.ok(transposeTrusted(base));
  assert.ok(alignmentRecognised(makeAlignment(base, tr.song), tr.song));
});
