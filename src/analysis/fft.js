// Radix-2 iterative FFT (pure, runs in Node and in the browser).

const fftCache = new Map(); // size -> { rev, cos, sin }

function fftPlan(n) {
  let p = fftCache.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('fft: size must be a power of two');
  const rev = new Uint32Array(n);
  let bits = 0;
  while ((1 << bits) < n) bits++;
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  p = { rev, cos, sin };
  fftCache.set(n, p);
  return p;
}

// In-place forward complex FFT of (re, im); the length must be a power of two.
export function fftInPlace(re, im) {
  const n = re.length;
  const { rev, cos, sin } = fftPlan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w];
        const wi = sin[w];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

// In-place forward complex FFT of (re, im) whose input is already in bit-reversed order (the callers copy
// their frames straight to the reversed positions, which saves the swap pass). The first two stages are one
// multiplication-free radix-4 pass. Same result as fftInPlace up to rounding.
function fftBitReversed(re, im) {
  const n = re.length;
  const { cos, sin } = fftPlan(n);
  for (let i = 0; i < n; i += 4) {
    const x0r = re[i], x1r = re[i + 1], x2r = re[i + 2], x3r = re[i + 3];
    const x0i = im[i], x1i = im[i + 1], x2i = im[i + 2], x3i = im[i + 3];
    const s0r = x0r + x1r, s0i = x0i + x1i, d0r = x0r - x1r, d0i = x0i - x1i;
    const s1r = x2r + x3r, s1i = x2i + x3i, d1r = x2r - x3r, d1i = x2i - x3i;
    re[i] = s0r + s1r; im[i] = s0i + s1i;
    re[i + 2] = s0r - s1r; im[i + 2] = s0i - s1i;
    re[i + 1] = d0r + d1i; im[i + 1] = d0i - d1r;
    re[i + 3] = d0r - d1i; im[i + 3] = d0i + d1r;
  }
  for (let size = 8; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w];
        const wi = sin[w];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

// Magnitude spectra (bins 0..kMax, default n/2) of two real frames at once, with one complex FFT.
// `a` and `b` have length n; the results go in magA and magB (length >= kMax + 1; the bins above kMax are
// not computed). The scratch buffers re/im (length n) are optional.
export function fftRealPairMagnitudes(a, b, magA, magB, re, im, kMax = a.length >> 1) {
  const n = a.length;
  const r = re || new Float64Array(n);
  const m = im || new Float64Array(n);
  if (n < 8) {
    for (let i = 0; i < n; i++) { r[i] = a[i]; m[i] = b[i]; }
    fftInPlace(r, m);
  } else {
    const { rev } = fftPlan(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      r[j] = a[i];
      m[j] = b[i];
    }
    fftBitReversed(r, m);
  }
  const mask = n - 1;
  for (let k = 0; k <= kMax; k++) {
    const k2 = (n - k) & mask;
    const sr = r[k] + r[k2];
    const si = m[k] - m[k2];
    const dr = r[k] - r[k2];
    const di = m[k] + m[k2];
    magA[k] = 0.5 * Math.sqrt(sr * sr + si * si);
    magB[k] = 0.5 * Math.sqrt(dr * dr + di * di);
  }
}

// Magnitudes (bins 0..n/2) of a single real frame.
export function fftRealMagnitudes(x, mag) {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i];
  fftInPlace(re, im);
  for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
}

// Naive O(n^2) DFT magnitudes (bins 0..n/2), reference for the tests.
export function dftNaiveMagnitudes(x) {
  const n = x.length;
  const out = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      sr += x[t] * Math.cos(ang);
      si += x[t] * Math.sin(ang);
    }
    out[k] = Math.hypot(sr, si);
  }
  return out;
}
