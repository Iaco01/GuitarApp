// Round 10 in the app (Playwright): texts of the states (whole words, reasons, gaps), skipped section (no loop, notice),
// gap in play (the sheet goes to the section that resumes, no "≈" tempo), correction with 35 chords (fixed bar, start from
// any chord, stop when you want).
// Prepare: node scripts/build.mjs && node test/e2e/round7-tester-make.mjs && node test/e2e/round8-tester-assets.mjs && node test/e2e/round8-tester-gap-assets.mjs
// Run: node test/e2e/round10.cjs <texts|skip|gap|corr|all> [SE|360|13|320]
// The real song is only measured: no text of it is printed.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const SONG = path.join(ROOT, 'test-artifacts', 'round-7', 'tester', 'r7-song.json');
const AS = path.join(ROOT, 'test-artifacts', 'round-8', 'assets');
const OUT = path.join(ROOT, 'test-artifacts', 'round-10');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
fs.mkdirSync(OUT, { recursive: true });
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
async function loadReal(page) {
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 20000 });
}
async function syncWith(page, file) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#as-start', { timeout: 30000 });
  await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
}
const alignment = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
const closeSync = async (page) => { await page.click('#as-accept').catch(() => {}); await page.click('#sync-close'); await page.waitForSelector('#btn-play'); };

// ---------------------------------------------------------------- texts: whole words, one reason line, gap rows
async function texts() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  for (const w of ['320', '360', 'SE', '13']) {
    dev = w + '-texts';
    const { browser, page, errors } = await open(PROFILES[w]);
    await loadReal(page);
    await syncWith(page, MP3);
    const m = await page.$$eval('.as-row', (rows) => rows.map((r) => {
      const subs = Array.from(r.querySelectorAll('.as-sub > span'));
      const why = r.querySelector('.as-why');
      const name = r.querySelector('.as-name');
      const box = r.getBoundingClientRect();
      return {
        state: r.dataset.state,
        stateText: (r.querySelector('.as-state') || {}).textContent || '',
        tempoText: (r.querySelector('.as-tempo') || {}).textContent || '',
        cutSpan: subs.some((s) => s.scrollWidth > s.clientWidth + 1 || s.getBoundingClientRect().right > box.right + 1),
        cutName: name ? name.scrollWidth > name.clientWidth + 1 : false,
        why: why ? why.textContent : null,
        whyCut: why ? why.scrollWidth > why.clientWidth + 1 || why.getBoundingClientRect().right > box.right + 1 : false,
        rowH: box.height,
        lines: subs.length ? new Set(subs.map((s) => Math.round(s.getBoundingClientRect().top))).size : 0,
      };
    }));
    const live = m.filter((r) => r.state !== 'skipped');
    rec('T1 the states use the whole words, the same ones in every row', live.every((r) => ['sicura', 'da controllare', 'incerta', 'verificata ✓'].includes(r.stateText)), JSON.stringify([...new Set(live.map((r) => r.stateText))]));
    rec('T2 the tempo is "NNN BPM" or "tempo libero" in every row', live.every((r) => /^(\d+(,\d)? BPM|tempo libero)$/.test(r.tempoText)), JSON.stringify([...new Set(live.map((r) => r.tempoText.replace(/\d+(,\d)?/, 'N')))]));
    rec('T3 no word is cut or outside the row (state, tempo, reason, name)', live.every((r) => !r.cutSpan && !r.whyCut && !r.cutName), `${live.filter((r) => r.cutSpan || r.whyCut || r.cutName).length} of ${live.length}`);
    rec('T4 every yellow or red row says why, in one line', live.filter((r) => r.state === 'yellow' || r.state === 'red').every((r) => r.why && /^(tempo libero: i cambi sono stimati|tempi poco netti|dura diversamente dalle sezioni uguali|i cambi non cadono sui battiti)$/.test(r.why)), JSON.stringify(live.filter((r) => r.why).map((r) => r.why)));
    rec('T5 green and verified rows have no reason', live.filter((r) => r.state === 'green' || r.state === 'verified').every((r) => !r.why));
    rec('T6 a free-tempo row is yellow or red and says "tempo libero: i cambi sono stimati"', live.filter((r) => r.tempoText === 'tempo libero').every((r) => (r.state === 'yellow' || r.state === 'red') && r.why === 'tempo libero: i cambi sono stimati'));
    const counts = await page.$eval('#as-counts', (e) => e.textContent);
    const legend = await page.$eval('#as-box', (e) => e.textContent);
    rec('T7 counts and legend use the same words', /sicure/.test(counts) && /da controllare/.test(counts) && /incerte/.test(counts) && /Verde: sicura\. Giallo: da controllare\. Rosso: incerta\./.test(legend) && /Tempo libero:/.test(legend), counts);
    rec('T8 no «controlla»/«libero» alone in the rows', live.every((r) => !/^controlla$/.test(r.stateText) && r.tempoText !== 'libero'));
    const gaps = await page.$$eval('.as-gap', (g) => g.map((x) => ({ text: x.querySelector('.as-gap-text').textContent, note: x.querySelector('.as-gap-note').textContent })));
    info('T', `${w}px: ${m.length} rows, heights ${Math.min(...m.map((r) => r.rowH)).toFixed(0)}-${Math.max(...m.map((r) => r.rowH)).toFixed(0)} px, rows on two lines ${live.filter((r) => r.lines > 0 && r.rowH > 60).length}, gaps ${gaps.length}`);
    rec('T9 a gap under 6 s says "passaggio non scritto nel foglio (N s)", with what to do', gaps.length > 0 && gaps.every((g) => /^\d+:\d\d–\d+:\d\d: (passaggio non scritto nel foglio \(\d s\)|parte non presente nel foglio)$/.test(g.text) && g.note === 'nessuna azione richiesta'), JSON.stringify(gaps.map((g) => g.text.replace(/\d+:\d\d/g, 'm:ss'))));
    const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    rec('T10 no horizontal overflow of the page', doc <= 0, `${doc}`);
    await page.evaluate(() => document.querySelector('#as-rows').scrollIntoView());
    await page.screenshot({ path: path.join(OUT, `texts-${w}.png`) });
    rec('Tz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
    await browser.close();
  }
}

// ---------------------------------------------------------------- skip: a section that the audio does not have
async function skip() {
  dev = devName + '-skip';
  const src = path.join(AS, 'right.mp3');
  const out = path.join(OUT, 'right-cut70.mp3');
  const d = Number(spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf-8' }).stdout);
  spawnSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-t', String(d * 0.7), '-codec:a', 'libmp3lame', '-b:a', '128k', out]);
  const { browser, page, errors } = await open();
  await loadSynth(page);
  await syncWith(page, out);
  const states = await page.$$eval('.as-row', (r) => r.map((x) => x.dataset.state));
  info('skip', states.map((s) => s[0]).join(''));
  const sk = states.map((s, i) => (s === 'skipped' ? i : -1)).filter((i) => i >= 0);
  rec('S0 the cut audio has a skipped section', sk.length >= 1);
  await closeSync(page);
  // long press on the heading of a skipped section: no loop, the notice explains
  await page.evaluate((i) => { const d = document.querySelector(`.sec-head[data-sec="${i}"]`).closest('details'); if (d) d.open = true; }, sk[0]);
  const head = page.locator(`.sec-head[data-sec="${sk[0]}"]`).first();
  await head.scrollIntoViewIfNeeded();
  await sleep(700);
  const box = await head.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(1100);
  await page.mouse.up();
  await sleep(200);
  const looping = await page.$$eval('.looping', (e) => e.length);
  const note = (await page.$$eval('.msg', (e) => e.map((x) => x.textContent))).join(' | ');
  rec('S1 no loop on a skipped section', looping === 0 && (await page.$$eval('.loop-x', (e) => e.length)) === 0);
  info('S2', JSON.stringify(note.slice(0,200)));
  rec('S2 the notice says "Questa sezione non è nell’audio"', /Questa sezione non è nell’audio/.test(note), note);
  const loopedAudio = await page.evaluate(() => window.__gapp.player.state);
  rec('S3 nothing starts playing', loopedAudio === 'stopped', loopedAudio);
  // a section that is in the audio still loops
  const ok = states.map((s, i) => (s !== 'skipped' ? i : -1)).filter((i) => i >= 0)[1];
  await page.evaluate((i) => { const d = document.querySelector(`.sec-head[data-sec="${i}"]`).closest('details'); if (d) d.open = true; }, ok);
  const head2 = page.locator(`.sec-head[data-sec="${ok}"]`).first();
  await head2.scrollIntoViewIfNeeded();
  await sleep(700);
  const b2 = await head2.boundingBox();
  await page.mouse.move(b2.x + 20, b2.y + b2.height / 2);
  await page.mouse.down();
  await sleep(1100);
  await page.mouse.up();
  await sleep(300);
  rec('S4 a section that is in the audio still loops', (await page.$$eval('.looping', (e) => e.length)) === 1);
  await page.screenshot({ path: path.join(OUT, `skip-${devName}.png`) });
  rec('Sz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
  await browser.close();
}

// ---------------------------------------------------------------- gap: the sheet follows, no "≈" tempo (real song, the 4 s gap)
async function gap() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  dev = devName + '-gap';
  const { browser, page, errors } = await open();
  await loadReal(page);
  await syncWith(page, MP3);
  const al = await alignment(page);
  const g = al.gaps[0];
  rec('G0 the real song has its 4 s gap', !!g && g.endSec - g.startSec >= 3 && g.endSec - g.startSec < 6, g ? (g.endSec - g.startSec).toFixed(1) + ' s' : 'none');
  await closeSync(page);
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, g.startSec - 3);
  await sleep(1200);
  const before = await page.evaluate(() => ({ bpm: document.getElementById('pp-bpm').textContent, y: window.scrollY }));
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const s = await page.evaluate(() => {
      const sec = document.querySelector('.sec.playing');
      const gapEl = document.getElementById('pp-gap');
      return { t: window.__gapp.audioEl.currentTime, bpm: document.getElementById('pp-bpm').textContent, gap: gapEl && !gapEl.hidden, secTop: sec ? sec.getBoundingClientRect().top : null, sec: sec ? Number(sec.dataset.sec) : null, vh: window.innerHeight, panelH: document.querySelector('.play-panel, #play-panel') ? document.querySelector('.play-panel, #play-panel').getBoundingClientRect().height : 0 };
    });
    samples.push(s);
    if (s.t > g.endSec + 1.5) break;
    await sleep(250);
  }
  const inGap = samples.filter((s) => s.t > g.startSec + 0.3 && s.t < g.endSec - 0.3);
  info('G', `${inGap.length} samples in the gap; tempo before "${before.bpm}"; in the gap "${[...new Set(inGap.map((s) => s.bpm))].join('|')}"`);
  rec('G1 in the gap the panel does not show a tempo (no "≈")', inGap.length > 2 && inGap.every((s) => s.gap && !/[≈=]/.test(s.bpm)), JSON.stringify([...new Set(inGap.map((s) => s.bpm))]));
  const late = inGap.filter((s) => s.t > g.startSec + 1.2);
  rec('G2 in the gap the section that resumes is the playing one, near the top of the sheet', late.length > 0 && late.every((s) => s.secTop !== null && s.secTop >= -2 && s.secTop < 0.55 * s.vh), JSON.stringify(late.map((s) => [s.sec, Math.round(s.secTop)])));
  const after = samples.filter((s) => s.t > g.endSec + 0.4);
  rec('G3 after the gap a tempo is shown again', after.length > 0 && after.every((s) => /[≈=]\d/.test(s.bpm)), JSON.stringify([...new Set(after.map((s) => s.bpm))]));
  await page.screenshot({ path: path.join(OUT, `gap-${devName}.png`) });
  rec('Gz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
  await browser.close();
}

// ---------------------------------------------------------------- corr: 35 chords, fixed bar, start from any chord, stop when you want
async function corr() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  for (const d of ['SE', '13', '320']) {
    dev = d + '-corr';
    const { browser, page, errors } = await open(PROFILES[d]);
    await loadReal(page);
    await syncWith(page, MP3);
    const before = await alignment(page);
    await page.click('.as-row[data-sec="0"] [data-act="correct"]');
    await page.waitForSelector('#corr-tap');
    await sleep(500);
    const inView = () => page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const a = r('corr-preview'); const b = r('corr-save'); return { a: { top: a.top, bottom: a.bottom, h: a.height }, b: { top: b.top, bottom: b.bottom, h: b.height }, vh: window.innerHeight, n: document.querySelectorAll('.corr-chip').length, stop: document.getElementById('corr-stop').textContent }; });
    let v = await inView();
    rec('K1 «Anteprima» and «Salva» are in view from the start (fixed bar), 35 chords', v.n === 35 && v.a.bottom <= v.vh + 0.5 && v.b.bottom <= v.vh + 0.5 && v.a.top >= 0 && v.a.h >= 44 && v.b.h >= 44, `${v.n} chords; Anteprima ${v.a.top.toFixed(0)}-${v.a.bottom.toFixed(0)}, Salva ${v.b.top.toFixed(0)}-${v.b.bottom.toFixed(0)} of ${v.vh}`);
    rec('K2 the bar says that you can stop when you want', v.stop === 'Puoi fermarti quando vuoi: i tocchi fatti vengono salvati.', v.stop);
    // start from chord 10 (the 11th): tap the chord
    await page.click('.corr-chip[data-k="10"]');
    await sleep(400);
    const st = await page.innerText('#corr-status');
    const nx = await page.innerText('#corr-next');
    const cnt = await page.innerText('#corr-count');
    rec('K3 tapping a chord starts from it', /Parti da/.test(st) && /Prossimo: .+ · mancano 25 tocchi/.test(nx) && cnt === '0 / 25 cambi', `${st.slice(0, 22)} | ${nx.slice(0, 24)} | ${cnt}`);
    const t10 = before.eventStartSec[(await page.evaluate(() => 0)) + 10];
    // 6 taps at the true times (audio clock), then stop
    const tl = before.eventStartSec;
    for (let k = 10; k < 16; k++) {
      await page.evaluate((t) => window.__gappSync.player.seek(t), tl[k] + 0.05);
      await sleep(80);
      await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 });
      await sleep(40);
    }
    v = await inView();
    rec('K4 after the taps the bar is still in view', v.a.bottom <= v.vh + 0.5 && v.b.bottom <= v.vh + 0.5);
    const saveTxt = await page.innerText('#corr-save');
    rec('K5 «Salva» says how many chords stay without a tap', /^Salva \(19 senza tempo\)$/.test(saveTxt), saveTxt);
    await page.click('#corr-save');
    await page.waitForSelector('#corr-tap', { state: 'detached' });
    const after = await alignment(page);
    const moved = after.eventStartSec.map((t, j) => (Math.abs(t - before.eventStartSec[j]) > 0.001 ? j : -1)).filter((j) => j >= 0);
    rec('K6 only the six touched chords moved (10..15), the others keep their time', moved.length > 0 && moved.every((j) => j >= 10 && j < 16), JSON.stringify(moved));
    rec('K7 the six touched chords are where they were touched (±0.3 s)', [10, 11, 12, 13, 14, 15].every((j) => Math.abs(after.eventStartSec[j] - before.eventStartSec[j]) < 0.3));
    rec('K8 the section is not "verificata" (it is partial)', after.sections[0].verified === false);
    const msg = await page.$eval('#sync-msg', (e) => e.textContent);
    rec('K9 the notice says how many chords have no tap, without listing all', /29 accordi/.test(msg) && msg.length < 140, msg);
    await page.screenshot({ path: path.join(OUT, `corr-${d}-after.png`) });
    // a full correction still works from the first chord (the old way), with the bar in view
    await page.click('.as-row[data-sec="1"] [data-act="correct"]');
    await page.waitForSelector('#corr-tap');
    await sleep(400);
    v = await inView();
    rec('K10 a short section: the bar is in view too', v.a.bottom <= v.vh + 0.5 && v.b.bottom <= v.vh + 0.5);
    await page.click('#corr-close');
    rec('Kz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
    await browser.close();
  }
}


// ---------------------------------------------------------------- clicks: one click per quarter over the audio (real song)
async function clicks() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  dev = devName + '-clicks';
  const { browser, page, errors } = await open();
  await page.addInitScript(() => {
    window.__clicks = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const st = o.start.bind(o);
      o.start = (when) => { window.__clicks.push({ ctxAt: when, el: window.__gapp && window.__gapp.audioEl ? window.__gapp.audioEl.currentTime : null, now: this.currentTime }); return st(when); };
      return o;
    };
  });
  await page.reload();
  await loadReal(page);
  await syncWith(page, MP3);
  const al = await alignment(page);
  await closeSync(page);
  const tl = await page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.beats, e.sectionIndex, !!e.skipped]), sec: window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm]) }));
  // a stable section: the first one with a measured bpm and 30 s
  const si = al.sections.findIndex((s, i) => s.bpm !== null && tl.sec[i][1] - tl.sec[i][0] >= 30);
  const bpm = al.sections[si].bpm;
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.click('#btn-click-icon');
  const t0 = tl.sec[si][0] + 1;
  await page.evaluate((t) => { window.__clicks.length = 0; window.__gapp.audioEl.currentTime = t; }, t0);
  await sleep(31000);
  const cl = await page.evaluate(() => window.__clicks.map((c) => c.ctxAt));
  const sp = cl.slice(1).map((t, i) => t - cl[i]).filter((d) => d < 3);
  const med = sp.sort((a, b) => a - b)[sp.length >> 1];
  info('C', `section ${si + 1}, measured ${bpm} BPM, ${cl.length} clicks, median spacing ${(med * 1000).toFixed(0)} ms (expected ${(60000 / bpm).toFixed(0)})`);
  rec('B1 click spacing is one quarter at the section tempo (±5%)', Math.abs(med - 60 / bpm) / (60 / bpm) < 0.05);
  // per chord: clicks never more than its quarters (+1 for rounding)
  const first = cl[0];
  const elAtFirst = await page.evaluate(() => window.__clicks[0].el);
  const toMedia = (c) => (elAtFirst === null ? c : elAtFirst + (c - first));
  const evs = tl.ev.filter((e) => e[3] === si);
  let worst = 0;
  const per = evs.map((e) => cl.filter((c) => toMedia(c) >= e[0] - 0.15 && toMedia(c) < e[0] + e[1] - 0.15).length);
  evs.forEach((e, k) => { if (toMedia(cl[cl.length - 1]) > e[0] + e[1] && toMedia(first) < e[0]) worst = Math.max(worst, per[k] - Math.max(1, Math.round((e[1] * bpm) / 60) + 1)); });
  rec('B2 no chord gets more clicks than its quarters', worst <= 0, `excess ${worst}; chords checked ${per.length}`);
  rec('Bz no page errors', errors.length === 0, errors.join('|').slice(0, 100));
  await browser.close();
}

(async () => {
  const all = { texts, skip, gap, corr, clicks };
  const list = mode === 'all' ? Object.keys(all) : [mode];
  for (const m of list) await all[m]();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
