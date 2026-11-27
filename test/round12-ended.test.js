// Round 12 tester, bug 1 (fixed): at the end of the file the player says "stopped" (Play button, time 0) but the <audio> element keeps playing from the
// beginning: seekMedia(0) in the `ended` handler runs while the state is still 'playing' and calls el.play() on the new (exact) slice.  The round 11
// player (plain el.currentTime = 0) stopped for good.  Seen in Chromium with the real mp3 (element paused = false, media 0.25 -> 9.26 s after the end;
// test/e2e/round12-tester-end.cjs). Fixed: the ended handler sets the state to stopped before moving back to 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeAudio extends EventTarget {
  constructor() { super(); this.paused = true; this.currentTime = 0; this.src = ''; this.preload = ''; this.playbackRate = 1; this.defaultPlaybackRate = 1; this.duration = NaN; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() {}
}
globalThis.Audio = FakeAudio;
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
const { createAudioPlayer } = await import('../src/audio.js');

// MPEG 1 layer III 128 kbit/s 48 kHz stereo frames of 384 bytes (valid headers are all the scan needs)
function mp3(frames) {
  const out = new Uint8Array(384 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x94, 0x64], i * 384);
  return out;
}

test('at the end of the file the element is paused, not playing again from the start', async () => {
  const states = [];
  const player = createAudioPlayer({ timeline: { beats: [], events: [], sections: [] }, blob: new Blob([mp3(2000)], { type: 'audio/mpeg' }), onState: (s) => states.push(s) });
  assert.equal(await player.ready(), true, 'the stream is scanned (exact seeking on)');
  await player.playFromTime(10);
  assert.equal(player.getState(), 'playing');
  player.element.dispatchEvent(new Event('ended'));
  assert.equal(player.getState(), 'stopped');
  assert.equal(player.element.paused, true, 'the element must not keep playing after "stopped"');
  player.destroy();
});
