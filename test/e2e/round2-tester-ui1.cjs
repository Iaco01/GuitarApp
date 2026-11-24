// Round 2 tester, browser part 1: A (round 1 fixes), C (precision), panel footprint.
// Run: npm run build && node test/e2e/round2-tester-ui1.cjs   Needs the git-ignored real file.
// Screenshots: test-artifacts/round-2/ (never committed). No song text is printed.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const profiles = { pixel7: devices['Pixel 7'], iphone13: devices['iPhone 13'], w360: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } };
const OSC_PATCH = () => {
  window.__osc = [];
  const AC = window.AudioContext;
  if (!AC) return;
  const orig = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () {
    const o = orig.call(this);
    const st = o.start.bind(o);
    o.start = (t) => { window.__osc.push({ when: t, freq: o.frequency.value, now: this.currentTime }); return st(t); };
    return o;
  };
};

function splitProbe() {
  let words = 0; let split = 0;
  for (const line of document.querySelectorAll('.song-body .line')) {
    if (line.getBoundingClientRect().width === 0) continue;
    const chars = [];
    const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { if (n.parentElement.closest('.ch')) continue; for (let i = 0; i < n.data.length; i++) chars.push([n, i]); }
    let cur = [];
    const flush = () => { if (!cur.length) return; words++; const tops = cur.map(([nd, i]) => { const r = document.createRange(); r.setStart(nd, i); r.setEnd(nd, i + 1); return r.getBoundingClientRect().top; }); if (Math.max(...tops) - Math.min(...tops) > 4) split++; cur = []; };
    for (const c of chars) { if (/\s/.test(c[0].data[c[1]])) flush(); else cur.push(c); }
    flush();
  }
  return { words, split, ox: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}
const readSong = () => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))); return s; };

async function openReal(prof, osc) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  if (osc) await page.addInitScript(OSC_PATCH);
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title');
  return { browser, page, errors };
}

(async () => {
  // ---------- A1 / A2 ----------
  for (const [name, prof] of Object.entries(profiles)) {
    const { browser, page, errors } = await openReal(prof, false);
    for (const [scale, clicks] of [[1.0, 0], [1.5, 5], [2.0, 10]]) {
      await page.evaluate(() => { document.querySelector('#btn-font-down'); });
      const cur = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).view.fontScale);
      const target = Math.round((1 + (clicks) * 0.1) * 10) / 10;
      let guard = 0;
      let now = cur;
      while (Math.abs(now - target) > 0.01 && guard++ < 20) { await page.click(now < target ? '#btn-font-up' : '#btn-font-down'); now = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).view.fontScale); }
      await page.evaluate(() => document.querySelectorAll('details.rep').forEach((d) => { d.open = true; }));
      const r = await page.evaluate(splitProbe);
      rec(`A1-split-words ${name}@${target}`, r.split === 0 && r.ox <= 0, JSON.stringify(r));
      if (name === 'w360' && target === 2.0) await page.screenshot({ path: path.join(OUT, 't-a1-w360-scale2.png') });
    }
    if (name === 'pixel7') {
      // A2: rendered text (labels removed) == lyric, all 137 lines, normal view
      await page.evaluate(() => document.querySelectorAll('details.rep').forEach((d) => { d.open = true; }));
      const r = await page.evaluate(() => {
        const song = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2])));
        let lines = 0; let exact = 0; let trimEq = 0; let bad = 0; const badIdx = [];
        for (const sec of document.querySelectorAll('.song-body .sec')) {
          const si = Number(sec.getAttribute('data-sec'));
          const els = [...sec.querySelectorAll('.line')];
          const data = song.sections[si].lines;
          if (els.length !== data.length) { bad++; continue; }
          els.forEach((el, li) => {
            const c = el.cloneNode(true); c.querySelectorAll('.ch').forEach((x) => x.remove());
            const t = c.textContent; const ly = data[li].lyric; lines++;
            if (t === ly) exact++; else if (t.trimEnd() === ly.trimEnd() && ly.trim() !== '') trimEq++; else if (ly === '' && t.trim() === '') trimEq++; else { bad++; if (badIdx.length < 5) badIdx.push(`${si}.${li}`); }
          });
        }
        return { lines, exact, trimEq, bad, badIdx };
      });
      rec('A2-rendered-text-equals-lyric', r.bad === 0 && r.lines >= 130, JSON.stringify(r));
      // normal view lines (the 3 collapsed sections are skipped as grouped): count total lines in model
      const total = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).sections.reduce((a, s) => a + s.lines.length, 0));
      info('A5-total-saved-lines', String(total));
      // A4: theme button
      const th = await page.evaluate(() => { const b = document.getElementById('btn-theme'); const r = b.getBoundingClientRect(); const svg = b.querySelector('svg'); const sr = svg && svg.getBoundingClientRect(); return { text: b.textContent.trim(), w: r.width, h: r.height, svgW: sr && sr.width, svgH: sr && sr.height }; });
      rec('A4-theme-icon', !!th.svgW && th.svgW >= 20 && th.text.length > 0, JSON.stringify(th));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, 't-a4-top.png') });
    }
    rec(`console-clean ${name}`, errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // ---------- A4: reimport dialog ----------
  {
    const { browser, page } = await openReal({ ...devices['Pixel 7'] }, false);
    // edit one duration to 6 through the UI, and a tempo by the section editor
    await page.click('#btn-edit');
    await page.locator('.ch[data-ref="0.0.0"]').click();
    for (let i = 0; i < 2; i++) await page.click('#eb-plus');
    await page.click('#btn-edit');
    await page.click('#btn-back');
    const idxLen = () => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.index.v1')).length);
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('.dlg');
    const labels = await page.locator('.dlg button').allTextContents();
    await page.screenshot({ path: path.join(OUT, 't-a4-dialog.png') });
    rec('A4-dialog-three-choices', labels.length === 3 && /ostituisci/i.test(labels.join('|')) && /entrambi/i.test(labels.join('|')) && /nnulla/i.test(labels.join('|')), labels.join(' / '));
    await page.click('.dlg [data-value="cancel"]').catch(async () => { await page.keyboard.press('Escape'); });
    await sleep(200);
    rec('A4-cancel-keeps-library', (await idxLen()) === 1 && (await page.locator('.dlg').count()) === 0, 'index ' + (await idxLen()));
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('.dlg');
    await page.keyboard.press('Escape'); await sleep(200);
    rec('A4-escape-is-cancel', (await idxLen()) === 1);
    const vals = ['replace', 'both', 'cancel'];
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('.dlg');
    await page.click('.dlg [data-value="replace"]');
    await page.waitForSelector('#song-title'); await sleep(300);
    const s = await page.evaluate(readSong);
    info('A4-replace-result', `index ${await idxLen()}, beats[0.0.0]=${s.sections[0].lines[0].chords[0].beats}, timingSource=${s.timingSource}, url=${s.source.url ? 'present, no _gl: ' + !/_gl=|utm_/.test(s.source.url) : 'absent'}`);
    rec('A4-replace-keeps-durations', s.sections[0].lines[0].chords[0].beats === 6 && s.timingSource === 'edited', '');
    rec('A4-replace-single-entry', (await idxLen()) === 1, 'index ' + (await idxLen()));
    await page.click('#btn-back');
    await page.setInputFiles('#import-input', REAL);
    await page.waitForSelector('.dlg');
    await page.click('.dlg [data-value="both"]');
    await page.waitForSelector('#song-title'); await sleep(300);
    rec('A4-keep-both', (await idxLen()) === 2, 'index ' + (await idxLen()));
    await browser.close();
  }

  // ---------- C1-C4 on the real file, Pixel 7 at 360 px ----------
  {
    const { browser, page, errors } = await openReal(profiles.w360, true);
    await page.evaluate(() => {
      window.__rec = [];
      const loop = () => { const g = window.__gapp; const c = document.querySelector('.ch.cur'); if (g) window.__rec.push({ t: performance.now(), p: g.player.timeSec, e: g.player.eventIndex, s: g.player.state, dom: c ? c.getAttribute('data-ref') : null }); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    const tl = await page.evaluate(() => ({ events: window.__gapp.timeline.events.map((e) => [e.startSec, e.ref, e.sectionIndex]), beats: window.__gapp.timeline.beats.map((b) => [b.timeSec, b.beatInBar, b.sectionIndex]), sections: window.__gapp.timeline.sections }));
    const START_EVENT = 30; // chord 30 of Verse 1: starts at ~116 s, boundary at 135.5 s
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__gapp.player.state === 'counting' || window.__gapp.player.state === 'playing');
    await sleep(300);
    await page.evaluate(() => { window.__osc.length = 0; window.__rec.length = 0; });
    const ref = tl.events[START_EVENT][1];
    await page.locator(`.ch[data-ref="${ref}"]`).first().scrollIntoViewIfNeeded();
    await page.locator(`.ch[data-ref="${ref}"]`).first().click();
    const wall0 = Date.now();
    await page.waitForFunction(() => window.__gapp.player.state === 'counting');
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 't-c-countin.png') });
    // play 75 s: crosses Verse 1 -> Chorus (135.5 s) and Chorus -> Verse 2 (175.5 s)
    await sleep(75000);
    const data = await page.evaluate(() => ({ rec: window.__rec, osc: window.__osc }));
    await page.screenshot({ path: path.join(OUT, 't-c-after75.png') });
    const rows = data.rec.filter((x) => x.s === 'playing');
    const spanSec = (rows[rows.length - 1].t - rows[0].t) / 1000;
    const startIdxOf = (sec) => { let lo = 0; let hi = tl.events.length - 1; let a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (tl.events[m][0] <= sec) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
    // C1: per change, error vs expected startSec in song time (frame-quantised) and in wall-clock
    const changes = [];
    for (let i = 1; i < rows.length; i++) if (rows[i].e !== rows[i - 1].e) changes.push({ e: rows[i].e, errSong: rows[i].p - tl.events[rows[i].e][0], wall: rows[i].t, frameGap: rows[i].t - rows[i - 1].t });
    const inc = changes.every((c, i) => i === 0 || c.e === changes[i - 1].e + 1);
    const errs = changes.map((c) => c.errSong * 1000);
    rec('C1-changes-in-order-no-skips', inc && changes.length >= 25, `${changes.length} changes, events ${changes[0].e}..${changes[changes.length - 1].e}`);
    rec('C1-change-error-within-1-frame', Math.min(...errs) >= -0.5 && Math.max(...errs) <= 20, `error vs startSec: mean ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1)} ms, max ${Math.max(...errs).toFixed(1)} ms, min ${Math.min(...errs).toFixed(1)} ms`);
    // wall-clock error using a linear fit anchored at the first change
    const c0 = changes[0];
    const wallErr = changes.map((c) => (c.wall - c0.wall) - (tl.events[c.e][0] - tl.events[c0.e][0]) * 1000);
    info('C1-wallclock-change-error', `vs perf.now, relative to first change: mean ${(wallErr.reduce((a, b) => a + b, 0) / wallErr.length).toFixed(1)} ms, max |err| ${Math.max(...wallErr.map(Math.abs)).toFixed(1)} ms over ${((changes[changes.length - 1].wall - c0.wall) / 1000).toFixed(1)} s`);
    // DOM highlight vs eventIndex: how many frames the DOM .cur element disagrees with timeSec
    const domMis = rows.filter((x) => x.dom !== tl.events[x.e][1]).length;
    info('C1-dom-highlight-vs-eventIndex', `${domMis} of ${rows.length} frames differ (frame ordering: DOM updated by the app's own rAF)`);
    // boundaries crossed
    const crossed = [1, 2].map((si) => changes.some((c) => c.e === tl.events.findIndex((e) => e[2] === si))).join(',');
    rec('C1-crossed-section-boundaries', crossed === 'true,true', `Verse1->Chorus and Chorus->Verse2 crossed: ${crossed}`);
    // C2: drift on the audio clock vs performance.now
    const last = rows[rows.length - 1]; const first = rows[0];
    const drift = (last.p - first.p) - (last.t - first.t) / 1000;
    rec('C2-clock-drift-60s', Math.abs(drift) < 0.05, `timeSec advanced ${(last.p - first.p).toFixed(3)} s vs wall ${((last.t - first.t) / 1000).toFixed(3)} s: drift ${(drift * 1000).toFixed(1)} ms over ${spanSec.toFixed(1)} s`);
    // C2: oscillator start() times vs grid
    const osc = data.osc;
    const cnt = osc.slice(0, 4);
    const grid = osc.slice(4);
    const sb = tl.events[START_EVENT][0];
    const firstBeat = tl.beats.findIndex((b) => b[0] >= sb - 1e-9);
    const t0 = grid[0].when;
    let maxGrid = 0; let miss = 0; let nGrid = 0;
    for (let k = 0; k < grid.length; k++) {
      const b = tl.beats[firstBeat + k];
      if (!b) break;
      const exp = t0 + (b[0] - tl.beats[firstBeat][0]);
      maxGrid = Math.max(maxGrid, Math.abs(grid[k].when - exp)); nGrid++;
      const wantAccent = b[1] === 0;
      if ((grid[k].freq === 1000) !== wantAccent) miss++;
    }
    rec('C2-click-times-on-grid', maxGrid < 1e-6 && miss === 0 && nGrid > 100, `${nGrid} clicks, max deviation ${(maxGrid * 1e6).toFixed(3)} us, accent mismatches ${miss}`);
    // C3: count-in
    const cgaps = cnt.slice(1).map((o, i) => o.when - cnt[i].when);
    const spbStart = 60 / tl.sections[0].bpm;
    rec('C3-count-in-one-bar', cnt.length === 4 && cnt[0].freq === 1000 && cnt.slice(1).every((o) => o.freq === 800) && cgaps.every((g) => Math.abs(g - spbStart) < 1e-6) && Math.abs(grid[0].when - cnt[3].when - spbStart) < 1e-6, `4 clicks, gaps ${cgaps.map((g) => g.toFixed(4))}, accent first only; first beat ${(grid[0].when - cnt[3].when).toFixed(4)} s after the last count click (spb ${spbStart.toFixed(4)})`);
    // C4: interval change at the section boundary in real clicks
    const bidx = tl.sections[1].startBeat - firstBeat;
    const dBefore = grid[bidx].when - grid[bidx - 1].when; const dAfter = grid[bidx + 1].when - grid[bidx].when;
    rec('C4-click-interval-changes-at-boundary', Math.abs(dBefore - 60 / 62) < 1e-6 && Math.abs(dAfter - 60 / 96) < 1e-6, `last verse gap ${dBefore.toFixed(4)} (62 bpm), first chorus gap ${dAfter.toFixed(4)} (96 bpm)`);
    // frame time
    const dts = []; for (let i = 1; i < rows.length; i++) dts.push(rows[i].t - rows[i - 1].t);
    const sorted = dts.slice().sort((a, b) => a - b);
    info('D7-frame-time', `mean ${(dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(2)} ms, p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms, frames over 34 ms: ${dts.filter((d) => d > 34).length} of ${dts.length}`);
    rec('console-clean-play', errors.length === 0, errors.join(' | '));
    await browser.close();
  }
  console.log(fails ? fails + ' FAILURES' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
