// The real tab PDF of round 14 (copyrighted, only present locally): counts and structure only, never content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPdfText } from '../src/pdf.js';
import { parseTabText, tabChordVoices, tabMeasureCount } from '../src/tab.js';
import { buildTabTimeline } from '../src/tabplay.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'local', 'what-you-know-tab.pdf');
const skip = existsSync(FILE) ? false : 'fixtures/local/what-you-know-tab.pdf not present';

test('real PDF: pages, lines and tab rows', { skip }, async () => {
  const r = await readPdfText(readFileSync(FILE));
  assert.equal(r.pages.length, 6);
  assert.deepEqual(r.warnings, []);
  const labelled = r.lines.filter((l) => /^[eBGDAE]\|/.test(l));
  assert.equal(labelled.length, 72, '12 systems of 6 rows (9 in the tab, 3 in the comments)');
  assert.ok(r.lines.some((l) => /^\s*-+\|\s*\S+ \d\|-+$/.test(l)), 'part headers');
  assert.ok(r.title.length > 0);
});

test('real PDF: parts, sections, measures, chords and their voicings', { skip }, async () => {
  const r = await readPdfText(readFileSync(FILE));
  const s = parseTabText(r.text, { pdfTitle: r.title });
  assert.equal(s.kind, 'tab');
  assert.ok(s.title.length > 0 && s.artist.length > 0);
  assert.deepEqual(s.tab.parts.map((p) => p.label), ['Chitarra 1', 'Chitarra 2']);
  assert.deepEqual(s.tab.parts.map((p) => p.sections.map((x) => x.names.length)), [[2, 1], [2, 1]]);
  assert.deepEqual(s.tab.parts.map((p) => p.sections.map((x) => x.measures.length)), [[4, 1], [2, 2]]);
  assert.equal(tabMeasureCount(s), 9, 'the 3 systems of the comments are left out');
  assert.ok(s.tab.parts.every((p) => p.sections.every((x) => x.measures.every((m) => m.rowCount === 6 && m.rows.every((row) => row.length === m.len)))));
  assert.equal(s.tab.tuning.name, 'Standard');
  // chords: only in part 1, 8 names written, 5 different voices, all drawable from the tab (barre at the 7th-12th fret)
  const events = s.tab.parts[0].sections.flatMap((x) => x.measures.flatMap((m) => m.chords));
  assert.equal(events.length, 8);
  assert.equal(s.tab.parts[1].sections.flatMap((x) => x.measures.flatMap((m) => m.chords)).length, 0);
  assert.deepEqual(s.chords, ['F#m7', 'A', 'D', 'E', 'C#m']);
  const voices = tabChordVoices(s);
  assert.equal(voices.length, 5);
  assert.ok(voices.every((v) => v.shape && v.shape.baseFret >= 7 && v.shape.barres && v.shape.barres.length === 1 && v.shape.fingers));
  assert.ok(events.every((c) => c.col >= 0 && c.shape));
  // columns: one per position with notes, positions increasing in 0..1
  for (const p of s.tab.parts) for (const x of p.sections) for (const m of x.measures) {
    assert.ok(m.columns.length > 0);
    assert.ok(m.columns.every((c, i) => c.pos >= 0 && c.pos < 1 && (i === 0 || c.pos > m.columns[i - 1].pos)));
  }
  const tl = buildTabTimeline(s);
  assert.equal(tl.events.length, 5);
  assert.equal(buildTabTimeline(s, { guide: 1 }).events.length, 4);
});

// MarkItDown (a session tool, not a dependency) reads the same PDF line by line: the tab rows agree with ours.
const hasMarkitdown = (() => { try { execFileSync('markitdown', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('real PDF: the tab rows agree with MarkItDown', { skip: skip || (hasMarkitdown ? false : 'markitdown not installed'), timeout: 60000 }, async () => {
  const mk = execFileSync('markitdown', [FILE], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).split('\n');
  const r = await readPdfText(readFileSync(FILE));
  const rowRe = /^[eBGDAE]\|/;
  const cont = /^[-0-9|hpbrx/\\~ ]+$/;
  const ours = r.lines.filter((l) => rowRe.test(l));
  const theirs = mk.filter((l) => rowRe.test(l));
  // MarkItDown loses the rows under a banner of the page: it may have fewer, never different
  assert.ok(ours.length >= theirs.length && ours.length - theirs.length <= 2, `${ours.length} vs ${theirs.length}`);
  const set = new Set(ours);
  const same = theirs.filter((l) => set.has(l)).length;
  assert.ok(same >= theirs.length - 2, `${same}/${theirs.length} rows identical`);
  const oc = r.lines.filter((l) => cont.test(l) && l.includes('-')).length;
  const tc = mk.filter((l) => cont.test(l) && l.includes('-')).length;
  assert.ok(Math.abs(oc - tc) <= 2, `${oc} vs ${tc} continuation rows`);
});
