// Synthetic audio for the round 4 tests (never used by the app, never committed as output).
// A short song with 3 sections at different BPM, 4 chords each (2 beats per chord). Every chord is a
// tone of its own pitch that starts exactly at the time the timeline expects it, after an initial
// silence of 1.7 s; a 30 ms silence precedes every new tone so that onsets are easy to detect.
// ffmpeg (only here, only for tests) turns the WAV into an mp3.
//
// Run: node test/fixtures/make-audio.mjs   -> test-artifacts/audio/{track.wav,track.mp3,track-b.wav,library.json}
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSong } from '../../src/model.js';
import { buildTimeline } from '../../src/timeline.js';

export const SYN_RATE = 48000;
export const SYN_OFFSET = 1.7;
const SYN_GAP = 0.03;
const SYN_NAMES = [['G', 'D', 'Em', 'C'], ['Am', 'F', 'C', 'G'], ['D', 'A', 'Bm', 'G']];
const SYN_BPMS = [120, 90, 150];

// The synthetic song (matches track.wav).
export function syntheticSong() {
  return createSong({
    id: 'synthetic-audio-song',
    title: 'Traccia di prova',
    artist: 'Sintetica',
    bpm: 120,
    chords: ['G', 'D', 'Em', 'C', 'Am', 'F', 'A', 'Bm'],
    sections: SYN_NAMES.map((names, si) => ({
      name: ['Strofa', 'Ponte', 'Finale'][si],
      bpm: SYN_BPMS[si],
      bpmSource: 'edited',
      strumIndex: null,
      lines: [{ lyric: 'la la la la', chords: names.map((name, i) => ({ name, col: i * 3, beats: 2 })) }],
    })),
  });
}

// Expected chord onsets (seconds in the audio) for the given real tempos of the three sections.
export function expectedOnsets(realBpms = SYN_BPMS, offset = SYN_OFFSET) {
  const out = [];
  let t = offset;
  realBpms.forEach((bpm, si) => {
    for (let i = 0; i < SYN_NAMES[si].length; i++) {
      out.push(t);
      t += (2 * 60) / bpm;
    }
  });
  return { onsets: out, end: t + 0.5 };
}

// Mono 16-bit PCM samples (Float32Array) of the track.
export function renderTrack(realBpms = SYN_BPMS, offset = SYN_OFFSET) {
  const { onsets, end } = expectedOnsets(realBpms, offset);
  const n = Math.ceil(end * SYN_RATE);
  const x = new Float32Array(n);
  onsets.forEach((start, k) => {
    const stop = k + 1 < onsets.length ? onsets[k + 1] - SYN_GAP : end - 0.05;
    const f = 330 * 2 ** (k / 12);
    const a = Math.round(start * SYN_RATE);
    const b = Math.round(stop * SYN_RATE);
    for (let i = a; i < b && i < n; i++) {
      const fade = Math.min(1, (i - a) / (0.003 * SYN_RATE));
      x[i] = 0.5 * fade * Math.sin((2 * Math.PI * f * (i - a)) / SYN_RATE);
    }
  });
  return x;
}

export function wavBytes(samples, rate = SYN_RATE) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return data;
}

// Times (seconds) at which a tone starts after silence: first sample above the threshold after at
// least 15 ms below it.
export function detectOnsets(samples, rate = SYN_RATE, threshold = 0.02) {
  const out = [];
  let quiet = rate; // samples since the last loud one
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      if (quiet >= 0.015 * rate) out.push(i / rate);
      quiet = 0;
    } else quiet++;
  }
  return out;
}

export function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
  return r.status === 0;
}

export function wavToMp3(wavPath, mp3Path) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3Path], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
}

// Decodes any file to mono float samples at SYN_RATE through ffmpeg (tests only).
export function decodeWithFfmpeg(path) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', path, '-ac', '1', '-ar', String(SYN_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out = join(root, 'test-artifacts', 'audio');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'track.wav'), wavBytes(renderTrack()));
  // variant where the middle section really runs at 92 BPM (for the BPM suggestion)
  writeFileSync(join(out, 'track-b.wav'), wavBytes(renderTrack([120, 92, 150])));
  const song = syntheticSong();
  writeFileSync(join(out, 'library.json'), JSON.stringify({ app: 'guitarapp', exportVersion: 1, exportedAt: new Date().toISOString(), songs: [song], settings: {} }));
  if (ffmpegAvailable()) {
    wavToMp3(join(out, 'track.wav'), join(out, 'track.mp3'));
    console.log('written track.wav, track.mp3, track-b.wav, library.json in', out);
  } else {
    console.log('ffmpeg not found: mp3 skipped');
  }
  const tl = buildTimeline(song, { anchors: { 0: SYN_OFFSET } });
  console.log('timeline onsets', tl.events.map((e) => e.startSec.toFixed(3)).join(' '));
}
