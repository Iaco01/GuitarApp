// Round 3: play panel size and scroll position. Run: npm run build && node test/e2e/round3-panel.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const profiles = [
    ['w360', { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } }],
    ['iphone13', devices['iPhone 13']],
  ];
  for (const [name, prof] of profiles) {
    const ctx = await browser.newContext(prof);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    await page.goto(URL);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#song-title');
    for (const scale of [1, 1.5]) {
      await page.evaluate(() => { window.scrollTo(0, 0); });
      while (true) {
        const cur = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.screen.song')).getPropertyValue('--fs')));
        if (Math.abs(cur - scale) < 0.01) break;
        await page.click(cur < scale ? '#btn-font-up' : '#btn-font-down');
      }
      await page.click('#btn-play');
      await sleep(1500);
      for (const target of ['2.2.0', '0.4.0', '4.1.0']) {
      await page.evaluate((t) => { const el = document.querySelector(`.ch[data-ref="${t}"]`); el.click(); }, target);
      await sleep(7000);
      const m = await page.evaluate(() => {
        const p = document.querySelector('#playpanel').getBoundingClientRect();
        const lines = [...document.querySelectorAll('.song-body .line')].filter((l) => l.getBoundingClientRect().width > 0);
        window.__dbg = lines.slice(0,12).map((l) => { const r = l.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
        const tbEl = document.querySelector('.topbar'); const tb = getComputedStyle(tbEl).position === 'sticky' ? tbEl.getBoundingClientRect().bottom : 0;
        const vis = lines.filter((l) => { const r = l.getBoundingClientRect(); return r.top >= tb && r.bottom <= p.top; });
        const cur = document.querySelector('.ch.cur');
        const cl = cur && cur.closest('.line').getBoundingClientRect();
        return { panelH: p.height, panelW: p.width, vh: innerHeight, fullLines: vis.length, curFrac: cl ? cl.top / (p.top) : null, overflowX: document.documentElement.scrollWidth - innerWidth, topbar: tb };
      });
      console.log(name, 'scale', scale, target, JSON.stringify(m));
      }
      if (scale === 1.5) await page.screenshot({ path: path.join(OUT, `panel-${name}.png`) });
      await page.click('#btn-play');
      await sleep(300);
    }
    await page.click('#btn-more');
    await page.screenshot({ path: path.join(OUT, `panel-more-${name}.png`) });
    console.log(name, 'errors', JSON.stringify(errs));
    await ctx.close();
  }
  await browser.close();
})();
