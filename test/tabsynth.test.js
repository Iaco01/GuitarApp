import test from 'node:test';
import assert from 'node:assert/strict';
import { midiToHz, tabNoteMidi, buildNotePlan, renderPluck, estimatePitch, SYNTH_STAGGER_SEC } from '../src/tabsynth.js';
import { parseTabText, TAB_STANDARD_MIDI } from '../src/tab.js';
import { buildTabTimeline } from '../src/tabplay.js';
import { createNoteScheduler } from '../src/player.js';
import { syntheticTabText, tabSystem } from './fixtures/tab-fixtures.mjs';

const cents = (a, b) => 1200 * Math.log2(a / b);

test('pitch of a string, a fret and the capo (written frets are relative to the capo)', () => {
  assert.equal(tabNoteMidi(TAB_STANDARD_MIDI, 6, 5, 0, 0), 40); // low E open
  assert.equal(tabNoteMidi(TAB_STANDARD_MIDI, 6, 0, 0, 0), 64); // high e open
  assert.equal(tabNoteMidi(TAB_STANDARD_MIDI, 6, 0, 2, 5), 71);
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToHz(40) - 82.4069) < 1e-3);
  const drop = [38, 45, 50, 55, 59, 64];
  assert.equal(tabNoteMidi(drop, 6, 5, 0, 0), 38);
});

test('Karplus-Strong string: the fundamental is within 10 cents, from low E to the 24th fret', () => {
  for (const midi of [40, 45, 52, 57, 64, 71, 76, 88]) {
    const hz = midiToHz(midi);
    const s = renderPluck(hz, { sampleRate: 44100, seconds: 0.6 });
    const est = estimatePitch(s, 44100);
    assert.ok(Math.abs(cents(est, hz)) <= 10, `midi ${midi}: ${est.toFixed(2)} vs ${hz.toFixed(2)} (${cents(est, hz).toFixed(1)} cents)`);
  }
  // other sample rate
  const s48 = renderPluck(196, { sampleRate: 48000, seconds: 0.6 });
  assert.ok(Math.abs(cents(estimatePitch(s48, 48000), 196)) <= 10);
});

test('the string sounds like a guitar: a short attack, a natural decay, the sound gets darker, no clipping', () => {
  const sr = 44100;
  const s = renderPluck(110, { sampleRate: sr, seconds: 2.5 });
  const rms = (a, b) => { let t = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) t += s[i] * s[i]; return Math.sqrt(t / ((b - a) * sr)); };
  assert.ok(rms(0, 0.05) > rms(0.5, 0.55) && rms(0.5, 0.55) > rms(1.5, 1.55) && rms(1.5, 1.55) > 0, 'decays');
  assert.ok(rms(1.5, 1.55) > 0.002, 'still audible after 1.5 s (a low string)');
  const high = renderPluck(880, { sampleRate: sr, seconds: 2.5 });
  const late = (x) => { let t = 0; for (let i = Math.floor(1.5 * sr); i < Math.floor(1.6 * sr); i++) t += x[i] * x[i]; return Math.sqrt(t / (0.1 * sr)); };
  assert.ok(late(high) < late(s), 'a high note dies sooner');
  // brightness: zero crossings rate per unit energy falls over time (darker)
  const zc = (a, b) => { let n = 0; for (let i = Math.floor(a * sr) + 1; i < Math.floor(b * sr); i++) if ((s[i - 1] < 0) !== (s[i] < 0)) n++; return n / (b - a); };
  assert.ok(zc(0, 0.1) >= zc(1.2, 1.3) - 1);
  assert.ok(Math.max(...s.map(Math.abs)) < 0.95);
  // the same string rendered twice is the same sound
  assert.deepEqual(Array.from(renderPluck(110, { seconds: 0.1 })), Array.from(renderPluck(110, { seconds: 0.1 })));
});

function song(text, extra = {}) { return Object.assign(parseTabText(text), extra); }

test('plan: one note per fret written, strums staggered from the bass up, durations to the next note on the string', () => {
  const s = parseTabText(syntheticTabText());
  s.capo = 0;
  const tl = buildTabTimeline(s);
  const plan = buildNotePlan(s, tl);
  const m0 = s.tab.parts[0].sections[0].measures[0];
  const expected = tl.events.reduce((n, ev) => n + s.tab.parts[0].sections[ev.sectionRef].measures[ev.measureIndex].columns.reduce((a, c) => a + c.notes.length, 0), 0);
  assert.equal(plan.length, expected);
  const ev0 = tl.events[0];
  const first = plan.filter((n) => n.startSec < ev0.startSec + m0.columns[0].pos * ev0.durSec + 0.2 && n.startSec <= ev0.startSec + ev0.durSec);
  // Am7 shape x 0 2 0 1 0: 5 notes in the first column, bass first, 11 ms apart
  const col0 = plan.slice(0, 5);
  assert.deepEqual(col0.map((n) => n.string), [4, 3, 2, 1, 0]);
  for (let i = 1; i < 5; i++) assert.ok(Math.abs(col0[i].startSec - col0[i - 1].startSec - SYNTH_STAGGER_SEC) < 1e-9);
  assert.ok(Math.abs(col0[0].hz - midiToHz(45)) < 1e-6, 'A string open');
  assert.ok(first.length >= 5);
  // sorted
  assert.ok(plan.every((n, i) => i === 0 || plan[i - 1].startSec <= n.startSec));
  // the last note of a measure rings to the end of the measure and the tail
  const lastOfFirst = plan.filter((n) => n.string === 4).find((n) => n.startSec > ev0.startSec + 0.3);
  assert.ok(lastOfFirst.endSec <= ev0.startSec + ev0.durSec + 0.36 + 1e-9);
});

test('plan: capo raises every note, speed 50% stretches the times and keeps the pitch', () => {
  const s = parseTabText(syntheticTabText());
  s.capo = 0;
  const a = buildNotePlan(s, buildTabTimeline(s));
  s.capo = 2;
  const b = buildNotePlan(s, buildTabTimeline(s));
  assert.ok(Math.abs(cents(b[0].hz, a[0].hz) - 200) < 1e-6);
  const half = buildNotePlan(s, buildTabTimeline(s, { speed: 0.5 }));
  assert.equal(half.length, b.length);
  assert.ok(Math.abs(half[7].hz - b[7].hz) < 1e-9);
  assert.ok(half[half.length - 1].startSec > 1.9 * b[b.length - 1].startSec - 0.5);
});

test('plan: techniques (slide, hammer-on, bend, vibrato, mute)', () => {
  const body = ['|--5h7--5/9--~---|', '|----------------|', '|--5b7-5r5-x----|', '|----------------|', '|----------------|', '|----------------|'];
  body[0] = '|--5h7--5/9-7~---|';
  const s = song(tabSystem(body, []).join('\n'));
  const plan = buildNotePlan(s, buildTabTimeline(s));
  const row0 = plan.filter((n) => n.string === 0);
  assert.equal(row0[0].tech, 'h');
  assert.equal(row0[1].legato, true, 'the 7 after the hammer-on has no new attack');
  assert.ok(row0[1].vel < row0[0].vel);
  const slide = row0[2];
  assert.equal(slide.tech, '/');
  assert.ok(slide.glide && Math.abs(cents(slide.glide.hz, midiToHz(slide.midi + 4)) ) < 1e-6, 'glides to the 9');
  assert.equal(row0[3].legato, true);
  const vib = row0[4];
  assert.equal(vib.vibrato, true);
  const row2 = plan.filter((n) => n.string === 2);
  assert.ok(row2[0].glide && row2[0].glide.hz > row2[0].hz, 'bend goes up to the 7');
  assert.ok(row2[2].glide && row2[2].glide.hz < row2[2].hz + 1e-9 || row2[2].glide.hz === row2[3].hz, 'release');
  const mute = plan.find((n) => n.mute);
  assert.ok(mute && mute.endSec - mute.startSec < 0.1);
});

test('plan: parts to play, and another part follows the same measures', () => {
  const s = parseTabText(syntheticTabText());
  const tl = buildTabTimeline(s, { guide: 0 });
  const one = buildNotePlan(s, tl, { guide: 0, parts: [0] });
  const both = buildNotePlan(s, tl, { guide: 0, parts: [0, 1] });
  assert.ok(both.length > one.length);
  assert.ok(both.some((n) => n.part === 1) && !one.some((n) => n.part === 1));
  const g1 = buildNotePlan(s, buildTabTimeline(s, { guide: 1 }), { guide: 1, parts: [1] });
  assert.ok(g1.length > 0 && g1.every((n) => n.part === 1));
});

test('note scheduler: lookahead, the same clock as the clicks, loop, seek', () => {
  const notes = [0, 0.5, 1, 1.5, 2, 2.5].map((t, i) => ({ startSec: t, i }));
  const sch = createNoteScheduler({ notes });
  sch.start({ fromSec: 0, offsetSec: 0, originCtx: 10 });
  assert.deepEqual(sch.pull(10).map((x) => x.note.i), [0]);
  assert.deepEqual(sch.pull(10.45).map((x) => x.note.i), [1]);
  assert.deepEqual(sch.pull(10.95).map((x) => x.note.i), [2]);
  assert.deepEqual(sch.pull(10.95).map((x) => x.note.i), [], 'no note twice');
  assert.deepEqual(sch.pull(12.5).map((x) => x.note.i), [5], 'notes 3 and 4 were late by more than the tolerance: dropped');
  // seek to 1.2 s of the song
  const sk = createNoteScheduler({ notes });
  sk.start({ fromSec: 1.2, offsetSec: 1.2, originCtx: 5 });
  const got = sk.pull(5.25);
  assert.deepEqual(got.map((x) => x.note.i), [3]);
  assert.ok(Math.abs(got[0].when - (5 + 0.3)) < 1e-9);
  // loop 0.5 .. 2.0: wraps and keeps the clock continuous
  const lp = createNoteScheduler({ notes, loop: { fromIdx: 1, toIdx: 4, startSec: 0.5, endSec: 2 } });
  lp.start({ fromSec: 0.5, offsetSec: 0.5, originCtx: 0 });
  const seen = [];
  for (let t = 0; t < 4.2; t += 0.05) for (const x of lp.pull(t)) seen.push([x.note.i, +x.when.toFixed(3)]);
  assert.deepEqual(seen.map((s) => s[0]), [1, 2, 3, 1, 2, 3, 1, 2, 3]);
  assert.deepEqual(seen.map((s) => s[1]).slice(0, 4), [0, 0.5, 1, 1.5]);
});
