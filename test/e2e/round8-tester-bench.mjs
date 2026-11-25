// Round 8 tester: bench generator with a configurable sheet (section kinds: stable, rubato, free arpeggio, 1-beat changes,
// chords that share notes, strong noise). Own code, no song text.  Exports makeBench(spec) -> { samples, sampleRate, song, truth[], secOf[], kind[] }
import { buildSong } from './round7-tester-make.mjs';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pcsOf(name) {
  const m = /^([A-G])([#b]?)(m?)(7?)/.exec(name);
  const root = (NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const p = [root, (root + (m[3] ? 3 : 4)) % 12, (root + 7) % 12];
  if (m[4]) p.push((root + 10) % 12);
  return p;
}
// section: { name, kind: 'stable'|'rubato'|'free'|'rapid', bpm, chords: [[name, beats]...], noiseDb? }
// opts: seed, rate, snrDb (global white noise, null = tiny), semis, cents
export function makeBench(sections, opts = {}) {
  const o = { seed: 7, rate: 22050, snrDb: null, semis: 0, cents: 0, lead: 1.0, ...opts };
  const R = rng(o.seed);
  const rate = o.rate;
  // timeline of events
  const events = []; // {name, t0, dur, sec, kind, bpm, beatInSec, nb, beatT: [times of beats]}
  let t = o.lead;
  sections.forEach((sec, si) => {
    let b = 0;
    const phase = R() * 6.28;
    const bt = (beat) => { // beat time offset inside the section
      if (sec.kind === 'rubato') { const spb = 60 / sec.bpm; return beat * spb * (1 + 0) + spb * 4.5 * Math.sin(0.15 * beat + phase) * 0.35 - spb * 4.5 * Math.sin(phase) * 0.35; }
      return beat * (60 / sec.bpm);
    };
    let tFree = 0;
    sec.chords.forEach(([name, beats], k) => {
      let t0, dur;
      if (sec.kind === 'free') { t0 = t + tFree; dur = 1.4 + R() * 2.4; tFree += dur; }
      else { t0 = t + bt(b); dur = bt(b + beats) - bt(b); }
      const beatT = []; for (let q = 0; q < beats; q++) beatT.push(t + bt(b + q));
      const drumT = beatT.slice();
      // sec.shift (in beats, negative = anticipated change): the chord strums of every event but the first of the section move, the drums stay on the grid
      if (sec.shift && b > 0) { const d = sec.shift * 60 / sec.bpm; for (let q = 0; q < beats; q++) beatT[q] += d; t0 += d; }
      events.push({ name, t0, dur, si, kind: sec.kind, bpm: sec.bpm, beatInSec: b, beatT, drumT });
      b += beats;
    });
    t = events[events.length - 1].t0 + events[events.length - 1].dur;
  });
  const total = t + 1.5;
  const N = Math.ceil(total * rate);
  const x = new Float32Array(N);
  const a440 = 440 * 2 ** (o.cents / 1200);
  const fOf = (pc, oct) => a440 * 2 ** ((pc + 12 * (oct - 4) - 9) / 12);
  const addNote = (f, t0, amp, tau, dur) => {
    const i0 = Math.floor(t0 * rate); const n = Math.min(Math.floor(dur * rate), N - i0);
    if (i0 < 0 || n <= 0) return;
    const nh = Math.min(9, Math.floor(rate / 2.2 / f));
    for (let h = 1; h <= nh; h++) {
      const w = (2 * Math.PI * f * h * (1 + 0.0004 * h * h)) / rate; const ah = amp / h ** 1.15; const th = tau / (1 + 0.35 * (h - 1)); const ph = R() * 6.28;
      for (let i = 0; i < n; i++) { const tt = i / rate; x[i0 + i] += ah * Math.exp(-tt / th) * Math.min(1, tt / 0.003) * Math.sin(w * i + ph); }
    }
  };
  const burst = (t0, amp, dur) => { const i0 = Math.floor(t0 * rate); const n = Math.min(Math.floor(dur * rate), N - i0); for (let i = 0; i < n; i++) x[i0 + i] += amp * (R() * 2 - 1) * Math.exp(-(i / rate) / (dur / 4)); };
  const kick = (t0, amp) => { const i0 = Math.floor(t0 * rate); const n = Math.min(Math.floor(0.16 * rate), N - i0); let ph = 0; for (let i = 0; i < n; i++) { const tt = i / rate; ph += (2 * Math.PI * (50 + 80 * Math.exp(-tt / 0.03))) / rate; x[i0 + i] += amp * Math.sin(ph) * Math.exp(-tt / 0.06); } };
  for (const ev of events) {
    const p = pcsOf(ev.name).map((q) => (q + o.semis + 12) % 12);
    const vo = [[p[0], 2], [p[2], 2], [p[0], 3], [p[1], 3], [p[2], 3], [p[0], 4]];
    if (ev.kind === 'free') {
      let tt = ev.t0, j = 0;
      while (tt < ev.t0 + ev.dur - 0.1) { addNote(fOf(vo[j % 6][0], vo[j % 6][1]), tt, 0.16, 0.9, 1.4); tt += 0.28 + R() * 0.22; j++; }
    } else {
      ev.beatT.forEach((bt0, q) => {
        vo.forEach(([pc, oct], s) => addNote(fOf(pc, oct), bt0 + s * 0.012, q === 0 ? 0.16 : 0.1, 0.9, Math.min(3.5, Math.max(0.5, ev.dur + 0.3))));
        { const gb = ev.beatInSec + q; const dt = ev.drumT[q]; if (gb % 2 === 0) kick(dt, 0.35); else burst(dt, 0.16, 0.12); }
      });
      addNote(fOf(p[0], 2), ev.t0, 0.22, 0.5, 1.2);
    }
  }
  // voice
  let tt = o.lead + 2;
  while (tt < total - 3) { const midi = 60 + Math.floor(R() * 14); const f = a440 * 2 ** ((midi - 69) / 12); const d = 0.35 + R() * 0.7; const i0 = Math.floor(tt * rate); const n = Math.min(Math.floor(d * rate), N - i0); let ph = 0; for (let i = 0; i < n; i++) { const u = i / rate; ph += (2 * Math.PI * f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * u))) / rate; x[i0 + i] += 0.07 * Math.sin(ph) * Math.min(1, u / 0.04) * Math.min(1, (d - u) / 0.05); } tt += d + (R() < 0.35 ? 0.5 + R() * 1.5 : 0.02); }
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = 0; i < N; i++) x[i] *= 0.9 / peak;
  if (o.snrDb !== null) { let s = 0; for (let i = 0; i < N; i++) s += x[i] * x[i]; const lvl = Math.sqrt(s / N) / 10 ** (o.snrDb / 20) * Math.sqrt(3); for (let i = 0; i < N; i++) x[i] += (R() * 2 - 1) * lvl; }
  else for (let i = 0; i < N; i++) x[i] += (R() * 2 - 1) * 0.004;
  // song
  const song = buildSong('bench-' + o.seed, 'Banco');
  song.chords = [...new Set(sections.flatMap((s) => s.chords.map((c) => c[0])))];
  song.sections = sections.map((sec) => {
    const lines = []; let cur = null;
    for (const [c, beats] of sec.chords) { if (!cur || cur.chords.length === 4) { cur = { lyric: 'uno due tre quattro cinque sei sette', chords: [] }; lines.push(cur); } cur.chords.push({ name: c, col: cur.chords.length * 6, beats }); }
    return { name: sec.name, bpm: sec.bpm || 80, bpmSource: 'edited', strumIndex: null, lines };
  });
  return { samples: x, sampleRate: rate, song, truth: events.map((e) => e.t0), secOf: events.map((e) => e.si), kind: events.map((e) => e.kind), durationSec: total, sections };
}
