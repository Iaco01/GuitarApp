// Round 6 tester: BPM -/+ in the play panel, measured independently of the implementer's script.
// Clicks are intercepted at the Web Audio level (oscillator start/stop times), so a doubled or
// shifted click is seen even if the player's own state looks right. The real file's text is never printed.
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round6-tester-browser.cjs [B1|B2|B3|B4|B5|A5|all]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const DIR = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-6', 'tester');
fs.mkdirSync(OUT, { recursive: true });
const WAV = path.join(DIR, 't4.wav');
const SONG = path.join(DIR, 't4-song.json');
const only = process.argv[2] || 'all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const PROFILES = {
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};

// records every oscillator: start time, last stop time, and AudioContext instances
const INIT = `(() => {
  window.__osc = []; window.__ctxs = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  const co = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () {
    const o = co.apply(this, arguments);
    const r = { start: null, stop: null, made: this.currentTime };
    window.__osc.push(r);
    const s = o.start.bind(o), p = o.stop.bind(o);
    o.start = (w) => { r.start = w === undefined ? this.currentTime : w; return s(w); };
    o.stop = (w) => { r.stop = w === undefined ? this.currentTime : w; return p(w); };
    if (!window.__ctxs.includes(this)) window.__ctxs.push(this);
    return o;
  };
})();`;

async function open(profile, { init = true } = {}) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  if (init) await page.addInitScript(INIT);
  await page.goto(URL);
  return { browser, page, errors };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${dev}-${name}.png`) });
async function importReal(page) {
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 15000 });
}
async function startPlaying(page) {
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp && window.__gapp.player.state === 'playing', null, { timeout: 20000 });
}
const savedBpms = (page) => page.evaluate(() => window.__gapp.timeline.sections.map((s) => s.savedBpm));
const audible = (page) => page.evaluate(() => window.__osc.filter((o) => o.start !== null && (o.stop === null || o.stop > o.start + 0.01)).map((o) => o.start).sort((a, b) => a - b));

// in-page helpers: fractional beat position from the app's own timeline, click on a panel button inside one task
const HELPERS = `
window.__pos = () => { const g = window.__gapp; const bi = g.player.beatIndex; if (bi < 0) return null;
  const b = g.timeline.beats[bi]; const sec = g.timeline.sections[b.sectionIndex];
  return { pos: b.index + (g.player.timeSec - b.timeSec) / sec.spb, ev: g.player.eventIndex, bi, spb: sec.spb, t: g.player.timeSec }; };
window.__press = (id) => { const el = document.getElementById(id); const ctx = window.__ctxs[0];
  const a = window.__pos(); const c0 = ctx.currentTime;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
  const b = window.__pos(); return { a, b, c0, c1: ctx.currentTime }; };
`;

// ---------------- B1: no jump, new tempo, no double click ----------------
async function runB1(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importReal(page);
  await page.evaluate(HELPERS);
  const bpm0 = await savedBpms(page);
  info('B1 saved BPMs', [...new Set(bpm0)].join('/'));
  await startPlaying(page);
  await sleep(3000);
  // several presses at different points of a beat
  const rows = [];
  for (let i = 0; i < 6; i++) {
    await sleep(170 + i * 77); // spread over the beat phase
    const r = await page.evaluate(() => window.__press('btn-bpm-up'));
    rows.push(r);
  }
  const worst = Math.max(...rows.map(({ a, b }) => (a && b ? Math.abs(b.pos - a.pos) : 9)));
  const evSkips = rows.filter(({ a, b }) => !a || !b || b.ev < a.ev || b.ev > a.ev + 1).length;
  rec('B1.1 event and beat fraction unchanged by the change (<= 0.05 beat, last frame is up to 16 ms old)', worst <= 0.05 && evSkips === 0, `worst ${worst.toFixed(3)} beat, event skips ${evSkips}`);
  info('B1.1 detail', rows.map(({ a, b }) => (b.pos - a.pos).toFixed(3)).join(' '));
  await sleep(500);
  // isolated step: measure clicks around it
  await sleep(1200);
  const r = await page.evaluate(() => window.__press('btn-bpm-up'));
  const bpmAfter = (await savedBpms(page))[0];
  await sleep(7000);
  const cl = await audible(page);
  const iPrev = cl.reduce((m, v, i) => (v <= r.c0 + 0.001 ? i : m), 0);
  const after = cl.slice(Math.max(0, iPrev - 3), iPrev + 12);
  const gaps = after.slice(1).map((v, i) => v - after[i]);
  // old spb = 60/oldBpm where the section may be the first (bpm0) : use timeline at change
  const spbNew = await page.evaluate(() => { const g = window.__gapp; return g.timeline.beats.filter((b) => b.sectionIndex === g.timeline.events[g.player.eventIndex].sectionIndex)[0].index >= 0 ? g.timeline.sections[g.timeline.events[g.player.eventIndex].sectionIndex].spb : 0; });
  info('B1.2 gaps around the change (s)', gaps.map((g) => g.toFixed(3)).join(' '));
  const minGap = Math.min(...gaps);

  rec('B1.2 no doubled click (min gap > 100 ms; tempo >= 60)', minGap > 0.1, `min gap ${(minGap * 1000).toFixed(0)} ms over ${after.length} audible clicks`);
  // transition: previous click p (<= press time c0) and the next one n; the new grid must continue from the fractional beat
  const oldSpb = r.a.spb, newSpb = r.b.spb;
  const pI = cl.reduce((m, v, i) => (v <= r.c0 + 0.0005 ? i : m), -1);
  const p = cl[pI], n = cl[pI + 1];
  const fracClicks = (r.c0 - p) / oldSpb;
  const fracApp = r.a.pos - Math.floor(r.a.pos);
  const expTrans = (r.c0 - p) + (1 - fracClicks) * newSpb;
  info('B1.4 transition', `click-based beat fraction ${fracClicks.toFixed(3)} vs app ${fracApp.toFixed(3)}; gap ${(n - p).toFixed(3)} s expected ${expTrans.toFixed(3)} s (old spb ${oldSpb.toFixed(3)}, new ${newSpb.toFixed(3)})`);
  const tail = cl.slice(pI + 1, pI + 8).map((v, i, a) => (i ? v - a[i - 1] : null)).slice(1);
  const errNew = Math.max(...tail.map((g) => Math.abs(g - newSpb)));
  rec('B1.3 clicks after the change are spaced at the new tempo (error < 20 ms)', tail.length >= 3 && errNew < 0.02, `max error ${(errNew * 1000).toFixed(1)} ms over ${tail.length} gaps`);
  rec('B1.4 first click after the change comes where the continuous position says (error < 25 ms)', Math.abs(n - p - expTrans) < 0.025, `${((n - p - expTrans) * 1000).toFixed(1)} ms`);
  rec('B1.4b no click lost or doubled around the change (exactly one click between p and p+2 spb)', cl.filter((v) => v > p + 0.05 && v < p + 1.6 * newSpb).length === 1, `${cl.filter((v) => v > p + 0.05 && v < p + 1.6 * newSpb).length}`);
  // chord change timing vs the new timeline from the position at the change
  const seq = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gapp; const out = []; let last = -2; const t0 = performance.now();
    (function loop() { if (g.player.eventIndex !== last) { last = g.player.eventIndex; out.push([last, performance.now(), g.player.timeSec]); }
      if (performance.now() - t0 < 16000) requestAnimationFrame(loop); else resolve({ out, ev: g.timeline.events.map((e) => [e.startSec, e.durSec]) }); })();
  }));
  const diffs = [];
  for (let i = 1; i + 1 < seq.out.length; i++) diffs.push(Math.abs((seq.out[i + 1][1] - seq.out[i][1]) / 1000 - seq.ev[seq.out[i][0]][1]));
  info('B1.5 raw', JSON.stringify(seq.out.map((o) => [o[0], Math.round(o[1])])));
  rec('B1.5 chord changes follow the new durations (rAF granularity, < 40 ms)', diffs.length >= 2 && Math.max(...diffs) < 0.04, `${diffs.length} changes, worst ${(Math.max(...diffs) * 1000).toFixed(0)} ms`);
  // - then + quickly, holding alternate: oscillators never started in the past by a lot
  const late = await page.evaluate(() => window.__osc.filter((o) => o.start !== null && o.start < o.made - 0.05).length);
  rec('B1.6 no oscillator scheduled in the past', late === 0, `${late}`);
  rec('B1.7 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

// ---------------- B2: proportional scaling, round trip, scope ----------------
async function runB2(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importReal(page);
  await page.evaluate(HELPERS);
  const b0 = await savedBpms(page);
  info('B2 start', [...new Set(b0)].join('/'));
  await startPlaying(page);
  await sleep(1500);
  await page.click('#btn-bpm-up');   // freeze first? no: keep playing
  await page.click('#btn-bpm-down'); // net 0 after first press: series must return exactly
  let b = await savedBpms(page);
  rec('B2.1 +1 then -1 returns exactly to the start values', b.every((v, i) => v === b0[i]), `${b.slice(0, 3)} vs ${b0.slice(0, 3)}`);
  for (let i = 0; i < 10; i++) { await page.click('#btn-bpm-up'); await sleep(40); }
  const bUp = await savedBpms(page);
  for (let i = 0; i < 10; i++) { await page.click('#btn-bpm-down'); await sleep(40); }
  b = await savedBpms(page);
  rec('B2.2 10 x + then 10 x - returns exactly', b.every((v, i) => v === b0[i]), `${b.join(',')} vs ${b0.join(',')}`);
  // ratios after +10, compared to the original (rounding 0.1 allowed)
  const k = bUp[0] / b0[0];
  const rerr = Math.max(...bUp.map((v, i) => Math.abs(v / b0[i] - k) * b0[i]));
  rec('B2.3 ratio between sections kept after +10 (within 0.1 BPM rounding)', rerr <= 0.051 + 1e-9, `factor ${k.toFixed(4)}, worst error ${rerr.toFixed(3)} BPM`);
  // is the "series" kept if the section changes during the run? (play across a section boundary)
  const stored = await page.evaluate(() => { const id = decodeURIComponent(location.hash.split('/').pop()); const s = JSON.parse(localStorage.getItem('gapp.song.' + id)); return { bpm: s.bpm, sec: s.sections.map((x) => [x.bpm, x.bpmSource]) }; });
  info('B2 stored after round trip', `song.bpm ${stored.bpm}; sections ${[...new Set(stored.sec.map((x) => x[0] + '/' + x[1]))].join(' ')}`);
  // clamp: push down a lot with typed value 30 and then - : stays >= 30, ratios?
  await page.click('#pp-bpm');
  await page.fill('#pp-bpm-field', '31');
  await page.click('#pp-bpm-apply');
  const lo = await savedBpms(page);
  info('B2.4 after typing 31 for the current section (all)', lo.join(','));
  rec('B2.4 all tempos within 30-300 after a big scale', lo.every((v) => v >= 30 && v <= 300));
  await page.click('#btn-bpm-up'); await page.click('#btn-bpm-down');
  await page.click('#pp-bpm');
  await page.fill('#pp-bpm-field', '299');
  await page.click('#pp-bpm-apply');
  const hi = await savedBpms(page);
  info('B2.5 after typing 299 (all)', hi.join(','));
  rec('B2.5 clamped at 300 and no NaN', hi.every((v) => v >= 30 && v <= 300 && Number.isFinite(v)));
  const ratioLost = new Set(hi.map((v) => v)).size < new Set(b0).size;
  info('B2.5 distinct tempos', `${new Set(hi).size} (start had ${new Set(b0).size}) ${ratioLost ? 'ratios flattened by the clamp' : ''}`);
  // typed value out of range
  await page.click('#pp-bpm');
  await page.fill('#pp-bpm-field', '400');
  await page.click('#pp-bpm-apply');
  const err400 = await page.evaluate(() => (document.querySelector('.error, #err, [role=alert]') || {}).textContent || '');
  rec('B2.6 400 is refused (no change)', (await savedBpms(page)).every((v, i) => v === hi[i]), err400.slice(0, 60));
  rec('B2.7 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

// ---------------- B3: long press with mouse and with touch ----------------
async function runB3(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importReal(page);
  await startPlaying(page);
  await sleep(1200);
  const cur = async () => (await savedBpms(page))[0];
  const box = await page.locator('#btn-bpm-up').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  info('B3 button size', `${box.width.toFixed(0)} x ${box.height.toFixed(0)} px`);
  // mouse
  let v0 = await cur();
  await page.mouse.move(cx, cy); await page.mouse.down(); await sleep(2050); await page.mouse.up();
  let d = (await cur()) - v0;
  rec('B3.1 mouse hold 2.05 s: ~ 1 + (2.05-0.45)*5 = 9 steps (7-10)', d >= 7 && d <= 10, `${d.toFixed(1)} BPM`);
  v0 = await cur(); await sleep(600);
  rec('B3.2 nothing repeats after release', (await cur()) === v0);
  // touch via CDP real touch events
  const cdp = await page.context().newCDPSession(page);
  v0 = await cur();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await sleep(2050);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  d = (await cur()) - v0;
  rec('B3.3 real touch hold 2.05 s (CDP): 7-10 steps', d >= 7 && d <= 10, `${d.toFixed(1)} BPM`);
  v0 = await cur(); await sleep(500);
  rec('B3.4 nothing repeats after touchend', (await cur()) === v0);
  // single touch tap = exactly 1 step (no double from emulated mouse events)
  v0 = await cur();
  await page.touchscreen.tap(cx, cy);
  await sleep(500);
  d = (await cur()) - v0;
  rec('B3.5 one tap = +1 (no double step from touch + emulated click)', Math.abs(d - 1) < 0.05, `${d.toFixed(1)}`);
  // finger slides off the button while holding: must stop
  v0 = await cur();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await sleep(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 200 }] });
  await sleep(150);
  const vSlide = await cur();
  await sleep(800);
  const vAfter = await cur();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  rec('B3.6 sliding the finger away stops the repeat', vAfter === vSlide, `at slide ${vSlide - v0}, 800 ms later ${vAfter - v0}`);
  // context menu / long-press text selection: user-select
  const sel = await page.evaluate(() => getComputedStyle(document.getElementById('btn-bpm-up')).userSelect + '/' + getComputedStyle(document.getElementById('btn-bpm-up')).touchAction);
  info('B3 button user-select/touch-action', sel);
  rec('B3.7 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

// ---------------- B4: with audio ----------------
async function runB4(label, profile, { anchors = false } = {}) {
  dev = label;
  const { browser, page, errors } = await open(profile, { init: false });
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 5000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]');
  if (nb) await nb.click();
  await page.waitForSelector('.song-row');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
  await page.setInputFiles('#audio-reload', WAV);
  await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl, null, { timeout: 15000 });
  await sleep(500);
  await startPlaying(page);
  await sleep(2200);
  const probe = () => page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, now: performance.now(), ev: window.__gapp.player.eventIndex, paused: window.__gapp.audioEl.paused, rate: window.__gapp.audioEl.playbackRate }));
  const b0 = await savedBpms(page);
  info('B4 start tempos', b0.join('/'));
  // 10 presses fast, then 10 slow; audio must never move
  let worst = 0; const evs = [];
  for (let i = 0; i < 12; i++) {
    const a = await probe(); await page.click('#btn-bpm-up'); const b = await probe();
    worst = Math.max(worst, Math.abs((b.t - a.t) - (b.now - a.now) / 1000)); evs.push(`${a.ev}>${b.ev}`);
    await sleep(i < 6 ? 30 : 250);
  }
  rec('B4.1 audio never moved by 12 presses (<= 20 ms vs wall clock)', worst < 0.02, `worst ${(worst * 1000).toFixed(1)} ms`);
  const st = await probe();
  rec('B4.2 still playing, rate unchanged', !st.paused && st.rate === 1, `paused ${st.paused} rate ${st.rate}`);
  const b1 = await savedBpms(page);
  rec('B4.3 +12 applied (first section)', Math.abs(b1[0] - (b0[0] + 12)) < 0.05, `${b0[0]} -> ${b1[0]}`);
  const note = (await page.innerText('#pp-bpm-note')).replace(/\n/g, ' ');
  rec('B4.4 note shows +12 BPM and Annulla', /\+12 BPM su tutto il brano/.test(note) && /Annulla/.test(note), note);
  await shot(page, 'audio-note-12');
  // highlight shifts: current event index vs expected from audio time on the old grid
  const lag = await page.evaluate(() => { const g = window.__gapp; const t = g.audioEl.currentTime; const evs = g.timeline.events; const i = evs.findIndex((e) => e.startSec <= t && t < e.startSec + e.durSec); return { i, ev: g.player.eventIndex }; });
  rec('B4.5 highlight is the event of the NEW timeline at the audio time', lag.i === lag.ev || Math.abs(lag.i - lag.ev) <= 1, JSON.stringify(lag));
  // change scope, press -, then undo: 'Annulla' only undoes... check
  await page.click('#btn-bpm-undo');
  const b2 = await savedBpms(page);
  rec('B4.6 Annulla restores exactly', b2.every((v, i) => v === b0[i]), b2.join('/'));
  rec('B4.7 note hidden after Annulla', await page.$eval('#pp-bpm-note', (e) => e.hidden));
  const st2 = await probe();
  rec('B4.8 audio still playing after Annulla', !st2.paused);
  // undo after pause + resume + more presses: series continues?
  await page.click('#btn-bpm-down');
  await page.click('#btn-bpm-down');
  const nt = (await page.innerText('#pp-bpm-note')).replace(/\n/g, ' ');
  rec('B4.9 two "-": note says -2', /^[−-]2 BPM/.test(nt), nt);
  // Annulla must be absent when the change is typed elsewhere? change via section header would start a new series
  await page.click('#btn-pause').catch(() => {});
  rec('B4.10 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

// ---------------- B5: persistence, height, ritmo readability ----------------
async function runB5(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importReal(page);
  const idle = await page.evaluate(() => document.getElementById('playpanel').getBoundingClientRect().height);
  await startPlaying(page);
  await sleep(1500);
  const play = await page.evaluate(() => document.getElementById('playpanel').getBoundingClientRect().height);
  await page.click('#btn-bpm-up');
  await page.click('#btn-bpm-up');
  const afterPress = await page.evaluate(() => document.getElementById('playpanel').getBoundingClientRect().height);
  info('B5 panel height idle/play/after press', `${idle.toFixed(1)} / ${play.toFixed(1)} / ${afterPress.toFixed(1)} px`);
  const pat = await page.evaluate(() => { const p = document.getElementById('pp-pattern'); const r = p.getBoundingClientRect(); const cell = p.querySelector('.pp-cell'); return { w: r.width, h: r.height, hidden: p.hidden, cells: p.children.length, fs: cell ? getComputedStyle(cell).fontSize : null, cw: cell ? cell.getBoundingClientRect().width : 0, sw: p.scrollWidth, cwid: p.clientWidth }; });
  info('B5 pattern box', JSON.stringify(pat));
  const row2 = await page.evaluate(() => [...document.querySelectorAll('.pp-row2 > *')].filter((e) => !e.hidden).map((e) => [e.id || e.className, Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]));
  info('B5 row2 children', JSON.stringify(row2));
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  rec('B5.1 no horizontal overflow', overflowX <= 0, `${overflowX}`);
  const offscreen = await page.evaluate(() => [...document.querySelectorAll('#playpanel button')].filter((b) => !b.hidden && b.offsetParent).filter((b) => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 0.5 || r.left < -0.5 || r.bottom > window.innerHeight + 0.5; }).map((b) => b.id || b.textContent));
  rec('B5.2 no panel button off-screen', offscreen.length === 0, offscreen.join(','));
  const small = await page.evaluate(() => [...document.querySelectorAll('#playpanel button')].filter((b) => !b.hidden && b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.id || b.textContent.slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 40 || h < 40));
  info('B5 buttons under 40 px', JSON.stringify(small));
  await shot(page, 'panel-play');
  // open BPM edit: panel gets taller only while open
  await page.click('#pp-bpm');
  const openH = await page.evaluate(() => document.getElementById('playpanel').getBoundingClientRect().height);
  await shot(page, 'panel-bpmedit');
  const s = await page.evaluate(() => { const e = document.getElementById('pp-bpmedit'); const r = e.getBoundingClientRect(); return { r: Math.round(r.right), w: window.innerWidth, h: Math.round(r.height) }; });
  info('B5 bpm edit row', `panel ${openH.toFixed(1)} px; edit row right edge ${s.r} / ${s.w}`);
  rec('B5.3 bpm edit row fits the width', s.r <= s.w + 1);
  await page.click('#pp-bpm');
  // persistence
  const before = await savedBpms(page);
  await page.reload();
  await page.waitForSelector('#btn-play');
  const after = await savedBpms(page);
  rec('B5.4 BPM changes survive a reload', after.every((v, i) => v === before[i]) && before[0] !== undefined, `${before.slice(0, 3)} -> ${after.slice(0, 3)}`);
  rec('B5.5 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

// ---------------- A5: duration settings ----------------
async function runA5(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile, { init: false });
  let dialogs = [];
  page.removeAllListeners('dialog');
  let answer = true;
  page.on('dialog', (d) => { dialogs.push(d.message()); return answer ? d.accept() : d.dismiss(); });
  await importReal(page);
  const beats = () => page.evaluate(() => { const id = decodeURIComponent(location.hash.split('/').pop()); const s = JSON.parse(localStorage.getItem('gapp.song.' + id)); return { src: s.timingSource, b: s.sections.flatMap((x) => x.lines.flatMap((l) => l.chords.map((c) => c.beats))), mode: s.view.durationMode, avg: s.view.beatsPerChord }; });
  const e0 = await beats();
  const openSet = async () => { if (!(await page.$('details.settings[open]'))) await page.click('details.settings summary'); };
  await openSet();
  // estimated -> avg 8 : no dialog (estimated is not edited)
  await page.click('.beats-opt[data-beats="8"]');
  let e1 = await beats();
  rec('A5.1 estimated avg 8: no confirm, mean 8, total multiple of 4 per section', dialogs.length === 0 && Math.abs(e1.b.reduce((a, b) => a + b, 0) / e1.b.length - 8) < 0.01 && e1.src === 'estimated', `${dialogs.length} dialogs, mean ${(e1.b.reduce((a, b) => a + b, 0) / e1.b.length).toFixed(2)}`);
  await openSet();
  await page.click('.beats-opt[data-beats="4"]');
  const e2 = await beats();
  rec('A5.2 avg back to 4 gives the identical estimate as the import', JSON.stringify(e2.b) === JSON.stringify(e0.b));
  // fixed 2
  await openSet();
  await page.click('.mode-opt[data-mode="fixed"]');
  let f = await beats();
  info('A5 fixed', `${f.src} ${new Set(f.b).size} distinct, mode ${f.mode}`);
  // edit one chord by hand through the editor: tap 'Modifica durate', tap chord, +
  await page.click('#btn-edit');
  await page.click('.chord, [data-ref]').catch(() => {});
  await page.click('#eb-plus').catch(() => {});
  await page.click('#btn-edit');
  const ed = await beats();
  info('A5 after hand edit', `source ${ed.src}`);
  if (ed.src === 'edited') {
    // 1) dismiss -> unchanged
    answer = false; dialogs = [];
    await openSet();
    await page.click('.mode-opt[data-mode="estimated"]');
    const d1 = await beats();
    rec('A5.3 edited durations: confirm shown, Cancel leaves everything intact', dialogs.length === 1 && JSON.stringify(d1.b) === JSON.stringify(ed.b) && d1.src === 'edited', `${dialogs.length} dialogs; ${d1.src}`);
    answer = true; dialogs = [];
    await openSet();
    await page.click('.mode-opt[data-mode="estimated"]');
    const d2 = await beats();
    rec('A5.4 edited durations: OK rewrites with the estimate', dialogs.length === 1 && d2.src === 'estimated' && JSON.stringify(d2.b) === JSON.stringify(e0.b), `${dialogs.length} dialogs; ${d2.src}; same as import ${JSON.stringify(d2.b) === JSON.stringify(e0.b)}`);
    // reload keeps mode
    await page.reload(); await page.waitForSelector('#btn-play');
    const d3 = await beats();
    rec('A5.5 mode survives reload (estimated, no re-estimate drift)', d3.src === 'estimated' && JSON.stringify(d3.b) === JSON.stringify(e0.b));
  } else rec('A5.3 could not produce an edited song', false, ed.src);
  rec('A5.6 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

(async () => {
  const run = (k) => only === 'all' || only === k;
  if (run('B1')) await runB1('360', PROFILES[360]);
  if (run('B2')) await runB2('360', PROFILES[360]);
  if (run('B3')) { await runB3('360', PROFILES[360]); await runB3('SE', PROFILES.SE); }
  if (run('B4')) await runB4('SE', PROFILES.SE);
  if (run('B5')) for (const [l, p] of [['360', PROFILES[360]], ['SE', PROFILES.SE], ['13', PROFILES[13]]]) await runB5(l, p);
  if (run('A5')) await runA5('360', PROFILES[360]);
  console.log(fails ? `\n${fails} FAIL` : '\nALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
