// Round 10 tester, B: quick nudge (long press on a chord, section nudge, limits, undo, reload, library export/import,
// conflicts, gestures with real touch events through CDP). Works on the synthetic song of round10-tester-make.mjs; with
// "real" on the real song (counts only, never text).
// Run: node scripts/build.mjs && node test/e2e/round10-tester-make.mjs && node test/e2e/round10-tester-nudge.cjs <SE|13> <flow|limits|gesture|conflict|all>
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const OUT = path.join(ROOT, 'test-artifacts', 'round-10');
const SONG = path.join(OUT, 'synth', 'r10-song.json');
const MP3 = path.join(OUT, 'synth', 'r10.mp3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const mode = process.argv[3] || 'all';
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'], 320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[dev]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', async (d) => { info('dialog', `"${d.message().slice(0, 70)}"`); await d.accept(); });
  await page.addInitScript(() => {
    window.__clicks = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { const o = orig.call(this); const st = o.start.bind(o); o.start = (when) => { window.__clicks.push([when, o.frequency.value, this.currentTime]); return st(when); }; return o; };
  });
  await page.goto(URL);
  const cdp = await ctx.newCDPSession(page);
  return { browser, page, errors, cdp };
}
async function loadSynth(page) {
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
}
async function syncAndClose(page) {
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
}
const closeSync = async (page) => { await page.click('#as-accept').catch(() => {}); await page.click('#sync-close'); await page.waitForSelector('#btn-play'); };
const al = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
const tlOf = (page) => page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => ({ s: e.startSec, d: e.durSec, b: e.beats, si: e.sectionIndex, sk: !!e.skipped })), beats: window.__gapp.timeline.beats.map((b) => [b.timeSec, b.eventIndex]) }));
async function longPress(page, cdp, sel, ms = 700, idx = 0, safe = true) {
  const loc = page.locator(sel).nth(idx); await loc.scrollIntoViewIfNeeded(); await sleep(300);
  if (safe) { const b0 = await loc.boundingBox(); await page.evaluate((d) => window.scrollBy(0, d), b0.y - 160); await sleep(300); }
  const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}
const chordSel = (j) => `.ch[data-ref]`; // chords in reading order
async function chordRefOf(page, j) { return page.evaluate((j) => window.__gapp.timeline.events[j].ref, j); }
const tap = async (page, sel) => { await page.locator(sel).first().tap(); await sleep(120); };

async function flow() {
  const { browser, page, errors, cdp } = await open();
  await loadSynth(page); await syncAndClose(page); await closeSync(page);
  const A0 = await al(page); const T0 = await tlOf(page);
  info('F0', `events ${A0.eventStartSec.length}, section bpm ${A0.sections.map((s) => (s.bpm === null ? 'free' : s.bpm.toFixed(0))).join(' ')}, states ${A0.sections.map((s) => (s.verified ? 'V' : s.confidence >= .75 ? 'g' : s.confidence >= .5 ? 'y' : 'r')).join('')}`);
  // pick a chord in section 2 ("Mix A"), 4th event (a 4-quarter chord)
  const j = 15; // 'Mix A' third-to-... any stable chord in the middle
  const ref = await chordRefOf(page, j);
  const sel = `.ch[data-ref="${ref}"]`;
  // --- stopped, long press: the sheet must open (alignment active). If the player is stopped, the audio player is not in charge
  await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing');
  await page.click('#btn-play'); // pause
  await sleep(300);
  await longPress(page, cdp, sel);
  const opened = await page.locator('#nudge-time').count();
  rec('B1 long press on a chord opens the sheet (touch, 700 ms)', opened === 1, await page.locator('#nudge-time').textContent().catch(() => ''));
  await page.screenshot({ path: path.join(OUT, `nudge-${dev}-sheet.png`) });
  const dlgs = await page.locator('.sheet').count();
  rec('B1b after the release only one sheet is open (no chord diagram on top)', dlgs === 1, `sheets ${dlgs}`);
  const st = await page.evaluate(() => window.__gapp.player.state);
  info('B1c', `player state after the long press: ${st}`);
  const ok1 = await page.locator('#nudge-time').count();
  if (!ok1) { await browser.close(); return; }
  const A0u = await al(page);
  info('B1d', `alignment changed by merely releasing the finger after the long press: ${A0u.eventStartSec.filter((t, i) => t !== A0.eventStartSec[i]).length} chord time(s) (the release lands on a sheet button)`);
  // scope: only this chord, +0.25
  await tap(page, '.nudge-sheet [data-s="0.25"]');
  let A1 = await al(page);
  info('B2-dbg', `msg after +0,25: "${await page.locator('#nudge-msg').textContent()}", t[j] ${A1.eventStartSec[j]} (was ${A0.eventStartSec[j]}), sheets ${await page.locator('.sheet').count()}`);
  const dt = A1.eventStartSec.map((t, i) => Math.round((t - A0u.eventStartSec[i]) * 1000));
  rec('B2 "Solo questo accordo" +0,25: only this chord moves, by 250 ms', dt.every((d, i) => (i === j ? d === 250 : d === 0)), JSON.stringify(dt.map((d, i) => (d ? [i, d] : null)).filter(Boolean)));
  await tap(page, '.nudge-sheet [data-s="-0.05"]');
  A1 = await al(page);
  rec('B2b then -0,05: 200 ms in total', Math.round((A1.eventStartSec[j] - A0u.eventStartSec[j]) * 1000) === 200, `${Math.round((A1.eventStartSec[j] - A0u.eventStartSec[j]) * 1000)}`);
  const sec = A0.sections.length; // section of j
  const T1 = await tlOf(page); const si = T0.ev[j].si;
  rec('B2c the section becomes verified', A1.sections[si].verified === true);
  // timeline / clicks follow
  const evBefore = T0.ev[j - 1], evAfterT = T1.ev[j - 1];
  info('B2d', `previous chord: dur ${evBefore.d.toFixed(3)} -> ${evAfterT.d.toFixed(3)} s, beats ${evBefore.b} -> ${evAfterT.b}; nudged chord: dur ${T0.ev[j].d.toFixed(3)} -> ${T1.ev[j].d.toFixed(3)}, beats ${T0.ev[j].b} -> ${T1.ev[j].b}`);
  // following scope
  await page.locator('.nudge-sheet input[value="following"]').check();
  await tap(page, '.nudge-sheet [data-s="0.25"]');
  const A2 = await al(page);
  const si_idx = A2.eventStartSec.map((_, i) => i).filter((i) => T0.ev[i].si === si && i >= j);
  const moved = A2.eventStartSec.map((t, i) => Math.round((t - A1.eventStartSec[i]) * 1000));
  rec('B3 "Questo e i seguenti": the chords of the section from j on move +250 ms, no other', moved.every((d, i) => (si_idx.includes(i) ? d === 250 : d === 0)), JSON.stringify(moved.map((d, i) => (d ? [i, d] : null)).filter(Boolean)).slice(0, 200));
  // the first chord of the next section gets a longer-or-shorter previous chord; check ordering
  rec('B3b times strictly increasing', A2.eventStartSec.every((t, i) => i === 0 || t > A2.eventStartSec[i - 1]));
  // undo twice
  for (let k = 0; k < 6; k++) { if (await page.locator('#nudge-undo').isDisabled()) break; await tap(page, '#nudge-undo'); }
  const A3 = await al(page);
  rec('B4 undoing everything restores the original times exactly', JSON.stringify(A3.eventStartSec) === JSON.stringify(A0.eventStartSec));
  rec('B4b undo disabled when nothing to undo', await page.locator('#nudge-undo').isDisabled());
  rec('B4c the section is back to its former state (not left "verificata" by an undone nudge)', A3.sections[si].verified === A0.sections[si].verified, `before ${A0.sections[si].verified} after ${A3.sections[si].verified}`);
  // listen from here
  await tap(page, '.nudge-sheet [data-s="0.25"]'); // a change to hear
  const tj = (await al(page)).eventStartSec[j];
  await page.locator('#nudge-listen').tap();
  await sleep(600);
  const t1 = await page.evaluate(() => window.__gapp.audioEl.currentTime);
  info('B5', `"Ascolta da qui": chord at ${tj.toFixed(2)} s; media time 0.6 s after the tap ${t1.toFixed(2)} (expected ~${(tj - 2 + 0.6).toFixed(2)})`);
  rec('B5 listening starts 2 s before the chord', Math.abs(t1 - (tj - 2 + 0.6)) < 0.5);
  await sleep(3600);
  const st2 = await page.evaluate(() => ({ s: window.__gapp.player.state, t: window.__gapp.audioEl.currentTime }));
  rec('B5b it stops by itself ~2 s after the chord', st2.s !== 'playing' && Math.abs(st2.t - (tj + 2)) < 0.7, `${st2.s} at ${st2.t.toFixed(2)} (chord+2 = ${(tj + 2).toFixed(2)})`);
  await tap(page, '#nudge-close');
  // persists after reload
  const Ab = await al(page);
  await page.reload(); await page.waitForSelector('.song-row', { timeout: 5000 }).catch(() => {});
  const Ar = await page.evaluate(() => { const k = Object.keys(localStorage).find((k) => k.startsWith('gapp.song.')); return JSON.parse(localStorage.getItem(k)).audio.alignment; });
  rec('B6 the nudge persists after reload', JSON.stringify(Ar.eventStartSec) === JSON.stringify(Ab.eventStartSec));
  rec('Bz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

// ---------------------------------------------------------------- limits: 20 taps of -0,25 on a chord, first/last chord, next to a gap / skipped section
async function openSheetOn(page, cdp, j, scopeFollowing = false) {
  const ref = await chordRefOf(page, j);
  await longPress(page, cdp, `.ch[data-ref="${ref}"]`);
  if (!(await page.locator('#nudge-time').count())) throw new Error('sheet did not open for chord ' + j);
  if (scopeFollowing) await page.locator('.nudge-sheet input[value="following"]').check();
}
const minDur = (A) => { const present = A.eventStartSec.map((t, i) => i).filter((i) => !(A.skipped || []).includes(i)); let m = Infinity; for (let k = 1; k < present.length; k++) m = Math.min(m, A.eventStartSec[present[k]] - A.eventStartSec[present[k - 1]]); return m; };
async function limits() {
  const { browser, page, errors, cdp } = await open();
  await loadSynth(page); await syncAndClose(page); await closeSync(page);
  await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing'); await page.click('#btn-play'); await sleep(300);
  const A0 = await al(page); const N = A0.eventStartSec.length;
  for (const [label, j] of [['middle chord', 15], ['first chord of the song', 0], ['last chord of the song', N - 1]]) {
    for (const [dir, d] of [['-0.25', -0.25], ['0.25', 0.25]]) {
      await openSheetOn(page, cdp, j);
      const before = (await al(page)).eventStartSec;
      for (let k = 0; k < 20; k++) await page.locator(`.nudge-sheet [data-s="${dir}"]`).tap({ timeout: 3000 });
      const A = await al(page);
      const mg = await page.locator('#nudge-msg').textContent();
      const dtot = A.eventStartSec[j] - before[j];
      rec(`L1 ${label}, 20 x ${dir}: order kept, no chord under 0,1 s`, minDur(A) >= 0.0999 && A.eventStartSec.every((t, i) => i === 0 || t >= A.eventStartSec[i - 1]), `moved ${dtot.toFixed(2)} s, min duration ${minDur(A).toFixed(3)} s, end ${A.endSec.toFixed(2)}, message "${mg}"`);
      if (j === 0 && d < 0) rec('L1b first chord can go below 0 s?', A.eventStartSec[0] >= 0, `t0 ${A.eventStartSec[0]}`);
      if (j === N - 1 && d > 0) info('L1c', `last chord moved to ${A.eventStartSec[j].toFixed(2)} s, audio duration ${(await page.evaluate(() => window.__gapp.audioEl.duration)).toFixed(2)} s`);
      // timeline: beats of the chords next to it
      const T = await tlOf(page);
      const worst = T.ev.map((e, i) => ({ i, rate: e.d > 0 ? e.b / e.d : 0, b: e.b, d: e.d })).sort((a, b) => b.rate - a.rate)[0];
      info('L1d', `fastest tick rate after the nudge: chord ${worst.i}, ${worst.b} ticks in ${worst.d.toFixed(3)} s (${(worst.rate).toFixed(1)} ticks/s)`);
      // undo everything
      for (let k = 0; k < 25; k++) { if (await page.locator('#nudge-undo').isDisabled()) break; await page.locator('#nudge-undo').tap(); }
      await page.locator('#nudge-close').tap(); await sleep(150);
      const Ar = await al(page);
      rec(`L2 undo of 20 taps (${label} ${dir}) restores`, JSON.stringify(Ar.eventStartSec) === JSON.stringify(A0.eventStartSec));
    }
  }
  rec('Lz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

// ---------------------------------------------------------------- gesture: release over a button, scroll with the finger, tiny moves, header loop
async function touch(cdp, pts) { await cdp.send('Input.dispatchTouchEvent', pts); }
async function gesture() {
  const { browser, page, errors, cdp } = await open();
  await loadSynth(page); await syncAndClose(page); await closeSync(page);
  const A0 = await al(page);
  const j = 15; const ref = await chordRefOf(page, j); const sel = `.ch[data-ref="${ref}"]`;
  const hook = () => page.evaluate(() => { window.__ev = []; for (const t of ['click', 'contextmenu', 'pointercancel']) document.addEventListener(t, (e) => window.__ev.push(t + ':' + (typeof e.target.className === 'string' ? e.target.className : e.target.tagName) + (e.target.dataset && e.target.dataset.s ? '[' + e.target.dataset.s + ']' : '')), true); });
  await hook();
  // 1. where do the sheet buttons appear? open once, read their boxes, close
  const lp = async (x, y, ms = 700) => { await touch(cdp, { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(ms); await touch(cdp, { type: 'touchEnd', touchPoints: [] }); await sleep(300); };
  await page.locator(sel).scrollIntoViewIfNeeded();
  let b = await page.locator(sel).boundingBox();
  await lp(b.x + b.width / 2, b.y + b.height / 2);
  const boxes = await page.locator('.nudge-sheet button').evaluateAll((e) => e.map((x) => { const r = x.getBoundingClientRect(); return { id: x.id || x.dataset.s, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  await page.locator('#nudge-close').tap(); await sleep(200);
  info('G0', `sheet buttons (viewport ${JSON.stringify(PROFILES[dev].viewport)}): ${boxes.map((x) => `${x.id}@${Math.round(x.x)},${Math.round(x.y)} ${Math.round(x.w)}x${Math.round(x.h)}`).join(' | ')}`);
  const A1 = await al(page);
  info('G0b', `events during the first long press: ${await page.evaluate(() => window.__ev.splice(0).join(' '))}; times changed: ${A1.eventStartSec.filter((t, i) => t !== A0.eventStartSec[i]).length}`);
  // 2. long press on a chord that lies exactly under each button: does the release trigger it?
  const seenUnder = new Set();
  for (const bx of boxes) {
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
    // scroll so that the chord's centre is at the button's centre y
    const cb = await page.locator(sel).boundingBox();
    const targetY = bx.y + bx.h / 2; await page.evaluate((d) => window.scrollBy(0, d), cb.y + cb.height / 2 - targetY); await sleep(400);
    const c2 = await page.locator(sel).boundingBox();
    // the chord is narrow: aim at the chord's x, which may differ from the button's: report both
    const x = c2.x + c2.width / 2, y = c2.y + c2.height / 2;
    const under = boxes.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest && e.closest('.ch')); }, [x, y]);
    if (!under || !hit || seenUnder.has(under.id)) continue;
    seenUnder.add(under.id);
    const before = (await al(page)).eventStartSec.slice();
    await lp(x, y);
    const after = (await al(page)).eventStartSec;
    const changed = after.map((t, i) => (t !== before[i] ? i : -1)).filter((i) => i >= 0);
    const evs = await page.evaluate(() => window.__ev.splice(0).join(' '));
    const open = await page.locator('#nudge-time').count();
    info('G1', `finger ends on "${under.id}": sheet open ${open}, times changed ${changed.length}, events [${evs}]`);
    rec(`G1 ${under.id}: releasing the finger over a sheet button does nothing`, changed.length === 0 && open === 1, '');
    if (open) { await page.locator('#nudge-close').tap().catch(() => {}); await sleep(200); }
    // restore the original for the next iteration
    await page.evaluate((o) => { const k = Object.keys(localStorage).find((k) => k.startsWith('gapp.song.')); const s = JSON.parse(localStorage.getItem(k)); s.audio.alignment.eventStartSec = o; localStorage.setItem(k, JSON.stringify(s)); }, A0.eventStartSec);
    await page.reload(); await page.waitForSelector('.song-row', { timeout: 5000 }).catch(() => {}); await page.click('.song-row').catch(() => {}); await page.waitForSelector('#btn-play'); await hook();
  }
  // 3. scrolling with the finger that starts on a chord: the page scrolls, no sheet
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await page.locator(sel).scrollIntoViewIfNeeded(); b = await page.locator(sel).boundingBox();
  const y0 = b.y + b.height / 2; const x0 = b.x + b.width / 2; const sy0 = await page.evaluate(() => window.scrollY);
  await touch(cdp, { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let k = 1; k <= 10; k++) { await sleep(60); await touch(cdp, { type: 'touchMove', touchPoints: [{ x: x0, y: y0 - k * 12 }] }); }
  await touch(cdp, { type: 'touchEnd', touchPoints: [] }); await sleep(500);
  const sy1 = await page.evaluate(() => window.scrollY);
  rec('G2 finger scroll that starts on a chord scrolls the page and opens no sheet', sy1 - sy0 > 40 && (await page.locator('#nudge-time').count()) === 0, `scrolled ${Math.round(sy1 - sy0)} px`);
  // 4. slow scroll: finger down 300 ms then slow move: a sheet must not appear
  await page.locator(sel).scrollIntoViewIfNeeded(); b = await page.locator(sel).boundingBox();
  await touch(cdp, { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] }); await sleep(420);
  await touch(cdp, { type: 'touchMove', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 - 6 }] }); await sleep(300);
  await touch(cdp, { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  rec('G3 pause then a 6 px move before 500 ms: no sheet', (await page.locator('#nudge-time').count()) === 0);
  // 5. hold 700 ms with 3 px of finger jitter (a real finger never stays still)
  await page.locator(sel).scrollIntoViewIfNeeded(); b = await page.locator(sel).boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await touch(cdp, { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (const d of [1, 2, 3, 2, 1]) { await sleep(130); await touch(cdp, { type: 'touchMove', touchPoints: [{ x: cx + d, y: cy + (d % 2) }] }); }
  await sleep(200); await touch(cdp, { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  info('G4', `700 ms hold with 1-3 px jitter: sheet ${(await page.locator('#nudge-time').count()) ? 'OPENED' : 'did NOT open (pointermove cancels the long press)'}`);
  if (await page.locator('#nudge-time').count()) await page.locator('#nudge-close').tap();
  // 6. user-select / callout on a chord
  const css = await page.evaluate((sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return { us: c.userSelect || c.webkitUserSelect, callout: c.webkitTouchCallout, ta: c.touchAction }; }, sel);
  info('G5', `chord element CSS: user-select ${css.us}, -webkit-touch-callout ${css.callout}, touch-action ${css.ta} (on a real iPhone a long press on selectable text selects it / shows the callout)`);
  rec('Gz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

// ---------------------------------------------------------------- conflict: nudge vs re-sync, "Sposta tutto", manual anchors, "Correggi a orecchio"; section nudge from header and from the sync row
async function conflict() {
  const { browser, page, errors, cdp } = await open();
  await loadSynth(page); await syncAndClose(page);
  // from the sync screen: tap the text of a row (the only entry point there)
  const A0 = await al(page);
  await page.screenshot({ path: path.join(OUT, `nudge-${dev}-syncrows.png`), fullPage: false });
  const row = page.locator('.as-row[data-sec="1"] [data-act="nudge"]');
  info('C0', `sync-row nudge entry: element ${await row.evaluate((e) => e.tagName + '.' + e.className)}, aria "${await row.getAttribute('aria-label')}", visible hint text in the row: "${(await row.innerText()).replace(/\s+/g, ' ')}", cursor ${await row.evaluate((e) => getComputedStyle(e).cursor)}`);
  await row.tap(); await page.waitForSelector('#nudge-close');
  await page.screenshot({ path: path.join(OUT, `nudge-${dev}-section-sheet.png`) });
  await page.locator('.nudge-sheet [data-s="-0.05"]').tap(); await sleep(150);
  const A1 = await al(page);
  const nmoved = A1.eventStartSec.filter((t, i) => Math.abs(t - A0.eventStartSec[i] + 0.05) < 1e-6).length;
  rec('X1 section nudge from the sync row: all 12 chords of the section move -0,05 s, no others', nmoved === 12 && A1.eventStartSec.filter((t, i) => t !== A0.eventStartSec[i]).length === 12, `${nmoved}`);
  await page.locator('#nudge-close').tap(); await sleep(150);
  info('C1', `row state after the nudge: ${await page.locator('.as-row[data-sec="1"]').getAttribute('data-state')}, counts "${await page.innerText('#as-counts')}"`);
  // re-sync after a nudge: does it ask?
  let dlgMsg = null;
  page.removeAllListeners('dialog'); page.on('dialog', async (d) => { dlgMsg = d.message(); await d.dismiss(); });
  await page.locator('#as-redo').tap().catch(() => {}); await sleep(600);
  rec('X2 "Rifai" after a nudge asks before losing it', !!dlgMsg, dlgMsg ? `"${dlgMsg.slice(0, 110)}"` : 'no confirmation');
  const A2 = await al(page);
  rec('X2b dismissing the question keeps the nudged times', JSON.stringify(A2.eventStartSec) === JSON.stringify(A1.eventStartSec));
  page.removeAllListeners('dialog'); page.on('dialog', (d) => d.accept());
  // "Sposta tutto" +100 then nudge a chord
  await page.locator('.as-shift [data-ms="100"]').tap(); await sleep(150);
  const A3 = await al(page);
  info('X3', `shiftSec after "Sposta tutto +100": ${A3.shiftSec}`);
  await closeSync(page);
  await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing'); await page.click('#btn-play'); await sleep(300);
  const j = 15;
  const T3 = await tlOf(page);
  await openSheetOn(page, cdp, j);
  const shown = await page.locator('#nudge-time').textContent();
  await page.locator('.nudge-sheet [data-s="0.25"]').tap(); await sleep(150);
  const T4 = await tlOf(page); const A4 = await al(page);
  rec('X3 with "Sposta tutto" active a nudge of +0,25 moves the highlight by exactly 250 ms', Math.abs(T4.ev[j].s - T3.ev[j].s - 0.25) < 0.002, `timeline start ${T3.ev[j].s.toFixed(3)} -> ${T4.ev[j].s.toFixed(3)}; sheet shows "${shown}"; stored ${A4.eventStartSec[j].toFixed(3)} shift ${A4.shiftSec}`);
  await page.locator('#nudge-close').tap();
  // anchors: pin section 2 (index 2, "Mix B") at a time, then nudge a chord inside it
  await page.evaluate(() => { const k = Object.keys(localStorage).find((k) => k.startsWith('gapp.song.')); const s = JSON.parse(localStorage.getItem(k)); s.audio.anchors = { 2: 40.6 }; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('#btn-play');
  await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing'); await page.click('#btn-play'); await sleep(300);
  const nb0 = await page.locator('.sec-nudge').count();
  rec('H1 the header buttons ⇄ exist right after reopening a synced song (no other action)', nb0 > 0, `${nb0} of ${await page.locator('.sec-head').count()} section headers`);
  await page.click('#btn-collapse'); await sleep(300); await page.click('#btn-collapse'); await sleep(300);
  info('H1b', `after toggling "collapse repeats" twice (forces a rebuild of the sheet): ${await page.locator('.sec-nudge').count()} buttons`);
  const jj = 22; const Ta = await tlOf(page);
  info('X4', `anchor on section 3 at 40.6 s: its chords start at ${Ta.ev.filter((e) => e.si === 2).slice(0, 3).map((e) => e.s.toFixed(2)).join(', ')} ...`);
  await openSheetOn(page, cdp, jj);
  const shownA = await page.locator('#nudge-time').textContent();
  await page.locator('.nudge-sheet [data-s="0.25"]').tap(); await sleep(150);
  const Tb = await tlOf(page);
  const mv = Tb.ev.map((e, i) => Math.round((e.s - Ta.ev[i].s) * 1000));
  rec('X4 an anchored section: +0,25 on a chord changes the highlighted time of that chord by 250 ms', Math.abs(mv[jj] - 250) < 25, `sheet says "${shownA}"; timeline moves ${JSON.stringify(mv.map((d, i) => (d ? [i, d] : null)).filter(Boolean)).slice(0, 160)}`);
  await page.locator('#nudge-close').tap();
  // section nudge from the header with the anchor: does the section move?
  const hb = page.locator('.sec-nudge[data-sec="2"]'); await hb.scrollIntoViewIfNeeded(); await sleep(300);
  await hb.tap(); await page.waitForSelector('#nudge-close');
  const Tc0 = await tlOf(page);
  await page.locator('.nudge-sheet [data-s="0.25"]').tap(); await sleep(150);
  const Tc1 = await tlOf(page);
  const mv2 = Tc1.ev.map((e, i) => Math.round((e.s - Tc0.ev[i].s) * 1000)).filter(Boolean);
  rec('X5 anchored section: nudging the whole section by +0,25 moves it (anchors must not swallow the nudge)', mv2.length >= 10 && Math.abs(mv2[0] - 250) < 5, `${mv2.length} chords moved, first by ${mv2[0]} ms`);
  await page.locator('#nudge-close').tap();
  rec('Xz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

// ---------------------------------------------------------------- corr: nudge, then "Correggi a orecchio" (partial) on the same section
async function corr() {
  const { browser, page, errors } = await open();
  await loadSynth(page); await syncAndClose(page);
  const A0 = await al(page);
  const idx = A0.eventStartSec.map((_, i) => i); const si = 1; const secIdx = idx.slice(6, 18); // "Mix A": events 6..17
  await page.locator(`.as-row[data-sec="${si}"] [data-act="nudge"]`).tap(); await page.waitForSelector('#nudge-close');
  await page.locator('.nudge-sheet [data-s="0.25"]').tap(); await sleep(120); await page.locator('.nudge-sheet [data-s="0.25"]').tap(); await sleep(120);
  await page.locator('#nudge-close').tap(); await sleep(150);
  const A1 = await al(page);
  rec('Y0 nudge +0,5 s on the section', secIdx.every((j) => Math.abs(A1.eventStartSec[j] - A0.eventStartSec[j] - 0.5) < 1e-6));
  await page.locator(`.as-row[data-sec="${si}"] [data-act="correct"]`).tap(); await page.waitForSelector('#corr-tap');
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  const tb = await page.locator('#corr-tap').boundingBox(); const cx = tb.x + tb.width / 2, cy = tb.y + tb.height / 2;
  const taps = [];
  for (let k = 0; k < 4; k++) {
    const target = A0.eventStartSec[secIdx[k]]; // the true time (the nudge moved it 0.5 s later: the person taps at the true change)
    await page.waitForFunction((t) => window.__gappSync.player.currentTime() >= t, target - 0.02, { polling: 'raf', timeout: 60000 });
    taps.push(await page.evaluate(() => window.__gappSync.player.currentTime())); await page.touchscreen.tap(cx, cy);
  }
  await page.locator('#corr-save').tap(); await page.waitForSelector('#corr-tap', { state: 'detached' });
  const A2 = await al(page);
  const e = secIdx.map((j) => Math.round((A2.eventStartSec[j] - A1.eventStartSec[j]) * 1000));
  info('Y1', `after the partial correction (4 taps near the true times): per-chord change vs the nudged times (ms): ${JSON.stringify(e)}; section verified: ${A2.sections[si].verified}`);
  rec('Y1 the 4 tapped chords went back near the true time, the other 8 keep the nudged time', e.slice(0, 4).every((d) => d < -350) && e.slice(4).every((d) => d === 0), '');
  rec('Y2 times strictly increasing after the mix', A2.eventStartSec.every((t, i) => i === 0 || t > A2.eventStartSec[i - 1]));
  info('Y3', `row state ${await page.locator(`.as-row[data-sec="${si}"]`).getAttribute('data-state')}; message "${(await page.locator('#as-msg, .as-msg, #sync-msg').first().innerText().catch(() => '')).slice(0, 140)}"`);
  rec('Yz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

const run = { flow, limits, gesture, conflict, corr };
(async () => {
  const names = mode === 'all' ? Object.keys(run) : [mode];
  for (const n of names) { console.log('==', n); await run[n](); }
  console.log(fails ? `${fails} FAIL` : 'all PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
