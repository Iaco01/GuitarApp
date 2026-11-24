// Round 2 tester, browser part 2: D (playback UI) and E (durations). Run: npm run build && node test/e2e/round2-tester-ui2.cjs
// Needs the git-ignored real file. Screenshots in test-artifacts/round-2/ (not committed). Prints no song text.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const only = process.argv[2] || '';
const W360 = { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } };
const song = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))));
const gstate = (page) => page.evaluate(() => ({ s: window.__gapp.player.state, p: window.__gapp.player.timeSec, e: window.__gapp.player.eventIndex }));

const PATCH = () => {
  window.__osc = [];
  const AC = window.AudioContext;
  if (AC) {
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () { const o = orig.call(this); const st = o.start.bind(o); o.start = (t) => { window.__osc.push({ when: t, freq: o.frequency.value, now: this.currentTime }); return st(t); }; return o; };
  }
  window.__wl = { req: 0, rel: 0, active: 0, delay: 0 };
  if (!location.search.includes('nowl')) {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: (type) => new Promise((res) => setTimeout(() => {
      window.__wl.req++; window.__wl.active++;
      const ls = [];
      res({ released: false, addEventListener: (n, f) => ls.push(f), release() { window.__wl.rel++; window.__wl.active--; ls.forEach((f) => f()); return Promise.resolve(); } });
    }, window.__wl.delay)) } });
  } else {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
  }
};

async function open(prof = W360, query = '') {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.addInitScript(PATCH);
  await page.goto(URL + query);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title');
  return { browser, page, errors, ctx };
}
const tlOf = (page) => page.evaluate(() => ({ events: window.__gapp.timeline.events.map((e) => ({ s: e.startSec, ref: e.ref, sec: e.sectionIndex, beats: e.beats })), sections: window.__gapp.timeline.sections, total: window.__gapp.timeline.totalSec, speed: window.__gapp.timeline.speed }));

async function startFrom(page, tl, eventIndex) {
  await page.click('#btn-play');
  await page.waitForFunction(() => ['counting', 'playing'].includes(window.__gapp.player.state));
  const ref = tl.events[eventIndex].ref;
  const loc = page.locator(`.ch[data-ref="${ref}"]`).first();
  await loc.scrollIntoViewIfNeeded();
  await loc.click();
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
}

(async () => {
  // =========================================================== D
  if (!only || only === 'D') {
    const { browser, page, errors } = await open(W360);
    const tl = await tlOf(page);
    // D1/D2: panel + highlighted chord mid Verse 1
    await startFrom(page, tl, 4);
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, 't-d-play-verse1.png') });
    const pn = await page.evaluate(() => {
      const t = (id) => (document.getElementById(id) || {}).textContent;
      const cur = document.querySelector('.ch.cur'); const nx = document.querySelector('.ch.next');
      const cs = cur && getComputedStyle(cur);
      const ns = nx && getComputedStyle(nx);
      return { cur: t('pp-current'), next: t('pp-next'), left: t('pp-left'), bpm: t('pp-bpm'), dots: document.querySelectorAll('.pp-dot').length, dotOn: document.querySelectorAll('.pp-dot.on').length, cells: document.querySelectorAll('.pp-cell').length, cellNow: document.querySelectorAll('.pp-cell.now').length, curBg: cs && cs.backgroundColor, curP: cur && cur.style.getPropertyValue('--p'), nextBorder: ns && ns.borderStyle + ' ' + ns.borderTopWidth, curChordName: cur && cur.getAttribute('data-chord'), hasCur: !!cur, hasNext: !!nx, nextText: nx && nx.textContent };
    });
    info('D1-D2-panel-verse1', JSON.stringify(pn));
    rec('D2-panel-contents-verse1', pn.cells === 16 && pn.dots === 4 && pn.dotOn === 1 && /62/.test(pn.bpm) && pn.hasCur && pn.hasNext && pn.cellNow === 1 && pn.cur === pn.curChordName, `cells ${pn.cells} (want 16), dots ${pn.dots}, on ${pn.dotOn}, bpm "${pn.bpm}", badge "${pn.left}"`);
    rec('D1-next-chord-bordered-with-badge', /dashed|solid/.test(pn.nextBorder) && pn.nextBorder.indexOf('0px') === -1 && /^\d+$/.test(pn.left), `next border ${pn.nextBorder}, badge in panel "${pn.left}"`);
    const bt = await page.evaluate(() => { const nx = document.querySelector('.ch.next'); return nx ? [...nx.querySelectorAll('*')].map((e) => e.className) : null; });
    info('D1-next-in-text-has-badge-element', JSON.stringify(bt));
    // progress bar fills
    const p1 = await page.evaluate(() => parseFloat(document.querySelector('.pp-cur-fill').style.width) || 0);
    await sleep(800);
    const p2 = await page.evaluate(() => parseFloat(document.querySelector('.pp-cur-fill').style.width) || 0);
    info('D1-progress-bar', `${p1}% -> ${p2}% (same chord unless it changed)`);
    // D3: current line stays in the top third; sample for 35 s across the verse
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 35000) {
      const r = await page.evaluate(() => { const c = document.querySelector('.ch.cur'); if (!c) return null; const l = c.closest('.line').getBoundingClientRect(); return { top: l.top, bottom: l.bottom, vh: window.innerHeight, y: window.scrollY }; });
      if (r) samples.push(r);
      await sleep(250);
    }
    const fr = samples.map((s) => s.top / s.vh);
    const inThird = samples.filter((s) => s.top >= 0 && s.bottom <= s.vh / 3 + 60).length;
    const visible = samples.filter((s) => s.top >= 0 && s.bottom <= s.vh).length;
    rec('D3-current-line-visible-and-upper', visible === samples.length && Math.max(...fr) < 0.45, `${samples.length} samples; line top/vh min ${Math.min(...fr).toFixed(2)} max ${Math.max(...fr).toFixed(2)}; fully visible ${visible}/${samples.length}; inside top third (+60px) ${inThird}`);
    // manual scroll pause
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 700);
    await sleep(900); // let the wheel's own smooth scroll settle
    const yA = await page.evaluate(() => window.scrollY);
    await sleep(2500);
    const yB = await page.evaluate(() => window.scrollY);
    rec('D3-manual-scroll-pauses-auto', Math.abs(yB - yA) < 5, `y ${yA.toFixed(0)} -> ${yB.toFixed(0)} after 2.5 s`);
    // wait for the pause to end and the next line change
    let resumed = false; const t1 = Date.now(); const yPause = yB;
    while (Date.now() - t1 < 20000) { await sleep(300); const y = await page.evaluate(() => window.scrollY); if (Math.abs(y - yPause) > 50) { resumed = true; info('D3-resume-after', ((Date.now() - t1 + 2500) / 1000).toFixed(1) + ' s after the wheel'); break; } }
    rec('D3-auto-scroll-resumes', resumed, '');
    await page.click('#btn-stop');
    // D4: pause / resume continuity
    await startFrom(page, tl, 10);
    await sleep(2500);
    await page.click('#btn-play'); // pause
    const g1 = await gstate(page);
    await sleep(600);
    const g1b = await gstate(page);
    await page.click('#btn-play'); // resume with count-in
    await page.waitForFunction(() => window.__gapp.player.state === 'counting' || window.__gapp.player.state === 'playing');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 8000 });
    const g2 = await gstate(page);
    rec('D4-pause-holds-position-and-resume-continues', g1.s === 'paused' && Math.abs(g1.p - g1b.p) < 1e-6 && g2.e >= g1.e && g2.e <= g1.e + 1 && g2.p >= g1.p - 0.05, `paused at ${g1.p.toFixed(2)} (event ${g1.e}); after resume ${g2.p.toFixed(2)} (event ${g2.e})`);
    // speed 50%: timeline doubled
    await page.click('#btn-stop');
    const before = (await tlOf(page));
    for (let i = 0; i < 10; i++) await page.click('#btn-speed-down');
    const lbl = await page.textContent('#pp-speed');
    await page.click('#btn-speed-down'); // clamp
    const lbl2 = await page.textContent('#pp-speed');
    const half = await tlOf(page);
    rec('B3-speed-50-doubles-times-in-app', lbl === '50%' && lbl2 === '50%' && Math.abs(half.total - 2 * before.total) < 1e-6 && Math.abs(half.events[200].s - 2 * before.events[200].s) < 1e-6, `speed ${half.speed}, total ${before.total.toFixed(1)} -> ${half.total.toFixed(1)} s, clamp ${lbl2}`);
    // play at 50% for 12 s: measure real progression
    await startFrom(page, tl, 40);
    const a = await page.evaluate(() => ({ t: performance.now(), p: window.__gapp.player.timeSec, e: window.__gapp.player.eventIndex }));
    await sleep(12000);
    const b = await page.evaluate(() => ({ t: performance.now(), p: window.__gapp.player.timeSec, e: window.__gapp.player.eventIndex }));
    const rate = (b.p - a.p) / ((b.t - a.t) / 1000);
    const evExp = (() => { let r = -1; half.events.forEach((e, i) => { if (e.s <= b.p) r = i; }); return r; })();
    rec('B3-speed-50-realtime-rate', Math.abs(rate - 1) < 0.01 && b.e === evExp, `timeSec rate ${rate.toFixed(4)} s/s on the stretched timeline; event ${b.e} (expected ${evExp}); chord index advanced ${b.e - a.e} in 12 s (at 62 bpm 50%: 1 chord = 7.74 s)`);
    // click spacing at 50%
    const osc = await page.evaluate(() => window.__osc.slice(-6).map((o) => o.when));
    const gaps = osc.slice(1).map((w, i) => w - osc[i]);
    info('B3-click-gaps-at-50%', gaps.map((g) => g.toFixed(4)).join(',') + ' (62 bpm at 50% = 1.9355 s; 96 bpm at 50% = 1.25 s)');
    await page.click('#btn-stop');
    for (let i = 0; i < 10; i++) await page.click('#btn-speed-up');
    // restore 100
    const fin = await page.textContent('#pp-speed');
    info('D4-speed-restored', fin);
    // metronome on/off
    await startFrom(page, tl, 4);
    await page.evaluate(() => { window.__osc.length = 0; });
    await sleep(3000);
    const nOn = await page.evaluate(() => window.__osc.length);
    await page.click('#btn-metro');
    const lblM = await page.textContent('#btn-metro');
    await page.evaluate(() => { window.__osc.length = 0; });
    await sleep(3000);
    const nOff = await page.evaluate(() => window.__osc.length);
    const gm = await gstate(page);
    rec('D4-metronome-toggle', nOn >= 2 && nOff === 0 && gm.s === 'playing', `clicks in 3 s: on ${nOn}, off ${nOff} (${lblM}); clock keeps running (${gm.s})`);
    await page.click('#btn-metro');
    // tap tempo: 8 taps at 500 ms -> 120 on the current section
    const secBefore = (await song(page)).sections.map((s) => s.bpm);
    await page.evaluate(async () => { const b = document.getElementById('btn-tap'); for (let i = 0; i < 8; i++) { b.click(); await new Promise((r) => setTimeout(r, 500)); } });
    const secAfter = await song(page);
    const curSec = (await tlOf(page)).events[(await gstate(page)).e]; // approx
    const changedIdx = secAfter.sections.map((s, i) => (s.bpm !== secBefore[i] ? i : -1)).filter((i) => i >= 0);
    rec('D4-tap-tempo-8-taps-120', changedIdx.length === 1 && secAfter.sections[changedIdx[0]].bpm === 120 && secAfter.sections[changedIdx[0]].bpmSource === 'edited', `sections changed ${changedIdx}, bpm ${changedIdx.map((i) => secAfter.sections[i].bpm)}, source ${changedIdx.map((i) => secAfter.sections[i].bpmSource)}`);
    const gAfterTap = await gstate(page);
    info('D4-playback-continues-after-tap', JSON.stringify(gAfterTap));
    await page.click('#btn-stop');
    await browser.close();
    rec('D7-console-clean', errors.length === 0, errors.join(' | '));
  }

  // ---- D4 tap on chord / loop; D5 collapsed sections ----
  if (!only || only === 'D2') {
    const { browser, page, errors } = await open(W360);
    const tl = await tlOf(page);
    // tap on chord while playing -> restart from there with count-in
    await startFrom(page, tl, 4);
    const target = 20;
    const loc = page.locator(`.ch[data-ref="${tl.events[target].ref}"]`).first();
    await loc.scrollIntoViewIfNeeded();
    await loc.click();
    const gs = await page.evaluate(() => ({ s: window.__gapp.player.state }));
    await sleep(300);
    const gs2 = await gstate(page);
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 8000 });
    const gs3 = await gstate(page);
    rec('D4-tap-chord-restarts-with-count-in', gs2.s === 'counting' && gs3.e === target, `after tap: ${gs2.s}; then playing at event ${gs3.e} (target ${target}), timeSec ${gs3.p.toFixed(2)} vs start ${tl.events[target].s.toFixed(2)}`);
    await page.click('#btn-stop');
    // loop with long press on Chorus header (section 1)
    await page.evaluate(() => window.scrollTo(0, 0));
    const head = page.locator('.sec-head[data-sec="1"] .sec-title');
    await head.scrollIntoViewIfNeeded();
    const bb = await head.boundingBox();
    await page.mouse.move(bb.x + 5, bb.y + 5); await page.mouse.down();
    await sleep(300);
    const early = await page.locator('.sec.looping').count();
    await sleep(500);
    await page.mouse.up();
    await sleep(300);
    rec('D4-loop-needs-long-press', early === 0 && (await page.locator('.sec.looping').count()) === 1 && (await page.locator('.loop-x').count()) === 1, `looping after 300 ms: ${early}; after 800 ms: ${await page.locator('.sec.looping').count()}`);
    const sec1 = tl.sections[1];
    // observe at least 2 wraps: Chorus is 40 s: tap near the end to shorten
    const near = tl.events.filter((e) => e.sec === 1);
    const ref2 = near[near.length - 3].ref;
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 12000 });
    const l2 = page.locator(`.ch[data-ref="${ref2}"]`).first();
    await l2.scrollIntoViewIfNeeded(); await l2.click();
    const seen = []; const tt = Date.now();
    while (Date.now() - tt < 62000) { const g = await gstate(page); if (g.s === 'playing') seen.push(g.p); await sleep(80); }
    let wraps = 0; for (let i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1] - 1) wraps++;
    rec('D4-loop-runs-2+-times-inside-section', wraps >= 2 && seen.every((t) => t >= sec1.startSec - 0.05 && t <= sec1.endSec + 0.05), `${wraps} wraps in 62 s; range ${Math.min(...seen).toFixed(1)}..${Math.max(...seen).toFixed(1)} within ${sec1.startSec.toFixed(1)}..${sec1.endSec.toFixed(1)}`);
    await page.screenshot({ path: path.join(OUT, 't-d-loop.png') });
    // does the loop wrap play a count-in? (decision: no) and does it re-count after exit?
    await page.click('.loop-x');
    await sleep(500);
    const afterX = await gstate(page);
    rec('D4-loop-exit-with-x', (await page.locator('.sec.looping').count()) === 0 && afterX.s === 'playing', `state after x: ${afterX.s}`);
    await page.click('#btn-stop');
    // D5: collapsed sections expand when playback enters them
    const rep = await page.evaluate(() => [...document.querySelectorAll('details.rep')].map((d) => ({ sec: Number(d.getAttribute('data-sec')), open: d.open })));
    info('D5-collapsed-details', JSON.stringify(rep));
    const targetSec = rep[0].sec;
    const prev = tl.events.filter((e) => e.sec === targetSec - 1);
    await startFrom(page, tl, tl.events.indexOf(prev[prev.length - 3]));
    await page.waitForFunction((s) => window.__gapp.timeline.events[window.__gapp.player.eventIndex].sectionIndex === s, targetSec, { timeout: 15000 });
    await sleep(500);
    const st = await page.evaluate((s) => { const d = document.querySelector(`details.rep[data-sec="${s}"]`); const c = document.querySelector('.ch.cur'); const r = c && c.getBoundingClientRect(); return { open: d.open, playing: d.classList.contains('playing'), curVisible: !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight }; }, targetSec);
    rec('D5-collapsed-section-expands-on-entry', st.open && st.playing && st.curVisible, JSON.stringify(st));
    await page.screenshot({ path: path.join(OUT, 't-d-collapsed-expanded.png') });
    await page.click('#btn-stop');
    const closed = await page.evaluate((s) => document.querySelector(`details.rep[data-sec="${s}"]`).open, targetSec);
    info('D5-recollapse-on-stop', String(!closed));
    // end of song: play last chords and see stopped state
    const lastE = tl.events.length - 2;
    await startFrom(page, tl, lastE);
    await page.waitForFunction(() => window.__gapp.player.state === 'stopped', null, { timeout: 20000 });
    const fin = await gstate(page);
    rec('D4-song-end-goes-to-stopped', fin.s === 'stopped' && fin.p === 0, JSON.stringify(fin));
    rec('console-clean-D2', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // ---- D6 wake lock ----
  if (!only || only === 'D6') {
    {
      const { browser, page } = await open(W360);
      await page.click('#btn-play');
      await sleep(700);
      const a = await page.evaluate(() => ({ ...window.__wl }));
      await page.click('#btn-play'); await sleep(300);
      const b = await page.evaluate(() => ({ ...window.__wl }));
      rec('D6-wakelock-request-on-play-release-on-pause', a.req === 1 && a.active === 1 && b.active === 0 && b.rel === 1, `play: ${JSON.stringify(a)}; pause: ${JSON.stringify(b)}`);
      await page.click('#btn-play'); await sleep(700);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await sleep(300);
      const c = await page.evaluate(() => ({ ...window.__wl }));
      info('D6-visibilitychange-while-playing', JSON.stringify(c) + ' (visible state: lock already held, so no leak expected: active should be 1)');
      rec('D6-no-duplicate-lock-after-visibilitychange', c.active === 1, JSON.stringify(c));
      await page.click('#btn-stop'); await sleep(300);
      const d = await page.evaluate(() => ({ ...window.__wl }));
      rec('D6-release-on-stop', d.active === 0, JSON.stringify(d));
      // slow request then quick pause: leaked lock?
      await page.evaluate(() => { window.__wl.delay = 400; });
      await page.click('#btn-play'); await sleep(100); await page.click('#btn-play'); await sleep(1200);
      const e = await page.evaluate(() => ({ ...window.__wl }));
      rec('D6-pause-before-lock-granted-does-not-leak', e.active === 0, `${JSON.stringify(e)} (paused, lock still held if active>0)`);
      await browser.close();
    }
    {
      const { browser, page } = await open(W360, '?nowl');
      await page.click('#btn-play'); await sleep(800);
      const txt = await page.evaluate(() => document.body.innerText);
      rec('D6-warning-when-unsupported', /schermo potrebbe spegnersi/.test(txt), 'notice visible: ' + /schermo potrebbe spegnersi/.test(txt));
      await page.screenshot({ path: path.join(OUT, 't-d-nowakelock.png') });
      await page.click('#btn-play'); await sleep(200); await page.click('#btn-play'); await sleep(500);
      const n = await page.evaluate(() => (document.body.innerText.match(/schermo potrebbe spegnersi/g) || []).length);
      rec('D6-warning-only-once', n <= 1, `occurrences ${n}`);
      await browser.close();
    }
  }
  console.log(fails ? fails + ' FAILURES' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
