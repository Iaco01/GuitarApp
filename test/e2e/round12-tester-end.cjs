// Round 12 tester: what happens at the end of the file (real song, Pixel 7 profile): does the element keep playing after the player says "stopped"?
// Run: node scripts/build.mjs && node test/e2e/round12-tester-end.cjs [new|old]
const { chromium, devices } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = process.argv[2] || 'new';
const URL = 'file://' + (BUILD === 'old' ? path.join(ROOT, 'test-artifacts', 'round-12', 'tester', 'old-index.html') : path.join(ROOT, 'dist', 'index.html'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(devices['Pixel 7'])).newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.setInputFiles('#import-input', path.join(ROOT, 'test/fixtures/local/american-pie.mht')); await page.waitForSelector('#btn-play');
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', path.join(ROOT, 'test/fixtures/local/american-pie.mp3')); await page.waitForSelector('#as-start'); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
  await page.waitForFunction(() => window.__gapp.audioEl);
  const snap = () => page.evaluate(() => ({ state: window.__gapp.player.state, elPaused: window.__gapp.audioEl.paused, ended: window.__gapp.audioEl.ended, media: +(window.__gapp.audioPlayer ? window.__gapp.audioPlayer.mediaTime() : window.__gapp.audioEl.currentTime).toFixed(2), playBtn: document.getElementById('btn-play').textContent, shownTime: +window.__gapp.player.timeSec.toFixed(2) }));
  const dur = await page.evaluate(async () => { if (window.__gapp.audioPlayer) await window.__gapp.audioPlayer.ready(); return window.__gapp.audioPlayer ? window.__gapp.audioPlayer.duration() : window.__gapp.audioEl.duration; });
  // the user listens to the end of the song: tap a chord near the end while playing (or play from there), wait for the end
  await page.evaluate((t) => { const p = window.__gapp.audioPlayer; if (p) p.playFromTime(t); else window.__gapp.audioEl.currentTime = t; }, dur - 4);
  if (BUILD === 'old') await page.locator('#btn-play').tap();
  console.log('t+1.5 s', JSON.stringify(await (sleep(1500).then(snap))));
  for (const w of [3, 3, 3, 3]) { await sleep(w * 1000); console.log('+' + w + ' s', JSON.stringify(await snap())); }
  await browser.close();
})().catch((e) => { console.log('FAILED', String(e).slice(0, 300)); process.exit(1); });
