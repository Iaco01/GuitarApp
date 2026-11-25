// Round 7 tester: own synthetic song generator (NOT the implementer's test/fixtures/make-realistic.mjs).
//
// Differences from the implementer's generator: additive plucked strings (harmonics with their own
// decay, 12 ms strum stagger) instead of Karplus-Strong; a bass note on beats 1 and 3; kick / snare /
// hi-hat; a "voice" of wandering sine notes that are not chord notes; a free-tempo section with
// random durations; the audio is sung 1 semitone ABOVE the sheet and tuned -25 cents (implementer: +2
// semitones, +30 cents); drum hits sit half a beat after some changes (anticipated changes are not used).
// Also builds the library JSON of the matching song (no lyrics worth of copyright: invented words).
//
// Exports makeTrack(opts) -> { samples, sampleRate, song, truth[], meta } and writeWav().
// CLI: node test/e2e/round7-tester-make.mjs  -> test-artifacts/round-7/tester/{r7.wav,r7.mp3,r7-song.json,r7-truth.json}
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUTDIR = join(ROOT, 'test-artifacts', 'round-7', 'tester');

// sheet: [name, bpm|null, [[chord, beats], ...]]   bpm null = free tempo (durations random in seconds)
export const SHEET = [
  ['Intro', 90, [['G', 4], ['D', 4], ['Em', 4], ['C', 4], ['G', 4], ['D', 4], ['C', 8]]],
  ['Verse', 120, [['Am', 4], ['F', 4], ['C', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['G', 4]]],
  ['Chorus', 76, [['C', 2], ['G', 2], ['Am', 4], ['F', 4], ['C', 2], ['G', 2], ['D', 4], ['Em', 4]]],
  ['Free', null, [['Em', 4], ['A', 4], ['D', 4], ['G', 4], ['Bm', 4], ['E', 4]]],
  ['Verse', 120, [['Am', 4], ['F', 4], ['C', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['G', 4]]],
  ['Bridge', 132, [['D', 2], ['A', 2], ['Bm', 4], ['G', 4], ['D', 2], ['A', 2], ['E', 4], ['A', 4]]],
  ['Chorus', 80, [['C', 2], ['G', 2], ['Am', 4], ['F', 4], ['C', 2], ['G', 2], ['D', 4], ['Em', 4]]],
  ['Outro', 100, [['G', 4], ['C', 4], ['D', 4], ['G', 8]]],
];

// ---------- tiny seeded RNG
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function chordPcs(name) {
  const m = /^([A-G])([#b]?)(m?)(7?)/.exec(name);
  if (!m) return [0, 4, 7];
  const root = (NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const third = m[3] ? 3 : 4;
  const pcs = [root, (root + third) % 12, (root + 7) % 12];
  if (m[4]) pcs.push((root + 10) % 12);
  return pcs;
}

// ---------- render
// opts: seed, rate, semis (audio above sheet), cents, lead (s of leading silence), drums, voice,
//       dropEvents (Set of global sheet event indices missing in the audio), extraAfterSection {index, copies},
//       tailSec (extra audio after the end: an extra section of chords not in the sheet), noiseOnly, freeSeconds
export function makeTrack(opts = {}) {
  const o = { seed: 7, rate: 22050, semis: 1, cents: -25, lead: 1.2, drums: true, voice: true, dropEvents: new Set(), extraCopies: 0, tailSec: 0, noiseOnly: 0, freeTau: 1.0, ...opts };
  const R = rng(o.seed);
  const rate = o.rate;
  // 1. the audio script: sections with events [name, beats|null, durSec, sheetIdx|-1]
  let gi = 0;
  const audioSecs = [];
  const sheetEvents = [];
  SHEET.forEach(([name, bpm, chords], si) => {
    const evs = chords.map(([c, beats]) => {
      const idx = gi++;
      sheetEvents.push({ name: c, section: si });
      const dur = bpm ? (beats * 60) / bpm : 1.4 + R() * 2.4;
      return { name: c, beats, dur, sheetIdx: idx };
    });
    audioSecs.push({ name, bpm, evs, sheetSection: si });
    if (si === 1 && o.extraCopies) {
      for (let k = 0; k < o.extraCopies; k++) audioSecs.push({ name: name + '+', bpm, evs: evs.map((e) => ({ ...e, sheetIdx: -1 })), sheetSection: -1 });
    }
  });
  if (o.tailSec) {
    const evs = [];
    let t = 0;
    const cs = ['Dm', 'A', 'E', 'Bm'];
    for (let k = 0; t < o.tailSec; k++) { evs.push({ name: cs[k % 4], beats: 4, dur: 2.2, sheetIdx: -1 }); t += 2.2; }
    audioSecs.push({ name: 'Tail', bpm: 109, evs, sheetSection: -1 });
  }
  // 2. times
  const truth = new Array(gi).fill(null); // first occurrence start (s) for every sheet event
  const truthAll = Array.from({ length: gi }, () => []);
  const timeline = []; // audio events
  let t = o.lead;
  for (const sec of audioSecs) {
    for (let k = 0; k < sec.evs.length; k++) {
      const e = sec.evs[k];
      const ev = { ...e, t0: t, secBpm: sec.bpm, beatInSec: sec.evs.slice(0, k).reduce((s, x) => s + x.beats, 0), sec };
      timeline.push(ev);
      if (e.sheetIdx >= 0) { truth[e.sheetIdx] = t; truthAll[e.sheetIdx].push(t); }
      t += e.dur;
    }
  }
  const total = t + 2;
  const N = Math.ceil(total * rate);
  const x = new Float32Array(N);
  const a440 = 440 * 2 ** (o.cents / 1200);
  const freqOf = (midiPc, oct) => a440 * 2 ** ((midiPc + 12 * (oct - 4) - 9) / 12); // pc 0=C ; oct 4 -> C4 ... A4=a440
  const addNote = (f, t0, amp, tau, dur) => {
    if (f * 1 > rate / 2.2) return;
    const i0 = Math.floor(t0 * rate);
    const n = Math.min(Math.floor(dur * rate), N - i0);
    if (i0 < 0) return;
    const nh = Math.min(9, Math.floor((rate / 2.2) / f));
    for (let h = 1; h <= nh; h++) {
      const fh = f * h * (1 + 0.0004 * h * h); // slight inharmonicity
      const ah = amp / h ** 1.15;
      const th = tau / (1 + 0.35 * (h - 1));
      const w = (2 * Math.PI * fh) / rate;
      const ph = R() * 6.28;
      for (let i = 0; i < n; i++) {
        const tt = i / rate;
        const env = Math.exp(-tt / th) * Math.min(1, tt / 0.003);
        x[i0 + i] += ah * env * Math.sin(w * i + ph);
      }
    }
  };
  const noiseBurst = (t0, amp, dur, hp) => {
    const i0 = Math.floor(t0 * rate);
    const n = Math.min(Math.floor(dur * rate), N - i0);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const w = R() * 2 - 1;
      const y = hp ? w - prev : w; // crude high-pass
      prev = w;
      x[i0 + i] += amp * y * Math.exp(-(i / rate) / (dur / 4));
    }
  };
  const kick = (t0, amp) => {
    const i0 = Math.floor(t0 * rate);
    const n = Math.min(Math.floor(0.16 * rate), N - i0);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / rate;
      ph += (2 * Math.PI * (50 + 80 * Math.exp(-tt / 0.03))) / rate;
      x[i0 + i] += amp * Math.sin(ph) * Math.exp(-tt / 0.06);
    }
  };
  const semi = o.semis;
  for (let k = 0; k < timeline.length; k++) {
    const ev = timeline[k];
    const pcs = chordPcs(ev.name).map((p) => (p + semi + 12) % 12);
    const spb = ev.secBpm ? 60 / ev.secBpm : null;
    const root = pcs[0];
    const audible = !o.dropEvents.has(ev.sheetIdx);
    const isDropped = !audible;
    const strum = (t0, amp, up) => {
      // six strings: root (oct 2/3), fifth, root, third, fifth, root (oct 3/4)
      const voicing = [[pcs[0], 2], [pcs[2], 2], [pcs[0], 3], [pcs[1], 3], [pcs[2], 3], [pcs[0], 4]];
      const order = up ? voicing.slice().reverse() : voicing;
      order.forEach(([pc, oct], s) => addNote(freqOf(pc, oct), t0 + s * 0.012 + (R() - 0.5) * 0.004, amp * (0.8 + 0.3 * R()), 0.9, Math.min(3.5, Math.max(0.6, ev.dur + 0.4))));
    };
    if (isDropped) continue; // the previous chord keeps ringing and no new pluck happens
    if (spb) {
      const nb = Math.round(ev.dur / spb);
      for (let b = 0; b < nb; b++) strum(ev.t0 + b * spb, b === 0 ? 0.16 : 0.1, b % 2 === 1 && false);
      addNote(freqOf(root, 2) / 1, ev.t0, 0.22, 0.5, 1.2);
      if (nb >= 3) addNote(freqOf(root, 2), ev.t0 + 2 * spb, 0.18, 0.5, 1.0);
    } else {
      // free tempo: arpeggio, notes every 0.28-0.5 s, no regular pulse
      const vo = [[pcs[0], 2], [pcs[2], 2], [pcs[0], 3], [pcs[1], 3], [pcs[2], 3], [pcs[1], 4]];
      let tt = ev.t0;
      let j = 0;
      while (tt < ev.t0 + ev.dur - 0.1) { addNote(freqOf(vo[j % 6][0], vo[j % 6][1]), tt, 0.16, o.freeTau, o.freeTau * 1.6); tt += 0.28 + R() * 0.22; j++; }
    }
  }
  // drums only in stable sections after the Intro
  if (o.drums) {
    for (const ev of timeline) {
      if (!ev.secBpm || ev.sec.name === 'Intro') continue;
      const spb = 60 / ev.secBpm;
      const nb = Math.round(ev.dur / spb);
      for (let b = 0; b < nb; b++) {
        const gb = ev.beatInSec + b;
        const tb = ev.t0 + b * spb;
        if (gb % 2 === 0) kick(tb, 0.35); else noiseBurst(tb, 0.16, 0.12, false);
        noiseBurst(tb, 0.04, 0.03, true);
        noiseBurst(tb + spb / 2, 0.03, 0.03, true);
      }
    }
  }
  // "voice": wandering notes with vibrato, not tied to the chords
  if (o.voice) {
    let tt = o.lead + 2;
    while (tt < total - 3) {
      const midi = 60 + Math.floor(R() * 14);
      const f = a440 * 2 ** ((midi - 69) / 12);
      const d = 0.35 + R() * 0.7;
      const i0 = Math.floor(tt * rate);
      const n = Math.min(Math.floor(d * rate), N - i0);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / rate;
        ph += (2 * Math.PI * f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * u))) / rate;
        x[i0 + i] += 0.07 * Math.sin(ph) * Math.min(1, u / 0.04) * Math.min(1, (d - u) / 0.05);
      }
      tt += d + (R() < 0.35 ? 0.5 + R() * 1.5 : 0.02);
    }
  }
  for (let i = 0; i < N; i++) x[i] += (R() * 2 - 1) * 0.004;
  if (o.noiseOnly) {
    const M = Math.ceil(o.noiseOnly * rate);
    const nz = new Float32Array(M);
    for (let i = 0; i < M; i++) nz[i] = (R() * 2 - 1) * 0.3;
    return { samples: nz, sampleRate: rate, song: buildSong(), truth: [], meta: { durationSec: o.noiseOnly, events: gi } };
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = 0; i < N; i++) x[i] *= 0.9 / peak;
  return { samples: x, sampleRate: rate, song: buildSong(), truth, truthAll, meta: { durationSec: total, events: gi, sections: SHEET.map((s) => s[0]), freeSection: 3, semis: o.semis, cents: o.cents, timeline } };
}

// ---------- song (library schema 2, edited durations = the true beats)
export function buildSong(id = 'tester-r7-song', title = 'Prova tester sette') {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2, id, title, artist: 'Sintetico', difficulty: 'Beginner', tuning: 'E A D G B E', capo: 0, key: null, bpm: 90,
    timeSignature: [4, 4], strumming: [], chords: [...new Set(SHEET.flatMap((s) => s[2].map((c) => c[0])))],
    sections: SHEET.map(([name, bpm, chords]) => {
      const lines = [];
      let cur = null;
      for (const [c, beats] of chords) {
        if (!cur || cur.chords.length === 4) { cur = { lyric: 'uno due tre quattro cinque sei sette', chords: [] }; lines.push(cur); }
        cur.chords.push({ name: c, col: cur.chords.length * 6, beats });
      }
      return { name, bpm: bpm || 80, bpmSource: 'edited', strumIndex: null, lines };
    }),
    transpose: 0, timingSource: 'edited',
    view: { fontScale: 1, theme: 'dark', collapseRepeats: true, beatsPerChord: 4, showShapes: false },
    source: { fileName: 'r7.mht', importedAt: now }, importInfo: { method: 'spans', warnings: [] }, updatedAt: now, audio: null,
  };
}
export const library = (song) => JSON.stringify({ app: 'guitarapp', exportVersion: 1, exportedAt: new Date().toISOString(), songs: [song], settings: {} });

export function writeWav(path, samples, rate) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUTDIR, { recursive: true });
  const tr = makeTrack({ rate: 44100 });
  writeWav(join(OUTDIR, 'r7.wav'), tr.samples, tr.sampleRate);
  const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', join(OUTDIR, 'r7.wav'), '-codec:a', 'libmp3lame', '-b:a', '128k', join(OUTDIR, 'r7.mp3')], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  writeFileSync(join(OUTDIR, 'r7-song.json'), library(tr.song));
  writeFileSync(join(OUTDIR, 'r7-truth.json'), JSON.stringify({ truth: tr.truth, meta: { ...tr.meta, timeline: undefined } }, null, 1));
  console.log('events', tr.meta.events, 'duration', tr.meta.durationSec.toFixed(1), 's');
}
