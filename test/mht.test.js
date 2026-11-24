import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMht, extractMainHtml, decodeQuotedPrintable, decodeBase64, decodeEncodedWords } from '../src/mht.js';

const SYN = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic');
const read = (n) => readFileSync(join(SYN, n), 'utf-8');

test('quoted-printable: soft breaks, hex bytes and charset', () => {
  assert.equal(decodeQuotedPrintable('Citt=C3=A0 di =\r\nCarta'), 'Città di Carta');
  assert.equal(decodeQuotedPrintable('Citt=E0', 'iso-8859-1'), 'Città');
  assert.equal(decodeQuotedPrintable('a=3Db'), 'a=b');
  assert.equal(decodeQuotedPrintable('100% =ZZ'), '100% =ZZ');
});

test('base64 decoding ignores whitespace and honours charset', () => {
  const b64 = Buffer.from('Città', 'utf-8').toString('base64');
  assert.equal(decodeBase64(b64.slice(0, 4) + '\r\n' + b64.slice(4)), 'Città');
  assert.equal(decodeBase64('Q2l0dOA=', 'iso-8859-1'), 'Città');
});

test('RFC 2047 encoded words (Q and B, adjacent words joined)', () => {
  assert.equal(decodeEncodedWords('=?utf-8?Q?Citt=C3=A0_di?='), 'Città di');
  assert.equal(decodeEncodedWords('=?utf-8?B?Q2l0dMOg?= =?utf-8?Q?_x?='), 'Città x');
  assert.equal(decodeEncodedWords('plain text'), 'plain text');
});

test('folded boundary header and parts of the binary fixture', () => {
  const mht = parseMht(read('song-binary.mht'));
  assert.equal(mht.parts.length, 3);
  assert.deepEqual(mht.parts.map((p) => p.contentType), ['text/html', 'text/css', 'image/gif']);
  assert.match(mht.parts[0].body, /^<!DOCTYPE html>/);
  assert.match(mht.parts[0].body, /<\/html>$/);
  assert.equal(mht.parts[1].body, 'body { color: #000; }');
});

test('all encodings yield the same main HTML', () => {
  const a = extractMainHtml(read('song-binary.mht'));
  const b = extractMainHtml(read('song-qp.mht'));
  const c = extractMainHtml(read('song-base64.mht'));
  const norm = (s) => s.replace(/\r\n/g, '\n');
  assert.equal(norm(b.html), norm(a.html));
  assert.equal(norm(c.html), norm(a.html));
  assert.ok(a.html.includes('Città di Carta'));
});

test('subject is decoded, url is taken from the snapshot header', () => {
  const qp = extractMainHtml(read('song-qp.mht'));
  assert.equal(qp.subject, 'CITTÀ DI CARTA CHORDS (ver 2) by Gruppo Immaginario @ Ultimate-Guitar.Com');
  assert.match(qp.url, /^https:\/\/example\.invalid\//);
});

test('boundary without quotes and LF/CRLF line endings', () => {
  const crlf = 'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=BND\r\n\r\n--BND\r\nContent-Type: text/html\r\n\r\n<p>ciao</p>\r\n--BND--\r\n';
  assert.equal(extractMainHtml(crlf).html, '<p>ciao</p>');
  assert.equal(extractMainHtml(crlf.replace(/\r\n/g, '\n')).html, '<p>ciao</p>');
});

test('a plain html file is returned untouched', () => {
  const html = '<html><body><pre>x</pre></body></html>';
  assert.equal(extractMainHtml(html).html, html);
});

test('errors are user friendly (Italian)', () => {
  assert.throws(() => extractMainHtml(''), /vuoto/);
  const noHtml = 'MIME-Version: 1.0\nContent-Type: multipart/related; boundary=B\n\n--B\nContent-Type: text/css\n\nbody{}\n--B--\n';
  assert.throws(() => extractMainHtml(noHtml), /non contiene una pagina HTML/);
});
