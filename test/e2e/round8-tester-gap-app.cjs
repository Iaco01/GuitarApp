// Round 8 tester A3: the "part not in the sheet" row and what the user sees during play inside the gap.
// Prepare: node scripts/build.mjs && node test/e2e/round7-tester-make.mjs && node test/e2e/round8-tester-gap-assets.mjs
// Run: node test/e2e/round8-tester-gap-app.cjs [SE|360|13]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const SONG = path.join(ROOT, 'test-artifacts', 'round-7', 'tester', 'r7-song.json');
const OUT = path.join(ROOT, 'test-artifacts', 'round-8');
const AS = path.join(OUT, 'assets');
const GT = JSON.parse(fs.readFileSync(path.join(AS, 'gap-truth.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const devName = process.argv[2] || 'SE';
const PROFILES = { 360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };
let fails = 0; const dev = devName;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
async function run(file, label) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(PROFILES[devName])).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#as-start'); await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 120000 });
  const gaps = await page.$$eval('.as-gap', (g) => g.map((x) => x.textContent.trim()));
  const al = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
  info('A3', `${label}: gap rows in the summary: ${JSON.stringify(gaps)}; stored gaps ${JSON.stringify(al.gaps)}; first event ${al.eventStartSec[0].toFixed(1)} s; states ${(await page.$$eval('.as-row', (r) => r.map((x) => x.dataset.state[0]).join('')))}`);
  await page.evaluate(() => document.querySelector('#as-rows').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, `gap-${devName}-${label}-summary.png`) });
  return { browser, page, errors, gaps, al };
}
(async () => {
  // solo 20 s between Verse and Chorus
  {
    const { browser, page, errors, gaps, al } = await run(path.join(AS, 'solo20.mp3'), 'solo20');
    const g = al.gaps[0];
    rec('A3a the row exists and says "parte non presente nel foglio"', gaps.length === 1 && /parte non presente nel foglio/.test(gaps[0]), JSON.stringify(gaps));
    const m = /(\d+):(\d+[.,]\d)\D+(\d+):(\d+[.,]\d)/.exec(gaps[0] || '');
    if (m) { const a = +m[1] * 60 + parseFloat(m[2].replace(',', '.')); const b = +m[3] * 60 + parseFloat(m[4].replace(',', '.')); rec('A3b the times in the row match the true gap within 1 s', Math.abs(a - GT.soloStart) < 1 && Math.abs(b - GT.soloEnd) < 1, `row ${a.toFixed(1)}-${b.toFixed(1)} vs true ${GT.soloStart.toFixed(1)}-${GT.soloEnd.toFixed(1)}`); }
    // close and play across the gap
    await page.click('#as-accept'); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
    const samples = [];
    const seekTo = (t) => page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, t);
    // sample the highlight while playing through the gap
    await seekTo(g.startSec - 3);
    await sleep(600);
    const t0 = Date.now();
    let shot1 = false, shot2 = false;
    while (Date.now() - t0 < 30000) {
      const s = await page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, ev: window.__gapp.player.eventIndex, cur: (document.querySelector('.cur') || {}).textContent || '', now: (document.querySelector('#pp-now, .pp-now') || {}).textContent || '', panel: document.querySelector('#playpanel').innerText.replace(/\s+/g, ' ').slice(0, 90) }));
      samples.push(s);
      if (!shot1 && s.t > g.startSec + 1) { await page.screenshot({ path: path.join(OUT, `gap-${devName}-solo-play-in-gap.png`) }); shot1 = true; }
      if (!shot2 && s.t > (g.startSec + g.endSec) / 2) { await page.screenshot({ path: path.join(OUT, `gap-${devName}-solo-play-mid-gap.png`) }); shot2 = true; }
      if (s.t > g.endSec + 3) break;
      await sleep(250);
    }
    const inGap = samples.filter((s) => s.t > g.startSec + 0.5 && s.t < g.endSec - 0.5);
    const evs = [...new Set(inGap.map((s) => s.ev))];
    info('A3c', `during the gap (${inGap.length} samples) the highlighted event index is ${JSON.stringify(evs)} (last chord of the verse is event ${al.gaps[0].before - 1}); panel text sample: "${inGap[Math.floor(inGap.length / 2)] && inGap[Math.floor(inGap.length / 2)].panel}"`);
    rec('A3c in the gap the highlight stays on one chord (no running through the chords)', evs.length <= 1, JSON.stringify(evs));
    const after = samples.filter((s) => s.t > g.endSec + 0.3);
    info('A3c', `after the gap the highlight goes to event ${JSON.stringify([...new Set(after.map((s) => s.ev))])} (first chord of the Chorus is ${al.gaps[0].before})`);
    // does the panel or the song view say anything about "fuori dal foglio" / pause in the gap?
    const txt = await page.evaluate(() => document.body.innerText);
    info('A3c', `any text during/after play mentioning the part outside the sheet: ${/non presente|fuori dal foglio|strumental/i.test(txt)}`);
    rec('Az1 no page errors', errors.length === 0, errors.join('|').slice(0, 100));
    await browser.close();
  }
  // intro of 15 s of other music
  {
    const { browser, page, errors, gaps, al } = await run(path.join(AS, 'intro15.mp3'), 'intro15');
    rec('A3d foreign intro: first event of the sheet starts near 16.2 s (true) — the engine says', Math.abs(al.eventStartSec[0] - (GT.truth[0] + 15)) < 0.5, `first event at ${al.eventStartSec[0].toFixed(2)} s, true ${(GT.truth[0] + 15).toFixed(2)} s; no leading-gap row (rows ${JSON.stringify(gaps)})`);
    await browser.close();
  }
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
