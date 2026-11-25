// Round 5 point 8: spacing of the text under the chords, on the real file (not versioned).
// Run: npm run build && node test/e2e/round5-text.cjs [path/to/index.html]
// Counts lines whose rendered text has gaps wider than the original spaces, label overlaps, horizontal scroll.
// Only counts and positions are printed, never the lyrics.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = process.argv[2] || path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-5');
fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[3] || 'after';
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };

function probe() {
  const body = document.querySelector('.song-body');
  const lines = [...body.querySelectorAll('.line')].filter((l) => l.getBoundingClientRect().width > 0);
  let withExtra = 0; let extraGaps = 0; let checkedLines = 0; let onWidenedSeg = 0;
  for (const line of lines) {
    // characters of the lyric in DOM order, labels excluded
    const chars = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.ch') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) for (let i = 0; i < n.data.length; i++) chars.push([n, i]);
    const rect = ([n, i]) => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); return r.getBoundingClientRect(); };
    const chW = (() => { const s = document.createElement('span'); s.textContent = '0'.repeat(50); s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit'; line.append(s); const w = s.getBoundingClientRect().width / 50; s.remove(); return w; })();
    let prev = null; let spaces = 0; let lineExtra = false; let any = false;
    for (const c of chars) {
      const ch = c[0].data[c[1]];
      if (/\s/.test(ch)) { spaces++; continue; }
      const r = rect(c);
      if (prev && Math.abs(r.top - prev.top) < 3 && r.width > 0) {
        any = true;
        const gap = r.left - prev.right;
        if (gap > spaces * chW + 1) { extraGaps++; lineExtra = true; if (c[0].parentElement.closest('.seg')) onWidenedSeg++; }
      }
      prev = r; spaces = 0;
    }
    if (any) checkedLines++;
    if (lineExtra) withExtra++;
  }
  const rects = [...document.querySelectorAll('.song-body .ch')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  rects.sort((a, b) => a.top - b.top);
  let hits = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length && rects[j].top < rects[i].bottom; j++) {
    const a = rects[i], b = rects[j];
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) hits++;
  }
  const iw = window.innerWidth;
  const beyond = rects.filter((r) => r.right > iw + 0.5).length;
  const widened = [...document.querySelectorAll('.seg')].filter((s) => s.style.minWidth).length;
  return { lines: lines.length, checkedLines, withExtra, extraGaps, labels: rects.length, hits, beyond, widened, sw: document.documentElement.scrollWidth, iw, bw: document.body.scrollWidth };
}

(async () => {
  const browser = await chromium.launch();
  for (const scale of [1.0, 2.0]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('file://' + DIST);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#song-title');
    await page.click('#btn-collapse'); // expanded: every section on screen
    let cur = await page.evaluate(() => parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')));
    while (cur < scale - 0.01) { await page.click('#btn-font-up'); cur = Math.round((cur + 0.1) * 10) / 10; }
    const r = await page.evaluate(probe);
    console.log(`${tag}@${scale}`, JSON.stringify(r));
    rec(`${tag}@${scale} no label overlap`, r.hits === 0, `${r.labels} labels`);
    rec(`${tag}@${scale} no horizontal scroll`, r.sw <= r.iw && r.bw <= r.iw, `sw ${r.sw} iw ${r.iw}`);
    console.log(`INFO ${tag}@${scale} lines with a gap wider than the original spaces: ${r.withExtra} of ${r.checkedLines}; labels past the right edge: ${r.beyond}`);
    await page.evaluate(() => document.querySelector('.sec').scrollIntoView());
    await page.screenshot({ path: path.join(OUT, `text-${tag}-${scale}.png`) });
    await ctx.close();
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
