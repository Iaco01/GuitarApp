// Round 9 tester, F2: user trial (touch only) on iPhone SE and iPhone 13 with the real mp3: import, sync, read the summary,
// correct a RED section, play through the gap at 0:59-1:03. Prints counts, timings and UI wording (button/panel texts, never
// the song text).  Screenshots in test-artifacts/round-9/user (show the real text: never commit).
// Run: node scripts/build.mjs && node test/e2e/round9-tester-user.cjs [SE|13]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-9', 'user');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };
const devName = process.argv[2] || 'SE';
let step = 0; const notes = [];
const note = (s) => { notes.push(s); console.log('NOTE', s); };
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(PROFILES[devName])).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', async (d) => { note(`dialog "${d.message().slice(0, 50)}" accepted`); await d.accept(); });
  const vp = PROFILES[devName].viewport;
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${devName}-${String(++step).padStart(2, '0')}-${n}.png`) });
  async function tapEl(sel, label) {
    const loc = page.locator(sel).first(); await loc.waitFor({ state: 'attached', timeout: 30000 });
    const box = await loc.boundingBox();
    const inView = box && box.y >= 0 && box.y + box.height <= vp.height;
    if (!inView) note(`"${label}" not fully visible without scrolling (y ${box && Math.round(box.y)}, h ${box && Math.round(box.height)}, screen ${vp.height})`);
    if (box && (box.height < 40 || box.width < 40)) note(`"${label}": small target ${Math.round(box.width)}x${Math.round(box.height)}`);
    await loc.tap({ timeout: 10000 }).catch(async () => { note(`"${label}": tap failed, retry after scroll`); await loc.scrollIntoViewIfNeeded(); await loc.tap(); });
  }
  const t0 = Date.now();
  await page.goto(URL); await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  await tapEl('#btn-sync', 'Aggiungi audio');
  await page.waitForSelector('#sync-file', { state: 'attached' }); await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start');
  await shot('audio-loaded');
  const tS = Date.now(); await tapEl('#as-start', 'Sincronizza automaticamente');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  note(`analysis ${((Date.now() - tS) / 1000).toFixed(1)} s after the tap`);
  const rows = await page.$$eval('.as-row', (rs) => rs.map((r) => r.dataset.state));
  note(`states ${rows.map((s) => s[0]).join('')}`);
  note('summary header texts: ' + (await page.$$eval('#as-box > p, #as-box > h3, #as-counts, .as-note, #as-box .muted', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean))).join(' || ').slice(0, 900));
  note('row sub-texts (state/BPM wording only): ' + [...new Set(await page.$$eval('.as-sub', (e) => e.map((x) => x.textContent.replace(/[0-9.,]+ BPM/, 'N BPM').trim())))].join(' | '));
  note('gap row wording: ' + (await page.$$eval('.as-gap', (g) => g.map((x) => x.textContent.trim()))).join(' | '));
  await page.locator('#as-box').scrollIntoViewIfNeeded(); await shot('summary-top');
  const rowsLoc = page.locator('.as-row'); await rowsLoc.first().scrollIntoViewIfNeeded(); await shot('summary-rows');
  // correct a red section
  const si = rows.findIndex((s) => s === 'red');
  note(`first red section: ${si + 1}; red sections: ${rows.map((s, i) => (s === 'red' ? i + 1 : null)).filter(Boolean).join(',')}`);
  if (si >= 0) {
    const times = await page.evaluate((si) => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); const a = s.audio.alignment; const out = []; let k = 0; s.sections.forEach((sec, i) => sec.lines.forEach((l) => l.chords.forEach(() => { if (i === si) out.push(a.eventStartSec[k]); k++; }))); return out; }, si);
    await page.locator(`.as-row[data-sec="${si}"] [data-act="correct"]`).scrollIntoViewIfNeeded();
    await tapEl(`.as-row[data-sec="${si}"] [data-act="correct"]`, 'Correggi a orecchio (rossa)');
    await page.waitForSelector('#corr-tap'); await shot('correct-open');
    note('correction screen texts: ' + (await page.$$eval('#corr-status, #corr-next, #corr-count', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).join(' || '));
    const tb = await page.locator('#corr-tap').boundingBox();
    note(`"Cambio!" ${Math.round(tb.width)}x${Math.round(tb.height)} at y ${Math.round(tb.y)} (screen ${vp.height}); ${times.length} chords in the section`);
    await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
    const cx = tb.x + tb.width / 2, cy = tb.y + tb.height / 2;
    for (let k = 0; k < times.length; k++) { await page.waitForFunction((t) => window.__gappSync.player.currentTime() >= t, times[k] - 0.02, { polling: 'raf', timeout: 120000 }); await page.touchscreen.tap(cx, cy); if (k === 3) await shot('correct-tapping'); }
    note('after the taps: ' + (await page.$$eval('#corr-status, #corr-next, #corr-count', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).join(' || '));
    await tapEl('#corr-save', 'Salva');
    await page.waitForSelector('#corr-tap', { state: 'detached' });
    await page.waitForSelector(`.as-row[data-sec="${si}"][data-state="verified"]`);
    note(`after saving: row state verified; counts "${await page.innerText('#as-counts')}"`);
    await shot('verified');
  }
  await tapEl('#as-accept', 'Accetta'); await tapEl('#sync-close', 'Fatto'); await page.waitForSelector('#btn-play');
  await tapEl('#btn-play', 'Play');
  await page.waitForFunction(() => window.__gapp && window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  // through the gap
  await page.evaluate(() => { window.__gapp.audioEl.currentTime = 56; }); await sleep(800);
  const log = []; const tt = Date.now();
  let shotsDone = new Set();
  while (Date.now() - tt < 14000) {
    const s = await page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, cur: document.querySelectorAll('.cur').length, name: (document.querySelector('#pp-current') || {}).textContent, gap: (document.querySelector('#pp-gap') || {}).textContent, gh: document.querySelector('#pp-gap') ? document.querySelector('#pp-gap').hidden : true }));
    log.push(s);
    for (const [k, t] of [['pre', 58], ['gap1', 60.5], ['gap2', 62.5], ['post', 64.5]]) if (s.t >= t && !shotsDone.has(k)) { shotsDone.add(k); await shot('play-' + k); }
    if (s.t > 66) break; await sleep(200);
  }
  const inG = log.filter((s) => s.t > 59.8 && s.t < 63.2);
  note(`through the gap 0:59-1:03: samples inside ${inG.length}; highlighted count ${JSON.stringify([...new Set(inG.map((s) => s.cur))])}; panel names ${JSON.stringify([...new Set(inG.map((s) => s.name))])}; countdown texts ${JSON.stringify([...new Set(inG.map((s) => s.gap))])}`);
  const before = log.filter((s) => s.t > 56.8 && s.t < 59), after = log.filter((s) => s.t > 63.8);
  note(`before the gap highlighted ${JSON.stringify([...new Set(before.map((s) => s.cur))])}, after ${JSON.stringify([...new Set(after.map((s) => s.cur))])}`);
  note(`total ${((Date.now() - t0) / 1000).toFixed(0)} s; page errors ${errors.length} ${errors.join('|').slice(0, 100)}`);
  fs.writeFileSync(path.join(OUT, `${devName}-notes.txt`), notes.join('\n'));
  await browser.close();
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
