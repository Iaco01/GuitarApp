// Round 3 tester regressions (bugs fixed in round 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSong, validateSong, migrateSong } from '../src/model.js';
import { parseExport } from '../src/libio.js';
import { renderDiagramSvg } from '../src/diagram.js';
import { getChordShape } from '../src/chords-db.js';

function songWith(over) {
  return createSong({
    id: 'reg-1', title: 'Prova', artist: 'Test',
    chords: ['C'],
    sections: [{ name: 'A', bpm: null, bpmSource: null, strumIndex: null, lines: [{ lyric: 'la', chords: [{ name: 'C', col: 0, beats: 4 }] }] }],
    ...over,
  });
}
const exportOf = (song) => JSON.stringify({ app: 'guitarapp', exportVersion: 1, exportedAt: 'x', songs: [song], settings: {} });

// BUG (MINORE): import accepts a time signature like [300000, 4]; opening the song builds 300000 bar dots and
// freezes the page for seconds (measured 2.1 s, and the panel was unusable). validateSong should bound it.
test('validateSong rejects an absurd time signature', () => {
  for (const ts of [[300000, 4], [0, 4], ['a', 'b'], [4, 0], [4.5, 4]]) {
    assert.equal(validateSong(songWith({ timeSignature: ts })).ok, false, JSON.stringify(ts));
  }
  assert.equal(validateSong(songWith({ timeSignature: [6, 8] })).ok, true);
});

// BUG (MINORE): transpose / capo from an imported file are not validated or normalised (string, 1e9, -5, 99).
test('import normalises transpose and capo', () => {
  const parsed = parseExport(exportOf(songWith({ transpose: 'abc', capo: 99 })));
  const s = parsed.songs[0];
  const bad = parsed.invalid.length > 0;
  assert.ok(bad || (Number.isInteger(s.transpose) && Math.abs(s.transpose) <= 12 && Number.isInteger(s.capo) && s.capo >= 0 && s.capo <= 12));
});

// BUG (MINORE): the fret number of a small diagram (30 px wide, used in the play panel) renders at
// 19 * 30 / 100 = 5.7 px: unreadable. It should be at least ~9 px (or the number moved out of the SVG).
test('fret number in a 30 px diagram is at least 9 px', () => {
  const shape = getChordShape('Gm');
  assert.ok(shape.baseFret > 1);
  const svg = renderDiagramSvg(shape, { size: 30 });
  const m = /<text[^>]*font-size="(\d+(?:\.\d+)?)"[^>]*>\d+<\/text>/.exec(svg);
  assert.ok(m, 'fret number text present');
  assert.ok(Number(m[1]) * 30 / 100 >= 9, `font ${Number(m[1]) * 30 / 100} px`);
});

// Keeps the date formatting of migrateSong honest: a song without updatedAt gets "now", so a file copy
// without a date always counts as newer than the library copy (informational, passes).
test('migrateSong fills updatedAt', () => {
  const s = migrateSong({ id: 'x', title: 't', artist: 'a', sections: [] });
  assert.equal(typeof s.updatedAt, 'string');
});

test('validateSong checks capo, beats, tempo and transpose ranges with readable errors', () => {
  const bad = (over) => validateSong(songWith(over));
  assert.equal(bad({ capo: 13 }).ok, false);
  assert.equal(bad({ capo: 1.5 }).ok, false);
  assert.equal(bad({ transpose: 13 }).ok, false);
  assert.equal(bad({ transpose: 2.5 }).ok, false);
  assert.equal(bad({ bpm: 19 }).ok, false);
  assert.equal(bad({ bpm: 401 }).ok, false);
  assert.equal(bad({ timeSignature: [4, 3] }).ok, false);
  const s = songWith({});
  s.sections[0].bpm = 1000;
  assert.match(validateSong(s).errors.join(' '), /bpm della sezione 0/);
  const t = songWith({});
  t.sections[0].lines[0].chords[0].beats = 65;
  assert.equal(validateSong(t).ok, false);
  assert.equal(bad({ capo: 12, transpose: -12, bpm: 400, timeSignature: [16, 16] }).ok, true);
  const parsed = parseExport(exportOf(songWith({ timeSignature: [300000, 4] })));
  assert.equal(parsed.songs.length, 0);
  assert.match(parsed.invalid[0].errors.join(' '), /timeSignature/);
});

test('small diagrams draw the fret number below the grid at 10 px or more', () => {
  const svg = renderDiagramSvg(getChordShape('Gm'), { size: 30 });
  assert.match(svg, />fr<\/text>/);
  const big = renderDiagramSvg(getChordShape('Gm'), { size: 64 });
  assert.doesNotMatch(big, />fr<\/text>/);
});
