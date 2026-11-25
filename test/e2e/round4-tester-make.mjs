// Round 4 tester: synthetic track made with ffmpeg (not the implementer's generator) and the
// matching song as a library JSON. Expected onsets are computed here, independently of the app.
//
// Track: 2.345 s of silence, then 4 sections at 70 / 96 / 142 / 96 BPM. Every chord is a sine tone
// of its own pitch (220 Hz * 2^(k/12)) that starts exactly at its expected time and is followed by
// 25 ms of silence before the next change. The "Ponte" opens with a 4-beat rest bar (silence).
//
// Run: node test/e2e/round4-tester-make.mjs
//   -> test-artifacts/round-4/tester/{t4.wav,t4.mp3,t4-song.json,t4-song-wrong.json,t4-expected.json}
// t4-song-wrong.json declares the "Finale" at 97 BPM instead of 96 (for the BPM suggestion).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'test-artifacts', 'round-4', 'tester');
const FFMPEG = '/usr/bin/ffmpeg';
export const T4_OFFSET = 2.345;
const GAP = 0.025;
const RATE = 44100;

// [name, bpm, [[chord, beats], ...]]; chord null = rest bar
export const T4_SECTIONS = [
  ['Intro', 70, [['G', 4], ['C', 4]]],
  ['Strofa', 96, [['Am', 2], ['F', 2], ['C', 4], ['G', 2], ['D', 2]]],
  ['Ponte', 142, [[null, 4], ['D', 2], ['G', 2], ['Em', 2], ['C', 2], ['A', 4]]],
  ['Finale', 96, [['G', 4], ['D', 4], ['Em', 4], ['C', 4], ['G', 2], ['D', 2], ['Am', 4], ['C', 4], ['G', 4]]],
];

// expected events: { name, rest, startSec, durSec, sectionIndex }
export function t4Expected(offset = T4_OFFSET, bpms = T4_SECTIONS.map((s) => s[1])) {
  const ev = [];
  let t = offset;
  const sections = [];
  T4_SECTIONS.forEach(([name, , chords], si) => {
    const spb = 60 / bpms[si];
    const start = t;
    for (const [c, beats] of chords) {
      ev.push({ name: c || 'N.C.', rest: c === null, startSec: t, durSec: beats * spb, sectionIndex: si, beats });
      t += beats * spb;
    }
    sections.push({ name, startSec: start, endSec: t, bpm: bpms[si] });
  });
  return { events: ev, sections, endSec: t };
}

function song(bpmOverride = {}, id = 'tester-r4-song', title = 'Prova tester quattro') {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id,
    title,
    artist: 'Sintetico',
    difficulty: 'Beginner',
    tuning: 'E A D G B E',
    capo: 0,
    key: null,
    bpm: 70,
    timeSignature: [4, 4],
    strumming: [],
    chords: ['G', 'C', 'Am', 'F', 'D', 'Em', 'A'],
    sections: T4_SECTIONS.map(([name, bpm, chords], si) => {
      const lines = [];
      let cur = { lyric: 'uno due tre quattro cinque sei', chords: [] };
      for (const [c, beats] of chords) {
        if (c === null) {
          lines.push({ lyric: '', chords: [{ name: 'N.C.', rest: true, beats, col: 0 }] });
          continue;
        }
        cur.chords.push({ name: c, col: cur.chords.length * 5, beats });
        if (cur.chords.length === 4) {
          lines.push(cur);
          cur = { lyric: 'sette otto nove dieci undici', chords: [] };
        }
      }
      if (cur.chords.length) lines.push(cur);
      return { name, bpm: bpmOverride[si] || bpm, bpmSource: 'edited', strumIndex: null, lines };
    }),
    transpose: 0,
    timingSource: 'edited',
    view: { fontScale: 1, theme: 'dark', collapseRepeats: true, beatsPerChord: 4, showShapes: false },
    source: { fileName: 't4.mht', importedAt: now },
    importInfo: { method: 'spans', warnings: [] },
    updatedAt: now,
    audio: null,
  };
}

function library(s) {
  return JSON.stringify({ app: 'guitarapp', exportVersion: 1, exportedAt: new Date().toISOString(), songs: [s], settings: {} });
}

// one ffmpeg filter graph: silence, then for every event a tone (or silence) + gap, concatenated
function makeWav(path) {
  const { events } = t4Expected();
  const parts = [];
  parts.push(`anullsrc=r=${RATE}:cl=mono,atrim=duration=${T4_OFFSET}`);
  let k = 0;
  for (const e of events) {
    if (e.rest) {
      parts.push(`anullsrc=r=${RATE}:cl=mono,atrim=duration=${e.durSec.toFixed(6)}`);
    } else {
      const f = (220 * 2 ** (k / 12)).toFixed(3);
      k++;
      parts.push(`sine=frequency=${f}:sample_rate=${RATE}:duration=${(e.durSec - GAP).toFixed(6)},volume=0.5`);
      parts.push(`anullsrc=r=${RATE}:cl=mono,atrim=duration=${GAP}`);
    }
  }
  parts.push(`anullsrc=r=${RATE}:cl=mono,atrim=duration=1`);
  const graph = parts.map((p, i) => `${p}[a${i}]`).join(';') + ';' + parts.map((_, i) => `[a${i}]`).join('') + `concat=n=${parts.length}:v=0:a=1[out]`;
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-filter_complex', graph, '-map', '[out]', '-ac', '1', '-ar', String(RATE), path], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

// onsets found in a decoded file: first loud sample after >= 15 ms of quiet
export function decodeOnsets(path) {
  const r = spawnSync(FFMPEG, ['-loglevel', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const b = r.stdout;
  const x = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  const out = [];
  let quiet = RATE;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > 0.05) {
      if (quiet >= 0.015 * RATE) out.push(i / RATE);
      quiet = 0;
    } else quiet++;
  }
  return { onsets: out, durationSec: x.length / RATE };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const wav = join(OUT, 't4.wav');
  const mp3 = join(OUT, 't4.mp3');
  makeWav(wav);
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  writeFileSync(join(OUT, 't4-song.json'), library(song()));
  writeFileSync(join(OUT, 't4-song-wrong.json'), library(song({ 3: 97 }, 'tester-r4-song-b', 'Prova tester BPM sbagliato')));
  const exp = t4Expected();
  writeFileSync(join(OUT, 't4-expected.json'), JSON.stringify(exp, null, 1));
  const chordOnsets = exp.events.filter((e) => !e.rest).map((e) => e.startSec);
  for (const f of [wav, mp3]) {
    const d = decodeOnsets(f);
    const diffs = chordOnsets.map((t, i) => ((d.onsets[i] - t) * 1000));
    console.log(f.split('/').pop(), 'duration', d.durationSec.toFixed(3), 'onsets found', d.onsets.length, '/', chordOnsets.length,
      'onset error ms min', Math.min(...diffs).toFixed(1), 'max', Math.max(...diffs).toFixed(1));
  }
  console.log('expected end of last chord', exp.endSec.toFixed(3), 's; events', exp.events.length);
  readFileSync(wav);
}
