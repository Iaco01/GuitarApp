// Round 9: where do the long frames come from? CPU x4 on the real mp3 (local only): per run, the long tasks with their
// time relative to the click on "Sincronizza automaticamente" and the phase (decode / analysis / after), the
// longest frame, the total, the cancel latency, and the process RSS (sum of the Chromium processes) before / peak.
//   node test/e2e/round9-perf.cjs [SE|360|13] [rate=4] [runs=3]
// Prepare: node scripts/build.mjs. The real song's text is never printed.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const devName = process.argv[2] || 'SE';
const rate = Number(process.argv[3] || 4);
const runs = Number(process.argv[4] || 3);
const PROFILES = { 360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rss = () => { try { return execSync("ps -eo rss,args | grep -i 'chrom' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim() * 1; } catch { return 0; } };
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  let fails = 0;
  for (let r = 0; r < runs; r++) {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const ctx = await browser.newContext(PROFILES[devName]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.addInitScript(() => {
      window.__gaps = []; window.__long = [];
      let last = performance.now();
      (function loop() { const n = performance.now(); window.__gaps.push([n, n - last]); last = n; requestAnimationFrame(loop); })();
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
    });
    await page.goto(URL);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    await page.click('#btn-sync');
    await page.waitForSelector('#sync-file', { state: 'attached' });
    await page.setInputFiles('#sync-file', MP3);
    await page.waitForSelector('#as-start', { timeout: 30000 });
    await sleep(1000);
    const base = rss();
    let peak = 0; let stop = false;
    const sampler = (async () => { while (!stop) { peak = Math.max(peak, rss()); await sleep(60); } })();
    const t1 = await page.evaluate(() => performance.now());
    await page.click('#as-start');
    await page.waitForSelector('#as-rows', { timeout: 900000 });
    const t2 = await page.evaluate(() => performance.now());
    stop = true; await sampler;
    const st = await page.evaluate(() => window.__gappAutosync);
    const d = await page.evaluate(([a, b]) => ({ gaps: window.__gaps.filter(([t]) => t >= a && t <= b), long: window.__long.filter(([t]) => t >= a && t <= b) }), [t1, t2]);
    const tDecode = t1 + st.decodeMs;
    const phase = (t) => (t < tDecode ? 'decode' : t > t2 - 1500 ? 'end' : 'analysis');
    const longest = Math.max(...d.gaps.map((g) => g[1]));
    const tl = d.long.map(([t, dur]) => `${phase(t)}@${((t - t1) / 1000).toFixed(1)}s:${dur.toFixed(0)}ms`).join(' ');
    // cancel latency measured from the page (click handler to the state change), not through the click actionability checks
    await page.click('#as-redo');
    await page.waitForFunction(() => { const p = document.querySelector('#as-progress'); return p && p.value >= 0.3; }, null, { timeout: 300000 });
    const lat = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      const obs = new MutationObserver(() => { if (document.querySelector('#as-start, #as-rows') && !document.querySelector('#as-progress')) { obs.disconnect(); resolve(performance.now() - t0); } });
      obs.observe(document.body, { childList: true, subtree: true });
      document.querySelector('#as-cancel').click();
    }));
    console.log(`run ${r + 1} [${devName} x${rate}]: total ${((t2 - t1) / 1000).toFixed(1)} s (decode ${st.decodeMs} ms, analysis ${st.analyseMs} ms, longest slice ${st.maxSliceMs} ms); frames ${d.gaps.length}, longest ${longest.toFixed(0)} ms; long tasks ${d.long.length}: ${tl}; cancel (page) ${lat.toFixed(0)} ms; RSS before ${(base / 1024).toFixed(0)} MB, peak ${(peak / 1024).toFixed(0)} MB (+${((peak - base) / 1024).toFixed(0)}); errors ${errors.length}`);
    if (errors.length) fails++;
    await browser.close();
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
