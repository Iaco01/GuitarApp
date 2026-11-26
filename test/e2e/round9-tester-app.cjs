// Round 9 tester, in the app (Playwright). Synthetic audio only for the asserts; the real song only for counts and timings.
// Prepare: node scripts/build.mjs && node test/e2e/round7-tester-make.mjs && node test/e2e/round9-tester-assets.mjs
// Run: node test/e2e/round9-tester-app.cjs <gap|gap2|skip|persist|sync|forced|lock|texts|corr|perf|user> [SE|360|13|320]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const SONG = path.join(ROOT, 'test-artifacts', 'round-7', 'tester', 'r7-song.json');
const AS = path.join(ROOT, 'test-artifacts', 'round-9', 'assets');
const OUT = path.join(ROOT, 'test-artifacts', 'round-9');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
fs.mkdirSync(OUT, { recursive: true });
const T = fs.existsSync(path.join(AS, 'truth.json')) ? JSON.parse(fs.readFileSync(path.join(AS, 'truth.json'), 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'gap';
const devName = process.argv[3] || 'SE';
const PROFILES = {
  320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
let fails = 0; let dev = devName;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
async function open(profile = PROFILES[devName]) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  return { browser, ctx, page, errors };
}
async function loadSynth(page) {
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
}
async function syncWith(page, file) {
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#as-start', { timeout: 30000 }); await page.click('#as-start');
  await page.waitForSelector('#as-rows, #as-force', { timeout: 300000, state: 'attached' });
}
const alignment = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
const closeSync = async (page) => { await page.click('#as-accept'); await page.click('#sync-close'); await page.waitForSelector('#btn-play'); };
const startPlay = async (page) => { await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 }); };
const seek = (page, t) => page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, t);
const snap = (page) => page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, st: window.__gapp.player.state, ev: window.__gapp.player.eventIndex, cur: document.querySelectorAll('.cur').length, name: (document.querySelector('#pp-current') || {}).textContent || '', gap: (document.querySelector('#pp-gap') || {}).textContent || '', gapHidden: document.querySelector('#pp-gap') ? document.querySelector('#pp-gap').hidden : true }));

async function gap() {
  for (const L of [6, 20]) {
    dev = `${devName}-gap${L}`;
    const { browser, page, errors } = await open();
    await loadSynth(page);
    await syncWith(page, path.join(AS, `gap${L}.mp3`));
    const al = await alignment(page);
    const tg = T['gap' + L];
    const g = al.gaps.find((x) => x.endSec - x.startSec >= 3);
    rec(`G1 gap ${L} s found (start/end within 1 s of truth)`, !!g && Math.abs(g.startSec - tg.start) < 1 && Math.abs(g.endSec - tg.end) < 1, `stored ${JSON.stringify(al.gaps.map((x) => [+x.startSec.toFixed(1), +x.endSec.toFixed(1)]))} true ${tg.start.toFixed(1)}-${tg.end.toFixed(1)}`);
    const rows = await page.$$eval('#as-rows li', (r) => r.map((x) => x.className.includes('as-gap') ? 'GAP' : x.dataset.state[0]).join(''));
    info('G', `rows ${rows}`);
    if (!g) { await browser.close(); continue; }
    await closeSync(page);
    await startPlay(page);
    await seek(page, g.startSec - 2.5); await sleep(400);
    const S = []; const t0 = Date.now();
    while (Date.now() - t0 < (g.endSec - g.startSec + 9) * 1000) { const s = await snap(page); S.push(s); if (s.t > g.endSec + 6) break; await sleep(150); }
    const inG = S.filter((s) => s.t > g.startSec + 0.6 && s.t < g.endSec - 0.6);
    rec('G2 inside the gap no chord highlighted, "Fuori dal foglio"', inG.length > 3 && inG.every((s) => s.cur === 0 && s.name === 'Fuori dal foglio'), `${inG.length} samples; cur ${JSON.stringify([...new Set(inG.map((s) => s.cur))])}`);
    const err = inG.map((s) => { const n = Number((/tra (\d+) s/.exec(s.gap) || [])[1]); return (g.endSec - s.t) - n; });
    rec('G3 countdown = remaining time rounded UP to the second (shown - remaining in [0, 1) within sampling jitter 0.15 s)', err.length > 0 && err.every((e) => e > -1.15 && e < 0.15), `signed error (remaining - shown) min ${Math.min(...err).toFixed(2)} max ${Math.max(...err).toFixed(2)}`);
    const before = S.filter((s) => s.t < g.startSec - 0.4 && s.t > g.startSec - 2.2), after = S.filter((s) => s.t > g.endSec + 0.5);
    rec('G4 before and after the gap the highlight is on', before.length > 2 && before.every((s) => s.cur === 1) && after.length > 2 && after.every((s) => s.cur === 1), `before ${before.length} after ${after.length}`);
    // timing after the gap: first events after the gap change at the right time (true onset = base truth + L)
    const evs = al.eventStartSec; const j0 = g.before;
    const bt = T.base;
    const tr = []; // observe when eventIndex becomes j for j0..j0+4
    await seek(page, g.endSec - 0.3); await sleep(120);
    const obs = {}; const t1 = Date.now();
    while (Date.now() - t1 < 14000) { const s = await snap(page); if (s.ev >= j0 && !(s.ev in obs)) obs[s.ev] = s.t; if (s.ev >= j0 + 4) break; await sleep(40); }
    const errs = Object.entries(obs).map(([j, t]) => t - (bt[j] + L));
    rec('G5 after the gap the highlight changes on time (|error| < 0.35 s for 5 events)', errs.length >= 4 && errs.every((e) => Math.abs(e) < 0.35), `errors ${errs.map((e) => e.toFixed(2)).join(' ')} (obs t: ${JSON.stringify(obs)}; truth+L: ${[0,1,2,3,4].map((k) => (bt[j0 + k] + L).toFixed(1)).join(' ')})`);
    // pause in the gap, resume, seek in the gap
    await seek(page, g.startSec + (g.endSec - g.startSec) / 2); await sleep(500);
    await page.click('#btn-play'); await sleep(500);
    const p1 = await snap(page);
    rec('G6 paused inside the gap: still "Fuori dal foglio", state paused', p1.st !== 'playing' && p1.name === 'Fuori dal foglio' && p1.cur === 0, JSON.stringify({ st: p1.st, name: p1.name, cur: p1.cur, gap: p1.gap }));
    await page.screenshot({ path: path.join(OUT, `gap${L}-${devName}-paused-in-gap.png`) });
    await seek(page, g.startSec + 1); await sleep(400);
    const p2 = await snap(page);
    rec('G7 seek inside the gap while paused updates the countdown', /Riprende tra \d+ s/.test(p2.gap), p2.gap);
    await page.click('#btn-play'); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 8000 });
    await sleep(700);
    const p3 = await snap(page);
    rec('G8 resume in the gap: playing, still out of sheet', p3.st === 'playing' && p3.name === 'Fuori dal foglio' && p3.cur === 0, JSON.stringify({ st: p3.st, name: p3.name, t: +p3.t.toFixed(1) }));
    await seek(page, g.endSec - 0.5); await sleep(1800);
    const p4 = await snap(page);
    rec('G9 seek to the last 0.5 s of the gap -> after 1.8 s a chord is highlighted', p4.cur === 1, JSON.stringify({ cur: p4.cur, name: p4.name }));
    await seek(page, 5); await sleep(600);
    const p5 = await snap(page);
    rec('G10 seek back to the beginning: normal highlight', p5.cur === 1 && p5.name !== 'Fuori dal foglio', p5.name);
    rec('Gz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
    await browser.close();
  }
}

async function gap2() {
  dev = devName + '-gap2';
  const { browser, page, errors } = await open();
  await loadSynth(page); await syncWith(page, path.join(AS, 'gap2.mp3'));
  const al = await alignment(page); const tg = T.gap2;
  rec('H1 a 2 s extra stretch is not a gap (none >= 3 s stored)', !al.gaps.some((x) => x.endSec - x.startSec >= 3), JSON.stringify(al.gaps.map((x) => +(x.endSec - x.startSec).toFixed(1))));
  const rows = await page.$$eval('#as-rows .as-gap', (r) => r.length);
  rec('H2 no gap row in the summary', rows === 0);
  await closeSync(page); await startPlay(page);
  await seek(page, tg.start - 1.5); await sleep(300);
  const S = []; const t0 = Date.now();
  while (Date.now() - t0 < 7000) { const s = await snap(page); S.push(s); if (s.t > tg.end + 2) break; await sleep(100); }
  const inG = S.filter((s) => s.t > tg.start && s.t < tg.end + 0.3);
  rec('H3 during the 2 s stretch a chord stays highlighted, never "Fuori dal foglio"', inG.length > 5 && inG.every((s) => s.cur === 1 && s.name !== 'Fuori dal foglio'), `${inG.length} samples, names ${JSON.stringify([...new Set(inG.map((s) => s.name))])}`);
  rec('Hz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

async function skip() {
  for (const f of ['nobridge', 'cut70']) {
    dev = `${devName}-${f}`;
    const { browser, page, errors } = await open();
    await loadSynth(page); await syncWith(page, path.join(AS, f + '.mp3'));
    const al = await alignment(page);
    const rows = await page.$$eval('#as-rows .as-row', (r) => r.map((x) => ({ s: x.dataset.state, sec: +x.dataset.sec, btns: x.querySelectorAll('button').length })));
    info('S', `${f}: states ${rows.map((r) => r.s[0]).join('')}`);
    const sk = rows.filter((r) => r.s === 'skipped');
    rec(`S1 ${f}: skipped sections found`, sk.length >= 1, JSON.stringify(sk.map((r) => r.sec + 1)));
    if (f === 'nobridge') rec('S1b nobridge: exactly the Bridge (6) is skipped', sk.length === 1 && sk[0].sec === 5);
    rec('S2 skipped row has no buttons (nothing to tap or correct)', sk.every((r) => r.btns === 0));
    const skEv = new Set(al.skipped || []);
    await closeSync(page); await startPlay(page);
    const first = Math.min(...skEv);
    // play across the skipped events (for nobridge: through the Bridge) from 4 s before the first skipped one
    const startT = al.eventStartSec[first - 1] - 1;
    await seek(page, Math.max(0, startT)); await sleep(300);
    const seen = new Set(); const t0 = Date.now(); let tEnd = null;
    const lastSk = Math.max(...skEv);
    while (Date.now() - t0 < 14000) { const s = await snap(page); seen.add(s.ev); if (s.ev > lastSk) tEnd = tEnd || s.t; if (s.ev > lastSk + 3) break; await sleep(100); }
    rec(`S3 ${f}: the highlight never rests on a skipped chord`, [...seen].every((e) => !skEv.has(e)), `events seen ${[...seen].join(',')}; skipped ${[...skEv].slice(0, 5).join(',')}...`);
    // tap a chord of the skipped section in the song view
    const tapInfo = await page.evaluate((si) => { const secs = document.querySelectorAll('.song-section, section.sec, [data-section]'); return secs.length; }, sk[0].sec);
    const chord = await page.$(`[data-ev="${first}"], [data-event="${first}"]`);
    info('S', `tap target for the first skipped event: ${chord ? 'found' : 'none'} (${tapInfo} section nodes)`);
    if (chord) { await chord.click().catch(() => {}); await sleep(300); const s = await snap(page); info('S', `after tapping a skipped chord: state ${s.st}, event ${s.ev}`); }
    // touching a skipped section in the song view: long-press its header (starts a loop), tap one of its chords
    await page.evaluate(() => { const b = document.getElementById('btn-stop'); if (b) b.click(); }); await sleep(300);
    info('S4', 'before long-press: gapp ' + (await page.evaluate(() => !!window.__gapp)) + ' hash ' + (await page.evaluate(() => location.hash)));
    const sec = sk[0].sec;
    const sh = (await page.$$('.sec-head'))[sec];
    if (sh) {
      await sh.evaluate((el) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); await sleep(900); await sh.evaluate((el) => { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }); await sleep(1500);
      info('S4', `after long-press: gapp ${await page.evaluate(() => !!window.__gapp)} hash ${await page.evaluate(() => location.hash)} errors ${JSON.stringify(errors)} body ${(await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160)}`);
      const s = await snap(page);
      const loopUi = await page.evaluate(() => !!document.querySelector('.looping') || (!!document.querySelector('#pp-loop') && !document.querySelector('#pp-loop').hidden));
      info('S4', `${f}: long-press on a skipped section header: state ${s.st}, event ${s.ev}, audio t ${s.t.toFixed(1)}, loop UI ${loopUi}, name "${s.name}"`);
      await sleep(4000); const s2 = await snap(page);
      info('S4', `${f}: 4 s later: state ${s2.st}, event ${s2.ev}, audio t ${s2.t.toFixed(1)}`);
      await page.screenshot({ path: path.join(OUT, `skip-${f}-${devName}-longpress.png`) });
      if (s.st !== 'playing') { await page.evaluate(() => document.getElementById('btn-play').click()); await sleep(5000); const s3 = await snap(page); info('S4', `${f}: Play pressed with the loop on a skipped section: state ${s3.st}, event ${s3.ev}, audio t ${s3.t.toFixed(1)}`); await sleep(6000); const s4 = await snap(page); info('S4', `${f}: 6 s later: state ${s4.st}, event ${s4.ev}, audio t ${s4.t.toFixed(1)}`); }
      const c = await (await page.$$('.sec'))[sec].$('.ch');
      if (c && await c.isVisible()) { await c.scrollIntoViewIfNeeded(); await c.click(); await sleep(500); info('S5', `${f}: tapped a chord of the skipped section: sheet dialog ${!!(await page.$('.sheet'))}`); await page.click('#sheet-close').catch(() => {}); }
    }
    await page.screenshot({ path: path.join(OUT, `skip-${f}-${devName}.png`) });
    rec(`Sz ${f}: no page errors`, errors.length === 0, errors.join('|').slice(0, 120));
    await browser.close();
  }
}

async function persist() {
  dev = devName + '-persist';
  const { browser, page, errors } = await open();
  await loadSynth(page); await syncWith(page, path.join(AS, 'gap20.mp3'));
  await page.click('#as-accept');
  const before = await alignment(page);
  rec('P0 the alignment has a gap', before.gaps.some((g) => g.endSec - g.startSec >= 3));
  await page.reload(); await page.waitForSelector('#btn-sync, #btn-play');
  const after = await alignment(page);
  rec('P1 identical after reload', JSON.stringify(before) === JSON.stringify(after));
  await page.click('#btn-sync'); await sleep(1500);
  const rows = await page.$$eval('#as-rows .as-gap', (r) => r.map((x) => x.textContent));
  rec('P2 after reload the summary still shows the gap row', rows.length === 1, JSON.stringify(rows));
  await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  // play in the gap after reload (audio restored from IndexedDB?)
  const hasAudio = await page.evaluate(() => !!window.__gapp.audioEl);
  info('P', `audio element present after reload: ${hasAudio}`);
  if (hasAudio) {
    const g = after.gaps.find((x) => x.endSec - x.startSec >= 3);
    await startPlay(page); await seek(page, g.startSec + 3); await sleep(800);
    const s = await snap(page);
    rec('P3 after reload, playing in the gap says "Fuori dal foglio"', s.name === 'Fuori dal foglio' && s.cur === 0, JSON.stringify({ name: s.name, cur: s.cur }));
  }
  await page.click('#btn-back'); await page.waitForSelector('#btn-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const f = path.join(OUT, 'p-lib-export.json'); await dl.saveAs(f);
  const ex = JSON.parse(fs.readFileSync(f, 'utf8'));
  const s0 = ex.songs.find((x) => x.audio && x.audio.alignment);
  rec('P4 export contains the gaps and the alignment', !!s0 && JSON.stringify(s0.audio.alignment.gaps) === JSON.stringify(before.gaps), s0 ? `gaps ${s0.audio.alignment.gaps.length}` : 'none');
  const b2 = await chromium.launch(); const c2 = await b2.newContext(PROFILES[devName]); const p2 = await c2.newPage(); p2.on('dialog', (d) => d.accept());
  await p2.goto(URL); await p2.setInputFiles('#import-json', f);
  await p2.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {}); const nb = await p2.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await p2.waitForSelector('.song-row'); await p2.click('.song-row'); await p2.waitForSelector('#btn-sync');
  const imp = await alignment(p2);
  rec('P5 import: same alignment with gaps (without audio)', JSON.stringify(imp) === JSON.stringify(before));
  // export/import of the skipped sections
  await b2.close();
  rec('Pz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
  // skipped sections persistence
  {
    const o = await open(); await loadSynth(o.page); await syncWith(o.page, path.join(AS, 'nobridge.mp3'));
    await o.page.click('#as-accept'); const b = await alignment(o.page);
    await o.page.reload(); await o.page.waitForSelector('#btn-sync, #btn-play'); const a = await alignment(o.page);
    rec('P6 skipped events identical after reload', JSON.stringify(b.skipped) === JSON.stringify(a.skipped) && b.skipped.length > 0, `skipped events ${b.skipped.length}`);
    await o.page.click('#btn-back'); await o.page.waitForSelector('#btn-export');
    const [d2] = await Promise.all([o.page.waitForEvent('download'), o.page.click('#btn-export')]);
    const f2 = path.join(OUT, 'p-lib-export2.json'); await d2.saveAs(f2);
    const ex2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
    rec('P7 export keeps the skipped events', JSON.stringify(ex2.songs.find((x) => x.audio && x.audio.alignment).audio.alignment.skipped) === JSON.stringify(b.skipped));
    await o.browser.close();
  }
}

// D3: highlight vs real audio position after the chunked decode, with the music starting at about 1 / 4 / 8 minutes
async function sync() {
  for (const P of [40, 200, 400]) {
    dev = `${devName}-pad${P}`;
    const { browser, page, errors } = await open();
    await loadSynth(page);
    const t0 = Date.now(); await syncWith(page, path.join(AS, `pad${P}.mp3`));
    const al = await alignment(page); const bt = T.base;
    const ms = Date.now() - t0;
    const errsA = al.eventStartSec.map((t, j) => t - (bt[j] + P));
    const ok = errsA.filter((e) => Math.abs(e) <= 0.25).length;
    info('D3', `pad ${P} s: analysis in the app ${(ms / 1000).toFixed(1)} s (incl. page); events within 250 ms of truth ${ok}/${errsA.length}; first event error ${errsA[0].toFixed(2)} s; median |err| ${errsA.map(Math.abs).sort((a, b) => a - b)[errsA.length >> 1].toFixed(3)} s`);
    await closeSync(page); await startPlay(page);
    // live: at 3 chosen events, play from 1.2 s before and record when the highlighted event index changes to j
    const res = [];
    for (const j of [8, 24, 41, 56]) {
      await seek(page, bt[j] + P - 1.2); await sleep(500);
      let seen = null; const tt = Date.now();
      while (Date.now() - tt < 5000) { const s = await snap(page); if (s.ev === j) { seen = s.t; break; } await sleep(30); }
      res.push(seen === null ? null : seen - (bt[j] + P));
    }
    const good = res.filter((e) => e !== null && Math.abs(e) < 0.3).length;
    rec(`D3 pad ${P} s (music at ${(P / 60).toFixed(1)} min+): live highlight switches within 300 ms of the true onset`, good === res.length, `errors ${res.map((e) => e === null ? 'none' : e.toFixed(2)).join(' ')} s at audio time ${(bt[56] + P).toFixed(0)} s`);
    rec(`Dz pad ${P} no page errors`, errors.length === 0, errors.join('|').slice(0, 120));
    await browser.close();
  }
}

// E1: "Usa comunque" with noise / another song / silence; every section at most yellow; removable ("Scarta")
async function forced() {
  for (const [file, label] of [['noise.mp3', 'pink noise'], [path.join(ROOT, 'test-artifacts', 'round-8', 'assets', 'other.mp3'), 'other song'], [path.join(ROOT, 'test-artifacts', 'round-8', 'assets', 'silence.mp3'), 'silence']]) {
    dev = `${devName}-forced-${label.replace(' ', '')}`;
    const { browser, page, errors } = await open();
    await loadSynth(page);
    await syncWith(page, file.startsWith('/') ? file : path.join(AS, file));
    const rows0 = await page.$('#as-rows');
    rec(`F1 ${label}: not recognised (no summary), "Usa comunque" offered`, !rows0 && !!(await page.$('#as-force')));
    await page.screenshot({ path: path.join(OUT, `forced-${label.replace(' ', '')}-${devName}-0.png`) });
    await page.click('#as-force'); await page.waitForSelector('#as-rows');
    const states = await page.$$eval('#as-rows .as-row', (r) => r.map((x) => x.dataset.state));
    rec(`F2 ${label}: forced -> no green/verified, at most yellow`, states.length > 0 && states.every((s) => s === 'yellow' || s === 'red' || s === 'skipped'), states.map((s) => s[0]).join(''));
    const al = await alignment(page);
    rec(`F3 ${label}: stored as forced`, al.forced === true && al.confidence.every((c) => c < 0.75), `max conf ${Math.max(...al.confidence).toFixed(2)}`);
    await page.screenshot({ path: path.join(OUT, `forced-${label.replace(' ', '')}-${devName}-1.png`) });
    const txt = await page.evaluate(() => document.querySelector('#sync-foot') ? document.querySelector('#sync-foot').innerText.replace(/\s+/g, ' ') : '');
    info('F', `${label}: bar text "${txt}"`);
    // can it be removed?
    const dis = await page.$('#as-discard');
    rec(`F4 ${label}: "Scarta" exists`, !!dis);
    if (dis) { await dis.click(); await page.waitForSelector('#as-start, #as-force', { timeout: 5000 }); const after = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('gapp.song.')); const s = JSON.parse(localStorage.getItem(k)); return !!(s.audio && s.audio.alignment); }); rec(`F5 ${label}: after "Scarta" no alignment is stored`, after === false); }
    // forced then play: does the highlight go through? (just no errors)
    rec(`Fz ${label}: no page errors`, errors.length === 0, errors.join('|').slice(0, 120));
    await browser.close();
  }
}

// E2: tap tempo and the BPM field locked with an alignment, active without
async function lock() {
  dev = devName + '-lock';
  const { browser, page, errors } = await open();
  await loadSynth(page);
  const ids = ['btn-bpm-down', 'btn-bpm-up', 'btn-tap', 'pp-bpm-tap', 'pp-bpm-apply', 'pp-bpm-field'];
  const dis = () => page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, (document.getElementById(id) || {}).disabled])), ids);
  await page.click('#pp-bpm');
  const d0 = await dis();
  rec('L1 no alignment: all six controls enabled', Object.values(d0).every((v) => v === false), JSON.stringify(d0));
  rec('L1b no alignment: fixed note hidden', await page.evaluate(() => document.getElementById('pp-bpm-lock').hidden));
  const b0 = await page.evaluate(() => document.getElementById('pp-bpm').textContent);
  await page.click('#btn-bpm-up'); const b1 = await page.evaluate(() => document.getElementById('pp-bpm').textContent);
  rec('L1c "+" changes the BPM without alignment', b0 !== b1, `${b0} -> ${b1}`);
  await page.screenshot({ path: path.join(OUT, `lock-${devName}-free.png`) });
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', path.join(AS, 'plain.mp3')); await page.waitForSelector('#as-start'); await page.click('#as-start'); await page.waitForSelector('#as-rows', { timeout: 120000 });
  await page.click('#as-accept'); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  if (await page.evaluate(() => document.getElementById('pp-bpmedit').hidden)) await page.click('#pp-bpm');
  const d1 = await dis();
  rec('L2 with an alignment: all six controls disabled', Object.values(d1).every((v) => v === true), JSON.stringify(d1));
  rec('L2b fixed note visible', await page.evaluate(() => !document.getElementById('pp-bpm-lock').hidden));
  const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).sections.map((s) => s.bpm)));
  await page.evaluate(() => { for (let i = 0; i < 6; i++) { document.getElementById('btn-tap').dispatchEvent(new MouseEvent('click', { bubbles: true })); document.getElementById('pp-bpm-tap').dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  const after = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).sections.map((s) => s.bpm)));
  rec('L3 forced clicks on tap tempo change nothing', before === after);
  await page.screenshot({ path: path.join(OUT, `lock-${devName}-locked.png`) });
  // discard the alignment: controls active again
  await page.click('#btn-sync'); await page.waitForSelector('#as-discard'); await page.click('#as-discard'); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  if (await page.evaluate(() => document.getElementById('pp-bpmedit').hidden)) await page.click('#pp-bpm');
  const d2 = await dis();
  rec('L4 after discarding the alignment the six controls are enabled again', Object.values(d2).every((v) => v === false), JSON.stringify(d2));
  rec('Lz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

// A in the app: variants of the real mp3 (browser decode path, 11 kHz) are recognised (counts only)
async function variants() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const V = path.join(OUT, 'variants');
  const list = (process.argv[4] ? process.argv[4].split(',') : ['v64k.mp3', 'vphone.mp3', 'vphone2.mp3', 'vpitch.mp3', 'vcut10.mp3', 'vsil5.mp3', 'vreverb.mp3', 'vogg.ogg', 'vaac.m4a', 'vwav.wav', 'vtempo.mp3', 'vmono22.mp3']);
  for (const f of list) {
    dev = `${devName}-${f}`;
    const { browser, page, errors } = await open();
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    const t0 = Date.now();
    await syncWith(page, path.join(V, f));
    const ms = Date.now() - t0;
    const rows = await page.$('#as-rows');
    const st = rows ? await page.$$eval('#as-rows .as-row', (r) => r.map((x) => x.dataset.state[0]).join('')) : '-';
    const gaps = rows ? await page.$$eval('#as-rows .as-gap', (g) => g.length) : 0;
    const a = await page.evaluate(() => window.__gappAutosync || {});
    rec(`V ${f}: recognised in the app`, !!rows, `colours ${st} gap rows ${gaps} total ${(ms / 1000).toFixed(1)} s, decode ${a.decodeMs} ms, analysis ${a.analyseMs} ms, match? ${a.notRecognised ? 'NOT recognised' : 'ok'}`);
    rec(`Vz ${f}: no page errors`, errors.length === 0, errors.join('|').slice(0, 120));
    await browser.close();
  }
}

// D2 in the app: files that are not (decodable) mp3 / truncated mp3 / mp3 without Xing: no crash, a sensible message
async function badfile() {
  const DEC = path.join(OUT, 'dec');
  for (const f of ['fake-random.mp3', 'fake-text.mp3', 'fake-wav.mp3', 'fake-ogg.mp3', 'trunc.mp3', 'noxing.mp3', 'bigid3.mp3', 'mono22.mp3']) {
    dev = `${devName}-${f}`;
    const { browser, page, errors } = await open();
    await loadSynth(page);
    await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
    await page.setInputFiles('#sync-file', path.join(DEC, f));
    await sleep(1200);
    const afterPick = await page.evaluate(() => (document.querySelector('#sync-file') ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 0) : '') + ((document.querySelector('.msg.error, #as-error, .error') || {}).textContent || ''));
    const hasStart = !!(await page.$('#as-start'));
    let outcome = 'start-button';
    if (hasStart) {
      await page.click('#as-start');
      await page.waitForSelector('#as-rows, #as-force, .msg.error, #as-redo', { timeout: 120000, state: 'attached' }).catch(() => {});
      await sleep(500);
      outcome = (await page.$('#as-rows')) ? 'summary' : (await page.$('#as-force')) ? 'not-recognised' : 'other';
    } else outcome = 'rejected at file pick: "' + (await page.evaluate(() => (document.querySelector('.msg.error') || {}).textContent || '')).slice(0, 90) + '"';
    const msg = await page.evaluate(() => [...document.querySelectorAll('.msg.error, #as-msg, .as-error, #sync-msg')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 160));
    rec(`X ${f}: no crash`, errors.length === 0, `${outcome}; message "${msg}"`);
    await page.screenshot({ path: path.join(OUT, `badfile-${f}-${devName}.png`) });
    await browser.close();
  }
}

// E4: correction with 35 chords: singular / plural of the counter text and of the preview
async function corr() {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  dev = devName + '-corr';
  const { browser, page, errors } = await open();
  await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  await syncWith(page, MP3);
  await page.click('.as-row[data-sec="0"] [data-act="correct"]'); await page.waitForSelector('#corr-tap');
  await page.waitForFunction(() => window.__gappSync.player.getState() === 'playing', null, { timeout: 15000 });
  const next = () => page.evaluate(() => document.getElementById('corr-next').textContent);
  const texts = [await next()];
  for (let k = 0; k < 35; k++) { await page.dispatchEvent('#corr-tap', 'pointerdown', { button: 0 }); await sleep(30); if (k === 0 || k === 32 || k === 33 || k === 34) texts.push(await next()); }
  rec('K3 plural "mancano 35 tocchi" at the start', /mancano 35 tocchi/.test(texts[0]), texts[0]);
  rec('K3b plural "mancano 2 tocchi", singular "manca 1 tocco", then complete', /mancano 2 tocchi/.test(texts[2]) && /manca 1 tocco/.test(texts[3]) && /Tocchi completi/.test(texts[4]), JSON.stringify(texts.slice(1)));
  // preview with 34 taps: undo one
  await page.click('#corr-undo-tap').catch(() => {});
  await sleep(200);
  const st = await page.evaluate(() => ({ next: document.getElementById('corr-next').textContent, count: document.getElementById('corr-count').textContent }));
  info('K', `after undo: ${st.next} / ${st.count}`);
  const sv = await page.evaluate(() => { const r = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; }; return { vh: innerHeight, save: r('corr-save') && r('corr-save').bottom, prev: r('corr-preview') && r('corr-preview').bottom, tap: r('corr-tap').bottom }; });
  info('K', `layout: viewport ${sv.vh}, tap bottom ${sv.tap && sv.tap.toFixed(0)}, Anteprima bottom ${sv.prev && sv.prev.toFixed(0)}, Salva bottom ${sv.save && sv.save.toFixed(0)}`);
  await page.screenshot({ path: path.join(OUT, `corr35-${devName}.png`) });
  rec('Kz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  await browser.close();
}

(async () => {
  await ({ gap, gap2, skip, persist, sync, forced, lock, variants, badfile, corr }[mode])();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
