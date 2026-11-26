// Round 12: exact seeking in an mp3 (pure part): layout of the stream start and the cut point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMp3 } from '../src/mp3frames.js';
import { mp3Layout, mp3Kind, mp3DurationSec, planMp3Slice } from '../src/mp3seek.js';

// MPEG 1 layer III, 128 kbit/s, 48 kHz stereo: 384 bytes. Optional Xing + LAME tag in the first frame.
function stream(frames, { xing = null, delay = 576, tag = 'Xing' } = {}) {
  const len = 384;
  const out = new Uint8Array(len * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x94, 0x64], i * len);
  if (xing) {
    const p = 40; // 4 header + 32 side info (stereo) + 4 padding as written by LAME
    out.set([...tag].map((c) => c.charCodeAt(0)), p);
    out.set([0, 0, 0, 0x0f], p + 4);
    const q = p + 8 + 4 + 4 + 100 + 4;
    out.set([...'LAME3.100'].map((c) => c.charCodeAt(0)), q);
    out[q + 21] = delay >> 4; out[q + 22] = (delay & 15) << 4;
  }
  return out;
}

test('a stream with a Xing/LAME tag: the tag frame is not audio and the front loss is frame + delay + 529', () => {
  const b = stream(200, { xing: true });
  const scan = scanMp3(b);
  const lay = mp3Layout(b, scan);
  assert.deepEqual(lay, { tag: true, firstAudio: 1, frontSamples: 1152 + 576 + 529 });
  assert.equal(mp3Layout(b, scanMp3(stream(200, { xing: true, tag: 'Info' }))).tag, true);
});

test('a headerless stream has no front loss', () => {
  const b = stream(200);
  const lay = mp3Layout(b, scanMp3(b));
  assert.deepEqual(lay, { tag: false, firstAudio: 0, frontSamples: 0 });
  assert.equal(mp3Kind(b, scanMp3(b)).vbr, false);
  assert.ok(Math.abs(mp3DurationSec(scanMp3(b), lay) - (200 * 1152) / 48000) < 1e-9);
});

test('the slice starts a few frames before the wanted one, at an exact frame, never in the tag frame', () => {
  const b = stream(2000, { xing: true });
  const scan = scanMp3(b);
  const lay = mp3Layout(b, scan);
  const p = planMp3Slice(scan, lay, 30);
  const wantedFrame = Math.floor((30 * 48000 + lay.frontSamples) / 1152);
  assert.equal(p.frame, wantedFrame - 3);
  assert.equal(p.byteStart, scan.offsets[p.frame]);
  assert.ok(p.originSec <= 30 && 30 - p.originSec < 0.2);
  assert.equal(planMp3Slice(scan, lay, 0).frame, 1);
  assert.equal(planMp3Slice(scan, lay, 1e6).frame, 1999);
  const flat = stream(300);
  assert.equal(planMp3Slice(scanMp3(flat), { tag: false, firstAudio: 0, frontSamples: 0 }, 0).frame, 0);
});
