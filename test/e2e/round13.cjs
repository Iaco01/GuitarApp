// Round 13 in the app (Playwright, Chromium): side chord diagrams (column, current chord lit), auto-collapsing bottom bar (mini bar),
// the Tempo control, and (with `real`) the slowdown on the real mp3. Layout part on the synthetic song (round10-tester-make.mjs).
// Screenshots go to test-artifacts/round-13/ (never committed).
// Run: node test/e2e/round10-tester-make.mjs && node scripts/build.mjs && node test/e2e/round13.cjs [320|SE|13|13L] [layout,bar,tempo]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const SYN = path.join(ROOT, 'test-artifacts', 'round-10', 'synth');
const OUT = path.join(ROOT, 'test-artifacts', 'round-13');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const modes = (process.argv[3] || 'layout,bar,tempo').split(',');
const PROFILES = {
  320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  13: devices['iPhone 13'],
  '13L': devices['iPhone 13 landscape'] || { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(PROFILES[dev])).newPage();
  const vw = PROFILES[dev].viewport ? PROFILES[dev].viewport.width : 390;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${dev}-${n}.png`) });
  await page.goto(URL);
  await page.setInputFiles('#import-json', path.join(SYN, 'r10-song.json'));
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-play');
  const q = (fn, arg) => page.evaluate(fn, arg);

  if (modes.includes('layout')) {
    const chords = await q(() => window.__gapp.timeline.events.filter((e) => !e.rest).map((e) => e.name));
    const order = []; for (const c of chords) if (!order.includes(c)) order.push(c);
    const col = await q(() => { const c = document.getElementById('dg-col'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height, names: [...c.querySelectorAll('.dg-btn')].map((b) => b.dataset.orig), btnW: Math.round(c.querySelector('.dg-btn').getBoundingClientRect().width), svgW: Math.round(c.querySelector('svg').getBoundingClientRect().width) }; });
    rec('L1 side column exists, 64-110 px wide, on the right', !!col && col.w >= 60 && col.w <= 112 && col.x + col.w <= vw + 1 && col.x > vw / 2, JSON.stringify(col && { x: col.x, w: col.w, svgW: col.svgW }));
    rec('L2 one diagram per chord, in order of first appearance', !!col && JSON.stringify(col.names) === JSON.stringify(order), `${col && col.names.length} diagrams, ${order.length} chords in the events`);
    await page.evaluate(() => window.scrollTo(0, 700)); await sleep(300);
    const col2 = await q(() => { const r = document.getElementById('dg-col').getBoundingClientRect(); return { tb: document.querySelector('.topbar').getBoundingClientRect().bottom, top: r.top, bottom: r.bottom, ph: document.getElementById('playpanel').getBoundingClientRect().top, ih: innerHeight }; });
    rec('L3 the column stays in view after scrolling, above the bottom bar', col2.top >= 0 && col2.top <= col2.tb + 12 && col2.bottom <= col2.ph + 1, JSON.stringify(col2));
    await shot('01-scrolled');
    const ov = await q(() => ({ sw: document.documentElement.scrollWidth, bw: document.querySelector('.song-body').getBoundingClientRect().width }));
    rec('L4 no horizontal overflow; text keeps the rest of the width', ov.sw <= vw && ov.bw >= vw - 140, JSON.stringify(ov));
    // play: current chord lit in the column
    await page.click('#btn-play');
    let ok = 0; let tot = 0; let nextOk = 0; let inView = 0; const seen = new Set();
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const r = await q(() => {
        const cur = document.querySelector('#dg-col .dg-btn.cur'); const nxt = document.querySelector('#dg-col .dg-btn.next');
        const name = document.getElementById('pp-current').textContent; const c = document.getElementById('dg-col').getBoundingClientRect();
        let vis = false; if (cur) { const b = cur.getBoundingClientRect(); vis = b.top >= c.top - 1 && b.bottom <= c.bottom + 1; }
        return { name, cur: cur && cur.dataset.chord, nxt: !!nxt, vis, state: window.__gapp.player.state, count: document.getElementById('pp-current').classList.contains('count') };
      });
      if (r.state !== 'playing' || r.count) continue;
      tot++; if (r.cur === r.name) ok++; if (r.nxt) nextOk++; if (r.vis) inView++; seen.add(r.name);
    }
    rec('P1 the lit diagram is the chord of the panel', tot > 20 && ok >= tot - 2, `${ok}/${tot} samples, ${seen.size} chords`);
    rec('P2 the lit diagram is fully inside the column (it scrolls by itself)', inView >= tot - 3, `${inView}/${tot}`);
    rec('P3 the next chord is marked', nextOk >= tot - 4, `${nextOk}/${tot}`);
    await shot('02-playing');
    await page.click('#btn-play').catch(() => {});
    // modes
    await page.click('summary:has-text("Impostazioni")'); await page.click('[data-dgmode="top"]');
    const m1 = await q(() => ({ col: !!document.getElementById('dg-col'), row: !!document.getElementById('dg-row'), vis: document.getElementById('dg-row') && document.getElementById('dg-row').offsetParent !== null }));
    rec('M1 "in cima": the old row, no column', !m1.col && m1.row && m1.vis, JSON.stringify(m1));
    await page.click('[data-dgmode="none"]');
    const m2 = await q(() => ({ col: !!document.getElementById('dg-col'), row: document.getElementById('dg-row') && document.getElementById('dg-row').offsetParent !== null }));
    rec('M2 "nascosti": nothing', !m2.col && !m2.row, JSON.stringify(m2));
    await page.click('[data-dgmode="side"]');
    const stored = await q(() => JSON.parse(localStorage.getItem('gapp.device.v1')).diagramMode);
    rec('M3 setting saved', stored === 'side', stored);
  }

  if (modes.includes('bar')) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const col = () => q(() => document.getElementById('playpanel').dataset.collapsed);
    const h = () => q(() => Math.round(document.getElementById('playpanel').getBoundingClientRect().height));
    await page.reload(); await page.waitForSelector('#btn-play');
    const t0 = Date.now(); const hOpen = await h();
    await sleep(3000);
    const c3 = await col();
    let tc = 0; while ((await col()) !== '1' && Date.now() - t0 < 8000) await sleep(50); tc = Date.now() - t0;
    await sleep(300);
    const hMini = await h();
    rec('B1 stopped: the bar stays open at 3 s and collapses at about 4 s', c3 === '0' && tc >= 3900 && tc <= 5000, `open at 3 s: ${c3 === '0'}, collapsed after ${tc} ms`);
    rec('B2 mini bar is 44-52 px (+ safe area), the open bar is taller', hMini >= 44 && hMini <= 60 && hOpen > hMini + 40, `open ${hOpen} px, mini ${hMini} px`);
    const mini = await q(() => ({ play: !!document.getElementById('btn-mini-play').offsetParent, cur: document.getElementById('pp-mini-cur').textContent, next: document.getElementById('pp-mini-next').textContent, time: document.getElementById('pp-mini-time').textContent, handle: !!document.getElementById('btn-mini-open').offsetParent, w: document.documentElement.scrollWidth }));
    rec('B3 the mini bar has play, chords, time and the handle; no overflow', mini.play && mini.handle && mini.next.length > 0 && mini.w <= vw, JSON.stringify(mini));
    await shot('03-mini');
    const pad = await q(() => { window.scrollTo(0, document.body.scrollHeight); const last = document.querySelector('.song-foot').getBoundingClientRect(); return { footBottom: last.bottom, barTop: document.getElementById('playpanel').getBoundingClientRect().top }; });
    rec('B4 the bottom margin follows the bar: the end of the page is above it', pad.footBottom <= pad.barTop + 1, JSON.stringify(pad));
    await page.tap('#pp-mini');
    await sleep(300);
    rec('B5 tap on the mini bar opens it', (await col()) === '0');
    const t1 = Date.now(); await sleep(2500); await page.tap('#btn-more'); await sleep(5000);
    rec('B6 with the menu open it does not collapse', (await col()) === '0');
    await page.tap('#btn-more');
    await page.tap('#btn-play'); const t2 = Date.now();
    while ((await col()) !== '1' && Date.now() - t2 < 8000) await sleep(50);
    rec('B7 playing: it collapses 4 s after the last touch', Date.now() - t2 >= 3800 && Date.now() - t2 <= 5000, `${Date.now() - t2} ms`);
    await sleep(1000);
    const pl = await q(() => ({ state: window.__gapp.player.state, label: document.getElementById('btn-mini-play').textContent, cur: document.getElementById('pp-mini-cur').textContent }));
    rec('B8 mini play button shows "Pausa" and the chord while playing', pl.state === 'playing' && pl.label === 'Pausa' && pl.cur.length > 0, JSON.stringify(pl));
    await shot('04-mini-playing');
    await page.tap('#btn-mini-play'); await sleep(300);
    rec('B9 the mini play button pauses without opening the bar', (await q(() => window.__gapp.player.state)) === 'paused' && (await col()) === '1');
    // setting: always open
    await page.tap('#pp-mini'); await sleep(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.tap('summary:has-text("Impostazioni")'); await page.tap('[data-barauto="false"]');
    await sleep(5000);
    rec('B10 "sempre aperta": it does not collapse', (await col()) === '0');
    await page.tap('[data-barauto="true"]');
  }

  if (modes.includes('tempo')) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.tap('#btn-more').catch(() => {});
    await page.reload(); await page.waitForSelector('#btn-play');
    await page.evaluate(() => document.getElementById('playpanel').dataset.collapsed === '1' && document.getElementById('btn-mini-open').click());
    const pct = () => q(() => document.getElementById('pp-tempo-pct').textContent);
    const bpm = () => q(() => document.getElementById('pp-tempo-bpm').textContent);
    const base = await bpm();
    rec('T1 Tempo control visible in the open bar with percent and BPM', (await q(() => document.getElementById('pp-tempo').offsetParent !== null)) && (await pct()) === '100%' && /♩ \d+ \(di \d+\)/.test(base), `${await pct()} ${base}`);
    await page.tap('#btn-speed-50'); await sleep(100);
    const b50 = await bpm();
    const [, a, b] = /♩ (\d+) \(di (\d+)\)/.exec(b50) || [];
    rec('T2 50% chip: half the BPM', (await pct()) === '50%' && Math.abs(Number(a) - Number(b) / 2) <= 0.5, `${await pct()} ${b50}`);
    for (let i = 0; i < 10; i++) await page.tap('#btn-speed-down');
    rec('T3 minus stops at 25%', (await pct()) === '25%', await pct());
    await page.tap('#btn-speed-up'); rec('T4 plus is 5% steps', (await pct()) === '30%', await pct());
    await page.tap('#pp-tempo'); await page.fill('#pp-speed-field', String(Math.round(Number(b) * 0.7))); await page.tap('#pp-speed-apply');
    rec('T5 typing a target BPM sets the percentage from the section BPM', Math.abs(Number((await pct()).replace('%', '')) - 70) <= 1, `${await pct()} ${await bpm()}`);
    const sv = await q(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).view.speedPct);
    rec('T6 speed saved for the song', sv === Number((await pct()).replace('%', '')), String(sv));
    await shot('05-tempo');
    const bw = await q(() => ({ sw: document.documentElement.scrollWidth, r: document.getElementById('pp-tempo-row').getBoundingClientRect().right, h: Math.round(document.getElementById('playpanel').getBoundingClientRect().height) }));
    rec('T7 Tempo row fits the width', bw.sw <= vw && bw.r <= vw, JSON.stringify(bw));
    // hold to repeat
    await page.evaluate(() => window.__gapp && 0);
    const box = await page.locator('#btn-speed-down').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await sleep(1300); await page.mouse.up();
    rec('T8 long press repeats', Number((await pct()).replace('%', '')) < 60, await pct());
    await page.tap('#btn-speed-100');
  }
  rec('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
