// Round 8 tester C in the app: odd audio (noise, silence, other song, right song with noise, transposed) and BPM -/+ with / without alignment.
// Prepare: node scripts/build.mjs && node test/e2e/round7-tester-make.mjs && node test/e2e/round8-tester-assets.mjs
// Run: node test/e2e/round8-tester-c-app.cjs <audio|bpm> [SE|360|13]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const T7 = path.join(ROOT, 'test-artifacts', 'round-7', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-8');
const AS = path.join(OUT, 'assets');
const SONG = path.join(T7, 'r7-song.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'audio';
const devName = process.argv[3] || 'SE';
let fails = 0; let dev = devName;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const PROFILES = { 360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };
async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[devName]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  return { browser, page, errors };
}
const readSong = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))));
async function syncWith(page, file) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await page.click('#as-start');
  await page.waitForFunction(() => document.querySelector('#as-rows') || document.querySelector('#sync-msg.error') || (window.__gappAutosync && window.__gappAutosync.notRecognised), null, { timeout: 180000 });
  await sleep(500);
}
async function audio() {
  const cases = [['right', 'the right song, clean'], ['right-snr5', 'right song, white noise SNR 5 dB'], ['right-snr-5', 'right song, SNR -5 dB'], ['right-snr-10', 'right song, SNR -10 dB'], ['other', 'another song'], ['silence', 'silence'], ['transp+2', 'audio +2 semitones'], ['transp-5', 'audio -5 semitones']];
  for (const [f, label] of cases) {
    const file = path.join(AS, f + '.mp3');
    if (!fs.existsSync(file)) { console.log('missing asset', f); continue; }
    const { browser, page, errors } = await open();
    await syncWith(page, file);
    const r = await page.evaluate(() => ({ msg: (document.querySelector('#sync-msg') || {}).textContent || '', error: !!document.querySelector('#sync-msg.error'), rows: document.querySelectorAll('.as-row').length, states: [...document.querySelectorAll('.as-row')].map((x) => x.dataset.state[0]).join(''), accept: !!document.querySelector('#as-accept'), transposeBox: !!document.querySelector('#as-transpose'), transposeText: (document.querySelector('#as-transpose') || {}).textContent || '' }));
    const stored = !!(await readSong(page)).audio.alignment;
    info('C1', `${label}: msg "${r.msg.slice(0, 110)}" error=${r.error} rows=${r.rows} states=${r.states} accept=${r.accept} transposeBox=${r.transposeBox} ${r.transposeBox ? '"' + r.transposeText.slice(0, 90) + '"' : ''} alignmentSaved=${stored}`);
    if (['other', 'silence'].includes(f)) rec(`C1 ${label}: not recognised, nothing saved, no transposition box, no "pronta"`, /non riconosciuto/i.test(r.msg) && !stored && !r.transposeBox && !/pronta/.test(r.msg) && !r.accept);
    if (f === 'right') rec('C1 right song: ready, saved, no transposition box', /pronta/.test(r.msg) && stored && !r.transposeBox);
    if (f.startsWith('right-snr')) rec(`C1 ${label}: should still be recognised if alignable`, /pronta/.test(r.msg) && stored, `states ${r.states}`);
    if (f.startsWith('transp')) {
      const want = f === 'transp+2' ? 2 : -5;
      rec(`C2 ${label}: proposal shown`, r.transposeBox);
      if (r.transposeBox) {
        await page.click('#as-apply-transpose'); await sleep(300);
        const s = await readSong(page);
        // is the sign right? the sheet must be transposed by `want` to match the audio
        rec(`C2 ${label}: applying sets song.transpose = ${want} and keeps the alignment`, s.transpose === want && !!s.audio.alignment, `transpose ${s.transpose}`);
        const gone = await page.evaluate(() => !document.querySelector('#as-transpose'));
        info('C2', `proposal box disappears after applying: ${gone}`);
        await page.click('#sync-close'); await page.waitForSelector('#btn-play');
        const names = await page.evaluate(() => [...document.querySelectorAll('[data-ref]')].slice(0, 4).map((e) => e.textContent.trim().split(/\s+/)[0]));
        info('C2', `first displayed chords after applying: ${names.join(' ')} (sheet G D Em C transposed by ${want})`);
        // reopen: no proposal now (already applied)
        await page.click('#btn-sync'); await page.waitForSelector('#as-rows').catch(() => {});
        info('C2', `proposal shown again after applying and reopening: ${!!(await page.$('#as-transpose'))}`);
      }
    }
    await page.screenshot({ path: path.join(OUT, `c-${devName}-${f}.png`) });
    rec(`Cz ${label}: no page errors`, errors.length === 0, errors.slice(0, 1).join('|'));
    await browser.close();
  }
}
async function bpm() {
  const { browser, page, errors } = await open();
  const bpms = async () => (await readSong(page)).sections.map((s) => s.bpm);
  const st = () => page.evaluate(() => ({ down: document.querySelector('#btn-bpm-down').disabled, up: document.querySelector('#btn-bpm-up').disabled, noteVisible: !document.querySelector('#pp-bpm-lock').hidden, note: document.querySelector('#pp-bpm-lock').textContent, label: document.querySelector('#pp-bpm').textContent }));
  // 0. no audio: works
  const b0 = await bpms(); await page.click('#btn-bpm-up'); const b1 = await bpms();
  rec('B0 no audio, no alignment: + changes the BPM', JSON.stringify(b0) !== JSON.stringify(b1), `${b0[0]} -> ${b1[0]}`);
  // alignment
  await syncWith(page, path.join(AS, 'right.mp3'));
  await page.click('#as-accept');
  await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  const s1 = await st();
  rec('B1 aligned: -/+ disabled with the note', s1.down && s1.up && s1.noteVisible && /Correggi a orecchio/.test(s1.note), JSON.stringify(s1).slice(0, 200));
  // number field / Applica
  const before = await bpms();
  await page.click('#pp-bpm'); await sleep(200);
  const fieldVis = await page.evaluate(() => { const e = document.querySelector('#pp-bpmedit'); return e && !e.hidden; });
  if (fieldVis) { await page.fill('#pp-bpm-field', '150'); await page.click('#pp-bpm-apply'); await sleep(300); }
  const after = await bpms();
  const noteAfter = await page.evaluate(() => ({ note: document.querySelector('#pp-bpm-lock').textContent.slice(0, 40), vis: !document.querySelector('#pp-bpm-lock').hidden, editOpen: !document.querySelector('#pp-bpmedit').hidden }));
  rec('B2 the BPM field + Applica change nothing with the alignment', JSON.stringify(before) === JSON.stringify(after), `field shown ${fieldVis}; ${JSON.stringify(noteAfter)}`);
  await page.screenshot({ path: path.join(OUT, `c-${devName}-bpm-field.png`) });
  if (await page.evaluate(() => !document.querySelector('#pp-bpmedit').hidden)) await page.keyboard.press('Escape');
  // scope button (all song / section)
  const scopeLocked = await page.evaluate(() => { const b = document.querySelector('#btn-bpm-scope'); return b ? { disabled: b.disabled } : null; });
  info('B2', `scope button when locked: ${JSON.stringify(scopeLocked)}`);
  // tap tempo (should still work, or not?)
  const tap = await page.evaluate(() => { const b = document.querySelector('#btn-bpm-tap, #btn-tap'); return b ? { id: b.id, disabled: b.disabled } : null; });
  info('B2', `tap tempo button: ${JSON.stringify(tap)}`);
  if (tap) {
    const bb = await bpms();
    for (let i = 0; i < 5; i++) { await page.evaluate((id) => document.getElementById(id).click(), tap.id); await sleep(250); }
    const ba = await bpms();
    const lbl = await page.evaluate(() => ({ label: document.querySelector('#pp-bpm').textContent, note: [...document.querySelectorAll('.pp-notice')].filter((n) => !n.hidden).map((n) => n.textContent.slice(0, 80)) }));
    info('B2', `tap tempo with the alignment: BPMs ${JSON.stringify(bb.slice(0, 3))} -> ${JSON.stringify(ba.slice(0, 3))}; ${JSON.stringify(lbl)}`);
    rec('B2b tap tempo with the alignment does not silently change the saved BPMs (or says it is ignored)', JSON.stringify(bb) === JSON.stringify(ba) || lbl.note.length > 0, `changed=${JSON.stringify(bb) !== JSON.stringify(ba)}`);
  }
  // 3. alignment removed -> enabled again
  await page.click('#btn-sync'); await page.waitForSelector('#as-discard'); await page.click('#as-discard'); await sleep(300);
  await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  const s2 = await st();
  rec('B3 after "Scarta" -/+ enabled and no note', !s2.down && !s2.up && !s2.noteVisible, JSON.stringify(s2).slice(0, 160));
  const c0 = await bpms(); await page.click('#btn-bpm-up'); const c1 = await bpms();
  rec('B3b + works again', JSON.stringify(c0) !== JSON.stringify(c1));
  // 4. manual anchors, no alignment: set an anchor of section 2 via the manual panel, then BPM works
  await page.click('#btn-sync'); await page.waitForSelector('details, #sync-manual, .sync-manual', { timeout: 5000 }).catch(() => {});
  const det = await page.$('details'); if (det) await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await sleep(300);
  const hereBtns = await page.$$('[data-act="here"]');
  info('B4', `manual panel: "Fissa qui" buttons ${hereBtns.length}`);
  if (hereBtns.length) {
    // play, then fix the anchor of section 2 at ~ 20 s
    await page.evaluate(() => window.__gappSync.player.seek(20)); await sleep(200);
    await hereBtns[0].click({ force: true }); await sleep(300);
  }
  await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  const anch = (await readSong(page)).audio.anchors;
  const s3 = await st();
  rec('B4 manual anchors without alignment: -/+ enabled, no note (as before)', !s3.down && !s3.up && !s3.noteVisible, `anchors ${JSON.stringify(anch)}; ${JSON.stringify(s3).slice(0, 120)}`);
  const d0 = await bpms(); await page.click('#btn-bpm-up'); const d1 = await bpms();
  rec('B4b + still changes the BPM', JSON.stringify(d0) !== JSON.stringify(d1), `${d0[0]} -> ${d1[0]}`);
  // 5. library export -> import into a clean context: alignment without audio file: what do -/+ do?
  rec('Bz no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}
(async () => { await ({ audio, bpm }[mode])(); console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0); })().catch((e) => { console.log('FAILED', e); process.exit(2); });
