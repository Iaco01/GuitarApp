// Round 5: sync screen bar, anchors in headers, tempo suggestions, library audio badge, first chord
// after a pause, loop and click indicators in the panel, effective tempo. Synthetic track (tester's
// ffmpeg), iPhone SE and iPhone 13 emulated.
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round5.cjs [all|1|4|5|6|7] [SE|13]
// Screenshots go to test-artifacts/round-5/ (not committed).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const DIR = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-5');
fs.mkdirSync(OUT, { recursive: true });
const WAV = path.join(DIR, 't4.wav');
const EXP = JSON.parse(fs.readFileSync(path.join(DIR, 't4-expected.json'), 'utf-8'));
const SONG = path.join(DIR, 't4-song.json');
const SONG_WRONG = path.join(DIR, 't4-song-wrong.json');
const OFFSET = 2.345;
const only = process.argv[2] === 'all' ? '' : process.argv[2] || '';
const onlyDev = process.argv[3] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };

// variants of the tester's song, written next to it: stretched Strofa (100 instead of 96, Ponte anchored),
// and a leading pause in the first section
function variant(name, edit) {
  const d = JSON.parse(fs.readFileSync(SONG, 'utf-8'));
  edit(d.songs[0]);
  const f = path.join(OUT, name);
  fs.writeFileSync(f, JSON.stringify(d));
  return f;
}

async function open(profile) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  return { browser, page, errors };
}
async function importJson(page, file) {
  await page.setInputFiles('#import-json', file);
  await page.waitForSelector('.dlg', { timeout: 5000 }).catch(() => {});
  const b = await page.$('.dlg [data-value="newer"]');
  if (b) await b.click();
  await page.waitForSelector('.song-row');
}
async function openSong(page) {
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
}
async function loadAudio(page, file = WAV) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#sync-first', { timeout: 15000 });
  await sleep(300);
}
const seek = (page, t) => page.evaluate((x) => window.__gappSync.player.seek(x), t);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${dev}-${name}.png`) });
const offMs = (page) => page.evaluate(() => Number(/\((-?\d+) ms\)/.exec(document.querySelector('#sync-offset').textContent)[1]));
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; }, sel);

async function run(label, profile) {
  dev = label;
  const vh = profile.viewport.height;
  // ---------- R1 sync screen: fixed bar, big buttons, toast ----------
  if (!only || only === '1') {
    const { browser, page, errors } = await open(profile);
    await importJson(page, SONG);
    await openSong(page);
    await loadAudio(page);
    const first = await rect(page, '#sync-first');
    const next = await rect(page, '#sync-next');
    const bar = await rect(page, '#sync-transport');
    rec('R1 "Primo accordo!" and the anchor button are >= 56 px high', first.h >= 56 && next.h >= 56, `${first.h} / ${next.h}`);
    rec('R1 both are in view right after loading, without scrolling', first.top >= 0 && first.bottom <= vh && next.bottom <= vh && (await page.evaluate(() => document.querySelector('.rec.sync').scrollTop)) === 0, `bottom ${first.bottom} of ${vh}`);
    rec('R1 the bar takes at most 20% of the height', bar.h <= vh * 0.2, `${bar.h.toFixed(0)} px of ${vh} (${((bar.h / vh) * 100).toFixed(1)}%)`);
    const msgInfo = await page.evaluate(() => { const m = document.querySelector('#sync-msg'); const r = m.getBoundingClientRect(); const b = document.querySelector('#sync-transport').getBoundingClientRect(); return { text: m.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, clipped: m.scrollHeight > m.clientHeight + 1, overBar: r.bottom > b.top + 1, vw: innerWidth }; });
    rec('R1 the confirmation message is whole: wraps, inside the screen, above the bar', msgInfo.text.length > 20 && !msgInfo.clipped && msgInfo.left >= 0 && msgInfo.right <= msgInfo.vw && msgInfo.top >= 0 && !msgInfo.overBar, JSON.stringify({ ...msgInfo, text: msgInfo.text.length + ' chars' }));
    await shot(page, 'sync-loaded');
    // the first chord, tapped exactly when it starts
    await seek(page, OFFSET);
    await page.click('#sync-first');
    const off = await offMs(page);
    rec('R1 "Primo accordo!" sets the offset', Math.abs(off - OFFSET * 1000) < 40, `${off} ms`);
    // anchors from the bar
    for (const si of [1, 2, 3]) {
      await seek(page, EXP.sections[si].startSec);
      await page.click('#sync-next');
    }
    const nm = await page.innerText('#sync-next').catch(() => '');
    await seek(page, EXP.endSec);
    await page.click('#sync-end');
    const rows = await page.$$eval('#sync-rows li .sync-row-time', (e) => e.map((x) => x.textContent));
    rec('R1 anchors with their time in the sync screen', rows.length === 4 && rows.every((r) => r.startsWith('⚓')), rows.join(' | '));
    rec('R1 the anchor button is off when every section is set', /Tutte/.test(nm) || nm === '', nm);
    await page.evaluate(() => document.querySelector('#sync-rows').scrollIntoView({ block: 'start' }));
    await shot(page, 'sync-anchors');
    // "⋯" opens the secondary controls inside the bar
    await page.click('#sync-more-btn');
    const bar2 = await rect(page, '#sync-transport');
    await shot(page, 'sync-more');
    info(`bar with "⋯" open: ${bar2.h.toFixed(0)} px`);
    await page.click('#sync-more-btn');
    // fine tuning of an anchor from the sync screen
    const t0 = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song')).audio.anchors[1]);
    await page.click('#sync-rows li[data-sec="1"] [data-act="fine"]');
    await page.waitForSelector('#anchor-time');
    await page.click('.anchor-sheet [data-ms="50"]');
    await page.click('.anchor-sheet [data-ms="-10"]');
    const t1 = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song')).audio.anchors[1]);
    rec('R1 anchor sheet: +50 −10 ms moves the anchor by 40 ms', Math.abs(t1 - t0 - 0.04) < 1e-6, `${((t1 - t0) * 1000).toFixed(1)} ms`);
    await shot(page, 'anchor-sheet');
    await page.click('#anchor-close');
    // close: anchors in the headers at once, and after a reload
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl);
    const h1 = await page.$$eval('.sec-anchor', (e) => e.map((x) => x.textContent));
    rec('R2 ⚓ in the section headers right after "Fatto"', h1.length === 4 && h1.every((x) => x.startsWith('⚓')), h1.join(' | '));
    await page.reload();
    await page.waitForSelector('#btn-sync');
    await sleep(600);
    const h2 = await page.$$eval('.sec-anchor', (e) => e.map((x) => x.textContent));
    rec('R2 ⚓ in the section headers after a reload', h2.length === 4, h2.join(' | '));
    await page.evaluate(() => document.querySelector('.sec-anchor').scrollIntoView({ block: 'center' }));
    await shot(page, 'headers-anchors');
    // tap on a header anchor: fine tuning sheet, then remove
    await page.click('.sec-head[data-sec="3"] .sec-anchor');
    await page.waitForSelector('#anchor-time');
    const before = await page.innerText('#anchor-time');
    await page.click('.anchor-sheet [data-ms="10"]');
    const after = await page.innerText('#anchor-time');
    rec('R2 tap on ⚓ opens ±10/±50 ms tuning', before !== after, `${before} -> ${after}`);
    await page.click('#anchor-remove');
    await sleep(200);
    const h3 = await page.$$eval('.sec-anchor', (e) => e.length);
    rec('R2 the anchor can be removed from the sheet', h3 === 3, `${h3} left`);

    // ---------- R3 library badge ----------
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.song-row');
    await page.waitForFunction(() => document.querySelector('.badge[data-badge="audio"]') && /✓|mancante/.test(document.querySelector('.badge[data-badge="audio"]').textContent));
    const ok = await page.innerText('.badge[data-badge="audio"]');
    rec('R3 library: "audio ✓" when the file is stored', ok === 'audio ✓', ok);
    await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open('gapp-audio'); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = () => { db.close(); res(); }; }; }));
    await page.reload();
    await page.waitForSelector('.song-row');
    await page.waitForFunction(() => /mancante|✓/.test(document.querySelector('.badge[data-badge="audio"]').textContent));
    const miss = await page.$eval('.badge[data-badge="audio"]', (b) => ({ t: b.textContent, c: b.classList.contains('missing'), bg: getComputedStyle(b).backgroundColor }));
    rec('R3 library: "audio mancante" (orange) when the file is gone', miss.t === 'audio mancante' && miss.c, JSON.stringify(miss));
    await shot(page, 'library-missing');
    rec('R1-R3 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- R4 tempo suggestion: proportional, with the tester's wrong Finale (97 instead of 96) ----------
  if (!only || only === '4') {
    const { browser, page, errors } = await open(profile);
    await importJson(page, SONG_WRONG);
    await openSong(page);
    await loadAudio(page);
    await seek(page, OFFSET); await page.click('#sync-first');
    await seek(page, EXP.endSec); await page.click('#sync-end');
    const sugs = await page.$$eval('#sync-sugs .sync-sug span', (e) => e.map((x) => x.textContent));
    rec('R4 one suggestion over all sections, with the % and the BPM', sugs.length === 1 && /^Tra Intro e Finale l’audio va il \d+(,\d)?% più (veloce|lento): .*BPM circa su ogni sezione\.$/.test(sugs[0]), JSON.stringify(sugs));
    await page.evaluate(() => document.querySelector('#sync-sugs').scrollIntoView({ block: 'center' }));
    await shot(page, 'sync-suggestion');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song-b')).sections.map((s) => s.bpm));
    await page.click('#sync-sugs [data-act="apply"]');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song-b')).sections.map((s) => s.bpm));
    const ratios = after.map((b, i) => b / before[i]);
    rec('R4 Apply scales every section by the same factor (ratios kept)', Math.max(...ratios) - Math.min(...ratios) < 0.002 && after[0] !== after[2], `${before.join('/')} -> ${after.join('/')}`);
    rec('R4 no suggestion left after Apply', (await page.$$('#sync-sugs .sync-sug')).length === 0);
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl);
    const endErr = await page.evaluate((e) => { const tl = window.__gapp.timeline; return tl.totalSec - e; }, EXP.endSec);
    rec('R4 after Apply the end of the song is within 50 ms of the real end', Math.abs(endErr) < 0.05, `${(endErr * 1000).toFixed(0)} ms`);
    rec('R4 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- R5 an anchor tapped 78 ms late does not produce a suggestion ----------
  if (!only || only === '5') {
    const { browser, page, errors } = await open(profile);
    await importJson(page, SONG);
    await openSong(page);
    await loadAudio(page);
    await seek(page, OFFSET); await page.click('#sync-first');
    await seek(page, EXP.sections[3].startSec + 0.078); await page.click('#sync-rows li[data-sec="3"] [data-act="here"]'); // Finale anchor, 78 ms late
    await seek(page, EXP.endSec); await page.click('#sync-end');
    const n = (await page.$$('#sync-sugs .sync-sug')).length;
    rec('R5 a 78 ms late tap gives no suggestion', n === 0, `${n} suggestions; ${await page.innerText('#sync-sugs')}`);
    rec('R5 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- R6 "Primo accordo!" with a leading pause ----------
  if (!only || only === '6') {
    const f = variant('song-pause.json', (s) => { s.sections[0].lines.unshift({ lyric: '', chords: [{ name: 'N.C.', rest: true, beats: 4, col: 0 }] }); });
    const { browser, page, errors } = await open(profile);
    await importJson(page, f);
    await openSong(page);
    await loadAudio(page);
    const pause = (4 * 60) / 70;
    await seek(page, 4.0);
    await page.click('#sync-first'); // the first real chord sounds now
    const off = await offMs(page);
    rec('R6 "Primo accordo!" over a leading pause: offset = tap − pause (not the tap)', Math.abs(off - (4.0 - pause) * 1000) < 40, `${off} ms, expected ${((4 - pause) * 1000).toFixed(0)}`);
    const label = await page.innerText('#sync-first');
    rec('R6 the button still says "Primo accordo!"', label === 'Primo accordo!', label);
    await seek(page, 1.0);
    await page.click('#sync-first');
    rec('R6 a tap too early is refused with a message', /Troppo presto/.test(await page.innerText('#sync-msg')));
    rec('R6 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- R7 panel: loop badge, click icon, effective tempo "≈" ----------
  if (!only || only === '7') {
    const f = variant('song-stretched.json', (s) => {
      s.sections[1].bpm = 100; // the sheet says 100, the recording is at 96
      s.audio = { fileName: 't4.wav', mimeType: 'audio/wav', size: fs.statSync(WAV).size, durationSec: 44.463, addedAt: new Date().toISOString(), offsetSec: OFFSET, anchors: { 2: EXP.sections[2].startSec }, metronome: false };
    });
    const { browser, page, errors } = await open(profile);
    await importJson(page, f);
    await openSong(page);
    await page.setInputFiles('#audio-reload', WAV);
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
    await sleep(300);
    // long press on the Strofa header starts the loop
    const head = page.locator('.sec-head[data-sec="1"]');
    await head.scrollIntoViewIfNeeded();
    const hb = await head.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x + 20, y: hb.y + hb.height / 2 }] });
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.__gapp.player.state === 'playing' || window.__gapp.player.state === 'counting');
    await sleep(1500);
    const loop = await page.$eval('#pp-loop', (b) => ({ hidden: b.hidden, t: b.textContent, r: b.getBoundingClientRect().width }));
    rec('R7 loop active: "🔁 Strofa" in the panel', !loop.hidden && /🔁 Strofa/.test(loop.t), JSON.stringify(loop));
    const clickIcon = await page.$eval('#btn-click-icon', (b) => ({ vis: b.getBoundingClientRect().width > 0 && !b.closest('[hidden]'), t: b.textContent, pressed: b.getAttribute('aria-pressed') }));
    rec('R7 click icon visible without opening "⋯"', clickIcon.vis && (clickIcon.t === '🔕' || clickIcon.t === '🔔'), JSON.stringify(clickIcon));
    const bpmTxt = await page.innerText('#pp-bpm');
    rec('R7 effective tempo shown with "≈" (sheet 100, the stretch Intro+Strofa is scaled as a whole)', /^♩ ?≈ ?9[5-8]/.test(bpmTxt), bpmTxt);
    await shot(page, 'panel-loop');
    await page.click('#btn-click-icon');
    rec('R7 tap on the click icon turns the click on', (await page.$eval('#btn-click-icon', (b) => b.textContent)) === '🔔' && (await page.$eval('#btn-metro', (b) => b.getAttribute('aria-pressed'))) === 'true');
    await shot(page, 'panel-click-on');
    await page.click('#pp-loop');
    rec('R7 tap on the loop badge leaves the loop', await page.$eval('#pp-loop', (b) => b.hidden) && (await page.$$('.loop-x')).length === 0);
    const ct = await page.evaluate(() => window.__gapp.audioEl.currentTime);
    await sleep(8000);
    const ct2 = await page.evaluate(() => window.__gapp.audioEl.currentTime);
    rec('R7 after leaving the loop the audio goes on past the section', ct2 > ct + 5, `${ct.toFixed(1)} -> ${ct2.toFixed(1)}`);
    rec('R7 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }
}

function info(t) { console.log(`INFO [${dev}] ${t}`); }

(async () => {
  for (const [k, p] of Object.entries(PROFILES)) {
    if (onlyDev && k !== onlyDev) continue;
    await run(k, p);
  }
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
