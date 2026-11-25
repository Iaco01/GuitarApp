// Round 9: the MP3 decoded in pieces in the browser gives the same timeline as ffmpeg's full decode in Node? Runs the
// automatic sync in the app (real mp3, local only) and in Node on the ffmpeg decode, and compares the start of every
// event (counts and milliseconds only).   node test/e2e/round9-decode-check.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext(devices['iPhone SE (3rd gen)'] || { viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.join(ROOT, 'dist', 'index.html'));
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play');
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3);
  await page.waitForSelector('#as-start');
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  const app = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('gapp.song.')); const s = JSON.parse(localStorage.getItem(k)); return { starts: s.audio.alignment.eventStartSec, gaps: s.audio.alignment.gaps, skipped: s.audio.alignment.skipped, audioSec: window.__gappAutosync.audioSec }; });
  await browser.close();
  const { parseSongFromMht } = await import(path.join(ROOT, 'src', 'parser.js'));
  const { analyseAndAlign } = await import(path.join(ROOT, 'src', 'analysis', 'autosync.js'));
  const song = parseSongFromMht(fs.readFileSync(REAL, 'utf-8'));
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', MP3, '-f', 'f32le', '-ac', '1', '-ar', '11025', '-'], { maxBuffer: 1 << 30 });
  const samples = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  const res = analyseAndAlign({ samples, sampleRate: 11025, song });
  const diffs = app.starts.map((t, j) => t - res.eventStartSec[j]);
  const abs = diffs.map(Math.abs).sort((a, b) => a - b);
  const med = diffs.slice().sort((a, b) => a - b)[diffs.length >> 1];
  console.log(`app audio ${app.audioSec.toFixed(2)} s (ffmpeg ${(samples.length / 11025).toFixed(2)} s); events ${diffs.length}; app - node: median ${(med * 1000).toFixed(0)} ms, |diff| p50 ${(abs[abs.length >> 1] * 1000).toFixed(0)} ms, p90 ${(abs[Math.floor(abs.length * 0.9)] * 1000).toFixed(0)} ms, max ${(abs[abs.length - 1] * 1000).toFixed(0)} ms; within 100 ms ${abs.filter((x) => x <= 0.1).length}/${abs.length}; page errors ${errors.length}`);
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
