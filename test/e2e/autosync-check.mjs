// Independent local check of an alignment: own chroma (window 4096 at 22050 Hz, plain bins, square
// root magnitude, no peak picking, no log compression, no bass), different from src/analysis.
// For every change between two different chords: the mean chroma in the 0.5 s before the change
// must look more like the outgoing chord, and the one in the 0.5 s after like the incoming one.
import { fftRealMagnitudes } from '../../src/analysis/fft.js';
import { chordTemplate } from '../../src/analysis/align.js';

const SR = 22050;
const WIN = 4096;
const HOP = 1024;

// samples22k: mono Float32Array at 22050 Hz
export function independentChroma(samples22k, tuningCents) {
  const hannW = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
  const nF = Math.max(0, Math.floor((samples22k.length - WIN) / HOP));
  const chroma = new Float64Array(nF * 12);
  const buf = new Float64Array(WIN);
  const mag = new Float64Array(WIN / 2 + 1);
  const tune = tuningCents / 100;
  for (let t = 0; t < nF; t++) {
    for (let i = 0; i < WIN; i++) buf[i] = samples22k[t * HOP + i] * hannW[i];
    fftRealMagnitudes(buf, mag);
    for (let k = 1; k <= WIN / 2; k++) {
      const f = (k * SR) / WIN;
      if (f < 100 || f > 2000) continue;
      const midi = 69 + 12 * Math.log2(f / 440) - tune;
      chroma[t * 12 + (((Math.round(midi) % 12) + 12) % 12)] += Math.sqrt(mag[k]);
    }
  }
  return { chroma, nF };
}

// events: [{ name, rest, section }]; returns { n, both, out, in, perSection[] } in percent.
export function independentCheck({ chroma, nF }, events, startSec, endSec, shift, { offset = 0, nSections = 0 } = {}) {
  const frameSec = (t) => (t * HOP + WIN / 2) / SR;
  const meanChroma = (a, b) => {
    const v = new Float64Array(12);
    let n = 0;
    for (let t = Math.max(0, Math.floor((a * SR - WIN / 2) / HOP)); t < nF; t++) {
      const s = frameSec(t);
      if (s >= b) break;
      if (s >= a) { for (let k = 0; k < 12; k++) v[k] += chroma[t * 12 + k]; n++; }
    }
    return n ? v : null;
  };
  const cosv = (a, b) => {
    let s = 0, na = 0, nb = 0;
    for (let k = 0; k < 12; k++) { s += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
    return s / (Math.sqrt(na * nb) + 1e-12);
  };
  const tpl = (name) => {
    const t = chordTemplate(name);
    const w = new Float64Array(12);
    for (let k = 0; k < 12; k++) w[(k + shift + 12) % 12] = t.weights[k];
    return w;
  };
  let ok = 0, okOut = 0, okIn = 0, n = 0;
  const per = Array.from({ length: nSections }, () => ({ n: 0, ok: 0 }));
  for (let j = 1; j < events.length; j++) {
    const A = events[j - 1], B = events[j];
    if (A.rest || B.rest || A.name === B.name) continue;
    const tb = startSec[j] + offset;
    const before = meanChroma(Math.max(startSec[j - 1] + offset, tb - 0.5), tb - 0.05);
    const after = meanChroma(tb + 0.05, Math.min(endSec[j] + offset, tb + 0.5));
    if (!before || !after) continue;
    const ta = tpl(A.name), tb2 = tpl(B.name);
    const o1 = cosv(before, ta) > cosv(before, tb2);
    const o2 = cosv(after, tb2) > cosv(after, ta);
    n++;
    if (o1) okOut++;
    if (o2) okIn++;
    if (o1 && o2) ok++;
    if (per[B.section] && A.section === B.section) { per[B.section].n++; if (o1 && o2) per[B.section].ok++; }
  }
  return { n, both: (100 * ok) / Math.max(1, n), out: (100 * okOut) / Math.max(1, n), in: (100 * okIn) / Math.max(1, n), perSection: per.map((p) => (p.n ? Math.round((100 * p.ok) / p.n) : null)) };
}
