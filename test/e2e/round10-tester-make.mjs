// Round 10 tester, A2: synthetic song whose chords last 1, 2, 3, 4 and 8 quarters (the sheet says 4 for every chord, the audio
// has the real durations). Uses the generator of round7-tester-make.mjs with an own SHEET (mutated in place).
// CLI: node test/e2e/round10-tester-make.mjs -> test-artifacts/round-10/synth/{r10.mp3,r10-song.json,r10-truth.json}
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeTrack, SHEET, buildSong, library, writeWav } from './round7-tester-make.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
export const OUTDIR = join(ROOT, 'test-artifacts', 'round-10', 'synth');
// [name, bpm, [[chord, quarters]]]
export const NEW_SHEET = [
  ['Intro', 100, [['G', 4], ['D', 4], ['Em', 4], ['C', 4], ['G', 4], ['D', 8]]],
  ['Mix A', 100, [['Am', 1], ['F', 1], ['C', 2], ['G', 4], ['Am', 3], ['F', 1], ['C', 8], ['G', 4], ['Dm', 2], ['E', 2], ['Am', 4], ['F', 4]]],
  ['Mix B', 92, [['C', 2], ['G', 2], ['Am', 1], ['F', 3], ['C', 4], ['G', 4], ['D', 2], ['Em', 2], ['G', 8], ['C', 4], ['D', 4], ['G', 4]]],
  ['Free', null, [['Em', 4], ['A', 4], ['D', 4], ['G', 4], ['Bm', 4], ['E', 4]]],
  ['Mix C', 120, [['Dm', 2], ['Gm', 2], ['A', 4], ['Dm', 4], ['Bb', 1], ['F', 1], ['C', 2], ['A', 8], ['Dm', 4], ['Gm', 4]]],
  ['Outro', 100, [['G', 4], ['C', 4], ['D', 4], ['G', 8]]],
];
SHEET.length = 0;
for (const s of NEW_SHEET) SHEET.push(s);

export function build() {
  const tr = makeTrack({ rate: 44100, semis: 0, cents: 0 });
  const song = buildSong('tester-r10-song', 'Prova tester dieci');
  for (const sec of song.sections) for (const l of sec.lines) for (const c of l.chords) c.beats = 4; // sheet: every chord 4 quarters
  song.timingSource = 'default';
  for (const sec of song.sections) sec.bpmSource = 'default';
  return { tr, song };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUTDIR, { recursive: true });
  const { tr, song } = build();
  writeWav(join(OUTDIR, 'r10.wav'), tr.samples, tr.sampleRate);
  const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', join(OUTDIR, 'r10.wav'), '-codec:a', 'libmp3lame', '-b:a', '128k', join(OUTDIR, 'r10.mp3')], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  writeFileSync(join(OUTDIR, 'r10-song.json'), library(song));
  const flat = tr.meta.timeline.filter((e) => e.sheetIdx >= 0).map((e) => ({ idx: e.sheetIdx, name: e.name, t0: e.t0, dur: e.dur, beats: e.beats, bpm: e.secBpm, section: e.sec.sheetSection }));
  writeFileSync(join(OUTDIR, 'r10-truth.json'), JSON.stringify({ events: flat, durationSec: tr.meta.durationSec }, null, 1));
  console.log('events', flat.length, 'duration', tr.meta.durationSec.toFixed(1));
}
