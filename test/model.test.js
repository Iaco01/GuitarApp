import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, validateSong, migrateSong, countChords, sectionSignature, sectionContentKey, baseSectionName, listChordNames } from '../src/model.js';

const sample = () => createSong({
  title: 'T', artist: 'A',
  sections: [
    { name: 'Chorus', lines: [{ lyric: 'x y', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 2, beats: 4, mark: '*' }] }] },
    { name: 'Chorus 2', lines: [{ lyric: 'x y', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 2, beats: 4, mark: '*' }] }] },
  ],
});

test('createSong has the documented defaults and is JSON-serialisable', () => {
  const s = createSong();
  assert.equal(s.schemaVersion, 1);
  assert.match(s.id, /\S{8,}/);
  assert.deepEqual(s.timeSignature, [4, 4]);
  assert.equal(s.timingSource, 'default');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.notEqual(createSong().id, s.id);
});

test('validateSong accepts good songs and reports problems', () => {
  assert.ok(validateSong(sample()).ok);
  const bad = sample();
  bad.sections[0].lines[0].chords[0].col = -1;
  bad.bpm = 'x';
  const r = validateSong(bad);
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 2);
  assert.ok(!validateSong(null).ok);
});

test('migrateSong fills missing fields and keeps data', () => {
  const m = migrateSong({ id: 'abc', title: 'X', view: { fontScale: 1.4 } });
  assert.equal(m.id, 'abc');
  assert.equal(m.title, 'X');
  assert.equal(m.view.fontScale, 1.4);
  assert.equal(m.view.collapseRepeats, true);
  assert.deepEqual(m.sections, []);
});

test('helpers: counts, names, signatures', () => {
  const s = sample();
  assert.equal(countChords(s), 4);
  assert.deepEqual(listChordNames(s), ['G', 'D']);
  assert.equal(sectionSignature(s.sections[0]), 'G D');
  assert.equal(baseSectionName('Chorus 2'), 'Chorus');
  assert.equal(baseSectionName('Verse 1'), 'Verse');
  assert.equal(baseSectionName('Intro'), 'Intro');
  assert.equal(sectionContentKey(s.sections[0]), sectionContentKey(s.sections[1]));
  s.sections[1].lines[0].lyric = 'x z';
  assert.notEqual(sectionContentKey(s.sections[0]), sectionContentKey(s.sections[1]));
});
