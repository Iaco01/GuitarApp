// Round 8 tester: builds the audio files used by round8-tester-c-app.cjs in test-artifacts/round-8/assets/ (synthetic, no song text).
// node test/e2e/round8-tester-assets.mjs
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeTrack, addNoiseSnr } from './round8-tester-make.mjs';
import { writeWav, OUTDIR } from './round7-tester-make.mjs';
import { makeBench } from './round8-tester-bench.mjs';
const A = join(OUTDIR, '..', '..', 'round-8', 'assets');
mkdirSync(A, { recursive: true });
const mp3 = (name, samples, rate) => {
  writeWav(join(A, name + '.wav'), samples, rate);
  const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', join(A, name + '.wav'), '-codec:a', 'libmp3lame', '-b:a', '128k', join(A, name + '.mp3')], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  console.log('wrote', name);
};
// NB: the song used by the app test is the round 7 tester song (r7-song.json = SHEET of round7-tester-make.mjs): audio semis 1 / cents -25 by default there,
// here the audio is made with semis 0 so that "right song" means no transposition proposal.
const base = makeTrack({ seed: 5, semis: 0, cents: 0 });
mp3('right', base.samples, base.sampleRate);
mp3('right-snr5', addNoiseSnr(base.samples, 5, 77), base.sampleRate);
mp3('right-snr-5', addNoiseSnr(base.samples, -5, 77), base.sampleRate);
mp3('right-snr-10', addNoiseSnr(base.samples, -10, 77), base.sampleRate);
for (const s of [2, -5]) { const t = makeTrack({ seed: 5, semis: s, cents: 0 }); mp3(`transp${s > 0 ? '+' : ''}${s}`, t.samples, t.sampleRate); }
const other = makeBench([
  { name: 'A', kind: 'stable', bpm: 100, chords: [['Dm', 4], ['Bb', 4], ['Gm', 4], ['A', 4], ['Dm', 4], ['Bb', 4], ['F', 4], ['A', 4]] },
  { name: 'B', kind: 'stable', bpm: 120, chords: [['E', 4], ['B', 4], ['C#m', 4], ['A', 4], ['E', 4], ['B', 4], ['A', 4], ['E', 4]] },
  { name: 'C', kind: 'stable', bpm: 80, chords: [['F#m', 4], ['D', 4], ['A', 4], ['E', 4], ['F#m', 4], ['D', 4], ['A', 4], ['E', 4]] },
  { name: 'D', kind: 'stable', bpm: 110, chords: [['Bb', 4], ['Eb', 4], ['Cm', 4], ['F', 4], ['Bb', 4], ['Eb', 4], ['F', 4], ['Bb', 4]] },
], { seed: 3 });
mp3('other', other.samples, other.sampleRate);
// silence 120 s
mp3('silence', new Float32Array(120 * 22050), 22050);
