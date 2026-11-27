// Round 12 tester, C: highlight offset control (±50 ms, −1000…+1000), its effect right away on the highlight / beat dots / metronome ticks,
// storage per device, "Ascolta e regola", and the exported technical information ("Informazioni tecniche": fields, drift, no text of the song).
// Real song on a Pixel 7 profile (Chromium).  Prints counts, times and PASS/FAIL only.
// Run: node scripts/build.mjs && node test/e2e/round12-tester-offset.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-12', 'tester');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
(async () => {
  if (!fs.existsSync(MP3)) { console.log('mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctxB = await browser.newContext(devices['Pixel 7']);
  const page = await ctxB.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__clk = []; window.__on = false;
    const oo = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { const o = oo.call(this); const st = o.start.bind(o); const c = this; o.start = (w) => { if (window.__on) window.__clk.push([w, o.frequency.value, c.currentTime, window.__gapp ? window.__gapp.audioPlayer.mediaTime() : null]); return st(w); }; return o; };
    window.__hl = [];
    window.addEventListener('DOMContentLoaded', () => { new MutationObserver(() => { if (!window.__on) return; const g = window.__gapp; window.__hl.push([performance.now(), g.player.eventIndex, g.player.timeSec, g.audioPlayer.mediaTime(), g.player.beatIndex]); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] }); });
  });
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  const words = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('gapp.song.')); const s = JSON.parse(localStorage.getItem(k));
    const set = new Set(); const add = (t) => { for (const w of String(t || '').toLowerCase().match(/[a-zàèéìòùü']{4,}/g) || []) set.add(w); };
    // every string of the saved song (lyrics, section names, chord names, title, artist), except the structural keys
    (function walk(o, k) { if (typeof o === 'string') { if (!/^(id|ref|kind|type|schemaVersion|source|timingSource|bpmSource|updatedAt)$/.test(k || '')) add(o); } else if (o && typeof o === 'object') for (const [kk, v] of Object.entries(o)) walk(v, kk); })(s);
    add(s.title); add(s.artist); return { list: [...set], n: set.size, title: s.title, artist: s.artist };
  });
  info('sheet words', `${words.n} distinct words of 4+ letters`);
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
  await page.waitForFunction(() => window.__gapp.audioPlayer, null, { timeout: 15000 });
  await page.evaluate(async () => { await window.__gapp.audioPlayer.ready(); });
  const T = await page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.ref]), beats: window.__gapp.timeline.beats.map((b) => b.timeSec) }));
  const lat = () => page.evaluate(() => { const d = JSON.parse(localStorage.getItem('gapp.device.v1') || '{}'); return d.latencyMs; });
  const jsClick = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
  // ---- the control ----
  await page.locator('#btn-more').tap();
  rec('C1 offset row visible in the more menu (Pixel 7)', await page.isVisible('#pp-offset'), await page.textContent('#pp-offset-val'));
  const label = () => page.textContent('#pp-offset-val');
  const l0 = await label(); info('label at start', l0);
  const seq = [];
  for (let i = 0; i < 3; i++) { await page.locator('#btn-offset-earlier').tap(); seq.push([await lat(), await label()]); }
  for (let i = 0; i < 5; i++) { await page.locator('#btn-offset-later').tap(); seq.push([await lat(), await label()]); }
  info('steps', JSON.stringify(seq));
  rec('C2 each tap moves exactly 50 ms (3 earlier, 5 later -> +100)', seq[0][0] === seq[0][0] && seq.every((s, i) => i === 0 || Math.abs(s[0] - seq[i - 1][0]) === 50) && seq[seq.length - 1][0] === seq[2][0] + 250 && seq[seq.length - 1][0] === 100, JSON.stringify(seq.map((s) => s[0])));
  // the full range
  let prev = await lat(); let steps = 0;
  while (true) { await page.locator('#btn-offset-later').tap(); const v = await lat(); steps++; if (v === prev || steps > 60) break; prev = v; }
  const top = await lat(); const topLabel = await label();
  steps = 0; prev = top;
  while (true) { await page.locator('#btn-offset-earlier').tap(); const v = await lat(); steps++; if (v === prev || steps > 60) break; prev = v; }
  const bottom = await lat(); const bottomLabel = await label();
  rec('C3 range reaches +1000 and -1000 and stops there', top === 1000 && bottom === -1000, `${top} "${topLabel}" / ${bottom} "${bottomLabel}"`);
  // direction: earlier = the highlight comes earlier = display time ahead of media time
  await page.evaluate(() => window.__gapp.audioPlayer.setLatency(0));
  // ---- effect right away, on a running song: display time = media time - latency, dots follow the display time ----
  await page.locator('#btn-more').tap().catch(() => {});
  for (let i = 0; i < 20; i++) await jsClick('btn-offset-later'); // back to 0 from -1000 (20 steps)
  info('after 20 later from -1000', `${await lat()} "${await label()}"`);
  const set = async (ms) => { // go to ms by steps
    let cur = await lat(); while (cur !== ms) { await jsClick(cur < ms ? 'btn-offset-later' : 'btn-offset-earlier'); const n = await lat(); if (n === cur) break; cur = n; }
    return cur;
  };
  await set(0);
  await page.evaluate(() => { window.__gapp.audioPlayer.playFromTime(64.5); });
  await page.waitForFunction(() => window.__gapp.player.state === 'playing');
  await sleep(1500);
  const sample = () => page.evaluate(() => ({ media: window.__gapp.audioPlayer.mediaTime(), shown: window.__gapp.player.timeSec, ev: window.__gapp.player.eventIndex, dots: Array.from(document.querySelectorAll('.pp-dot')).findIndex((d) => d.classList.contains('on') || d.classList.contains('cur') || d.classList.contains('active')) }));
  const s0 = await sample();
  await set(300);
  await sleep(150);
  const s1 = await sample();
  await set(-300);
  await sleep(150);
  const s2 = await sample();
  rec('C4 changing the offset while playing shows at once (shown time = media time - latency, within 80 ms)', Math.abs((s0.media - s0.shown) - 0) < 0.08 && Math.abs((s1.media - s1.shown) - 0.3) < 0.08 && Math.abs((s2.media - s2.shown) + 0.3) < 0.08, `media-shown: ${((s0.media - s0.shown) * 1000).toFixed(0)} / ${((s1.media - s1.shown) * 1000).toFixed(0)} / ${((s2.media - s2.shown) * 1000).toFixed(0)} ms for 0 / +300 / -300`);
  // highlight changes in file time with each setting: the moment of an event change must move by the offset (compare at the same event)
  const evts = {};
  for (const L of [0, 300, -300, 0]) {
    await set(L);
    await page.evaluate((t) => { window.__hl.length = 0; window.__clk.length = 0; window.__on = true; window.__gapp.audioPlayer.playFromTime(t); }, 63.0);
    await sleep(7500);
    evts[L + '|' + Object.keys(evts).length] = await page.evaluate(() => ({ hl: window.__hl.slice(), clk: window.__clk.slice() }));
    await page.evaluate(() => { window.__on = false; window.__gapp.audioPlayer.pause(); });
  }
  const keys = Object.keys(evts);
  const hlTimes = (k) => { const m = new Map(); for (const [, ei, shown, media] of evts[k].hl) if (!m.has(ei)) m.set(ei, media); return m; }; // media position at the moment the highlight reached event ei
  const base = hlTimes(keys[0]);
  const rows = [];
  for (const k of keys.slice(1)) {
    const L = Number(k.split('|')[0]); const m = hlTimes(k); const d = [];
    for (const [ei, media] of m) if (base.has(ei) && ei >= 36 && ei <= 43) d.push(media - base.get(ei));
    rows.push([L, d.map((x) => Math.round(x * 1000))]);
  }
  info('media position when the highlight reaches events 36-43, difference from offset 0 (ms)', JSON.stringify(rows));
  rec('C5 the highlight moves by the offset: +300 -> media position 300 ms LATER at the change, -300 -> 300 ms EARLIER (+-60 ms)', rows.length === 3 && rows[0][1].length >= 3 && rows[0][1].every((x) => Math.abs(x - 300) < 60) && rows[1][1].every((x) => Math.abs(x + 300) < 60) && rows[2][1].every((x) => Math.abs(x) < 60), JSON.stringify(rows));
  // metronome ticks: do the ticks follow the offset? (position of the click against the beat: `when` in context time vs media position of the beat)
  await page.evaluate(() => { const b = document.getElementById('btn-click-icon'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  const ticks = [];
  for (const L of [0, 300, -300]) {
    await set(L);
    await page.evaluate(() => { window.__clk.length = 0; window.__on = true; window.__gapp.audioPlayer.playFromTime(100); });
    await sleep(6500);
    const r = await page.evaluate(() => { window.__on = false; window.__gapp.audioPlayer.pause(); return { clk: window.__clk.slice(), pairs: null }; });
    // offset of each click from the nearest beat of the timeline, in file time: when -> media time via the (ctx, media) pair recorded with the click
    const e = r.clk.filter((c) => c[3] !== null).map((c) => { const mediaAtClick = c[3] + (c[0] - c[2]); let bd = 1e9; for (const b of T.beats) if (Math.abs(b - mediaAtClick) < Math.abs(bd)) bd = b - mediaAtClick; return -bd; });
    ticks.push([L, Math.round(med(e) * 1000), e.length]);
  }
  info('metronome clicks: median offset of the click from the beat (ms; media clock at the click, includes up to 1 audio block of look-ahead error)', JSON.stringify(ticks));
  info('C6 metronome clicks do not follow the offset (they stay on the audio beats; offsets of the clicks from the beats, ms, for 0/+300/-300)', JSON.stringify(ticks));
  // the beat dots / beat counter of the panel follow the display time: media position when the beat index changes, minus the beat time
  const beatOff = (k) => { const d = []; let last = -1; for (const [, , , media, bi] of evts[k].hl) { if (bi !== last && bi >= 0) { d.push(media - T.beats[bi]); } last = bi; } return d; };
  const bo = keys.map((k) => [Number(k.split('|')[0]), Math.round(med(beatOff(k)) * 1000), beatOff(k).length]);
  rec('C6 the beat counter / dots of the panel follow the offset (+300 -> 300 ms later, -300 -> 300 ms earlier, +-60 ms)', Math.abs(bo[1][1] - bo[0][1] - 300) < 60 && Math.abs(bo[2][1] - bo[0][1] + 300) < 60, JSON.stringify(bo));
  // ---- storage per device ----
  await set(-150);
  await page.reload(); await page.waitForSelector('.song-row, #btn-play');
  const dev1 = await page.evaluate(() => localStorage.getItem('gapp.device.v1'));
  if (!(await page.$('#btn-play'))) { await page.click('.song-row'); await page.waitForSelector('#btn-play'); }
  await page.waitForFunction(() => window.__gapp && window.__gapp.audioPlayer, null, { timeout: 15000 }).catch(() => {});
  await page.locator('#btn-more').tap();
  const lbl = await page.textContent('#pp-offset-val');
  const pl = await page.evaluate(() => window.__gapp.audioPlayer && window.__gapp.audioPlayer.diagnostics().latencyMs);
  rec('C7 the value survives a reload (stored for the device) and the player uses it', /150/.test(lbl) && pl === -150 && /-150/.test(dev1 || ''), `"${lbl}", player ${pl}, device ${dev1}`);
  const songs = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gapp.song.')).length);
  const inSong = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gapp.song.')).some((k) => /latencyMs/.test(localStorage.getItem(k))));
  rec('C8 the offset is a setting of the device, not written in the song', !inSong, `songs ${songs}`);
  // ---- "Ascolta e regola" ----
  await page.evaluate(() => { window.__gapp.audioPlayer.pause(); window.__gapp.audioPlayer.playFromTime(200); });
  await sleep(1500); await page.evaluate(() => window.__gapp.audioPlayer.pause());
  const before = await page.evaluate(() => window.__gapp.audioPlayer.mediaTime());
  await page.locator('#btn-more').tap().catch(() => {});
  const vis = await page.isVisible('#btn-offset-listen'); if (!vis) await page.locator('#btn-more').tap();
  const t0 = Date.now();
  await page.locator('#btn-offset-listen').tap();
  await sleep(1000);
  const st1 = await page.evaluate(() => ({ s: window.__gapp.player.state, m: window.__gapp.audioPlayer.mediaTime() }));
  await sleep(5000);
  const st2 = await page.evaluate(() => ({ s: window.__gapp.player.state, m: window.__gapp.audioPlayer.mediaTime() }));
  rec('C9 "Ascolta e regola": plays about 5 s from half a second before the current point, then stops', st1.s === 'playing' && st2.s === 'paused' && st1.m > before - 0.8 && st1.m < before + 1.5 && st2.m - before > 3.5 && st2.m - before < 6, `start ${before.toFixed(1)} -> ${st1.m.toFixed(1)} (${st1.s}) -> ${st2.m.toFixed(1)} (${st2.s}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  // ---- diagnostics ----
  await set(0);
  await page.evaluate(() => window.__gapp.audioPlayer.playFromTime(30));
  await sleep(36000);
  await page.evaluate(() => window.__gapp.audioPlayer.pause());
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('#btn-diag');
  await page.click('#btn-diag');
  await page.waitForFunction(() => document.getElementById('diag-out') && !document.getElementById('diag-out').hidden && document.getElementById('diag-out').value.length > 50);
  const text = await page.$eval('#diag-out', (e) => e.value);
  fs.writeFileSync(path.join(OUT, 'diag.json'), text);
  const d = JSON.parse(text);
  const low = text.toLowerCase();
  const tokens = new Set(low.match(/[a-zàèéìòùü']{4,}/g) || []); // whole words of the JSON (keys stay whole: "firsteventtimessec" is one token)
  const hit = words.list.filter((w) => tokens.has(w));
  rec('D1 no word of the sheet in the JSON', hit.length === 0, `${hit.length} of ${words.n} words found${hit.length ? ': ' + hit.slice(0, 5).map((w) => w.length + 'ch').join(',') : ''}`);
  rec('D2 no title / artist / file name', !(words.title && low.includes(words.title.toLowerCase())) && !(words.artist && low.includes(words.artist.toLowerCase())) && !/american-pie|\.mp3|\.mht/.test(low), '');
  const f = {
    userAgent: !!d.userAgent, platform: d.platform !== undefined, ctx: !!(d.audioContext || (d.player && d.player.audioContext)), outputLatency: JSON.stringify(d).includes('outputLatency'), baseLatency: JSON.stringify(d).includes('baseLatency'),
    latencyMs: d.latencyMs === 0, decode: !!(d.alignment && d.alignment.decode && d.alignment.decode.method), pieceShifts: !!(d.alignment && d.alignment.decode && Array.isArray(d.alignment.decode.pieceShiftsMs)), mp3: !!(d.player && d.player.mp3),
    browserDur: !!(d.player && d.player.browserDurationSec > 0), scanDur: !!(d.player && d.player.scanDurationSec > 0), events60: !!(d.alignment && d.alignment.firstEventTimesSec && d.alignment.firstEventTimesSec.length === 60), drift: !!(d.drift && d.drift.rows && d.drift.rows.length >= 2),
  };
  rec('D3 the asked fields are there', Object.values(f).every(Boolean), JSON.stringify(f));
  info('diag', JSON.stringify({ decode: d.alignment && d.alignment.decode && { method: d.alignment.decode.method, pieces: d.alignment.decode.pieceShiftsMs && d.alignment.decode.pieceShiftsMs.length, maxShift: d.alignment.decode.pieceShiftsMs && Math.max(...d.alignment.decode.pieceShiftsMs.map(Math.abs)) }, mp3: d.player && d.player.mp3, durations: d.player && [d.player.browserDurationSec, d.player.scanDurationSec], drift: d.drift && { slope: d.drift.slope, rows: d.drift.rows.length, offsets: d.drift.rows.map((r) => r.offsetMs), vsCtx: d.drift.rows.map((r) => r.vsCtxMs) }, seeks: d.player && [d.player.seeks, d.player.maxSeekMs, d.player.maxGapMs], ctx: d.player && d.player.audioContext, ev: d.alignment && d.alignment.firstEventTimesSec.slice(33, 38) }));
  rec('D4 measured drift is small (slope within 1%, offsets within 60 ms)', !!d.drift && Math.abs(d.drift.slope - 1) < 0.01 && d.drift.rows.every((r) => Math.abs(r.offsetMs) < 60), JSON.stringify(d.drift && { slope: d.drift.slope, offs: d.drift.rows.map((r) => r.offsetMs) }));
  rec('Z no page errors', errors.length === 0, errors.join('|').slice(0, 200));
  await browser.close();
  console.log(fails ? `FAIL ${fails}` : 'ALL PASS');
})().catch((e) => { console.log('FAILED', String(e).slice(0, 500)); process.exit(1); });
