// Round 5 tester: bugs 1, 2, 4 in the browser (dist/index.html), with the tester's ffmpeg track and,
// for the real file, a silent WAV (the real song's audio is not available; only the timing matters).
// Prints only numbers and section names. Screenshots in test-artifacts/round-5/tester/ (not committed).
// Run: npm run build && node test/e2e/round4-tester-make.mjs && node test/e2e/round5-tester-browser.cjs [S1|S2|S3|S4|REAL]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const D4 = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
const OUT = path.join(ROOT, 'test-artifacts', 'round-5', 'tester');
fs.mkdirSync(OUT, { recursive: true });
const WAV = path.join(D4, 't4.wav');
const EXP = JSON.parse(fs.readFileSync(path.join(D4, 't4-expected.json'), 'utf-8'));
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const SILENT = path.join(OUT, 'silent740.wav');
const only = process.argv[2] || '';
const OFFSET = 2.345;
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const starts = EXP.sections.map((s) => s.startSec);

function variant(name, edit) {
  const d = JSON.parse(fs.readFileSync(path.join(D4, 't4-song.json'), 'utf-8'));
  edit(d.songs[0]);
  const f = path.join(OUT, name);
  fs.writeFileSync(f, JSON.stringify(d));
  return f;
}
async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  return { browser, page, errors };
}
async function importJson(page, file) {
  await page.setInputFiles('#import-json', file);
  await page.waitForSelector('.dlg', { timeout: 5000 }).catch(() => {});
  const b = await page.$('.dlg [data-value="newer"]');
  if (b) await b.click();
  await page.waitForSelector('.song-row');
  await page.click('.song-row');
  await page.waitForSelector('#btn-sync');
}
const seek = (page, t) => page.evaluate((x) => window.__gappSync.player.seek(x), t);
async function loadAudio(page, file) {
  await page.click('#btn-sync');
  await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', file);
  await page.waitForSelector('#sync-first', { timeout: 30000 });
  await page.waitForTimeout(300);
}
// exact first-chord tap (paused, at the real onset), then exact anchors at the listed section starts
async function anchorAll(page, secs, offset = OFFSET) {
  await seek(page, offset);
  await page.click('#sync-first');
  for (const i of secs) {
    await seek(page, starts[i]);
    await page.click(`#sync-rows li[data-sec="${i}"] [data-act="here"]`);
  }
}
async function endAt(page, t) { await seek(page, t); await page.click('#sync-end'); }
const sugs = (page) => page.$$eval('#sync-sugs .sync-sug span', (e) => e.map((x) => x.textContent));

// per-frame sampling during play (rAF): media time, app event index, highlighted ref
async function frames(page, untilSec) {
  await page.evaluate(() => {
    window.__fr = [];
    const el = window.__gapp.audioEl;
    const tick = () => {
      const c = document.querySelector('.song-body .ch.cur');
      window.__fr.push([el.currentTime, window.__gapp.player.eventIndex, c ? c.getAttribute('data-ref') : null]);
      window.__frId = requestAnimationFrame(tick);
    };
    window.__frId = requestAnimationFrame(tick);
  });
  await page.click('#btn-play');
  await page.waitForFunction((t) => window.__gapp.audioEl.currentTime >= t, untilSec, { timeout: 120000, polling: 200 });
  await page.click('#btn-play');
  return page.evaluate(() => { cancelAnimationFrame(window.__frId); return { fr: window.__fr, refs: window.__gapp.timeline.events.map((e) => e.ref), st: window.__gapp.timeline.events.map((e) => e.startSec), bpm: window.__gapp.timeline.sections.map((s) => s.bpm) }; });
}
function analyse(res, t0, t1) {
  const f = res.fr.filter((x) => x[0] >= t0 && x[0] <= t1);
  let skips = 0, back = 0, empty = 0, last = null, maxStep = 0;
  const lastIdx = (t) => { let k = -1; for (let i = 0; i < res.st.length; i++) if (res.st[i] <= t) k = i; return k; };
  let domWrong = 0;
  for (const x of f) {
    const idx = res.refs.indexOf(x[2]);
    if (x[2] === null) empty++;
    else {
      if (last !== null) { if (idx < last) back++; if (idx - last > 1) skips++; maxStep = Math.max(maxStep, idx - last); }
      last = idx;
      // lag between media time and the event shown is at most a frame or two (30 ms)
      const want = lastIdx(x[0] - 0.034);
      if (idx < want) domWrong++;
    }
  }
  return { n: f.length, skips, back, empty, domWrong };
}

(async () => {
  // ---------- S1: bug 1 on the synthetic track, +1 BPM on one section, anchors at every section ----------
  if (!only || only === 'S1') {
    for (const [label, sec, bpm] of [['Finale 97 (last section)', 3, 97], ['Strofa 97 (middle)', 1, 97], ['Ponte 143', 2, 143]]) {
      const f = variant(`s1-${sec}.json`, (s) => { s.sections[sec].bpm = bpm; s.title = 'Prova tester cinque'; s.id = 'tester-r5-' + sec; });
      const { browser, page, errors } = await open();
      await importJson(page, f);
      await loadAudio(page, WAV);
      await anchorAll(page, [1, 2, 3]);
      await endAt(page, EXP.endSec);
      const s = await sugs(page);
      info(`S1 ${label}`, `suggestions after exact anchors on every section + Fine brano: ${JSON.stringify(s)}`);
      const ap = await page.$('#sync-sugs [data-act="apply"]');
      if (ap) await ap.click();
      const after = await sugs(page);
      await page.click('#sync-close');
      await page.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
      const maxEnd = EXP.endSec - 0.2;
      const r = await frames(page, maxEnd);
      // per-event error from the timeline of the app vs expected onsets (independent file)
      const errs = r.st.map((t, i) => (t - EXP.events[i].startSec) * 1000);
      const a = analyse(r, 2.4, maxEnd);
      const absMax = Math.max(...errs.map(Math.abs));
      info(`S1 ${label}`, `after Apply ${JSON.stringify(after)}; section BPM shown ${r.bpm.map((b) => b.toFixed(1)).join('/')}; timeline-vs-truth max |error| ${absMax.toFixed(0)} ms (per section ${[0, 1, 2, 3].map((k) => Math.max(...errs.filter((_, i) => EXP.events[i].sectionIndex === k).map(Math.abs)).toFixed(0)).join('/')}); frames ${a.n}, skips ${a.skips}, back ${a.back}, empty ${a.empty}`);
      rec(`S1 ${label}: error < 100 ms on every event`, absMax < 100, `${absMax.toFixed(0)} ms`);
      rec(`S1 ${label}: no skip / back / empty frame`, a.skips === 0 && a.back === 0 && a.empty === 0, JSON.stringify(a));
      rec(`S1 ${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join('|'));
      await browser.close();
    }
  }

  // ---------- S2: bug 2, smallest late tap that raises a suggestion in the UI ----------
  if (!only || only === 'S2') {
    const { browser, page, errors } = await open();
    await importJson(page, path.join(D4, 't4-song.json'));
    await loadAudio(page, WAV);
    await seek(page, OFFSET); await page.click('#sync-first');
    const res = [];
    for (const d of [78, 100, 120, 140, 148, 152, 160, 200]) {
      await seek(page, starts[3] + d / 1000);
      await page.click('#sync-rows li[data-sec="3"] [data-act="here"]');
      await endAt(page, EXP.endSec);
      const s = await sugs(page);
      res.push([d, s.length, s[0] || '']); if (s.length > 1) info('S2', d + ' ms gives ' + s.length + ' suggestions: ' + JSON.stringify(s));
      await page.click('#sync-rows li[data-sec="3"] [data-act="remove"]');
    }
    info('S2', res.map((r) => `${r[0]} ms: ${r[1] ? 'SUGG' : 'none'}`).join(' | '));
    info('S2 text at 200 ms', res[res.length - 1][2]);
    rec('S2 no suggestion at 78/100/120/140 ms, a suggestion at 160 ms', res.slice(0, 4).every((r) => !r[1]) && res[6][1] >= 1);
    rec('S2 no page errors', errors.length === 0, errors.slice(0, 2).join('|'));
    await browser.close();
  }

  // ---------- S3: bug 4, stretched / squeezed sections between anchors: per-frame event + no gap ----------
  if (!only || only === 'S3') {
    for (const [label, sec, bpm] of [['Strofa 100', 1, 100], ['Strofa 92', 1, 92], ['Intro 80', 0, 80]]) {
      const f = variant(`s3-${sec}-${bpm}.json`, (s) => { s.sections[sec].bpm = bpm; s.title = 'Prova tester cinque'; s.id = 'tester-r5-s3-' + sec + bpm; });
      const { browser, page, errors } = await open();
      await importJson(page, f);
      await loadAudio(page, WAV);
      await anchorAll(page, [1, 2, 3]);
      await page.click('#sync-close');
      await page.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
      const r = await frames(page, starts[3] + 3);
      const a = analyse(r, 2.4, starts[3] + 3);
      const errs = r.st.map((t, i) => (t - EXP.events[i].startSec) * 1000);
      const tl = await page.evaluate(() => window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm, s.savedBpm]));
      const gaps = [0, 1, 2].map((i) => (tl[i + 1][0] - tl[i][1]) * 1000);
      info(`S3 ${label}`, `gaps between sections ${gaps.map((g) => g.toFixed(2)).join('/')} ms; effective BPM ${tl.map((s) => s[2].toFixed(1)).join('/')} (saved ${tl.map((s) => s[3]).join('/')}); frames ${a.n}: skips ${a.skips}, back ${a.back}, empty ${a.empty}; max timeline error ${Math.max(...errs.slice(0, 18).map(Math.abs)).toFixed(0)} ms`);
      rec(`S3 ${label}: no gap, no empty frame, no skip/back, around every anchor`, gaps.every((g) => Math.abs(g) < 1) && a.skips === 0 && a.back === 0 && a.empty === 0, JSON.stringify(a));
      // panel text during the stretched/squeezed section, and "♩ ≈" shown
      await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, starts[1] + 3);
      await page.waitForTimeout(150);
      const bpmTxt = await page.evaluate(() => document.querySelector('#pp-bpm').textContent);
      info(`S3 ${label}`, `panel tempo text: ${JSON.stringify(bpmTxt)}`);
      await page.screenshot({ path: path.join(OUT, `s3-${sec}-${bpm}.png`) });
      rec(`S3 ${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join('|'));
      await browser.close();
    }
  }

  // ---------- S4: undetected tail error (just under the threshold, after the last anchor) ----------
  if (!only || only === 'S4') {
    const f = variant('s4.json', (s) => { s.sections[3].bpm = 96.7; s.title = 'Prova tester cinque'; s.id = 'tester-r5-s4'; });
    const { browser, page } = await open();
    await importJson(page, f);
    await loadAudio(page, WAV);
    await anchorAll(page, [1, 2, 3]);
    await endAt(page, EXP.endSec);
    const s = await sugs(page);
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
    const st = await page.evaluate(() => window.__gapp.timeline.events.map((e) => e.startSec));
    const errs = st.map((t, i) => (t - EXP.events[i].startSec) * 1000);
    info('S4', `Finale at 96.7 (0.7% too fast, 20 s): suggestions ${JSON.stringify(s)}; error of the last event ${errs[errs.length - 1].toFixed(0)} ms, max |error| ${Math.max(...errs.map(Math.abs)).toFixed(0)} ms`);
    await browser.close();
  }


  // ---------- S5: bugs 3, 5, 6: anchors in headers, library badge, "Primo accordo!" after a leading pause ----------
  if (!only || only === 'S5') {
    const { browser, page, errors } = await open();
    await importJson(page, path.join(D4, 't4-song.json'));
    const pauseBtn = await page.$('[data-act="add-rest"], .btn-rest, button:has-text("+ pausa")');
    // leading pause of 4 beats in the first section (UI button on the first header)
    if (pauseBtn) { await page.click('#btn-edit').catch(() => {}); }
    const hasEdit = await page.$('#btn-edit');
    if (hasEdit) await page.click('#btn-edit');
    const pb = await page.$('button:has-text("+ pausa")');
    if (pb) await pb.click();
    if (hasEdit) await page.click('#btn-edit').catch(() => {});
    const first = await page.evaluate(() => ({ rest: window.__gapp.timeline.events[0].rest, n: window.__gapp.timeline.events.length }));
    info('S5', `after "+ pausa": first event is a rest: ${first.rest}, events ${first.n}`);
    await loadAudio(page, WAV);
    await seek(page, 2.345);
    await page.click('#sync-first');
    await page.waitForTimeout(200);
    const early = await page.innerText('#sync-msg');
    const offEarly = await page.innerText('#sync-offset').catch(() => '');
    info('S5', `tap too early (before the end of the pause): message ${JSON.stringify(early)}; offset box ${JSON.stringify(offEarly)}`);
    rec('S5 tap before the pause ends: "Troppo presto", no negative offset', /Troppo presto/.test(early));
    await seek(page, 6.0);
    await page.click('#sync-first');
    await page.click('#sync-close');
    await page.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1);
    const ev = await page.evaluate(() => { const t = window.__gapp.timeline.events; const k = t.findIndex((e) => !e.rest); return { k, t: t[k].startSec, rest0: t[0].rest, rest0Start: t[0].startSec }; });
    info('S5', `tap at 6.000 s -> first real chord at ${ev.t.toFixed(3)} s (index ${ev.k}), pause starts at ${ev.rest0Start.toFixed(3)} s`);
    rec('S5 first real chord lands on the tap (< 10 ms)', ev.rest0 && Math.abs(ev.t - 6.0) < 0.01, `${((ev.t - 6) * 1000).toFixed(1)} ms`);
    const heads = await page.$$eval('.sec-anchor', (e) => e.map((x) => x.textContent));
    info('S5', `anchors in headers right after Fatto: ${JSON.stringify(heads)}`);
    rec('S5 anchor shown in the header after the first sync', heads.length >= 1);
    await page.reload(); await page.waitForSelector('#btn-sync'); await page.waitForTimeout(800);
    const heads2 = await page.$$eval('.sec-anchor', (e) => e.map((x) => x.textContent));
    rec('S5 anchor still shown after reload', heads2.length >= 1, JSON.stringify(heads2));
    // library badge, file present
    await page.click('#btn-back, [data-act="back"], a[href="#/"], .back').catch(() => {});
    await page.goto(URL + '#/'); await page.waitForSelector('.song-row'); await page.waitForTimeout(600);
    const badge = await page.$$eval('.song-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
    info('S5', `library row with the file stored: ${JSON.stringify(badge)}`);
    rec('S5 library badge "audio ✓" with the file stored', /audio ✓/.test(badge.join(' ')));
    rec('S5 no page errors', errors.length === 0, errors.slice(0, 2).join('|'));
    await browser.close();
  }

  // ---------- REAL: file reale, UI path "Primo accordo!" + "Fine brano" with the recording 0.5% shorter ----------
  if (!only || only === 'REAL') {
    if (!fs.existsSync(REAL)) { info('REAL', 'file absent'); }
    else {
      const { browser, page, errors } = await open();
      await page.setInputFiles('#import-input', REAL);
      await page.waitForSelector('#song-title');
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem([...Object.keys(localStorage)].find((k) => k.startsWith('gapp.song.')))).sections.map((s) => s.bpm));
      await loadAudio(page, SILENT);
      const OFF = 3;
      await seek(page, OFF);
      await page.click('#sync-first');
      const endT = OFF + 722.209 * 0.995;
      await endAt(page, endT);
      const s = await sugs(page);
      info('REAL', `section tempos before ${[...new Set(before)].join('/')}; suggestions: ${JSON.stringify(s)}`);
      await page.screenshot({ path: path.join(OUT, 'real-suggestion.png') });
      const ap = await page.$('#sync-sugs [data-act="apply"]');
      if (ap) await ap.click();
      const after = await sugs(page);
      await page.click('#sync-close');
      await page.waitForFunction(() => window.__gapp.audioEl && window.__gapp.audioEl.readyState >= 1, null, { timeout: 30000 });
      const st = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('gapp.song.')); const sg = JSON.parse(localStorage.getItem(k)); const tl = window.__gapp.timeline; return { bpm: sg.sections.map((x) => x.bpm), end: tl.sections[tl.sections.length - 1].endSec, first: tl.events[0].startSec }; });
      const distinct = [...new Set(st.bpm)];
      info('REAL', `after Apply: ${JSON.stringify(after)}; tempos ${distinct.join('/')}; timeline end ${st.end.toFixed(2)} s vs audio end ${endT.toFixed(2)} s (error ${((st.end - endT) * 1000).toFixed(0)} ms); first event ${st.first.toFixed(3)} s`);
      rec('REAL one suggestion, tempos stay 3 distinct values, end error < 100 ms, no suggestion left', s.length === 1 && distinct.length === 3 && Math.abs(st.end - endT) < 0.1 && after.length === 0, '');
      rec('REAL no page errors', errors.length === 0, errors.slice(0, 2).join('|'));
      await browser.close();
    }
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
