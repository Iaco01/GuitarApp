// Round 2 tester, browser part 4: edge cases of the transport (extra probing). Run: node test/e2e/round2-tester-ui4.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const g = (page) => page.evaluate(() => ({ s: window.__gapp.player.state, p: window.__gapp.player.timeSec, e: window.__gapp.player.eventIndex }));
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title');
  const tl = await page.evaluate(() => window.__gapp.timeline.events.map((e) => ({ s: e.startSec, ref: e.ref })));
  const startFrom = async (i) => { await page.click('#btn-play'); await page.waitForFunction(() => ['counting', 'playing'].includes(window.__gapp.player.state)); const l = page.locator(`.ch[data-ref="${tl[i].ref}"]`).first(); await l.scrollIntoViewIfNeeded(); await l.click(); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 }); };
  // 1. speed change mid-play keeps the position (event)
  await startFrom(8); await sleep(2000);
  const a = await g(page);
  await page.click('#btn-speed-down'); await page.click('#btn-speed-down');
  await sleep(200);
  const b = await g(page);
  const evNow = await page.evaluate(() => window.__gapp.timeline.events[window.__gapp.player.eventIndex].startBeat);
  rec('X1-speed-change-mid-play-keeps-chord', b.s === 'playing' && Math.abs(b.e - a.e) <= 1, `event ${a.e} -> ${b.e}, time ${a.p.toFixed(2)} -> ${b.p.toFixed(2)} (stretched x1/0.9)`);
  await page.click('#btn-stop');
  for (let i = 0; i < 2; i++) await page.click('#btn-speed-up');
  // 2. stop during count-in, pause during count-in, resume
  await page.click('#btn-play'); await sleep(400);
  const c1 = await g(page);
  await page.click('#btn-play'); // pause during count-in
  await sleep(200);
  const c2 = await g(page);
  await page.click('#btn-play'); // play again
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 8000 });
  const c3 = await g(page);
  rec('X2-pause-during-count-in-then-play', c1.s === 'counting' && c2.s === 'paused' && c3.e === 0 && c3.p < 0.3, `${c1.s} -> ${c2.s} -> ${c3.s} at event ${c3.e}, time ${c3.p.toFixed(2)}`);
  await page.click('#btn-stop');
  // 3. rapid play/pause clicks do not leave two sessions running
  await page.evaluate(() => { const b = document.getElementById('btn-play'); b.click(); b.click(); b.click(); b.click(); b.click(); });
  await sleep(4000);
  const d1 = await g(page);
  await page.evaluate(() => { window.__t = []; });
  await sleep(1000);
  const d2 = await g(page);
  rec('X3-rapid-clicks-consistent', ['playing', 'counting', 'paused'].includes(d1.s) && (d1.s !== 'playing' || Math.abs((d2.p - d1.p) - 1) < 0.1), `state ${d1.s}; time advanced ${(d2.p - d1.p).toFixed(3)} s in ~1 s`);
  await page.click('#btn-stop');
  // 4. changing a chord's beats while playing (edit mode stops the player)
  await startFrom(4);
  await page.click('#btn-edit');
  const e1 = await g(page);
  rec('X4-edit-mode-stops-player', e1.s === 'stopped', e1.s);
  await page.click('#btn-edit');
  // 5. BPM edit while playing through the section editor (apply to all same-name sections)
  await startFrom(40);
  await sleep(500);
  const sec = await page.evaluate(() => window.__gapp.timeline.events[window.__gapp.player.eventIndex].sectionIndex);
  const before = await page.evaluate(() => window.__gapp.timeline.sections.map((s) => s.bpm));
  await page.locator(`.sec-head[data-sec="${sec}"] .sec-bpm`).first().scrollIntoViewIfNeeded();
  await page.locator(`.sec-head[data-sec="${sec}"] .sec-bpm`).first().click();
  const lbl = await page.locator('.apply-all').first().textContent().catch(() => null);
  await page.fill('.bpm-field', '100');
  if (lbl) await page.locator('.apply-all').first().click(); else await page.locator('.bpm-edit .primary').click();
  await sleep(300);
  const after = await page.evaluate(() => window.__gapp.timeline.sections.map((s) => s.bpm));
  const st = await g(page);
  const changed = after.map((v, i) => (v !== before[i] ? i : -1)).filter((i) => i >= 0);
  rec('X5-bpm-edit-apply-all-by-name', st.s === 'playing' && changed.length >= 1 && changed.every((i) => after[i] === 100), `button "${lbl}", sections changed ${changed}; playing: ${st.s}`);
  await page.click('#btn-stop');
  // 6. Stopped: tapping a chord opens the chord sheet (not play)
  await page.locator('.ch[data-ref="0.0.0"]').first().scrollIntoViewIfNeeded();
  await page.locator('.ch[data-ref="0.0.0"]').first().click();
  await page.waitForSelector('#sheet-name', { timeout: 3000 });
  rec('X6-stopped-chord-tap-opens-sheet', (await g(page)).s === 'stopped', 'sheet opened');
  await page.keyboard.press('Escape');
  rec('X-console-clean', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
