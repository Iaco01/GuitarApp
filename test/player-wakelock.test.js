// Regression: pausing before the wake lock request is granted must not leave the lock held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../src/player.js';
import { buildTimeline } from '../src/timeline.js';
import { createSong } from '../src/model.js';

const song = createSong({
  bpm: 120,
  sections: [{ name: 'A', bpm: 120, bpmSource: 'edited', strumIndex: null, lines: [{ lyric: 'x', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 1, beats: 4 }] }] }],
});

test('bug W1: pausing before the wake lock is granted leaves the lock held', async () => {
  let active = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { wakeLock: { request: () => new Promise((res) => setTimeout(() => { active++; res({ addEventListener() {}, release() { active--; return Promise.resolve(); } }); }, 50)) } },
  });
  const p = createPlayer({ timeline: buildTimeline(song), timeSignature: [4, 4] });
  p.play();
  await new Promise((r) => setTimeout(r, 10)); // request still pending
  p.pause();
  await new Promise((r) => setTimeout(r, 200));
  const held = active;
  p.destroy();
  assert.equal(held, 0, 'wake lock still held after pause (screen would stay on while paused)');
});
