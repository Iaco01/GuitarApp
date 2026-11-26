// Round 12: exportable diagnostics (pure part).
import test from 'node:test';
import assert from 'node:assert/strict';
import { driftSummary, createDriftRecorder, buildDiagnostics } from '../src/diagnostics.js';

test('drift: slope and offsets of the media clock against the wall clock', () => {
  const s = [0, 10, 20, 30].map((w) => ({ wall: w, media: 5 + w * 1.001 }));
  const d = driftSummary(s, 1);
  assert.equal(d.slope, 1.001);
  assert.deepEqual(d.rows.map((r) => r.offsetMs), [0, 10, 20, 30]);
  assert.equal(driftSummary([]).slope, null);
});

test('the recorder keeps one sample per 10 s and starts over on reset', () => {
  const r = createDriftRecorder();
  for (let t = 0; t <= 35; t += 1) r.tick(t, NaN, t);
  assert.equal(r.summary().rows.length, 4); // 0, 10, 20, 30
  r.reset();
  assert.equal(r.summary().rows.length, 0);
});

test('the diagnostics carry times and counts only: no chord names, no text', () => {
  const song = { title: 'SECRET TITLE', audio: { fileName: 'secret.mp3', anchors: [1, 2], alignment: { eventStartSec: Array.from({ length: 100 }, (_, i) => i), names: ['Am', 'G'], decode: { method: 'pieces', pieceShiftsMs: [0.1] }, createdAt: 'x', accepted: true, musicEndSec: 99 } } };
  const d = buildDiagnostics({ userAgent: 'UA', device: { latencyMs: -150 }, song });
  const text = JSON.stringify(d);
  assert.ok(!/SECRET|secret|"Am"|"G"/.test(text));
  assert.equal(d.alignment.firstEventTimesSec.length, 60);
  assert.equal(d.latencyMs, -150);
  assert.equal(d.alignment.decode.method, 'pieces');
});
