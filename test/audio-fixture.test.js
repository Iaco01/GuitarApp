import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTimeline } from '../src/timeline.js';
import { audioAnchors } from '../src/audiosync.js';
import { syntheticSong, expectedOnsets, renderTrack, wavBytes, detectOnsets, SYN_OFFSET, SYN_RATE, ffmpegAvailable, wavToMp3, decodeWithFfmpeg } from './fixtures/make-audio.mjs';

test('synthetic track: tone onsets are where the timeline expects the chord changes', () => {
  const song = syntheticSong();
  const tl = buildTimeline(song, { anchors: audioAnchors({ offsetSec: SYN_OFFSET }) });
  const onsets = detectOnsets(renderTrack());
  assert.equal(onsets.length, tl.events.length);
  assert.equal(tl.events.length, 12);
  onsets.forEach((t, i) => assert.ok(Math.abs(t - tl.events[i].startSec) < 0.002, `chord ${i}: ${t} vs ${tl.events[i].startSec}`));
  assert.ok(Math.abs(onsets[0] - 1.7) < 0.002, 'initial silence of 1.7 s');
  assert.deepEqual(expectedOnsets().onsets.map((x) => Math.round(x * 1000)), tl.events.map((e) => Math.round(e.startSec * 1000)));
});

test('synthetic track survives an mp3 round trip within a few ms (needs ffmpeg)', { skip: ffmpegAvailable() ? false : 'ffmpeg assente' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gapp-audio-'));
  const wav = join(dir, 't.wav');
  const mp3 = join(dir, 't.mp3');
  writeFileSync(wav, wavBytes(renderTrack()));
  wavToMp3(wav, mp3);
  const onsets = detectOnsets(decodeWithFfmpeg(mp3), SYN_RATE, 0.05);
  const want = expectedOnsets().onsets;
  assert.equal(onsets.length, want.length);
  onsets.forEach((t, i) => assert.ok(Math.abs(t - want[i]) < 0.03, `chord ${i}: ${t} vs ${want[i]}`));
});
