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
    const r = { when: null, cancelAt: null, ctxNow: null };
    const start = osc.start.bind(osc);
    const stop = osc.stop.bind(osc);
    osc.start = (w) => { r.when = w; r.ctxNow = ctx.currentTime; return start(w); };
    osc.stop = (w) => { if (w === undefined || w === 0) r.cancelAt = ctx.currentTime; return stop(w); };
    window.__osc.push(r);
    return osc;
  };
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
    console.log('errors', errors.join('|') || 'none');
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
