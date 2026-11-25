// Round 8 tester, part F2: "user trial" on iPhone SE and iPhone 13, with touch only (page.tap / touchscreen.tap, no forced
// clicks): from the empty library to an mp3 synced automatically and corrected in one section. Every step records whether the
// control was visible without scrolling, its size, and how long it took, so the places where a person would get stuck show up.
// Run: npm run build && node test/e2e/round8-tester-user.cjs [SE|13]
// Screenshots: test-artifacts/round-8/tester/user-<dev>-NN-*.png (they show the real song text: never commit).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-8');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILES = {
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
const devName = process.argv[2] || 'SE';
const notes = [];
let step = 0;
const note = (s) => { notes.push(s); console.log('NOTE', s); };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[devName]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', async (d) => { note(`dialog: "${d.message().slice(0, 60).replace(/\s+/g, ' ')}..." (accepted)`); await d.accept(); });
  const vp = PROFILES[devName].viewport;
  const shot = (name) => page.screenshot({ path: path.join(OUT, `u8-user-${devName}-${String(++step).padStart(2, '0')}-${name}.png`) });
  // tap a control as a finger would: report if it is outside the visible area (needs scrolling) or too small
  async function tapEl(sel, label) {
    const loc = page.locator(sel).first();
    await loc.waitFor({ state: 'attached', timeout: 30000 });
    let box = await loc.boundingBox();
    const inView = box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width;
    // fixed bottom bar and toast can cover it: check what is at the centre
    const covered = await page.evaluate(([sel]) => {
      const e = document.querySelector(sel); if (!e) return 'missing';
      const r = e.getBoundingClientRect(); const cx = r.x + r.width / 2; const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return top && (top === e || e.contains(top)) ? '' : (top ? (top.id || top.className || top.tagName) : 'nothing');
    }, [sel]);
    if (!inView) note(`"${label}": not fully visible without scrolling (y ${box && Math.round(box.y)}, h ${box && Math.round(box.height)}, screen ${vp.height})`);
    if (box && (box.height < 40 || box.width < 40)) note(`"${label}": small target ${Math.round(box.width)}x${Math.round(box.height)}`);
    if (covered && inView) note(`"${label}": the centre is covered by "${covered}"`);
    await loc.tap({ timeout: 10000 }).catch(async (e) => { note(`"${label}": tap failed (${String(e).split('\n')[0].slice(0, 90)}): trying after scroll`); await loc.scrollIntoViewIfNeeded(); await loc.tap(); });
  }

  await page.goto(URL);
  await shot('library-empty');
  const t0 = Date.now();
  // 1. import the .mht: the file input is the way (iOS would open the file picker)
  const imp = await page.locator('#import-input').count();
  note(`import control present: ${imp > 0}`);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 20000 });
  await shot('song-opened');
  note(`song opened ${((Date.now() - t0) / 1000).toFixed(1)} s after the import`);
  // 2. add audio
  const labels = await page.$$eval('button', (b) => b.filter((x) => x.getBoundingClientRect().height > 0).map((x) => (x.textContent || '').trim()).filter(Boolean));
  note(`visible buttons on the song screen: ${labels.slice(0, 14).join(' | ')}`);
  await tapEl('#btn-sync', 'Aggiungi audio / Sincronizza audio');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await shot('sync-screen-empty');
  await page.setInputFiles('#sync-file', MP3);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await shot('audio-loaded');
  const asBox = await page.locator('#as-start').boundingBox();
  note(`after choosing the mp3, "Sincronizza automaticamente" is at y ${Math.round(asBox.y)} (screen ${vp.height}), ${Math.round(asBox.width)}x${Math.round(asBox.height)}`);
  // 3. automatic sync
  const tS = Date.now();
  await tapEl('#as-start', 'Sincronizza automaticamente');
  await page.waitForSelector('#as-progress');
  await sleep(1500);
  await shot('progress');
  const cancelVisible = await page.locator('#as-cancel').boundingBox();
  note(`during analysis "Annulla" visible: ${!!cancelVisible && cancelVisible.y + cancelVisible.height <= vp.height}, progress text: ${await page.innerText('#as-prog-text')}`);
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  note(`analysis finished ${((Date.now() - tS) / 1000).toFixed(1)} s after the tap`);
  await page.locator('#as-box').scrollIntoViewIfNeeded();
  await shot('summary-top');
  await page.locator('.as-row').first().scrollIntoViewIfNeeded();
  const rows = await page.$$eval('.as-row', (rs) => rs.map((r) => r.dataset.state));
  note(`states: ${rows.join(',')}`);
  note('summary header text: ' + (await page.innerText('#as-box')).replace(/\s+/g, ' ').slice(0, 600));
  note('first rows text: ' + (await page.$$eval('.as-row', (r) => r.slice(0, 3).map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).join(' || '));
  await shot('summary-rows');
  const rowH = await page.$$eval('.as-row', (rs) => Math.round(rs[0].getBoundingClientRect().height));
  note(`a summary row is ${rowH} px tall; ${rows.length} rows`);
  // 4. listen
  await tapEl('#as-listen', 'Ascolta e controlla');
  await sleep(3000);
  await shot('listening');
  note(`"now" line while listening: ${(await page.innerText('#as-now')).replace(/\s+/g, ' ').slice(0, 40)}`);
  await page.evaluate(() => window.__gappSync.player.pause());
  // 5. correct the first non-green section with real touch taps timed on the audio clock
  const conf = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); return s.audio.alignment.sections.map((x) => [x.confidence, x.bpm]); });
  note(`section confidences: ${conf.map((c, i) => `${i + 1}:${rows[i][0]}${c[0]}${c[1] === null ? 'L' : ''}`).join(' ')}`);
  let si = -1; conf.forEach((c, i) => { if (rows[i] === 'yellow' && (si < 0 || c[0] < conf[si][0])) si = i; });
  if (si < 0) si = rows.findIndex((s) => s !== 'green');
  note(`the most yellow section: ${si + 1} "${await page.$eval('.as-row[data-sec="' + si + '"]', (r) => (r.querySelector('.as-name') || r).textContent.slice(0, 30))}"`);
  const times = await page.evaluate((si) => {
    const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop())));
    const a = s.audio.alignment; const out = []; let k = 0;
    s.sections.forEach((sec, i) => sec.lines.forEach((l) => l.chords.forEach(() => { if (i === si) out.push(a.eventStartSec[k]); k++; })));
    return out;
  }, si);
  note(`correcting section ${si + 1} (${rows[si]}), ${times.length} chords`);
  await page.locator(`.as-row[data-sec="${si}"] [data-act="correct"]`).scrollIntoViewIfNeeded();
  await tapEl(`.as-row[data-sec="${si}"] [data-act="correct"]`, 'Correggi a orecchio');
  await page.waitForSelector('#corr-tap');
  await shot('correct-open');
  const tapBox = await page.locator('#corr-tap').boundingBox();
  note(`"Cambio!" button: ${Math.round(tapBox.width)}x${Math.round(tapBox.height)} at y ${Math.round(tapBox.y)} (screen ${vp.height})`);
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  const cx = tapBox.x + tapBox.width / 2; const cy = tapBox.y + tapBox.height / 2;
  const hit = [];
  for (let k = 0; k < times.length; k++) {
    // wait for the audio clock to reach the chord change, then touch (a person reacts later: +0 here)
    const off = process.env.TAP_OFFSET === 'alt' ? (k % 2 ? 0.25 : -0.25) : 0; // alt: alternate +-250 ms, to check the --truth pipeline
    await page.waitForFunction((t) => window.__gappSync.player.currentTime() >= t, times[k] + off - 0.02, { polling: 'raf', timeout: 120000 });
    const at = await page.evaluate(() => window.__gappSync.player.currentTime());
    await page.touchscreen.tap(cx, cy);
    hit.push(at - times[k] - off);
    if (k === 4) await shot('correct-tapping');
  }
  const cnt = await page.innerText('#corr-count');
  note(`taps done: counter "${cnt}"; tap issued minus target (ms): mean ${(1000 * hit.reduce((a, b) => a + b, 0) / hit.length).toFixed(0)}, max ${(1000 * Math.max(...hit)).toFixed(0)}`);
  await shot('correct-done');
  const pv = await page.locator('#corr-preview').boundingBox();
  const sv = await page.locator('#corr-save').boundingBox();
  note(`Anteprima at y ${Math.round(pv.y)}, Salva at y ${Math.round(sv.y)} (screen ${vp.height}); chips area: ${await page.$eval('#corr-chips', (e) => `${Math.round(e.getBoundingClientRect().height)} px tall, scrollHeight ${e.scrollHeight}`)}`);
  await tapEl('#corr-preview', 'Anteprima: ascolta');
  await sleep(2500);
  await shot('correct-preview');
  await tapEl('#corr-save', 'Salva');
  await page.waitForSelector('#corr-tap', { state: 'detached' });
  await page.waitForSelector(`.as-row[data-sec="${si}"][data-state="verified"]`);
  await shot('verified');
  note(`counts line: ${await page.innerText('#as-counts')}`);
  // export the corrections (the file goes to the tester folder; autosync-real.mjs --truth reads it)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#as-export').tap()]);
  await dl.saveAs(path.join(OUT, `u8-user-${devName}-truth.json`));
  note(`export: ${dl.suggestedFilename()}`);
  // 6. accept, close, play
  await tapEl('#as-accept', 'Accetta');
  await tapEl('#sync-close', 'Fatto');
  await page.waitForSelector('#btn-play');
  await shot('song-after');
  await tapEl('#btn-play', 'Play');
  await page.waitForFunction(() => window.__gapp && window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  await sleep(2500);
  await shot('song-playing');
  // play from the middle: while playing, tap a chord of a middle section (that is how the app jumps)
  const mid = await page.evaluate(() => { const els = [...document.querySelectorAll('[data-ref]')].filter((e) => e.getBoundingClientRect().width > 0); const e = els[Math.floor(els.length / 2)]; e.scrollIntoView({ block: 'center' }); return { n: els.length, ref: e.getAttribute('data-ref') }; });
  await sleep(500);
  const tlEv = await page.evaluate((ref) => { const g = window.__gapp; const i = [...document.querySelectorAll('[data-ref]')].findIndex((e) => e.getAttribute('data-ref') === ref); return { i, start: g.timeline.events[i] && g.timeline.events[i].startSec }; }, mid.ref);
  const chordBox = await page.locator(`[data-ref="${mid.ref}"]`).first().boundingBox();
  note(`middle chord #${tlEv.i} of ${mid.n}, visible on screen: ${!!chordBox && chordBox.y >= 0 && chordBox.y + chordBox.height <= vp.height}, its time ${tlEv.start && tlEv.start.toFixed(1)} s`);
  await page.locator(`[data-ref="${mid.ref}"]`).first().tap();
  await sleep(2500);
  const nowT = await page.evaluate(() => window.__gapp.player.state + ' ' + window.__gapp.player.timeSec.toFixed(1));
  note(`after tapping the middle chord while playing: ${nowT}`);
  await shot('song-from-middle');
  // stopped: where does a tap on a chord lead?
  await page.locator('#btn-play').tap(); await sleep(400);
  await page.locator(`[data-ref="${mid.ref}"]`).first().tap().catch(() => {}); await sleep(600);
  note(`tap on a chord while stopped opens: ${await page.evaluate(() => document.querySelector('.dlg, .sheet, .chord-sheet, [role=dialog]') ? 'a dialog/sheet' : 'nothing visible')}`);
  await shot('song-chord-stopped');
  note(`song play uses the aligned timeline: ${await page.evaluate(() => !!window.__gapp.timeline.aligned)}`);
  note(`total user-trial time ${((Date.now() - t0) / 1000).toFixed(0)} s; page errors: ${errors.length}`);
  fs.writeFileSync(path.join(OUT, `u8-user-${devName}-notes.txt`), notes.join('\n'));
  await browser.close();
})().catch((e) => { console.log('FAILED', e); fs.writeFileSync(path.join(OUT, `u8-user-${devName}-notes.txt`), notes.join('\n') + '\nFAILED ' + e); process.exit(1); });
