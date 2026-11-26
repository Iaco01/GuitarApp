// Placing the pieces of an audio decoded in parts (pure). The position of a piece is found by CORRELATION of the stretch
// that it shares with what is already placed, not from what the decoder reports: decoders differ (priming, resampler delay)
// and a position taken from the first piece alone is wrong in the others by an amount that the decoder decides.

// Best shift s in [-maxShift, maxShift] (samples) such that mono[srcStart + i] matches out[dst + s + i] for i < len:
// { shift, corr } with corr the normalised correlation (1 = identical). Silence in both returns { shift: 0, corr: 1 }.
export function correlateShift(out, dst, mono, srcStart, len, maxShift) {
  let ey = 0;
  let ex0 = 0;
  const n = Math.min(len, mono.length - srcStart);
  if (n <= 0) return { shift: 0, corr: 0 };
  for (let i = 0; i < n; i++) ey += mono[srcStart + i] * mono[srcStart + i];
  let best = -2;
  let bestShift = 0;
  let bestEx = 0;
  for (let s = -maxShift; s <= maxShift; s++) {
    const o = dst + s;
    if (o < 0 || o + n > out.length) continue;
    let xy = 0;
    let ex = 0;
    for (let i = 0; i < n; i++) {
      const x = out[o + i];
      xy += x * mono[srcStart + i];
      ex += x * x;
    }
    const c = xy / Math.sqrt(ex * ey + 1e-20);
    if (s === 0) ex0 = ex;
    if (c > best) { best = c; bestShift = s; bestEx = ex; }
  }
  if (best === -2) return { shift: 0, corr: 0 };
  // (nothing but silence on either side: no information, no shift)
  if (ey < 1e-6 * n && bestEx < 1e-6 * n && ex0 < 1e-6 * n) return { shift: 0, corr: 1 };
  return { shift: bestShift, corr: best };
}
