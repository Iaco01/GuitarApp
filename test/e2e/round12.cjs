// Round 12 in the app (Playwright, Chromium): highlight offset control in the play panel, exact seeking (the player reports the media
// position of the blob it plays), the pause at a loop turn, the exported technical information.  Synthetic song (round10-tester-make.mjs).
// Run: node test/e2e/round10-tester-make.mjs && node scripts/build.mjs && node test/e2e/round12.cjs [SE|13|320]
const { chromium, devices } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const SYN = path.join(ROOT, 'test-artifacts', 'round-10', 'synth');
const SONG = path.join(SYN, 'r10-song.json');
const MP3 = path.join(SYN, 'r10.mp3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'], 320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(PROFILES[dev])).newPage();
  const errors = [];
  page.on('crash', () => console.log('PAGE CRASH'));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => { try { const d = JSON.parse(localStorage.getItem('gapp.device.v1') || '{}'); d.barAutoCollapse = false; localStorage.setItem('gapp.device.v1', JSON.stringify(d)); } catch (e) { /* round 13: the bar stays open for these older checks */ } });
  await page.goto(URL);
  await page.setInputFiles('#import-json', SONG);
  await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
  const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
  await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  await page.click('#btn-sync'); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); await page.click('#as-start');
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  await page.click('#as-accept').catch(() => {}); await page.click('#sync-close'); await page.waitForSelector('#btn-play');
  await page.waitForFunction(() => window.__gapp.audioPlayer, null, { timeout: 15000 });
  const exact = await page.evaluate(async () => { await window.__gapp.audioPlayer.ready(); return window.__gapp.audioPlayer.isExact(); });
  rec('E0 the mp3 is scanned: exact seeking on', exact === true);
  const alDecode = await page.evaluate(() => { const id = decodeURIComponent(location.hash.split('/').pop()); const a = JSON.parse(localStorage.getItem('gapp.song.' + id)).audio.alignment; return a && a.decode; });
  rec('E1 the alignment records how the audio was decoded', !!alDecode && (alDecode.method === 'pieces' || alDecode.method === 'whole'), JSON.stringify(alDecode));
  // exact seek: the media position after a jump is where it was asked (the blob starts at a frame, a few frames before)
  const dur = await page.evaluate(() => window.__gapp.audioPlayer.duration());
  const rows = [];
  for (const f of [0.15, 0.4, 0.7]) {
    const T = Math.floor(dur * f);
    await page.evaluate((t) => window.__gapp.audioPlayer.playFromTime(t), T);
    await sleep(1500);
    const m = await page.evaluate(() => window.__gapp.audioPlayer.mediaTime());
    rows.push([T, m]);
  }
  rec('E2 after a jump the media time is the asked time plus the time played', rows.every(([T, m]) => m >= T - 0.15 && m <= T + 2.2), JSON.stringify(rows.map(([T, m]) => [T, +m.toFixed(2)])));
  // pause / resume keeps the position; the rate applies to the new source
  await page.evaluate(() => window.__gapp.audioPlayer.setRate(0.75));
  const T2 = Math.floor(dur * 0.5);
  await page.evaluate((t) => window.__gapp.audioPlayer.playFromTime(t), T2);
  await sleep(2000);
  const rate = await page.evaluate(() => window.__gapp.audioEl.playbackRate);
  const m2 = await page.evaluate(() => window.__gapp.audioPlayer.mediaTime());
  rec('E3 playback rate kept after a jump (0.75)', rate === 0.75 && m2 - T2 > 0.8 && m2 - T2 < 2.2, `rate ${rate} advanced ${(m2 - T2).toFixed(2)} s in 2 s`);
  await page.evaluate(() => window.__gapp.audioPlayer.setRate(1));
  await page.evaluate(() => window.__gapp.audioPlayer.pause());
  const mp = await page.evaluate(() => window.__gapp.audioPlayer.mediaTime());
  await sleep(500);
  await page.evaluate(() => window.__gapp.audioPlayer.play());
  await sleep(1200);
  const mr = await page.evaluate(() => window.__gapp.audioPlayer.mediaTime());
  rec('E4 pause and resume continue from the same place', mr - mp > 0.8 && mr - mp < 2, `${(mr - mp).toFixed(2)} s`);
  // loop: the turn costs a short silence
  const sec = await page.evaluate(() => { const s = window.__gapp.timeline.sections.filter((x) => x.endSec - x.startSec > 6)[0]; return { i: window.__gapp.timeline.sections.indexOf(s), s: s.startSec, e: s.endSec }; });
  await page.evaluate((i) => window.__gapp.audioPlayer.setLoop(i), sec.i);
  await page.evaluate((t) => window.__gapp.audioPlayer.playFromTime(t), sec.e - 1.5);
  await sleep(6000);
  const dg = await page.evaluate(() => window.__gapp.audioPlayer.diagnostics());
  rec('L1 loop turn: the silence is at most 150 ms', dg.maxGapMs > 0 && dg.maxGapMs <= 150, `last ${dg.lastGapMs} ms, max ${dg.maxGapMs} ms, jumps ${dg.seeks}`);
  const st = await page.evaluate(() => window.__gapp.audioPlayer.getInfo().timeSec);
  rec('L2 still inside the looped section after turns', st >= sec.s - 0.2 && st <= sec.e, `time ${st.toFixed(2)} in [${sec.s.toFixed(1)}, ${sec.e.toFixed(1)}]`);
  await page.evaluate(() => { window.__gapp.audioPlayer.setLoop(null); window.__gapp.audioPlayer.pause(); });
  // offset control
  await page.click('#btn-more');
  rec('O1 the offset row is in the more menu', await page.isVisible('#pp-offset'));
  const val = () => page.textContent('#pp-offset-val');
  const lat = () => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.device.v1') || '{}').latencyMs);
  for (let i = 0; i < 3; i++) await page.click('#btn-offset-earlier');
  rec('O2 three steps earlier: latency -150, label', (await lat()) === -150 && (await val()) === 'in anticipo di 150 ms', `${await lat()} / ${await val()}`);
  for (let i = 0; i < 4; i++) await page.click('#btn-offset-later');
  rec('O3 four steps later: latency +50, label', (await lat()) === 50 && (await val()) === 'in ritardo di 50 ms', `${await lat()} / ${await val()}`);
  for (let i = 0; i < 30; i++) await page.click('#btn-offset-earlier');
  rec('O4 the range reaches -1000 and stops', (await lat()) === -1000 && (await val()) === 'in anticipo di 1000 ms', `${await lat()} / ${await val()}`);
  const pl = await page.evaluate(() => window.__gapp.audioPlayer.diagnostics().latencyMs);
  rec('O5 the player uses the new latency', pl === -1000, String(pl));
  for (let i = 0; i < 20; i++) await page.click('#btn-offset-later');
  await page.click('#btn-offset-listen');
  await sleep(1200);
  const playing = await page.evaluate(() => window.__gapp.player.state);
  await sleep(5200);
  const after = await page.evaluate(() => window.__gapp.player.state);
  rec('O6 "Ascolta e regola" plays about 5 s then stops', playing === 'playing' && after === 'paused', `${playing} -> ${after}`);
  const sz = await page.evaluate(() => { const r = document.getElementById('pp-more').getBoundingClientRect(); return [Math.round(r.width), document.documentElement.scrollWidth]; });
  rec('O7 no horizontal overflow with the row open', sz[1] <= (PROFILES[dev].viewport.width), `scrollWidth ${sz[1]}`);
  // free tempo: one accented tick per change, the panel says so in small print, at the same height as in a stable section
  await page.evaluate(() => { window.location.hash = window.location.hash; });
  const secs = await page.evaluate(() => window.__gapp.timeline.sections.map((x) => ({ s: x.startSec, e: x.endSec, free: !!x.free, skipped: !!x.skipped })));
  const free = secs.find((x) => x.free && !x.skipped && x.e - x.s > 3); const stable = secs.find((x) => !x.free && !x.skipped && x.e - x.s > 3);
  if (free && stable) {
    const h = async (t) => { await page.evaluate((tt) => window.__gapp.audioPlayer.playFromTime(tt), t); await sleep(900); return page.evaluate(() => ({ h: Math.round(document.getElementById('playpanel').getBoundingClientRect().height), txt: !document.getElementById('pp-free').hidden ? document.getElementById('pp-free').textContent : '', gap: !document.getElementById('pp-gap').hidden, vis: (() => { const r = document.getElementById('pp-free').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() })); };
    const a = await h(stable.s + 1.5); const b = await h(free.s + 1.5);
    rec('F1 free-tempo section: the panel says "tempo libero: un tic a ogni cambio"', b.txt === 'tempo libero: un tic a ogni cambio' && a.txt === '' && b.vis[0] >= 40 && !b.gap, JSON.stringify([a.txt, b.txt, b.vis]));
    rec('F2 the panel grows by at most 8 px in a free-tempo section (the line of the bar becomes a line of text)', b.h - a.h >= 0 && b.h - a.h <= 8, `${a.h} vs ${b.h} px`);
    const ticks = await page.evaluate((f) => { const tl = window.__gapp.timeline; const evs = tl.events.filter((e) => e.sectionIndex === f && !e.skipped); return evs.map((e) => tl.beats.filter((bt) => bt.eventIndex === tl.events.indexOf(e)).length); }, secs.indexOf(free));
    rec('F3 one tick per chord in the free section', ticks.length > 0 && ticks.every((n) => n === 1), JSON.stringify(ticks));
    await page.evaluate(() => window.__gapp.audioPlayer.pause());
  } else console.log('NOTE no free-tempo section in this song: F1-F3 not run');
  // technical information
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__gapp.audioPlayer.playFromTime(20); });
  await sleep(23000);
  await page.evaluate(() => window.__gapp.audioPlayer.pause());
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('#btn-diag');
  await page.click('#btn-diag');
  await page.waitForFunction(() => document.getElementById('diag-out') && !document.getElementById('diag-out').hidden && document.getElementById('diag-out').value.length > 50);
  const text = await page.$eval('#diag-out', (e) => e.value);
  const d = JSON.parse(text);
  const title = JSON.parse(await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('gapp.song.')); return localStorage.getItem(k); })).title || '';
  const parts = { ua: !!d.userAgent, lat: d.latencyMs === 0, al60: !!d.alignment && d.alignment.firstEventTimesSec.length === Math.min(60, d.alignment.events), dec: !!(d.alignment && d.alignment.decode), mp3: !!(d.player && d.player.mp3), scan: !!(d.player && d.player.scanDurationSec > 0), browser: !!(d.player && d.player.browserDurationSec > 0), ctx: !!(d.audioContext || (d.player && d.player.audioContext)) };
  rec('D1 diagnostics: user agent, latency, decode method, mp3 kind, both durations, audio context, the first 60 event times', Object.values(parts).every(Boolean), JSON.stringify(parts));
  rec('D2 no title or text of the song in the JSON', !title || !text.includes(title), '');
  rec('D3 drift measured in play', !!d.drift && d.drift.rows.length >= 2 && Math.abs(d.drift.slope - 1) < 0.01, JSON.stringify(d.drift && { slope: d.drift.slope, rows: d.drift.rows.length }));
  rec('X0 no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close();
  console.log(fails ? `FAIL ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
