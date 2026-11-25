import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, applyBpmChange, snapshotBpms, restoreBpms, effectiveSectionBpms } from '../src/model.js';
import { buildTimeline, beatPositionAtTime, timeAtBeatPosition, eventIndexAtTime } from '../src/timeline.js';
import { createPlayer } from '../src/player.js';

const song = () => createSong({
  bpm: 62,
  sections: [
    { name: 'A', bpm: 62, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 1, beats: 6 }] }] },
    { name: 'B', bpm: 96, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [{ name: 'C', col: 0, beats: 4 }] }] },
    { name: 'C', bpm: 142, bpmSource: 'strumming', strumIndex: null, lines: [{ lyric: 'x', chords: [{ name: 'Em', col: 0, beats: 8 }] }] },
  ],
});

test('applyBpmChange "all": every section scaled by the same factor, rounded to 0.1', () => {
  const s = song();
  const k = applyBpmChange(s, 0, 64, 'all');
  assert.ok(Math.abs(k - 64 / 62) < 1e-12);
  assert.deepEqual(s.sections.map((x) => x.bpm), [64, 99.1, 146.6]);
  assert.ok(s.sections.every((x) => x.bpmSource === 'edited'));
  assert.equal(s.bpm, 64);
  // ratios stay (within rounding)
  assert.ok(Math.abs(s.sections[1].bpm / s.sections[0].bpm - 96 / 62) < 0.003);
});

test('applyBpmChange "section": only that section, others untouched', () => {
  const s = song();
  applyBpmChange(s, 1, 100, 'section');
  assert.deepEqual(s.sections.map((x) => x.bpm), [62, 100, 142]);
  assert.deepEqual(s.sections.map((x) => x.bpmSource), ['strumming', 'edited', 'strumming']);
  assert.equal(s.bpm, 62);
});

test('applyBpmChange: inherited tempos become explicit; limits 30-300; undo restores', () => {
  const s = song();
  s.sections[1].bpm = null;
  s.sections[1].bpmSource = null;
  const snap = snapshotBpms(s);
  applyBpmChange(s, 0, 31, 'all');
  assert.ok(s.sections.every((x) => x.bpm >= 30 && x.bpm <= 300));
  applyBpmChange(s, 2, 1000, 'section');
  assert.equal(s.sections[2].bpm, 300);
  restoreBpms(s, snap);
  assert.deepEqual(s.sections.map((x) => [x.bpm, x.bpmSource]), [[62, 'strumming'], [null, null], [142, 'strumming']]);
  assert.equal(s.bpm, 62);
  assert.deepEqual(effectiveSectionBpms(s), [62, 62, 142]);
});

test('timeline: after a BPM change the beat position (event and beat fraction) is unchanged', () => {
  const s = song();
  const before = buildTimeline(s);
  const t = before.events[1].startSec + before.events[1].durSec * 0.37; // inside the 2nd chord
  const pos = beatPositionAtTime(before, t);
  const ev = eventIndexAtTime(before, t);
  for (const scope of ['all', 'section']) {
    const s2 = song();
    applyBpmChange(s2, 0, 70, scope);
    const after = buildTimeline(s2);
    const t2 = timeAtBeatPosition(after, pos);
    assert.equal(eventIndexAtTime(after, t2), ev);
    assert.ok(Math.abs(beatPositionAtTime(after, t2) - pos) < 1e-9);
    assert.ok(t2 < t); // faster tempo: same beat reached earlier
  }
});

test('player: setTimeline while playing keeps the current event and beat fraction', async () => {
  const s = song();
  const p = createPlayer({ timeline: buildTimeline(s), timeSignature: [4, 4] });
  await p.playFromTime(0.5, { count: false });
  await new Promise((r) => setTimeout(r, 80));
  const a = p.getInfo();
  assert.equal(a.state, 'playing');
  const posA = beatPositionAtTime(buildTimeline(s), a.timeSec);
  applyBpmChange(s, 0, 124, 'all');
  const tl2 = buildTimeline(s);
  p.setTimeline(tl2);
  const b = p.getInfo();
  const posB = beatPositionAtTime(tl2, b.timeSec);
  assert.equal(b.eventIndex, a.eventIndex);
  assert.ok(Math.abs(posB - posA) < 0.05, `${posA} -> ${posB}`); // only the few ms between the two reads
  assert.equal(b.state, 'playing');
  p.destroy();
});
