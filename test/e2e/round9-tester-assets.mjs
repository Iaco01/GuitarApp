// Round 9 tester: audio assets for the app tests (synthetic only; written to test-artifacts/round-9/assets, never committed).
//   node test/e2e/round9-tester-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeTrack, makeForeign, concat, secOfEvents } from './round8-tester-make.mjs';
import { writeWav } from './round7-tester-make.mjs';
import { songEvents } from '../../src/analysis/autosync.js';
const A = '/home/user/guitarapp/test-artifacts/round-9/assets';
mkdirSync(A, { recursive: true });
const mp3 = (name, samples, rate) => { writeWav(join(A, name + '.wav'), samples, rate); const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', join(A, name + '.wav'), '-ac', '2', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '128k', join(A, name + '.mp3')], { encoding: 'utf-8' }); if (r.status !== 0) throw new Error(r.stderr); };
const base = makeTrack({ seed: 91, semis: 0, cents: 0 });
const sr = base.sampleRate; const evs = songEvents(base.song);
const idx = (si) => secOfEvents(evs, si);
const tS = (si) => base.truth[idx(si)[0]];
const tE = (si) => { const l = idx(si); return l[l.length - 1] + 1 < base.truth.length ? base.truth[l[l.length - 1] + 1] : base.meta.durationSec; };
const slice = (a, b) => base.samples.subarray(Math.floor(a * sr), Math.floor(b * sr));
const fx = (dur, seed, bpm = 96) => { const ch = ['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A']; return makeForeign({ chords: Array.from({ length: 60 }, (_, i) => ch[i % 8]), bpm, seed, semis: 0, cents: 0, rate: sr }).samples.subarray(0, Math.floor(dur * sr)); };
const silence = (s) => new Float32Array(Math.floor(s * sr));
const truth = { base: base.truth, dur: base.meta.durationSec };
const at = tS(4); // before the 2nd Verse
for (const L of [6, 20]) {
  mp3('gap' + L, concat([slice(0, at), fx(L, 5 + L), slice(at, base.meta.durationSec)]), sr);
  truth['gap' + L] = { start: at, end: at + L };
}
mp3('gap2', concat([slice(0, at), fx(2, 9), slice(at, base.meta.durationSec)]), sr); truth.gap2 = { start: at, end: at + 2 };
// Bridge (5) removed from the middle -> skipped section in the middle
mp3('nobridge', concat([slice(0, tS(5)), slice(tE(5), base.meta.durationSec)]), sr); truth.nobridge = { removed: [tS(5), tE(5)] };
mp3('cut70', base.samples.subarray(0, Math.floor(base.meta.durationSec * 0.7 * sr)), sr);
for (const P of [40, 200, 400]) { mp3('pad' + P, concat([silence(P), base.samples]), sr); truth['pad' + P] = { prefix: P }; }
mp3('plain', base.samples, sr);
writeFileSync(join(A, 'truth.json'), JSON.stringify(truth));
console.log('done; gap at', at.toFixed(1), 'sections', base.song.sections.map((s) => s.name).join(','));
