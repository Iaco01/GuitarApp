// Round 4 tester: are the section anchors (⚓) shown in the song headers after the first sync and after a reload?
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round4-tester-anchors.cjs
const { chromium, devices } = require('playwright');
const D = require('path').resolve(__dirname, '..', '..', 'test-artifacts', 'round-4', 'tester') + '/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext(devices['iPhone 13'])).newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('file://' + require('path').resolve(__dirname, '..', '..', 'dist', 'index.html'));
  await page.setInputFiles('#import-json', D + 't4-song.json');
  await page.waitForSelector('.dlg'); await page.click('.dlg [data-value="newer"]');
  await page.click('.song-row'); await page.click('#btn-sync');
  await page.setInputFiles('#sync-file', D + 't4.wav'); await page.waitForSelector('#sync-first');
  await page.click('#sync-play'); await page.waitForFunction(() => window.__gappSync.element.currentTime > 2.4); await page.click('#sync-first'); await page.click('#sync-play');
  await page.click('#sync-close'); await page.waitForTimeout(800);
  const n1 = await page.$$eval('.sec-anchor', (e) => e.map((x) => x.textContent));
  await page.reload(); await page.waitForSelector('#btn-sync'); await page.waitForTimeout(800);
  const n2 = await page.$$eval('.sec-anchor', (e) => e.map((x) => x.textContent));
  console.log('anchors in headers after first sync:', JSON.stringify(n1), 'after reload:', JSON.stringify(n2));
  await b.close();
})();
