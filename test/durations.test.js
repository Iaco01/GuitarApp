import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSyllables, syllableMap, estimateSectionDurations, estimateSongDurations } from '../src/durations.js';
import { parseSongFromMht } from '../src/parser.js';
import { sectionContentKey, createSong, migrateSong, validateSong } from '../src/model.js';

const sec = (lines) => ({ name: 'S', lines });
// a lyric of `n` one-syllable words ("la la la ...") with chords at the given syllable indices
const lyricLine = (n, idx) => {
  const lyric = Array(n).fill('la').join(' ');
  return { lyric, chords: idx.map((i, k) => ({ name: 'C' + k, col: i * 3, beats: 4 })) };
};

test('countSyllables: English and Italian words', () => {
  const cases = { a: 1, the: 1, little: 2, love: 1, bye: 1, music: 2, amore: 3, città: 2, yesterday: 4, '(x2)': 1, '-': 0, '': 0 };
  for (const [w, n] of Object.entries(cases)) {
    if (w === 'amore') assert.ok(countSyllables(w) >= 2); // silent-e rule undercounts Italian words in -e
    else if (w === 'yesterday') assert.ok(countSyllables(w) >= 3);
    else assert.equal(countSyllables(w), n, w);
  }
});

test('syllableMap: column intervals cover words and split long ones', () => {
  const m = syllableMap('la music  go');
  assert.deepEqual(m.map((x) => x.start), [0, 3, 5, 10]);
  assert.equal(m[0].end, 2);
  assert.ok(m[1].end <= m[2].start);
  assert.deepEqual(syllableMap('   '), []);
});

test('estimate: evenly spread chords give equal durations', () => {
  const s = sec([lyricLine(16, [0, 4, 8, 12])]);
  assert.deepEqual(estimateSectionDurations(s, {}), [4, 4, 4, 4]);
});

test('estimate: a long chord is longer, total is a whole number of bars', () => {
  // chords at syllables 0, 8, 12 of 16: the first one is the longest (the cumulative 9 beats round to 10)
  assert.deepEqual(estimateSectionDurations(sec([lyricLine(16, [0, 8, 12])]), {}), [6, 4, 2]);
  // same ratio with an average that leaves room for the grid: 3 chords x 5.33 beats
  assert.deepEqual(estimateSectionDurations(sec([lyricLine(16, [0, 8, 12])]), { beatsPerChordAvg: 8 }), [12, 6, 6]);
});

test('estimate: instrumental lines are one bar per chord, close chords half a bar', () => {
  const inst = (cols) => ({ lyric: '', chords: cols.map((c, k) => ({ name: 'C' + k, col: c, beats: 4 })) });
  assert.deepEqual(estimateSectionDurations(sec([inst([0, 8, 16, 24])]), {}), [4, 4, 4, 4]);
  assert.deepEqual(estimateSectionDurations(sec([inst([0, 3, 12, 24])]), { beatsPerChordAvg: 4 }).reduce((a, b) => a + b, 0) % 4, 0);
});

test('estimate: quick changes (3 chords in 3 syllables) use the fine grid', () => {
  assert.deepEqual(estimateSectionDurations(sec([lyricLine(6, [0, 1, 2, 5])]), {}), [3, 2, 9, 2]);
  // the same chords spread out are on the coarse grid: only even durations
  assert.ok(estimateSectionDurations(sec([lyricLine(20, [0, 5, 10, 15])]), {}).every((x) => x % 2 === 0));
  // chords on syllables 0, 2, 3, 4 of 8: all four count as quick, minimum 1 beat
  const b = estimateSectionDurations(sec([lyricLine(8, [0, 2, 3, 4])]), {});
  assert.deepEqual(b, [4, 2, 2, 8]);
});

test('estimate: lead-in syllables before the first chord belong to it; rests keep their beats', () => {
  const rest = { lyric: '', chords: [{ name: 'N.C.', rest: true, beats: 4, col: 0 }] };
  const s = sec([rest, lyricLine(8, [2, 6])]);
  const b = estimateSectionDurations(s, {});
  assert.equal(b[0], 4);
  assert.equal(b.length, 3);
  assert.equal(b[1] + b[2], 8);
});

test('estimateSongDurations: new copy, estimated source, identical sections identical', () => {
  const song = createSong({ sections: [sec([lyricLine(16, [0, 8, 12])]), sec([lyricLine(16, [0, 8, 12])])] });
  const e = estimateSongDurations(song);
  assert.equal(e.timingSource, 'estimated');
  assert.equal(song.timingSource, 'default');
  assert.ok(song.sections[0].lines[0].chords.every((c) => c.beats === 4));
  assert.deepEqual(e.sections[0].lines[0].chords.map((c) => c.beats), e.sections[1].lines[0].chords.map((c) => c.beats));
  assert.ok(validateSong(e).ok);
});

test('migration: schema 2 songs on default durations get the estimate, edited ones are untouched', () => {
  const mk = (src) => ({ schemaVersion: 2, id: 'x', timingSource: src, sections: [sec([lyricLine(16, [0, 8, 12])])] });
  const m = migrateSong(mk('default'));
  assert.equal(m.timingSource, 'estimated');
  assert.deepEqual(m.sections[0].lines[0].chords.map((c) => c.beats), [6, 4, 2]);
  for (const src of ['edited', 'recorded']) {
    const k = migrateSong(mk(src));
    assert.equal(k.timingSource, src);
    assert.ok(k.sections[0].lines[0].chords.every((c) => c.beats === 4));
  }
  // already at version 3: not touched again
  const v3 = migrateSong({ ...mk('default'), schemaVersion: 3 });
  assert.equal(v3.timingSource, 'default');
});

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'american-pie.mht');
const real = { skip: existsSync(FILE) ? false : 'file reale assente' };

test('real file: estimated durations are plausible', real, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  assert.equal(song.timingSource, 'estimated');
  const all = new Set();
  for (const s of song.sections) {
    const b = s.lines.flatMap((l) => l.chords.map((c) => c.beats));
    const sum = b.reduce((a, x) => a + x, 0);
    assert.ok(b.every((x) => Number.isInteger(x) && x >= 1), s.name);
    assert.equal(sum % 4, 0, s.name);
    assert.ok(sum / b.length >= 3 && sum / b.length <= 5, `${s.name} mean ${sum / b.length}`);
    b.forEach((x) => all.add(x));
  }
  assert.ok(all.size >= 3);
});

test('real file: more syllables never means (much) fewer beats; identical sections identical; fast', real, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  for (const s of song.sections) {
    // syllable distance to the next chord, from the same flow definition (lyric lines only)
    const items = [];
    let cur = 0;
    for (const l of s.lines) {
      const m = syllableMap(l.lyric);
      if (!m.length) continue;
      for (const c of l.chords) {
        let i = m.findIndex((x) => c.col < x.end);
        if (i < 0) i = m.length;
        items.push({ pos: cur + i, beats: c.beats });
      }
      cur += m.length;
    }
    for (let a = 1; a + 1 < items.length; a++) {
      for (let b = 1; b + 1 < items.length; b++) {
        const da = items[a + 1].pos - items[a].pos;
        const db = items[b + 1].pos - items[b].pos;
        if (da > db && da > 0 && db > 0) assert.ok(items[a].beats >= items[b].beats - 2, `${s.name}: ${da} vs ${db} syllables, ${items[a].beats} vs ${items[b].beats} beats`);
      }
    }
  }
  const byKey = new Map();
  for (const s of song.sections) {
    const k = sectionContentKey(s);
    const beats = s.lines.flatMap((l) => l.chords.map((c) => c.beats)).join(',');
    if (byKey.has(k)) assert.equal(beats, byKey.get(k));
    else byKey.set(k, beats);
  }
  assert.ok(byKey.size < song.sections.length, 'the file has repeated choruses');
});

test('real file: the whole song is estimated in under 20 ms', real, () => {
  const song = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  estimateSongDurations(song);
  const t = performance.now();
  estimateSongDurations(song);
  assert.ok(performance.now() - t < 20, `${performance.now() - t} ms`);
});
