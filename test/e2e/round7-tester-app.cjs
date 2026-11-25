// Round 7 tester, part C: automatic sync in the app (Playwright), real mp3 and my own synthetic track.
// Prepare: npm run build && node test/e2e/round7-tester-make.mjs
// Run: node test/e2e/round7-tester-app.cjs <cancel|perf|synth|persist> [360|SE|13]
//   cancel  C1: real mp3, start -> cancel half way (responsiveness) -> redo -> summary colours -> Accetta
//   perf    C2: real mp3 with CPU x4: total time, longest frame, long tasks, cancel latency
//   synth   C3-C6: synthetic track: highlight error per event, tapping correction (+80 ms, skipped tap), export, interactions
//   persist C7: reload, library export/import with the alignment
// The real file's text is never printed or committed. Screenshots go to test-artifacts/round-7/tester/ (ignored by git).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-7', 'tester');
const SYN = path.join(OUT, 'r7.mp3');
const SYN_SONG = path.join(OUT, 'r7-song.json');
const TRUTH = JSON.parse(fs.existsSync(path.join(OUT, 'r7-truth.json')) ? fs.readFileSync(path.join(OUT, 'r7-truth.json'), 'utf8') : '{"truth":[]}').truth;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'cancel';
const devName = process.argv[3] || 'SE';
let fails = 0; let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const PROFILES = {
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${dev}-${name}.png`) });

async function open(profile, { throttle = 1 } = {}) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  if (throttle > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  // frame-gap and long-task recorder, running from the very start
  await page.addInitScript(() => {
    window.__gaps = []; window.__long = [];
    let last = performance.now();
    (function loop(t) { const n = performance.now(); window.__gaps.push([n, n - last]); last = n; requestAnimationFrame(loop); })(0);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
  });
  await page.goto(URL);
  return { browser, ctx, page, errors };
}
const songId = (page) => page.evaluate(() => decodeURIComponent(location.hash.split('/').pop()));
const readSong = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))));
async function loadReal(page) {
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 20000 });
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3);
  await page.waitForSelector('#as-start', { timeout: 30000 });
}
async function loadSynth(page) {
  await page.setInputFiles('#import-json', SYN_SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]');
  if (nb) await nb.click();
  await page.waitForSelector('.song-row');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', SYN);
  await page.waitForSelector('#as-start', { timeout: 30000 });
}
// frame gaps (ms) recorded between two performance.now() instants
const gapsBetween = (page, a, b) => page.evaluate(([a, b]) => ({ gaps: window.__gaps.filter(([t]) => t >= a && t <= b).map((g) => g[1]), long: window.__long.filter(([t]) => t >= a && t <= b).map((g) => g[1]) }), [a, b]);
const stat = (v) => { const s = v.slice().sort((x, y) => x - y); return { n: s.length, max: Math.max(0, ...s), p99: s[Math.floor(s.length * 0.99)] || 0, over100: s.filter((x) => x > 100).length, over250: s.filter((x) => x > 250).length }; };

// ---------------------------------------------------------------- C1
async function cancel() {
  dev = devName;
  const { browser, page, errors } = await open(PROFILES[devName]);
  await loadReal(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.click('#as-start');
  await page.waitForSelector('#as-progress');
  await page.waitForFunction(() => { const p = document.querySelector('#as-progress'); return p && p.value >= 0.3; }, null, { timeout: 60000 });
  const mid = await page.evaluate(() => ({ v: document.querySelector('#as-progress').value, t: document.querySelector('#as-prog-text').textContent, hasCancel: !!document.querySelector('#as-cancel'), startGone: !document.querySelector('#as-start') }));
  info('C1', `mid-run: ${JSON.stringify(mid)}`);
  await shot(page, 'c1-progress');
  const tc = await page.evaluate(() => performance.now());
  await page.click('#as-cancel');
  await page.waitForSelector('#as-start', { timeout: 15000 });
  const tDone = await page.evaluate(() => performance.now());
  const g = await gapsBetween(page, tc, tDone);
  rec('C1a cancel: the start button comes back quickly', tDone - tc < 3000, `${(tDone - tc).toFixed(0)} ms after the click; longest frame ${stat(g.gaps).max.toFixed(0)} ms`);
  const msg = await page.evaluate(() => (document.body.innerText.match(/Sincronizzazione annullata\.?/) || [''])[0]);
  rec('C1b cancel: message says cancelled, no results, no alignment saved', /annullata/i.test(msg) && !(await page.$('#as-rows')) && !(await readSong(page)).audio.alignment, JSON.stringify(msg));
  const gAll = await gapsBetween(page, t0, tDone);
  const sAll = stat(gAll.gaps);
  info('C1', `during run+cancel: frames ${sAll.n}, longest frame ${sAll.max.toFixed(0)} ms, p99 ${sAll.p99.toFixed(0)} ms, frames >100 ms: ${sAll.over100}, long tasks ${gAll.long.length} (max ${Math.max(0, ...gAll.long).toFixed(0)} ms)`);
  await shot(page, 'c1-cancelled');
  // redo: complete the run, in full
  const t1 = Date.now();
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  info('C1', `redo after cancel finished in ${Date.now() - t1} ms`);
  const stats = await page.evaluate(() => window.__gappAutosync);
  rec('C1c redo after cancel completes with 328 events', stats.events === 328, JSON.stringify(stats));
  const rows = await page.$$eval('.as-row', (rs) => rs.map((r) => ({ state: r.dataset.state, label: (r.querySelector('.as-state, .as-label') || {}).textContent || '', dot: getComputedStyle(r.querySelector('.as-dot')).backgroundColor })));
  info('C1', `states ${rows.map((r) => r.state).join(',')}`);
  const byState = {};
  rows.forEach((r) => { (byState[r.state] = byState[r.state] || new Set()).add(r.dot); });
  rec('C1d every state has its own colour, and states differ', Object.values(byState).every((s) => s.size === 1) && new Set(rows.map((r) => r.dot)).size === Object.keys(byState).length, JSON.stringify(Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, [...v]]))));
  const text = await page.innerText('#as-rows');
  rec('C1e state is also written in words (not colour only)', /sicura|da controllare|incerta/i.test(text), '');
  await page.evaluate(() => document.querySelector('#as-box').scrollIntoView());
  await shot(page, 'c1-summary');
  await page.click('#as-accept');
  await page.waitForSelector('#as-accepted');
  rec('C1f "Accetta" marks it accepted and persists it', (await readSong(page)).audio.alignment.accepted === true);
  // cancel with the page: a second start immediately followed by cancel at the very beginning (decoding)
  await page.click('#as-redo');
  await page.waitForSelector('#as-cancel', { timeout: 5000 });
  await page.click('#as-cancel');
  await page.waitForSelector('#as-start, #as-rows', { timeout: 15000 });
  const kept = await page.evaluate(() => !!document.querySelector('#as-rows'));
  info('C1', `after "Rifai" then immediate Annulla: summary of the previous result ${kept ? 'is still shown' : 'is gone (back to the start button)'}; alignment saved: ${!!(await readSong(page)).audio.alignment}`);
  rec('C1g no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

// ---------------------------------------------------------------- C2
async function perf() {
  dev = devName + '-x4';
  const { browser, page, errors } = await open(PROFILES[devName], { throttle: 4 });
  await loadReal(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.click('#as-start');
  await page.waitForSelector('#as-progress');
  // cancel latency in the middle, under x4
  await page.waitForFunction(() => { const p = document.querySelector('#as-progress'); return p && p.value >= 0.3; }, null, { timeout: 120000 });
  const tc = await page.evaluate(() => performance.now());
  await page.click('#as-cancel');
  await page.waitForSelector('#as-start', { timeout: 30000 });
  const tDone = await page.evaluate(() => performance.now());
  rec('C2a cancel under CPU x4 answers within 3 s', tDone - tc < 3000, `${(tDone - tc).toFixed(0)} ms`);
  // full run
  const t1 = await page.evaluate(() => performance.now());
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 600000 });
  const t2 = await page.evaluate(() => performance.now());
  const st = await page.evaluate(() => window.__gappAutosync);
  const g = await gapsBetween(page, t1, t2);
  const s = stat(g.gaps);
  info('C2', `wall ${((t2 - t1) / 1000).toFixed(1)} s; app says decode ${st.decodeMs} ms analysis ${st.analyseMs} ms total ${st.totalMs} ms; its longest slice ${st.maxSliceMs} ms`);
  info('C2', `rAF frames ${s.n}; longest frame ${s.max.toFixed(0)} ms; p99 ${s.p99.toFixed(0)} ms; frames > 100 ms: ${s.over100}; > 250 ms: ${s.over250}; long tasks (>50 ms) ${g.long.length}, max ${Math.max(0, ...g.long).toFixed(0)} ms`);
  rec('C2b total under 20 s at CPU x4', (t2 - t1) < 20000, `${((t2 - t1) / 1000).toFixed(1)} s`);
  rec('C2c longest frame under 1.5 s (page not frozen)', s.max < 1500, `${s.max.toFixed(0)} ms`);
  rec('C2e no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

// ---------------------------------------------------------------- C3-C6
async function synth() {
  dev = devName;
  const { browser, page, errors } = await open(PROFILES[devName]);
  await loadSynth(page);
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  const al = (await readSong(page)).audio.alignment;
  const st = await page.evaluate(() => window.__gappAutosync);
  info('C3', `analysis ${st.analyseMs} ms, decode ${st.decodeMs} ms; transposeFound ${al.transposeFound}; section states ${(await page.$$eval('.as-row', (r) => r.map((x) => x.dataset.state[0]).join('')))}`);
  const err0 = al.eventStartSec.map((t, j) => Math.abs(t - TRUTH[j]));
  const within = (a, th) => (100 * a.filter((v) => v <= th).length / a.length).toFixed(1);
  info('C3', `alignment saved by the app vs truth: ${within(err0, 0.1)}% / ${within(err0, 0.25)}% / ${within(err0, 0.5)}% within 100/250/500 ms; mean ${(1000 * err0.reduce((a, b) => a + b, 0) / err0.length).toFixed(0)} ms, max ${(1000 * Math.max(...err0)).toFixed(0)} ms (events 61; free section = events 27-32)`);
  await page.evaluate(() => document.querySelector('#as-box').scrollIntoView());
  await shot(page, 'c3-summary');

  // C6c: the proposed transposition applies
  const hasT = await page.$('#as-apply-transpose');
  rec('C6c the transposition (+1) is proposed', !!hasT && al.transposeFound === 1, `found ${al.transposeFound}`);
  if (hasT) {
    await page.click('#as-apply-transpose');
    const s2 = await readSong(page);
    rec('C6d "Trasponi il foglio" sets song.transpose = 1 and the alignment is kept', s2.transpose === 1 && s2.audio.alignment && s2.audio.alignment.eventStartSec.length === 61, `transpose ${s2.transpose}`);
  }
  await page.click('#as-accept');

  // C3: play in the song view, highlight vs truth. Live play of the free section and of a stable one.
  await page.click('#sync-close');
  await page.waitForSelector('#btn-play');
  // (a) timeline start times of the events (what the highlight uses) vs truth
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp && window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  const tl = await page.evaluate(() => ({ aligned: !!window.__gapp.timeline.aligned, starts: window.__gapp.timeline.events.map((e) => e.startSec), rests: window.__gapp.timeline.events.length }));
  const errTl = tl.starts.map((t, j) => Math.abs(t - TRUTH[j]));
  rec('C3a play uses the aligned timeline', tl.aligned && tl.starts.length === 61);
  info('C3', `timeline starts vs truth: mean ${(1000 * errTl.reduce((a, b) => a + b, 0) / errTl.length).toFixed(0)} ms, max ${(1000 * Math.max(...errTl)).toFixed(0)} ms; stable events (not 27-32) mean ${(1000 * errTl.filter((_, j) => j < 27 || j > 32).reduce((a, b) => a + b, 0) / 55).toFixed(0)} ms max ${(1000 * Math.max(...errTl.filter((_, j) => j < 27 || j > 32))).toFixed(0)} ms; free section ${errTl.slice(27, 33).map((v) => (v * 1000).toFixed(0)).join('/')} ms`);
  // (b) live highlight changes while playing: log (audio time at the change) for events in [from, to)
  const live = async (from, to, seekTo) => {
    await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, seekTo);
    await page.waitForFunction((t) => Math.abs(window.__gapp.audioEl.currentTime - t) < 3 && window.__gapp.player.eventIndex < 40, seekTo);
    await sleep(150);
    return page.evaluate(([from, to]) => new Promise((resolve) => {
      const g = window.__gapp; const out = []; let last = -9;
      (function loop() {
        const i = g.player.eventIndex;
        if (i !== last) { out.push([i, g.audioEl.currentTime]); last = i; }
        if (i > to || g.audioEl.ended) resolve(out); else requestAnimationFrame(loop);
      })();
    }), [from, to]);
  };
  const free = await live(27, 33, TRUTH[26] - 1);
  const live1 = free.filter(([i]) => i >= 27 && i <= 32).map(([i, t]) => ({ i, e: t - TRUTH[i] }));
  info('C3', `LIVE free section (events 27-32): highlight change minus true start (ms): ${live1.map((x) => `${x.i}:${(x.e * 1000).toFixed(0)}`).join(' ')}`);
  const stable = await live(14, 19, TRUTH[13] - 1);
  const live2 = stable.filter(([i]) => i >= 14 && i <= 18).map(([i, t]) => ({ i, e: t - TRUTH[i] }));
  info('C3', `LIVE stable events 14-18: ${live2.map((x) => `${x.i}:${(x.e * 1000).toFixed(0)}`).join(' ')}`);
  const lmean = (a) => a.reduce((s, x) => s + Math.abs(x.e), 0) / (a.length || 1);
  rec('C3b live highlight in a stable section within 150 ms of the true start (mean)', live2.length >= 4 && lmean(live2) < 0.15, `mean ${(lmean(live2) * 1000).toFixed(0)} ms`);
  rec('C3c live highlight in the free section within 250 ms (mean) [expected weak spot]', live1.length >= 4 && lmean(live1) < 0.25, `mean ${(lmean(live1) * 1000).toFixed(0)} ms`);
  await page.click('#btn-play').catch(() => {});
  await shot(page, 'c3-song-play');

  // C6a: manual anchors win in their section; C6b BPM -/+ with the alignment
  const sid = await songId(page);
  const anchorSec = TRUTH[19] + 0.6; // Chorus (section 2) pinned 0.6 s later than the truth
  await page.evaluate(([sid, a]) => { const k = 'gapp.song.' + sid; const s = JSON.parse(localStorage.getItem(k)); s.audio.anchors = { 2: a }; localStorage.setItem(k, JSON.stringify(s)); }, [sid, anchorSec]);
  await page.reload();
  await page.waitForSelector('#btn-play');
  const afterAnchor = await page.evaluate(() => { const g = window.__gapp; return g ? { aligned: !!g.timeline.aligned, sec2: g.timeline.sections[2] ? g.timeline.sections[2].startSec : null } : null; }).catch(() => null);
  if (afterAnchor) {
    rec('C6a an anchor on section 3 wins over the alignment of that section', afterAnchor.sec2 !== null && Math.abs(afterAnchor.sec2 - anchorSec) < 0.01, `section start ${afterAnchor.sec2 && afterAnchor.sec2.toFixed(2)} vs anchor ${anchorSec.toFixed(2)} (alignment said ${TRUTH[19].toFixed(2)} true)`);
    const ev19 = await page.evaluate(() => window.__gapp.timeline.events[19].startSec);
    info('C6', `event 19 (first of the anchored section) start ${ev19.toFixed(2)}; next section event 27 start ${(await page.evaluate(() => window.__gapp.timeline.events[27].startSec)).toFixed(2)} (true ${TRUTH[27].toFixed(2)})`);
  } else info('C6', 'window.__gapp not available before Play: anchors check skipped');
  // remove the anchor again
  await page.evaluate(([sid]) => { const k = 'gapp.song.' + sid; const s = JSON.parse(localStorage.getItem(k)); s.audio.anchors = {}; localStorage.setItem(k, JSON.stringify(s)); }, [sid]);
  await page.reload();
  await page.waitForSelector('#btn-play');
  // BPM +/- with the alignment active
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp && window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  const pre = await page.evaluate(() => ({ starts: window.__gapp.timeline.events.map((e) => e.startSec), bpm: document.querySelector('#pp-bpm').textContent, t: window.__gapp.audioEl.currentTime }));
  await page.click('#btn-bpm-up'); await page.click('#btn-bpm-up'); await page.click('#btn-bpm-up');
  await sleep(300);
  const post = await page.evaluate(() => ({ starts: window.__gapp.timeline.events.map((e) => e.startSec), bpm: document.querySelector('#pp-bpm').textContent, t: window.__gapp.audioEl.currentTime, paused: window.__gapp.audioEl.paused, rate: window.__gapp.audioEl.playbackRate, note: document.querySelector('#pp-bpm-note').textContent, noteHidden: document.querySelector('#pp-bpm-note').hidden }));
  const moved = post.starts.filter((s, j) => Math.abs(s - pre.starts[j]) > 0.002).length;
  info('C6', `BPM +3 with alignment: label ${pre.bpm} -> ${post.bpm}; events whose start moved: ${moved}/61; audio still playing: ${!post.paused}, rate ${post.rate}; note "${post.note}" (hidden ${post.noteHidden})`);
  rec('C6b BPM +/- with the alignment: audio untouched and not frozen', !post.paused && post.rate === 1);
  await page.click('#btn-play').catch(() => {});
  await shot(page, 'c6-bpm');

  rec('Z no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---------------------------------------------------------------- C4-C5: correct by ear
async function correct() {
  dev = devName;
  const { browser, page, errors } = await open(PROFILES[devName]);
  await loadSynth(page);
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  const sec = 1; // Verse: events 7-18
  const first = 7; const N = 12;
  const tapsAt = async (times, { delay = 0, skip = -1, extraAfter = null } = {}) => {
    for (let k = 0; k < times.length; k++) {
      if (k === skip) continue;
      await page.evaluate((t) => window.__gappSync.player.seek(t), times[k] + delay);
      await sleep(50);
      await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 });
    }
    if (extraAfter !== null) { await page.evaluate((t) => window.__gappSync.player.seek(t), extraAfter); await sleep(50); await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 }); }
  };
  const truthSec = TRUTH.slice(first, first + N);
  const openCorr = async () => {
    await page.click(`.as-row[data-sec="${sec}"] [data-act="correct"]`);
    await page.waitForSelector('#corr-tap');
    await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  };
  // --- with a skipped tap
  await openCorr();
  await tapsAt(truthSec, { skip: 5 });
  const cnt = await page.innerText('#corr-count');
  const sv = await page.$eval('#corr-save', (b) => b.disabled);
  const pv = await page.$eval('#corr-preview', (b) => b.disabled);
  const status = await page.innerText('#corr-status');
  info('C4', `skipped tap (taps at 11 of 12): counter "${cnt}", Save disabled=${sv}, Preview disabled=${pv}; status "${status}"`);
  await shot(page, 'c4-skipped');
  rec('C4a with a skipped tap nothing can be saved (11/12)', sv && pv && cnt.startsWith('11'));
  // the user taps once more, late, on the first chord of the next section (a stray tap): what then?
  await tapsAt([], { extraAfter: TRUTH[19] + 0.1 });
  const cnt2 = await page.innerText('#corr-count');
  const sv2 = await page.$eval('#corr-save', (b) => b.disabled);
  await page.click('#corr-save', { force: true }).catch(() => {});
  await sleep(300);
  const status2 = await page.innerText('#corr-status').catch(() => '(overlay closed)');
  const stillOpen = !!(await page.$('#corr-tap'));
  info('C4', `then one stray tap in the next section: counter "${cnt2}", Save disabled=${sv2}; after Save: overlay ${stillOpen ? 'still open' : 'closed'}, status "${status2}"`);
  if (!stillOpen) {
    const s = await readSong(page);
    rec('C4b a skipped tap + a stray tap is rejected (taps outside the section)', false, `SAVED a misaligned section: verified=${s.audio.alignment.sections[sec].verified}`);
    // re-open and reset: continue with the other checks on a fresh state
    await page.click('#as-redo').catch(() => {});
    await page.waitForSelector('#as-rows', { timeout: 240000 });
  } else {
    rec('C4b a skipped tap + a stray tap is rejected (taps outside the section)', /fuori|tra la fine|prima|dopo|devono|sezione/i.test(status2), status2);
    await page.click('#corr-restart');
    await sleep(300);
  }
  // --- taps +80 ms late, reaction 0 first, then compensated
  if (!(await page.$('#corr-tap'))) await openCorr();
  await page.click('#corr-restart');
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing');
  await tapsAt(truthSec, { delay: 0.08 });
  const cnt3 = await page.innerText('#corr-count');
  await page.click('#corr-preview');
  await sleep(3200);
  const chips = await page.$$eval('.corr-chip.now', (c) => c.length);
  rec('C4c 12/12 taps +80 ms late: preview highlights one chord', cnt3.startsWith('12') && chips === 1, `${cnt3}; now chips ${chips}`);
  await shot(page, 'c4-preview');
  // reaction 0 -> saved times are 80 ms late
  const react = async (ms) => { const cur = parseInt(await page.innerText('#corr-react-val'), 10); const steps = (ms - cur) / 10; for (let i = 0; i < Math.abs(steps); i++) await page.click(steps > 0 ? '#corr-react-up' : '#corr-react-down'); };
  await react(80);
  const rv = await page.innerText('#corr-react-val');
  await page.click('#corr-save');
  await page.waitForSelector('#corr-tap', { state: 'detached' });
  const s = await readSong(page);
  const errs = truthSec.map((t, k) => s.audio.alignment.eventStartSec[first + k] - t);
  const mean = errs.reduce((a, b) => a + b, 0) / N;
  info('C4', `reaction set to ${rv}; saved times minus truth (ms): ${errs.map((e) => (e * 1000).toFixed(0)).join(' ')}; mean ${(mean * 1000).toFixed(0)}`);
  rec('C4d with the reaction delay set to 80 ms the saved starts match the truth (|mean| < 25 ms, max < 60 ms)', Math.abs(mean) < 0.025 && Math.max(...errs.map(Math.abs)) < 0.06, `mean ${(mean * 1000).toFixed(0)} ms`);
  rec('C4e section is verified, others untouched', s.audio.alignment.sections[sec].verified && s.audio.alignment.sections.filter((x) => x.verified).length === 1);
  await page.waitForSelector(`.as-row[data-sec="${sec}"][data-state="verified"]`);
  info('C4', `reaction delay persisted in device settings: ${await page.evaluate(() => localStorage.getItem('gapp.device.v1'))}`);
  // neighbours: were the events right after the section changed?
  const nb = s.audio.alignment.eventStartSec[first + N] - TRUTH[first + N];
  info('C4', `first event after the corrected section: error ${(nb * 1000).toFixed(0)} ms`);

  // --- C5 export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#as-export')]);
  const file = path.join(OUT, 'truth-export-synth.json');
  await dl.saveAs(file);
  const raw = fs.readFileSync(file, 'utf8');
  const j = JSON.parse(raw);
  const keys = new Set(); (function walk(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } })(j);
  rec('C5a export: only times and chord names (keys listed)', j.kind === 'alignment-truth' && j.sections.length === 1 && j.sections[0].chords.length === N && j.sections[0].eventStartSec.length === N && !/lyric|uno due/i.test(raw), `keys: ${[...keys].join(',')}`);
  rec('C5b export file name', /\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await browser.close();
  console.log(`INFO export written: ${file}`);
  rec('Z no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------- C7
async function persist() {
  dev = devName;
  const { browser, page, errors, ctx } = await open(PROFILES[devName]);
  await loadSynth(page);
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  await page.click('#as-accept');
  const before = (await readSong(page)).audio.alignment;
  await page.reload();
  await page.waitForSelector('#btn-sync, #btn-play');
  const after = (await readSong(page)).audio.alignment;
  rec('C7a alignment identical after reload', JSON.stringify(before) === JSON.stringify(after));
  // does the audio come back? (audio is stored in IndexedDB)
  await page.click('#btn-sync').catch(() => {});
  await sleep(1200);
  const state = await page.evaluate(() => ({ rows: !!document.querySelector('#as-rows'), start: !!document.querySelector('#as-start'), file: !!document.querySelector('#sync-file'), text: (document.querySelector('#as-box') || { textContent: '' }).textContent.slice(0, 200) }));
  info('C7', `sync screen after reload: ${JSON.stringify({ ...state, text: state.text.replace(/\s+/g, ' ').slice(0, 120) })}`);
  await shot(page, 'c7-after-reload');
  rec('C7b summary is shown again after reload', state.rows);
  await page.click('#sync-close').catch(() => {});
  await page.waitForSelector('#btn-back');
  await page.click('#btn-back');
  await page.waitForSelector('#btn-export');
  const btn = await page.$('#btn-export');
  let exported = null;
  if (btn) {
    const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
    const f = path.join(OUT, 'lib-export.json');
    await dl.saveAs(f);
    exported = JSON.parse(fs.readFileSync(f, 'utf8'));
    const s = exported.songs.find((x) => x.audio && x.audio.alignment);
    rec('C7c library export contains the alignment', !!s && s.audio.alignment.eventStartSec.length === 61, s ? `verified sections ${s.audio.alignment.sections.filter((x) => x.verified).length}` : 'no song with alignment');
    // import into a fresh context
    const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const c2 = await b2.newContext(PROFILES[devName]);
    const p2 = await c2.newPage();
    p2.on('dialog', (d) => d.accept());
    await p2.goto(URL);
    await p2.setInputFiles('#import-json', f);
    await p2.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
    const nb = await p2.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
    await p2.waitForSelector('.song-row');
    await p2.click('.song-row');
    await p2.waitForSelector('#btn-sync');
    const imp = await p2.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))));
    rec('C7d imported song has the same alignment (without the audio file)', imp.audio && imp.audio.alignment && JSON.stringify(imp.audio.alignment) === JSON.stringify(before), imp.audio ? Object.keys(imp.audio).join(',') : 'audio null');
    await p2.click('#btn-sync').catch(() => {});
    await sleep(800);
    const msg = await p2.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400));
    info('C7', `fresh device, sync screen text: ${msg.slice(0, 300)}`);
    await p2.screenshot({ path: path.join(OUT, `${dev}-c7-imported.png`) });
    await b2.close();
  }
  rec('Z no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  if (!fs.existsSync(MP3) && (mode === 'cancel' || mode === 'perf')) { console.log('mp3 reale assente: salto'); return; }
  await ({ cancel, perf, synth, correct, persist }[mode])();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
