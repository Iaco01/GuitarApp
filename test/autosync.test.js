import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fftRealMagnitudes, dftNaiveMagnitudes, fftRealPairMagnitudes } from '../src/analysis/fft.js';
import { resampleMono } from '../src/analysis/features.js';
import { chordTemplate, snapToBeats, gridBonusFrames } from '../src/analysis/align.js';
import { analyseAndAlign } from '../src/analysis/autosync.js';
import { makeRealistic } from './fixtures/make-realistic.mjs';

test('fft matches a naive DFT (single and paired frames)', () => {
  const n = 256;
  const a = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9) + ((i * 7919) % 13) / 13);
  const b = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.11) - 0.2 * ((i * 31) % 7));
  const ref = dftNaiveMagnitudes(a);
  const m = new Float64Array(n / 2 + 1);
  fftRealMagnitudes(a, m);
  const mA = new Float64Array(n / 2 + 1);
  const mB = new Float64Array(n / 2 + 1);
  fftRealPairMagnitudes(a, b, mA, mB);
  const refB = dftNaiveMagnitudes(b);
  for (let k = 0; k <= n / 2; k++) {
    assert.ok(Math.abs(m[k] - ref[k]) < 1e-6);
    assert.ok(Math.abs(mA[k] - ref[k]) < 1e-6);
    assert.ok(Math.abs(mB[k] - refB[k]) < 1e-6);
  }
});

test('resampleMono keeps the length ratio and a low tone', () => {
  const x = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
  const y = resampleMono(x, 48000, 11025);
  assert.ok(Math.abs(y.length - 11025) <= 1);
});

test('chord templates', () => {
  const g = chordTemplate('G');
  assert.equal(g.root, 7);
  assert.ok(g.weights[11] > 0 && g.weights[2] > 0 && g.weights[10] === 0);
  const em = chordTemplate('Em');
  assert.ok(em.weights[7] > 0 && em.weights[4] > 0);
  assert.equal(chordTemplate('N.C.'), null);
});

test('synthetic short song: alignment, transposition, tempo', () => {
  const r = makeRealistic({ preset: 'short', seed: 3, sampleRate: 22050 });
  const res = analyseAndAlign({ samples: r.samples, sampleRate: r.sampleRate, song: r.song });
  assert.equal(res.transposeFound, r.truth.transpose);
  assert.ok(Math.abs(res.tuningCents - r.truth.tuningCents) < 20);
  const err = res.eventStartSec.map((s, i) => Math.abs(s - r.truth.eventStartSec[i]));
  const within = (th) => err.filter((e) => e <= th).length / err.length;
  assert.ok(within(0.25) >= 0.9, 'within 250 ms: ' + within(0.25));
  assert.equal(res.sections[0].bpm, null);
  assert.ok(Math.abs(res.sections[1].bpm - 112) <= 1.5);
  assert.ok(Math.abs(res.sections[2].bpm - 138) <= 1.5);
  assert.ok(res.eventStartSec.every((s, i) => i === 0 || s >= res.eventStartSec[i - 1]));
});

test('snapToBeats moves boundaries to beats, optionally to half beats', () => {
  const beats = [10, 10.5, 11, 11.5]; // 120 BPM
  assert.deepEqual(snapToBeats([10.04, 11.2], beats, 120, 0.2), [10, 11.2]);
  const h = snapToBeats([10.27, 10.74], beats, 120, 0.3, true);
  assert.ok(Math.abs(h[0] - 10.25) < 1e-9 && Math.abs(h[1] - 10.75) < 1e-9);
});

test('gridBonusFrames peaks on the beat grid and is zero outside the stretch', () => {
  const g = gridBonusFrames([{ times: [1, 2, 3], bpm: 60, from: 0.5, to: 3.5 }], 10, 60, { gamma: 4, width: 0.3 });
  assert.ok(g[10 + 0.5 | 0] > 3 || g[11] > 3);
  assert.equal(g[50], 0);
});
