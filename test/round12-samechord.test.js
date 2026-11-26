// Round 12: the boundary between two identical chords in a row is the re-attack (user report: the first G of Chorus 1 lasted
// seconds on the phone). Synthetic part runs everywhere; the real part (copyrighted recording, times only) skips without the
// local fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fixSameChordBoundaries, reattacks } from '../src/analysis/samechord.js';
import { computeFeatures } from '../src/analysis/features.js';
import { analyseAndAlign } from '../src/analysis/autosync.js';
import { loadReal, realSkip } from './fixtures/real-helper.mjs';

// a fake feature set: energy and onset envelopes built from a list of strums (time, level, decay s)
function fake(strums, dur) {
  const fps = 10.77, onsetFps = 86;
  const frames = Math.ceil(dur * fps);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { const t = f / fps; for (const [ts, lv, dc] of strums) if (t >= ts) energy[f] += lv * Math.exp(-(t - ts) / dc); }
  const onset = new Float32Array(Math.ceil(dur * onsetFps));
  for (const [ts, lv] of strums) onset[Math.round(ts * onsetFps)] = lv * 10;
  return { fps, frames, energy, onset, onsetFps };
}

test('synthetic: a boundary slid into the decay of the held chord goes back to the re-attack', () => {
  const feat = fake([[10, 1, 1.5], [30, 1, 1.5], [31, 0.6, 0.5]], 40);
  const events = [{ name: 'G', section: 0 }, { name: 'G', section: 0 }, { name: 'C', section: 0 }];
  for (const slid of [11.5, 15, 25, 29]) {
    const st = [10, slid, 31];
    const mv = fixSameChordBoundaries(feat, events, [0, 1, 2], st, 40);
    assert.equal(mv.length, 1);
    assert.ok(Math.abs(st[1] - 30) < 0.05, `slid ${slid} -> ${st[1]}`);
  }
  const ok = [10, 30.02, 31];
  assert.equal(fixSameChordBoundaries(feat, events, [0, 1, 2], ok, 40).length, 0, 'a boundary on the strum stays');
});

test('synthetic: different chords are never touched', () => {
  const feat = fake([[10, 1, 1.5], [30, 1, 1.5]], 40);
  const events = [{ name: 'G', section: 0 }, { name: 'C', section: 0 }, { name: 'D', section: 0 }];
  const st = [10, 15, 31];
  assert.equal(fixSameChordBoundaries(feat, events, [0, 1, 2], st, 40).length, 0);
  assert.equal(st[1], 15);
});

test('synthetic: the first chord of a section lasts like the first chord of its sisters', () => {
  const seq = ['G', 'C', 'D', 'G'];
  const events = [0, 1, 2].flatMap((section) => seq.map((name) => ({ name, section })));
  const times = [1, 3, 5, 7, 20, 22, 24, 26, 40, 42, 44, 46];
  const feat = fake([...times.map((t) => [t, 1, 1.5]), [13, 0.5, 4]], 55);
  const st = times.slice();
  st[4] = 9; // the first G of the second section slid into the decay of the last G of the first
  fixSameChordBoundaries(feat, events, events.map((_, j) => j), st, 50);
  assert.ok(Math.abs(st[4] - 20) < 0.05, `moved to ${st[4]}`);
  assert.equal(st[3], 7);
});

test('real song: event 35 (first G of Chorus 1) stays at the re-attack, also when the alignment slid it into the decay', { skip: realSkip }, () => {
  const real = loadReal();
  const { whole } = real;
  const t = whole.res.eventStartSec;
  assert.ok(t[35] >= 63.0 && t[35] <= 63.6 && t[36] - t[35] < 1.5, `event 35 at ${t[35]}, lasts ${t[36] - t[35]}`);
  // slide it by hand to several points of the decay and let the rule bring it back
  const X11 = new Float32Array(real.X.length / 4 | 0);
  for (let i = 0; i < X11.length; i++) X11[i] = real.X[i * 4];
  const feat = computeFeatures(X11);
  const events = real.evs;
  const present = events.map((_, j) => j);
  for (const slid of [57.95, 58.5, 59, 60, 61.5, 62.8]) {
    const st = Array.from(t);
    st[35] = slid;
    fixSameChordBoundaries(feat, events, present, st, feat.duration);
    assert.ok(st[35] >= 63.0 && st[35] <= 63.6, `slid to ${slid} came back to ${st[35]}`);
  }
  assert.ok(reattacks(feat, 58.5, 63.9, 2).some((c) => c.t > 63.3 && c.t < 63.6 && c.rise > 1.25));
});

test('real song: event 35 across decode variants (resampling, mono/stereo, re-encoding, shift, noise)', { skip: realSkip }, () => {
  const real = loadReal();
  const L = new URL('./fixtures/local/', import.meta.url).pathname;
  const dec = (args, ar) => {
    const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', ...args, '-f', 'f32le', '-ac', '1', '-ar', String(ar), '-'], { maxBuffer: 1 << 30 });
    const b = r.stdout;
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 4)));
  };
  const variants = {
    'soxr 22050': () => [dec(['-af', 'aresample=resampler=soxr'], 22050), 22050],
    'left channel 11025': () => [dec(['-af', 'pan=mono|c0=c0'], 11025), 11025],
    'shift +20 ms': () => [dec(['-af', 'adelay=20|20'], 11025), 11025],
    'shift -20 ms': () => [dec(['-ss', '0.02'], 11025), 11025],
    'noise 20 dB': () => {
      const x = dec([], 11025); let s = 7; let e = 0;
      for (const v of x) e += v * v;
      const a = Math.sqrt(e / x.length) * 0.1 * 3.46;
      for (let i = 0; i < x.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] += a * (s / 4294967296 - 0.5); }
      return [x, 11025];
    },
  };
  for (const [name, f] of Object.entries(variants)) {
    const [samples, sampleRate] = f();
    const res = analyseAndAlign({ samples, sampleRate, song: real.song });
    const t = res.eventStartSec;
    assert.ok(t[35] >= 63.0 && t[35] <= 63.6 && t[36] - t[35] < 1.5, `${name}: event 35 at ${t[35]}, lasts ${t[36] - t[35]}`);
  }
});
