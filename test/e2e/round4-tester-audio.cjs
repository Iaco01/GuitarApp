// Round 4 tester: synchronised audio on dist/index.html with the tester's own ffmpeg track.
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round4-tester-audio.cjs [B1|B2|...]
// Prints only numbers and synthetic chord names. Screenshots in test-artifacts/round-4/tester/.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const DIR = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
const WAV = path.join(DIR, 't4.wav');
const MP3 = path.join(DIR, 't4.mp3');
const SONG = path.join(DIR, 't4-song.json');
const SONG_WRONG = path.join(DIR, 't4-song-wrong.json');
const EXP = JSON.parse(fs.readFileSync(path.join(DIR, 't4-expected.json'), 'utf-8'));
const OFFSET = 2.345;
const only = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const PROFILE = { ...devices['iPhone 13'], defaultBrowserType: undefined };
delete PROFILE.defaultBrowserType;

// oscillators created by the app: scheduled context time, media time at scheduling, cancels
const PATCH = () => {
  window.__osc = [];
  const AC = window.AudioContext;
  const co = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () {
    const osc = co.call(this);
    const ctx = this;
    const r = { when: null, ctxNow: null, media: null, rate: null, cancelled: false, cancelAt: null, ctx };
    const start = osc.start.bind(osc);
    const stop = osc.stop.bind(osc);
    osc.start = (w) => {
      r.when = w; r.ctxNow = ctx.currentTime;
      const el = window.__gapp && window.__gapp.audioEl;
      if (el) { r.media = el.currentTime; r.rate = el.playbackRate; }
      return start(w);
    };
    osc.stop = (w) => { if (w === undefined || w === 0) { r.cancelled = true; r.cancelAt = ctx.currentTime; } return stop(w); };
    window.__osc.push(r);
    return osc;
  };
};

async function open(profile = PROFILE) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...profile, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(PATCH);
  await page.goto(URL);
  return { browser, ctx, page, errors };
}

async function importJson(page, file) {
  await page.setInputFiles('#import-json', file);
  await page.waitForSelector('.dlg', { timeout: 5000 }).catch(() => {});
  const b = await page.$('.dlg [data-value="newer"]');
  if (b) await b.click();
  await page.waitForSelector('.song-row');
}

async function openSong(page, title) {
  const rows = await page.$$('.song-row');
  for (const r of rows) if ((await r.innerText()).includes(title)) { await r.click(); break; }
  await page.waitForSelector('#btn-sync');
}

const offMs = (page) => page.evaluate(() => Number(/\((-?\d+) ms\)/.exec(document.querySelector('#sync-offset').textContent)[1]));

// sync screen: load `file`, tap "Primo accordo!" `lateMs` too late on purpose, then fine-tune
async function loadAndSync(page, file, { lateMs = 120, shot = null } = {}) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-pick');
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#sync-first', { timeout: 15000 });
  const name = await page.innerText('#sync-file-name');
  await page.click('#sync-play');
  await page.waitForFunction((t) => window.__gappSync && window.__gappSync.element.currentTime >= t, OFFSET + lateMs / 1000);
  await page.click('#sync-first');
  await page.click('#sync-play');
  const tapped = await offMs(page);
  const steps = [];
  let v = tapped;
  const target = Math.round(OFFSET * 1000);
  for (let guard = 0; guard < 40 && Math.abs(v - target) > 5; guard++) {
    const d = v - target;
    const btn = d >= 50 ? -50 : d > 5 ? -10 : d <= -50 ? 50 : 10;
    await page.click(`#sync-offset-box [data-ms="${btn}"]`);
    steps.push(btn);
    v = await offMs(page);
  }
  if (shot) await page.screenshot({ path: path.join(DIR, shot) });
  return { name, tapped, final: v, steps };
}

async function closeSync(page) {
  await page.click('#sync-close');
  await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
}

// plays from the start; for every highlight change notes the media time. Returns per-event error
// (media time at the change - expected onset) in ms, matched by the event index of the timeline.
async function measure(page, { maxSec = 90, from = null } = {}) {
  await page.evaluate(() => {
    if (window.__obs) window.__obs.disconnect();
    window.__chg = [];
    const el = window.__gapp.audioEl;
    let last = null;
    const obs = new MutationObserver(() => {
      const cur = document.querySelector('.song-body .ch.cur');
      const ref = cur ? cur.getAttribute('data-ref') : null;
      if (ref !== last) { last = ref; window.__chg.push({ ref, ct: el.currentTime, rate: el.playbackRate, wall: performance.now() }); }
    });
    obs.observe(document.querySelector('.song-body'), { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.__obs = obs;
  });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing');
  const t0 = Date.now();
  await page.waitForFunction(() => window.__gapp.player.state !== 'playing', null, { timeout: maxSec * 1000, polling: 250 });
  const wall = (Date.now() - t0) / 1000;
  const data = await page.evaluate(() => ({ chg: window.__chg, refs: window.__gapp.timeline.events.map((e) => e.ref) }));
  const out = [];
  for (const c of data.chg) {
    if (!c.ref) continue;
    const i = data.refs.indexOf(c.ref);
    if (i < 0 || out.some((o) => o.i === i)) continue;
    out.push({ i, name: EXP.events[i].name, err: (c.ct - EXP.events[i].startSec) * 1000, rate: c.rate });
  }
  return { out, wall, refs: data.refs };
}
const stats = (a) => ({ n: a.length, min: Math.min(...a), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length, absMax: Math.max(...a.map(Math.abs)) });
const fmtS = (s) => `n=${s.n} mean ${s.mean.toFixed(1)} ms, min ${s.min.toFixed(1)}, max ${s.max.toFixed(1)}, |max| ${s.absMax.toFixed(1)}`;

async function setSpeed(page, pct) {
  const more = await page.$('#pp-more');
  if (await more.evaluate((e) => e.hidden)) await page.click('#btn-more');
  for (let g = 0; g < 20; g++) {
    const v = parseInt(await page.innerText('#pp-speed'), 10);
    if (v === pct) break;
    await page.click(v > pct ? '#btn-speed-down' : '#btn-speed-up');
  }
  await page.click('#btn-more');
}

async function idbKeys(page) {
  return page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('gapp-audio');
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('files')) { res([]); return; }
      const q = db.transaction('files').objectStore('files').getAllKeys();
      q.onsuccess = () => { res(q.result); db.close(); };
      q.onerror = () => res(['error']);
    };
    r.onerror = () => res(['open-error']);
  }));
}

(async () => {
  // ---------- B1, B2, B3 (100% / 75%), B4 on WAV and MP3 ----------
  for (const [label, file] of [['WAV', WAV], ['MP3', MP3]]) {
    if (only && !['B1', 'B2', 'B3', 'B4', 'B3' + label].includes(only)) continue;
    const { browser, page, errors } = await open();
    await importJson(page, SONG);
    await openSong(page, 'Prova tester');
    rec(`B1 ${label} no audio: button "Aggiungi audio"`, (await page.innerText('#btn-sync')).trim() === 'Aggiungi audio');
    const s = await loadAndSync(page, file, { lateMs: 120, shot: `b2-offset-${label}.png` });
    rec(`B1 ${label} file name and duration shown`, /t4\.(wav|mp3) · 0:44/.test(s.name), JSON.stringify(s.name));
    const dur = await page.evaluate(() => window.__gappSync.element.duration);
    info(`B1 ${label}`, `element duration ${dur.toFixed(3)} s (ffmpeg 44.463 s)`);
    rec(`B2 ${label} tap +120 ms on purpose then fine steps reach ${OFFSET * 1000} ms`, Math.abs(s.final - OFFSET * 1000) <= 5 && s.tapped - OFFSET * 1000 >= 100, `tapped ${s.tapped} ms, steps ${s.steps.join(',')}, final ${s.final} ms`);
    await closeSync(page);
    for (const pct of [100, 75]) {
      if (pct !== 100) await setSpeed(page, pct);
      const m = await measure(page, { maxSec: 44.5 / (pct / 100) + 15 });
      const st = stats(m.out.map((o) => o.err));
      info(`B3 ${label} ${pct}%`, `${fmtS(st)}; wall ${m.wall.toFixed(1)} s; changes seen ${m.out.length}/${EXP.events.length}`);
      info(`B3 ${label} ${pct}% per event`, m.out.map((o) => `${o.name}:${o.err.toFixed(0)}`).join(' '));
      rec(`B3 ${label} ${pct}%: every change within 100 ms`, m.out.length === EXP.events.length && st.absMax < 100, fmtS(st));
      if (pct === 75) {
        const pp = await page.evaluate(() => { const e = window.__gapp.audioEl; return { preservesPitch: e.preservesPitch, rate: e.playbackRate, webkit: e.webkitPreservesPitch }; });
        rec(`B4 ${label} preservesPitch true and playbackRate 0.75 at 75%`, pp.preservesPitch === true && Math.abs(pp.rate - 0.75) < 1e-9 && m.out.every((o) => Math.abs(o.rate - 0.75) < 1e-9), JSON.stringify(pp));
      }
    }
    if (label === 'WAV') {
      // reload: audio from IndexedDB
      await page.reload();
      await page.waitForSelector('#btn-sync'); // the hash route keeps the song open
      await page.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1, null, { timeout: 10000 });
      const r = await page.evaluate(() => ({ dur: window.__gapp.audioEl.duration, bar: document.querySelector('#audio-state') && document.querySelector('#audio-state').textContent, btn: document.querySelector('#btn-sync').textContent }));
      rec('B1 audio survives a reload (IndexedDB)', Math.abs(r.dur - 44.46) < 0.05 && /t4\.wav/.test(r.bar), JSON.stringify(r));
      await page.screenshot({ path: path.join(DIR, 'b1-after-reload.png') });
    }
    rec(`B ${label} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- B3 wrong BPM (+1 on the Finale), anchors, suggestion, apply ----------
  if (!only || only === 'B3W') {
    const { browser, page, errors } = await open();
    await importJson(page, SONG_WRONG);
    await openSong(page, 'Prova tester');
    await loadAndSync(page, WAV, { lateMs: 120 });
    await closeSync(page);
    let m = await measure(page, { maxSec: 60 });
    let st = stats(m.out.map((o) => o.err));
    info('B3W before fix', `${fmtS(st)}; per event ${m.out.map((o) => `${o.name}:${o.err.toFixed(0)}`).join(' ')}`);
    rec('B3W wrong BPM (+1 on Finale) gives > 100 ms error at the end (the test is meaningful)', st.absMax > 100, fmtS(st));
    // sync screen: anchor of the Finale tapped while listening, then "Fine brano"
    await page.click('#btn-sync');
    await page.waitForSelector('#sync-first');
    const finStart = EXP.sections[3].startSec;
    await page.evaluate((t) => { window.__gappSync.player.seek(t); }, finStart - 2);
    await page.click('#sync-play');
    await page.waitForFunction((t) => window.__gappSync.element.currentTime >= t, finStart + 0.03);
    await page.click('#sync-rows li[data-sec="3"] [data-act="here"]');
    const anchorTxt = await page.innerText('#sync-rows li[data-sec="3"] .sync-row-time');
    const anchorVal = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song-b') || 'null'));
    const endT = EXP.endSec;
    await page.evaluate((t) => { window.__gappSync.player.seek(t); }, endT - 2);
    await page.waitForFunction((t) => window.__gappSync.element.currentTime >= t, endT + 0.03);
    await page.click('#sync-end');
    await page.click('#sync-play');
    const sug = await page.innerText('#sync-sugs');
    info('B3W anchors', `Finale anchor shown ${anchorTxt}; expected ${finStart.toFixed(3)} s; stored ${anchorVal && anchorVal.audio ? JSON.stringify(anchorVal.audio.anchors) : 'n/a'}`);
    rec('B3W suggestion detects the Finale at 96 (now 97)', /Finale/.test(sug) && /96(,0)? BPM/.test(sug) && /ora 97/.test(sug), JSON.stringify(sug));
    await page.screenshot({ path: path.join(DIR, 'b3w-suggestion.png') });
    // apply only the suggestion about the Finale (a multi-section one would flatten 70/96/142, bug)
    const sugCount = await page.$$eval('#sync-sugs .sync-sug', (s) => s.length);
    rec('B3W only one suggestion (a 78 ms anchor tap error should not suggest a tempo change)', sugCount === 1, `${sugCount} suggestions`);
    const ab = await page.$('#sync-sugs .sync-sug:has-text("Finale") [data-act="apply"]');
    if (ab) await ab.click();
    const sug2 = await page.innerText('#sync-sugs');
    info('B3W after apply', JSON.stringify(sug2));
    await closeSync(page);
    m = await measure(page, { maxSec: 60 });
    st = stats(m.out.map((o) => o.err));
    info('B3W after fix', `${fmtS(st)}; per event ${m.out.map((o) => `${o.name}:${o.err.toFixed(0)}`).join(' ')}`);
    rec('B3W after applying the suggestion every change within 100 ms', m.out.length === EXP.events.length && st.absMax < 100, fmtS(st));
    // same wrong BPM, anchor only (no apply): what happens inside the Finale?
    rec('B3W no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- B3G gap vs squeeze between anchors ----------
  if (!only || only === 'B3G') {
    const { browser, page } = await open();
    await importJson(page, SONG);
    await openSong(page, 'Prova tester');
    await loadAndSync(page, WAV, { lateMs: 120 });
    // anchor the Ponte exactly where it is, then make the Strofa 4 BPM too fast (100 instead of 96)
    const ponte = EXP.sections[2].startSec;
    await page.evaluate((t) => window.__gappSync.player.seek(t), ponte);
    await page.click('#sync-rows li[data-sec="2"] [data-act="here"]');
    for (let i = 0; i < 8; i++) await page.click('#sync-rows li[data-sec="1"] [data-act="bpm+"]');
    const sugFast = await page.innerText('#sync-sugs');
    await closeSync(page);
    const tl = await page.evaluate(() => window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm]));
    const gap = tl[2][0] - tl[1][1];
    info('B3G Strofa at 100 instead of 96, Ponte anchored', `Strofa ends ${tl[1][1].toFixed(3)} s, Ponte anchor ${tl[2][0].toFixed(3)} s, gap ${(gap * 1000).toFixed(0)} ms; suggestion: ${JSON.stringify(sugFast)}`);
    // look at the panel in the middle of the gap
    await page.click('#btn-more');
    await page.click('#btn-metro'); // clicks on, to see what the metronome does in the gap
    await page.click('#btn-more');
    await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, tl[1][1] - 1.0);
    await page.click('#btn-play');
    await page.waitForFunction((t) => window.__gapp.audioEl.currentTime >= t, tl[1][1] + gap / 2);
    const inGap = await page.evaluate(() => ({ cur: document.querySelector('#pp-current').textContent, next: document.querySelector('#pp-next').textContent, left: document.querySelector('#pp-left').textContent, hl: (document.querySelector('.song-body .ch.cur') || {}).textContent }));
    await page.screenshot({ path: path.join(DIR, 'b3g-gap-panel.png') });
    await page.waitForFunction((t) => window.__gapp.audioEl.currentTime >= t, tl[2][0] + 0.5);
    await page.click('#btn-play');
    const clicks = await page.evaluate(([a, b]) => window.__osc.filter((o) => !o.cancelled && o.media !== null).map((o) => o.media + (o.when - o.ctxNow) * o.rate).filter((t) => t > a && t < b).length, [tl[1][1] + 0.01, tl[2][0] - 0.01]);
    info('B3G in the gap', `panel current "${inGap.cur}", next "${inGap.next}", beats left "${inGap.left}", highlighted "${inGap.hl}"; clicks scheduled inside the gap: ${clicks}`);
    // squeeze: Strofa too slow (92)
    await page.click('#btn-sync');
    await page.waitForSelector('#sync-first');
    for (let i = 0; i < 16; i++) await page.click('#sync-rows li[data-sec="1"] [data-act="bpm-"]');
    const sugSlow = await page.innerText('#sync-sugs');
    await closeSync(page);
    const tl2 = await page.evaluate(() => window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm, s.spb]));
    const evs = await page.evaluate(() => window.__gapp.timeline.events.filter((e) => e.sectionIndex === 1).map((e) => e.startSec));
    const expS = EXP.events.filter((e) => e.sectionIndex === 1).map((e) => e.startSec);
    info('B3G Strofa at 92, Ponte anchored (squeeze)', `Strofa ${tl2[1][0].toFixed(3)}–${tl2[1][1].toFixed(3)} s, effective beat ${(60 / tl2[1][3]).toFixed(2)} BPM (shown ${tl2[1][2]}); onset errors ${evs.map((t, i) => ((t - expS[i]) * 1000).toFixed(0)).join(',')} ms; suggestion ${JSON.stringify(sugSlow)}`);
    await browser.close();
  }

  // ---------- B5 tap on chord, B6 loop, B7 metronome over audio ----------
  if (!only || ['B5', 'B6', 'B7'].includes(only)) {
    const { browser, page, errors } = await open();
    await importJson(page, SONG);
    await openSong(page, 'Prova tester');
    await loadAndSync(page, WAV, { lateMs: 120 });
    await closeSync(page);
    const tl = await page.evaluate(() => window.__gapp.timeline);
    // B5
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.audioEl.currentTime > 3.5);
    const targets = [12, 5, 18, 2];
    const res = [];
    for (const i of targets) {
      const ref = tl.events[i].ref;
      await page.click(`.song-body .ch[data-ref="${ref}"]`);
      const ct = await page.evaluate(() => window.__gapp.audioEl.currentTime);
      const now = await page.evaluate(() => window.__gapp.player.eventIndex);
      res.push({ i, d: (ct - EXP.events[i].startSec) * 1000, now });
      await sleep(700);
    }
    await page.click('#btn-play');
    // from pause
    const ref5 = tl.events[9].ref;
    await page.click(`.song-body .ch[data-ref="${ref5}"]`);
    await sleep(100);
    const ct5 = await page.evaluate(() => ({ ct: window.__gapp.audioEl.currentTime, st: window.__gapp.player.state }));
    res.push({ i: 9, d: (ct5.ct - EXP.events[9].startSec) * 1000, st: ct5.st });
    info('B5 jumps', res.map((r) => `#${r.i}:${r.d.toFixed(0)}ms${r.st ? '(' + r.st + ')' : ''}`).join(' '));
    // the read happens a few ms after the seek while playing: allow the playback progress
    rec('B5 tap on chord: currentTime = startSec within 20 ms (+ time elapsed before the read)', res.every((r) => r.d >= -20 && r.d < 60), '');
    await page.click('#btn-play'); // pause
    // B6 loop on the Strofa (index 1): long press on header while playing
    const sec = tl.sections[1];
    await page.evaluate(() => {
      window.__ct = [];
      const el = window.__gapp.audioEl;
      const f = () => { window.__ct.push(el.currentTime); window.__ctRaf = requestAnimationFrame(f); };
      f();
    });
    await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, sec.startSec + 1);
    await page.click('#btn-play');
    await sleep(1200); // let the auto-scroll settle on the Strofa
    const head = await page.$('.song-body .sec-head[data-sec="1"]');
    await head.scrollIntoViewIfNeeded();
    const bb = await head.boundingBox();
    // a real touch (implicit pointer capture), held 700 ms while the page auto-scrolls
    const cdp = await page.context().newCDPSession(page);
    const pt = { x: bb.x + 20, y: bb.y + bb.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const looping = await page.evaluate(() => !!document.querySelector('.looping'));
    info('B6 long press (touch) while playing starts the loop', String(looping));
    const loopLen = sec.endSec - sec.startSec;
    await sleep((loopLen * 2.3) * 1000);
    const cts = await page.evaluate(() => { cancelAnimationFrame(window.__ctRaf); return window.__ct; });
    const jumps = [];
    for (let i = 1; i < cts.length; i++) if (cts[i] < cts[i - 1] - 0.5) jumps.push({ before: cts[i - 1], after: cts[i] });
    const loopJumps = jumps.filter((j) => j.before > sec.endSec - 0.3 && j.before < sec.endSec + 1); // not the manual seek before the loop
    info('B6 loop', `section ${sec.startSec.toFixed(3)}–${sec.endSec.toFixed(3)} s; jumps ${loopJumps.map((j) => `${j.before.toFixed(3)}→${j.after.toFixed(3)}`).join(', ')}`);
    rec('B6 loop: >= 2 wraps, each from <= end+100 ms back to start within 100 ms', loopJumps.length >= 2 && loopJumps.every((j) => j.before <= sec.endSec + 0.1 && Math.abs(j.after - sec.startSec) <= 0.1), '');
    const after = cts.slice(cts.findIndex((c, i) => i > 0 && cts[i - 1] > sec.startSec + 1 && c < cts[i - 1] - 0.5));
    rec('B6 loop: time never leaves the section after the first wrap (+100 ms)', after.every((c) => c >= sec.startSec - 0.1 && c <= sec.endSec + 0.1), `min ${Math.min(...after).toFixed(3)} max ${Math.max(...after).toFixed(3)}`);
    const loopx = await page.$('.loop-x');
    if (loopx) await loopx.click();
    await page.click('#btn-play'); // pause
    // B7 metronome
    await page.evaluate(() => { window.__osc.length = 0; });
    await page.click('#btn-more');
    await page.click('#btn-metro');
    const metroLbl = await page.innerText('#btn-metro');
    await page.evaluate(() => { window.__gapp.audioEl.currentTime = 2.0; });
    await page.click('#btn-play');
    await sleep(6000);
    // seek x3 (taps on chords), pause/resume, speed change
    for (const i of [14, 3, 16]) { await page.click(`.song-body .ch[data-ref="${tl.events[i].ref}"]`); await sleep(1500); }
    await page.click('#btn-play'); await sleep(800); await page.click('#btn-play'); await sleep(2500);
    await page.click('#btn-speed-down'); await page.click('#btn-speed-down'); await sleep(3000);
    await page.click('#btn-speed-up'); await page.click('#btn-speed-up'); await sleep(2000);
    await page.click('#btn-play');
    await sleep(300);
    const osc = await page.evaluate(() => window.__osc.filter((o) => o.when !== null).map((o) => ({ when: o.when, ctxNow: o.ctxNow, media: o.media, rate: o.rate, cancelled: o.cancelled, cancelAt: o.cancelAt })));
    const beatTimes = tl.beats.map((b) => b.timeSec);
    // a click "sounds" if not cancelled before its time
    const sounded = osc.filter((o) => !o.cancelled || (o.cancelAt !== null && o.cancelAt >= o.when));
    const mediaT = sounded.map((o) => o.media + (o.when - o.ctxNow) * o.rate);
    const offGrid = mediaT.map((t) => Math.min(...beatTimes.map((b) => Math.abs(b - t))) * 1000);
    const sortedWhen = sounded.map((o) => o.when).sort((a, b) => a - b);
    let doubles = 0;
    for (let i = 1; i < sortedWhen.length; i++) if (sortedWhen[i] - sortedWhen[i - 1] < 0.15) doubles++;
    info('B7 clicks', `label "${metroLbl}", created ${osc.length}, sounded ${sounded.length}, cancelled before sounding ${osc.length - sounded.length}; distance from beat grid max ${Math.max(...offGrid).toFixed(1)} ms, mean ${(offGrid.reduce((a, b) => a + b, 0) / offGrid.length).toFixed(1)} ms; pairs closer than 150 ms: ${doubles}`);
    rec('B7 clicks over audio on the beat grid (< 15 ms) and no double click', sounded.length > 10 && Math.max(...offGrid) < 15 && doubles === 0, '');
    const pausedClicks = await page.evaluate(async () => { const n = window.__osc.length; await new Promise((r) => setTimeout(r, 1500)); return window.__osc.length - n; });
    rec('B7 no clicks created while paused', pausedClicks === 0, String(pausedClicks));
    rec('B5-7 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- B8 pause bars ----------
  if (!only || only === 'B8') {
    const { browser, page, errors } = await open();
    await importJson(page, SONG);
    await openSong(page, 'Prova tester');
    const before = await page.evaluate(() => ({ n: window.__gapp.timeline.events.length, beats: window.__gapp.timeline.totalBeats, s3: window.__gapp.timeline.sections[3].startBeat }));
    await page.click('#btn-edit');
    await page.click('.add-pause[data-sec="1"]');
    const a1 = await page.evaluate(() => ({ n: window.__gapp.timeline.events.length, beats: window.__gapp.timeline.totalBeats, s3: window.__gapp.timeline.sections[3].startBeat, first1: window.__gapp.timeline.events.find((e) => e.sectionIndex === 1), rests: document.querySelectorAll('.song-body .ch.rest').length }));
    rec('B8 "+ pausa" adds a 4-beat rest at the start of the section', a1.n === before.n + 1 && a1.beats === before.beats + 4 && a1.first1.rest && a1.first1.beats === 4 && a1.s3 === before.s3 + 4, JSON.stringify({ before, after: { n: a1.n, beats: a1.beats, s3: a1.s3, rests: a1.rests } }));
    const restEls = await page.$$('.song-body .sec[data-sec="1"] .ch.rest, .song-body .ch.rest');
    await restEls[restEls.length > 1 ? 1 : 0].click().catch(() => {});
    // click the rest of section 1 specifically
    const r1 = await page.evaluate(() => { const e = [...document.querySelectorAll('.song-body .ch.rest')].find((x) => x.getAttribute('data-ref').startsWith('1.')); return e && e.getAttribute('data-ref'); });
    await page.click(`.song-body .ch[data-ref="${r1}"]`);
    await page.click('#eb-plus'); await page.click('#eb-plus');
    const a2 = await page.evaluate(() => ({ beats: window.__gapp.timeline.totalBeats, val: document.querySelector('#eb-val').textContent, s3: window.__gapp.timeline.sections[3].startBeat }));
    rec('B8 rest edited with + (4 -> 6) moves the following sections by 2 beats', a2.beats === before.beats + 6 && a2.s3 === before.s3 + 6 && /6/.test(a2.val), JSON.stringify(a2));
    await page.screenshot({ path: path.join(DIR, 'b8-edit-pause.png') });
    await page.click('#eb-del-pause');
    const a3 = await page.evaluate(() => ({ n: window.__gapp.timeline.events.length, beats: window.__gapp.timeline.totalBeats, s3: window.__gapp.timeline.sections[3].startBeat }));
    rec('B8 "Elimina pausa" restores the count', a3.n === before.n && a3.beats === before.beats && a3.s3 === before.s3, JSON.stringify(a3));
    // the existing rest in the Ponte can be deleted too, and the saved song follows
    const r2 = await page.evaluate(() => { const e = [...document.querySelectorAll('.song-body .ch.rest')].find((x) => x.getAttribute('data-ref').startsWith('2.')); return e && e.getAttribute('data-ref'); });
    await page.click(`.song-body .ch[data-ref="${r2}"]`);
    const delVisible = await page.isVisible('#eb-del-pause');
    await page.click('#eb-minus');
    const a4 = await page.evaluate(() => window.__gapp.timeline.totalBeats);
    rec('B8 imported rest bar is editable (- gives 3 beats) and deletable', delVisible && a4 === before.beats - 1, `${a4} vs ${before.beats}`);
    await page.click('#eb-plus');
    await page.click('#btn-edit');
    await page.reload();
    await page.waitForSelector('#btn-sync'); // the hash route keeps the song open
    const a5 = await page.evaluate(() => window.__gapp.timeline.totalBeats);
    rec('B8 after reload the count is the original one', a5 === before.beats, `${a5}`);
    // in play the panel shows "—" on the rest
    await page.click('#btn-sync');
    await page.waitForSelector('#sync-pick');
    await page.setInputFiles('#sync-file', WAV);
    await page.waitForSelector('#sync-first');
    for (let i = 0; i < 3; i++) await page.click('#sync-offset-box [data-ms="50"]');
    // offset 2.345 typed by steps from 0 would be long: set by tapping at the right moment instead
    await page.click('#sync-play');
    await page.waitForFunction((t) => window.__gappSync.element.currentTime >= t, OFFSET);
    await page.click('#sync-first');
    await page.click('#sync-play');
    await closeSync(page);
    const ponteRest = EXP.events.findIndex((e) => e.rest);
    await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, EXP.events[ponteRest].startSec - 0.5);
    await page.click('#btn-play');
    await page.waitForFunction((t) => window.__gapp.audioEl.currentTime >= t, EXP.events[ponteRest].startSec + 0.6);
    const pan = await page.evaluate(() => ({ cur: document.querySelector('#pp-current').textContent, hl: (document.querySelector('.song-body .ch.cur') || {}).className }));
    await page.screenshot({ path: path.join(DIR, 'b8-rest-playing.png') });
    await page.click('#btn-play');
    rec('B8 rest bar in play: panel "—", the rest label is highlighted', pan.cur.trim() === '—' && /rest/.test(pan.hl), JSON.stringify(pan));
    rec('B8 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- B9 latency ----------
  if (!only || only === 'B9') {
    const { browser, page, errors } = await open();
    await importJson(page, SONG);
    await importJson(page, SONG_WRONG);
    // calibration from the library: +200 ms with the slider
    await page.click('#btn-calibrate');
    await page.waitForSelector('#cal-slider');
    await page.click('#cal-start');
    await sleep(800);
    await page.$eval('#cal-slider', (s) => { s.value = '200'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    // flash vs click on the calibration screen: when does the dot light up?
    const flash = await page.evaluate(() => new Promise((res) => {
      const dot = document.querySelector('#cal-dot');
      const out = [];
      const obs = new MutationObserver(() => { if (dot.classList.contains('on')) out.push(performance.now()); });
      obs.observe(dot, { attributes: true });
      setTimeout(() => { obs.disconnect(); res(out); }, 3000);
    }));
    const osc = await page.evaluate(() => window.__osc.slice(-12).map((o) => ({ when: o.when, ctxNow: o.ctxNow })));
    info('B9 calibration', `flashes in 3 s: ${flash.length}; clicks scheduled every ${osc.length > 1 ? (osc[1].when - osc[0].when).toFixed(3) : '?'} s`);
    await page.click('#cal-save');
    const dev = await page.evaluate(() => localStorage.getItem('gapp.device.v1'));
    rec('B9 slider value saved per device', /"latencyMs":200/.test(dev || ''), dev);
    const libTxt = await page.innerText('#device-latency');
    info('B9 library text', libTxt);
    for (const t of ['Prova tester quattro', 'Prova tester BPM']) {
      await openSong(page, t);
      const title = await page.innerText('#song-title');
      await page.click('#btn-sync');
      await page.waitForSelector('#sync-pick');
      await page.setInputFiles('#sync-file', WAV);
      await page.waitForSelector('#sync-first');
      const latTxt = await page.innerText('#sync-latency');
      // tap the first chord exactly when it sounds in the media: the offset stored should be
      // media - latency (the user hears it 200 ms later)
      await page.click('#sync-play');
      await page.waitForFunction((t) => window.__gappSync.element.currentTime >= t, OFFSET + 0.2);
      await page.click('#sync-first');
      await page.click('#sync-play');
      let v = await offMs(page);
      info('B9 ' + title, `sync screen says "${latTxt}"; tap at media ${OFFSET + 0.2} s stored offset ${v} ms`);
      for (let g = 0; g < 30 && Math.abs(v - OFFSET * 1000) > 5; g++) {
        const d = v - OFFSET * 1000;
        await page.click(`#sync-offset-box [data-ms="${d >= 50 ? -50 : d > 5 ? -10 : d <= -50 ? 50 : 10}"]`);
        v = await offMs(page);
      }
      await closeSync(page);
      const m = await measure(page, { maxSec: 60 });
      // the second song has the Finale at a wrong BPM on purpose: judge it on the first three sections
      const st = stats(m.out.filter((o) => title.includes('quattro') || EXP.events[o.i].sectionIndex < 3).map((o) => o.err));
      info('B9 ' + title + ' with 200 ms', `${fmtS(st)}`);
      rec(`B9 ${title}: highlight shifted by +200 ms (media time at change - expected = 200 +/- 30 ms)`, Math.abs(st.mean - 200) < 30 && st.absMax < 240 && st.min > 170, fmtS(st));
      await page.click('#btn-back');
      await page.waitForSelector('.song-row');
    }
    rec('B9 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  // ---------- B10 export / import / audio missing / reload; B11 delete ----------
  if (!only || only === 'B10' || only === 'B11') {
    const { browser, page, errors } = await open();
    await importJson(page, SONG);
    await openSong(page, 'Prova tester');
    await loadAndSync(page, WAV, { lateMs: 120 });
    const finStart = EXP.sections[3].startSec;
    await page.evaluate((t) => window.__gappSync.player.seek(t), finStart);
    await page.click('#sync-rows li[data-sec="3"] [data-act="here"]');
    await closeSync(page);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song')).audio);
    await page.click('#btn-back');
    await page.waitForSelector('#btn-export');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    const exportPath = path.join(DIR, 'b10-export.json');
    await dl.saveAs(exportPath);
    const exp = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    const a = exp.songs[0].audio;
    const size = fs.statSync(exportPath).size;
    rec('B10 export has audio metadata (name, size, duration, offset, anchors) and no blob', a && a.fileName === 't4.wav' && a.size > 0 && Math.abs(a.offsetSec - saved.offsetSec) < 1e-9 && a.anchors && a.anchors[3] !== undefined && size < 20000 && !/blob:|data:audio|base64/.test(fs.readFileSync(exportPath, 'utf-8')), `size ${size} B, keys ${Object.keys(a || {}).join(',')}`);
    // fresh storage
    const ctx2 = await browser.newContext({ ...PROFILE });
    const p2 = await ctx2.newPage();
    p2.on('dialog', (d) => d.accept());
    await p2.goto(URL);
    await importJson(p2, exportPath);
    const libBadge = await p2.innerText('.song-row');
    await openSong(p2, 'Prova tester');
    await p2.waitForSelector('#audio-state');
    const missing = await p2.innerText('#audio-bar');
    await p2.screenshot({ path: path.join(DIR, 'b10-missing.png') });
    rec('B10 after import on clean storage: "Audio mancante"', /Audio mancante: ricarica «t4\.wav»/.test(missing), JSON.stringify(missing));
    info('B10 library row', JSON.stringify(libBadge.replace(/\n/g, ' | ')));
    let dialogs = 0;
    p2.on('dialog', () => { dialogs++; });
    await p2.setInputFiles('#audio-reload', WAV);
    await p2.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1, null, { timeout: 10000 });
    const a2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song')).audio);
    rec('B10 reloading the same file keeps offset and anchors, no question', Math.abs(a2.offsetSec - saved.offsetSec) < 1e-9 && a2.anchors[3] === saved.anchors[3] && dialogs === 0, JSON.stringify({ off: a2.offsetSec, anchors: a2.anchors, dialogs }));
    // a different file (mp3): asks
    await p2.click('#btn-sync');
    await p2.waitForSelector('#sync-first');
    await p2.setInputFiles('#sync-file', MP3);
    await sleep(1500);
    const a3 = await p2.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.tester-r4-song')).audio);
    rec('B10 a different file asks before keeping (accepted -> kept)', dialogs === 1 && a3.fileName === 't4.mp3' && Math.abs(a3.offsetSec - saved.offsetSec) < 1e-9, `dialogs ${dialogs}, file ${a3.fileName}`);
    await p2.click('#sync-close');
    // B11 delete the song -> audio gone from IndexedDB
    const k1 = await idbKeys(p2);
    await p2.click('#btn-delete').catch(async () => {
      // the delete button may be inside the settings <details>
      await p2.click('details.settings summary');
      await p2.click('#btn-delete');
    });
    await p2.waitForSelector('.screen.lib', { timeout: 5000 }).catch(() => {});
    await sleep(500);
    const k2 = await idbKeys(p2);
    rec('B11 deleting the song deletes its audio from IndexedDB', k1.includes('tester-r4-song') && !k2.includes('tester-r4-song'), `${JSON.stringify(k1)} -> ${JSON.stringify(k2)}`);
    // and from the library list
    await page.goto(URL);
    await page.waitForSelector('.song-row');
    const k3 = await idbKeys(page);
    await page.click('li[data-id="tester-r4-song"] button[aria-label^="Elimina"]');
    await sleep(800);
    const k4 = await idbKeys(page);
    rec('B11 deleting from the library list deletes the audio too', k3.includes('tester-r4-song') && !k4.includes('tester-r4-song'), `${JSON.stringify(k3)} -> ${JSON.stringify(k4)}`);
    rec('B10-11 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
