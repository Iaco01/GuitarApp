// Round 2 tester: A3 timing of the parser on hostile inputs (linear?). Run: node test/e2e/round2-tester-parser-perf.mjs
import { parseSongFromMht } from '../../src/parser.js';
const mk = (pre) => `Subject: T CHORDS by A\nContent-Type: multipart/related; boundary="B"\n\n--B\nContent-Type: text/html\nContent-Transfer-Encoding: 8bit\n\n<html><body><code class="js-tab-content">${pre}</code></body></html>\n--B--\n`;
const S = '<span class="tabContent-chord js-chord-chord">';
const cases = {
  'unclosed x20000': '<pre>' + S.repeat(20000) + '</pre>',
  'unclosed x100000': '<pre>' + S.repeat(100000) + '</pre>',
  'closed named x20000 (one line)': '<pre>[A]\n' + (S + 'G</span> ').repeat(20000) + '\nlyric</pre>',
  'closed empty x20000': '<pre>[A]\n' + (S + '</span> ').repeat(20000) + '\nlyric</pre>',
  'nested x20000': '<pre>' + (S + 'G').repeat(20000) + '</span>'.repeat(20000) + '</pre>',
  'many short lines x20000': '<pre>[A]\n' + (S + 'G</span>\nx\n').repeat(20000) + '</pre>',
};
let fail = 0;
for (const [k, v] of Object.entries(cases)) {
  const t0 = Date.now();
  let res = 'ok';
  try { parseSongFromMht(mk(v)); } catch (e) { res = 'error: ' + String(e.message).slice(0, 50); }
  const dt = Date.now() - t0;
  if (dt > 1000) fail++;
  console.log(`${dt > 1000 ? 'FAIL' : 'PASS'} ${k}: ${dt} ms (${res})`);
}
process.exit(fail ? 1 : 0);
