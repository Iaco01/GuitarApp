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

// Magnitude spectra (bins 0..n/2) of two real frames at once, with one complex FFT.
// `a` and `b` have length n; the results go in magA and magB (length >= n/2 + 1). The scratch
// buffers re/im (length n) are optional.
export function fftRealPairMagnitudes(a, b, magA, magB, re, im) {
  const n = a.length;
  const r = re || new Float64Array(n);
  const m = im || new Float64Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = a[i];
    m[i] = b[i];
  }
  fftInPlace(r, m);
  for (let k = 0; k <= n / 2; k++) {
    const k2 = (n - k) & (n - 1);
    const sr = r[k] + r[k2];
    const si = m[k] - m[k2];
    const dr = r[k] - r[k2];
    const di = m[k] + m[k2];
    magA[k] = 0.5 * Math.hypot(sr, si);
    magB[k] = 0.5 * Math.hypot(dr, di);
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
