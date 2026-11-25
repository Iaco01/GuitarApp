// Round 6: estimated durations in edit mode, BPM -/+ in the play panel without position jumps
// (metronome on the real file, audio on the synthetic track), panel height.
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round6.cjs [real|audio|height] [360|SE|13]
// ROUND6_BASELINE=<path of an old dist/index.html> adds the height of that build for comparison.
// Screenshots go to test-artifacts/round-6/ (not committed). The real file's text is never printed.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const DIR = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-6');
fs.mkdirSync(OUT, { recursive: true });
const WAV = path.join(DIR, 't4.wav');
const SONG = path.join(DIR, 't4-song.json');
const only = process.argv[2] || 'all';
const onlyDev = process.argv[3] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const PROFILES = {
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};

async function open(profile, url = URL) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
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
// fractional beat position of the player, from the app's own test hook
const POS = `(() => {
  const g = window.__gapp; const bi = g.player.beatIndex; if (bi < 0) return -1;
  const b = g.timeline.beats[bi]; const sec = g.timeline.sections[b.sectionIndex];
  return { pos: b.index + (g.player.timeSec - b.timeSec) / sec.spb, ev: g.player.eventIndex, now: performance.now(), t: g.player.timeSec, bpm: sec.savedBpm };
})()`;
const savedBpms = (page) => page.evaluate(() => window.__gapp.timeline.sections.map((s) => s.savedBpm));

async function panelHeight(page) {
  return page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
}

async function runReal(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importReal(page);
  // ---- estimated durations in edit mode ----
  const counts = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); return { source: s.timingSource, schema: s.schemaVersion, beats: s.sections.flatMap((x) => x.lines.flatMap((l) => l.chords.map((c) => c.beats))) }; });
  const distinct = new Set(counts.beats);
  rec('E1 after import the durations are estimated and not all equal', counts.source === 'estimated' && counts.schema === 3 && distinct.size >= 3, `${counts.beats.length} chords, ${distinct.size} distinct values, total ${counts.beats.reduce((a, b) => a + b, 0)}`);
  await page.click('#btn-edit');
  await page.waitForSelector('#eb-note:not([hidden])');
  rec('E2 edit mode explains where the durations come from', /stimate dalla posizione/.test(await page.innerText('#eb-note')));
  await page.evaluate(() => document.querySelector('.sec-head').scrollIntoView());
  await shot(page, 'edit-durations');
  await page.click('#btn-edit');
  // settings
  await page.click('details.settings summary');
  rec('E3 settings: "Stimate dal testo" is selected, 4 is the average', (await page.getAttribute('.mode-opt[data-mode="estimated"]', 'aria-pressed')) === 'true' && (await page.getAttribute('.beats-opt[data-beats="4"]', 'aria-pressed')) === 'true');
  await shot(page, 'settings');

  // ---- BPM from the panel while playing ----
  await startPlaying(page);
  await sleep(2500);
  rec('P1 no page errors before the BPM change', errors.length === 0, errors.join('|'));
  const h = await panelHeight(page);
  console.log(`INFO [${dev}] panel height while playing: ${h.toFixed(1)} px`);
  await shot(page, 'play-panel');
  const bpm0 = await savedBpms(page);
  let ok = true;
  const log = [];
  for (let i = 0; i < 5; i++) {
    const a = await page.evaluate(POS);
    await page.click('#btn-bpm-up');
    const b = await page.evaluate(POS);
    const adv = b.pos - a.pos;
    const expected = ((b.now - a.now) / 1000) * (a.bpm / 60);
    log.push(`${adv.toFixed(2)}/${expected.toFixed(2)}`);
    if (!(b.ev >= a.ev && b.ev <= a.ev + 1) || adv < -0.02 || Math.abs(adv - expected) > 0.3) ok = false;
    await sleep(120);
  }
  rec('P2 five presses of +: the position never jumps (advance ~ elapsed time, event not skipped)', ok, log.join(' '));
  const bpm1 = await savedBpms(page);
  rec('P3 every section scaled by the same factor, rounded to 0.1', Math.abs(bpm1[0] - (bpm0[0] + 5)) < 0.05 && bpm1.every((v, i) => Math.abs(v - Math.round(bpm0[i] * ((bpm0[0] + 5) / bpm0[0]) * 10) / 10) < 0.11), `${bpm0.slice(0, 3)} -> ${bpm1.slice(0, 3)}`);
  const shownTxt = await page.innerText('#pp-bpm');
  rec('P4 the panel shows the new BPM', shownTxt.includes(String(bpm1[0]).replace('.', ',')), shownTxt);
  // later changes of chord come with the new tempo
  const seq = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gapp; const out = []; let last = -2; const t0 = performance.now();
    (function loop() {
      if (g.player.eventIndex !== last) { last = g.player.eventIndex; out.push([last, performance.now()]); }
      if (performance.now() - t0 < 16000) requestAnimationFrame(loop); else resolve({ out, ev: g.timeline.events.map((e) => e.durSec) });
    })();
  }));
  const diffs = [];
  for (let i = 1; i + 1 < seq.out.length; i++) diffs.push([(seq.out[i + 1][1] - seq.out[i][1]) / 1000, seq.ev[seq.out[i][0]]]);
  const worst = Math.max(...diffs.map(([m, e]) => Math.abs(m - e)), 0);
  rec('P5 chord changes follow the new tempo (<= 80 ms from the timeline)', diffs.length >= 2 && worst < 0.08, `${diffs.length} changes, worst ${(worst * 1000).toFixed(0)} ms`);
  // minus and long press
  const before = (await savedBpms(page))[0];
  await page.click('#btn-bpm-down');
  rec('P6 "−" lowers it by 1', Math.abs((await savedBpms(page))[0] - (before - 1)) < 0.05);
  const box = await page.locator('#btn-bpm-up').boundingBox();
  const b2 = (await savedBpms(page))[0];
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(1450);
  await page.mouse.up();
  const steps = (await savedBpms(page))[0] - b2;
  rec('P7 long press repeats (~5/s after a short delay)', steps >= 3 && steps <= 6, `${steps.toFixed(1)} BPM in 1.45 s`);
  // scope: only this section
  await page.click('#pp-bpm');
  await page.click('#btn-bpm-scope2');
  await page.click('#pp-bpm');
  const s0 = await savedBpms(page);
  await page.click('#btn-bpm-up');
  const s1 = await savedBpms(page);
  const cur = await page.evaluate(() => window.__gapp.timeline.events[window.__gapp.player.eventIndex].sectionIndex);
  rec('P8 scope "Sez.": only the current section changes', s1.every((v, i) => (i === cur ? Math.abs(v - s0[i] - 1) < 0.05 : v === s0[i])), `section ${cur}`);
  await page.click('#btn-bpm-scope');
  rec('P8b the "Sez." chip returns to the whole song', (await page.getAttribute('#btn-bpm-scope2', 'data-scope')) === 'all');
  // typed value
  await page.click('#pp-bpm');
  await page.fill('#pp-bpm-field', '70');
  await page.click('#pp-bpm-apply');
  rec('P9 typed BPM applies', Math.abs((await savedBpms(page))[cur] - 70) < 0.05);
  await shot(page, 'play-after');
  // persistence
  const id = await page.evaluate(() => decodeURIComponent(location.hash.split('/').pop()));
  const stored = await page.evaluate((i) => JSON.parse(localStorage.getItem('gapp.song.' + i)).sections.map((s) => [s.bpm, s.bpmSource]), id);
  rec('P10 saved at once with bpmSource "edited"', stored.every(([, s]) => s === 'edited'), JSON.stringify(stored.slice(0, 3)));
  await page.reload();
  await page.waitForSelector('#btn-play');
  rec('P11 values persist after a reload', Math.abs((await savedBpms(page))[cur] - 70) < 0.05);
  rec('P12 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

async function runAudio(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
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
  await sleep(2500);
  const audioPos = () => page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, now: performance.now(), ev: window.__gapp.player.eventIndex }));
  const bpm0 = await savedBpms(page);
  let ok = true;
  const log = [];
  for (let i = 0; i < 5; i++) {
    const a = await audioPos();
    await page.click('#btn-bpm-up');
    const b = await audioPos();
    const jump = (b.t - a.t) - (b.now - a.now) / 1000;
    log.push(jump.toFixed(3));
    if (Math.abs(jump) > 0.15) ok = false;
    await sleep(150);
  }
  rec('A1 with audio: five presses of +, the audio is never moved', ok, log.join(' '));
  const state = await page.evaluate(() => ({ st: window.__gapp.player.state, paused: window.__gapp.audioEl.paused }));
  rec('A2 still playing', state.st === 'playing' && !state.paused);
  const bpm1 = await savedBpms(page);
  rec('A3 saved BPM scaled', Math.abs(bpm1[0] - (bpm0[0] + 5)) < 0.05, `${bpm0} -> ${bpm1}`);
  const note = await page.innerText('#pp-bpm-note');
  rec('A4 the panel says how much it moved, with "Annulla"', /^\+5 BPM su tutto il brano/.test(note) && /Annulla/.test(note), note.replace(/\n/g, ' '));
  await shot(page, 'audio-note');
  await page.click('#btn-bpm-undo');
  const bpm2 = await savedBpms(page);
  rec('A5 "Annulla" restores the previous values', bpm2.every((v, i) => Math.abs(v - bpm0[i]) < 0.05) && (await page.$eval('#pp-bpm-note', (e) => e.hidden)), `${bpm2}`);
  rec('A6 no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
}

async function runHeight(label, profile) {
  dev = label;
  const base = process.env.ROUND6_BASELINE;
  for (const [name, url] of [['new', URL], ...(base ? [['old', 'file://' + base]] : [])]) {
    const { browser, page } = await open(profile, url);
    await importReal(page);
    await startPlaying(page);
    await sleep(1500);
    const r = await page.evaluate(() => { const p = document.querySelector('#playpanel'); const row2 = document.querySelector('.pp-row2'); return { h: p.getBoundingClientRect().height, rowW: row2.scrollWidth, rowC: row2.clientWidth, vw: innerWidth, over: [...p.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().right > innerWidth + 0.5).length, pat: document.querySelector('.pp-pat').getBoundingClientRect().width }; });
    console.log(`INFO [${dev}] ${name}: panel ${r.h.toFixed(1)} px, row2 ${r.rowW}/${r.rowC}, buttons beyond the screen ${r.over}, pattern width ${r.pat.toFixed(0)}`);
    if (name === 'new') { await shot(page, 'height'); globalThis.__h = r; } else rec('H1 panel at most 8 px higher than before', globalThis.__h.h - r.h <= 8, `${(globalThis.__h.h - r.h).toFixed(1)} px`);
    if (name === 'new') rec('H2 row 2 fits without horizontal overflow', r.rowW <= r.rowC + 1 && r.over === 0, `${r.rowW}/${r.rowC}`);
    await browser.close();
  }
}

(async () => {
  for (const [label, profile] of Object.entries(PROFILES)) {
    if (onlyDev && onlyDev !== label) continue;
    if (only === 'all' || only === 'height') await runHeight(label, profile);
    if ((only === 'all' || only === 'real') && (label === '360' || onlyDev)) await runReal(label, profile);
    if ((only === 'all' || only === 'audio') && (label === 'SE' || onlyDev)) await runAudio(label, profile);
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
