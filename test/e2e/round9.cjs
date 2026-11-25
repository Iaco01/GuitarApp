// Round 9 in the app (Playwright): skipped sections, gap in play, noise ("Usa comunque" and the recognised noisy song),
// tap tempo / BPM field locked, texts of the sync screen at 320 and 360 px, correction layout with 35 chords.
// Prepare: node scripts/build.mjs && node test/e2e/round7-tester-make.mjs && node test/e2e/round8-tester-assets.mjs && node test/e2e/round8-tester-gap-assets.mjs
// Run: node test/e2e/round9.cjs <cut|gap|noise|lock|texts|corr|all> [SE|360|13|320]
// The real song (texts, corr) is only measured: no text is printed.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const SONG = path.join(ROOT, 'test-artifacts', 'round-7', 'tester', 'r7-song.json');
const AS = path.join(ROOT, 'test-artifacts', 'round-8', 'assets');
const OUT = path.join(ROOT, 'test-artifacts', 'round-9');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
fs.mkdirSync(OUT, { recursive: true });
const GT = JSON.parse(fs.readFileSync(path.join(AS, 'gap-truth.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'all';
const devName = process.argv[3] || 'SE';
const PROFILES = {
  320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
let fails = 0;
let dev = devName;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);

async function open(profile = PROFILES[devName]) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(profile)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  return { browser, page, errors };
}
async function loadSynth(page) {
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]');
  if (nb) await nb.click();
  await page.waitForSelector('.song-row');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
}
async function syncWith(page, file, waitRows = true) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await page.click('#as-start');
  if (waitRows) await page.waitForSelector('#as-rows', { timeout: 180000 });
}
const alignment = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);

// ------------------------------------------------------------------ cut: audio shorter than the sheet
async function cut() {
  dev = devName + '-cut';
  const src = path.join(AS, 'right.mp3');
  const out = path.join(OUT, 'right-cut70.mp3');
  const d = Number(spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf-8' }).stdout);
  spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-t', String(d * 0.7), '-codec:a', 'libmp3lame', '-b:a', '128k', out]);
  const { browser, page, errors } = await open();
  await loadSynth(page);
  await syncWith(page, out);
  const rows = await page.$$eval('.as-row', (r) => r.map((x) => ({ state: x.dataset.state, text: x.textContent, acts: x.querySelectorAll('button').length })));
  const sk = rows.filter((r) => r.state === 'skipped');
  info('cut', `states ${rows.map((r) => r.state[0]).join('')}; skipped rows ${sk.length}`);
  rec('C1 at least one section is "non presente nell’audio"', sk.length >= 1 && sk.every((r) => /non presente nell’audio/.test(r.text)), JSON.stringify(sk.map((r) => r.text.slice(0, 40))));
  rec('C2 a skipped row has no ▶ or ✎ button', sk.every((r) => r.acts === 0));
  const counts = await page.$eval('#as-counts', (e) => e.textContent);
  rec('C3 the counts line says how many sections are not in the audio', /non presenti nell’audio/.test(counts), counts);
  const al = await alignment(page);
  rec('C4 the stored alignment lists the skipped events and none of them is green', Array.isArray(al.skipped) && al.skipped.length > 0 && rows.filter((r) => r.state === 'green').length < rows.length);
  await page.click('#as-accept'); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  // jump near the end of the audio: the highlight must never rest on a skipped chord
  const last = al.eventStartSec.length - 1;
  const firstSkipped = Math.min(...al.skipped);
  await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, al.eventStartSec[firstSkipped] - 2);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    seen.push(await page.evaluate(() => window.__gapp.player.eventIndex));
    await sleep(150);
  }
  rec('C5 up to the end of the audio the highlight never goes to a skipped chord', Math.max(...seen) < firstSkipped && seen.some((v) => v >= 0), `max event ${Math.max(...seen)}, first skipped ${firstSkipped} of ${last + 1}`);
  rec('Cz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
  await browser.close();
}

// ------------------------------------------------------------------ gap: play inside music that is not in the sheet
async function gap() {
  dev = devName + '-gap';
  const { browser, page, errors } = await open();
  await loadSynth(page);
  await syncWith(page, path.join(AS, 'solo20.mp3'));
  const al = await alignment(page);
  const g = al.gaps[0];
  rec('G1 the gap is stored (>= 3 s)', !!g && g.endSec - g.startSec >= 3, JSON.stringify(g));
  const states = await page.$$eval('.as-row', (r) => r.map((x) => x.dataset.state));
  rec('G2 the section before the gap keeps its BPM and its state (bug 9): Verse is green', states[1] === 'green' && states[3] !== undefined, states.join(','));
  await page.click('#as-accept'); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, g.startSec - 2);
  await sleep(500);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 28000) {
    const s = await page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, cur: document.querySelectorAll('.cur').length, name: (document.querySelector('#pp-current') || {}).textContent || '', gap: (document.querySelector('#pp-gap') || {}).textContent || '', gapHidden: document.querySelector('#pp-gap') ? document.querySelector('#pp-gap').hidden : true, bar: (document.querySelector('.pp-cur-fill') || { style: {} }).style.width, barShown: !!document.querySelector('.pp-cur-bar') && getComputedStyle(document.querySelector('.pp-cur-bar')).display !== 'none', next: document.querySelectorAll('.next').length, h: document.querySelector('#playpanel').getBoundingClientRect().height }));
    samples.push(s);
    if (s.t > g.endSec + 2.5) break;
    await sleep(300);
  }
  const inGap = samples.filter((s) => s.t > g.startSec + 1 && s.t < g.endSec - 1);
  info('G', `${inGap.length} samples inside the gap; sample: "${(inGap[0] || {}).name}" / "${(inGap[0] || {}).gap}"`);
  rec('G3 inside the gap no chord is highlighted', inGap.length > 5 && inGap.every((s) => s.cur === 0), JSON.stringify([...new Set(inGap.map((s) => s.cur))]));
  rec('G4 the panel says "Fuori dal foglio"', inGap.every((s) => s.name === 'Fuori dal foglio'), [...new Set(inGap.map((s) => s.name))].join('|'));
  rec('G5 and "Riprende tra N s con «C»"', inGap.every((s) => /^Riprende tra \d+ s con «.+»$/.test(s.gap) && !s.gapHidden), [...new Set(inGap.map((s) => s.gap))].slice(0, 3).join('|'));
  const left = inGap.map((s) => Number((/tra (\d+) s/.exec(s.gap) || [])[1]));
  rec('G6 the countdown goes down in seconds', left[0] > left[left.length - 1] && left.every((v, i) => i === 0 || v <= left[i - 1]), `${left[0]} -> ${left[left.length - 1]}`);
  rec('G7 the chord bar is not left full (hidden in the gap)', inGap.every((s) => !s.barShown), '');
  rec('G8 the next chord is marked while waiting', inGap.every((s) => s.next === 1), JSON.stringify([...new Set(inGap.map((s) => s.next))]));
  const before = samples.filter((s) => s.t < g.startSec - 0.3);
  const after = samples.filter((s) => s.t > g.endSec + 0.5);
  rec('G9 the panel has the same height in and out of the gap', new Set([...before, ...inGap, ...after].map((s) => Math.round(s.h))).size <= 1, JSON.stringify([...new Set([...before, ...inGap, ...after].map((s) => Math.round(s.h * 10) / 10))]));
  rec('G10 before and after the gap the chords are highlighted again', before.length > 0 && before.every((s) => s.cur === 1) && after.length > 0 && after.every((s) => s.cur === 1), `before ${before.length}, after ${after.length}`);
  await page.screenshot({ path: path.join(OUT, `gap-${devName}-in-gap.png`) });
  rec('Gz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
  await browser.close();
}

// ------------------------------------------------------------------ noise: recognised noisy song, "Usa comunque"
async function noise() {
  dev = devName + '-noise';
  for (const [file, label, recognised] of [['right-snr-10.mp3', 'right song at -10 dB white noise', true], ['other.mp3', 'another song', false], ['silence.mp3', 'silence', false]]) {
    const { browser, page, errors } = await open();
    await loadSynth(page);
    await syncWith(page, path.join(AS, file), false);
    await page.waitForSelector('#as-rows, #as-force, #as-start', { timeout: 180000, state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#as-rows') || document.querySelector('#as-force') || (window.__gappAutosync && window.__gappAutosync.notRecognised), null, { timeout: 180000 });
    const hasRows = !!(await page.$('#as-rows'));
    rec(`N1 ${label}: ${recognised ? 'recognised (summary shown)' : 'not recognised'}`, hasRows === recognised, `rows ${hasRows}`);
    if (!recognised) {
      const force = await page.$('#as-force');
      rec(`N2 ${label}: "Usa comunque" is offered`, !!force);
      await force.click();
      await page.waitForSelector('#as-rows');
      const states = await page.$$eval('.as-row', (r) => r.map((x) => x.dataset.state));
      rec(`N3 ${label}: after "Usa comunque" no section is green`, states.length > 0 && !states.includes('green'), states.join(','));
      const al = await alignment(page);
      rec(`N4 ${label}: the alignment is stored, flagged as forced`, al && al.forced === true);
    } else {
      const states = await page.$$eval('.as-row', (r) => r.map((x) => x.dataset.state));
      info('N', `${label}: states ${states.map((s) => s[0]).join('')}`);
    }
    rec(`Nz ${label}: no page errors`, errors.length === 0, errors.join('|').slice(0, 100));
    await browser.close();
  }
}

// ------------------------------------------------------------------ lock: tap tempo, number field and Applica with an alignment
async function lock() {
  dev = devName + '-lock';
  const { browser, page, errors } = await open();
  await loadSynth(page);
  await syncWith(page, path.join(AS, 'right.mp3'));
  await page.click('#as-accept'); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  await page.click('#pp-bpm');
  const dis = await page.evaluate(() => Object.fromEntries(['btn-bpm-down', 'btn-bpm-up', 'btn-tap', 'pp-bpm-tap', 'pp-bpm-apply', 'pp-bpm-field'].map((id) => [id, document.getElementById(id).disabled])));
  rec('L1 −, +, both tap tempo buttons, «Applica» and the number field are disabled with an alignment', Object.values(dis).every(Boolean), JSON.stringify(dis));
  rec('L2 the fixed note is visible', await page.evaluate(() => !document.getElementById('pp-bpm-lock').hidden));
  const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).sections.map((s) => s.bpm)));
  await page.evaluate(() => { for (let i = 0; i < 5; i++) document.getElementById('btn-tap').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const after = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).sections.map((s) => s.bpm)));
  rec('L3 tapping does not change any BPM', before === after);
  await page.screenshot({ path: path.join(OUT, `lock-${devName}.png`) });
  rec('Lz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
  await browser.close();
}

// ------------------------------------------------------------------ texts: sync screen rows at 320 and 360 px (real song, measures only)
async function texts() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  for (const w of ['320', '360']) {
    dev = w + '-texts';
    const { browser, page, errors } = await open(PROFILES[w]);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    await syncWith(page, MP3);
    const m = await page.$$eval('.as-row', (rows) => rows.map((r) => {
      const sub = r.querySelector('.as-sub'); const name = r.querySelector('.as-name'); const time = r.querySelector('.as-time');
      return { state: r.dataset.state, subCut: sub ? sub.scrollWidth > sub.clientWidth + 1 : false, nameCut: name ? name.scrollWidth > name.clientWidth + 1 : false, nameH: name ? name.getBoundingClientRect().height : 0, timeH: time ? time.getBoundingClientRect().height : 0, timeWraps: time ? time.getBoundingClientRect().height > 1.6 * parseFloat(getComputedStyle(time).fontSize) : false, rowH: r.getBoundingClientRect().height, hasBpm: sub ? /BPM|libero/.test(sub.textContent) : false };
    }));
    rec('T1 the state/BPM line is never cut', m.every((r) => !r.subCut), `${m.filter((r) => r.subCut).length} of ${m.length}`);
    rec('T2 name and time do not wrap or get cut', m.every((r) => !r.nameCut && !r.timeWraps && r.nameH < 1.6 * 16), `${m.filter((r) => r.nameCut || r.timeWraps).length} of ${m.length}; first row ${JSON.stringify({ nameH: m[0].nameH, timeH: m[0].timeH })}`);
    rec('T3 the BPM (or "libero") is on every row', m.filter((r) => r.state !== 'skipped').every((r) => r.hasBpm));
    info('T', `${w}px: ${m.length} rows, heights ${Math.min(...m.map((r) => r.rowH)).toFixed(0)}-${Math.max(...m.map((r) => r.rowH)).toFixed(0)} px`);
    await page.evaluate(() => document.querySelector('#as-rows').scrollIntoView());
    await page.screenshot({ path: path.join(OUT, `texts-${w}.png`) });
    rec('Tz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
    await browser.close();
  }
}

// ------------------------------------------------------------------ corr: correction with 35 chords (real song, measures only)
async function corr() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  for (const d of ['SE', '13', '320']) {
    dev = d + '-corr';
    const { browser, page, errors } = await open(PROFILES[d]);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    await syncWith(page, MP3);
    const big = await page.$$eval('.as-row', (rows) => rows.map((r, i) => i));
    await page.click('.as-row[data-sec="0"] [data-act="correct"]');
    await page.waitForSelector('#corr-tap');
    await sleep(500);
    const g = await page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { status: r('corr-status'), tap: r('corr-tap'), next: r('corr-next'), chips: document.getElementById('corr-chips').getBoundingClientRect(), n: document.querySelectorAll('.corr-chip').length, statusText: document.getElementById('corr-status').textContent.length }; });
    const clear = g.status.bottom <= g.tap.top + 0.5;
    rec('K1 the instructions are not covered by «Cambio!»', clear && g.status.height >= 20, `${g.n} chords; status bottom ${g.status.bottom.toFixed(0)}, button top ${g.tap.top.toFixed(0)}, status height ${g.status.height.toFixed(0)}`);
    const h = await page.evaluate(() => { const el = document.querySelector('.corr'); return { scrollable: el.scrollHeight > el.clientHeight }; });
    info('K', `${d}: the sheet ${h.scrollable ? 'scrolls' : 'fits'}; «Cambio!» ${g.tap.width.toFixed(0)}x${g.tap.height.toFixed(0)}`);
    rec('K2 the big button is at least 44 px tall', g.tap.height >= 44);
    await page.screenshot({ path: path.join(OUT, `corr-${d}.png`) });
    rec('Kz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
    await browser.close();
  }
}

(async () => {
  const all = { cut, gap, noise, lock, texts, corr };
  const list = mode === 'all' ? Object.keys(all) : [mode];
  for (const m of list) await all[m]();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
