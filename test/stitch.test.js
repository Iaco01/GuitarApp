// Round 12: placing decoded pieces by correlation of their overlap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateShift } from '../src/analysis/stitch.js';

function noise(n, seed = 1) {
  const x = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = s / 4294967296 - 0.5; }
  return x;
}

test('finds the shift of a piece against what is placed, in samples', () => {
  const out = noise(20000);
  for (const shift of [-120, -7, 0, 3, 90]) {
    // mono holds the same signal as out[5000..9000), delayed by `shift` samples
    const mono = new Float32Array(4000);
    for (let i = 0; i < 4000; i++) mono[i] = out[5000 + i - shift];
    const r = correlateShift(out, 5000, mono, 0, 4000, 200);
    assert.equal(r.shift, shift === 0 ? 0 : -shift); // (mono holds the signal `shift` late: it belongs `shift` samples earlier)
    assert.ok(r.corr > 0.99);
  }
});

test('an unrelated signal has a weak correlation; silence has no shift', () => {
  const out = noise(20000, 1);
  const other = noise(4000, 99);
  assert.ok(correlateShift(out, 5000, other, 0, 4000, 200).corr < 0.2);
  const quiet = new Float32Array(20000);
  assert.deepEqual(correlateShift(quiet, 5000, new Float32Array(4000), 0, 4000, 50), { shift: 0, corr: 1 });
});
