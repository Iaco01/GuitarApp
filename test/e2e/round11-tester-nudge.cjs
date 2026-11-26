// Round 11 tester, C: nudge checks that complete round10-tester-nudge.cjs (which is re-run unchanged on SE, 13, 320):
//   btn    - the section-header button after the sync, after 2 reloads, after reopening from the library
//   jitter - long press with a 5, 8, 10 px tremor (opens), 14 px (cancels?), release over the "-0,25" button (presses nothing), release at once,
//            deliberate tap 150 / 400 ms after the sheet opened
//   ticks  - clicks across a nudged chord: after 4 nudges of -0,25 on one chord, play 8 s around it and check intervals
//   hint   - the hint is shown once per device (3 reloads, a second song)
//   gap    - synthetic song with a 20 s solo: nudge the first chord after the gap, the gap follows
// Run: node scripts/build.mjs && node test/e2e/round10-tester-make.mjs && node test/e2e/round11-tester-nudge.cjs <SE|13|320> <btn|jitter|ticks|hint|gap|all>
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const OUT = path.join(ROOT, 'test-artifacts', 'round-10');
const SONG = path.join(OUT, 'synth', 'r10-song.json');
const MP3 = path.join(OUT, 'synth', 'r10.mp3');
const GSONG = path.join(ROOT, 'test-artifacts', 'round-7', 'tester', 'r7-song.json');
const GMP3 = path.join(ROOT, 'test-artifacts', 'round-8', 'assets', 'solo20.mp3');
const SHOT = path.join(ROOT, 'test-artifacts', 'round-11'); fs.mkdirSync(SHOT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE'; const mode = process.argv[3] || 'all';
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'], 320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[dev]); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => { window.__clicks = []; const orig = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { const o = orig.call(this); const st = o.start.bind(o); const c = this; o.start = (when) => { window.__clicks.push([when, o.frequency.value, c.currentTime]); return st(when); }; return o; }; const cg = AudioContext.prototype.createGain; AudioContext.prototype.createGain = function () { window.__ctx = this; return cg.call(this); }; });
  await page.goto(URL); const cdp = await ctx.newCDPSession(page);
  return { browser, page, errors, cdp };
}
async function load(page, song, mp3) {
  await page.setInputFiles('#import-json', song);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', mp3); await page.waitForSelector('#as-start'); await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  await page.click('#as-accept').catch(() => {}); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
}
const al = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
const touch = (cdp, type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const heads = (page) => page.evaluate(() => ({ heads: document.querySelectorAll('.sec-head').length, nudge: document.querySelectorAll('.sec-head .sec-nudge').length }));
const mid = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function placeChord(page, j) { // scroll so chord j is at y=300
  const ref = await page.evaluate((j) => window.__gapp.timeline.events[j].ref, j); const loc = page.locator(`.ch[data-ref="${ref}"]`).first();
  await loc.scrollIntoViewIfNeeded(); let b = await loc.boundingBox(); await page.evaluate((d) => window.scrollBy(0, d), b.y - 300); await sleep(300); return loc;
}
async function modeBtn() {
  const { browser, page, errors } = await open(); await load(page, SONG, MP3); await sleep(600);
  let h = await heads(page); rec('N1 button on every header right after the sync', h.heads > 0 && h.nudge === h.heads, JSON.stringify(h));
  for (let i = 1; i <= 2; i++) { await page.reload(); await page.waitForSelector('#btn-play'); await sleep(1000); h = await heads(page); rec(`N2.${i} ... after reload ${i}`, h.heads > 0 && h.nudge === h.heads, JSON.stringify(h)); }
  await page.click('#btn-back').catch(async () => { await page.goto(URL); }); await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-play'); await sleep(800);
  h = await heads(page); rec('N3 ... after reopening from the library', h.heads > 0 && h.nudge === h.heads, JSON.stringify(h));
  // the button of the first section opens the nudge of the section; opens the sheet and does something sensible
  await page.locator('.sec-head .sec-nudge').first().scrollIntoViewIfNeeded(); await page.locator('.sec-head .sec-nudge').first().tap(); await sleep(400);
  rec('N4 tapping the header button opens the nudge sheet', (await page.locator('#nudge-time').count()) === 1);
  await page.screenshot({ path: path.join(SHOT, `nudge-${dev}-secsheet.png`) });
  rec('Nz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
async function modeJitter() {
  const { browser, page, errors, cdp } = await open(); await load(page, SONG, MP3); await page.reload(); await page.waitForSelector('#btn-play'); await sleep(1000);
  const j = 15;
  // locate where the sheet's -0,25 button lands (open the sheet once and measure)
  let loc = await placeChord(page, j); let p = await mid(loc);
  await touch(cdp, 'touchStart', p.x, p.y); await sleep(750);
  const btn = await page.locator('.nudge-sheet [data-s="-0.25"]').first().boundingBox(); await touch(cdp, 'touchEnd', 0, 0); await sleep(400); await page.click('#nudge-close'); await sleep(200);
  info('J0', `sheet button "-0,25" at y ${btn.y.toFixed(0)}-${(btn.y + btn.height).toFixed(0)}`);
  const times = async () => (await al(page)).eventStartSec.slice();
  // hold = ms between touchStart and touchEnd (the sheet opens at ~500 ms); amp = tremor in px along x only (distance from the start = amp)
  const tryPress = async (id, amp, hold, releaseOver, expectOpen, expectNoChange = true) => {
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
    loc = await placeChord(page, j); // y 300
    if (releaseOver) { const b = await loc.boundingBox(); await page.evaluate((d) => window.scrollBy(0, d), b.y + b.height / 2 - (btn.y + btn.height / 2)); await sleep(300); }
    const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const before = await times();
    const t0 = Date.now(); await touch(cdp, 'touchStart', x, y); let i = 0;
    while (Date.now() - t0 < hold - 60) { await sleep(50); if (amp) await touch(cdp, 'touchMove', x + (i++ % 2 ? amp : -amp), y); }
    await sleep(Math.max(0, hold - (Date.now() - t0)));
    const openB4 = await page.locator('#nudge-time').count();
    await touch(cdp, 'touchEnd', x, y); const real = Date.now() - t0; await sleep(500);
    const after = await times(); const changed = after.filter((v, k) => v !== before[k]).length;
    const opened = (await page.locator('#nudge-time').count()) === 1;
    rec(id, (expectOpen ? opened : !opened) && (!expectNoChange || changed === 0), `tremor ${amp}px, held ${real} ms: sheet before release ${openB4 ? 'open' : 'closed'}, after ${opened ? 'open' : 'closed'}, times changed ${changed}`);
    if (changed && opened) { for (let q = 0; q < changed + 2; q++) { if (await page.locator('#nudge-undo').isDisabled().catch(() => true)) break; await page.locator('#nudge-undo').tap({ timeout: 2000 }).catch(() => {}); await sleep(100); } }
    if (opened) await page.click('#nudge-close').catch(() => {});
    if (await page.locator('.sheet').count()) { await page.keyboard.press('Escape'); await sleep(200); if (await page.locator('.sheet').count()) await page.evaluate(() => document.querySelectorAll('.sheet').forEach((e) => e.remove())); }
    await sleep(250);
  };
  if (process.env.ONLYJ6) { if (process.env.ONLYJ6 === '5') await tryPress('J5 pre', 20, 800, false, false); if (process.env.ONLYJ6 === '4') await tryPress('J4 pre', 13, 800, false, false); await page.evaluate(() => { window.__pe = []; for (const t of ['pointerdown','pointerup','pointercancel','pointerleave','contextmenu','touchstart','touchend','touchcancel']) document.addEventListener(t, (e) => window.__pe.push(t + '@' + Math.round(performance.now() % 100000) + (t === 'pointerdown' ? ' target=' + (e.target.className || e.target.tagName) + ' y=' + Math.round(e.clientY) + ' scrollY=' + Math.round(scrollY) : '')), true); }); await tryPress('J6 dbg', 0, 750, true, true); console.log('EVENTS', JSON.stringify(await page.evaluate(() => window.__pe))); await tryPress('J6 dbg2', 0, 750, false, true); await browser.close(); return; }
  await tryPress('J1 tremor 5 px, release 100 ms after the sheet opened: opens, presses nothing', 5, 600, true, true);
  await tryPress('J2 tremor 8 px, release 100 ms after: opens, presses nothing', 8, 600, true, true);
  await tryPress('J3 tremor 10 px, release 100 ms after: opens, presses nothing', 10, 600, true, true);
  await tryPress('J4 drift 13 px (> 12 px slop): no sheet', 13, 800, false, false);
  await tryPress('J5 tremor 20 px: no sheet (it is a scroll)', 20, 800, false, false);
  await tryPress('J6 release 250 ms after the sheet opened: presses nothing', 0, 750, true, true);
  await tryPress('J6b release 330 ms after the sheet opened: presses nothing', 0, 830, true, true);
  await tryPress('J6c release 400 ms after the sheet opened: presses nothing', 0, 900, true, true);
  await tryPress('J6d release 700 ms after the sheet opened: presses nothing', 0, 1200, true, true);
  // deliberate tap on the button 150 ms and 400 ms after the release
  for (const wait of [150, 400]) {
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(150); loc = await placeChord(page, j);
    const b = await loc.boundingBox(); await page.evaluate((d) => window.scrollBy(0, d), b.y + b.height / 2 - (btn.y + btn.height / 2)); await sleep(300);
    const b2 = await loc.boundingBox(); const x = b2.x + b2.width / 2, y = b2.y + b2.height / 2; const before = await times();
    await touch(cdp, 'touchStart', x, y); await sleep(750); await touch(cdp, 'touchEnd', x, y); await sleep(wait);
    await page.locator('.nudge-sheet [data-s="-0.25"]').first().tap(); await sleep(250);
    const after = await times(); const d = after.map((v, i) => Math.round((v - before[i]) * 1000)).filter((v) => v);
    rec(`J7 deliberate tap ${wait} ms after the release is accepted`, d.length === 1 && d[0] === -250, `changes ${JSON.stringify(d)}`);
    await page.click('#nudge-close').catch(() => {}); await sleep(200);
    const u = await times(); if (u.some((v, i) => v !== before[i])) { await page.locator('#nudge-undo').tap().catch(() => {}); }
  }
  rec('Jz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
async function modeTicks() {
  const { browser, page, errors, cdp } = await open(); await load(page, SONG, MP3);
  const j = 15; const A0 = await al(page);
  // 4 section-free nudges of the chord j: -0,25 each (it is a 4-quarter chord at 100 bpm: 2,4 s)
  const ref = await page.evaluate((j) => window.__gapp.timeline.events[j].ref, j);
  await page.reload(); await page.waitForSelector('#btn-play'); await sleep(900);
  const loc = await placeChord(page, j); const p = await mid(loc);
  await touch(cdp, 'touchStart', p.x, p.y); await sleep(750); await touch(cdp, 'touchEnd', p.x, p.y); await sleep(700);
  for (let k = 0; k < 4; k++) { await page.locator('.nudge-sheet [data-s="-0.25"]').first().tap(); await sleep(150); }
  await page.click('#nudge-close').catch(() => {}); await sleep(300);
  const A1 = await al(page); const tl = await page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.beats]), beats: window.__gapp.timeline.beats.map((b) => b.timeSec) }));
  info('T0', `chord ${j}: ${A0.eventStartSec[j].toFixed(2)} -> ${A1.eventStartSec[j].toFixed(2)}; previous chord ${tl.ev[j - 1][1].toFixed(2)} s with ${tl.ev[j - 1][2]} ticks, this chord ${tl.ev[j][1].toFixed(2)} s with ${tl.ev[j][2]} ticks`);
  await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.click('#btn-click-icon');
  const t0 = A1.eventStartSec[j - 1] - 2.5;
  await page.evaluate((t) => { window.__clicks.length = 0; window.__gapp.audioEl.currentTime = t; }, t0);
  await sleep(10500);
  const raw = await page.evaluate(() => ({ c: window.__clicks, m: window.__gapp.audioEl.currentTime, x: window.__ctx.currentTime }));
  const off = raw.m - raw.x; const ct = raw.c.map(([w]) => w + off).sort((a, b) => a - b).filter((t) => t > t0 + 0.5);
  const beat = 0.6; const iv = ct.slice(1).map((t, i) => t - ct[i]);
  rec('T1 no two clicks closer than 0.6 beat after the nudges', iv.every((d) => d >= 0.6 * beat), `min interval ${Math.min(...iv).toFixed(3)} s over ${iv.length}`);
  const inChord = (a, b) => ct.filter((t) => t >= a - 0.03 && t < b - 0.03).length;
  const sj = A1.eventStartSec[j], sj1 = A1.eventStartSec[j + 1];
  info('T2', `clicks in chord ${j - 1}: ${inChord(A1.eventStartSec[j - 1], sj)} (timeline ${tl.ev[j - 1][2]}); in chord ${j}: ${inChord(sj, sj1)} (timeline ${tl.ev[j][2]}); first click at/after the new start: ${(ct.find((t) => t >= sj - 0.05) - sj).toFixed(3)} s`);
  // by design (DECISIONS round 11) the clicks follow the beat grid, not the chord start: after a nudge the chord start is not clicked; the offset is informational
  info('T3', `offset of the first click from the new chord start: ${(ct.find((t) => t >= sj - 0.05) - sj).toFixed(3)} s (grid beat: ${tl.beats.map((b) => b - sj).filter((d) => d >= -0.05)[0].toFixed(3)} s)`);
  rec('Tz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
async function modeHint() {
  const { browser, page, errors } = await open(); await load(page, SONG, MP3);
  const hint = () => page.evaluate(() => [...document.querySelectorAll('.msg[role=alert], .toast, [role=alert]')].map((e) => e.textContent).join('|'));
  await sleep(1500); const t0 = await hint(); info('H0', `right after the sync: "${t0.slice(0, 90)}"`);
  const counts = [];
  for (let i = 0; i < 3; i++) { await page.reload(); await page.waitForSelector('#btn-play'); await sleep(1500); counts.push(/Tieni premuto un accordo/.test(await hint()) ? 1 : 0); }
  const seen = (/Tieni premuto un accordo/.test(t0) ? 1 : 0) + counts.reduce((a, b) => a + b, 0);
  rec('H1 the hint is shown exactly once over sync + 3 reloads', seen === 1, `sync ${/Tieni premuto/.test(t0) ? 1 : 0}, reloads ${JSON.stringify(counts)}`);
  rec('Hz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
async function modeRowtap() {
  // the sheet opened from the sync screen row by a tap (no finger held): is a quick tap on a step button swallowed by the 320 ms release guard?
  const { browser, page, errors } = await open(); await load(page, SONG, MP3);
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#as-rows');
  for (const wait of [150, 300, 450]) {
    const before = (await al(page)).eventStartSec.slice();
    const t0 = Date.now();
    await page.locator('.as-row[data-sec="1"] [data-act="nudge"]').first().scrollIntoViewIfNeeded();
    await page.locator('.as-row[data-sec="1"] [data-act="nudge"]').first().tap(); await page.waitForSelector('#nudge-close');
    await sleep(wait);
    await page.locator('.nudge-sheet [data-s="-0.05"]').tap({ force: true }).catch(() => {}); await sleep(200);
    const after = (await al(page)).eventStartSec.slice(); const ch = after.filter((v, i) => v !== before[i]).length;
    rec(`R1 tap on a step button ${wait} ms after the sheet opened from the sync row is accepted`, ch > 0, `${ch} chords moved`);
    await sleep(400);
    for (let q = 0; q < 3; q++) { if (await page.locator('#nudge-undo').isDisabled().catch(() => true)) break; await page.locator('#nudge-undo').tap({ timeout: 2000 }).catch(() => {}); await sleep(100); }
    await page.locator('#nudge-close').tap().catch(() => {}); await sleep(200);
  }
  rec('Rz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
async function modeAnchor() {
  // C: the anchors move with the nudge. Anchor on section index 2 at 40.6 s (as round10-tester-nudge X4/X5, but on a fresh sync, no earlier nudge).
  const { browser, page, errors, cdp } = await open(); await load(page, SONG, MP3);
  const A0 = await al(page);
  await page.evaluate(() => { const k = Object.keys(localStorage).find((k) => k.startsWith('gapp.song.')); const s = JSON.parse(localStorage.getItem(k)); s.audio.anchors = { 2: 40.6 }; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('#btn-play'); await sleep(900);
  const tlOf = () => page.evaluate(() => window.__gapp.timeline.events.map((e) => [e.startSec, e.sectionIndex]));
  const anchors = () => page.evaluate(() => { const k = Object.keys(localStorage).find((k) => k.startsWith('gapp.song.')); return JSON.parse(localStorage.getItem(k)).audio.anchors; });
  const T0 = await tlOf(); info('X0', `anchors ${JSON.stringify(await anchors())}; section 3 first chord ${T0.find((e) => e[1] === 2)[0].toFixed(3)} s`);
  for (const [label, d] of [['+0,25', 0.25], ['-0,25', -0.25], ['+0,05', 0.05]]) {
    const before = await tlOf(); const a0 = await anchors();
    const hb = page.locator('.sec-nudge[data-sec="2"]'); await hb.scrollIntoViewIfNeeded(); await sleep(300); await hb.tap(); await page.waitForSelector('#nudge-close'); await sleep(450);
    await page.locator(`.nudge-sheet [data-s="${d}"]`).tap(); await sleep(250);
    const after = await tlOf(); const a1 = await anchors();
    const mv = after.map((e, i) => [i, e[1], Math.round((e[0] - before[i][0]) * 1000)]).filter((x) => x[2]);
    const secs = [...new Set(mv.map((x) => x[1]))];
    const inSec = mv.filter((x) => x[1] === 2).map((x) => x[2]);
    info('X1', `${label}: anchors ${JSON.stringify(a0)} -> ${JSON.stringify(a1)}; chords moved ${mv.length} (sections ${secs.map((q) => q + 1).join(',')}); in section 3: min ${Math.min(...inSec)} max ${Math.max(...inSec)} ms; elsewhere ${mv.filter((x) => x[1] !== 2).map((x) => x[0] + ':' + x[2]).join(' ').slice(0, 120)}`);
    rec(`X2 anchored section nudged ${label}: every chord of the section moves by ${Math.round(d * 1000)} ms (+-5), the others stay`, inSec.length === 12 && inSec.every((v) => Math.abs(v - d * 1000) <= 5) && mv.every((x) => x[1] === 2), `${inSec.length} chords in the section`);
    await page.locator('#nudge-close').tap(); await sleep(300);
  }
  rec('Xz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
async function modeGap() {
  if (!fs.existsSync(GSONG) || !fs.existsSync(GMP3)) { console.log('missing gap assets: node test/e2e/round7-tester-make.mjs && node test/e2e/round8-tester-gap-assets.mjs'); return; }
  const { browser, page, errors, cdp } = await open(); await load(page, GSONG, GMP3); await page.reload(); await page.waitForSelector('#btn-play'); await sleep(900);
  const A0 = await al(page); const g = (A0.gaps || [])[0];
  rec('G0 the synthetic solo gives a gap', !!g, JSON.stringify((A0.gaps || []).map((x) => [+x.startSec.toFixed(1), +x.endSec.toFixed(1), x.before])));
  if (!g) { await browser.close(); return; }
  const j = g.before; info('G0b', `chord after the gap is event ${j} at ${A0.eventStartSec[j].toFixed(2)}, gap ${g.startSec.toFixed(2)}-${g.endSec.toFixed(2)}`);
  const loc = await placeChord(page, j); const p = await mid(loc);
  await touch(cdp, 'touchStart', p.x, p.y); await sleep(750); await touch(cdp, 'touchEnd', 0, 0); await sleep(700);
  for (const [d, label] of [[0.25, '+0,25'], [-0.25, '-0,25'], [-0.25, '-0,25 again']]) {
    await page.locator(`.nudge-sheet [data-s="${d}"]`).first().tap(); await sleep(250);
    const A = await al(page); const gg = (A.gaps || [])[0];
    info('G1', `${label}: chord ${(A.eventStartSec[j] - A0.eventStartSec[j]).toFixed(2)} s, gap ${gg ? gg.startSec.toFixed(2) + '-' + gg.endSec.toFixed(2) : 'none'}`);
  }
  const A = await al(page); const gg = (A.gaps || [])[0];
  rec('G2 after +0,25 -0,25 -0,25 the gap end follows the chord (<= 10 ms) and the gap is still there', !!gg && Math.abs(gg.endSec - A.eventStartSec[j]) <= 0.01, gg ? `${gg.endSec.toFixed(3)} vs chord ${A.eventStartSec[j].toFixed(3)}` : 'gap gone');
  await page.click('#nudge-close').catch(() => {});
  const tlg = await page.evaluate(() => window.__gapp.timeline.events.length); info('G3', `timeline events ${tlg}`);
  rec('Gz no page errors', errors.length === 0, errors.join('|').slice(0, 120)); await browser.close();
}
(async () => {
  const run = { btn: modeBtn, jitter: modeJitter, ticks: modeTicks, hint: modeHint, gap: modeGap, rowtap: modeRowtap, anchor: modeAnchor };
  for (const n of mode === 'all' ? Object.keys(run) : [mode]) { console.log('== ' + n); await run[n](); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
