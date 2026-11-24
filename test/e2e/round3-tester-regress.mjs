// Round 3 tester: runs the round 1/2 browser scripts against the round 3 UI. The play panel now hides
// stop/speed/click/tap behind a "..." button, chips became diagrams and "Sostituisci" got numbered values,
// so each script is copied to a temp file with those selectors adapted (the originals stay untouched).
// Run: npm run build && node test/e2e/round3-tester-regress.mjs [script-name ...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const all = ['round2', 'round2-tester-ui1', 'round2-tester-ui4', 'ui-round1', 'round2-tester-ui2', 'round2-tester-ui3'];
const names = process.argv.length > 2 ? process.argv.slice(2) : all;
const helper = "async function mclick(page, sel) { await page.evaluate(() => { const m = document.getElementById('pp-more'); if (m && m.hidden) document.getElementById('btn-more').click(); }); return page.click(sel); }\n";
let bad = 0;
for (const n of names) {
  let s = fs.readFileSync(path.join(dir, n + '.cjs'), 'utf8');
  s = s.replace(/page\.click\('(#btn-stop|#btn-speed-down|#btn-speed-up|#btn-metro|#btn-tap)'\)/g, "mclick(page, '$1')");
  s = s.replaceAll('[data-value="replace"]', '[data-value="replace:0"]').replace("['replace', 'both', 'cancel']", "['replace:0', 'both', 'cancel']");
  s = s.replaceAll("'.chip'", "'.dg-btn'");
  const i = s.indexOf('\n', s.indexOf("require('playwright')")) + 1;
  s = s.slice(0, i) + helper + s.slice(i);
  const tmp = path.join(dir, `_r3tmp_${n}.cjs`);
  fs.writeFileSync(tmp, s);
  const r = spawnSync('node', [tmp], { encoding: 'utf8', timeout: 900000 });
  fs.unlinkSync(tmp);
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^(PASS|OK)/gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length;
  console.log(`${n}: ${pass} pass, ${fail} fail, exit ${r.status}`);
  out.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 6).forEach((l) => console.log('  ' + l.slice(0, 200)));
  if (r.status !== 0 || fail) bad++;
}
process.exit(bad ? 1 : 0);
