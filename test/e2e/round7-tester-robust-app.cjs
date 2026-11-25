// Round 7 tester, B2 in the app: odd audio files (shorter, with noise only, long silence, mono 22 kHz) on my synthetic song.
// What the person sees: colours per section and messages. Files are made with ffmpeg (tests only) from test-artifacts/round-7/tester/r7.wav.
// Run: node test/e2e/round7-tester-make.mjs && node test/e2e/round7-tester-robust-app.cjs
const { chromium, devices } = require('playwright');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const OUT = path.join(ROOT, 'test-artifacts', 'round-7', 'tester');
const WAV = path.join(OUT, 'r7.wav');
const SONG = path.join(OUT, 'r7-song.json');
const FF = '/usr/bin/ffmpeg';
const ff = (args) => { const r = spawnSync(FF, ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const files = {
  shorter: ['-i', WAV, '-t', '75', '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'r7-short.mp3')],
  longer: ['-i', WAV, '-i', WAV, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'r7-double.mp3')],
  noise: ['-f', 'lavfi', '-i', 'anoisesrc=d=120:c=white:a=0.3', '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'r7-noise.mp3')],
  silence10: ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-i', WAV, '-filter_complex', '[0:a]atrim=duration=10[s];[s][1:a]concat=n=2:v=0:a=1', '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'r7-silence10.mp3')],
  mono22k: ['-i', WAV, '-ac', '1', '-ar', '22050', '-codec:a', 'libmp3lame', '-b:a', '64k', path.join(OUT, 'r7-mono22.mp3')],
  digsilence: ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '120', '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'r7-digsil.mp3')],
};
const out = { shorter: 'r7-short.mp3', longer: 'r7-double.mp3', noise: 'r7-noise.mp3', silence10: 'r7-silence10.mp3', mono22k: 'r7-mono22.mp3', digsilence: 'r7-digsil.mp3' };
let fails = 0;
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [name, args] of Object.entries(files)) {
    ff(args);
    const ctx = await browser.newContext(devices['iPhone SE (3rd gen)'] || { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(URL);
    await page.setInputFiles('#import-json', SONG);
    await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
    const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
    await page.waitForSelector('.song-row'); await page.click('.song-row');
    await page.waitForSelector('#btn-sync'); await page.click('#btn-sync');
    await page.waitForSelector('#sync-file', { state: 'attached' });
    await page.setInputFiles('#sync-file', path.join(OUT, out[name]));
    await page.waitForSelector('#as-start', { timeout: 30000 });
    await page.click('#as-start');
    const t0 = Date.now();
    await page.waitForSelector('#as-rows, .msg.error, #lib-msg', { timeout: 120000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const res = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.as-row')].map((r) => r.dataset.state[0]).join(''),
      counts: (document.querySelector('#as-counts') || {}).textContent || '',
      toast: [...document.querySelectorAll('[role=status],[role=alert],.toast,.msg')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 220),
      transpose: !!document.querySelector('#as-transpose'),
      tText: (document.querySelector('#as-transpose') || { textContent: '' }).textContent.slice(0, 80),
      bpm: [...document.querySelectorAll('.as-row')].map((r) => (r.querySelector('.as-sub, .as-meta, p, div') || {}).textContent || '').length,
    }));
    const sub = await page.$$eval('.as-row', (rs) => rs.map((r) => (r.innerText.split('\n').find((l) => /BPM|libero/.test(l)) || '').trim()));
    console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s | states ${res.rows || '(no summary)'} | ${res.counts} | transpose box: ${res.transpose ? res.tText : 'no'} | message: ${res.toast.replace(/\s+/g, ' ')}`);
    if (sub.length) console.log(`   rows: ${sub.map((s) => s.replace(/\s*·\s*\d+ accordi/, '')).join(' || ')}`);
    await page.screenshot({ path: path.join(OUT, `robust-${name}.png`) });
    if (errors.length) { fails++; console.log('   PAGE ERRORS', errors.slice(0, 2)); }
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} with page errors` : 'no page errors');
})();
