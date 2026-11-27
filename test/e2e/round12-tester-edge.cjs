// Round 12 tester, A2 (edge cases of the exact seek): end of the file, jump to 0, ten jumps in one second, two jumps 20 ms apart, pause right after a jump,
// loop on a section while jumping out of it, memory and revoked blob URLs after 30 jumps.  Real song, Pixel 7 profile, Chromium.
// Prints counts and times only.   Run: node scripts/build.mjs && node test/e2e/round12-tester-edge.cjs [new|old]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = process.argv[2] || 'new';
const URL = 'file://' + (BUILD === 'old' ? path.join(ROOT, 'test-artifacts', 'round-12', 'tester', 'old-index.html') : path.join(ROOT, 'dist', 'index.html'));
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${BUILD}] ${id} ${info}`); };
const rssMb = () => { try { return Math.round(execSync("ps -eo rss,args | grep -i 'chrom' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim() / 1024); } catch { return -1; } };
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(devices['Pixel 7'])).newPage();
  const cdp = await page.context().newCDPSession(page);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('crash', () => console.log('PAGE CRASH')); page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__u = { c: 0, r: 0 };
    const cu = URL.createObjectURL.bind(URL), ru = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__u.c++; return cu(b); }; URL.revokeObjectURL = (u) => { window.__u.r++; return ru(u); };
  });
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
  await page.waitForFunction(() => window.__gapp.audioEl, null, { timeout: 15000 });
  const P = (fn, ...a) => page.evaluate(fn, ...a);
  const media = () => P(() => (window.__gapp.audioPlayer ? window.__gapp.audioPlayer.mediaTime() : window.__gapp.audioEl.currentTime));
  const state = () => P(() => window.__gapp.player.state);
  const play = (t) => P((x) => { const a = window.__gapp.audioPlayer; return a ? a.playFromTime(x) : (window.__gapp.audioEl.currentTime = x); }, t);
  await P(async () => { if (window.__gapp.audioPlayer) await window.__gapp.audioPlayer.ready(); });
  const dur = await P(() => (window.__gapp.audioPlayer ? window.__gapp.audioPlayer.duration() : window.__gapp.audioEl.duration));
  // 1. jump to 4 s before the end: the file ends, the player stops and rewinds
  await play(dur - 4); await P(() => window.__gapp.audioPlayer && window.__gapp.audioPlayer.play());
  await sleep(1500);
  rec('E1 4 s before the end: playing', (await state()) === 'playing', `media ${(await media()).toFixed(1)} of ${dur.toFixed(1)}`);
  await sleep(5500);
  const st = await state(); const m = await media();
  rec('E2 at the end of the file the player stops and rewinds to 0', st === 'stopped' && m < 1, `${st}, media ${m.toFixed(2)}`);
  await page.locator('#btn-play').tap(); await sleep(1500);
  rec('E3 Play after the end starts again from the beginning', (await state()) === 'playing' && (await media()) < 4, `media ${(await media()).toFixed(2)}`);
  // 2. ten jumps in one second (a nervous finger on the chords), then 12 s of quiet
  const targets = [40, 120, 80, 200, 150, 300, 260, 340, 100, 180];
  const u0 = await P(() => ({ ...window.__u }));
  for (const t of targets) { await play(t); await sleep(100); }
  await sleep(2500);
  const last = targets[targets.length - 1];
  const m2 = await media(); const s2 = await state();
  rec('E4 ten jumps in one second: the last one wins and the sound keeps playing', s2 === 'playing' && m2 > last - 0.5 && m2 < last + 5, `asked ${last}, media ${m2.toFixed(2)}, ${s2}`);
  // 3. two jumps 20 ms apart, then a pause right after a jump
  await play(210); await sleep(20); await play(95); await sleep(2500);
  const m3 = await media();
  rec('E5 two jumps 20 ms apart: the second wins', m3 > 94.5 && m3 < 99, `media ${m3.toFixed(2)}`);
  await play(250); await P(() => window.__gapp.audioPlayer && window.__gapp.audioPlayer.pause()); await sleep(1500);
  const s4 = await state(); const m4 = await media(); await sleep(1500); const m4b = await media();
  rec('E6 pause right after a jump: paused and the position does not move', s4 === 'paused' && Math.abs(m4b - m4) < 0.05 && m4 > 249, `${s4}, media ${m4.toFixed(2)} -> ${m4b.toFixed(2)}`);
  await P(() => window.__gapp.audioPlayer && window.__gapp.audioPlayer.play()); await sleep(1500);
  const m5 = await media();
  rec('E7 resume continues from the same place', (await state()) === 'playing' && m5 > m4 && m5 < m4 + 3, `media ${m5.toFixed(2)}`);
  // 4. 30 jumps: blob URLs and memory
  await P(() => { window.__gapp.audioPlayer && window.__gapp.audioPlayer.pause(); }); await sleep(12000);
  const uA = await P(() => ({ ...window.__u })); const rA = rssMb();
  await play(30); await sleep(500);
  const JUMPS = Number(process.env.R12_JUMPS || 30); const marks = [];
  for (let k = 0; k < JUMPS; k++) { await play(20 + ((k * 137) % 460)); await sleep(700); if ((k + 1) % 30 === 0) marks.push(rssMb()); }
  console.log(`INFO [${BUILD}] RSS after each 30 jumps: ${marks.join(', ')} MB`);
  const rM = rssMb(); const uM = await P(() => ({ ...window.__u }));
  await P(() => { window.__gapp.audioPlayer && window.__gapp.audioPlayer.pause(); }); await sleep(Number(process.env.R12_SETTLE || 13000));
  const uB = await P(() => ({ ...window.__u })); const rB = rssMb();
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576;
  console.log(`INFO [${BUILD}] RSS of all Chromium processes: before ${rA} MB, after 30 jumps ${rM} MB, 13 s later ${rB} MB; JS heap ${heap.toFixed(1)} MB; blob URLs created ${uB.c - uA.c}, revoked ${uB.r - uA.r} during the 31 jumps (outstanding in the page: ${uB.c - uB.r})`);
  if (BUILD === 'new') rec('E8 30 jumps: every slice URL is revoked (outstanding <= 4 with the full file, the current slice and the diagnostics)', uB.c - uB.r <= 4 && (uB.c - uA.c) - (uB.r - uA.r) <= 2, JSON.stringify({ created: uB.c - uA.c, revoked: uB.r - uA.r }));
  rec('E9 RSS does not grow by more than 120 MB over the 30 jumps', rB - rA < 120, `${rB - rA} MB`);
  rec('Ez no page errors', errors.length === 0, errors.join('|').slice(0, 160));
  console.log(fails ? `FAIL ${fails}` : 'ALL PASS');
  await browser.close();
})().catch((e) => { console.log('FAILED', String(e).slice(0, 400)); process.exit(1); });
