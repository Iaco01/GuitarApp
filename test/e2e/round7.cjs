// Round 7 phase B: full flow on the real mp3: load, "Sincronizza automaticamente", summary by section,
// play with highlight, "Correggi a orecchio" with simulated taps, export of the corrections, CPU x4 timing.
// Run: npm run build && node test/e2e/round7.cjs [flow|perf|all] [360|SE|13]
// Screenshots go to test-artifacts/round-7/ (not committed; they show the real page text).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-7');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] || 'all';
const onlyDev = process.argv[3] || '360';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
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
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(URL);
  return { browser, page, errors };
}
async function loadSong(page) {
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 20000 });
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3);
  await page.waitForSelector('#as-start', { timeout: 30000 });
}
async function runAuto(page, label) {
  const t0 = Date.now();
  await page.click('#as-start');
  await page.waitForSelector('#as-progress');
  const seen = [];
  const poll = setInterval(async () => { try { seen.push(await page.evaluate(() => { const p = document.querySelector('#as-progress'); return p ? p.value : -1; })); } catch { /* page busy */ } }, 500);
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  clearInterval(poll);
  return { wall: Date.now() - t0, seen };
}

async function flow(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await loadSong(page);
  await shot(page, '1-before');
  // progress bar moves, then the summary
  const t0 = Date.now();
  await page.click('#as-start');
  await page.waitForSelector('#as-progress');
  await page.waitForFunction(() => { const p = document.querySelector('#as-progress'); return p && p.value > 0.1; }, null, { timeout: 30000 });
  await sleep(500);
  const mid = await page.evaluate(() => ({ v: document.querySelector('#as-progress').value, t: document.querySelector('#as-prog-text').textContent }));
  await shot(page, '2-progress');
  rec('F1 progress bar visible and moving while the analysis runs', mid.v > 0.1 && mid.v < 1 && /%/.test(mid.t), JSON.stringify(mid));
  await page.waitForSelector('#as-rows', { timeout: 120000 });
  const wall = Date.now() - t0;
  const stats = await page.evaluate(() => window.__gappAutosync);
  console.log(`INFO [${dev}] total ${wall} ms; decode ${stats.decodeMs} ms, analysis ${stats.analyseMs} ms, longest slice ${stats.maxSliceMs} ms, ${stats.yields} yields`);
  rec('F2 analysis done with 328 events', stats.events === 328, JSON.stringify(stats));
  const rows = await page.$$eval('.as-row', (rs) => rs.map((r) => ({ sec: r.dataset.sec, state: r.dataset.state })));
  rec('F3 summary has 12 sections with colour states', rows.length === 12 && rows.every((r) => ['green', 'yellow', 'red'].includes(r.state)), rows.map((r) => r.state[0]).join(''));
  const colours = await page.$$eval('.as-row .as-dot', (ds) => ds.map((d) => getComputedStyle(d).backgroundColor));
  rec('F4 the dots have at least two distinct colours', new Set(colours).size >= 2, [...new Set(colours)].join(' | '));
  console.log(`INFO [${dev}] states: ${rows.map((r) => r.state).join(',')}`);
  await page.evaluate(() => document.querySelector('#as-box').scrollIntoView());
  await shot(page, '3-summary');
  const counts = await page.innerText('#as-counts');
  rec('F5 counts line', /sicure.*da controllare.*incerte.*verificate/.test(counts), counts);

  // listen: play and the highlight follows
  await page.click('#as-listen');
  await page.waitForFunction(() => window.__gappSync && window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  await page.evaluate(() => { window.__gappSync.player.seek(window.__gappSync.player.currentTime()); });
  await sleep(2500);
  const now1 = await page.innerText('#as-now');
  rec('F6 "Ascolta e controlla" plays and shows the current chord', /·/.test(now1), now1.replace(/\s+/g, ' '));
  await shot(page, '4-listen');
  await page.evaluate(() => window.__gappSync.player.pause());

  // correct by ear a section: simulated taps at the aligned times + a known offset
  const target = rows.findIndex((r) => r.state !== 'green');
  const si = target >= 0 ? target : 1;
  const info = await page.evaluate((si) => {
    const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop())));
    const a = s.audio.alignment;
    const idx = [];
    let k = 0;
    s.sections.forEach((sec, i) => sec.lines.forEach((l) => l.chords.forEach(() => { if (i === si) idx.push(k); k++; })));
    return { times: idx.map((j) => a.eventStartSec[j]), n: idx.length };
  }, si);
  await page.click(`.as-row[data-sec="${si}"] [data-act="correct"]`);
  await page.waitForSelector('#corr-tap');
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  rec('C1 correction starts the audio about 2 s before the section', await page.evaluate((t0) => Math.abs(window.__gappSync.player.currentTime() - (t0 - 2)) < 2.5, info.times[0]));
  // taps: drive the audio clock itself (so the test does not depend on wall-clock jitter): seek to the tap time, tap
  const truth = info.times.map((t, k) => t + 0.2 * Math.sin(k)); // "what the person hears": different from the engine
  let tapped = 0;
  for (const t of truth) {
    await page.evaluate((t) => { const p = window.__gappSync.player; p.seek(t); }, t);
    await sleep(60);
    await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 });
    tapped++;
  }
  const cnt = await page.innerText('#corr-count');
  rec('C2 tap counter reaches the number of chords of the section', cnt.startsWith(`${info.n} / ${info.n}`), cnt);
  await shot(page, '5-correct-taps');
  await page.click('#corr-react-up');
  await page.click('#corr-react-down');
  await page.click('#corr-preview');
  await sleep(1500);
  const preNow = await page.$$eval('.corr-chip.now', (c) => c.length);
  rec('C3 preview highlights a chord', preNow === 1, String(preNow));
  await shot(page, '6-correct-preview');
  await page.click('#corr-save');
  await page.waitForSelector('#corr-tap', { state: 'detached' });
  const after = await page.evaluate((si) => {
    const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop())));
    const a = s.audio.alignment;
    return { verified: a.sections[si].verified, starts: a.eventStartSec.slice() };
  }, si);
  let k0 = 0;
  const secs = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); return s.sections.map((x) => x.lines.reduce((n, l) => n + l.chords.length, 0)); });
  for (let i = 0; i < si; i++) k0 += secs[i];
  const errs = truth.map((t, k) => Math.abs(after.starts[k0 + k] - t));
  rec('C4 section saved as verified, times follow the taps (error <= 50 ms)', after.verified && Math.max(...errs) <= 0.05, `max err ${(Math.max(...errs) * 1000).toFixed(0)} ms`);
  await page.waitForSelector(`.as-row[data-sec="${si}"][data-state="verified"]`);
  await shot(page, '7-verified');
  const c2 = await page.innerText('#as-counts');
  rec('C5 summary counts the verified section', /1 verificate/.test(c2), c2);

  // export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#as-export')]);
  const file = path.join(OUT, 'truth-export.json');
  await dl.saveAs(file);
  const truthJson = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec('C6 export: only verified sections, times and chord names', truthJson.kind === 'alignment-truth' && truthJson.sections.length === 1 && truthJson.sections[0].eventStartSec.length === info.n && truthJson.sections[0].chords.length === info.n && !JSON.stringify(truthJson).match(/lyric/i), `${truthJson.sections.length} section, ${info.n} chords, file ${dl.suggestedFilename()}`);

  // back to the song: play with the audio, the highlight follows the aligned timeline
  await page.click('#sync-close');
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp && window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, info.times[0] + 1);
  const hl = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gapp; let bad = 0; let n = 0; const t0 = performance.now();
    (function loop() {
      const ev = g.timeline.events[g.player.eventIndex];
      const el = document.querySelector('.cur');
      if (ev && el) { n++; if (g.player.timeSec < ev.startSec - 0.001) bad++; }
      if (performance.now() - t0 < 4000) requestAnimationFrame(loop); else resolve({ n, bad, aligned: !!g.timeline.aligned });
    })();
  }));
  rec('P1 song play uses the aligned timeline, highlight on a chord at every frame', hl.aligned && hl.n > 100 && hl.bad === 0, JSON.stringify(hl));
  await shot(page, '8-song-play');
  await page.click('#btn-play');
  // reload keeps the alignment
  await page.reload();
  await page.waitForSelector('#btn-sync');
  const kept = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); return !!(s.audio.alignment && s.audio.alignment.sections.some((x) => x.verified)); });
  rec('P2 alignment and verified section survive a reload', kept);
  rec('Z no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function perf(label, profile, rate) {
  dev = label + `-x${rate}`;
  const { browser, page, errors } = await open(profile, { throttle: rate });
  await loadSong(page);
  const t0 = Date.now();
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 600000 });
  const wall = Date.now() - t0;
  const stats = await page.evaluate(() => window.__gappAutosync);
  console.log(`PERF [${dev}] wall ${wall} ms; decode ${stats.decodeMs} ms; analysis ${stats.analyseMs} ms; total ${stats.totalMs} ms; longest slice ${stats.maxSliceMs} ms; yields ${stats.yields}`);
  rec('Q1 decode + analysis under 20 s with CPU x' + rate, stats.totalMs < 20000, `${(stats.totalMs / 1000).toFixed(1)} s`);
  rec('Q2 no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

(async () => {
  if (!fs.existsSync(MP3)) { console.log('mp3 reale assente: salto'); return; }
  const prof = PROFILES[onlyDev];
  if (only === 'flow' || only === 'all') await flow(onlyDev, prof);
  if (only === 'perf' || only === 'all') await perf(onlyDev, prof, 4);
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
