// Reproductions of bugs found by the round 1 tester. Marked `todo`: they are NOT part of
// `npm test` (glob test/*.test.js). Run: node --test test/regression/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSongFromMht } from '../../src/parser.js';

const mk = (pre) => `Subject: T CHORDS by A\nContent-Type: multipart/related; boundary="B"\n\n--B\nContent-Type: text/html\nContent-Transfer-Encoding: 8bit\n\n<html><body><code class="js-tab-content">${pre}</code></body></html>\n--B--\n`;

test('bug #3: chord spans with no name must not create empty-named chords', { todo: 'bug #3' }, () => {
  const s = parseSongFromMht(mk('<pre>[A]\n<span class="tabContent-chord js-chord-chord"></span>   <span class="tabContent-chord js-chord-chord" data-original-chord="">x</span>\nlyric</pre>'));
  const names = s.sections.flatMap((x) => x.lines).flatMap((l) => l.chords).map((c) => c.name);
  assert.ok(names.every((n) => n !== ''), JSON.stringify(names));
});

test('bug #4: many unclosed chord spans must not take quadratic time', { todo: 'bug #4' }, () => {
  const html = mk('<pre>' + '<span class="tabContent-chord js-chord-chord">'.repeat(6000) + '</pre>');
  const t0 = Date.now();
  try { parseSongFromMht(html); } catch { /* an error is fine */ }
  const dt = Date.now() - t0;
  assert.ok(dt < 1000, `took ${dt} ms for 6000 unclosed spans`);
});
