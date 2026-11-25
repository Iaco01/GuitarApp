// Realistic synthetic recording for the automatic sync, with known truth (no copyrighted material).
//
// Instruments: Karplus-Strong plucked guitar (6 strings, down/up strums), bass on the root,
// synthetic kick/snare/hat, a "vocal" melody (harmonic tone with vibrato, not following the chords)
// and a little noise. The recording is `transpose` semitones above the sheet and `tuningCents`
// sharp. Sections: free tempo (+-15% rubato), tempo changes, a repeated section at another tempo,
// a rest bar.
//
//   import { makeRealistic } from './make-realistic.mjs'
//   const { samples, sampleRate, song, truth } = makeRealistic({ preset: 'short' })
//   node test/fixtures/make-realistic.mjs [short|long]   -> test-artifacts/realistic-<preset>.{wav,json}
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSong } from '../../src/model.js';
import { estimateSongDurations } from '../../src/durations.js';
import { parseChord } from '../../src/chord.js';
import { pitchClassOf } from '../../src/transpose.js';

function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [sectionName, bpm | 'free', drums, [[chord | null (rest), beats], ...]]
const BASE_A = [['G', 4], ['D', 4], ['Em', 4], ['C', 4], ['G', 2], ['D', 2], ['Am', 4], ['D', 4]];
const BASE_B = [['C', 4], ['G', 4], ['Am', 2], ['D', 2], ['G', 4], ['Em', 4], ['C', 2], ['D', 2], ['G', 4]];
const BASE_C = [['Em', 4], ['Am', 4], ['D', 4], ['G', 4], ['C', 2], ['D', 2], ['Em', 4], ['D7', 4]];

export const PRESETS = {
  short: [
    ['Intro', 'free', false, [['G', 4], ['Em', 4], ['C', 4], ['D', 4], ['G', 4], ['Am', 4]]],
    ['Verse', 112, true, BASE_A],
    ['Chorus', 138, true, BASE_B],
  ],
  long: [
    ['Intro', 'free', false, [['G', 4], ['Em', 4], ['C', 4], ['D', 4], ['G', 4], ['Am', 4], ['D', 4], ['G', 4]]],
    ['Verse 1', 112, true, BASE_A.concat(BASE_A)],
    ['Chorus', 138, true, BASE_B.concat(BASE_B)],
    ['Verse 2', 112, true, BASE_C.concat(BASE_A)],
    ['Chorus', 98, true, BASE_B.concat(BASE_B)],
    ['Bridge', 126, true, [[null, 4]].concat(BASE_C, BASE_A)],
    ['Free verse', 'free', false, BASE_A.concat([['C', 4], ['D', 4]])],
    ['Outro', 84, false, BASE_B],
  ],
};

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Karplus-Strong string with an all-pass fractional delay (exact tuning).
function pluck(out, startSample, f, durSamples, amp, sr, rng, decay = 0.9965) {
  const target = sr / f;
  const N = Math.floor(target - 1);
  const frac = target - 0.5 - N; // all-pass delay in [0.5, 1.5)
  const a = (1 - frac) / (1 + frac);
  const buf = new Float64Array(N);
  let prevLp = 0;
  for (let i = 0; i < N; i++) {
    const w = rng() * 2 - 1;
    prevLp = 0.6 * prevLp + 0.4 * w; // soft pluck
    buf[i] = prevLp * 2.2;
  }
  let idx = 0;
  let xPrev = 0;
  let yPrev = 0;
  const fade = Math.min(durSamples, Math.floor(0.05 * sr));
  for (let n = 0; n < durSamples; n++) {
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % N];
    const x = decay * 0.5 * (cur + nxt);
    const y = a * x + xPrev - a * yPrev;
    xPrev = x;
    yPrev = y;
    buf[idx] = y;
    idx = (idx + 1) % N;
    const env = n >= durSamples - fade ? (durSamples - n) / fade : 1;
    const p = startSample + n;
    if (p >= 0 && p < out.length) out[p] += cur * amp * env;
  }
}

function chordMidi(name, transpose) {
  const c = parseChord(name);
  const root = (pitchClassOf(c.root) + transpose + 120) % 12;
  const minor = /^m(?!aj)/.test(c.quality) || /^min/.test(c.quality);
  let r0 = 40 + ((root - 40 + 120) % 12); // 40..51
  if (r0 > 47) r0 -= 12 * 0; // keep within E2..B3
  const third = minor ? 3 : 4;
  const notes = [r0, r0 + 7, r0 + 12, r0 + 12 + third, r0 + 19, r0 + 24];
  if (/7/.test(c.quality)) notes[4] = r0 + 22;
  return { notes, root, bassMidi: 28 + ((root - 28 + 120) % 12) };
}

function addKick(out, s0, sr, amp) {
  const n = Math.floor(0.22 * sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 50 + 90 * Math.exp(-t * 30);
    ph += (2 * Math.PI * f) / sr;
    if (s0 + i < out.length) out[s0 + i] += amp * Math.sin(ph) * Math.exp(-t * 14);
  }
}
function addSnare(out, s0, sr, amp, rng) {
  const n = Math.floor(0.2 * sr);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = rng() * 2 - 1;
    lp = 0.5 * lp + 0.5 * w;
    const tone = Math.sin(2 * Math.PI * 190 * t);
    if (s0 + i < out.length) out[s0 + i] += amp * (0.7 * lp + 0.3 * tone) * Math.exp(-t * 22);
  }
}
function addHat(out, s0, sr, amp, rng) {
  const n = Math.floor(0.05 * sr);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = rng() * 2 - 1;
    const hp = w - prev;
    prev = w;
    if (s0 + i < out.length) out[s0 + i] += amp * hp * Math.exp(-t * 80);
  }
}
function addBass(out, s0, durSamples, f, amp, sr) {
  const n = durSamples;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 3.5) * Math.min(1, i / (0.004 * sr));
    const ph = 2 * Math.PI * f * t;
    if (s0 + i < out.length) out[s0 + i] += amp * env * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph));
  }
}
function addVoice(out, s0, durSamples, f, amp, sr) {
  const n = durSamples;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.5 * t);
    ph += (2 * Math.PI * f * vib) / sr;
    const env = Math.min(1, t / 0.05) * Math.min(1, (n - i) / (0.06 * sr));
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(h * ph) / h;
    if (s0 + i < out.length) out[s0 + i] += amp * env * s;
  }
}

export function makeRealistic({ preset = 'short', seed = 7, sampleRate = 44100, transpose = 2, tuningCents = 30, leadSec = 1.6, tailSec = 3 } = {}) {
  const rng = rngOf(seed);
  const sr = sampleRate;
  const plan = PRESETS[preset] || preset;
  const tuneRatio = Math.pow(2, tuningCents / 1200);
  // --- timing: tempo map per section
  let t = leadSec;
  const events = []; // { section, chord, beats, startSec, endSec, bpm|null, drums }
  const secTruth = [];
  plan.forEach(([name, bpm, drums, chords], si) => {
    const free = bpm === 'free';
    const base = free ? 96 : bpm;
    const startSec = t;
    let beat = 0;
    const spbAt = (b) => 60 / base / (free ? 1 + 0.15 * Math.sin((2 * Math.PI * b) / 14) : 1);
    const timeOf = (b0, b1) => {
      let s = 0;
      const steps = Math.max(1, Math.round((b1 - b0) * 20));
      for (let i = 0; i < steps; i++) s += spbAt(b0 + ((i + 0.5) * (b1 - b0)) / steps) * ((b1 - b0) / steps);
      return s;
    };
    for (const [chord, beats] of chords) {
      const dt = timeOf(beat, beat + beats);
      events.push({ section: si, chord, beats, startBeat: beat, startSec: t, endSec: t + dt, bpm: free ? null : base, drums, spbAt, free });
      t += dt;
      beat += beats;
    }
    secTruth.push({ name, startSec, endSec: t, bpm: free ? null : base, free, nEvents: chords.length });
  });
  const total = t + tailSec;
  const out = new Float32Array(Math.ceil(total * sr));
  const mix = new Float64Array(out.length);

  // --- music
  const scale = [0, 2, 4, 5, 7, 9, 11];
  for (const ev of events) {
    const s0 = Math.round(ev.startSec * sr);
    const durS = Math.round((ev.endSec - ev.startSec) * sr);
    if (ev.chord === null) {
      continue; // rest bar: silence (the tail of the previous chord has faded)
    }
    const { notes, bassMidi } = chordMidi(ev.chord, transpose);
    // strums: on every beat (down) and on some off-beats (up)
    const strums = [];
    for (let b = 0; b < ev.beats; b++) {
      strums.push({ beat: b, down: true });
      if (rng() < 0.55 && b + 0.5 < ev.beats) strums.push({ beat: b + 0.5, down: false });
    }
    const spbAvg = (ev.endSec - ev.startSec) / ev.beats;
    strums.forEach((st, k) => {
      const sStart = s0 + Math.round(st.beat * spbAvg * sr);
      const nextBeat = k + 1 < strums.length ? strums[k + 1].beat : ev.beats;
      const len = Math.round((nextBeat - st.beat) * spbAvg * sr) + Math.round(0.06 * sr);
      const order = st.down ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];
      const nStr = st.down ? 6 : 4;
      order.slice(0, nStr).forEach((si, j) => {
        const off = Math.round((0.011 + 0.004 * rng()) * j * sr);
        const m = notes[si];
        const amp = (st.down ? 0.16 : 0.1) * (0.85 + 0.3 * rng());
        pluck(mix, sStart + off, midiToHz(m) * tuneRatio, len, amp, sr, rng);
      });
    });
    // bass on beats 1 and 3
    for (let b = 0; b < ev.beats; b += 2) {
      const bs = s0 + Math.round(b * spbAvg * sr);
      addBass(mix, bs, Math.round(Math.min(2, 2 * spbAvg) * sr), midiToHz(bassMidi) * tuneRatio, 0.22, sr);
    }
    // drums
    if (ev.drums) {
      for (let b = 0; b < ev.beats; b += 0.5) {
        const ds = s0 + Math.round(b * spbAvg * sr) + Math.round(rng() * 0.004 * sr);
        const barBeat = (ev.startBeat + b) % 4;
        if (barBeat === 0 || barBeat === 2) addKick(mix, ds, sr, 0.35);
        if (barBeat === 1 || barBeat === 3) addSnare(mix, ds, sr, 0.22, rng);
        if (b % 1 !== 0) addHat(mix, ds, sr, 0.05, rng);
      }
    }
  }
  // vocal melody: independent notes of the key (not following the chords), in verse/chorus
  for (const sec of secTruth) {
    if (sec.free) continue;
    let vt = sec.startSec + 0.4;
    while (vt < sec.endSec - 0.8) {
      const deg = scale[Math.floor(rng() * 7)];
      const m = 62 + ((deg + transpose + 7) % 12) + (rng() < 0.3 ? 12 : 0);
      const dur = 0.25 + 0.7 * rng();
      addVoice(mix, Math.round(vt * sr), Math.round(dur * sr), midiToHz(m) * tuneRatio, 0.05, sr);
      vt += dur + (rng() < 0.4 ? 0.3 : 0.02);
    }
  }
  // noise and normalisation
  let peak = 0;
  for (let i = 0; i < mix.length; i++) {
    mix[i] += (rng() * 2 - 1) * 0.003;
    if (Math.abs(mix[i]) > peak) peak = Math.abs(mix[i]);
  }
  for (let i = 0; i < mix.length; i++) out[i] = (0.9 * mix[i]) / peak;

  // --- sheet (song) and truth
  const song = createSong({ title: 'Synthetic', artist: 'Generator', timeSignature: [4, 4], bpm: 100 });
  const sections = [];
  plan.forEach(([name, , , chords], si) => {
    const lines = [];
    for (let i = 0; i < chords.length; i += 4) {
      const group = chords.slice(i, i + 4);
      const words = [];
      const cs = [];
      group.forEach(([chord, beats]) => {
        if (chord === null) {
          cs.push({ name: 'N.C.', rest: true, beats, col: 0 });
          return;
        }
        // sung syllables ~ beats, with a +-1 error
        const syl = Math.max(1, Math.round(beats * 1.1 + (rng() * 2 - 1)));
        cs.push({ name: chord, beats: 4, col: words.join(' ').length + (words.length ? 1 : 0) });
        for (let k = 0; k < syl; k++) words.push('la');
      });
      lines.push({ lyric: words.join(' '), chords: cs });
    }
    sections.push({ name, lines, bpm: null, bpmSource: null, strumIndex: null });
  });
  song.sections = sections;
  const est = estimateSongDurations(song);
  song.sections = est.sections;
  song.timingSource = 'estimated';

  const truth = {
    preset,
    sampleRate: sr,
    durationSec: out.length / sr,
    transpose, // the recording is this many semitones above the sheet
    tuningCents,
    eventStartSec: events.map((e) => e.startSec),
    eventSection: events.map((e) => e.section),
    eventFree: events.map((e) => e.free),
    eventIsRest: events.map((e) => e.chord === null),
    sections: secTruth,
  };
  return { samples: out, sampleRate: sr, song, truth };
}

export function wavBytes(samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

if (process.argv[1] && process.argv[1].endsWith('make-realistic.mjs')) {
  const preset = process.argv[2] || 'short';
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir = join(root, 'test-artifacts');
  mkdirSync(dir, { recursive: true });
  const r = makeRealistic({ preset });
  writeFileSync(join(dir, `realistic-${preset}.wav`), wavBytes(r.samples, r.sampleRate));
  writeFileSync(join(dir, `realistic-${preset}.json`), JSON.stringify({ truth: r.truth, song: r.song }, null, 1));
  console.log(`realistic-${preset}: ${r.truth.durationSec.toFixed(1)} s, ${r.truth.eventStartSec.length} events`);
}
