// Round 5 tester: independent check of the chord labels over the real file (not versioned, never printed):
// 1. the text of every line in the page equals the parsed lyric (no spaces added or lost);
// 2. every label starts over the character of its column (offset in character widths);
// 3. the rendered width of every line vs the width of its characters (extra pixels from widened segments).
// Only counts and pixel numbers are printed. Run: npm run build && node test/e2e/round5-tester-text.cjs [360|SE|13]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-5', 'tester');
fs.mkdirSync(OUT, { recursive: true });
const DEV = process.argv[2] || '360';
const PROFILE = DEV === 'SE' ? devices['iPhone SE (3rd gen)'] : DEV === '13' ? devices['iPhone 13'] : { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };

function probe(data) {
  const lines = [...document.querySelectorAll('.song-body .line')];
  const res = { domLines: lines.length, parsedLines: data.length, textMismatch: 0, labels: 0, maxDelta: 0, over1ch: 0, over2ch: 0, extraLines: 0, extraPx: 0, maxExtraPx: 0, unmatched: 0, noLyricLines: 0 };
  const chWof = (line) => { const s = document.createElement('span'); s.textContent = '0'.repeat(50); s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit'; line.append(s); const w = s.getBoundingClientRect().width / 50; s.remove(); return w; };
  // keep only lines that are not repeated/collapsed (all visible) and match by order
  const n = Math.min(lines.length, data.length);
  for (let li = 0; li < n; li++) {
    const line = lines[li];
    const d = data[li];
    const chars = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement.closest('.ch') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.data.length; i++) chars.push([t, i]);
    const text = chars.map(([t, i]) => t.data[i]).join('');
    if (text.replace(/\s+$/, '') !== d.lyric.replace(/\s+$/, '')) { res.textMismatch++; continue; }
    const chW = chWof(line);
    const rect = ([t, i]) => { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect(); };
    const labels = [...line.querySelectorAll('.ch')];
    if (labels.length !== d.cols.length) { res.unmatched++; continue; }
    labels.forEach((lab, k) => {
      const col = d.cols[k];
      const lr = lab.getBoundingClientRect();
      if (lr.width === 0) return;
      let x;
      if (col < chars.length) x = rect(chars[col]).left;
      else if (chars.length) x = rect(chars[chars.length - 1]).right + (col - chars.length) * chW;
      else return;
      const delta = (lr.left - x) / chW;
      res.labels++;
      res.maxDelta = Math.max(res.maxDelta, Math.abs(delta));
      if (Math.abs(delta) > 1.01) res.over1ch++;
      if (Math.abs(delta) > 2) res.over2ch++;
    });
    // width of a one-row line vs its characters
    const rows = new Set(chars.filter(([t, i]) => !/\s/.test(t.data[i])).map((c) => Math.round(rect(c).top)));
    if (rows.size === 1 && chars.length) {
      const first = rect(chars[0]).left;
      const lastIdx = (() => { let k = chars.length - 1; while (k > 0 && /\s/.test(chars[k][0].data[chars[k][1]])) k--; return k; })();
      const width = rect(chars[lastIdx]).right - first;
      const extra = width - (lastIdx + 1) * chW;
      if (extra > 1) { res.extraLines++; res.extraPx += extra; res.maxExtraPx = Math.max(res.maxExtraPx, extra); }
    } else if (!chars.length) res.noLyricLines++;
  }
  res.sw = document.documentElement.scrollWidth; res.iw = window.innerWidth;
  return res;
}

(async () => {
  const { parseSongFromMht } = await import(path.join(ROOT, 'src', 'parser.js'));
  const song = parseSongFromMht(fs.readFileSync(REAL, 'utf-8'));
  const data = [];
  for (const s of song.sections) for (const l of s.lines) data.push({ lyric: l.lyric, cols: l.chords.map((c) => c.col) });
  const browser = await chromium.launch();
  for (const scale of [1.0, 2.0]) {
    const ctx = await browser.newContext(PROFILE);
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(ROOT, 'dist', 'index.html'));
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#song-title');
    await page.click('#btn-collapse');
    let cur = await page.evaluate(() => parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')));
    while (cur < scale - 0.01) { await page.click('#btn-font-up'); cur = Math.round((cur + 0.1) * 10) / 10; }
    const r = await page.evaluate(probe, data);
    console.log(`INFO ${DEV}@${scale}`, JSON.stringify(r));
    rec(`${DEV}@${scale} line count equals the parsed one`, r.domLines === r.parsedLines, `${r.domLines}/${r.parsedLines}`);
    rec(`${DEV}@${scale} text of every line identical to the parsed lyric`, r.textMismatch === 0, `${r.textMismatch} mismatches`);
    rec(`${DEV}@${scale} labels within 1 character of their column`, r.over1ch === 0, `${r.labels} labels, max ${r.maxDelta.toFixed(2)} ch, >1ch: ${r.over1ch}, >2ch: ${r.over2ch}`);
    rec(`${DEV}@${scale} no horizontal scroll`, r.sw <= r.iw, `${r.sw}/${r.iw}`);
    console.log(`INFO ${DEV}@${scale} one-row lines wider than their characters by >1 px: ${r.extraLines} (total ${r.extraPx.toFixed(0)} px, max ${r.maxExtraPx.toFixed(0)} px)`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
