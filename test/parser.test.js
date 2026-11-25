import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSongFromMht, parseSong } from '../src/parser.js';
import { countChords, validateSong } from '../src/model.js';

const SYN = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic');
const load = (n) => parseSongFromMht(readFileSync(join(SYN, n), 'utf-8'));

const VARIANTS = ['song-binary.mht', 'song-qp.mht', 'song-base64.mht', 'song-nospans.mht', 'song-nostrum.mht'];

for (const file of VARIANTS) {
  test(`${file}: metadata, sections and chords match EXPECTED.md`, () => {
    const s = load(file);
    assert.equal(s.title, 'Città di Carta');
    assert.equal(s.artist, 'Gruppo Immaginario');
    assert.equal(s.difficulty, 'Beginner');
    assert.equal(s.tuning, 'E A D G B E');
    assert.equal(s.capo, 0);
    assert.equal(s.key, null);
    assert.deepEqual(s.sections.map((x) => `${x.name}:${x.lines.length}`),
      ['Intro:1', 'Verse 1:4', 'Chorus:2', 'Verse 2:3', 'Chorus:2', 'Outro:1']);
    assert.equal(countChords(s), 34);
    assert.deepEqual(s.chords, ['Am', 'F', 'C', 'G']);
    const marked = s.sections.flatMap((x) => x.lines).filter((l) => l.chords.some((c) => c.mark));
    assert.equal(marked.length, 4);
    assert.equal(s.sections.flatMap((x) => x.lines).flatMap((l) => l.chords).filter((c) => c.mark === '*').length, 4);
    // round 6: the import estimates the durations from the chord positions (fixed 4 beats are no longer the default)
    assert.ok(s.sections.flatMap((x) => x.lines).flatMap((l) => l.chords).every((c) => Number.isInteger(c.beats) && c.beats >= 1));
    assert.ok(s.sections.every((x) => x.lines.flatMap((l) => l.chords).reduce((a, c) => a + c.beats, 0) % 4 === 0));
    assert.equal(s.timingSource, 'estimated');
    assert.deepEqual(s.timeSignature, [4, 4]);
    assert.ok(validateSong(s).ok, validateSong(s).errors.join(';'));
  });

  test(`${file}: no advertisement text, no blank-only lines, instrumental lines`, () => {
    const s = load(file);
    assert.ok(!JSON.stringify(s).includes('ADVERTISEMENT'));
    const lines = s.sections.flatMap((x) => x.lines);
    assert.ok(lines.every((l) => l.lyric === '' ? l.chords.length > 0 : l.lyric.trim() !== ''));
    assert.equal(lines.filter((l) => l.lyric === '' && l.chords.length > 0).length, 3);
    assert.equal(s.sections[1].lines[0].lyric, 'Il gatto scrive numeri sul tetto');
    assert.deepEqual(s.sections[1].lines[0].chords.map((c) => [c.name, c.col]), [['Am', 0], ['F', 12]]);
  });
}

test('identical choruses have identical content', () => {
  const s = load('song-binary.mht');
  assert.deepEqual(s.sections[2].lines, s.sections[4].lines);
});

test('strumming patterns and bpm', () => {
  const s = load('song-binary.mht');
  assert.deepEqual(s.strumming.map((p) => [p.section, p.bpm, p.beats.length]),
    [['Verse 1', 70, 16], ['Chorus', 104, 8], ['Verse 2 onwards', 128, 8]]);
  assert.equal(s.bpm, 70);
  assert.equal(s.strumming[0].beats.map((b) => b.dir || '-').join(' '), 'D D D - D - D - D - D - - - - -');
  assert.equal(s.strumming[1].beats.map((b) => b.dir).join(''), 'DUDUDUDU');
  assert.ok(s.strumming[0].beats.every((b, i) => b.onBeat === (i % 2 === 0)));
});

test('no strumming block: bpm null and a warning', () => {
  const s = load('song-nostrum.mht');
  assert.deepEqual(s.strumming, []);
  assert.equal(s.bpm, null);
  assert.ok(s.importInfo.warnings.some((w) => /BPM/.test(w)));
});

test('import method: spans vs text fallback, same result otherwise', () => {
  const a = load('song-binary.mht');
  const b = load('song-nospans.mht');
  assert.equal(a.importInfo.method, 'spans');
  assert.equal(b.importInfo.method, 'text-fallback');
  assert.deepEqual(b.sections, a.sections);
  assert.deepEqual(b.chords, a.chords);
});

test('all encodings give the same song', () => {
  const a = load('song-binary.mht');
  for (const f of ['song-qp.mht', 'song-base64.mht']) {
    const s = load(f);
    assert.deepEqual(s.sections, a.sections, f);
    assert.deepEqual(s.strumming, a.strumming, f);
  }
});

const MINI = (body, extra = '') => `<html><head><title>Foo</title></head><body>${extra}<code class="js-tab-content"><pre>${body}</pre></code></body></html>`;

test('title and artist fall back to the Subject, normalising capitals and suffixes', () => {
  const s = parseSong({ html: MINI('[Verse]\nAm\nciao'), subject: 'BELLA CIAO CHORDS (ver 3) by Anonimo @ Ultimate-Guitar.Com' });
  assert.equal(s.title, 'Bella Ciao');
  assert.equal(s.artist, 'Anonimo');
  const t = parseSong({ html: MINI('Am\nciao'), subject: 'Mixed Case Tab by Someone Else' });
  assert.equal(t.title, 'Mixed Case');
  assert.equal(t.artist, 'Someone Else');
});

test('capo and key metadata', () => {
  const meta = '<ul><li><span class="tabHeader-name">Capo: </span>2nd fret</li><li><span class="tabHeader-name">Key: </span>Am</li></ul>';
  const s = parseSong({ html: MINI('[A]\nAm\nx', meta) });
  assert.equal(s.capo, 2);
  assert.equal(s.key, 'Am');
  const none = '<ul><li><span class="tabHeader-name">Capo: </span>no capo</li></ul>';
  assert.equal(parseSong({ html: MINI('Am\nx', none) }).capo, 0);
});

test('text before the first header goes in an unnamed section; empty pre sections are dropped', () => {
  const s = parseSong({ html: MINI('Am   G\nla la la\n[Chorus]\n\n[Verse]\nC\n') });
  assert.deepEqual(s.sections.map((x) => `${x.name}|${x.lines.length}`), ['|1', 'Chorus|0', 'Verse|1']);
});

test('fallback: N.C. and (x2) tokens are tolerated in chord lines; plain words are lyrics', () => {
  const s = parseSong({ html: MINI('[V]\nAm  N.C.  G (x2)\nSono parole Am\n') });
  const lines = s.sections[0].lines;
  assert.deepEqual(lines[0].chords.map((c) => c.name), ['Am', 'G']);
  assert.equal(lines[0].lyric, 'Sono parole Am');
});

test('missing pre gives a friendly error', () => {
  assert.throws(() => parseSong({ html: '<html><body>niente</body></html>' }), /accordi/);
});

test('chord spans in a line mixed with words are not chord lines', () => {
  const html = MINI('[V]\n<span class="tabContent-chord" data-original-chord="G">G</span> parole sparse\n');
  const s = parseSong({ html });
  assert.equal(s.sections[0].lines[0].chords.length, 0);
  assert.equal(s.sections[0].lines[0].lyric, 'G parole sparse');
});

// ---- regressions from the round 1 tester ----
const mkRegression = (pre) => `Subject: T CHORDS by A\nContent-Type: multipart/related; boundary="B"\n\n--B\nContent-Type: text/html\nContent-Transfer-Encoding: 8bit\n\n<html><body><code class="js-tab-content">${pre}</code></body></html>\n--B--\n`;

test('chord spans with no name are ignored with a warning', () => {
  const s = parseSongFromMht(mkRegression('<pre>[A]\n<span class="tabContent-chord js-chord-chord"></span>   <span class="tabContent-chord js-chord-chord" data-original-chord="">x</span>\nlyric\n<span class="tabContent-chord js-chord-chord">G</span> <span class="tabContent-chord js-chord-chord"></span>\nmore</pre>'));
  const names = s.sections.flatMap((x) => x.lines).flatMap((l) => l.chords).map((c) => c.name);
  assert.deepEqual(names, ['G']);
  assert.ok(s.importInfo.warnings.some((w) => /senza nome/.test(w)));
});

test('many unclosed chord spans are analysed in linear time', () => {
  const html = mkRegression('<pre>' + '<span class="tabContent-chord js-chord-chord">'.repeat(20000) + '</pre>');
  const t0 = Date.now();
  try { parseSongFromMht(html); } catch { /* an error is fine */ }
  const dt = Date.now() - t0;
  assert.ok(dt < 1000, `took ${dt} ms for 20000 unclosed spans`);
});

test('source url is kept without tracking parameters', async () => {
  const { cleanSourceUrl } = await import('../src/parser.js');
  assert.equal(cleanSourceUrl('https://x.test/tab/a-1?_gl=1*abc*_up*MQ..'), 'https://x.test/tab/a-1');
  assert.equal(cleanSourceUrl('https://x.test/tab/a-1?id=3&utm_source=z'), 'https://x.test/tab/a-1?id=3');
  assert.equal(cleanSourceUrl(''), '');
});
