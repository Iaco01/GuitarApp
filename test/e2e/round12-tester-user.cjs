// Round 12 tester, D: trial as a user on an Android profile (Pixel 7, touch taps, Chromium): import the real sheet, sync, play from the start
// through the Verse 1 -> Chorus 1 change (panel sampled every 60 ms), jump to the middle by tapping a chord, adjust +100 ms from the
// play panel, export the technical information from the library.  Screenshots (they show the song text: never commit) in
// test-artifacts/round-12/user/.  Prints times, counts and short notes only.
// Run: node scripts/build.mjs && node test/e2e/round12-tester-user.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-12', 'user');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; let n = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const note = (t) => console.log('NOTE ' + t);
(async () => {
  if (!fs.existsSync(MP3)) { console.log('mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(devices['Pixel 7'])).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', async (d) => { note(`dialog "${d.message().slice(0, 60)}"`); await d.accept(); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
  const t0 = Date.now();
  await page.goto(URL);
  await shot('library-empty');
  await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  await shot('song-imported');
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); const tS = Date.now(); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  note(`sync analysis ${((Date.now() - tS) / 1000).toFixed(1)} s`);
  await shot('sync-done');
  const counts = await page.innerText('#as-counts').catch(() => '');
  note(`sync counts line: "${counts.replace(/\s+/g, ' ').slice(0, 120)}"`);
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
  await page.waitForFunction(() => window.__gapp.audioPlayer, null, { timeout: 15000 });
  const T = await page.evaluate(async () => { await window.__gapp.audioPlayer.ready(); const tl = window.__gapp.timeline; return { ev: tl.events.map((e) => [e.startSec, e.durSec, e.ref, e.sectionIndex]), exact: window.__gapp.audioPlayer.isExact(), gaps: (tl.gaps || []).map((g) => [g.startSec, g.endSec]) }; });
  rec('U0 exact seeking is on for the real mp3', T.exact === true);
  note(`events ${T.ev.length}; event 34 at ${T.ev[34][0].toFixed(2)}, event 35 at ${T.ev[35][0].toFixed(2)} (lasts ${(T.ev[36][0] - T.ev[35][0]).toFixed(2)} s); gaps ${JSON.stringify(T.gaps)}`);
  // 1. play from the start like a user (Play), sample the panel through the Verse 1 -> Chorus 1 change
  await page.evaluate(() => { window.__log = []; window.__on = true; setInterval(() => { if (!window.__on) return; const g = window.__gapp; window.__log.push([performance.now(), g.audioPlayer.mediaTime(), g.player.eventIndex, document.getElementById('pp-current').textContent.length, document.getElementById('pp-gap').hidden ? 0 : 1]); }, 60); });
  await page.locator('#btn-play').tap();
  await shot('playing-start');
  await page.waitForFunction(() => window.__gapp.audioPlayer.mediaTime() > 69, null, { timeout: 120000 });
  await shot('playing-chorus1');
  const log = await page.evaluate(() => { window.__on = false; return window.__log; });
  const changes = []; let last = -9;
  for (const [, m, ei, , gap] of log) if (ei !== last) { changes.push([ei, +m.toFixed(2), gap]); last = ei; }
  const e34 = changes.find((c) => c[0] === 34), e35 = changes.find((c) => c[0] === 35), e36 = changes.find((c) => c[0] === 36);
  note(`highlight changes around the Verse 1 -> Chorus 1 change (event, media time at the change): ${JSON.stringify(changes.filter((c) => c[0] >= 31 && c[0] <= 38).map((c) => c.slice(0, 2)))}`);
  rec('U1 event 34 (G) lights up near 57.9 s and event 35 (G of Chorus 1) near 63.4 s, lasting 0.6-1.2 s', e34 && e35 && e36 && Math.abs(e34[1] - 57.9) < 0.3 && Math.abs(e35[1] - 63.4) < 0.3 && e36[1] - e35[1] > 0.6 && e36[1] - e35[1] < 1.2, `34 at ${e34 && e34[1]}, 35 at ${e35 && e35[1]}, 36 at ${e36 && e36[1]}`);
  rec('U2 no "Fuori dal foglio" panel from 55 s to 67 s', !log.some(([, m, , , gap]) => gap && m > 55 && m < 67), '');
  await page.locator('#btn-play').tap(); await sleep(300);
  // 2. jump to the middle: tap a chord while playing
  await page.locator('#btn-play').tap(); await sleep(1500);
  const jm = T.ev.findIndex((e) => e[0] > 250);
  const loc = page.locator(`.ch[data-ref="${T.ev[jm][2]}"]`).first();
  await loc.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(300);
  const tj0 = Date.now();
  await loc.tap();
  await page.waitForFunction((t) => Math.abs(window.__gapp.audioPlayer.mediaTime() - t) < 2.5 && window.__gapp.player.state === 'playing', T.ev[jm][0], { timeout: 6000 }).catch(() => {});
  await sleep(1200);
  const m1 = await page.evaluate(() => ({ m: window.__gapp.audioPlayer.mediaTime(), ev: window.__gapp.player.eventIndex, st: window.__gapp.player.state, cur: document.getElementById('pp-current').textContent }));
  rec('U3 tap on a chord while playing jumps there and keeps playing', m1.st === 'playing' && m1.m > T.ev[jm][0] - 0.2 && m1.m < T.ev[jm][0] + 3.5 && Math.abs(m1.ev - jm) <= 2, `asked ${T.ev[jm][0].toFixed(1)} -> media ${m1.m.toFixed(1)}, event ${m1.ev} (asked ${jm}), ${((Date.now() - tj0) / 1000).toFixed(1)} s`);
  await shot('after-jump');
  // 3. adjust +100 ms from the play panel
  await page.locator('#btn-more').tap();
  await shot('more-menu');
  await page.locator('#btn-offset-later').tap(); await page.locator('#btn-offset-later').tap();
  const lbl = await page.textContent('#pp-offset-val');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.device.v1') || '{}').latencyMs);
  rec('U4 "+100 ms" from the play panel: label and stored value', /100/.test(lbl) && stored === 100, `"${lbl}" stored ${stored}`);
  const box = await page.evaluate(() => { const r = document.getElementById('pp-more').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), document.documentElement.scrollWidth]; });
  rec('U5 the more menu fits the Pixel 7 screen (no horizontal scroll)', box[2] <= 412, JSON.stringify(box));
  await page.locator('#btn-offset-listen').tap(); await sleep(1500); await shot('offset-listen');
  await sleep(5000);
  const stL = await page.evaluate(() => window.__gapp.player.state);
  rec('U6 "Ascolta e regola" stops by itself after about 5 s', stL === 'paused', stL);
  // 4. export the technical information
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('#btn-diag');
  await shot('library');
  await page.locator('#btn-diag').tap();
  await page.waitForFunction(() => document.getElementById('diag-out') && !document.getElementById('diag-out').hidden && document.getElementById('diag-out').value.length > 50, null, { timeout: 8000 });
  await shot('diagnostics');
  const d = JSON.parse(await page.$eval('#diag-out', (e) => e.value));
  rec('U7 technical information after the trial', d.kind === 'guitarapp-diagnostics' && d.latencyMs === 100 && d.alignment && d.alignment.firstEventTimesSec.length === 60 && d.player && d.player.exactSeek === true, `latency ${d.latencyMs}, seeks ${d.player && d.player.seeks}, maxGap ${d.player && d.player.maxGapMs} ms, drift rows ${d.drift && d.drift.rows.length}`);
  rec('Uz no page errors', errors.length === 0, errors.join('|').slice(0, 200));
  console.log(`${fails ? 'FAIL ' + fails : 'ALL PASS'}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await browser.close();
})().catch((e) => { console.log('FAILED', String(e).slice(0, 500)); process.exit(1); });
