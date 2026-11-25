// Round 8: BPM -/+ locked with the alignment, panel height idle vs play, compact sync screen with a fixed bar,
// "Correggi a orecchio" with missing taps, "Audio non riconosciuto", gaps (music not in the sheet), CPU x4.
// Uses the synthetic song of the round 7 tester (no copyrighted text) and, for the panel height, the real song if present.
// Run: npm run build && node test/e2e/round7-tester-make.mjs && node test/e2e/round8.cjs [panel|sync|correct|robust|all] [360|SE|13]
// Screenshots go to test-artifacts/round-8/ (not committed).
const { chromium, devices } = require('playwright');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const T7 = path.join(ROOT, 'test-artifacts', 'round-7', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-8');
fs.mkdirSync(OUT, { recursive: true });
const SONG = path.join(T7, 'r7-song.json');
const WAV = path.join(T7, 'r7.wav');
const MP3 = path.join(T7, 'r7.mp3');
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
const ff = (args) => { const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${dev}-${name}.png`) });

async function open(profile) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  return { browser, page, errors };
}
async function importSynthetic(page) {
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]');
  if (nb) await nb.click();
  await page.waitForSelector('.song-row');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
}
async function syncWith(page, file) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await page.click('#as-start');
  await page.waitForFunction(() => document.querySelector('#as-rows') || document.querySelector('#sync-msg.error') || (window.__gappAutosync && window.__gappAutosync.notRecognised), null, { timeout: 120000 });
  await sleep(400);
}
const panelH = (page) => page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);

// ---- 1. panel height: stopped = playing (real song with rhythm row on, and the synthetic one with an alignment)
async function panel(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  if (fs.existsSync(REAL)) {
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    if (await page.evaluate(() => window.innerHeight < 700)) { await page.click('#btn-more'); await page.click('#btn-pp-rhythm'); await page.click('#btn-more'); }
    const hIdle = await panelH(page);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
    const hs = [];
    for (let i = 0; i < 12; i++) { hs.push(await panelH(page)); await sleep(500); }
    rec('H1 panel height stopped = playing (real song, rhythm row on)', Math.max(...hs) - hIdle < 0.5 && hIdle - Math.min(...hs) < 0.5, `idle ${hIdle} play ${Math.min(...hs)}-${Math.max(...hs)}`);
    await page.click('#btn-play');
    await sleep(300);
    const hStop = await panelH(page);
    rec('H2 panel height back to the same after Stop/pause', Math.abs(hStop - hIdle) < 0.5, `${hStop} vs ${hIdle}`);
  } else console.log('INFO real song absent: H1/H2 skipped');
  await browser.close();
  rec('Z no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
}

// ---- 2. BPM -/+ off with the alignment; sync screen layout
async function sync(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importSynthetic(page);
  const free = await page.evaluate(() => ({ down: document.querySelector('#btn-bpm-down').disabled, up: document.querySelector('#btn-bpm-up').disabled, note: !document.querySelector('#pp-bpm-lock').hidden }));
  rec('B0 without alignment: BPM -/+ on, no note', !free.down && !free.up && !free.note, JSON.stringify(free));
  await syncWith(page, MP3);
  // compact summary
  const rows = await page.$$eval('.as-row', (rs) => rs.map((r) => r.getBoundingClientRect().height));
  rec('S1 one compact row per section (<= 64 px)', rows.length === 8 && Math.max(...rows) <= 64, `${rows.length} rows, ${Math.min(...rows).toFixed(0)}-${Math.max(...rows).toFixed(0)} px`);
  const btns = await page.$$eval('.as-row .as-act', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
  rec('S2 row buttons are >= 44 px', btns.length === 16 && btns.every(([w, h]) => w >= 43.5 && h >= 43.5), `${btns.length} buttons`);
  // "Fatto" in the fixed bar: visible without scrolling, still there after scrolling to the end
  const doneBox = () => page.evaluate(() => { const r = document.querySelector('#sync-close').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, pos: getComputedStyle(document.querySelector('#sync-foot')).position }; });
  const d0 = await doneBox();
  rec('S3 "Fatto" is in the fixed bar, in view at the top of the screen', d0.pos === 'fixed' && d0.bottom <= d0.h + 0.5 && d0.top >= 0, JSON.stringify(d0));
  await page.evaluate(() => { const o = document.querySelector('.rec.sync'); o.scrollTop = o.scrollHeight; });
  await sleep(200);
  const d1 = await doneBox();
  rec('S4 "Fatto" is in view after scrolling to the bottom', d1.bottom <= d1.h + 0.5 && d1.top >= 0, JSON.stringify(d1));
  await page.evaluate(() => { document.querySelector('.rec.sync').scrollTop = 0; });
  // a notice does not cover the rows: it sits above the fixed bar, and the last row can still be scrolled above it
  await page.click('#as-accept');
  await sleep(300);
  const geo = await page.evaluate(() => {
    const t = document.querySelector('#sync-msg').getBoundingClientRect();
    const f = document.querySelector('#sync-foot').getBoundingClientRect();
    const o = document.querySelector('.rec.sync');
    o.scrollTop = o.scrollHeight;
    const rows = [...document.querySelectorAll('.as-row')];
    const last = rows[rows.length - 1].getBoundingClientRect();
    return { toastTop: t.top, toastBottom: t.bottom, footTop: f.top, lastRowBottom: last.bottom, toastText: document.querySelector('#sync-msg').textContent.slice(0, 40), shown: getComputedStyle(document.querySelector('#sync-msg')).display !== 'none' };
  });
  rec('S5 notice inside the fixed bar, above its buttons; the last row scrolls above the whole bar', geo.shown && geo.toastBottom <= geo.footTop + 40 && geo.lastRowBottom <= geo.footTop + 0.5, JSON.stringify(geo));
  await shot(page, 'sync-summary');
  await page.evaluate(() => { document.querySelector('.rec.sync').scrollTop = 0; });
  await shot(page, 'sync-top');
  await page.click('#sync-close');
  await page.waitForSelector('#btn-play');
  const lock = await page.evaluate(() => ({ down: document.querySelector('#btn-bpm-down').disabled, up: document.querySelector('#btn-bpm-up').disabled, note: document.querySelector('#pp-bpm-lock').hidden ? '' : document.querySelector('#pp-bpm-lock').textContent, aligned: !!window.__gapp.timeline.aligned }));
  rec('B1 with the alignment BPM -/+ are disabled and the note is shown', lock.aligned && lock.down && lock.up && /segue l.audio/.test(lock.note) && /Correggi a orecchio/.test(lock.note), JSON.stringify(lock));
  const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).sections.map((s) => s.bpm)));
  await page.click('#btn-bpm-up', { force: true, timeout: 1000 }).catch(() => {});
  const after = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).sections.map((s) => s.bpm)));
  rec('B2 pressing + changes nothing', before === after);
  await shot(page, 'panel-locked');
  // panel height stopped = playing with the alignment
  const hIdle = await panelH(page);
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  const hs = [];
  for (let i = 0; i < 8; i++) { hs.push(await panelH(page)); await sleep(400); }
  rec('H3 panel height stopped = playing (aligned synthetic song)', Math.max(...hs) - hIdle < 0.5 && hIdle - Math.min(...hs) < 0.5, `idle ${hIdle} play ${Math.min(...hs)}-${Math.max(...hs)}`);
  await page.click('#btn-play');
  // discard: -/+ work again
  await page.click('#btn-sync');
  await page.waitForSelector('#as-discard');
  await page.click('#as-discard');
  await sleep(300);
  await page.click('#sync-close');
  await page.waitForSelector('#btn-play');
  const back = await page.evaluate(() => ({ down: document.querySelector('#btn-bpm-down').disabled, up: document.querySelector('#btn-bpm-up').disabled, note: !document.querySelector('#pp-bpm-lock').hidden }));
  rec('B3 after discarding the alignment BPM -/+ work again', !back.down && !back.up && !back.note, JSON.stringify(back));
  await browser.close();
  rec('Z no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
}

// ---- 3. correction by ear with missing taps
async function correct(label, profile) {
  dev = label;
  const { browser, page, errors } = await open(profile);
  await importSynthetic(page);
  await syncWith(page, MP3);
  const si = 1; // Verse, 12 chords
  const info = await page.evaluate((si) => {
    const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop())));
    const a = s.audio.alignment;
    const names = [];
    const idx = [];
    let k = 0;
    s.sections.forEach((sec, i) => sec.lines.forEach((l) => l.chords.forEach((c) => { if (i === si) { idx.push(k); names.push(c.name); } k++; })));
    return { times: idx.map((j) => a.eventStartSec[j]), names, n: idx.length, others: a.eventStartSec.slice() };
  }, si);
  await page.click(`.as-row[data-sec="${si}"] [data-act="correct"]`);
  await page.waitForSelector('#corr-tap');
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  const next0 = await page.innerText('#corr-next');
  rec('K1 before the first tap the screen shows the expected chord and the taps left', next0.includes(info.names[0]) && next0.includes(String(info.n)), next0);
  const disabledStyle = await page.evaluate(() => { const b = document.querySelector('#corr-save'); const cs = getComputedStyle(b); return { disabled: b.disabled, opacity: cs.opacity, borderStyle: cs.borderStyle }; });
  rec('K2 Salva looks off with no taps', disabledStyle.disabled && Number(disabledStyle.opacity) < 0.8 && disabledStyle.borderStyle === 'dashed', JSON.stringify(disabledStyle));
  const tapAt = async (t) => { await page.evaluate((t) => window.__gappSync.player.seek(t), t); await sleep(60); await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 }); };
  const truth = info.times.map((t, k) => t + 0.1 * Math.sin(k));
  for (let k = 0; k < 5; k++) await tapAt(truth[k]);
  const next5 = await page.innerText('#corr-next');
  rec('K3 after 5 taps: next chord and 7 left', next5.includes(info.names[5]) && next5.includes(String(info.n - 5)), next5);
  rec('K4 the undo button is called "Annulla ultimo tocco"', (await page.innerText('#corr-undo-tap')) === 'Annulla ultimo tocco');
  await page.click('#corr-undo-tap');
  const n4 = await page.innerText('#corr-count');
  rec('K5 undo removes the last tap', n4.startsWith(`4 / ${info.n}`), n4);
  await tapAt(truth[4]);
  const saveLbl = await page.innerText('#corr-save');
  rec('K6 Salva is on with missing taps and says how many chords stay untimed', !(await page.$eval('#corr-save', (b) => b.disabled)) && saveLbl.includes(String(info.n - 5)), saveLbl);
  await page.click('#corr-preview');
  await sleep(500);
  const st = await page.innerText('#corr-status');
  const missing = info.names.slice(5).join(', ');
  rec('K7 the preview lists the chords without time', st.includes('Senza tempo') && st.includes(missing), st);
  await shot(page, 'correct-partial');
  await page.click('#corr-save');
  await page.waitForSelector('#corr-tap', { state: 'detached' });
  const after = await page.evaluate((si) => {
    const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop())));
    return { verified: s.audio.alignment.sections[si].verified, starts: s.audio.alignment.eventStartSec.slice() };
  }, si);
  let k0 = 0;
  const secs = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); return s.sections.map((x) => x.lines.reduce((n, l) => n + l.chords.length, 0)); });
  for (let i = 0; i < si; i++) k0 += secs[i];
  const errTapped = Math.max(...truth.slice(0, 5).map((t, k) => Math.abs(after.starts[k0 + k] - t)));
  const keep = info.times.slice(5).every((t, k) => after.starts[k0 + 5 + k] === t);
  rec('K8 saved: tapped chords follow the taps, the others keep the automatic time, section not verified', errTapped <= 0.05 && keep && after.verified === false, `max err ${(errTapped * 1000).toFixed(0)} ms, keep ${keep}, verified ${after.verified}`);
  const msg = await page.innerText('#sync-msg');
  rec('K9 the notice names the untimed chords', msg.includes('senza tempo') && msg.includes(info.names[5]), msg);
  await browser.close();
  rec('Z no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
}

// ---- 4. odd audio: noise (not recognised), the song with a chorus played once more (gap row)
async function robust(label, profile) {
  dev = label;
  ff(['-f', 'lavfi', '-i', 'anoisesrc=d=120:c=white:a=0.3', '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'noise.mp3')]);
  const truth = JSON.parse(fs.readFileSync(path.join(T7, 'r7-truth.json'), 'utf8')).truth;
  // section 3 (Chorus) = events 19..26; repeat its audio once after itself
  const t0 = truth[19];
  const t1 = truth[27];
  ff(['-i', WAV, '-filter_complex', `[0:a]atrim=0:${t1},asetpts=PTS-STARTPTS[a];[0:a]atrim=${t0}:${t1},asetpts=PTS-STARTPTS[b];[0:a]atrim=${t1},asetpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=0:a=1`, '-codec:a', 'libmp3lame', '-b:a', '128k', path.join(OUT, 'repeat.mp3')]);
  // not recognised
  {
    const { browser, page, errors } = await open(profile);
    await importSynthetic(page);
    await syncWith(page, path.join(OUT, 'noise.mp3'));
    const r = await page.evaluate(() => ({ msg: document.querySelector('#sync-msg').textContent, error: document.querySelector('#sync-msg').classList.contains('error'), rows: document.querySelectorAll('.as-row').length, ready: /pronta/.test(document.querySelector('#sync-msg').textContent), stored: !!JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop())) || '{}').audio.alignment, transposeBox: !!document.querySelector('#as-transpose') }));
    rec('R1 noise: "Audio non riconosciuto", no "pronta", nothing stored, no transposition box', /Audio non riconosciuto/.test(r.msg) && r.error && !r.ready && !r.stored && !r.transposeBox && r.rows === 0, JSON.stringify(r));
    await shot(page, 'noise');
    await browser.close();
    rec('Z1 no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  }
  // repeated chorus
  {
    const { browser, page, errors } = await open(profile);
    await importSynthetic(page);
    await syncWith(page, path.join(OUT, 'repeat.mp3'));
    const r = await page.evaluate(() => ({ states: [...document.querySelectorAll('.as-row')].map((x) => x.dataset.state[0]).join(''), gaps: [...document.querySelectorAll('.as-gap')].map((g) => g.textContent), ready: /pronta/.test(document.querySelector('#sync-msg').textContent) }));
    rec('R2 chorus played once more: alignment made, a row says which part is not in the sheet', r.states.length === 8 && r.gaps.length >= 1 && /parte non presente nel foglio/.test(r.gaps[0]) && r.ready, JSON.stringify(r));
    const times = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment.eventStartSec);
    const L = t1 - t0;
    const ok = truth.filter((t, j) => (j < 19 || j > 26) && Math.abs(times[j] - (j > 26 ? t + L : t)) <= 0.25 && !(j >= 27 && j <= 32)).length;
    const tot = truth.filter((t, j) => (j < 19 || j > 26) && !(j >= 27 && j <= 32)).length;
    rec('R3 the events of the sheet are within 250 ms (outside the free section)', ok / tot >= 0.95, `${ok}/${tot}`);
    await shot(page, 'repeat-summary');
    await browser.close();
    rec('Z2 no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  }
}

(async () => {
  if (!fs.existsSync(SONG) || !fs.existsSync(MP3)) { console.log('run node test/e2e/round7-tester-make.mjs first'); process.exit(1); }
  const prof = PROFILES[onlyDev];
  if (only === 'panel' || only === 'all') await panel(onlyDev, prof);
  if (only === 'sync' || only === 'all') await sync(onlyDev, prof);
  if (only === 'correct' || only === 'all') await correct(onlyDev, prof);
  if (only === 'robust' || only === 'all') await robust(onlyDev, prof);
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
