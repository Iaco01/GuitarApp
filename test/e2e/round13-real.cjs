// Round 13, slowdown with the real mp3 (Chromium, phone profile): audio rate, clicks on the slowed beats, highlight, rate changes during
// play, loop at 60%, audio not silent at 25% and 50%. Prints counts, timings and section numbers only (the real page is copyrighted).
// Run: node scripts/build.mjs && node test/e2e/round13-real.cjs [SE|13]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-13');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const PROFILES = { SE: devices['iPhone SE (3rd gen)'], 13: devices['iPhone 13'] };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext(PROFILES[dev])).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__clicks = []; window.__pairs = []; window.__samples = []; window.__rms = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { const o = orig.call(this); const st = o.start.bind(o); o.start = (when) => { const rec = [when, o.frequency.value, this.currentTime]; window.__clicks.push(rec); const sp = o.stop.bind(o); o.stop = (t) => { if (t === undefined || t <= when) { const i = window.__clicks.indexOf(rec); if (i >= 0) window.__clicks.splice(i, 1); } return sp(t); }; return st(when); }; return o; };
    const cg = AudioContext.prototype.createGain; AudioContext.prototype.createGain = function () { window.__ctx = this; return cg.call(this); };
    setInterval(() => { try { const el = window.__gapp && window.__gapp.audioEl; if (el && window.__ctx && !el.paused) window.__pairs.push([window.__ctx.currentTime, el.currentTime, el.playbackRate]); } catch (e) {} }, 50);
    const cm = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (el) { const n = cm.call(this, el); const an = this.createAnalyser(); an.fftSize = 2048; n.connect(an); window.__an = an; return n; };
    window.__sampling = false;
    setInterval(() => { if (!window.__sampling) return; window.__samples.push([window.__gapp.audioEl.currentTime, window.__gapp.player.eventIndex, window.__gapp.player.timeSec]); }, 15);
  });
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); const tS = Date.now(); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  info('sync', `analysis ${((Date.now() - tS) / 1000).toFixed(1)} s`);
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play', { state: 'attached' });
  await page.waitForFunction(() => window.__gapp.audioPlayer, null, { timeout: 15000 });
  await page.evaluate(async () => window.__gapp.audioPlayer.ready());
  const T = await page.evaluate(() => ({ beats: window.__gapp.timeline.beats.map((b) => b.timeSec), ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.beats, e.sectionIndex]), sec: window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm, s.free ? 1 : 0, s.skipped ? 1 : 0]) }));
  const si = T.sec.findIndex((s, i) => i >= 2 && !s[3] && !s[4] && s[1] - s[0] > 30);
  const S0 = T.sec[si];
  info('section', `using section ${si + 1}, ${(S0[1] - S0[0]).toFixed(0)} s, ${S0[2].toFixed(1)} BPM`);
  const beatsIn = (a, b) => T.beats.filter((t) => t >= a && t < b);
  const setPct = async (p) => { await page.evaluate(() => { const o = document.getElementById('btn-mini-open'); if (document.getElementById('playpanel').dataset.collapsed === '1') o.click(); }); await page.locator(`#btn-speed-${p}`).tap().catch(async () => { await page.evaluate((v) => { const el = document.getElementById('btn-speed-50'); }, p); }); };
  const rate = () => page.evaluate(() => window.__gapp.audioEl.playbackRate);
  const reset = () => page.evaluate(() => { window.__clicks.length = 0; window.__pairs.length = 0; window.__samples.length = 0; });
  // media time of a click from the (ctx, media, rate) pairs
  const clickMedia = async () => {
    const r = await page.evaluate(() => ({ c: window.__clicks, p: window.__pairs }));
    return r.c.map(([w, f]) => { const near = r.p.filter(([c]) => Math.abs(c - w) < 0.25).sort((a, b) => Math.abs(a[0] - w) - Math.abs(b[0] - w))[0]; return near ? { w, t: near[1] + (w - near[0]) * near[2], acc: f > 900 } : null; }).filter(Boolean).sort((a, b) => a.w - b.w);
  };
  // enable the click (the metronome is off until switched on) and start play with the real controls
  const clickOn = async () => { if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.locator('#btn-click-icon').tap(); };
  await page.evaluate(() => { const o = document.getElementById('btn-mini-open'); if (document.getElementById('playpanel').dataset.collapsed === '1') o.click(); });
  await clickOn();

  // ---- 50%: rate, tick intervals, tick phase, highlight ----
  await page.locator('#btn-speed-50').tap();
  rec('R1 50%: the audio element plays at 0.5', (await rate()) === 0.5, String(await rate()));
  await page.locator('#btn-play').tap(); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
  await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, S0[0] + 1);
  await sleep(1500); await reset(); await page.evaluate(() => { window.__sampling = true; });
  const m0 = await page.evaluate(() => window.__gapp.audioEl.currentTime); const w0 = Date.now();
  await sleep(24000);
  await page.evaluate(() => { window.__sampling = false; });
  const m1 = await page.evaluate(() => window.__gapp.audioEl.currentTime); const w1 = Date.now();
  const adv = (m1 - m0) / ((w1 - w0) / 1000);
  rec('R2 media advances at half speed', adv > 0.47 && adv < 0.53, `${adv.toFixed(3)} media s per second`);
  const C = await clickMedia();
  const wi = []; for (let i = 1; i < C.length; i++) wi.push(C[i].w - C[i - 1].w);
  const bs = beatsIn(S0[0] + 3, S0[1] - 3); const bint = []; for (let i = 1; i < bs.length; i++) bint.push(bs[i] - bs[i - 1]);
  const expI = med(bint) / 0.5;
  info('R3', `${C.length} clicks in 24 s; median interval ${(med(wi) * 1000).toFixed(0)} ms, expected ${(expI * 1000).toFixed(0)} ms (beat ${(med(bint) * 1000).toFixed(0)} ms / 0.5)`);
  rec('R3 click intervals = beat / 0.5 (median within 3%, none doubled, none lost)', Math.abs(med(wi) / expI - 1) < 0.03 && Math.min(...wi) > expI * 0.7 && Math.max(...wi) < expI * 1.4, `min ${(Math.min(...wi) * 1000).toFixed(0)} max ${(Math.max(...wi) * 1000).toFixed(0)} ms`);
  const err = C.map((c) => { let best = Infinity; for (const b of T.beats) { const d = c.t - b; if (Math.abs(d) < Math.abs(best)) best = d; if (b > c.t + 1) break; } return best; }).filter((d) => Math.abs(d) < 0.5);
  info('R4', `click minus beat on the file timeline: median ${(med(err) * 1000).toFixed(0)} ms, p90 |err| ${(pct(err.map(Math.abs), 0.9) * 1000).toFixed(0)} ms, ${err.length}/${C.length}`);
  rec('R4 clicks sit on the beats of the slowed audio (|median| < 40 ms, p90 < 90 ms)', Math.abs(med(err)) < 0.04 && pct(err.map(Math.abs), 0.9) < 0.09, `median ${(med(err) * 1000).toFixed(0)} p90 ${(pct(err.map(Math.abs), 0.9) * 1000).toFixed(0)}`);
  const S = await page.evaluate(() => window.__samples);
  const lag = []; for (let i = 1; i < S.length; i++) if (S[i][1] !== S[i - 1][1] && S[i][1] >= 0) lag.push(S[i][2] - T.ev[S[i][1]][0]);
  info('R5', `${lag.length} chord changes; highlight minus event start (file time): median ${(med(lag) * 1000).toFixed(0)} ms, p90 ${(pct(lag.map(Math.abs), 0.9) * 1000).toFixed(0)} ms`);
  rec('R5 the highlight changes at the event start (file time) while slowed (p90 < 60 ms)', lag.length >= 5 && pct(lag.map(Math.abs), 0.9) < 0.06);
  await page.screenshot({ path: path.join(OUT, `${dev}-06-real-50.png`) });

  // ---- rate changes during play: no doubled or lost tick ----
  await reset();
  const plan = [[75, 4000], [60, 4000], [100, 3000], [50, 4000], [25, 3000], [50, 3000]];
  const marks = [];
  for (const [p, ms] of plan) { await page.evaluate(() => { const o = document.getElementById('btn-mini-open'); if (document.getElementById('playpanel').dataset.collapsed === '1') o.click(); }); await page.evaluate((v) => { const b = [...document.querySelectorAll('.pp-chip')].find((c) => c.dataset.pct === String(v)); if (b) b.click(); else { for (let i = 0; i < 20; i++) document.getElementById('btn-speed-down').click(); } }, p); marks.push([Date.now(), p]); await sleep(ms); }
  const C2 = await clickMedia();
  // beats heard per media segment: consecutive clicks must be consecutive beats (media gap 1 beat), within the rate used
  let dup = 0; let lost = 0; let ok2 = 0;
  const raw = await page.evaluate(() => window.__clicks.map(([w, f, n]) => [+w.toFixed(3), f, +n.toFixed(3)]));
  info('R6-raw', JSON.stringify(raw.slice(0, 12)) + ' marks ' + JSON.stringify(marks.map((m) => m[1])));
  for (let i = 1; i < C2.length; i++) {
    const dm = C2[i].t - C2[i - 1].t; const k = beatsIn(C2[i - 1].t - 0.05, C2[i].t - 0.02).length; // beats strictly between
    if (dm < 0.25 * med(bint)) { dup++; info('R6-dup', `media gap ${(dm * 1000).toFixed(0)} ms at wall ${C2[i].w.toFixed(2)}, media ${C2[i].t.toFixed(2)}, beat spacing ${(med(bint) * 1000).toFixed(0)}, acc ${C2[i - 1].acc}/${C2[i].acc}`); }
    if (dm < 0.25 * med(bint)) {} else if (k >= 2) lost++; else ok2++;
  }
  info('R6', `${C2.length} clicks over 6 rate changes (75, 60, 100, 50, 25, 50): ${ok2} consecutive, ${dup} doubled, ${lost} with a lost beat in between`);
  rec('R6 no doubled click, at most 2 lost beats around the changes', dup === 0 && lost <= 2, `doubled ${dup}, lost ${lost}`);
  await page.locator('#btn-play').tap().catch(() => {}); await sleep(500);

  // ---- audio is not silent at 25%, 50%, 75% (captureStream of the element, RMS) ----
  const rms = {};
  for (const p of [25, 50, 100]) {
    await page.evaluate(() => { const o = document.getElementById('btn-mini-open'); if (document.getElementById('playpanel').dataset.collapsed === '1') o.click(); });
    await page.evaluate((v) => { const b = [...document.querySelectorAll('.pp-chip')].find((c) => c.dataset.pct === String(v)); if (b) b.click(); else { for (let i = 0; i < 20; i++) document.getElementById('btn-speed-down').click(); } }, p);
    const r = await page.evaluate(async (t) => {
      const el = window.__gapp.audioEl; const an = window.__an;
      window.__gapp.audioPlayer.playFromTime(t); await new Promise((r) => setTimeout(r, 1500));
      const buf = new Float32Array(2048); let max = 0; let sum = 0; let n = 0;
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 100)); an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; const v = Math.sqrt(s / buf.length); max = Math.max(max, v); sum += v; n++; }
      const out = { rate: el.playbackRate, paused: el.paused, muted: el.muted, max, mean: sum / n }; window.__gapp.audioPlayer.pause(); return out;
    }, S0[0] + 5);
    rms[p] = r; info('R7', `${p}%: rate ${r.rate}, element muted ${r.muted}, RMS mean ${r.mean.toFixed(4)} max ${r.max.toFixed(4)}`);
  }
  rec('R7 audio is audible at 25%, 50% and 100% (RMS well above silence)', [25, 50, 100].every((p) => rms[p].mean > 0.003 && rms[p].rate === p / 100), JSON.stringify(Object.fromEntries(Object.entries(rms).map(([k, v]) => [k, +v.mean.toFixed(4)]))));

  // ---- loop at 60% ----
  await page.evaluate(() => { const o = document.getElementById('btn-mini-open'); if (document.getElementById('playpanel').dataset.collapsed === '1') o.click(); });
  await page.evaluate(() => { for (let i = 0; i < 20; i++) document.getElementById('btn-speed-down').click(); for (let i = 0; i < 7; i++) document.getElementById('btn-speed-up').click(); });
  info('R8', `speed ${await page.textContent('#pp-tempo-pct')}`);
  const secLoop = T.sec.findIndex((s, i) => i >= 2 && !s[3] && !s[4] && s[1] - s[0] > 12 && s[1] - s[0] < 40);
  const L = T.sec[secLoop];
  await reset();
  await page.evaluate((i) => window.__gapp.audioPlayer.setLoop(i), secLoop);
  await page.evaluate((t) => window.__gapp.audioPlayer.playFromTime(t), L[1] - 4);
  await sleep(26000);
  const dg = await page.evaluate(() => window.__gapp.audioPlayer.diagnostics());
  const st = await page.evaluate(() => ({ t: window.__gapp.audioPlayer.getInfo().timeSec, rate: window.__gapp.audioEl.playbackRate }));
  const C3 = await clickMedia();
  const laps = dg.seeks;
  rec('R8 loop at 60%: the rate holds after the turns, still inside the section, short silence', Math.abs(st.rate - 0.6) < 1e-9 && st.t >= L[0] - 0.3 && st.t <= L[1] && dg.maxGapMs <= 150 && laps >= 2, `rate ${st.rate}, ${laps} jumps, max silence ${dg.maxGapMs} ms, section ${secLoop + 1}`);
  const firstBeat = T.beats.find((t) => t >= L[0] - 1e-6);
  const afterWrap = C3.filter((c, i) => i > 0 && c.t < C3[i - 1].t - 1).map((c) => c.t - firstBeat);
  info('R9', `loop laps seen in the clicks: ${afterWrap.length}; first click of a lap minus first beat of the section: ${afterWrap.map((x) => (x * 1000).toFixed(0)).join(', ')} ms`);
  rec('R9 the first click of every lap is on the first beat of the section (within 100 ms)', afterWrap.length >= 1 && afterWrap.every((x) => Math.abs(x) < 0.1), JSON.stringify(afterWrap.map((x) => Math.round(x * 1000))));
  rec('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
