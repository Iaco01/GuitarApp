// Round 10 tester, D: the sync screen of the real song at 320, 360, iPhone SE and 13: every text element checked for cut text
// (ellipsis / overflow / clipped by the row), row heights, horizontal overflow, the "Correggi a orecchio" bar with 35 chords,
// and the section-nudge entry visibility. Screenshots in test-artifacts/round-10/texts/ (they show section names only).
// Run: node scripts/build.mjs && node test/e2e/round10-tester-texts.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-10', 'texts');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILES = {
  320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const w of ['320', '360', 'SE', '13']) {
    const page = await (await browser.newContext(PROFILES[w])).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
    await page.goto(URL); await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
    await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' }); await page.setInputFiles('#sync-file', MP3);
    await page.waitForSelector('#as-start'); await page.click('#as-start'); await page.waitForSelector('#as-rows', { timeout: 240000 });
    // every text-bearing leaf inside the summary
    const cut = await page.evaluate(() => {
      const out = []; const root = document.querySelector('#as-box') || document.body;
      const vw = document.documentElement.clientWidth;
      root.querySelectorAll('*').forEach((e) => {
        if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
        const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); if (!r.width) return;
        const clipped = (cs.textOverflow === 'ellipsis' || cs.overflow !== 'visible') && e.scrollWidth > e.clientWidth + 1;
        const outside = r.right > vw + 0.5 || r.left < -0.5;
        let par = e.parentElement, parentClip = false; while (par && par !== root) { const pr = par.getBoundingClientRect(); const pcs = getComputedStyle(par); if ((pcs.overflow !== 'visible') && (r.right > pr.right + 1 || r.bottom > pr.bottom + 1)) parentClip = true; par = par.parentElement; }
        const lines = Math.round(r.height / parseFloat(cs.lineHeight || cs.fontSize));
        if (clipped || outside || parentClip) out.push(`${e.tagName}.${e.className} "${e.textContent.trim().slice(0, 28)}" clipped=${clipped} outside=${outside} parentClip=${parentClip}`);
      });
      return out;
    });
    const rows = await page.$$eval('.as-row', (r) => r.map((x) => Math.round(x.getBoundingClientRect().height)));
    const gapRows = await page.$$eval('.as-gap', (g) => g.map((x) => ({ h: Math.round(x.getBoundingClientRect().height), t: x.textContent.replace(/\d+:\d\d/g, 'm:ss').trim() })));
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const states = await page.$$eval('.as-state', (e) => [...new Set(e.map((x) => x.textContent))]);
    const whys = await page.$$eval('.as-why', (e) => [...new Set(e.map((x) => x.textContent))]);
    console.log(`[${w}] rows ${rows.length}: heights ${Math.min(...rows)}-${Math.max(...rows)} px; cut/outside elements: ${cut.length}${cut.length ? ' ' + JSON.stringify(cut.slice(0, 5)) : ''}; page overflow-x ${overflowX}px; states ${JSON.stringify(states)}; reasons ${JSON.stringify(whys)}; gap rows ${JSON.stringify(gapRows)}`);
    await page.evaluate(() => document.querySelector('#as-box').scrollIntoView()); await sleep(200);
    await page.screenshot({ path: path.join(OUT, `${w}-summary-top.png`) });
    await page.evaluate(() => document.querySelector('.as-row[data-sec="5"]').scrollIntoView({ block: 'center' })); await sleep(200);
    await page.screenshot({ path: path.join(OUT, `${w}-summary-mid.png`) });
    await page.evaluate(() => document.querySelector('.as-gap').scrollIntoView({ block: 'center' })); await sleep(200);
    await page.screenshot({ path: path.join(OUT, `${w}-summary-gap.png`) });
    // correction screen with a long section (35 chords: Verse 2 = section 3 has 36 chords)
    const si = await page.$$eval('.as-row', (r) => { let best = 0, bn = 0; r.forEach((x, i) => { const n = Number(x.dataset.sec); }); return 2; });
    await page.locator(`.as-row[data-sec="${si}"] [data-act="correct"]`).scrollIntoViewIfNeeded(); await page.locator(`.as-row[data-sec="${si}"] [data-act="correct"]`).tap();
    await page.waitForSelector('#corr-tap'); await sleep(600);
    const bar = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; }; return { preview: r('#corr-preview'), save: r('#corr-save'), tap: r('#corr-tap'), vh: window.innerHeight, texts: [...document.querySelectorAll('.corr-note, #corr-hint, .corr-help')].map((e) => e.textContent.trim().slice(0, 120)) }; });
    console.log(`[${w}] correction (36 chords): Anteprima ${JSON.stringify(bar.preview)}, Salva ${JSON.stringify(bar.save)}, big button ${JSON.stringify(bar.tap)}, viewport h ${bar.vh}; notes ${JSON.stringify(bar.texts)}`);
    await page.screenshot({ path: path.join(OUT, `${w}-correct.png`) });
    if (errors.length) console.log('errors', errors.join('|'));
    await page.context().close();
  }
  await browser.close();
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
