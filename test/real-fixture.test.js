import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSongFromMht } from '../src/parser.js';
import { countChords, validateSong } from '../src/model.js';

// Real, copyrighted page kept out of git. Assertions use counts and metadata only.
const FILE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'american-pie.mht');
const present = existsSync(FILE);
const opts = present ? {} : { skip: 'file reale assente: test/fixtures/local/american-pie.mht' };

test('real file: M1 acceptance criteria', opts, () => {
  const s = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  assert.equal(s.title, 'American Pie');
  assert.equal(s.artist, 'Don McLean');
  assert.equal(s.difficulty, 'Beginner');
  assert.equal(s.tuning, 'E A D G B E');
  assert.equal(s.capo, 0);
  assert.equal(s.key, null);
  assert.equal(s.sections.length, 12);
  const expected = [];
  for (let i = 1; i <= 6; i++) expected.push(`Verse ${i}`, 'Chorus');
  assert.deepEqual(s.sections.map((x) => x.name), expected);
  assert.equal(countChords(s), 328);
  assert.deepEqual(s.chords, ['G', 'D', 'Em', 'Am', 'C', 'A']);
  assert.equal(s.strumming.length, 3);
  assert.deepEqual(s.strumming.map((p) => [p.section, p.bpm, p.beats.length]),
    [['Verse 1', 62, 16], ['Chorus', 96, 8], ['Verse 2 onwards', 142, 8]]);
  assert.equal(s.bpm, 62);
  assert.equal(s.importInfo.method, 'spans');
  assert.deepEqual(s.importInfo.warnings, []);
  assert.ok(validateSong(s).ok);
});

test('real file: advertisement removed, annotations kept', opts, () => {
  const s = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  const json = JSON.stringify(s);
  assert.ok(!/bidding|js-ab-regular|<div|<img|<svg/i.test(json));
  assert.ok(json.length < 100000, 'song JSON is small (ad block removed)');
  const lines = s.sections.flatMap((x) => x.lines);
  assert.equal(lines.filter((l) => l.chords.some((c) => c.mark === '*')).length, 22);
  assert.ok(lines.flatMap((l) => l.chords).every((c) => c.mark === undefined || c.mark === '*'));
  // No empty/blank-only lines and no leftover markup in lyrics.
  assert.ok(lines.every((l) => l.lyric === '' ? l.chords.length > 0 : l.lyric.trim() !== ''));
  assert.ok(lines.every((l) => !/[<>]/.test(l.lyric)));
  assert.ok(lines.length >= 100 && lines.length <= 317);
});

test('real file: every chord column stays inside the line or just past it', opts, () => {
  const s = parseSongFromMht(readFileSync(FILE, 'utf-8'));
  for (const l of s.sections.flatMap((x) => x.lines)) {
    if (l.lyric === '') continue;
    for (const c of l.chords) assert.ok(c.col >= 0 && c.col <= l.lyric.length + 20);
  }
});
