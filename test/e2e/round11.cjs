// Round 11 in the app (Playwright): the nudge button on every section header (after the sync and after a reload), long press
// on a chord (release does not press what appears under the finger, a trembling finger does not cancel it, no text selection),
// the one-time hint.  Synthetic song of round10-tester-make.mjs (node test/e2e/round10-tester-make.mjs).
// Run: node scripts/build.mjs && node test/e2e/round11.cjs <btn|press|hint|all> [SE|13|320]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const OUT = path.join(ROOT, 'test-artifacts', 'round-10');
const SONG = path.join(OUT, 'synth', 'r10-song.json');
const MP3 = path.join(OUT, 'synth', 'r10.mp3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'all';
let dev = process.argv[3] || 'SE';
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'], 320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };
let fails = 0;
let dev0 = dev; // eslint-disable-line no-unused-vars
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[dev]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => { try { const d = JSON.parse(localStorage.getItem('gapp.device.v1') || '{}'); d.barAutoCollapse = false; localStorage.setItem('gapp.device.v1', JSON.stringify(d)); } catch (e) { /* round 13: the bar stays open for these older checks */ } });
  await page.goto(URL);
  const cdp = await ctx.newCDPSession(page);
  return { browser, page, errors, cdp };
}
async function loadSynthAndSync(page) {
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  await page.click('#as-accept').catch(() => {}); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
}
const heads = (page) => page.evaluate(() => ({ heads: document.querySelectorAll('.sec-head').length, nudge: document.querySelectorAll('.sec-head .sec-nudge').length }));
const times = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment.eventStartSec.slice());
async function touch(cdp, type, x, y) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }); }

async function corr320() {
  const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
  const REALMP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
  if (!fs.existsSync(REALMP3)) { console.log('real mp3 absent: skip'); return; }
  for (const d of ['320', 'SE']) {
    dev = d + '-corr';
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await (await browser.newContext(PROFILES[d])).newPage();
    await page.goto(URL);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
    await page.setInputFiles('#sync-file', REALMP3); await page.waitForSelector('#as-start'); await page.click('#as-start');
    await page.waitForSelector('#as-rows', { timeout: 240000 });
    await page.click('.as-row[data-sec="0"] [data-act="correct"]');
    await page.waitForSelector('#corr-tap');
    await sleep(500);
    const v = await page.evaluate(() => { const t = document.getElementById('corr-tap').getBoundingClientRect(); const f = document.getElementById('corr-foot').getBoundingClientRect(); return { tapTop: t.top, tapBottom: t.bottom, footTop: f.top, vh: window.innerHeight, n: document.querySelectorAll('.corr-chip').length }; });
    rec('C1 «Cambio!» is entirely above the fixed bar from the first instant (35 chords)', v.n === 35 && v.tapBottom <= v.footTop + 0.5 && v.tapTop >= 0, JSON.stringify(v));
    await browser.close();
  }
}

async function main() {
  if (mode === 'corr') { await corr320(); console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0); }
  const { browser, page, errors, cdp } = await open();
  await loadSynthAndSync(page);
  if (mode === 'btn' || mode === 'all') {
    await sleep(800);
    const h = await heads(page);
    rec('N1 the nudge button is on every section header right after the sync', h.heads > 0 && h.nudge === h.heads, JSON.stringify(h));
    await page.reload();
    await page.waitForSelector('#btn-play');
    await sleep(1200);
    const h2 = await heads(page);
    rec('N2 ... and after a reload', h2.heads > 0 && h2.nudge === h2.heads, JSON.stringify(h2));
  }
  if (mode === 'hint' || mode === 'all') {
    // the hint appears the first time a synced song is opened, once
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('gapp.device.v1') || '{}'); delete d.nudgeHintShown; localStorage.setItem('gapp.device.v1', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('#btn-play'); await sleep(1500);
    const t1 = await page.evaluate(() => (document.querySelector('.msg[role=alert]') || {}).textContent || '');
    rec('H1 the hint shows the first time', /Tieni premuto un accordo/.test(t1), t1);
    await page.reload(); await page.waitForSelector('#btn-play'); await sleep(1500);
    const t2 = await page.evaluate(() => (document.querySelector('.msg[role=alert]') || {}).textContent || '');
    rec('H2 and not the second time', !/Tieni premuto un accordo/.test(t2), t2);
  }
  if (mode === 'press' || mode === 'all') {
    await page.reload(); await page.waitForSelector('#btn-play'); await sleep(1200);
    // a chord in the middle of the screen: the sheet opens under the finger
    const sel = '.ch[data-ref]';
    const n = await page.locator(sel).count();
    const target = page.locator(sel).nth(Math.floor(n / 2));
    await target.scrollIntoViewIfNeeded();
    // where does the "-0,25 s" button of the sheet land? (the sheet is at the bottom of the screen) put the chord right there
    let b0 = await target.boundingBox();
    await page.evaluate((d) => window.scrollBy(0, d), b0.y - 300);
    await sleep(300);
    b0 = await target.boundingBox();
    await touch(cdp, 'touchStart', b0.x + b0.width / 2, b0.y + b0.height / 2);
    await sleep(700);
    const bt = await page.locator('#nudge-time ~ .sync-fine button').first().boundingBox();
    await touch(cdp, 'touchEnd', 0, 0);
    await sleep(500);
    await page.click('#nudge-close');
    b0 = await target.boundingBox();
    await page.evaluate((d) => window.scrollBy(0, d), b0.y + b0.height / 2 - (bt.y + bt.height / 2));
    await sleep(300);
    const b = await target.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const before = await times(page);
    // 1. long press with a trembling finger (3 px), release: the sheet opens and nothing under the finger was pressed
    await touch(cdp, 'touchStart', x, y);
    for (let i = 0; i < 6; i++) { await sleep(110); await touch(cdp, 'touchMove', x + (i % 2 ? 3 : -3), y + (i % 2 ? -2 : 2)); }
    await sleep(100);
    const opened = await page.locator('#nudge-time').count();
    await touch(cdp, 'touchEnd', x, y);
    await sleep(500);
    rec('P1 a long press with a trembling finger (3 px) opens the sheet', opened === 1, `opened ${opened}`);
    const after = await times(page);
    rec('P2 the release does not press the button under the finger (no time changed)', JSON.stringify(after) === JSON.stringify(before), `${after.filter((v, i) => v !== before[i]).length} changed`);
    const msg = await page.locator('#nudge-msg').textContent();
    rec('P3 no message of an accidental press', !msg, msg);
    await page.click('#nudge-close');
    // 2. text selection and callout are off on a chord
    const css = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.ch')); return c.userSelect || c.webkitUserSelect; });
    const rule = /\.ch \{[^}]*-webkit-touch-callout: none/.test(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf-8'));
    rec('P4 chords: user-select none, no touch callout', css === 'none' && rule, css + ' ' + rule);
    const ctx = await page.evaluate(() => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('.ch').dispatchEvent(ev); return ev.defaultPrevented; });
    rec('P5 no context menu on a chord', ctx === true);
    // 3. a scroll (30 px) cancels the long press
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
    const b2 = await page.locator(sel).first().boundingBox();
    await touch(cdp, 'touchStart', b2.x + b2.width / 2, b2.y + b2.height / 2);
    await sleep(200);
    await touch(cdp, 'touchMove', b2.x + b2.width / 2, b2.y + b2.height / 2 + 30);
    await sleep(500);
    const op3 = await page.locator('#nudge-time').count();
    await touch(cdp, 'touchEnd', 0, 0);
    rec('P6 a scroll of 30 px cancels the long press', op3 === 0, `opened ${op3}`);
  }
  rec('Z no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log('ERR', e); process.exit(1); });
