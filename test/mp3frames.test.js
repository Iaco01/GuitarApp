// Round 9: the MP3 frame scanner (used to decode long songs in pieces).
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMp3 } from '../src/mp3frames.js';

// MPEG 1 layer III, 128 kbit/s, 44.1 kHz: 417 bytes (418 with padding), 1152 samples
function stream(frames, { id3 = 0, trailer = 0, rateBits = 0, pad = false } = {}) {
  const sr = [44100, 48000, 32000][rateBits];
  const len = Math.floor((144 * 128000) / sr) + (pad ? 1 : 0);
  const parts = [];
  if (id3) { const h = new Uint8Array(10 + id3); h.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, (id3 >> 7) & 0x7f, id3 & 0x7f]); parts.push(h); }
  for (let i = 0; i < frames; i++) { const f = new Uint8Array(len); f.set([0xff, 0xfb, 0x90 | (rateBits << 2) | (pad ? 2 : 0), 0x00]); parts.push(f); }
  if (trailer) parts.push(new Uint8Array(trailer).fill(0x41));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('scans the frames of a layer III stream, after an ID3 tag, with a trailing tag', () => {
  const s = scanMp3(stream(300, { id3: 500, trailer: 128 }));
  assert.ok(s);
  assert.equal(s.sampleRate, 44100);
  assert.equal(s.spf, 1152);
  assert.equal(s.offsets.length, 301);
  assert.equal(s.offsets[0], 510);
  assert.equal(s.offsets[1] - s.offsets[0], 417);
});

test('the padding bit makes the frame one byte longer', () => {
  const s = scanMp3(stream(150, { pad: true }));
  assert.equal(s.offsets[1] - s.offsets[0], 418);
});

test('not a layer III stream, too few frames, or a change of sample rate: null (the whole file is decoded instead)', () => {
  assert.equal(scanMp3(new Uint8Array(5000).fill(7)), null);
  assert.equal(scanMp3(stream(20)), null);
  const a = stream(150);
  const b = stream(150, { rateBits: 1 }); // 48 kHz: another frame length
  const mixed = new Uint8Array(a.length + b.length); mixed.set(a); mixed.set(b, a.length);
  assert.equal(scanMp3(mixed), null);
});

test('garbage between frames is skipped (the frame after it must follow exactly)', () => {
  const a = stream(150);
  const g = new Uint8Array(37).fill(0xff);
  const b = stream(150);
  const all = new Uint8Array(a.length + g.length + b.length); all.set(a); all.set(g, a.length); all.set(b, a.length + g.length);
  const s = scanMp3(all);
  assert.ok(s && s.offsets.length >= 300);
});
