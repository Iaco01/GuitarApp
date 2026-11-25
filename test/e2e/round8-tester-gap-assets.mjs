// Round 8 tester: audio files with music not in the sheet (a 20 s solo between Verse and Chorus; a 15 s foreign intro), seed 5,
// audio at the sheet pitch. Writes test-artifacts/round-8/assets/{solo20,intro15}.mp3 and gap-truth.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeTrack, makeForeign, concat } from './round8-tester-make.mjs';
import { writeWav, OUTDIR } from './round7-tester-make.mjs';
import { songEvents } from '../../src/analysis/autosync.js';
const A = join(OUTDIR, '..', '..', 'round-8', 'assets');
mkdirSync(A, { recursive: true });
const mp3 = (name, samples, rate) => { writeWav(join(A, name + '.wav'), samples, rate); const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', join(A, name + '.wav'), '-codec:a', 'libmp3lame', '-b:a', '128k', join(A, name + '.mp3')], { encoding: 'utf-8' }); if (r.status !== 0) throw new Error(r.stderr); };
const base = makeTrack({ seed: 5, semis: 0, cents: 0 });
const sr = base.sampleRate; const evs = songEvents(base.song);
const t = base.truth[evs.findIndex((e) => e.section === 2)];
const f = (chords, dur, seed, bpm) => makeForeign({ chords, bpm, seed, semis: 0, cents: 0 }).samples.subarray(0, Math.floor(dur * sr));
const solo = f(['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A'], 20, 7, 96);
mp3('solo20', concat([base.samples.subarray(0, Math.floor(t * sr)), solo, base.samples.subarray(Math.floor(t * sr))]), sr);
const intro = f(['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A'], 15, 8, 110);
mp3('intro15', concat([intro, base.samples]), sr);
writeFileSync(join(A, 'gap-truth.json'), JSON.stringify({ soloStart: t, soloEnd: t + 20, truth: base.truth, introLen: 15 }));
console.log('done', t);
