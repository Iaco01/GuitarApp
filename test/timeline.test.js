import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTimeline, eventIndexAtTime, beatIndexAtTime } from '../src/timeline.js';
import { createSong } from '../src/model.js';
import { parseSongFromMht } from '../src/parser.js';

const chords = (names, beats = 4) => ({ lyric: 'x', chords: names.map((name, i) => ({ name, col: i, beats })) });
const sec = (name, bpm, lines) => ({ name, bpm, bpmSource: bpm ? 'edited' : null, strumIndex: null, lines });

const demo = () => createSong({
  bpm: 60,
  sections: [sec('A', 60, [chords(['G', 'D'])]), sec('B', 120, [chords(['Em', 'C'], 2)])],
});

test('timeline: events, beat grid and totals', () => {
  const t = buildTimeline(demo());
  assert.equal(t.totalBeats, 12);
  assert.equal(t.totalSec, 8 + 2);
  assert.deepEqual(t.events.map((e) => [e.ref, e.startBeat, e.beats, e.startSec, e.durSec, e.bpm]), [
    ['0.0.0', 0, 4, 0, 4, 60], ['0.0.1', 4, 4, 4, 4, 60], ['1.0.0', 8, 2, 8, 1, 120], ['1.0.1', 10, 2, 9, 1, 120],
  ]);
  assert.equal(t.beats.length, 12);
  assert.deepEqual(t.beats.slice(6, 10).map((b) => [b.timeSec, b.eventIndex, b.beatInBar, b.isDownbeat]),
    [[6, 1, 2, false], [7, 1, 3, false], [8, 2, 0, true], [8.5, 2, 1, false]]);
  assert.deepEqual(t.sections.map((s) => [s.startSec, s.endSec, s.startBeat, s.endBeat, s.bpm]), [[0, 8, 0, 8, 60], [8, 10, 8, 12, 120]]);
});

test('timeline: beatInBar restarts at every section', () => {
  const song = createSong({ bpm: 60, sections: [sec('A', 60, [chords(['G'], 3)]), sec('B', 60, [chords(['D'], 3)])] });
  const t = buildTimeline(song);
  assert.deepEqual(t.beats.map((b) => b.beatInBar), [0, 1, 2, 0, 1, 2]);
});

test('timeline: lookups at the edges, exactly on a change the new chord is current', () => {
  const t = buildTimeline(demo());
  assert.equal(eventIndexAtTime(t, -0.001), -1);
  assert.equal(eventIndexAtTime(t, 0), 0);
  assert.equal(eventIndexAtTime(t, 3.999), 0);
  assert.equal(eventIndexAtTime(t, 4), 1);
  assert.equal(eventIndexAtTime(t, 7.999), 1);
  assert.equal(eventIndexAtTime(t, 8), 2); // tempo change boundary
  assert.equal(eventIndexAtTime(t, 8.999), 2);
  assert.equal(eventIndexAtTime(t, 9), 3);
  assert.equal(eventIndexAtTime(t, 100), 3);
  assert.equal(beatIndexAtTime(t, -1), -1);
  assert.equal(beatIndexAtTime(t, 8.5), 9);
  assert.equal(beatIndexAtTime(t, 8.49), 8);
});

test('timeline: speed 0.5 doubles every time', () => {
  const a = buildTimeline(demo());
  const b = buildTimeline(demo(), { speed: 0.5 });
  assert.equal(b.totalSec, a.totalSec * 2);
  assert.deepEqual(b.events.map((e) => e.startSec), a.events.map((e) => e.startSec * 2));
  assert.equal(b.totalBeats, a.totalBeats);
});

test('timeline: empty sections and empty songs', () => {
  const t = buildTimeline(createSong({ sections: [sec('Intro', null, []), sec('A', null, [chords(['G'], 1)])] }));
  assert.equal(t.totalBeats, 1);
  assert.equal(t.totalSec, 0.75); // default 80 bpm
  assert.deepEqual(t.sections.map((s) => [s.startBeat, s.endBeat]), [[0, 0], [0, 1]]);
  const e = buildTimeline(createSong());
  assert.equal(e.totalSec, 0);
  assert.equal(eventIndexAtTime(e, 1), -1);
});

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'american-pie.mht');
// Round 6: durations are now estimated; with an average of 4 beats per chord the song total is still 4 x chords
// (every section is a whole number of bars), so these totals hold, but for a different reason than in round 2.
test('real file: default timeline totals and tempo change at Verse 1 -> Chorus', { skip: existsSync(FILE) ? false : 'file reale assente' }, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  const t = buildTimeline(song);
  assert.equal(t.events.length, 328);
  assert.equal(t.totalBeats, 1312);
  const v1 = t.sections[0];
  const ch = t.sections[1];
  assert.equal(v1.bpm, 62);
  assert.equal(ch.bpm, 96);
  assert.equal(ch.startSec, v1.endSec);
  assert.ok(Math.abs(v1.endSec - (v1.endBeat * 60) / 62) < 1e-9);
  const firstChorus = t.events.findIndex((e) => e.sectionIndex === 1);
  assert.equal(eventIndexAtTime(t, v1.endSec), firstChorus);
  assert.equal(eventIndexAtTime(t, v1.endSec - 1e-6), firstChorus - 1);
  const expected = t.sections.reduce((a, s) => a + ((s.endBeat - s.startBeat) * 60) / s.bpm, 0);
  assert.ok(Math.abs(t.totalSec - expected) < 1e-6);
});
