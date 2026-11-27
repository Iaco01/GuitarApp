// Round 12 tester, bug 1: a chord held for 5 s (strummed once, it rings out) followed by the same chord strummed on every beat: the boundary of
// the second pair of G comes out one beat (+0.63..0.66 s) late, with the rule of samechord.js on or off (and in the round 11 engine). The
// first pair (held G at the end of a verse -> G at the start of the chorus) is right (+-40 ms).  `todo`: this file is not part of `npm test`
// (run it with: node --test "test/regression/*.test.js").  Pure synthetic, own synthesis: no real recording involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseAndAlign } from '../../src/analysis/autosync.js';
import { SHEET, buildSong } from '../e2e/round7-tester-make.mjs';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcsOf = (n) => { const m = /^([A-G])(m?)/.exec(n); const r = NOTE[m[1]]; return [r, (r + (m[2] ? 3 : 4)) % 12, (r + 7) % 12]; };
const rngf = (seed) => { let q = seed >>> 0 || 1; return () => { q ^= q << 13; q >>>= 0; q ^= q >>> 17; q ^= q << 5; q >>>= 0; return q / 4294967296; }; };

function render({ seed, tau, noise, rate = 22050, bpm = 96 }) {
  const R = rngf(seed); const spb = 60 / bpm;
  const verse = [['C', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['G', 4], ['Em', 4], ['G', 8, 'h']];
  const chorus = [['G', 4], ['C', 4], ['D', 4], ['Em', 4], ['G', 8, 'h'], ['G', 4], ['C', 4], ['D', 8, 'h']];
  const secs = [verse, chorus, verse, chorus, verse, chorus];
  SHEET.length = 0;
  for (const sc of secs) SHEET.push([sc === verse ? 'Verse' : 'Chorus', bpm, sc.map((c) => [c[0], c[1]])]);
  const events = []; let t = 1.0 + R();
  for (const sc of secs) for (const [name, q, h] of sc) { events.push({ name, t0: t, dur: q * spb, held: !!h }); t += q * spb; }
  const N = Math.ceil((t + 3) * rate); const x = new Float32Array(N);
  const addNote = (f, t0, amp, tauN, dur) => {
    const i0 = Math.floor(t0 * rate); const n = Math.min(Math.floor(dur * rate), N - i0);
    for (let h = 1; h <= 7; h++) {
      const fh = f * h * (1 + 0.0004 * h * h); if (fh > rate / 2.2) break;
      const a = amp / h ** 1.15; const th = tauN / (1 + 0.35 * (h - 1)); const w = (2 * Math.PI * fh) / rate; const ph = R() * 6.28;
      for (let i = 0; i < n; i++) { const tt = i / rate; x[i0 + i] += a * Math.exp(-tt / th) * Math.min(1, tt / 0.003) * Math.sin(w * i + ph); }
    }
  };
  for (const ev of events) {
    const [r, th, fi] = pcsOf(ev.name); const f = (pc, oct) => 440 * 2 ** ((pc + 12 * (oct - 4) - 9) / 12);
    const voicing = [[r, 2], [fi, 2], [r, 3], [th, 3], [fi, 3], [r, 4]];
    const strum = (t0, amp, nd) => voicing.forEach(([pc, oct], k) => addNote(f(pc, oct), t0 + k * 0.012 + (R() - 0.5) * 0.004, amp * (0.8 + 0.3 * R()), tau, nd));
    if (ev.held) strum(ev.t0, 0.16, Math.min(ev.dur + 0.5, 6));
    else for (let b = 0; b < Math.round(ev.dur / spb); b++) strum(ev.t0 + b * spb, b === 0 ? 0.16 : 0.1, 1.6);
  }
  for (let i = 0; i < N; i++) x[i] += (R() * 2 - 1) * noise;
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(x[i])); for (let i = 0; i < N; i++) x[i] *= 0.9 / pk;
  return { samples: x, rate, events };
}

test('held G (5 s, rings out) then the same G strummed on every beat: the boundary is the re-attack, not one beat later', { todo: 'tester round 12, bug 1: +0.63..0.66 s in 21 of 21 cases, rule on or off' }, () => {
  const tr = render({ seed: 3, tau: 1.1, noise: 0.004 });
  const song = buildSong('t12', 'Prova dodici');
  for (const sec of song.sections) for (const l of sec.lines) for (const c of l.chords) c.beats = 4;
  song.timingSource = 'default';
  for (const sec of song.sections) sec.bpmSource = 'default';
  const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.rate, song });
  const bad = [];
  for (let k = 1; k < tr.events.length; k++) {
    if (tr.events[k].name !== tr.events[k - 1].name) continue;
    const err = res.eventStartSec[k] - tr.events[k].t0;
    if (Math.abs(err) > 0.25) bad.push([k, Math.round(err * 1000)]);
  }
  assert.deepEqual(bad, [], 'identical consecutive chords more than 250 ms from the re-attack: ' + JSON.stringify(bad));
});
