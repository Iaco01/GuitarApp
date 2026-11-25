import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, normalizeAudio, insertPause, removePause, validateSong, migrateSong } from '../src/model.js';
import { buildTimeline } from '../src/timeline.js';
import {
  audioAnchors, formatClock, clampLatencyMs, initialLatencyMs, setAnchor, removeAnchor,
  suggestSectionBpms, applyBpmSuggestion, mediaToCtxTime, createMediaClickCore, loopSeekTarget, matchAudioFile, listenFromSec,
} from '../src/audiosync.js';

const chords = (names, beats = 4) => ({ lyric: 'x', chords: names.map((name, i) => ({ name, col: i, beats })) });
const sec = (name, bpm, lines) => ({ name, bpm, bpmSource: bpm ? 'edited' : null, strumIndex: null, lines });
// A: 8 beats @60 (8 s), B: 8 beats @120 (4 s), C: 8 beats @60 (8 s)
const demo = () => createSong({
  bpm: 60,
  sections: [sec('A', 60, [chords(['G', 'D'])]), sec('B', 120, [chords(['Em', 'C'])]), sec('C', 60, [chords(['G', 'D'])])],
});
const audioOf = (over = {}) => ({ fileName: 'a.mp3', size: 10, durationSec: 30, offsetSec: 1.7, anchors: {}, metronome: false, ...over });

test('anchors: sections start from their anchor, the others follow with their own tempo', () => {
  const t = buildTimeline(demo(), { anchors: { 0: 1.7, 2: 13.7 } });
  assert.deepEqual(t.sections.map((s) => [s.startSec, s.endSec, s.anchored]), [[1.7, 9.7, true], [9.7, 13.7, false], [13.7, 21.7, true]]);
  assert.equal(t.events[0].startSec, 1.7);
  assert.equal(t.events[2].startSec, 9.7);
  assert.equal(t.events[4].startSec, 13.7);
  assert.equal(t.beats[8].timeSec, 9.7);
  assert.deepEqual(t.warnings, []);
});

test('anchors: without anchors the timeline is the old one, and an offset shifts everything', () => {
  const a = buildTimeline(demo());
  const b = buildTimeline(demo(), { anchors: { 0: 0 } });
  assert.deepEqual(a.events, b.events);
  const c = buildTimeline(demo(), { anchors: { 0: 3 } });
  assert.ok(c.events.every((e, i) => Math.abs(e.startSec - (a.events[i].startSec + 3)) < 1e-9));
});

test('anchors: non increasing or impossible anchors are ignored with a warning', () => {
  const t = buildTimeline(demo(), { anchors: { 0: 5, 1: 4, 2: 'x', 7: 9 } });
  assert.equal(t.warnings.length, 3);
  assert.deepEqual(t.sections.map((s) => s.startSec), [5, 13, 17]);
  const u = buildTimeline(demo(), { anchors: { 1: 10, 2: 10 } });
  assert.equal(u.warnings.length, 1);
  assert.equal(u.sections[2].startSec, 10 + 4);
});

test('anchors: the stretch between two anchors is filled exactly, squeezed or stretched, ratios kept', () => {
  const sq = buildTimeline(demo(), { anchors: { 0: 0, 2: 9 } }); // A+B need 12 s but have 9
  const st = buildTimeline(demo(), { anchors: { 0: 0, 2: 18 } }); // ... or have 18
  for (const [t, k] of [[sq, 0.75], [st, 1.5]]) {
    assert.ok(Math.abs(t.sections[1].endSec - t.sections[2].startSec) < 1e-9);
    assert.ok(Math.abs(t.sections[0].scale - k) < 1e-9 && Math.abs(t.sections[1].scale - k) < 1e-9);
    assert.equal(t.sections[0].savedBpm, 60);
    assert.ok(Math.abs(t.sections[0].bpm - 60 / k) < 1e-9 && Math.abs(t.sections[1].bpm - 120 / k) < 1e-9);
    assert.equal(t.sections[2].scale, 1); // after the last anchor: saved tempos
    for (let i = 1; i < t.events.length; i++) assert.ok(t.events[i].startSec >= t.events[i - 1].startSec);
  }
  // an event's tempo is the effective one too
  assert.ok(Math.abs(sq.events[0].bpm - 80) < 1e-9);
});

test('audioAnchors puts the offset on section 0', () => {
  assert.deepEqual(audioAnchors(audioOf({ anchors: { 2: 20 } })), { 0: 1.7, 2: 20 });
  assert.equal(audioAnchors(null), null);
});

test('setAnchor keeps anchors ordered and removeAnchor drops them', () => {
  const a = audioOf({ anchors: { 2: 20 } });
  assert.equal(setAnchor(a, 1, 12.3, 3).ok, true);
  assert.deepEqual(a.anchors, { 1: 12.3, 2: 20 });
  assert.equal(setAnchor(a, 1, 21, 3).ok, false);
  assert.equal(setAnchor(a, 1, 1.0, 3).ok, false);
  assert.equal(setAnchor(a, 0, 13, 3).ok, false);
  assert.equal(setAnchor(a, 0, 2, 3).ok, true);
  assert.equal(a.offsetSec, 2);
  assert.equal(setAnchor(a, 5, 40, 3).ok, false);
  removeAnchor(a, 1);
  assert.deepEqual(a.anchors, { 2: 20 });
  removeAnchor(a, 0);
  assert.equal(a.offsetSec, 2);
});

test('BPM suggestion between two anchors and up to the end of the song', () => {
  const s = demo(); // current 60 / 120 / 60, 8 s / 4 s / 8 s
  // A: 8 beats in 7.5 s -> error 0.5 s, suggestion
  const audio = audioOf({ offsetSec: 0, anchors: { 1: 7.5, 2: 11.5 }, endSec: 19.5 });
  const sug = suggestSectionBpms(s, audio);
  assert.equal(sug.length, 1);
  assert.deepEqual([sug[0].from, sug[0].to, sug[0].beats], [0, 0, 8]);
  assert.equal(sug[0].suggested, 64);
  assert.equal(sug[0].current, 60);
  // within tolerance (0.1 s late): nothing
  assert.deepEqual(suggestSectionBpms(s, audioOf({ offsetSec: 0, anchors: { 1: 8.1, 2: 12.1 }, endSec: 20.1 })), []);
  // a pair of sections between two anchors: one factor for both
  const two = suggestSectionBpms(s, audioOf({ offsetSec: 0, anchors: { 2: 10.5 } }));
  assert.equal(two.length, 1);
  assert.deepEqual([two[0].from, two[0].to, two[0].beats], [0, 1, 16]);
  assert.equal(two[0].factor, 12 / 10.5);
  assert.equal(two[0].current, 80);
  // without the end of the song the last interval has no suggestion
  assert.deepEqual(suggestSectionBpms(s, audioOf({ offsetSec: 0 })), []);
  applyBpmSuggestion(s, two[0]);
  assert.deepEqual(s.sections.map((x) => [x.bpm, x.bpmSource]), [[68.6, 'edited'], [137.1, 'edited'], [60, 'edited']]);
});

test('BPM suggestion handles a decimal tempo like 141.5', () => {
  const s = createSong({ bpm: 142, sections: [sec('V', 142, Array.from({ length: 9 }, () => chords(['G', 'D', 'Em', 'C'], 4)))] });
  const beats = 144;
  const sec2 = (beats / 141.5) * 60;
  const sug = suggestSectionBpms(s, { offsetSec: 2, anchors: {}, endSec: 2 + sec2 });
  assert.equal(sug[0].suggested, 141.5);
  assert.equal(sug[0].current, 142);
});

test('media time to context time', () => {
  assert.equal(mediaToCtxTime(11, { ctxNow: 100, mediaNow: 10, rate: 1 }), 101);
  assert.equal(mediaToCtxTime(11, { ctxNow: 100, mediaNow: 10, rate: 0.75 }).toFixed(6), (100 + 1 / 0.75).toFixed(6));
  assert.equal(mediaToCtxTime(9, { ctxNow: 100, mediaNow: 10, rate: 2 }), 99.5);
});

test('click core: lookahead, accent, rate, seek and no double clicks', () => {
  const tl = buildTimeline(demo(), { anchors: { 0: 0 } });
  const core = createMediaClickCore({ beats: tl.beats });
  core.reset(0);
  const first = core.pull({ ctxNow: 50, mediaNow: 0, rate: 1 });
  assert.deepEqual(first.map((c) => [c.index, c.accent]), [[0, true]]);
  assert.equal(core.pull({ ctxNow: 50, mediaNow: 0, rate: 1 }).length, 0, 'not pulled twice');
  const later = core.pull({ ctxNow: 50.95, mediaNow: 0.95, rate: 1 });
  assert.deepEqual(later.map((c) => c.index), [1]);
  assert.ok(Math.abs(later[0].when - 51) < 1e-9);
  // seek into section B (120 BPM): first click is the next beat at or after the new position
  core.reset(9.7);
  const afterSeek = core.pull({ ctxNow: 70, mediaNow: 9.95, rate: 1 });
  assert.equal(afterSeek[0].index, 12); // beat 11 is at 9.5 (before), beat 12 at 10.0
  assert.equal(afterSeek.length, 1);
  // exactly on a beat counts as that beat
  core.reset(10);
  assert.equal(core.pull({ ctxNow: 70, mediaNow: 10, rate: 1 })[0].index, 12);
  // slower playback stretches the click times
  core.reset(8);
  const slow = core.pull({ ctxNow: 10, mediaNow: 7.97, rate: 0.5 });
  assert.equal(slow[0].index, 8);
  assert.ok(Math.abs(slow[0].when - (10 + (8 - 7.97) / 0.5)) < 1e-9);
  // loop limit
  const lim = createMediaClickCore({ beats: tl.beats });
  lim.reset(6.5);
  const out = lim.pull({ ctxNow: 0, mediaNow: 7.95, rate: 1, limitSec: 8 });
  assert.ok(out.every((c) => c.mediaTime < 8));
});

test('loop seek target', () => {
  const s = { startSec: 10, endSec: 20 };
  assert.equal(loopSeekTarget(19.9, s), null);
  assert.equal(loopSeekTarget(20, s), 10);
  assert.equal(loopSeekTarget(20.4, s), 10);
  assert.equal(loopSeekTarget(5, null), null);
});

test('formatClock, latency helpers, file match, normalizeAudio', () => {
  assert.equal(formatClock(102.34), '1:42,3');
  assert.equal(formatClock(5), '0:05,0');
  assert.equal(formatClock(0), '0:00,0');
  assert.equal(formatClock(-1.25), '−0:01,3');
  assert.equal(clampLatencyMs(900), 400);
  assert.equal(clampLatencyMs(-500), -100);
  assert.equal(clampLatencyMs('x'), 0);
  assert.equal(initialLatencyMs(120, 0.3), 120);
  assert.equal(initialLatencyMs(undefined, 0.18), 180);
  assert.equal(initialLatencyMs(undefined, undefined), 0);
  assert.equal(matchAudioFile(audioOf(), { name: 'a.mp3', size: 10 }), 'same');
  assert.equal(matchAudioFile(audioOf(), { name: 'a.mp3', size: 11 }), 'different');
  assert.equal(listenFromSec(1.7), 0);
  assert.equal(listenFromSec(10), 8);
  const n = normalizeAudio({ fileName: 'x', size: 'bad', offsetSec: 2, anchors: { 1: 5, a: 3, 2: -1 }, junk: 1, endSec: 1 });
  assert.equal(n.size, 0);
  assert.deepEqual(n.anchors, { 1: 5 });
  assert.equal(n.endSec, undefined);
  assert.equal(normalizeAudio('x'), null);
  assert.equal(normalizeAudio(null), null);
});

test('pause rows: inserted at the start of a section, counted by the timeline, removable', () => {
  const s = demo();
  insertPause(s, 1);
  assert.deepEqual(s.sections[1].lines[0], { lyric: '', chords: [{ name: 'N.C.', rest: true, beats: 4, col: 0 }] });
  assert.equal(validateSong(s).ok, true);
  const t = buildTimeline(s);
  assert.equal(t.events[2].rest, true);
  assert.equal(t.events[2].startSec, 8);
  assert.equal(t.events[3].startSec, 8 + 2);
  assert.equal(t.totalBeats, 28);
  assert.equal(removePause(s, 1, 1, 0), false);
  assert.equal(removePause(s, 1, 0, 0), true);
  assert.equal(s.sections[1].lines.length, 1);
});

test('audio metadata survives migrateSong and is cleaned', () => {
  const s = migrateSong({ ...demo(), audio: { fileName: 'x.mp3', size: 5, durationSec: 3, offsetSec: 1, anchors: { 1: 2 }, metronome: true } });
  assert.equal(s.audio.offsetSec, 1);
  assert.deepEqual(s.audio.anchors, { 1: 2 });
  assert.equal(migrateSong({ ...demo(), audio: 'junk' }).audio, null);
  assert.equal(validateSong({ ...demo(), audio: 5 }).ok, false);
});
