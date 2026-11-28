import test from 'node:test';
import assert from 'node:assert/strict';
import { readPdfText, parseToUnicode, glyphsToLines } from '../src/pdf.js';
import { syntheticTabText, makeTabPdf } from './fixtures/tab-fixtures.mjs';

const lines = (text) => text.split('\n');

test('reads the lines and the columns of a compressed PDF with a Type0 font', async () => {
  const text = syntheticTabText({ wrap: 20 });
  const pdf = await makeTabPdf(lines(text));
  const r = await readPdfText(pdf);
  const got = r.lines.filter((l) => l !== '');
  const want = lines(text).filter((l) => l.trim() !== '');
  assert.deepEqual(got, want);
  assert.equal(r.title, 'Invented Song TAB by Imaginary Band @ Example.Com');
  assert.deepEqual(r.warnings, []);
});

test('xref stream, object stream and PNG predictor', async () => {
  const text = syntheticTabText();
  const pdf = await makeTabPdf(lines(text), { xrefStream: true });
  const r = await readPdfText(pdf);
  assert.deepEqual(r.lines.filter((l) => l !== ''), lines(text).filter((l) => l.trim() !== ''));
  assert.deepEqual(r.warnings, []);
});

test('uncompressed streams and a simple font with Tj/TJ spacing', async () => {
  const text = syntheticTabText({ wrap: 24 });
  const pdf = await makeTabPdf(lines(text), { compress: false, simpleFont: true });
  const r = await readPdfText(pdf);
  assert.deepEqual(r.lines.filter((l) => l !== ''), lines(text).filter((l) => l.trim() !== ''));
});

test('several pages keep the order of the lines', async () => {
  const text = syntheticTabText({ wrap: 20 });
  const pdf = await makeTabPdf(lines(text), { linesPerPage: 15 });
  const r = await readPdfText(pdf);
  assert.ok(r.pages.length >= 3);
  assert.deepEqual(r.lines.filter((l) => l !== ''), lines(text).filter((l) => l.trim() !== ''));
});

test('a banner in another font on the line of a tab row becomes a line of its own', async () => {
  const rows = ['e|--0--0--0--0--0--0--0--0--|', 'B|--1--1--1--1--1--1--1--1--|', { overlay: 'CONTINUE IN THE APP', at: 4 }, 'G|--0--0--0--0--0--0--0--0--|'];
  const pdf = await makeTabPdf(rows);
  const r = await readPdfText(pdf);
  const tab = r.lines.filter((l) => /^[eBG]\|/.test(l));
  assert.deepEqual(tab, ['e|--0--0--0--0--0--0--0--0--|', 'B|--1--1--1--1--1--1--1--1--|', 'G|--0--0--0--0--0--0--0--0--|']);
  assert.ok(r.lines.some((l) => l.includes('CONTINUE IN THE APP')));
});

test('not a PDF, and a PDF whose xref is damaged', async () => {
  await assert.rejects(readPdfText(new TextEncoder().encode('hello world, this is not a pdf at all')), /non è un PDF/);
  const pdf = await makeTabPdf(['e|--0--0--|', 'B|--1--1--|']);
  const broken = pdf.slice();
  const s = Buffer.from(broken).toString('latin1');
  const k = s.lastIndexOf('startxref');
  broken.set(Buffer.from('startxref\n7'), k);
  const r = await readPdfText(broken);
  assert.deepEqual(r.lines.filter((l) => l), ['e|--0--0--|', 'B|--1--1--|']);
  assert.ok(r.warnings.length >= 1);
});

test('ToUnicode: bfchar, bfrange with a start and with an array, code length', () => {
  const cmap = new TextEncoder().encode([
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '2 beginbfchar <0001> <0041> <0002> <00660069> endbfchar',
    '2 beginbfrange <0010> <0012> <0061> <0020> <0021> [<0058> <0059>] endbfrange',
  ].join('\n'));
  const { map, codeBytes } = parseToUnicode(cmap);
  assert.equal(codeBytes, 2);
  assert.equal(map.get(1), 'A');
  assert.equal(map.get(2), 'fi');
  assert.equal([0x10, 0x11, 0x12].map((c) => map.get(c)).join(''), 'abc');
  assert.equal(map.get(0x20), 'X');
  assert.equal(map.get(0x21), 'Y');
});

test('glyphsToLines: columns from the glyph advance, sorted top to bottom', () => {
  const g = (ch, x, y) => ({ ch, x, y, adv: 6, size: 10, f: 1 });
  const out = glyphsToLines([g('b', 30, 700), g('a', 12, 700), g('z', 12, 712), g('c', 36, 700)]);
  assert.deepEqual(out.map((l) => l.text), ['z', 'a  bc']);
});
