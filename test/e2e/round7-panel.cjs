// Round 7 correction 1: the rhythm row of the play panel (own row, cells >= 14 px, current cell always on,
// panel height). Run: npm run build && node test/e2e/round7-panel.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-7');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
// panel height of the round 6 build (rhythm squeezed in row 2), measured by the round 6 tester
const OLD_H = { 360: 112.5, SE: 99, 13: 99 };
const PROFILES = {
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [name, prof] of Object.entries(PROFILES)) {
    const ctx = await browser.newContext(prof);
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 15000 });
    if (await page.evaluate(() => window.innerHeight < 700)) {
      await page.click('#btn-more');
      await page.click('#btn-pp-rhythm');
      await page.click('#btn-more');
    }
    const hBefore = await page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
    // sample at every frame for 6 s
    const res = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0; let bad = 0; let multi = 0; let counting = 0; let withStrum = 0;
      const t0 = performance.now();
      const tick = () => {
        const cells = document.querySelectorAll('#pp-pattern .pp-cell');
        const now = document.querySelectorAll('#pp-pattern .pp-cell.now').length;
        if (window.__gapp.player.state === 'playing' && cells.length) {
          withStrum++;
          if (now === 0) bad++;
          if (now > 1) multi++;
        } else counting++;
        frames++;
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick); else resolve({ frames, bad, multi, counting, withStrum });
      };
      requestAnimationFrame(tick);
    }));
    const geo = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('#pp-pattern .pp-cell')];
      const pat = document.querySelector('#pp-pattern').getBoundingClientRect();
      const panel = document.querySelector('#playpanel').getBoundingClientRect();
      const r2 = document.querySelector('.pp-row2').getBoundingClientRect();
      return { n: cells.length, w: Math.min(...cells.map((c) => c.getBoundingClientRect().width)), pw: pat.width, ph: panel.height, patTop: pat.top, row2Bottom: r2.bottom, vw: innerWidth, panelRight: panel.right };
    });
    rec(`${name} cells >= 14 px, own row below row 2`, geo.n >= 8 && geo.w >= 14 && geo.patTop >= geo.row2Bottom - 1, JSON.stringify(geo));
    rec(`${name} current cell highlighted in every sampled frame`, res.withStrum > 100 && res.bad === 0 && res.multi === 0, JSON.stringify(res));
    rec(`${name} panel grows by at most 24 px`, geo.ph - OLD_H[name] <= 24.5, `round 6: ${OLD_H[name]}, now ${hBefore} idle -> ${geo.ph} playing`);
    await page.screenshot({ path: path.join(OUT, `panel-${name}.png`) });
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
