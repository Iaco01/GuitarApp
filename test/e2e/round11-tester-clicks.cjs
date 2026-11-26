// Round 11 tester, A1 (copy of round10-tester-clicks.cjs writing into test-artifacts/round-11): plays the whole real mp3 (synced) on an iPhone SE profile with the metronome on and records every
// metronome oscillator (start time on the AudioContext clock, frequency = accent or not) plus (ctx, media) clock pairs.
// Raw output (times only) goes to test-artifacts/round-10/clicks-raw.json; analysis: round10-tester-clicks-analyse.mjs
// Run: node scripts/build.mjs && node test/e2e/round10-tester-clicks.cjs [SE|13] [startSec] [endSec]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-11');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const from = Number(process.argv[3] || 0), to = Number(process.argv[4] || 1e9);
const SYNTH = process.argv[5] === 'synth' ? { song: path.join(ROOT, 'test-artifacts', 'round-11', 'synth', 'r10-song.json'), mp3: path.join(ROOT, 'test-artifacts', 'round-11', 'synth', 'r10.mp3') } : null;
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(PROFILES[dev])).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__clicks = []; window.__pairs = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this); const st = o.start.bind(o); const ctx = this;
      o.start = (when) => { window.__clicks.push([when, o.frequency.value, ctx.currentTime]); return st(when); };
      return o;
    };
    const origCtx = window.AudioContext;
    setInterval(() => { try { const el = window.__gapp && window.__gapp.audioEl; const c = window.__ctx; if (el && c && !el.paused) window.__pairs.push([c.currentTime, el.currentTime]); } catch (e) {} }, 100);
    const co = AudioContext.prototype.createGain; AudioContext.prototype.createGain = function () { window.__ctx = this; return co.call(this); };
  });
  await page.goto(URL);
  if (SYNTH) {
    await page.setInputFiles('#import-json', SYNTH.song);
    await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
    const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
    await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  } else { await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 }); }
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', SYNTH ? SYNTH.mp3 : MP3); await page.waitForSelector('#as-start'); await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  const al = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
  await page.click('#as-accept').catch(() => {}); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  const tl = await page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.beats, e.sectionIndex, !!e.skipped]), beats: window.__gapp.timeline.beats.map((b) => [b.timeSec, b.isDownbeat ? 1 : 0, b.eventIndex, b.sectionIndex]), sec: window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm]) }));
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.click('#btn-click-icon');
  await page.evaluate((t) => { window.__clicks.length = 0; window.__pairs.length = 0; window.__gapp.audioEl.currentTime = t; }, from);
  const dur = await page.evaluate(() => window.__gapp.audioEl.duration);
  const end = Math.min(to, dur - 1);
  const t0 = Date.now();
  while (true) {
    const t = await page.evaluate(() => window.__gapp.audioEl.currentTime);
    if (t >= end) break;
    if (Date.now() - t0 > (end - from) * 1000 + 60000) break;
    await sleep(2000);
  }
  const clicks = await page.evaluate(() => window.__clicks); const pairs = await page.evaluate(() => window.__pairs);
  fs.writeFileSync(path.join(OUT, `clicks-raw-${SYNTH ? 'synth-' : ''}${dev}.json`), JSON.stringify({ al, tl, clicks, pairs, from, end, errors }));
  console.log('clicks', clicks.length, 'pairs', pairs.length, 'errors', errors.length);
  await browser.close();
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
