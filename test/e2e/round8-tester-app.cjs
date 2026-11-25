// Round 8 tester, parts D and E in the app (Playwright).
// Prepare: node scripts/build.mjs && node test/e2e/round7-tester-make.mjs
// Run: node test/e2e/round8-tester-app.cjs <correct|disabled|panel|sync|perf> [360|SE|13|320]
//   correct   D1: Correggi a orecchio: next chord / count at every tap, undo down to zero, missing taps -> partial save (times), extra taps
//   disabled  D2: :disabled style of every button the app can show disabled (screenshots)
//   panel     D3: play panel height stopped vs playing, with/without audio, with/without rhythm row
//   sync      D4: synchronisation screen on the real mp3 (compact rows, fixed bar, notices, truncated text at 320 px)
//   perf      E : CPU x4 x3 runs on the real mp3 (time, longest frame, frames > 100/250 ms, cancel latency, JS heap peak); CPU x6 once
// The real song's text is never printed. Screenshots: test-artifacts/round-8/ (ignored by git; they show the real text).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const T7 = path.join(ROOT, 'test-artifacts', 'round-7', 'tester');
const SYN = path.join(T7, 'r7.mp3');
const SYN_SONG = path.join(T7, 'r7-song.json');
const TRUTH = JSON.parse(fs.readFileSync(path.join(T7, 'r7-truth.json'), 'utf8')).truth;
const OUT = path.join(ROOT, 'test-artifacts', 'round-8');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'correct';
const devName = process.argv[3] || 'SE';
let fails = 0; let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const PROFILES = {
  320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `t-${dev}-${name}.png`) });

async function open(profile, { throttle = 1 } = {}) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  let cdp = null;
  if (throttle > 1 || mode === 'perf' || mode === 'mem') { cdp = await ctx.newCDPSession(page); if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.addInitScript(() => {
    window.__gaps = []; window.__long = [];
    let last = performance.now();
    (function loop() { const n = performance.now(); window.__gaps.push([n, n - last]); last = n; requestAnimationFrame(loop); })();
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
  });
  await page.goto(URL);
  return { browser, ctx, page, errors, cdp };
}
const readSong = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))));
async function loadSynthSong(page) {
  await page.setInputFiles('#import-json', SYN_SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]');
  if (nb) await nb.click();
  await page.waitForSelector('.song-row');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
}
async function syncSynth(page) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', SYN);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
}
async function loadReal(page, withAudio = true) {
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 20000 });
  if (!withAudio) return;
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3);
  await page.waitForSelector('#as-start', { timeout: 30000 });
}
const gapsBetween = (page, a, b) => page.evaluate(([a, b]) => ({ gaps: window.__gaps.filter(([t]) => t >= a && t <= b).map((g) => g[1]), long: window.__long.filter(([t]) => t >= a && t <= b).map((g) => g[1]) }), [a, b]);
const stat = (v) => { const s = v.slice().sort((x, y) => x - y); return { n: s.length, max: Math.max(0, ...s), over100: s.filter((x) => x > 100).length, over250: s.filter((x) => x > 250).length }; };

// ------------------------------------------------------------------ D1
async function correct() {
  dev = devName;
  const { browser, page, errors } = await open(PROFILES[devName]);
  await loadSynthSong(page);
  await syncSynth(page);
  const si = 1; const first = 7; const N = 12;
  const song = await readSong(page);
  const names = []; song.sections[si].lines.forEach((l) => l.chords.forEach((c) => names.push(c.name)));
  const auto = song.audio.alignment.eventStartSec.slice(first, first + N);
  const openCorr = async () => { await page.click(`.as-row[data-sec="${si}"] [data-act="correct"]`); await page.waitForSelector('#corr-tap'); await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 }); };
  const tapAt = async (t) => { await page.evaluate((t) => window.__gappSync.player.seek(t), t); await sleep(60); await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 }); };
  const nextTxt = () => page.innerText('#corr-next');
  const cntTxt = () => page.innerText('#corr-count');
  await openCorr();
  // 1. next chord and count after every tap
  let ok = true; const bad = [];
  for (let k = 0; k < N; k++) {
    const nt = await nextTxt(); const c = await cntTxt();
    const left = N - k;
    const wantName = names[k];
    if (!(nt.includes(wantName) && nt.includes(String(left)) && c.startsWith(`${k} / ${N}`))) { ok = false; bad.push(`${k}: "${nt}" | "${c}"`); }
    await tapAt(TRUTH[first + k]);
  }
  const ntEnd = await nextTxt(); const cEnd = await cntTxt();
  rec('D1a next chord and count right at each of the 12 taps', ok, bad.slice(0, 2).join(' || '));
  info('D1a', `after the last tap: next "${ntEnd}" count "${cEnd}"`);
  // 2. extra taps beyond the end
  await tapAt(TRUTH[first + N - 1] + 3); await tapAt(TRUTH[first + N - 1] + 4);
  const cX = await cntTxt(); const nX = await nextTxt(); const stX = await page.innerText('#corr-status');
  info('D1b', `after 2 extra taps: count "${cX}", next "${nX}", status "${stX}"`);
  rec('D1b extra taps beyond the end do not grow the count past 12', cX.startsWith(`${N} / ${N}`), cX);
  const saveOff = await page.$eval('#corr-save', (b) => b.disabled);
  rec('D1c Salva stays available with 12/12 (extra ignored)', !saveOff);
  // 3. undo down to zero (from 12, ten undos... until zero), then the button state
  const seq = [];
  for (let k = 0; k < N + 2; k++) {
    const dis = await page.$eval('#corr-undo-tap', (b) => b.disabled);
    if (dis) { seq.push('dis'); break; }
    await page.click('#corr-undo-tap'); seq.push((await cntTxt()).split(' ')[0]);
  }
  info('D1d', `counts after each undo: ${seq.join(' ')}`);
  const nt0 = await nextTxt();
  rec('D1d undo repeated reaches 0, the undo button then disabled, next = first chord', seq[seq.length - 1] === 'dis' && seq.includes('0') && nt0.includes(names[0]) && nt0.includes(String(N)), `next "${nt0}"`);
  const sv0 = await page.$eval('#corr-save', (b) => b.disabled); const pv0 = await page.$eval('#corr-preview', (b) => b.disabled);
  rec('D1e at 0 taps Salva and Anteprima are disabled', sv0 && pv0);
  await shot(page, 'corr-zero');
  // 4. 3 taps, undo 1, tap again, ok
  for (let k = 0; k < 3; k++) await tapAt(TRUTH[first + k]);
  await page.click('#corr-undo-tap');
  const c2 = await cntTxt(); const n2 = await nextTxt();
  rec('D1f 3 taps, 1 undo: count 2, next is the 3rd chord', c2.startsWith(`2 / ${N}`) && n2.includes(names[2]), `${c2} | ${n2}`);
  // 5. missing taps: tap up to 7 (truth+60ms), preview + partial save
  await tapAt(TRUTH[first + 2]);
  for (let k = 3; k < 7; k++) await tapAt(TRUTH[first + k]);
  const c7 = await cntTxt();
  await page.click('#corr-preview');
  await sleep(600);
  const st = await page.innerText('#corr-status');
  const missing = names.slice(7);
  rec('D1g preview with 7/12 lists the 5 chords without time', c7.startsWith(`7 / ${N}`) && st.includes('Senza tempo') && missing.every((n) => st.includes(n)), `${c7} | ${st}`);
  const saveLbl = await page.innerText('#corr-save');
  info('D1g', `Salva label: "${saveLbl}"`);
  await shot(page, 'corr-partial');
  await page.click('#corr-save');
  await page.waitForSelector('#corr-tap', { state: 'detached' });
  const after = await readSong(page);
  const al = after.audio.alignment;
  const e7 = Array.from({ length: 7 }, (_, k) => Math.abs(al.eventStartSec[first + k] - TRUTH[first + k]));
  const keep = auto.slice(7).every((t, k) => al.eventStartSec[first + 7 + k] === t);
  const mono = al.eventStartSec.every((t, j, a) => j === 0 || t >= a[j - 1]);
  rec('D1h partial save: tapped chords at the taps (<= 60 ms), missing ones keep the automatic time exactly, order intact, not verified', Math.max(...e7) <= 0.06 && keep && mono && !al.sections[si].verified, `tapped max err ${(1000 * Math.max(...e7)).toFixed(0)} ms; keep ${keep}; monotone ${mono}; verified ${al.sections[si].verified}`);
  info('D1h', `automatic times of the 5 missing chords (s): ${auto.slice(7).map((t) => t.toFixed(2)).join(' ')}; truth: ${TRUTH.slice(first + 7, first + N).map((t) => t.toFixed(2)).join(' ')}`);
  // what does the user see for those chords in the summary? still yellow/green, not verified
  const state = await page.$eval(`.as-row[data-sec="${si}"]`, (r) => r.dataset.state);
  info('D1h', `section row state after the partial save: ${state}`);
  // 6. partial save where the auto time of a missing chord falls BEFORE the last tap (taps late by 1.5 s)
  await openCorr();
  for (let k = 0; k < 6; k++) await tapAt(auto[k] + 1.5 + (k > 3 ? 1 : 0));
  await page.click('#corr-save', { force: true }).catch(() => {});
  await sleep(400);
  const stillOpen = !!(await page.$('#corr-tap'));
  const st2 = stillOpen ? await page.innerText('#corr-status') : '(closed)';
  info('D1i', `taps far later than the automatic times (6/12): overlay ${stillOpen ? 'still open' : 'closed'}; status "${st2}"`);
  if (!stillOpen) { const s3 = await readSong(page); const a3 = s3.audio.alignment.eventStartSec; rec('D1i saved result stays monotone', a3.every((t, j, a) => j === 0 || t >= a[j - 1])); }
  else rec('D1i overlap between a late tap and an automatic time is refused with a message', /salt|tocco|dopo|ordine|prima/i.test(st2), st2);
  rec('D1z no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ D2
async function sweepDisabled(page, where) {
  const r = await page.evaluate(() => {
    const out = [];
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const b of document.querySelectorAll('button:disabled, input:disabled, select:disabled')) {
      if (!vis(b)) continue;
      const cs = getComputedStyle(b);
      out.push({ id: b.id || '', cls: b.className.toString().slice(0, 30), txt: (b.textContent || b.value || '').trim().slice(0, 24), opacity: cs.opacity, borderStyle: cs.borderStyle, bg: cs.backgroundColor, color: cs.color, cursor: cs.cursor });
    }
    return out;
  });
  return r;
}
async function disabled() {
  dev = devName;
  const { browser, page, errors } = await open(PROFILES[devName]);
  const all = [];
  const add = async (where) => { const r = await sweepDisabled(page, where); r.forEach((x) => all.push({ where, ...x })); info('D2', `${where}: ${r.length} disabled controls: ${r.map((x) => x.id || x.txt).join(', ')}`); };
  await shot(page, 'lib-empty'); await add('library (empty)');
  await loadSynthSong(page);
  await shot(page, 'song-noaudio'); await add('song without audio');
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await shot(page, 'sync-empty'); await add('sync screen, no audio');
  await page.setInputFiles('#sync-file', SYN);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await shot(page, 'sync-audio'); await add('sync screen, audio loaded');
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  await shot(page, 'sync-summary'); await add('sync summary');
  await page.click('.as-row[data-sec="1"] [data-act="correct"]');
  await page.waitForSelector('#corr-tap');
  await sleep(500);
  await shot(page, 'corr-open'); await add('correction, 0 taps');
  await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 });
  await sleep(200);
  await shot(page, 'corr-1tap'); await add('correction, 1 tap');
  await page.click('#corr-close');
  await page.waitForSelector('#as-rows');
  await page.click('#sync-close');
  await page.waitForSelector('#btn-play');
  await shot(page, 'song-aligned'); await add('song with alignment (BPM locked)');
  await page.click('#btn-more').catch(() => {});
  await sleep(300);
  await shot(page, 'song-more'); await add('song, "more" menu open');
  // verdict: every disabled control must look different from an enabled one
  const weak = all.filter((x) => !(Number(x.opacity) < 0.8) || !/dashed|dotted/.test(x.borderStyle));
  rec('D2a every visible disabled control has opacity < 0.8 and a dashed border', weak.length === 0, `${all.length} controls; weak: ${weak.map((w) => `${w.where}/${w.id || w.txt}(${w.opacity},${w.borderStyle})`).join(' ')}`);
  // enabled vs disabled primary button compared
  const cmp = await page.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0); const en = bs.find((b) => !b.disabled && b.classList.contains('primary')); const di = bs.find((b) => b.disabled); return { en: en && { id: en.id, bg: getComputedStyle(en).backgroundColor }, di: di && { id: di.id, bg: getComputedStyle(di).backgroundColor } }; });
  info('D2', `sample enabled primary vs a disabled: ${JSON.stringify(cmp)}`);
  // other kinds of "not available" without the disabled attribute (aria-disabled, .disabled class)
  const alt = await page.evaluate(() => [...document.querySelectorAll('[aria-disabled="true"], .disabled')].map((e) => e.id || e.className.toString().slice(0, 20)));
  info('D2', `aria-disabled / .disabled elements on the song screen: ${JSON.stringify(alt)}`);
  rec('D2z no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ D3
const panelH = (page) => page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
async function setRhythm(page, on) {
  // the rhythm row switch lives in the "more" menu on short screens, or as a direct button
  const state = await page.evaluate(() => { const b = document.querySelector('#btn-pp-rhythm'); return b ? { pressed: b.getAttribute('aria-pressed'), visible: b.getBoundingClientRect().width > 0 } : null; });
  if (!state) return 'no-switch';
  if (!state.visible) { await page.click('#btn-more'); await sleep(150); }
  const cur = await page.evaluate(() => document.querySelector('#btn-pp-rhythm').getAttribute('aria-pressed'));
  if ((cur === 'true') !== on) await page.click('#btn-pp-rhythm');
  if (!state.visible) await page.click('#btn-more');
  await sleep(150);
  return 'ok';
}
async function panel() {
  dev = devName;
  const out = [];
  for (const withAudio of [false, true]) for (const rhythm of [true, false]) {
    const { browser, page, errors } = await open(PROFILES[devName]);
    await loadReal(page, withAudio);
    if (withAudio) {
      // use the synthetic-free path: sync the real mp3 with the alignment (needs analysis ~10 s)
      await page.click('#as-start');
      await page.waitForSelector('#as-rows', { timeout: 240000 });
      await page.click('#sync-close');
      await page.waitForSelector('#btn-play');
    }
    const sw = await setRhythm(page, rhythm);
    await sleep(200);
    const hIdle = await panelH(page);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
    const hs = [];
    for (let i = 0; i < 10; i++) { hs.push(await panelH(page)); await sleep(400); }
    await shot(page, `panel-${withAudio ? 'audio' : 'noaudio'}-${rhythm ? 'rhythm' : 'norhythm'}`);
    const rowShown = await page.evaluate(() => { const r = document.querySelector('#pp-rhythm, .pp-rhythm'); return r ? r.getBoundingClientRect().height > 0 : null; });
    await page.click('#btn-play');
    await sleep(300);
    const hStop = await panelH(page);
    out.push({ withAudio, rhythm, sw, hIdle, min: Math.min(...hs), max: Math.max(...hs), hStop, rowShown });
    rec(`H audio=${withAudio} rhythm=${rhythm}: stopped = playing = after stop (<= 0.5 px)`, Math.max(...hs) - hIdle < 0.5 && hIdle - Math.min(...hs) < 0.5 && Math.abs(hStop - hIdle) < 0.5, `idle ${hIdle} play ${Math.min(...hs)}-${Math.max(...hs)} stop ${hStop} rhythm row shown while playing: ${rowShown} (switch ${sw})`);
    rec('Hz no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await browser.close();
  }
  console.log('SUMMARY ' + JSON.stringify(out));
}

// ------------------------------------------------------------------ D4
async function sync() {
  dev = devName;
  const prof = PROFILES[devName];
  const { browser, page, errors } = await open(prof);
  await loadReal(page, true);
  await shot(page, 'sync-ready');
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  await sleep(300);
  const vh = prof.viewport.height; const vw = prof.viewport.width;
  const rows = await page.$$eval('.as-row', (rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height)));
  rec('S1 compact rows (<= 64 px) for every section', rows.length > 0 && Math.max(...rows) <= 64, `${rows.length} rows ${Math.min(...rows)}-${Math.max(...rows)} px; summary block height ${await page.$eval('#as-rows', (e) => Math.round(e.getBoundingClientRect().height))}`);
  const gaps = await page.$$eval('.as-gap', (g) => g.length);
  info('S1', `gap rows on the real file: ${gaps}`);
  // truncation: any text inside the sync overlay clipped horizontally; page-level horizontal overflow
  const clip = await page.evaluate(() => {
    const root = document.querySelector('.rec.sync') || document.body; const out = [];
    for (const e of root.querySelectorAll('*')) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const cs = getComputedStyle(e);
      const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const over = e.scrollWidth > e.clientWidth + 1;
      const ell = cs.textOverflow === 'ellipsis';
      const off = r.right > innerWidth + 0.5 || r.left < -0.5;
      if ((over && (cs.overflowX !== 'visible')) || (ell && over) || off) out.push({ tag: e.tagName, cls: e.className.toString().slice(0, 25), id: e.id, over, ell, off, sw: e.scrollWidth, cw: e.clientWidth, len: e.textContent.trim().length, txt: e.className.toString().includes('as-sub') ? e.textContent.trim() : '' });
    }
    return { out, docOverflow: document.scrollingElement.scrollWidth > innerWidth + 1 };
  });
  rec('S2 no text clipped / ellipsised / outside the screen in the sync screen', clip.out.length === 0 && !clip.docOverflow, JSON.stringify(clip).slice(0, 400));
  info('S2', 'clipped texts (UI state words only): ' + clip.out.map((c) => c.txt).filter(Boolean).join(' | '));
  await page.evaluate(() => { const r = document.querySelector('.as-row'); r.scrollIntoView({ block: 'start' }); });
  await shot(page, 'sync-rows');
  // buttons on the row: sizes
  const btns = await page.$$eval('.as-row .as-act', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  rec('S3 row buttons >= 44 px', btns.length > 0 && btns.every(([w, h]) => w >= 44 && h >= 44), `${btns.length} buttons`);
  // fixed bar "Fatto"
  const doneBox = () => page.evaluate(() => { const r = document.querySelector('#sync-close').getBoundingClientRect(); const f = document.querySelector('#sync-foot'); return { top: Math.round(r.top), bottom: Math.round(r.bottom), pos: getComputedStyle(f).position, vh: innerHeight, w: Math.round(r.width), h: Math.round(r.height) }; });
  const d0 = await doneBox();
  rec('S4 "Fatto" visible now', d0.bottom <= d0.vh && d0.top >= 0 && d0.pos === 'fixed', JSON.stringify(d0));
  // scroll in steps; "Fatto" must be in view in every position
  const scroller = '.rec.sync';
  const maxS = await page.evaluate((s) => { const o = document.querySelector(s); return o.scrollHeight - o.clientHeight; }, scroller);
  let allIn = true; const pos = [];
  for (let y = 0; y <= maxS; y += Math.max(120, Math.floor(maxS / 8))) {
    await page.evaluate(([s, y]) => { document.querySelector(s).scrollTop = y; }, [scroller, y]);
    await sleep(60);
    const d = await doneBox(); const hit = await page.evaluate(() => { const r = document.querySelector('#sync-close').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e && (e.id === 'sync-close' || e.closest('#sync-close')) ? 1 : 0; });
    pos.push(`${y}:${d.top}-${d.bottom}${hit ? '' : '(COVERED)'}`);
    if (!(d.top >= 0 && d.bottom <= d.vh && hit)) allIn = false;
  }
  rec('S5 "Fatto" in view and tappable at every scroll position', allIn, `scrollable ${maxS}px; ${pos.slice(0, 4).join(' ')} ...`);
  await page.evaluate(([s]) => { document.querySelector(s).scrollTop = 0; }, [scroller]);
  await shot(page, 'sync-top');
  await page.evaluate(([s]) => { const o = document.querySelector(s); o.scrollTop = o.scrollHeight; }, [scroller]);
  await shot(page, 'sync-bottom');
  // notices: trigger several and check they never cover a row or the bar's buttons
  const cover = async (label) => {
    const g = await page.evaluate(() => {
      const t = document.querySelector('#sync-msg'); if (!t || getComputedStyle(t).display === 'none') return { shown: false };
      const tr = t.getBoundingClientRect(); const f = document.querySelector('#sync-foot').getBoundingClientRect();
      const btnRects = [...document.querySelectorAll('#sync-foot button')].map((b) => b.getBoundingClientRect());
      const hitsBtn = btnRects.some((b) => !(tr.right <= b.left || tr.left >= b.right || tr.bottom <= b.top || tr.top >= b.bottom));
      const rowsHit = [...document.querySelectorAll('.as-row')].filter((r) => { const b = r.getBoundingClientRect(); const vis = Math.min(b.bottom, f.top); return vis > b.top && b.bottom > 0 && !(tr.right <= b.left || tr.left >= b.right || tr.bottom <= b.top || tr.top >= vis); }).length;
      const insideBar = tr.top >= f.top - 1; const barBg = getComputedStyle(document.querySelector('#sync-foot')).backgroundColor;
      return { shown: true, insideBar, barBg, text: t.textContent.slice(0, 50), top: Math.round(tr.top), bottom: Math.round(tr.bottom), footTop: Math.round(f.top), hitsBtn, rowsHit, h: Math.round(tr.height) };
    });
    return g;
  };
  await page.click('#as-accept'); await sleep(300);
  const c1 = await cover('accept');
  info('S6', `notice after Accetta: ${JSON.stringify(c1)}`);
  await shot(page, 'sync-notice');
  rec('S6 notice after Accetta covers no row and no button of the bar', !c1.shown || (!c1.hitsBtn && c1.rowsHit === 0), JSON.stringify(c1));
  // a long notice: the partial correction one
  const sec = 1;
  await page.evaluate(() => { document.querySelector('.rec.sync').scrollTop = 0; });
  await page.click(`.as-row[data-sec="${sec}"] [data-act="correct"]`);
  await page.waitForSelector('#corr-tap');
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  const t0 = await page.evaluate((s) => { const song = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); let k = 0, f = null; song.sections.forEach((sec, i) => sec.lines.forEach((l) => l.chords.forEach(() => { if (i === s && f === null) f = song.audio.alignment.eventStartSec[k]; k++; }))); return f; }, sec);
  await page.evaluate((t) => window.__gappSync.player.seek(t), t0); await sleep(80);
  await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 });
  await page.click('#corr-save');
  await page.waitForSelector('#corr-tap', { state: 'detached' });
  await sleep(300);
  const c2 = await cover('partial');
  info('S7', `notice after a partial save: ${JSON.stringify(c2)}`);
  rec('S7 the long notice (partial save) covers no row and no button of the bar', !c2.shown || (!c2.hitsBtn && c2.rowsHit === 0), JSON.stringify(c2));
  await shot(page, 'sync-notice-long');
  rec('Sz no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ E
async function perf() {
  const rate = Number(process.argv[4] || 4);
  const runs = Number(process.argv[5] || (rate === 4 ? 3 : 1));
  dev = `${devName}-x${rate}`;
  for (let r = 0; r < runs; r++) {
    const { browser, page, errors, cdp } = await open(PROFILES[devName], { throttle: rate });
    await cdp.send('Performance.enable');
    await loadReal(page, true);
    // heap sampling from the node side
    let peak = 0; let stop = false; const heap = [];
    const sampler = (async () => { while (!stop) { try { const m = (await cdp.send('Performance.getMetrics')).metrics; const h = m.find((x) => x.name === 'JSHeapUsedSize').value; peak = Math.max(peak, h); heap.push(h); } catch { /* page busy */ } await sleep(150); } })();
    const base = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'JSHeapUsedSize').value;
    const t1 = await page.evaluate(() => performance.now());
    await page.click('#as-start');
    await page.waitForSelector('#as-rows', { timeout: 900000 });
    const t2 = await page.evaluate(() => performance.now());
    stop = true; await sampler;
    const st = await page.evaluate(() => window.__gappAutosync);
    const g = await gapsBetween(page, t1, t2); const s = stat(g.gaps);
    // cancel latency on a fresh start: cancel at ~30%
    await page.click('#as-redo');
    await page.waitForFunction(() => { const p = document.querySelector('#as-progress'); return p && p.value >= 0.3; }, null, { timeout: 300000 });
    const tc = await page.evaluate(() => performance.now());
    await page.click('#as-cancel');
    await page.waitForSelector('#as-start, #as-rows', { timeout: 60000 });
    const td = await page.evaluate(() => performance.now());
    info('E', `run ${r + 1}: wall ${((t2 - t1) / 1000).toFixed(1)} s (app: decode ${st.decodeMs} ms, analysis ${st.analyseMs} ms, total ${st.totalMs} ms, its longest slice ${st.maxSliceMs} ms); frames ${s.n}; longest ${s.max.toFixed(0)} ms; > 100 ms ${s.over100}; > 250 ms ${s.over250}; long tasks ${g.long.length} (max ${Math.max(0, ...g.long).toFixed(0)} ms); cancel answered in ${(td - tc).toFixed(0)} ms; JS heap base ${(base / 1048576).toFixed(0)} MB, peak ${(peak / 1048576).toFixed(0)} MB (${heap.length} samples)`);
    if (rate === 4) { rec(`E${r + 1} total < 14 s at x4`, (t2 - t1) < 14000, `${((t2 - t1) / 1000).toFixed(1)} s`); rec(`E${r + 1} longest frame < 200 ms`, s.max < 200, `${s.max.toFixed(0)} ms`); }
    rec(`E${r + 1} no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await browser.close();
  }
}

// ------------------------------------------------------------------ E3: memory (process RSS, the JS heap does not count the decoded audio)
async function mem() {
  const { execSync } = require('child_process');
  dev = devName + '-mem';
  const rss = () => { try { return execSync("ps -eo rss,args | grep -i 'chrom' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim() * 1; } catch { return 0; } };
  const { browser, page, errors, cdp } = await open(PROFILES[devName]);
  await cdp.send('Performance.enable');
  await loadReal(page, true);
  await sleep(1000);
  const base = rss();
  let peak = 0; let peakHeap = 0; let stop = false;
  const sampler = (async () => { while (!stop) { peak = Math.max(peak, rss()); try { const m = (await cdp.send('Performance.getMetrics')).metrics; peakHeap = Math.max(peakHeap, m.find((x) => x.name === 'JSHeapUsedSize').value); } catch { /* busy */ } await sleep(120); } })();
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  stop = true; await sampler;
  await sleep(1500);
  const after = rss();
  info('E3', `all chromium processes RSS: before ${(base / 1024).toFixed(0)} MB, peak during decode+analysis ${(peak / 1024).toFixed(0)} MB (+${((peak - base) / 1024).toFixed(0)}), 1.5 s after the end ${(after / 1024).toFixed(0)} MB; JS heap peak ${(peakHeap / 1048576).toFixed(0)} MB`);
  rec('E3 no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

(async () => {
  if (!fs.existsSync(SYN) && (mode === 'correct' || mode === 'disabled')) { console.log('run node test/e2e/round7-tester-make.mjs first'); process.exit(1); }
  if (!fs.existsSync(MP3) && (mode === 'sync' || mode === 'perf' || mode === 'panel' || mode === 'mem')) { console.log('real mp3 absent: skip'); return; }
  await ({ correct, disabled, panel, sync, perf, mem }[mode])();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
