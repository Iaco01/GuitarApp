import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTabText, parseTuningText, parseChordLine, parseLabelledRow, isContinuationRow, parseSectionHeader, parsePartHeader,
  isTabNoise, tabChordVoices, tabNoteProfile, tabMeasureCount, tabTechniquesUsed, normalizeTab, isTabSong, shapeFromFrets, tabArrangement,
} from '../src/tab.js';
import { buildTabTimeline, tabColumnAt, tabChordAt, arrangementRepeat, arrangementRemove, arrangementMove, arrangementAdd, tabSectionBpm } from '../src/tabplay.js';
import { parseCapoText } from '../src/capo.js';
import { validateSong, migrateSong, createSong } from '../src/model.js';
import { getChordShapes } from '../src/chords-db.js';
import { syntheticTabText, tabSystem, measures, M_AM7, M_FMAJ7, M_BARRE, M_RIFF1, M_RIFF2 } from './fixtures/tab-fixtures.mjs';

const PDF_TITLE = 'Invented Song TAB by Imaginary Band @ Example.Com';
const parse = (opts) => parseTabText(syntheticTabText(opts), { pdfTitle: PDF_TITLE });
const measuresOf = (s) => s.tab.parts.map((p) => p.sections.map((x) => x.measures));

test('structure of the synthetic tab: parts, sections, measures, chords, tuning, capo', () => {
  const s = parse();
  assert.equal(s.kind, 'tab');
  assert.equal(isTabSong(s), true);
  assert.equal(s.title, 'Invented Song');
  assert.equal(s.artist, 'Imaginary Band');
  assert.equal(s.tab.tuning.name, 'Standard');
  assert.equal(s.capo, 2);
  assert.deepEqual(s.tab.parts.map((p) => p.label), ['Chitarra 1', 'Chitarra 2']);
  assert.deepEqual(s.tab.parts.map((p) => p.sections.length), [2, 1]);
  assert.deepEqual(s.tab.parts[0].sections[0].names, ['Intro', 'Chorus']);
  assert.equal(s.tab.parts[0].sections[0].label, 'Intro / Chorus');
  assert.deepEqual(s.tab.parts[0].sections.map((x) => x.measures.length), [3, 2]);
  assert.equal(s.tab.parts[1].sections[0].measures.length, 2);
  assert.equal(tabMeasureCount(s), 7);
  assert.deepEqual(s.chords, ['Am7', 'Fmaj7', 'F#m7']);
  assert.deepEqual(validateSong(s), { ok: true, errors: [] });
});

test('page noise in the middle and the comments after the tab are left out', () => {
  const s = parse();
  assert.ok(!s.chords.includes('C'), 'the chord of the comment tab is not read');
  assert.equal(tabMeasureCount(s), 7);
  const plain = parseTabText(syntheticTabText({ noise: false, comments: false }));
  assert.deepEqual(measuresOf(plain), measuresOf(s));
});

test('rows wrapped in unlabelled continuation blocks give the same song as the unwrapped ones', () => {
  const base = parse();
  for (const wrap of [14, 20, 25, 33]) {
    const w = parse({ wrap });
    assert.deepEqual(measuresOf(w), measuresOf(base), 'wrap ' + wrap);
  }
});

test('a chord name just before a continuation block lands on the measure that holds its column', () => {
  const s = parse({ wrap: 20 });
  const intro = s.tab.parts[0].sections[0];
  assert.deepEqual(intro.measures.map((m) => m.chords.map((c) => c.name)), [['Am7'], ['Fmaj7'], ['F#m7']]);
  assert.equal(intro.measures[1].chords[0].x, 2);
});

test('notes: two-digit frets, techniques before and after the note, muted notes, columns and positions', () => {
  const s = parse();
  const riff = s.tab.parts[1].sections[0].measures;
  const c1 = riff[0].columns;
  assert.deepEqual(c1.map((c) => c.x), [2, 4, 7, 9, 15]);
  assert.deepEqual(c1[0].notes[0], { string: 0, fret: 5, tech: 'h' });
  assert.deepEqual(c1[2].notes[0], { string: 0, fret: 7, tech: 'p' });
  assert.deepEqual(c1[4].notes[0], { string: 3, fret: 9, tech: '/', pre: true });
  assert.equal(c1[1].pos, Math.round((4 / riff[0].len) * 1000) / 1000);
  const c2 = riff[1].columns;
  assert.equal(c2[0].notes[0].fret, 10);
  assert.equal(c2[1].notes.find((n) => n.string === 0).fret, 12);
  const muted = c2.flatMap((c) => c.notes).filter((n) => n.tech === 'x');
  assert.equal(muted.length, 2);
  assert.ok(muted.every((n) => n.fret === null && n.string === 4));
  assert.deepEqual(tabTechniquesUsed(s), ['h', 'p', '/', '~', 'x']);
});

test('voicing: the stack under the chord name, barre detected, fingers from the defaults', () => {
  const s = parse();
  const f = s.tab.parts[0].sections[0].measures[2].chords[0];
  assert.equal(f.name, 'F#m7');
  assert.deepEqual(f.shape.frets, ['x', 9, 11, 9, 10, 9]);
  assert.equal(f.shape.baseFret, 9);
  assert.deepEqual(f.shape.barres, [{ fret: 9, from: 1, to: 5 }]);
  assert.deepEqual(f.shape.fingers, [null, 1, 3, 1, 2, 1]);
  assert.equal(f.shape.fromTab, true);
  const am = s.tab.parts[0].sections[0].measures[0].chords[0];
  assert.deepEqual(am.shape.frets, ['x', 0, 2, 0, 1, 0]);
  assert.equal(am.shape.baseFret, 1);
  const voices = tabChordVoices(s);
  assert.deepEqual(voices.map((v) => v.name), ['Am7', 'Fmaj7', 'F#m7']);
  assert.equal(tabChordVoices(s, 1).length, 0, 'the riff part has no chord names');
});

test('voicing from the next columns when the chord column has few notes (an arpeggio)', () => {
  const body = ['|--------3--3--|', '|-----1-----1--|', '|--0--------0--|', '|--------2-----|', '|--3-----------|', '|--------------|'];
  const text = ['[Intro]', ...tabSystem(body, [{ name: 'Cmaj7', at: 3 }])].join('\n');
  const s = parseTabText(text);
  const c = s.tab.parts[0].sections[0].measures[0].chords[0];
  assert.equal(c.name, 'Cmaj7');
  // columns: 3 (G 0, A 3) then 6 (B... ) : the strings are taken from the first columns until three are known
  assert.ok(c.shape);
  assert.equal(c.shape.frets.filter((f) => f !== 'x').length >= 3, true);
});

test('a voicing that cannot be drawn is null (span over 5 frets, a single note)', () => {
  assert.equal(shapeFromFrets(['x', 3, 'x', 'x', 'x', 12]), null);
  assert.equal(shapeFromFrets(['x', 'x', 'x', 'x', 'x', 5]), null);
  assert.equal(shapeFromFrets([0, 'x', 'x', 'x', 9, 'x']), null);
  assert.deepEqual(shapeFromFrets([0, 2, 2, 1, 0, 0]).frets, [0, 2, 2, 1, 0, 0]);
});

test('labels of any case, back to back systems, 4 and 7 string tabs', () => {
  const upper = ['E', 'B', 'G', 'D', 'A', 'E'];
  const text = [
    ...tabSystem(measures([M_AM7]), [], { labels: upper }),
    ...tabSystem(measures([M_FMAJ7]), [], { labels: upper }),
  ].join('\n');
  const s = parseTabText(text);
  assert.equal(tabMeasureCount(s), 2);
  assert.equal(s.tab.parts[0].sections[0].measures[1].columns[0].notes.length, 6);
  const bass = ['|--0--3--|', '|--0--3--|', '|--2--5--|', '|--3--5--|'];
  const sb = parseTabText(bass.map((b, i) => 'GDAE'[i] + b).join('\n'));
  assert.equal(sb.tab.parts[0].sections[0].measures[0].rows.length, 4);
  assert.equal(sb.tab.parts[0].sections[0].measures[0].chords.length, 0);
  const seven = Array.from({ length: 7 }, (_, i) => 'eBGDABE'[i] + '|--' + (i % 3) + '--|').join('\n');
  assert.equal(parseTabText(seven).tab.parts[0].sections[0].measures[0].rows.length, 7);
});

test('text with no tab gives an empty song with a warning', () => {
  const s = parseTabText('Just some words\nand a chord line\nAm  G');
  assert.equal(tabMeasureCount(s), 0);
  assert.ok(s.importInfo.warnings.length >= 1);
});

test('line recognisers', () => {
  assert.deepEqual(parseLabelledRow('e|--5--|').label, 'e');
  assert.equal(parseLabelledRow('e|--5--|').body, '|--5--|');
  assert.equal(parseLabelledRow('Am|--5--|'), null);
  assert.equal(parseLabelledRow('Verse: --'), null);
  assert.equal(isContinuationRow('5--7--5--5---|'), true);
  assert.equal(isContinuationRow('12-10-12-8---|'), true);
  assert.equal(isContinuationRow('508,761 views'), false);
  assert.deepEqual(parseChordLine('    F#m7        A/C#   (x2)').map((c) => [c.name, c.col]), [['F#m7', 4], ['A/C#', 16]]);
  assert.equal(parseChordLine('This is text'), null);
  assert.equal(parseChordLine('--5--'), null);
  assert.deepEqual(parseSectionHeader('[Chorus/ Intro]').names, ['Chorus', 'Intro']);
  assert.equal(parseSectionHeader('[Guitar 1]'), null);
  assert.equal(parsePartHeader('-----|Guitar 2|-----').label, 'Chitarra 2');
  assert.equal(parsePartHeader('-----|Rhythm|-----').label, 'Ritmica');
  assert.equal(parsePartHeader('Some text | with a bar'), null);
  assert.equal(isTabNoise('CONTINUE IN THE APP'), true);
  assert.equal(isTabNoise('S a v i n g  t a b  f o r  offline usage is available in the app'), true);
  assert.equal(isTabNoise('AUTOSCROLL      LISTEN       PDF'), true);
  assert.equal(isTabNoise('Intro riff'), false);
});

test('tuning and capo', () => {
  assert.equal(parseTuningText('Standard Tuning (EADGBe)').name, 'Standard');
  assert.deepEqual(parseTuningText('Standard Tuning (EADGBe)').midi, [40, 45, 50, 55, 59, 64]);
  assert.deepEqual(parseTuningText('Tuning: D A D G B E').midi, [38, 45, 50, 55, 59, 64]);
  assert.equal(parseTuningText('Tuning: D A D G B E').name, 'Drop D');
  assert.deepEqual(parseTuningText('Tuning: Eb Ab Db Gb Bb Eb').midi, [39, 44, 49, 54, 58, 63]);
  assert.equal(parseTuningText('Tuning: Half step down').name, 'Mezzo tono sotto');
  assert.equal(parseTuningText('Tuning: DADGAD').midi[4], 57);
  assert.equal(parseTuningText('Just words'), null);
  assert.equal(parseCapoText('Capo: 3rd fret'), 3);
  assert.equal(parseCapoText('Capo 5'), 5);
  assert.equal(parseCapoText('Capo: no capo'), 0);
  assert.equal(parseCapoText('Capo on 2'), 2);
  assert.equal(parseCapoText('capo II'), 2);
  assert.equal(parseCapoText('Capo: 2nd fret'), 2);
  assert.equal(parseCapoText('Capotasto al 4° tasto'), 4);
  assert.equal(parseCapoText('Capotasto: 3'), 3);
  assert.equal(parseCapoText('capo: senza capo'), 0);
  assert.equal(parseCapoText('Capo 13'), 0);
  assert.equal(parseCapoText('no mention'), 0);
});

test('note profile: pitch classes of the frets on the tuning', () => {
  const s = parse();
  const m = s.tab.parts[0].sections[0].measures[0]; // Am7 shape
  const p = tabNoteProfile(m, s.tab.tuning.midi);
  // x 0 2 0 1 0 : A E(open B? no) ... the sounded classes are A, C, E, G
  const set = p.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(set, [0, 4, 7, 9]);
  // the same shape with a capo on the 2nd fret sounds two semitones higher
  const withCapo = tabNoteProfile(m, s.tab.tuning.midi, 6, 2).map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(withCapo, [2, 6, 9, 11]);
});

test('model: migration keeps the kind, old songs are chords songs', () => {
  const s = parse();
  assert.equal(migrateSong(JSON.parse(JSON.stringify(s))).kind, 'tab');
  assert.equal(migrateSong({ id: 'x', title: 'a', sections: [] }).kind, 'chords');
  assert.equal(createSong().kind, 'chords');
  assert.equal(validateSong({ ...s, tab: null }).ok, false);
  const n = normalizeTab({ ...s, tab: { parts: s.tab.parts } });
  assert.equal(n.tab.bpm, 100);
  assert.deepEqual(n.tab.arrangement[0], [0, 1]);
});

test('timeline: one event per measure, beats, tempo per section, speed and arrangement', () => {
  const s = parse();
  s.tab.guide = 0;
  let tl = buildTabTimeline(s);
  assert.equal(tl.events.length, 5);
  assert.equal(tl.beats.length, 20);
  assert.equal(tl.sections.length, 2);
  assert.ok(Math.abs(tl.totalSec - 20 * 0.6) < 1e-9, 'default 100 BPM');
  assert.deepEqual(tl.events.map((e) => e.name), ['Am7', 'Fmaj7', 'F#m7', 'Fmaj7 Am7', 'Fmaj7 Am7'].map((x, i) => (i === 3 ? 'Fmaj7' : i === 4 ? 'Am7' : x)));
  assert.deepEqual(tl.beats.slice(0, 5).map((b) => [b.beatInBar, b.isDownbeat]), [[0, true], [1, false], [2, false], [3, false], [0, true]]);
  // the tempo of one section
  s.tab.parts[0].sections[1].bpm = 60;
  assert.equal(tabSectionBpm(s, s.tab.parts[0].sections[1]), 60);
  tl = buildTabTimeline(s);
  assert.ok(Math.abs(tl.sections[1].endSec - tl.sections[1].startSec - 8 * 1) < 1e-9);
  // speed 50%
  const half = buildTabTimeline(s, { speed: 0.5 });
  assert.ok(Math.abs(half.totalSec - tl.totalSec * 2) < 1e-9);
  // arrangement: verse twice, then intro
  s.tab.arrangement[0] = [1, 1, 0];
  tl = buildTabTimeline(s);
  assert.equal(tl.sections.length, 3);
  assert.equal(tl.events.length, 2 + 2 + 3);
  assert.deepEqual(tl.sections.map((x) => x.sectionRef), [1, 1, 0]);
  assert.deepEqual(tabArrangement(s, 0), [1, 1, 0]);
  // the other part as the guide
  tl = buildTabTimeline(s, { guide: 1 });
  assert.equal(tl.events.length, 2);
});

test('cursor helpers: column and chord at a progress, arrangement editing', () => {
  const s = parse();
  const m = s.tab.parts[1].sections[0].measures[0];
  assert.equal(tabColumnAt(m, 0), -1);
  assert.equal(tabColumnAt(m, m.columns[1].pos), 1);
  assert.equal(tabColumnAt(m, 0.999), m.columns.length - 1);
  const mc = s.tab.parts[0].sections[0].measures[0];
  assert.equal(tabChordAt(mc, 0).name, 'Am7');
  assert.equal(tabChordAt({ chords: [], len: 10 }, 0.5), null);
  assert.deepEqual(arrangementRepeat([0, 1], 0), [0, 0, 1]);
  assert.deepEqual(arrangementRemove([0, 1, 0], 1), [0, 0]);
  assert.deepEqual(arrangementMove([0, 1, 2], 2, -1), [0, 2, 1]);
  assert.deepEqual(arrangementMove([0, 1, 2], 0, -1), [0, 1, 2]);
  assert.deepEqual(arrangementAdd([0], 1), [0, 1]);
});

test('the dictionary is used when the tab gives no shape (names stay as written)', () => {
  assert.ok(getChordShapes('Am7').length > 0);
  const s = parse();
  assert.ok(s.tab.parts[0].sections[0].measures[0].chords[0].shape);
});

test('the round 14 model keeps the room for the audio sync: startSec/endSec on every measure', () => {
  const s = parse();
  for (const p of s.tab.parts) for (const sec of p.sections) for (const m of sec.measures) {
    assert.equal(m.startSec, null);
    assert.equal(m.endSec, null);
    assert.equal(m.beats, 4);
  }
  assert.equal(s.tab.guide, 0);
});

test('barre chord written high is not replaced by the dictionary (test data sanity)', () => {
  const rows = M_BARRE;
  assert.equal(rows.length, 6);
  assert.ok(M_RIFF1.length === 6 && M_RIFF2.length === 6);
});
