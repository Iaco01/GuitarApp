// Round 5 tester: sync screen bar, loop/click indicators in the panel and the "user trial" flow on
// iPhone SE, iPhone 13 and a 320x568 phone. Synthetic track only. Screenshots in test-artifacts/round-5/tester/ui/.
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round5-tester-ui.cjs [SE|13|320]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const D4 = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-5', 'tester', 'ui');
fs.mkdirSync(OUT, { recursive: true });
const EXP = JSON.parse(fs.readFileSync(path.join(D4, 't4-expected.json'), 'utf-8'));
const starts = EXP.sections.map((s) => s.startSec);
const PROFILES = { SE: devices['iPhone SE (3rd gen)'], 13: devices['iPhone 13'], 320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const only = process.argv[2] || '';
let fails = 0; let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const seek = (page, t) => page.evaluate((x) => window.__gappSync.player.seek(x), t);
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width, left: r.left, right: r.right }; }, sel);

async function run(label, profile) {
  dev = label;
  const vh = profile.viewport.height;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${label}-${n}.png`) });
  await page.goto('file://' + path.join(ROOT, 'dist', 'index.html'));
  await shot('01-library');
  await page.setInputFiles('#import-json', path.join(D4, 't4-song.json'));
  await page.waitForSelector('.dlg', { timeout: 4000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
  await shot('02-song');
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await shot('03-sync-empty');
  await page.setInputFiles('#sync-file', path.join(D4, 't4.wav'));
  await page.waitForSelector('#sync-first', { timeout: 15000 });
  await page.waitForTimeout(400);
  await shot('04-sync-loaded');
  // B2: bar height and buttons right after loading, before any scroll
  const bar = await rect(page, '#sync-transport');
  const first = await rect(page, '#sync-first');
  const play = await rect(page, '#sync-play');
  const anch = await page.evaluate(() => { const e = document.querySelector('#sync-next'); if (!e) return null; const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, top: r.top, bottom: r.bottom }; });
  info('B2', `viewport ${profile.viewport.width}x${vh}; bar ${bar ? `top ${bar.top.toFixed(0)} h ${bar.h.toFixed(0)} (${(bar.h / vh * 100).toFixed(1)}%)` : 'not found'}; "Primo accordo!" ${first.w.toFixed(0)}x${first.h.toFixed(0)} bottom ${first.bottom.toFixed(0)}; anchor button ${anch ? `${anch.w.toFixed(0)}x${anch.h.toFixed(0)}` : 'n/a'}; Play ${play.w.toFixed(0)}x${play.h.toFixed(0)}`);
  rec('B2 "Primo accordo!" and anchor button >= 56 px high, inside the viewport with no scroll', first.h >= 55.5 && first.bottom <= vh && first.top >= 0 && anch && anch.h >= 55.5 && anch.bottom <= vh);
  // press Play: still reachable, toast does not hide them
  await page.click('#sync-play');
  await page.waitForFunction(() => window.__gappSync.element.currentTime > 1.0);
  await shot('05-sync-playing');
  const m = await page.evaluate(() => ({ s: window.scrollY, first: document.querySelector('#sync-first').getBoundingClientRect().bottom, vh: innerHeight }));
  rec('B2 while the music plays the buttons are still in view without scrolling', m.first <= m.vh, JSON.stringify(m));
  await page.waitForFunction(() => window.__gappSync.element.currentTime > 2.345);
  await page.click('#sync-first');
  await page.waitForTimeout(300);
  await shot('06-after-first');
  const toast = await page.evaluate(() => { const t = document.querySelector('#sync-msg'); const r = t.getBoundingClientRect(); const b = document.querySelector('#sync-first').getBoundingClientRect(); return { text: t.textContent.length, h: r.height, bottom: r.bottom, barTop: b.top, scrollW: t.scrollWidth, clientW: t.clientWidth }; });
  info('B2', `message sheet height ${toast.h.toFixed(0)}, bottom ${toast.bottom.toFixed(0)} vs bar-button top ${toast.barTop.toFixed(0)}; text clipped horizontally: ${toast.scrollW > toast.clientW}`);
  await page.click('#sync-play');
  // "⋯"
  const more = await page.$('#sync-more-btn');
  if (more) { await more.click(); await page.waitForTimeout(200); const bar2 = await rect(page, '#sync-transport'); info('B2', `bar with ⋯ open: h ${bar2 && bar2.h.toFixed(0)} (${bar2 && (bar2.h / vh * 100).toFixed(1)}%)`); await shot('07-sync-more'); await more.click(); }
  // anchors for the sections, the end, then close
  for (const i of [1, 2, 3]) { await seek(page, starts[i] + 0.04); await page.click(`#sync-rows li[data-sec="${i}"] [data-act="here"]`).catch(() => {}); }
  await page.evaluate(() => document.querySelector('#sync-rows').scrollIntoView());
  await shot('08-sync-rows');
  await page.click('.sec-anchor, #sync-rows .sec-anchor').catch(() => {});
  await page.waitForTimeout(300);
  await shot('09-anchor-sheet');
  const chiudi = await page.$('button:has-text("Chiudi")');
  if (chiudi) await chiudi.click();
  await page.waitForTimeout(200);
  await page.click('#sync-close');
  await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
  await page.waitForTimeout(400);
  await shot('10-song-after-sync');
  const heads = await page.$$eval('.sec-anchor', (e) => e.length);
  rec('B1/A anchors visible in the song after "Fatto"', heads >= 1, `${heads} anchors`);
  // B3: play, then loop by a real long press on a header, panel indicators
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing');
  await page.waitForTimeout(500);
  await shot('11-playing');
  const hdr = await page.$$('.sec-head, .sec h3, .sec > header');
  const target = await page.evaluate(() => { const h = document.querySelectorAll('.sec')[1]; const e = h.querySelector('.sec-name, h3, header') || h; const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const t2 = await page.evaluate(() => { const e = document.querySelectorAll('.sec')[1]; e.scrollIntoView({ block: 'center' }); const h = e.querySelector('.sec-name, h3, header') || e; const r = h.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t2.x, y: t2.y }] });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const pp = await page.evaluate(() => { const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.bottom <= innerHeight }; }; return { loop: g('#btn-loop, .pp-loop'), click: g('#btn-metro-quick, #pp-click, .pp-click, #btn-click'), panel: g('#play-panel, .play-panel, .pp') }; });
  info('B3', JSON.stringify(pp));
  const loopBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /🔁/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), vis: r.bottom <= innerHeight && r.width > 0 }; });
  const clickBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /🔔|🔕/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), vis: r.bottom <= innerHeight && r.width > 0 }; });
  info('B3', `loop indicator ${JSON.stringify(loopBtn)}; click indicator ${JSON.stringify(clickBtn)}`);
  rec('B3 🔁 indicator visible in the panel after the long press', !!(loopBtn && loopBtn.vis));
  rec('B3 🔔/🔕 indicator visible in the panel (no need to open ⋯)', !!(clickBtn && clickBtn.vis));
  await shot('12-loop-panel');
  if (loopBtn) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /🔁/.test(x.textContent)); b.click(); });
    await page.waitForTimeout(300);
    const gone = await page.evaluate(() => ![...document.querySelectorAll('button')].some((x) => /🔁/.test(x.textContent) && x.getBoundingClientRect().width > 0));
    rec('B3 a tap on 🔁 leaves the loop', gone);
  }
  if (clickBtn) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /🔔|🔕/.test(x.textContent)); b.click(); });
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /🔔|🔕/.test(x.textContent)).textContent.trim());
    rec('B3 a tap on the bell toggles it', t !== clickBtn.t, `${clickBtn.t} -> ${t}`);
  }
  await page.click('#btn-play').catch(() => {});
  rec('no page errors', errors.length === 0, errors.slice(0, 2).join('|'));
  await browser.close();
}
(async () => {
  for (const [k, p] of Object.entries(PROFILES)) if (!only || only === k) await run(k, p);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
