// Round 12 tester, A: every kind of jump in the real app (Pixel 7 profile, Chromium), with my own capture of the sound the audio element
// really plays. A ScriptProcessor is tapped onto the element's MediaElementSource (the app creates it when the metronome is on), so the
// captured samples are exactly the element's output, without the clicks. Raw output goes to test-artifacts/round-12/tester/<build>/ and is
// analysed by round12-tester-seek-analyse.py (the true file position of every captured window is found by correlation with an ffmpeg
// decode, the true attacks come from my own spectral analysis of round 11): nothing of the app's own clocks is trusted.
// Also: highlight changes (MutationObserver on the sheet/panel), metronome oscillator start times, the player's claimed position every 50 ms.
// Run: node scripts/build.mjs && node test/e2e/round12-tester-seek.cjs [new|old] [modes] [oldDist]
//   modes: base,section,chord,listen,pause,rate,scrub,loop,mem (default all);  old = dist/index.html of a build before round 12 (git worktree of ca01341^).
// Prints only counts and times.  Raw files contain audio of the copyrighted fixture: test-artifacts/ is gitignored, never commit them.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = process.argv[2] || 'new';
const MODES = (process.argv[3] || 'base,section,chord,listen,pause,rate,scrub,loop,mem').split(',');
const DIST = BUILD === 'old' ? (process.argv[4] || path.join(ROOT, 'test-artifacts', 'round-12', 'tester', 'old-index.html')) : path.join(ROOT, 'dist', 'index.html');
const URL = 'file://' + DIST;
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = process.env.R12_MP3 || path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-12', 'tester', process.env.R12_OUT || BUILD);
const SONG_JSON = process.env.R12_SONG || null; // a synthetic song (library JSON) instead of the real sheet; R12_MP3 is then its audio (any format)
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = devices['Pixel 7'];
const POS = (process.env.R12_POS || '30,63,150,300,450').split(',').map(Number);
const SECTION_STARTS = [0, 63.4, 144.8, 297.9, 458.9]; // used only to pick the nearest section for "play from a section"
const rssMb = () => { try { return Math.round(execSync("ps -eo rss,args | grep -i 'chrom' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim() / 1024); } catch { return -1; } };

(async () => {
  if (!fs.existsSync(MP3)) { console.log('mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctxB = await browser.newContext(PROFILE);
  const page = await ctxB.newPage(); globalThis.__page = page;
  const cdp = await ctxB.newCDPSession(page);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('crash', () => console.log('PAGE CRASH')); page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    const S = window.__r12 = { on: false, chunks: [], hl: [], clk: [], claim: [], act: [], urls: { c: 0, r: 0 }, sr: 0 };
    const mk = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (el) {
      const n = mk.call(this, el); window.__ctx = this; S.sr = this.sampleRate;
      const p = this.createScriptProcessor(2048, 1, 1); const g = this.createGain(); g.gain.value = 0;
      n.connect(p); p.connect(g); g.connect(this.destination);
      p.onaudioprocess = (e) => { if (S.on) S.chunks.push([e.playbackTime, new Float32Array(e.inputBuffer.getChannelData(0))]); };
      S.keep = [p, g]; return n;
    };
    const oo = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { const o = oo.call(this); const st = o.start.bind(o); const c = this; o.start = (w) => { if (S.on) S.clk.push([w, o.frequency.value, c.currentTime]); return st(w); }; return o; };
    const cu = URL.createObjectURL.bind(URL), ru = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { S.urls.c++; return cu(b); }; URL.revokeObjectURL = (u) => { S.urls.r++; return ru(u); };
    const cur = () => (window.__ctx ? window.__ctx.currentTime : null);
    document.addEventListener('click', () => { if (S.on) S.act.push([cur(), performance.now()]); }, true);
    window.addEventListener('DOMContentLoaded', () => {
      let last = '';
      new MutationObserver(() => {
        if (!S.on) return;
        const c = document.querySelector('.ch.cur'); const pc = document.getElementById('pp-current');
        const key = (c ? c.getAttribute('data-ref') : '-') + '|' + (pc ? pc.textContent : '');
        if (key !== last) { last = key; S.hl.push([cur(), performance.now(), window.__gapp ? window.__gapp.player.eventIndex : null, key]); }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    });
    setInterval(() => {
      if (!S.on) return;
      const g = window.__gapp; const ap = g && g.audioPlayer; const sp = window.__gappSync && window.__gappSync.player;
      const m = sp ? (sp.mediaTime ? sp.mediaTime() : sp.element.currentTime) : (ap && ap.mediaTime ? ap.mediaTime() : (g && g.audioEl ? g.audioEl.currentTime : null));
      S.claim.push([cur(), performance.now(), m, g ? g.player.timeSec : null, g ? g.player.state : null]);
    }, 50);
  });
  await page.goto(URL);
  const longPress = async (sel, ms = 700) => {
    const loc = page.locator(sel).first(); await loc.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(500);
    const b = await loc.boundingBox(); const x = b.x + 12, y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  };
  const t0 = Date.now();
  if (SONG_JSON) {
    await page.setInputFiles('#import-json', SONG_JSON);
    await page.waitForSelector('.dlg', { timeout: 3000 }).catch(() => {});
    const nb = await page.$('.dlg [data-value="newer"]'); if (nb) await nb.click();
    await page.waitForSelector('.song-row'); await page.click('.song-row'); await page.waitForSelector('#btn-sync');
  } else { await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 }); }
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); const tS = Date.now(); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 300000 });
  console.log(`sync analysis ${((Date.now() - tS) / 1000).toFixed(1)} s`);
  // ---- scrub bar (sync screen), before leaving it ----
  const rec = async (name, prep, action, secs, extra = {}) => {
    if (prep) await prep();
    await page.evaluate(() => { const S = window.__r12; S.chunks = []; S.hl = []; S.clk = []; S.claim = []; S.act = []; S.on = true; S.t0 = [window.__ctx ? window.__ctx.currentTime : null, performance.now()]; });
    await action();
    if (!extra.type || (extra.type !== 'scrub')) {
      const ok = await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 4000 }).then(() => true).catch(() => false);
      if (!ok && !extra.retried) { console.log(`  ${name}: not playing after the action, retry`); await page.evaluate(() => { window.__r12.on = false; }); return rec(name, prep, action, secs, { ...extra, retried: true }); }
    }
    await sleep(secs * 1000);
    const pack = await page.evaluate(() => {
      const S = window.__r12; S.on = false;
      const n = S.chunks.reduce((a, c) => a + c[1].length, 0); const buf = new Int16Array(n); let o = 0; const table = [];
      for (const [pt, d] of S.chunks) { table.push([pt, o, d.length]); for (let i = 0; i < d.length; i++) buf[o + i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767))); o += d.length; }
      let bin = ''; const u8 = new Uint8Array(buf.buffer); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { sr: S.sr, table, pcm: btoa(bin), hl: S.hl, clk: S.clk, claim: S.claim, act: S.act, t0: S.t0 };
    });
    const pcm = Buffer.from(pack.pcm, 'base64'); delete pack.pcm;
    fs.writeFileSync(path.join(OUT, `${name}.pcm`), pcm);
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, ...extra, ...pack }));
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] run ${name}: ${(pcm.length / 2 / pack.sr).toFixed(1)} s audio, ${pack.hl.length} highlight changes, ${pack.clk.length} clicks, ${pack.act.length} taps`);
  };
  if (MODES.includes('scrub')) {
    await page.evaluate(() => { window.__gappSync.player.setMetronome(true); });
    await page.evaluate(() => { const S = window.__r12; S.on = false; });
    for (const P of POS) {
      await rec(`scrub-${P}`, async () => { const st = await page.evaluate(() => window.__gappSync.player.getState()); if (st === 'playing') await page.locator('#sync-play').tap(); await sleep(300); },
        async () => {
          await page.evaluate((v) => { const s = document.getElementById('sync-scrub'); s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); window.__r12.act.push([window.__ctx ? window.__ctx.currentTime : null, performance.now()]); }, P);
          await sleep(300); await page.locator('#sync-play').tap();
        }, 9, { type: 'scrub', target: P });
      await page.evaluate(() => { const p = window.__gappSync.player; if (p.getState() === 'playing') p.pause(); });
    }
  }
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
  const T = await page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.beats, e.sectionIndex, e.ref, e.skipped ? 1 : 0]), beats: window.__gapp.timeline.beats.map((b) => [b.timeSec, b.isDownbeat ? 1 : 0, b.eventIndex, b.sectionIndex]), sec: window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm, s.skipped ? 1 : 0]) }));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(T));
  const dur = await page.evaluate(async () => { const ap = window.__gapp.audioPlayer; if (ap) { await ap.ready(); return ap.duration(); } return window.__gapp.audioEl.duration; });
  console.log('events', T.ev.length, 'sections', T.sec.length, 'duration', dur.toFixed(1));
  if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.click('#btn-click-icon');
  // repeated sections are collapsed in the sheet: open them all (a user taps the group), so that every chord and header can be tapped
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  const isPlaying = () => page.evaluate(() => window.__gapp.player.state === 'playing');
  const jsClick = (id) => page.evaluate((i) => { const e = document.getElementById(i); if (e) e.click(); }, id);
  const ensureStopped = async () => { await jsClick('btn-stop'); await sleep(900); };
  const ensurePlaying = async () => { if (!(await isPlaying())) { await page.locator('#btn-play').tap(); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 8000 }); } };
  const visibleEvent = async (p) => {
    const idxs = T.ev.map((e, i) => (e[0] >= p && !e[5] ? i : -1)).filter((i) => i >= 0).slice(0, 12);
    for (const i of idxs) { const ok = await page.evaluate((r) => { const el = document.querySelector(`.ch[data-ref="${r}"]`); return !!(el && el.getClientRects().length); }, T.ev[i][4]); if (ok) return i; }
    return idxs[0];
  };
  const visSec = async (S, minLen = 0) => {
    const vis = await page.evaluate(() => Array.from(document.querySelectorAll('.sec-head[data-sec]')).filter((h) => h.getClientRects().length).map((h) => Number(h.getAttribute('data-sec'))));
    const c = T.sec.map((x, i) => i).filter((i) => vis.includes(i) && !T.sec[i][3] && T.sec[i][1] - T.sec[i][0] >= minLen);
    return c.reduce((b, i) => (Math.abs(T.sec[i][0] - S) < Math.abs(T.sec[b][0] - S) ? i : b), c[0]);
  };
  const tapChord = async (j) => { const loc = page.locator(`.ch[data-ref="${T.ev[j][4]}"]`).first(); await loc.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(300); await loc.tap(); };

  // ---- base: Play from the start (stopped), twice ----
  if (MODES.includes('base')) {
    for (const k of [1, 2]) await rec(`base-${k}`, ensureStopped, async () => { await page.locator('#btn-play').tap(); }, 12, { type: 'base', target: 0 });
    await ensureStopped();
  }
  // ---- play from a section (long press on the header: loop on) ----
  if (MODES.includes('section')) {
    for (const S of SECTION_STARTS) {
      const si = await visSec(S, 11);
      await rec(`section-${Math.round(T.sec[si][0])}`, ensureStopped, async () => { await longPress(`.sec-head[data-sec="${si}"]`, 700); }, 11, { type: 'section', target: T.sec[si][0], si });
      await ensureStopped();
    }
  }
  // ---- tap on a chord while playing ----
  if (MODES.includes('chord')) {
    for (const P of POS) {
      const j = await visibleEvent(P);
      await rec(`chord-${P}`, async () => { await ensureStopped(); await ensurePlaying(); await sleep(1500); }, async () => { await tapChord(j); }, 11, { type: 'chord', target: T.ev[j][0], ev: j });
    }
    await ensureStopped();
  }
  // ---- "Ascolta da qui" from the nudge sheet ----
  if (MODES.includes('listen')) {
    for (const P of POS) {
      const j = await visibleEvent(P);
      await ensureStopped();
      await longPress(`.ch[data-ref="${T.ev[j][4]}"]`, 700);
      const open = await page.locator('#nudge-listen').count();
      if (!open) { console.log('listen: sheet did not open at', P); continue; }
      await rec(`listen-${P}`, null, async () => { await page.locator('#nudge-listen').tap(); }, 7, { type: 'listen', target: T.ev[j][0] - 2, ev: j });
      await page.locator('#nudge-close').tap().catch(() => {}); await sleep(300);
      await ensureStopped();
    }
  }
  // ---- pause and resume ----
  if (MODES.includes('pause')) {
    for (const P of POS) {
      const j = await visibleEvent(P);
      await rec(`pause-${P}`, async () => { await ensureStopped(); await ensurePlaying(); await sleep(800); await tapChord(j); await sleep(3000); }, async () => { await page.locator('#btn-play').tap(); await sleep(1500); await page.locator('#btn-play').tap(); }, 11, { type: 'pause', target: T.ev[j][0], ev: j });
    }
    await ensureStopped();
  }
  // ---- 80% speed ----
  if (MODES.includes('rate')) {
    await ensureStopped();
    for (let i = 0; i < 4; i++) await jsClick('btn-speed-down');
    console.log('speed', await page.textContent('#pp-speed'));
    for (const k of [1, 2]) await rec(`base80-${k}`, ensureStopped, async () => { await page.locator('#btn-play').tap(); }, 14, { type: 'base', target: 0, rate: 0.8 });
    await ensureStopped();
    for (const P of POS) {
      const j = await visibleEvent(P);
      await rec(`rate-${P}`, async () => { await ensureStopped(); await ensurePlaying(); await sleep(1500); }, async () => { await tapChord(j); }, 13, { type: 'rate', target: T.ev[j][0], ev: j, rate: 0.8 });
    }
    await ensureStopped();
    for (let i = 0; i < 4; i++) await jsClick('btn-speed-up');
    console.log('speed back', await page.textContent('#pp-speed'));
  }
  // ---- loop, 3 laps of a short section (early: 144.8-164.0, late: 297.9-317.2) ----
  if (MODES.includes('loop')) {
    for (const S of [144.8, 297.9]) {
      const si = await visSec(S, 5);
      const len = T.sec[si][1] - T.sec[si][0];
      await rec(`loop-${Math.round(T.sec[si][0])}`, ensureStopped, async () => { await longPress(`.sec-head[data-sec="${si}"]`, 700); }, len * 3 + 2, { type: 'loop', target: T.sec[si][0], si, start: T.sec[si][0], end: T.sec[si][1] });
      await ensureStopped();
    }
  }
  // ---- memory after 30 jumps ----
  if (MODES.includes('mem')) {
    await ensureStopped(); await ensurePlaying(); await sleep(2000);
    const before = { rss: rssMb(), urls: await page.evaluate(() => ({ ...window.__r12.urls })), heap: (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 };
    const jumps = [];
    for (let k = 0; k < 30; k++) {
      const p = 20 + ((k * 137) % 460);
      const j = await visibleEvent(p);
      const tt = Date.now();
      try { await tapChord(j); } catch (e) { jumps.push(['fail', String(e).slice(0, 60)]); continue; }
      await sleep(1500);
      jumps.push([Math.round(T.ev[j][0]), Date.now() - tt]);
    }
    const mid = { rss: rssMb(), urls: await page.evaluate(() => ({ ...window.__r12.urls })), heap: (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 };
    await sleep(13000);
    const after = { rss: rssMb(), urls: await page.evaluate(() => ({ ...window.__r12.urls })), heap: (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 };
    const st = await page.evaluate(() => window.__gapp.player.state);
    const dg = await page.evaluate(() => (window.__gapp.audioPlayer ? window.__gapp.audioPlayer.diagnostics() : null));
    fs.writeFileSync(path.join(OUT, 'mem.json'), JSON.stringify({ before, mid, after, state: st, jumps, diag: dg && { seeks: dg.seeks, maxSeekMs: dg.maxSeekMs, maxGapMs: dg.maxGapMs, lastGapMs: dg.lastGapMs } }));
    console.log('mem', JSON.stringify({ before, mid, after, state: st, diag: dg && { seeks: dg.seeks, maxSeekMs: dg.maxSeekMs, maxGapMs: dg.maxGapMs } }));
    await ensureStopped();
  }
  console.log(`errors ${errors.length} ${errors.join('|').slice(0, 200)}; done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await browser.close();
})().catch(async (e) => { console.log('FAILED', String(e).slice(0, 400)); try { await globalThis.__page.screenshot({ path: path.join(OUT, 'fail.png') }); console.log('url', globalThis.__page.url()); } catch {} process.exit(1); });
