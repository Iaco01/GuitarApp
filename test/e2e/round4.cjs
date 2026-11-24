// Round 4: synchronised audio, end to end on dist/index.html with the synthetic track.
// Run: npm run build && node test/fixtures/make-audio.mjs && node test/e2e/round4.cjs [S1|S2|...]
// Screenshots and numbers go to test-artifacts/round-4/ (not committed).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const AUD = path.join(ROOT, 'test-artifacts', 'audio');
const OUT = path.join(ROOT, 'test-artifacts', 'round-4');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const step = (m) => console.log('..', m);
const note = (id, t) => console.log(`INFO ${id} ${t}`);
const only = process.argv[2] || '';
const PROFILE = { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } };
// independent expectation of the onsets (see test/fixtures/make-audio.mjs)
const OFFSET = 1.7;
const expected = (bpms) => { const out = []; let t = OFFSET; bpms.forEach((b) => { for (let i = 0; i < 4; i++) { out.push(t); t += 120 / b; } }); return out; };

// Records every oscillator the app creates: when it starts, and when (if ever) it is cancelled.
const PATCH = () => {
  window.__osc = [];
  const AC = window.AudioContext;
  const co = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () {
    const osc = co.call(this);
    const ctx = this;
    const r = { when: null, cancelAt: null, ctxNow: null, ctx };
    const start = osc.start.bind(osc);
    const stop = osc.stop.bind(osc);
    osc.start = (w) => { r.when = w; r.ctxNow = ctx.currentTime; return start(w); };
    osc.stop = (w) => { if (w === undefined || w === 0) r.cancelAt = ctx.currentTime; return stop(w); };
    window.__osc.push(r);
    return osc;
  };
  const cmes = AC.prototype.createMediaElementSource;
  AC.prototype.createMediaElementSource = function (el) { const n = cmes.call(this, el); window.__src = n; return n; };
};

async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(PATCH);
  await page.goto(URL);
  return { browser, page, errors, ctx };
}

async function importLibrary(page) {
  await page.setInputFiles('#import-json', path.join(AUD, 'library.json'));
  await page.waitForSelector('.dlg');
  await page.click('.dlg [data-value="newer"]');
  await page.waitForSelector('.song-row');
}

// opens the synthetic song and the sync screen, loads `file`, sets the offset like a user would
async function loadAndSetOffset(page, file) {
  step('open song');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-pick');
  step('load file');
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#sync-first', { timeout: 15000 });
  step('file loaded');
  // simulated tap: play, tap when the first tone is heard (a little late, like a person)
  await page.click('#sync-play');
  await page.waitForFunction(() => window.__gappSync && window.__gappSync.element.currentTime >= 1.78);
  await page.click('#sync-first');
  await page.click('#sync-play'); // pause
  let offMs = await page.evaluate(() => Number(/\((-?\d+) ms\)/.exec(document.querySelector('#sync-offset').textContent)[1]));
  step('tap offset ' + offMs + ' ms; msg: ' + (await page.innerText('#sync-msg')));
  const steps = [];
  // fine adjustment with the -50 / -10 buttons toward 1700 ms
  while (offMs - 1700 > 5) {
    const d = offMs - 1700 >= 50 ? -50 : -10;
    await page.click(`#sync-offset-box [data-ms="${d}"]`);
    steps.push(d);
    offMs = await page.evaluate(() => Number(/\((-?\d+) ms\)/.exec(document.querySelector('#sync-offset').textContent)[1]));
  }
  while (1700 - offMs > 5) {
    await page.click('#sync-offset-box [data-ms="10"]');
    steps.push(10);
    offMs = await page.evaluate(() => Number(/\((-?\d+) ms\)/.exec(document.querySelector('#sync-offset').textContent)[1]));
  }
  return { offMs, steps };
}

// plays from the start and records, for every highlight change, audio.currentTime at that moment
async function measureRun(page, expectedOnsets, seconds) {
  await page.evaluate(() => {
    if (window.__obs) window.__obs.disconnect();
    window.__chg = [];
    let last = null;
    const el = window.__gapp.audioEl;
    const obs = new MutationObserver(() => {
      const cur = document.querySelector('.ch.cur');
      const ref = cur ? cur.getAttribute('data-ref') : null;
      if (ref !== last) { last = ref; window.__chg.push({ ref, ct: el.currentTime, rate: el.playbackRate }); }
    });
    obs.observe(document.querySelector('.song-body'), { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.__obs = obs;
  });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing');
  const t0 = Date.now();
  await page.waitForFunction((n) => window.__chg.filter((c) => c.ref).length >= n || window.__gapp.player.state === 'stopped', expectedOnsets.length, { timeout: seconds * 1000 });
  const wall = (Date.now() - t0) / 1000;
  const chg = await page.evaluate(() => window.__chg.filter((c) => c.ref));
  await page.click('#btn-play'); // pause
  const errs = chg.map((c, i) => (c.ct - expectedOnsets[i]) * 1000);
  return { chg, errs, wall };
}

const stats = (a) => ({ min: Math.min(...a), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });
const fmt = (v) => `${v.toFixed(0)} ms`;

(async () => {
  if (!only || only === 'S1') {
    const { browser, page, errors } = await open();
    await importLibrary(page);
    await page.click('.song-row');
    await page.waitForSelector('#btn-sync');
    rec('S1 no audio: button says "Aggiungi audio"', (await page.innerText('#btn-sync')) === 'Aggiungi audio');
    await page.goBack();
    const { offMs, steps } = await loadAndSetOffset(page, path.join(AUD, 'track.wav'));
    rec('S1 offset set to 1.7 s through tap + fine steps', Math.abs(offMs - 1700) <= 5, `${offMs} ms after steps ${JSON.stringify(steps)}`);
    await page.screenshot({ path: path.join(OUT, 'sync-offset.png') });
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl);
    const pp = await page.evaluate(() => { const e = window.__gapp.audioEl; return { p: e.preservesPitch, wp: e.webkitPreservesPitch, src: e.src.slice(0, 5) }; });
    rec('S1 audio element with preservesPitch', pp.p === true && pp.src === 'blob:', JSON.stringify(pp));
    // ---- sync accuracy at 100% and 75% ----
    const want = expected([120, 90, 150]);
    const clickMore = async (sel) => {
      if (await page.evaluate(() => document.querySelector('#pp-more').hidden)) await page.click('#btn-more');
      await page.click(sel);
    };
    for (const pct of [100, 75]) {
      if (pct === 75) {
        await clickMore('#btn-stop');
        for (let i = 0; i < 5; i++) await page.click('#btn-speed-down');
        const rate = await page.evaluate(() => window.__gapp.audioEl.playbackRate);
        rec('S2 speed 75% sets playbackRate', Math.abs(rate - 0.75) < 1e-9, String(rate));
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      const r = await measureRun(page, want, 40);
      const st = stats(r.errs);
      note('S2 ' + pct + '%', `errors (highlight - tone onset): min ${fmt(st.min)} max ${fmt(st.max)} mean ${fmt(st.mean)}; wall ${r.wall.toFixed(1)} s; ${r.chg.length} changes; rate ${r.chg[0] && r.chg[0].rate}`);
      fs.writeFileSync(path.join(OUT, `sync-error-${pct}.json`), JSON.stringify(r.errs));
      rec(`S2 ${pct}%: 12 chord changes, all highlighted within 100 ms of the audio`, r.chg.length === 12 && r.errs.every((e) => e >= -10 && e <= 100), r.errs.map((e) => e.toFixed(0)).join(' '));
      if (pct === 75) rec('S2 75%: wall clock matches the slower rate', Math.abs(r.wall - (want[11] - 0.1 + 0.8) / 0.75 * 1) < 3, `${r.wall.toFixed(1)} s`);
      await page.screenshot({ path: path.join(OUT, `play-${pct}.png`) });
    }

    // ---- S3: jump by tapping a chord ----
    for (let i = 0; i < 5; i++) await page.click('#btn-speed-up');
    await clickMore('#btn-more'); // close the second row
    await page.evaluate(() => window.scrollTo(0, 0));
    const events = await page.evaluate(() => window.__gapp.timeline.events.map((e) => ({ ref: e.ref, s: e.startSec })));
    await page.click('#btn-stop').catch(() => {});
    const tapEvent = async (i) => {
      const t = await page.evaluate((ref) => { const el = document.querySelector(`.ch[data-ref="${ref}"]`); el.scrollIntoView({ block: 'center' }); const c0 = window.__gapp.audioEl.currentTime; el.click(); return c0; }, events[i].ref);
      await sleep(350);
      return page.evaluate(() => ({ ct: window.__gapp.audioEl.currentTime, ev: window.__gapp.player.eventIndex, st: window.__gapp.player.state }));
    };
    await page.click('#btn-play'); // plays from the start (stopped)
    await sleep(500);
    let j = await tapEvent(6);
    rec('S3 tap on chord 6 while playing jumps the audio there', j.ct >= events[6].s && j.ct < events[6].s + 0.7 && j.ev === 6 && j.st === 'playing', `ct ${j.ct.toFixed(2)} wanted ${events[6].s.toFixed(2)}+; event ${j.ev}`);
    j = await tapEvent(2);
    rec('S3 tap on an earlier chord jumps back', j.ct >= events[2].s && j.ct < events[2].s + 0.7 && j.ev === 2, `ct ${j.ct.toFixed(2)} wanted ${events[2].s.toFixed(2)}+; event ${j.ev}`);
    await page.click('#btn-play'); // pause
    j = await tapEvent(9);
    rec('S3 tap on a chord while paused resumes from there', j.ct >= events[9].s && j.ct < events[9].s + 0.7 && j.st === 'playing', `ct ${j.ct.toFixed(2)} wanted ${events[9].s.toFixed(2)}+; ${j.st}`);
    await page.click('#btn-play'); // pause

    // ---- S4: loop of a section on the audio ----
    await page.evaluate(() => window.scrollTo(0, 0));
    const secs = await page.evaluate(() => window.__gapp.timeline.sections.map((x) => [x.startSec, x.endSec]));
    await page.evaluate(() => document.querySelector('.sec-head[data-sec="1"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await sleep(700);
    await page.evaluate(() => document.querySelector('.sec-head[data-sec="1"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    await sleep(200);
    rec('S4 loop active on the second section', (await page.locator('.sec.looping').count()) === 1 && (await page.locator('.loop-x').count()) === 1);
    const seen = [];
    const tl0 = Date.now();
    while (Date.now() - tl0 < 14000) { seen.push(await page.evaluate(() => window.__gapp.player.timeSec)); await sleep(40); }
    const wraps = seen.filter((t, i) => i > 0 && t < seen[i - 1] - 1).length;
    const inside = seen.every((t) => t >= secs[1][0] - 0.12 && t <= secs[1][1] + 0.12);
    rec('S4 loop wraps on the audio and stays inside the section', wraps >= 2 && inside, `${wraps} wraps in 14 s, range ${Math.min(...seen).toFixed(2)}-${Math.max(...seen).toFixed(2)} of ${secs[1].map((x) => x.toFixed(2))}`);
    await page.click('.loop-x');
    rec('S4 loop exit', (await page.locator('.sec.looping').count()) === 0);
    await page.click('#btn-stop').catch(async () => { await clickMore('#btn-stop'); });
    await clickMore('#btn-stop');

    // ---- S5: metronome over the audio, seeks without stale or double clicks ----
    await page.evaluate(() => { window.__osc.length = 0; });
    await page.click('#btn-play');
    await sleep(600);
    await clickMore('#btn-metro'); // turned on while playing: the element is routed through the context now
    const metro = await page.evaluate(() => document.querySelector('#btn-metro').textContent);
    await sleep(3000);
    const eff = () => page.evaluate(() => window.__osc.filter((r) => r.when !== null && !(r.cancelAt !== null && r.cancelAt <= r.when)).map((r) => ({ when: r.when, at: r.ctxNow })));
    let clicks = await eff();
    const inA = clicks.filter((c, i) => i > 0).map((c, i) => c.when - clicks[i].when).filter((g) => g < 1);
    rec('S5 clicks on (Clic: sì) and regular at 120 BPM over the audio', metro === 'Clic: sì' && clicks.length >= 5 && inA.every((g) => Math.abs(g - 0.5) < 0.02), `${metro}; ${clicks.length} clicks; gaps ${inA.slice(0, 6).map((g) => g.toFixed(3)).join(' ')}`);
    const audioAlive = await page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, paused: window.__gapp.audioEl.paused, ctx: window.__osc[0].ctx.state }));
    rec('S5 audio keeps playing through the context', !audioAlive.paused && audioAlive.ctx === 'running', JSON.stringify(audioAlive));
    // 10 quick seeks 150 ms apart
    const seeks = [];
    const targets = [8, 3, 10, 1, 6, 11, 4, 9, 0, 7];
    for (const k of targets) {
      const T = await page.evaluate((ref) => { const el = document.querySelector(`.ch[data-ref="${ref}"]`); const T = window.__osc[0].ctx.currentTime; el.click(); return T; }, events[k].ref);
      seeks.push(T);
      await sleep(150);
    }
    await sleep(500);
    clicks = await page.evaluate(() => window.__osc.filter((r) => r.when !== null).map((r) => ({ when: r.when, at: r.ctxNow, cancelAt: r.cancelAt })));
    const stale = [];
    for (const T of seeks) for (const c of clicks) if (c.at < T && c.when > T + 0.001 && !(c.cancelAt !== null && c.cancelAt <= c.when)) stale.push([T, c.when]);
    const cancelled = clicks.filter((c) => c.cancelAt !== null && c.cancelAt <= c.when).length;
    rec('S5 no click scheduled before a seek sounds after it', stale.length === 0, `${seeks.length} seeks, ${cancelled} clicks cancelled, ${stale.length} stale`);
    // seeks fired right after a click was scheduled (inside its 100 ms lookahead): it must be cancelled
    const hunt = await page.evaluate(async (refs) => {
      const out = [];
      const ctx = window.__osc[0].ctx;
      for (const ref of refs) {
        const t0 = performance.now();
        let fired = false;
        while (performance.now() - t0 < 3000 && !fired) {
          const now = ctx.currentTime;
          const pend = window.__osc.find((r) => r.when !== null && r.when - now > 0.03 && r.when - now < 0.09 && r.cancelAt === null);
          if (pend) {
            const T = now;
            document.querySelector(`.ch[data-ref="${ref}"]`).click();
            out.push({ T, when: pend.when, rec: pend });
            fired = true;
          } else await new Promise((r) => setTimeout(r, 2));
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      return out.map((o) => ({ T: o.T, when: o.when, cancelAt: o.rec.cancelAt }));
    }, [events[2].ref, events[10].ref, events[5].ref, events[0].ref, events[8].ref]);
    const huntOk = hunt.filter((h) => h.cancelAt !== null && h.cancelAt <= h.when);
    rec('S5 a click already scheduled when a seek happens is cancelled', hunt.length >= 4 && huntOk.length === hunt.length, `${huntOk.length} of ${hunt.length} cancelled`);
    // after the last seek the clicks follow the new position with the right spacing again
    await sleep(2500);
    const after = (await eff()).filter((c) => c.at >= seeks[seeks.length - 1]);
    const gaps = after.map((c, i) => (i ? c.when - after[i - 1].when : null)).filter((g) => g !== null);
    note('S5', `${after.length} clicks after the last seek, gaps ${gaps.slice(0, 6).map((g) => g.toFixed(3)).join(' ')}`);
    rec('S5 regular clicks after the seeks (no double clicks)', after.length >= 4 && gaps.every((g) => g > 0.3), gaps.map((g) => g.toFixed(2)).join(' '));
    await page.click('#btn-play'); // pause
    const pausedCount = (await eff()).length;
    await sleep(800);
    rec('S5 no clicks while paused', (await eff()).length === pausedCount);
    await clickMore('#btn-metro');
    rec('S5 click state is stored with the song audio', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.synthetic-audio-song')); return s.audio.metronome === false; }));

    // ---- S6: anchors and BPM suggestion with a track whose middle section really runs at 92 BPM ----
    await page.click('#btn-sync');
    await page.waitForSelector('#sync-file');
    await page.setInputFiles('#sync-file', path.join(AUD, 'track-b.wav')); // different name and size: the confirm is accepted, offset kept
    await page.waitForSelector('#sync-first');
    await sleep(300);
    const keptOff = await page.evaluate(() => /\((\d+) ms\)/.exec(document.querySelector('#sync-offset').textContent)[1]);
    rec('S6 replacing the file keeps the offset when the dialog is accepted', Math.abs(Number(keptOff) - 1700) <= 6, `${keptOff} ms`);
    const bOn = expected([120, 92, 150]);
    const seekSync = (t) => page.evaluate((x) => window.__gappSync.player.seek(x), t);
    // anchors: seek to the real start of each section, then use the big button
    await seekSync(bOn[4]);
    await page.click('#sync-next');
    await seekSync(bOn[8]);
    await page.click('#sync-next');
    const endT = bOn[11] + 0.8;
    await seekSync(endT);
    await page.click('#sync-end');
    await page.screenshot({ path: path.join(OUT, 'sync-anchors.png'), fullPage: false });
    const rows = await page.evaluate(() => [...document.querySelectorAll('#sync-rows li')].map((li) => li.querySelector('.sync-row-time').textContent));
    rec('S6 anchors shown for sections 1-3', rows.length === 3 && rows.every((r) => r.startsWith('⚓')), rows.join(' | '));
    const sug = await page.evaluate(() => [...document.querySelectorAll('#sync-sugs .sync-sug')].map((e) => e.querySelector('span').textContent));
    note('S6', 'suggestions: ' + JSON.stringify(sug));
    rec('S6 BPM suggestion for the middle section only', sug.length === 1 && /Ponte sembra a 92 BPM \(ora 90\)/.test(sug[0]), JSON.stringify(sug));
    await page.evaluate(() => document.querySelector('#sync-sugs [data-act="apply"]').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(OUT, 'sync-suggestion.png') });
    await page.click('#sync-sugs [data-act="apply"]');
    const afterApply = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.synthetic-audio-song')); return { bpm: s.sections.map((x) => x.bpm), src: s.sections[1].bpmSource, n: document.querySelectorAll('#sync-sugs .sync-sug').length }; });
    rec('S6 applying sets the BPM of the section and clears the suggestion', afterApply.bpm[1] === 92 && afterApply.src === 'edited' && afterApply.n === 0, JSON.stringify(afterApply));
    // an impossible anchor is refused
    await seekSync(2.0);
    await page.click('#sync-rows li[data-sec="2"] [data-act="remove"]');
    await page.click('#sync-rows li[data-sec="2"] [data-act="here"]');
    const refused = await page.innerText('#sync-msg');
    rec('S6 an anchor before the previous one is refused with a message', /dopo la sezione precedente/.test(refused), refused);
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl);
    const ancHead = await page.evaluate(() => [...document.querySelectorAll('.sec-anchor')].map((e) => e.textContent));
    rec('S6 anchors appear in the section headers', ancHead.length === 2 && ancHead[0].startsWith('⚓ 0:01,7') === true || ancHead.length === 3, ancHead.join(' | '));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, 'song-with-anchors.png') });
    // sync accuracy with anchors on the second track
    const rB = await measureRun(page, bOn, 40);
    const stB = stats(rB.errs);
    note('S6', `track B with anchors: min ${fmt(stB.min)} max ${fmt(stB.max)}`);
    rec('S6 track B: all 12 changes within 100 ms with anchors and the applied BPM', rB.chg.length === 12 && rB.errs.every((e) => e >= -10 && e <= 100), rB.errs.map((e) => e.toFixed(0)).join(' '));
    await page.click('#btn-stop').catch(async () => { await clickMore('#btn-stop'); });

    // ---- S7: latency calibration ----
    await page.click('#btn-sync');
    await page.waitForSelector('#sync-calibrate');
    await page.click('#sync-calibrate');
    await page.waitForSelector('#cal-slider');
    await page.evaluate(() => { const el = document.querySelector('#cal-slider'); el.value = '180'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#cal-start');
    await page.evaluate(() => {
      window.__flash = [];
      const dot = document.querySelector('#cal-dot');
      new MutationObserver(() => { if (dot.classList.contains('on')) window.__flash.push(window.__osc[window.__osc.length - 1].ctx.currentTime); }).observe(dot, { attributes: true, attributeFilter: ['class'] });
    });
    await sleep(3200);
    const calShot = await page.evaluate(() => ({ v: document.querySelector('#cal-value').textContent, flashes: window.__flash.length }));
    await page.screenshot({ path: path.join(OUT, 'calibration.png') });
    const lag = await page.evaluate(() => {
      // delay of each flash after the click that triggered it (the clicks of the calibration are the last oscillators)
      const clicks = window.__osc.filter((r) => r.when !== null).map((r) => r.when).slice(-10);
      return window.__flash.map((f) => { const prev = clicks.filter((c) => c <= f).pop(); return prev === undefined ? null : f - prev; }).filter((x) => x !== null);
    });
    rec('S7 calibration screen: slider 180 ms, flashes follow the clicks by about 180 ms', calShot.v === '180 ms' && lag.length >= 3 && lag.every((l) => l > 0.14 && l < 0.26), `${calShot.v}; flashes ${calShot.flashes}; lag ${lag.map((l) => l.toFixed(3)).join(' ')}`);
    await page.click('#cal-save');
    const dev = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.device.v1')));
    rec('S7 latency saved for the device (not in the song)', dev.latencyMs === 180 && (await page.evaluate(() => !('latencyMs' in JSON.parse(localStorage.getItem('gapp.song.synthetic-audio-song')).audio))), JSON.stringify(dev));
    await page.screenshot({ path: path.join(OUT, 'sync-after-calibration.png') });
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl);
    await page.evaluate(() => window.scrollTo(0, 0));
    const rL = await measureRun(page, bOn, 40);
    const stL = stats(rL.errs);
    note('S7', `with 180 ms latency: min ${fmt(stL.min)} max ${fmt(stL.max)} (the highlight is held back by the latency: about +180 ms in media time)`);
    rec('S7 with latency 180 ms the highlight is delayed by it (matches what a Bluetooth listener hears)', rL.errs.every((e) => e > 160 && e < 215), rL.errs.map((e) => e.toFixed(0)).join(' '));
    await page.click('#btn-stop').catch(async () => { await clickMore('#btn-stop'); });
    // library: audio badge, space used
    await page.click('#btn-back');
    await page.waitForSelector('#storage-used');
    await sleep(600);
    const lib = await page.evaluate(() => ({ used: document.querySelector('#storage-used').textContent, badge: !!document.querySelector('.badge[data-badge="audio"]'), lat: document.querySelector('#device-latency').textContent }));
    rec('S10 library shows the audio badge, MB in IndexedDB and the device latency', lib.badge && /Audio: 1 file, \d/.test(lib.used) && /180 ms/.test(lib.lat), JSON.stringify(lib));
    await page.screenshot({ path: path.join(OUT, 'library-audio.png'), fullPage: true });
    // export for S8
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    await dl.saveAs(path.join(OUT, 'export-with-audio.json'));
    console.log('errors', errors.join('|') || 'none');
    await browser.close();
  }

  if (!only || only === 'S1' || only === 'S8') {
    // ---- S8: import without the audio file: "Audio mancante", reload keeps offset and anchors ----
    const exportPath = path.join(OUT, 'export-with-audio.json');
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    const meta = exported.songs[0].audio;
    rec('S8 export carries the audio metadata without the file', meta && meta.fileName === 'track-b.wav' && Math.abs(meta.offsetSec - 1.7) < 0.01 && Object.keys(meta.anchors).length === 1 && meta.endSec > 14 && !JSON.stringify(exported).includes('RIFF'), JSON.stringify(meta));
    for (const variant of ['same', 'different-keep', 'different-drop']) {
      const { browser, page, errors } = await open();
      await page.setInputFiles('#import-json', exportPath);
      await page.waitForSelector('.dlg');
      await page.click('.dlg [data-value="newer"]');
      await page.waitForSelector('.song-row');
      await page.click('.song-row');
      await page.waitForSelector('#audio-state');
      const state = await page.innerText('#audio-state');
      if (variant === 'same') {
        rec('S8 song without file says "Audio mancante: ricarica <nome>"', /^Audio mancante: ricarica «track-b\.wav»$/.test(state), state);
        await page.screenshot({ path: path.join(OUT, 'audio-missing.png') });
      }
      const file = variant === 'same' ? path.join(AUD, 'track-b.wav') : path.join(AUD, 'track.mp3');
      page.removeAllListeners('dialog');
      let asked = 0;
      page.on('dialog', (d) => { asked++; if (variant === 'different-drop') d.dismiss(); else d.accept(); });
      await page.setInputFiles('#audio-reload', file);
      await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl, null, { timeout: 15000 });
      const st = await page.evaluate(() => { const a = JSON.parse(localStorage.getItem('gapp.song.synthetic-audio-song')).audio; return { off: a.offsetSec, anchors: Object.keys(a.anchors).length, name: a.fileName, shown: document.querySelectorAll('.sec-anchor').length }; });
      if (variant === 'same') rec('S8 same name and size: no question, offset and anchors kept', asked === 0 && Math.abs(st.off - 1.7) < 0.01 && st.anchors === 1 && st.shown === 2, JSON.stringify(st));
      if (variant === 'different-keep') rec('S8 different file, answer yes: offset and anchors kept', asked === 1 && Math.abs(st.off - 1.7) < 0.01 && st.anchors === 1 && st.name === 'track.mp3', JSON.stringify(st));
      if (variant === 'different-drop') rec('S8 different file, answer no: offset and anchors reset', asked === 1 && st.off === 0 && st.anchors === 0 && st.name === 'track.mp3', JSON.stringify(st));
      if (variant === 'same') {
        // the mp3 also plays: highlight within 100 ms of the real change
        await page.evaluate(() => window.scrollTo(0, 0));
        const rM = await measureRun(page, expected([120, 92, 150]), 40);
        note('S8', 'same file after reload: ' + rM.errs.map((e) => e.toFixed(0)).join(' '));
        rec('S8 after reloading the file the sync is as before', rM.chg.length === 12 && rM.errs.every((e) => e >= -10 && e <= 100));
      }
      if (variant === 'different-keep') {
        // mp3: an independent decoder, same synthetic song (track.mp3 has the first track's tempi, the song is now 120/92/150: use anchors as stored)
        await page.evaluate(() => window.scrollTo(0, 0));
        const rM = await measureRun(page, expected([120, 90, 150]), 40);
        note('S8', 'mp3 (first section matches, later sections use the other track anchors): ' + rM.errs.map((e) => e.toFixed(0)).join(' '));
      }
      if (variant === 'same') {
        // pause rows: add and remove
        await page.click('#btn-edit');
        await page.click('.add-pause[data-sec="1"]');
        const pr = await page.evaluate(() => ({ rest: document.querySelectorAll('.ch.rest').length, txt: document.querySelector('.ch.rest').textContent, ev: window.__gapp.timeline.events.filter((e) => e.rest).length, n: window.__gapp.timeline.events.length }));
        rec('S9 "+ pausa" adds a grey rest label and a timeline event', pr.rest === 1 && /^pausa/.test(pr.txt) && pr.ev === 1 && pr.n === 13, JSON.stringify(pr));
        await page.click('.ch.rest');
        await page.click('#eb-plus');
        const bt = await page.evaluate(() => document.querySelector('.ch.rest .bt').textContent);
        await page.screenshot({ path: path.join(OUT, 'edit-pause.png') });
        await page.click('#eb-del-pause');
        const gone = await page.evaluate(() => ({ rest: document.querySelectorAll('.ch.rest').length, n: window.__gapp.timeline.events.length }));
        rec('S9 rest bar editable with +/- and deletable', bt === '5' && gone.rest === 0 && gone.n === 12, `beats ${bt}; after delete ${JSON.stringify(gone)}`);
        await page.click('#btn-edit');
        // delete the song: the audio goes away
        const before = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('gapp-audio'); r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').count(); q.onsuccess = () => res(q.result); }; }));
        await page.click('#btn-delete');
        await page.waitForSelector('.lib');
        await sleep(400);
        const after = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('gapp-audio'); r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').count(); q.onsuccess = () => res(q.result); }; }));
        rec('S9 deleting the song deletes its audio from IndexedDB', before === 1 && after === 0, `${before} -> ${after}`);
      }
      rec(`S8 console clean (${variant})`, errors.length === 0, errors.join('|'));
      await browser.close();
    }
  }

  if (!only || only === 'S11') {
    // ---- S11: independent measurement inside the audio graph (metronome on routes the audio through the context):
    // a script processor on the media element source detects the tone onsets in the samples that really flow, and the
    // highlight time is read on the same context clock ----
    const { browser, page, errors } = await open();
    await importLibrary(page);
    await loadAndSetOffset(page, path.join(AUD, 'track.wav'));
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp && window.__gapp.audioEl);
    await page.click('#btn-more');
    await page.click('#btn-metro'); // routes the element through the AudioContext
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__src, null, { timeout: 8000 });
    await page.evaluate(() => {
      const ctx = window.__src.context;
      window.__on = [];
      window.__hl = [];
      const proc = ctx.createScriptProcessor(256, 1, 1);
      let quiet = 1e9;
      proc.onaudioprocess = (e) => {
        const x = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < x.length; i++) {
          if (Math.abs(x[i]) > 0.02) { if (quiet > 0.015 * ctx.sampleRate) window.__on.push(e.playbackTime + i / ctx.sampleRate); quiet = 0; } else quiet++;
        }
      };
      window.__src.connect(proc);
      proc.connect(ctx.destination);
      let last = null;
      new MutationObserver(() => {
        const cur = document.querySelector('.ch.cur');
        const ref = cur ? cur.getAttribute('data-ref') : null;
        if (ref !== last) { last = ref; if (ref) window.__hl.push(ctx.currentTime); }
      }).observe(document.querySelector('.song-body'), { attributes: true, subtree: true, attributeFilter: ['class'] });
    });
    // restart from the top so that every onset is seen after the processor is attached
    await page.click('#btn-play');
    await page.click('#btn-stop');
    await page.evaluate(() => { window.__on.length = 0; window.__hl.length = 0; });
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing');
    await page.waitForFunction(() => window.__hl.length >= 12 || window.__gapp.player.state === 'stopped', null, { timeout: 30000 });
    await sleep(300);
    const g = await page.evaluate(() => ({ on: window.__on, hl: window.__hl }));
    const n = Math.min(g.on.length, g.hl.length);
    const errsG = g.on.slice(0, n).map((t, i) => (g.hl[i] - t) * 1000);
    note('S11', `detected ${g.on.length} onsets in the graph, ${g.hl.length} highlights; highlight - onset (ms): ${errsG.map((e) => e.toFixed(0)).join(' ')}`);
    rec('S11 in-graph onsets vs highlight (same context clock): within 100 ms, highlight never early by more than 30 ms', n === 12 && errsG.every((e) => e > -30 && e < 100), `min ${Math.min(...errsG).toFixed(0)} max ${Math.max(...errsG).toFixed(0)} ms`);
    rec('S11 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
