// Round 2 checks on dist/index.html with the real (git-ignored) file.
// Run: npm run build && node test/e2e/round2.cjs   Screenshots go to test-artifacts/round-2/.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-2');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] || '';

let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In page: counts words whose characters are on different rows.
function splitWordsProbe() {
  let words = 0;
  let split = 0;
  const examples = [];
  for (const line of document.querySelectorAll('.song-body .line')) {
    if (line.getBoundingClientRect().width === 0) continue;
    const chars = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement.closest('.ch')) continue;
      for (let i = 0; i < n.data.length; i++) chars.push([n, i]);
    }
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      words++;
      const tops = cur.map(([nd, i]) => {
        const r = document.createRange();
        r.setStart(nd, i); r.setEnd(nd, i + 1);
        return r.getBoundingClientRect().top;
      });
      if (Math.max(...tops) - Math.min(...tops) > 4) {
        split++;
        if (examples.length < 3) examples.push(cur.length);
      }
      cur = [];
    };
    for (const c of chars) {
      if (/\s/.test(c[0].data[c[1]])) flush();
      else cur.push(c);
    }
    flush();
  }
  return { words, split, examples, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__osc = [];
    const AC = window.AudioContext;
    if (AC) {
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { window.__osc.push(this.currentTime); return orig.call(this); };
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title');
  rec('import', (await page.textContent('#song-title')) === 'American Pie');

  // ---- split words at 3 scales ----
  for (const scale of [1.0, 1.5, 2.0]) {
    await page.evaluate((v) => document.querySelector('.screen.song').style.setProperty('--fs', String(v)), scale);
    await page.evaluate(() => document.querySelectorAll('details.rep').forEach((d) => { d.open = true; }));
    const r = await page.evaluate(splitWordsProbe);
    rec(`split-words@${scale}`, r.split === 0 && r.overflowX <= 0, JSON.stringify(r));
  }
  await page.evaluate(() => { document.querySelector('.screen.song').style.setProperty('--fs', '1'); document.querySelectorAll('details.rep').forEach((d) => { d.open = false; }); });
  if (only === 'split') { await browser.close(); process.exit(fails ? 1 : 0); }

  // ---- 20 s of playback vs timeline ----
  await page.evaluate(() => {
    window.__rec = [];
    const loop = () => {
      const g = window.__gapp;
      if (g) window.__rec.push({ t: performance.now(), p: g.player.timeSec, e: g.player.eventIndex, s: g.player.state, b: g.player.beatIndex });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.click('#btn-play');
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'count-in.png') });
  await sleep(9000);
  await page.screenshot({ path: path.join(OUT, 'playing.png') });
  await sleep(10500);
  const data = await page.evaluate(() => ({ rec: window.__rec, events: window.__gapp.timeline.events.map((e) => e.startSec), sections: window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm]), osc: window.__osc }));
  await page.click('#btn-play'); // pause
  const rows = data.rec.filter((x) => x.s === 'playing');
  const expectedAt = (sec) => { let lo = 0; let hi = data.events.length - 1; let a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (data.events[m] <= sec) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  const mism = rows.filter((x) => x.e !== expectedAt(x.p)).length;
  rec('playback-consistent', rows.length > 500 && mism === 0, `${rows.length} frames, ${mism} mismatches`);
  const changes = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].e !== rows[i - 1].e) changes.push({ e: rows[i].e, err: rows[i].p - data.events[rows[i].e] });
  rec('chord-changes-on-time', changes.length >= 3 && changes.every((c) => c.err >= 0 && c.err < 0.05), JSON.stringify(changes.map((c) => [c.e, Math.round(c.err * 1000) / 1000])));
  const counting = data.rec.filter((x) => x.s === 'counting');
  const t0 = rows[0].t; const p0 = rows[0].p;
  const lastRow = rows[rows.length - 1];
  const drift = (lastRow.p - p0) - (lastRow.t - t0) / 1000;
  rec('clock-vs-wallclock', Math.abs(drift) < 0.1, `drift ${drift.toFixed(3)} s over ${((lastRow.t - t0) / 1000).toFixed(1)} s; count-in frames ${counting.length}`);
  const oscs = data.osc.length;
  rec('metronome-clicks', oscs >= 20, `${oscs} oscillators created`);
  console.log('first playing time', p0.toFixed(3), 'sections', JSON.stringify(data.sections.slice(0, 3)));
  await page.screenshot({ path: path.join(OUT, 'paused.png') });
  await page.click('#btn-stop');

  // ---- start from a tapped chord (paused) and section loop by long press ----
  await page.click('#btn-stop');
  await page.evaluate(() => window.scrollTo(0, 0));
  const secs = await page.evaluate(() => window.__gapp.timeline.sections.map((x) => [x.startSec, x.endSec]));
  // loop on the 2nd box (Chorus): long press on its header
  const head = page.locator('.sec-head').nth(1);
  await head.scrollIntoViewIfNeeded();
  const box = await head.locator('.sec-title').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await sleep(700);
  await page.mouse.up();
  await sleep(300);
  rec('loop-active', (await page.locator('.sec.looping').count()) === 1 && (await page.locator('.loop-x').count()) === 1);
  await page.screenshot({ path: path.join(OUT, 'loop.png') });
  // tap a chord near the end of the chorus (plays from there with count-in), then watch the wrap
  const lastRef = await page.evaluate(() => { const e = window.__gapp.timeline.events.filter((x) => x.sectionIndex === 1); return e[e.length - 2].ref; });
  const lastEl = page.locator(`.ch[data-ref="${lastRef}"]`).first();
  await lastEl.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__gapp.player.state === 'playing');
  await lastEl.click();
  const seen = [];
  const tl0 = Date.now();
  while (Date.now() - tl0 < 14000) { const g = await page.evaluate(() => ({ t: window.__gapp.player.timeSec, s: window.__gapp.player.state })); if (g.s === 'playing') seen.push(g.t); await sleep(100); }
  const maxSeen = Math.max(...seen);
  const wrapped = seen.some((t, i) => i > 0 && t < seen[i - 1] - 1);
  rec('loop-wraps-and-stays', wrapped && seen.every((t) => t >= secs[1][0] - 0.05 && t <= secs[1][1] + 0.05), `max ${maxSeen.toFixed(1)} of ${secs[1].map((x) => x.toFixed(1))}, wrapped ${wrapped}`);
  await page.click('.loop-x');
  rec('loop-exit', (await page.locator('.sec.looping').count()) === 0);
  await page.click('#btn-stop');

  // ---- tap tempo sets the section tempo ----
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).sections[0].bpm);
  for (let i = 0; i < 5; i++) { await page.click('#btn-tap'); await sleep(500); }
  const after = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).sections[0]; return [s.bpm, s.bpmSource]; });
  rec('tap-tempo', before === 62 && after[1] === 'edited' && after[0] >= 98 && after[0] <= 125, `62 -> ${after}`);

  // ---- edit durations ----
  await page.click('#btn-edit');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.ch[data-ref="0.0.0"]').click();
  await page.click('#eb-plus');
  await page.click('#eb-plus');
  await page.click('#eb-minus');
  rec('stepper', (await page.textContent('#eb-val')) === '5');
  await page.locator('.ch[data-ref="0.0.0"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'edit.png') });
  const saved = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))); return [s.sections[0].lines[0].chords[0].beats, s.timingSource]; });
  rec('stepper-saved', saved[0] === 5 && saved[1] === 'edited', JSON.stringify(saved));
  const copyBtns = await page.locator('.copy-beats').count();
  console.log('copy buttons', copyBtns);

  // ---- tap recording of the first section ----
  await page.locator('.rec-sec').first().click();
  await page.waitForSelector('#rec-tap');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'record-count.png') });
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  // tap every 4 beats at the section tempo (tap tempo above changed it) with one double tap
  const bpm = await page.evaluate(() => window.__gapp.timeline.sections[0].bpm);
  const spb = 60000 / bpm;
  const n = await page.evaluate(() => window.__gapp.timeline.events.filter((e) => e.sectionIndex === 0).length);
  const start = Date.now();
  for (let k = 1; k <= 3; k++) {
    const wait = start + k * 4 * spb - Date.now();
    if (wait > 0) await sleep(wait);
    await page.click('#rec-tap');
    if (k === 2) { await sleep(60); await page.click('#rec-tap'); }
  }
  await page.screenshot({ path: path.join(OUT, 'record-tap.png') });
  await page.click('#rec-end');
  await page.waitForSelector('#rec-summary');
  await page.screenshot({ path: path.join(OUT, 'record-preview.png') });
  const recRows = await page.locator('#rec-rows li .rec-row-val').allTextContents();
  console.log('preview recRows (first 6):', recRows.slice(0, 6).join(' | '), 'of', n);
  rec('record-preview', recRows.length === n && recRows.slice(0, 3).every((t) => /→ 4$/.test(t)), recRows.slice(0, 3).join(','));
  await page.click('#rec-save');
  const rs = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))); return s.timingSource; });
  rec('record-saved', rs === 'recorded');

  // ---- persistence after reload ----
  await page.reload();
  await page.waitForSelector('#song-title');
  const persisted = await page.evaluate(() => window.__gapp.timeline.sections[0].bpm);
  rec('persist-after-reload', persisted === bpm, String(persisted));

  // ---- importing the same file again ----
  await page.click('#btn-back');
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('.dlg');
  await page.screenshot({ path: path.join(OUT, 'duplicate.png') });
  await page.click('.dlg [data-value="replace"]');
  await page.waitForSelector('#song-title');
  const edited = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))); return [s.timingSource, s.sections[0].bpm, JSON.parse(localStorage.getItem('gapp.index.v1')).length]; });
  rec('reimport-replace-keeps-edits', edited[0] === 'recorded' && edited[1] === bpm && edited[2] === 1, JSON.stringify(edited));

  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
