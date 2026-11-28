// Synth guitar for tab songs (pure, runs in Node): the pitches, the note plan from the play timeline, and the
// Karplus-Strong string as plain samples. The Web Audio side (voices, scheduling) is in synthvoice.js and player.js.

import { tabRowTuning } from './tab.js';

export const SYNTH_STAGGER_SEC = 0.011; // between the strings of a strummed column, low to high
export const SYNTH_TAIL_SEC = 0.35; // a note that rings to the end of its measure goes on this long
export const SYNTH_MUTE_SEC = 0.07;

export function midiToHz(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

// Sounding pitch (MIDI) of a note: open string of the tuning + capo + written fret (tab frets are relative to the capo).
export function tabNoteMidi(tuningMidi, rowCount, row, capo, fret) {
  const tun = tabRowTuning(tuningMidi, rowCount);
  return tun[row] + (capo || 0) + (fret || 0);
}

const GLIDE = {
  '/': { semis: 3, from: 0.2, to: 0.9 },
  s: { semis: 3, from: 0.2, to: 0.9 },
  '\\': { semis: -3, from: 0.2, to: 0.9 },
  b: { semis: 1, from: 0.05, to: 0.4 },
  '^': { semis: 1, from: 0.05, to: 0.4 },
  r: { semis: -1, from: 0.05, to: 0.5 },
};

// Section of another part that goes with the section being played: the one with the same label, else the same index.
function matchSection(part, label, index) {
  return part.sections.find((s) => s.label && s.label === label) || part.sections[index] || null;
}

// The notes to play for the events of `timeline` (built for the part `guide`). `parts`: indices of the parts that sound.
// Each note: { startSec, endSec, hz, vel, string, part, tech, glide: { hz, from, to } | null, legato, mute, vibrato, pre }
// where startSec/endSec are song seconds on the timeline (so they follow tempo and speed) and `from`/`to` are
// fractions of the note. Sorted by startSec.
export function buildNotePlan(song, timeline, { guide = song.tab.guide, parts = null } = {}) {
  const capo = Number.isInteger(song.capo) ? song.capo : 0;
  const tuning = song.tab.tuning && song.tab.tuning.midi;
  const play = parts || [guide];
  const plan = [];
  for (const ev of timeline.events) {
    const guideSec = song.tab.parts[guide].sections[ev.sectionRef];
    for (const pi of play) {
      const part = song.tab.parts[pi];
      if (!part) continue;
      const sec = pi === guide ? guideSec : matchSection(part, guideSec.label, ev.sectionRef);
      const m = sec && sec.measures[ev.measureIndex];
      if (!m) continue;
      const rowCount = m.rowCount || m.rows.length;
      const mEnd = ev.startSec + ev.durSec;
      const notes = [];
      for (const col of m.columns) {
        const t0 = ev.startSec + col.pos * ev.durSec;
        // low string first (the highest row index): a strum goes from the bass up
        const stack = col.notes.slice().sort((a, b) => b.string - a.string);
        stack.forEach((n, k) => {
          const midi = tabNoteMidi(tuning, rowCount, n.string, capo, n.fret === null ? 0 : n.fret);
          notes.push({
            baseStart: t0,
            startSec: t0 + Math.min(k, 5) * SYNTH_STAGGER_SEC,
            endSec: 0,
            hz: midiToHz(midi),
            midi,
            vel: 0.9 / Math.sqrt(stack.length),
            string: n.string,
            part: pi,
            tech: n.tech || '',
            pre: !!n.pre,
            glide: null,
            legato: false,
            mute: n.fret === null,
            vibrato: n.tech === '~' && !n.pre,
          });
        });
      }
      // durations: to the next note on the same string, else to the end of the measure and a short tail
      const byString = new Map();
      for (const n of notes) {
        if (!byString.has(n.string)) byString.set(n.string, []);
        byString.get(n.string).push(n);
      }
      for (const list of byString.values()) {
        list.sort((a, b) => a.baseStart - b.baseStart);
        list.forEach((n, i) => {
          const next = list[i + 1];
          n.endSec = next ? Math.max(n.startSec + 0.05, next.baseStart) : mEnd + SYNTH_TAIL_SEC;
          if (n.mute) n.endSec = n.startSec + SYNTH_MUTE_SEC;
          const g = !n.pre && GLIDE[n.tech];
          if (g && !n.mute) {
            const target = next && !next.mute ? next.hz : midiToHz(n.midi + g.semis);
            n.glide = { hz: target, from: g.from, to: g.to };
            if (next && !next.mute) next.legato = true;
          } else if ((n.tech === 'h' || n.tech === 'p') && next && !next.mute) {
            next.legato = true;
          }
          if (n.pre && GLIDE[n.tech]) {
            // a slide into the note: it starts a few semitones away and arrives quickly
            const semis = -GLIDE[n.tech].semis;
            n.glide = { hz: n.hz, from: 0, to: 0.18, startHz: midiToHz(n.midi + semis) };
          }
        });
      }
      for (const n of notes) {
        if (n.legato) n.vel *= 0.55;
        delete n.baseStart;
        plan.push(n);
      }
    }
  }
  plan.sort((a, b) => a.startSec - b.startSec);
  return plan;
}

// ---- Karplus-Strong string ----
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
}

// A plucked string as samples: a burst of noise (a little low-passed, with the comb of the pick position) circulating in
// a delay line with a two point average, tuned with a first order allpass. Higher notes die faster, the sound gets
// darker as it decays. Returns Float32Array of `seconds * sampleRate` samples, peak below 1.
export function renderPluck(hz, { sampleRate = 44100, seconds = 2.5, pluckPos = 0.18, seed = 1, t60 = null } = {}) {
  const total = Math.max(1, Math.floor(seconds * sampleRate));
  const out = new Float32Array(total);
  const D = sampleRate / hz - 0.5;
  let n = Math.floor(D);
  let frac = D - n;
  if (frac < 0.2) { n -= 1; frac += 1; }
  if (n < 2) return out;
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(n);
  const rnd = lcg(seed + Math.round(hz));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.65 * (rnd() - lp);
    line[i] = lp;
  }
  const k = Math.max(1, Math.round(pluckPos * n));
  const burst = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { burst[i] = line[i] - 0.8 * line[(i - k + n) % n]; mean += burst[i]; }
  mean /= n;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) { burst[i] -= mean; peak = Math.max(peak, Math.abs(burst[i])); }
  for (let i = 0; i < n; i++) line[i] = burst[i] / peak;
  const decay = t60 || Math.min(5, Math.max(1.2, 4.2 * (110 / hz) ** 0.3));
  const g = 0.001 ** (1 / (hz * decay));
  let prev = 0;
  let apX = 0;
  let apY = 0;
  let idx = 0;
  for (let i = 0; i < total; i++) {
    const x = line[idx];
    out[i] = 0.7 * x;
    const s = 0.5 * (x + prev);
    prev = x;
    const ap = c * (s - apY) + apX;
    apX = s;
    apY = ap;
    line[idx] = ap * g;
    idx = idx + 1 === n ? 0 : idx + 1;
  }
  return out;
}

// Fundamental of a signal by autocorrelation (Hz), for the tests.
export function estimatePitch(samples, sampleRate, minHz = 60, maxHz = 1500) {
  const lo = Math.floor(sampleRate / maxHz);
  const hi = Math.ceil(sampleRate / minHz);
  const len = Math.min(samples.length - hi - 1, Math.floor(sampleRate * 0.25));
  const r = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += samples[i] * samples[i + lag];
    r[lag] = sum;
  }
  let best = lo;
  for (let lag = lo; lag <= hi; lag++) if (r[lag] > r[best]) best = lag;
  // an octave error: a lag half as long with almost the same correlation is the real period
  for (let div = 4; div >= 2; div--) {
    const l2 = Math.round(best / div);
    if (l2 >= lo && r[l2] > 0.9 * r[best]) { best = l2; break; }
  }
  const a = r[best - 1];
  const b = r[best];
  const cc = r[best + 1];
  const den = a - 2 * b + cc;
  const shift = den !== 0 ? (0.5 * (a - cc)) / den : 0;
  return sampleRate / (best + shift);
}
