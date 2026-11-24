import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, validateSong, migrateSong, countChords, sectionSignature, sectionContentKey, baseSectionName, listChordNames, proposeSectionTempos, effectiveSectionBpms, applySectionTempos, findDuplicateSongs } from '../src/model.js';

const sample = () => createSong({
  title: 'T', artist: 'A',
  sections: [
    { name: 'Chorus', lines: [{ lyric: 'x y', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 2, beats: 4, mark: '*' }] }] },
    { name: 'Chorus 2', lines: [{ lyric: 'x y', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 2, beats: 4, mark: '*' }] }] },
  ],
});

test('createSong has the documented defaults and is JSON-serialisable', () => {
  const s = createSong();
  assert.equal(s.schemaVersion, 2);
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

test('groupRepeatedSections merges consecutive copies and flags later repeats', async () => {
  const { groupRepeatedSections } = await import('../src/model.js');
  const sec = (name, lyric) => ({ name, lines: [{ lyric, chords: [{ name: 'G', col: 0, beats: 4 }] }] });
  const groups = groupRepeatedSections([sec('Chorus', 'a'), sec('Chorus 2', 'a'), sec('Verse 1', 'b'), sec('Chorus', 'a'), sec('Verse 2', 'c')]);
  assert.deepEqual(groups.map((g) => [g.indices.join('+'), g.count, g.repeat]),
    [['0+1', 2, false], ['2', 1, false], ['3', 1, true], ['4', 1, false]]);
});

const withSections = (names, strumming, bpm = null) => createSong({
  bpm, strumming,
  sections: names.map((name) => ({ name, bpm: null, bpmSource: null, strumIndex: null, lines: [] })),
});
const pat = (section, bpm) => ({ section, bpm, beats: [{ dir: 'D', onBeat: true }] });

test('proposeSectionTempos: exact name beats base name beats "onwards"', () => {
  const song = withSections(['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Verse 3', 'Chorus 2', 'Bridge'],
    [pat('Verse 1', 62), pat('chorus', 96), pat('Verse 2 onwards', 142)]);
  const p = proposeSectionTempos(song);
  assert.deepEqual(p.map((x) => x.bpm), [62, 96, 142, 96, 142, 96, 142]);
  assert.deepEqual(p.map((x) => x.strumIndex), [0, 1, 2, 1, 2, 1, 2]);
});

test('proposeSectionTempos: "on" form, unmatched patterns and missing bpm', () => {
  const song = withSections(['Intro', 'Verse 1', 'Verse 2'], [pat('Verse 2 on', 100), pat('Verse 1', null), pat('Coda', 50)]);
  const p = proposeSectionTempos(song);
  assert.deepEqual(p, [{ bpm: null, strumIndex: null }, { bpm: null, strumIndex: 1 }, { bpm: 100, strumIndex: 0 }]);
});

test('effectiveSectionBpms inherits from the previous section, then song.bpm, then 80', () => {
  const song = withSections(['A', 'B', 'C'], [], 70);
  assert.deepEqual(effectiveSectionBpms(song), [70, 70, 70]);
  song.sections[1].bpm = 120;
  assert.deepEqual(effectiveSectionBpms(song), [70, 120, 120]);
  assert.deepEqual(effectiveSectionBpms(withSections(['A'], [], null)), [80]);
});

test('migrateSong from schema 1 adds section fields and proposes tempos', () => {
  const old = { schemaVersion: 1, id: 'x', bpm: 62, strumming: [pat('Verse 1', 62), pat('Chorus', 96)],
    sections: [{ name: 'Verse 1', lines: [] }, { name: 'Chorus', lines: [] }] };
  const m = migrateSong(old);
  assert.equal(m.schemaVersion, 2);
  assert.deepEqual(m.sections.map((s) => [s.bpm, s.bpmSource, s.strumIndex]), [[62, 'strumming', 0], [96, 'strumming', 1]]);
  applySectionTempos(m);
  m.sections[0].bpm = 70; m.sections[0].bpmSource = 'edited';
  applySectionTempos(m);
  assert.equal(m.sections[0].bpm, 70);
});

test('validateSong requires integer beats >= 1 and sane section bpm', () => {
  const s = sample();
  s.sections[0].lines[0].chords[0].beats = 1.5;
  s.sections[1].bpm = -3;
  assert.equal(validateSong(s).errors.length, 2);
});

test('findDuplicateSongs matches by URL or title+artist, newest import first', () => {
  const mk = (o) => createSong({ source: { fileName: '', importedAt: o.at, url: o.url }, title: o.t || 'T', artist: 'A' });
  const fresh = mk({ at: '2026-03-01', url: 'u1' });
  const a = mk({ at: '2026-01-01', url: 'u1' });
  const b = mk({ at: '2026-02-01', url: 'u1' });
  const c = mk({ at: '2026-02-15', url: 'u2' });
  assert.deepEqual(findDuplicateSongs(fresh, [a, c, b, null]).map((s) => s.id), [b.id, a.id]);
  const noUrl = createSong({ title: ' t ', artist: 'a' });
  assert.equal(findDuplicateSongs(noUrl, [a, c]).length, 2);
});
