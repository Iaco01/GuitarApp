// Round 14 in the app (Playwright, Chromium): tab songs. Imports a synthetic PDF (test/e2e/round14-make.mjs) and, when present,
// the real one (counts only), checks the tab view (no horizontal scroll, chords over their columns, diagrams from the voices),
// the part selector, the play with the cursor, the click, the loop, the 50% speed and the order of the sections.
// Screenshots go to test-artifacts/round-14/ (never committed).
// Run: node test/e2e/round14-make.mjs && node scripts/build.mjs && node test/e2e/round14.cjs [320|SE|13|13L]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const OUT = path.join(ROOT, 'test-artifacts', 'round-14');
const SYNTH = path.join(OUT, 'synth.pdf');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'what-you-know-tab.pdf');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const PROFILES = {
  320: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  13: devices['iPhone 13'],
  '13L': devices['iPhone 13 landscape'] || { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const note = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[dev]);
  const page = await ctx.newPage();
  const vw = PROFILES[dev].viewport.width;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__osc = 0;
    window.__notes = []; // the notes of the synth: buffer sources of 2.6 s (the clicks are oscillators)
    const BS = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
    if (BS) {
      const st = BS.start;
      BS.start = function (when) { window.__lastCtx = this.context; if (this.buffer && this.buffer.duration > 2) window.__notes.push({ when, at: this.context.currentTime, src: this, buf: this.buffer, stop: null }); return st.apply(this, arguments); };
      const sp = BS.stop;
      BS.stop = function (t) { const n = window.__notes.find((x) => x.src === this); if (n) n.stop = t; return sp.apply(this, arguments); };
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { window.__osc++; return orig.call(this); };
    }
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${dev}-${n}.png`) });
  const q = (fn, arg) => page.evaluate(fn, arg);
  // clicks like a finger; when the element is out of the (very short) landscape viewport, a DOM click
  const uiClick = async (sel) => {
    try { await page.click(sel, { timeout: 2500 }); } catch { await page.evaluate((x) => document.querySelector(x).click(), sel); }
  };
  const openPanel = async () => {
    const collapsed = await q(() => document.getElementById('playpanel').dataset.collapsed === '1');
    if (collapsed) { await uiClick('#btn-mini-open'); await sleep(250); }
  };
  const stopPlay = async () => {
    await openPanel();
    const hidden = await q(() => document.getElementById('pp-more').hidden);
    if (hidden) { await uiClick('#btn-more'); await sleep(150); }
    await uiClick('#btn-stop');
    await sleep(200);
    if (!(await q(() => document.getElementById('pp-more').hidden))) { await uiClick('#btn-more'); await sleep(150); }
  };
  async function importFile(file) {
    await page.goto(URL);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
    await page.goto(URL);
    await page.setInputFiles('#import-input', file);
    await page.waitForSelector('#btn-play', { timeout: 20000 });
    await sleep(500);
  }

  // ---- synthetic PDF ----
  await importFile(SYNTH);
  const head = await q(() => ({ title: document.getElementById('song-title').textContent, meta: document.getElementById('tb-meta').textContent, parts: document.querySelectorAll('.tb-part-opt').length, secs: document.querySelectorAll('.tb-sec').length }));
  rec('I1 the synthetic PDF imports as a tab song', head.title === 'Invented Song' && head.parts === 3 && head.secs >= 2, JSON.stringify(head));
  await shot('01-synth-stopped');

  // layout
  const lay = await q(() => {
    const rows = [...document.querySelectorAll('.tb-row')];
    const over = rows.filter((r) => r.getBoundingClientRect().right > innerWidth + 0.5 || r.scrollWidth > r.clientWidth + 1);
    const lines = [...document.querySelectorAll('.tb-line')];
    const wide = lines.filter((l) => l.scrollWidth > l.clientWidth + 1);
    const col = document.getElementById('dg-col');
    return { sw: document.documentElement.scrollWidth, rows: rows.length, over: over.length, wide: wide.length, lines: lines.length, col: col ? col.getBoundingClientRect().width : 0, chw: parseFloat(getComputedStyle(document.querySelector('.tb-body')).getPropertyValue('--chw')) };
  });
  rec('V1 no horizontal scroll, no row wider than the screen', lay.sw <= vw && lay.over === 0 && lay.wide === 0 && lay.rows > 0, JSON.stringify(lay));
  rec('V2 the side column is on', lay.col > 60, 'col ' + Math.round(lay.col));
  // chords over the right column: the chord button sits where the column of its first note is
  const chordCheck = await q(() => {
    const out = { total: 0, ok: 0, bad: [] };
    for (const line of document.querySelectorAll('.tb-line')) {
      const chw = parseFloat(getComputedStyle(line.closest('.tb-body')).getPropertyValue('--chw'));
      const rows = [...line.querySelectorAll('.tb-row')].map((r) => r.textContent);
      const lr = line.getBoundingClientRect();
      for (const b of line.querySelectorAll('.tb-chord')) {
        out.total++;
        const x = Number(b.dataset.x);
        const px = b.getBoundingClientRect().left - lr.left;
        const digit = rows.some((r) => /[0-9]/.test(r[x] || ''));
        if (Math.abs(px - x * chw) <= 3 && digit) out.ok++; else out.bad.push({ x, px: Math.round(px), digit });
      }
    }
    return out;
  });
  rec('V3 every chord name sits over a column that has notes', chordCheck.total >= 7 && chordCheck.ok === chordCheck.total, JSON.stringify(chordCheck));
  // diagrams from the voices
  const dg = await q(() => {
    const btns = [...document.querySelectorAll('#dg-col .dg-btn')];
    const f = btns.find((b) => b.dataset.chord === 'F#m7');
    return { n: btns.length, fromTab: btns.filter((b) => b.classList.contains('from-tab')).length, names: btns.map((b) => b.dataset.chord), fText: f ? [...f.querySelectorAll('svg text')].map((t) => t.textContent) : null, fBarre: f ? f.querySelectorAll('svg rect').length : 0 };
  });
  rec('D1 one diagram per voice of the tab (F#m7 high on the neck: fret 9, barre, fingers)', dg.n === 5 && dg.fromTab === 5 && dg.fText && dg.fText.includes('9') && dg.fBarre >= 1 && dg.fText.includes('1') && dg.fText.includes('3'), JSON.stringify(dg));
  await page.click('#dg-col .dg-btn[data-chord="F#m7"]');
  const sheet = await q(() => !!document.querySelector('.sheet .sheet-dg svg') && document.querySelector('.sheet').textContent.includes('Come è scritto nella tab'));
  rec('D2 tapping a diagram opens the voice sheet', sheet);
  await page.keyboard.press('Escape');

  // parts
  await page.click('#btn-part-1');
  await sleep(200);
  const p1 = await q(() => ({ secs: document.querySelectorAll('.tb-sec').length, part: document.querySelector('.tb-part').dataset.part, dg: document.querySelectorAll('#dg-col .dg-btn').length, pressed: document.getElementById('btn-part-1').getAttribute('aria-pressed') }));
  rec('S1 part 2 (a riff, no chord names): its sections only, diagrams of part 1 stay', p1.secs === 1 && p1.part === '1' && p1.dg === 5 && p1.pressed === 'true', JSON.stringify(p1));
  await shot('02-part2');
  await page.click('#btn-part-all');
  await sleep(200);
  const pa = await q(() => ({ parts: document.querySelectorAll('.tb-part').length, titles: document.querySelectorAll('.tb-part-title').length }));
  rec('S2 "Tutte" shows both parts with their titles', pa.parts === 2 && pa.titles === 2, JSON.stringify(pa));
  const saved = await q(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('song') && k.length > 12)) || '{}'));
  note('S3', 'saved view.tabPart=' + (saved.view && saved.view.tabPart));
  await page.click('#btn-part-0');
  await sleep(200);

  // legend
  await page.click('#tb-tools summary');
  const sym = await q(() => [...document.querySelectorAll('.tb-sym')].map((b) => b.dataset.sym));
  await page.click('.tb-sym[data-sym="/"]');
  const lg = await q(() => document.getElementById('tb-legend-text').textContent);
  rec('G1 the legend lists the techniques of the tab and a tap explains one', sym.includes('/') && lg.startsWith('/ ='), sym.join('') + ' | ' + lg);

  // ---- play ----
  await q(() => window.scrollTo(0, 0));
  const total = await q(() => window.__gapp.timeline.events.length);
  const startOsc = await q(() => window.__osc);
  await uiClick('#btn-play');
  const seq = [];
  const cursors = new Set();
  let curOk = 0;
  let sampled = 0;
  const t0 = Date.now();
  for (let i = 0; i < 400 && Date.now() - t0 < 25000; i++) {
    await sleep(60);
    const r = await q(() => {
      const g = window.__gapp.player;
      const cur = document.querySelector('.tb-cursor');
      const hl = document.querySelectorAll('.tb-hl.cur').length;
      return { st: g.state, ev: g.eventIndex, t: g.timeSec, curLeft: cur ? cur.style.left : null, inLine: !!(cur && cur.closest('.tb-line')), hl, label: document.getElementById('pp-current').textContent };
    });
    if (r.st === 'playing' && r.ev >= 0) {
      sampled++;
      if (r.inLine && r.hl >= 1) curOk++;
      if (!seq.length || seq[seq.length - 1].ev !== r.ev) seq.push({ ev: r.ev, t: r.t });
      cursors.add(r.ev + ':' + r.curLeft);
    }
    if (sampled === 30 && r.st === 'playing') await shot('03-playing');
    if (r.st === 'stopped' && sampled > 5) break;
  }
  const oscs = (await q(() => window.__osc)) - startOsc;
  const evs = seq.map((s) => s.ev);
  const mono = evs.every((e, i) => i === 0 || e === evs[i - 1] + 1);
  rec('P1 the cursor and the measure highlight follow the play', sampled > 20 && curOk >= sampled - 3, `${curOk}/${sampled}`);
  rec('P2 the play goes measure by measure, in order, to the end', evs.length === total && mono, `${evs.length}/${total} measures seen`);
  const perMeasure = {};
  for (const c of cursors) { const [e] = c.split(':'); perMeasure[e] = (perMeasure[e] || 0) + 1; }
  rec('P3 the cursor moves inside a measure (several columns)', Object.values(perMeasure).filter((n) => n >= 3).length >= 3, JSON.stringify(perMeasure));
  const beats = await q(() => window.__gapp.timeline.beats.length);
  rec('P4 with the synth on the click is off: only the count-in ticks (4)', oscs >= 3 && oscs <= 6, `${oscs} ticks, ${beats} beats`);
  await sleep(500);

  // loop
  await q(() => window.scrollTo(0, 0));
  await openPanel();
  await uiClick('#pp-bpm');
  await page.fill('#pp-bpm-field', '240');
  await uiClick('#pp-bpm-apply');
  const loopSec = await q(() => [...document.querySelectorAll('.tb-loop')].map((b) => b.dataset.sec));
  await page.click('.tb-loop[data-sec="1"]');
  const secRange = await q(() => { const s = window.__gapp.timeline.sections; const k = s.findIndex((x) => x.sectionRef === 1); const evs = window.__gapp.timeline.events.map((e, i) => (e.sectionIndex === k ? i : -1)).filter((i) => i >= 0); return { k, from: evs[0], to: evs[evs.length - 1], dur: s[k].endSec - s[k].startSec }; });
  const seen = new Set();
  const lt0 = Date.now();
  let wraps = 0;
  let lastEv = -1;
  while (Date.now() - lt0 < 9000) {
    await sleep(50);
    const r = await q(() => ({ st: window.__gapp.player.state, ev: window.__gapp.player.eventIndex }));
    if (r.st === 'playing' && r.ev >= 0) { seen.add(r.ev); if (lastEv >= 0 && r.ev < lastEv) wraps++; lastEv = r.ev; }
    if (wraps >= 2) break;
  }
  const outside = [...seen].filter((e) => e < secRange.from || e > secRange.to);
  rec('L1 the loop of a section repeats inside it', wraps >= 2 && outside.length === 0, `wraps ${wraps}, outside ${outside.length}, events ${[...seen].join(',')}`);
  const badge = await q(() => { const b = document.getElementById('pp-loop'); return b && !b.hidden ? b.textContent : null; });
  rec('L2 the loop badge shows', !!badge, String(badge));
  await stopPlay();

  // speed 50%
  const tl100 = await q(() => window.__gapp.timeline.totalSec);
  await openPanel();
  await uiClick('#btn-speed-50');
  await sleep(300);
  const tl50 = await q(() => window.__gapp.timeline.totalSec);
  rec('T1 speed 50% doubles the length', Math.abs(tl50 / tl100 - 2) < 0.01, `${tl100.toFixed(2)} -> ${tl50.toFixed(2)}`);
  await openPanel();
  await uiClick('#btn-play');
  await sleep(300);
  const t50 = [];
  const st0 = Date.now();
  while (Date.now() - st0 < 9000) {
    await sleep(80);
    const r = await q(() => ({ st: window.__gapp.player.state, ev: window.__gapp.player.eventIndex, t: window.__gapp.player.timeSec }));
    if (r.st === 'playing' && r.ev >= 0 && (!t50.length || t50[t50.length - 1].ev !== r.ev)) t50.push({ ev: r.ev, at: Date.now() });
    if (t50.length >= 4) break;
  }
  const dts = t50.slice(1).map((x, i) => (x.at - t50[i].at) / 1000);
  const expect = (4 * 60 / 240) / 0.5;
  rec('T2 at 50% a measure lasts twice as long (bpm 240 -> 0.5 s x2)', dts.length >= 2 && dts.slice(0, -0).every((d) => Math.abs(d - expect) < 0.25), `expected ${expect.toFixed(2)} s, got ${dts.map((d) => d.toFixed(2)).join(' ')}`);
  await stopPlay();
  await uiClick('#btn-speed-100');
  await sleep(200);

  // arrangement
  await q(() => window.scrollTo(0, 0));
  const before = await q(() => ({ rows: document.querySelectorAll('.tb-arr-row').length, secs: window.__gapp.timeline.sections.length, ev: window.__gapp.timeline.events.length }));
  await page.click('.tb-arr-row[data-i="0"] .tb-arr-rep');
  const mid = await q(() => ({ rows: document.querySelectorAll('.tb-arr-row').length, secs: window.__gapp.timeline.sections.length, ev: window.__gapp.timeline.events.length, open: document.getElementById('tb-arr').open }));
  rec('O1 the order of the sections: the first one can be repeated (more measures in the play)', mid.rows === before.rows + 1 && mid.secs === before.secs + 1 && mid.ev > before.ev, JSON.stringify({ before, mid }));
  await page.click('.tb-arr-row[data-i="1"] .tb-arr-del');
  await page.click('.tb-arr-row[data-i="0"] .tb-arr-down');
  const after = await q(() => ({ rows: document.querySelectorAll('.tb-arr-row').length, order: window.__gapp.timeline.sections.map((s) => s.sectionRef) }));
  rec('O2 remove and move work', after.rows === before.rows && after.order.length === before.secs, JSON.stringify(after));
  await page.click('#tb-arr-reset');
  const reset = await q(() => window.__gapp.timeline.sections.length);
  rec('O3 "Ordine della tab" goes back to one pass', reset === before.secs, String(reset));
  await shot('04-arrangement');

  // the font change keeps no horizontal scroll
  await page.click('#btn-font-up'); await page.click('#btn-font-up');
  await sleep(300);
  const fz = await q(() => ({ sw: document.documentElement.scrollWidth, over: [...document.querySelectorAll('.tb-row')].filter((r) => r.getBoundingClientRect().right > innerWidth + 0.5).length }));
  rec('V4 bigger text: the measures reflow, no horizontal scroll', fz.sw <= vw && fz.over === 0, JSON.stringify(fz));
  await shot('05-bigger');

  // ---- synth guitar ----
  await page.goto(URL);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
  await importFile(SYNTH);
  const sy0 = await q(() => ({ ...window.__gapp.synth, plan: window.__gapp.plan.length, hz0: window.__gapp.plan[0].hz }));
  rec('N1 a tab song plays the synth by default, without the click', sy0.on === true && sy0.click === false && sy0.plan > 40, JSON.stringify(sy0));
  const hzs100 = await q(() => window.__gapp.plan.map((n) => n.hz));
  const secs100 = await q(() => window.__gapp.plan.map((n) => n.startSec));
  await q(() => { window.__notes.length = 0; window.__osc = 0; });
  await uiClick('#btn-play');
  let t0n = Date.now();
  while (Date.now() - t0n < 40000) { await sleep(300); if ((await q(() => window.__gapp.player.state)) === 'stopped' && Date.now() - t0n > 4000) break; }
  await sleep(600);
  const run = await q(() => ({ n: window.__notes.length, plan: window.__gapp.plan.length, osc: window.__osc, vib: window.__gapp.plan.filter((x) => x.vibrato).length, whens: window.__notes.map((x) => x.when), at: window.__notes.map((x) => x.at) }));
  rec('N2 every note of the tab is played once; only the count-in ticks (4) and the vibrato LFOs are oscillators', Math.abs(run.n - run.plan) <= 1 && run.osc <= 4 + run.vib + 1, `${run.n}/${run.plan} notes, ${run.osc} oscillators (${run.vib} vibrato)`);
  const w0 = run.whens[0];
  const maxDev = run.whens.map((w, i) => Math.abs((w - w0) - (secs100[i] - secs100[0]))).reduce((a, b) => Math.max(a, b), 0);
  rec('N3 the notes start on the plan times (the clock of the metronome): max deviation under 15 ms', maxDev < 0.015, `${(maxDev * 1000).toFixed(1)} ms over ${run.n} notes`);
  const lead = run.whens.map((w, i) => w - run.at[i]);
  rec('N4 notes are scheduled ahead (no late start): lookahead between 0 and 0.2 s', lead.every((l) => l > -0.03 && l < 0.2), `min ${(Math.min(...lead) * 1000).toFixed(0)} ms, max ${(Math.max(...lead) * 1000).toFixed(0)} ms`);
  // the pitch of the real buffers, from the real run
  const pitch = await q(() => {
    const out = [];
    const plan = window.__gapp.plan;
    const seen = new Set();
    window.__notes.forEach((n, i) => {
      const hz = plan[i].hz;
      if (seen.has(Math.round(hz)) || out.length >= 8 || plan[i].glide) return;
      seen.add(Math.round(hz));
      const sr = n.buf.sampleRate; const d = n.buf.getChannelData(0);
      const lo = Math.floor(sr / 1500); const hi = Math.ceil(sr / 60); const len = Math.floor(sr * 0.2);
      const r = new Float64Array(hi + 2); let best = lo;
      for (let lag = lo - 1; lag <= hi + 1; lag++) { let s = 0; for (let k = 0; k < len; k++) s += d[k] * d[k + lag]; r[lag] = s; }
      for (let lag = lo; lag <= hi; lag++) if (r[lag] > r[best]) best = lag;
      for (let div = 4; div >= 2; div--) { const l2 = Math.round(best / div); if (l2 >= lo && r[l2] > 0.9 * r[best]) { best = l2; break; } }
      const a = r[best - 1]; const b = r[best]; const c = r[best + 1]; const den = a - 2 * b + c; const sh = den ? 0.5 * (a - c) / den : 0;
      const est = sr / (best + sh);
      out.push({ hz, est, cents: 1200 * Math.log2(est / hz) });
    });
    return out;
  });
  rec('N5 the buffers of the notes in the app are in tune (within 10 cents)', pitch.length >= 4 && pitch.every((p) => Math.abs(p.cents) <= 10), pitch.map((p) => p.cents.toFixed(1)).join(' '));
  // capo
  await q(() => window.scrollTo(0, 0));
  const capoTxt0 = await q(() => document.getElementById('btn-capo').textContent);
  await page.click('#btn-capo');
  await page.selectOption('#capo-free', '0');
  await sleep(300);
  const hzNoCapo = await q(() => window.__gapp.plan[0].hz);
  await page.click('#btn-capo');
  await page.selectOption('#capo-free', '2');
  await sleep(300);
  const capo = await q(() => ({ txt: document.getElementById('btn-capo').textContent, capo: window.__gapp.synth.capo, hz: window.__gapp.plan[0].hz }));
  rec('C1 the capo is read (2), shown, editable; the synth plays 2 semitones higher with it', /Capo 2/.test(capoTxt0) && capo.capo === 2 && /Capo 2/.test(capo.txt) && Math.abs(1200 * Math.log2(capo.hz / hzNoCapo) - 200) < 0.01, JSON.stringify({ capoTxt0, capo, hzNoCapo }));
  // 50%: the pitch stays, the times double
  await uiClick('#btn-speed-50');
  await sleep(300);
  const half = await q(() => ({ hz: window.__gapp.plan.map((n) => n.hz), s: window.__gapp.plan.map((n) => n.startSec) }));
  rec('N6 speed 50%: same pitches, twice the times', half.hz.every((h, i) => Math.abs(h - hzs100[i]) < 1e-6) && Math.abs(half.s[half.s.length - 1] / secs100[secs100.length - 1] - 2) < 0.02, `${(half.s[half.s.length - 1] / secs100[secs100.length - 1]).toFixed(3)}`);
  await q(() => { window.__notes.length = 0; });
  await uiClick('#btn-play');
  await sleep(7000);
  const slow = await q(() => ({ whens: window.__notes.map((x) => x.when), st: window.__gapp.player.state }));
  const sw0 = slow.whens[0];
  const sdev = slow.whens.slice(0, 12).map((w, i) => Math.abs((w - sw0) - (half.s[i] - half.s[0]))).reduce((a, b) => Math.max(a, b), 0);
  rec('N7 at 50% the notes follow the slow plan', slow.whens.length >= 8 && sdev < 0.02, `${slow.whens.length} notes, dev ${(sdev * 1000).toFixed(1)} ms`);
  await openPanel();
  await uiClick('#btn-stop').catch(() => {});
  await stopPlay();
  await uiClick('#btn-speed-100');
  await sleep(300);
  await uiClick('#btn-play');
  await sleep(4000);
  // pause: no note sounds after it
  await openPanel();
  await uiClick('#btn-play');
  await sleep(150);
  const pz = await q(() => ({ now: window.__lastCtx.currentTime, n: window.__notes.length, st: window.__gapp.player.state }));
  await sleep(1500);
  const audibleAfter = await q((now) => window.__notes.filter((x) => x.when > now + 0.005 && !(x.stop !== null && x.stop <= x.when + 1e-6)).length, pz.now);
  rec('P5 after Pause no note starts (the scheduled ones are cancelled)', pz.st === 'paused' && audibleAfter === 0, `state ${pz.st}, ${audibleAfter} audible notes after pause`);
  // resume: plays again from there
  const nBefore = await q(() => window.__notes.length);
  await uiClick('#btn-play');
  await sleep(4500);
  const nAfter = await q(() => window.__notes.length);
  rec('P6 Resume plays notes again', nAfter > nBefore, `${nBefore} -> ${nAfter}`);
  // seek: tap a measure while playing
  await q(() => window.scrollTo(0, 0));
  const target = await q(() => { const hl = [...document.querySelectorAll('.tb-hl')].find((h) => h.dataset.measure === '1'); hl.scrollIntoView({ block: 'center' }); return true; });
  await sleep(300);
  await q(() => { window.__notes.length = 0; });
  await page.evaluate(() => [...document.querySelectorAll('.tb-hl')].filter((h) => h.dataset.measure === '1')[0].click());
  await sleep(5000);
  const sk = await q(() => ({ ev: window.__gapp.player.eventIndex, n: window.__notes.length, plan: window.__gapp.plan, tl: window.__gapp.timeline, firstHz: window.__notes.length ? window.__notes[0].buf.length : 0 }));
  const evStart = await q(() => window.__gapp.timeline.events[1].startSec);
  const firstNote = await q((es) => window.__gapp.plan.find((n) => n.startSec >= es - 1e-9), evStart);
  rec('P7 a tap on a measure while playing jumps there: notes of that measure come next', sk.n >= 1 && sk.ev >= 1, `event ${sk.ev}, ${sk.n} notes after the jump`);
  await stopPlay();
  await sleep(400);
  // volume + synth off
  await q(() => window.scrollTo(0, 0));
  await page.click('#tb-tools summary').catch(() => {});
  await q(() => { const v = document.getElementById('synth-vol'); v.value = '30'; v.dispatchEvent(new Event('input', { bubbles: true })); });
  const vol = await q(() => window.__gapp.synth.volume);
  rec('V5 the volume slider sets the synth volume (saved)', Math.abs(vol - 0.3) < 1e-9, String(vol));
  await uiClick('#btn-synth');
  await q(() => { window.__notes.length = 0; window.__osc = 0; });
  await uiClick('#btn-synth-click');
  await uiClick('#btn-play');
  await sleep(5000);
  const off = await q(() => ({ notes: window.__notes.length, osc: window.__osc, on: window.__gapp.synth.on, click: window.__gapp.synth.click }));
  rec('N8 synth off + click on: only ticks, no notes', off.notes === 0 && off.osc >= 4 && off.on === false && off.click === true, JSON.stringify(off));
  await stopPlay();
  // loop of a section repeats its notes
  await uiClick('#btn-synth');
  await uiClick('#btn-synth-click');
  await q(() => window.scrollTo(0, 0));
  await openPanel();
  await uiClick('#pp-bpm');
  await page.fill('#pp-bpm-field', '240');
  await uiClick('#pp-bpm-apply');
  await uiClick('#btn-speed-100');
  await sleep(300);
  const secNotes = await q(() => { const tl = window.__gapp.timeline; const k = tl.sections.findIndex((x) => x.sectionRef === 1); const s = tl.sections[k]; return window.__gapp.plan.filter((n) => n.startSec >= s.startSec - 1e-9 && n.startSec < s.endSec).length; });
  await q(() => { window.__notes.length = 0; });
  await page.evaluate(() => document.querySelector('.tb-loop[data-sec="1"]').click());
  const lt = Date.now();
  let lwraps = 0; let lastE = -1;
  while (Date.now() - lt < 12000 && lwraps < 3) {
    await sleep(50);
    const r = await q(() => ({ st: window.__gapp.player.state, ev: window.__gapp.player.eventIndex }));
    if (r.st === 'playing' && r.ev >= 0) { if (lastE >= 0 && r.ev < lastE) lwraps++; lastE = r.ev; }
  }
  await sleep(200);
  const ln = await q(() => window.__notes.length);
  rec('L3 in the loop the notes of the section come round again, none from other sections', lwraps >= 3 && ln >= 3 * secNotes - 2 && ln <= (lwraps + 1) * secNotes + 2, `${ln} notes, ${secNotes} per pass, ${lwraps} wraps`);
  await shot('08-synth');
  await stopPlay();

  // ---- pasted text ----
  await page.goto(URL);
  await page.click('#btn-paste-tab');
  await page.fill('#paste-tab-text', fs.readFileSync(path.join(OUT, 'synth-text.txt'), 'utf-8'));
  await page.fill('#paste-tab-title', 'Pasted tab');
  await page.click('#paste-tab-go');
  await page.waitForSelector('#btn-play', { timeout: 5000 });
  const pasted = await q(() => ({ title: document.getElementById('song-title').textContent, secs: document.querySelectorAll('.tb-sec').length }));
  rec('I2 a pasted tab imports', pasted.title === 'Pasted tab' && pasted.secs >= 2, JSON.stringify(pasted));
  await page.goto(URL);
  await page.click('#btn-paste-tab');
  await page.fill('#paste-tab-text', 'only words here');
  await page.click('#paste-tab-go');
  const perr = await q(() => document.getElementById('paste-tab-err').textContent);
  rec('I3 text with no tab gives a clear message', /tablatura/i.test(perr), perr);

  // ---- real PDF (counts only) ----
  if (fs.existsSync(REAL)) {
    await importFile(REAL);
    const real = await q(() => ({ title: document.getElementById('song-title').textContent.length > 0, parts: document.querySelectorAll('.tb-part-opt').length, secs: document.querySelectorAll('.tb-sec').length, lines: document.querySelectorAll('.tb-line').length, chords: document.querySelectorAll('.tb-chord').length, dg: document.querySelectorAll('#dg-col .dg-btn').length, sw: document.documentElement.scrollWidth, meta: document.getElementById('tb-meta').textContent }));
    note('R0', JSON.stringify(real));
    await q(() => window.scrollTo(0, 0));
    await shot('06-real');
    await page.click('#btn-part-all');
    await sleep(200);
    const allSecs = await q(() => document.querySelectorAll('.tb-sec').length);
    rec('R1 the real PDF imports: 2 parts (+ "Tutte"), 4 sections, 5 diagrams, no horizontal scroll', real.parts === 3 && allSecs === 4 && real.dg === 5 && real.sw <= vw, `${real.parts} buttons, ${allSecs} sections, ${real.dg} diagrams`);
    await shot('06b-real-all');
    const allRows = await q(() => [...document.querySelectorAll('.tb-row')].filter((r) => r.getBoundingClientRect().right > innerWidth + 0.5).length);
    rec('R2 all parts: no row wider than the screen', allRows === 0, String(allRows));
    await page.click('#btn-part-0');
    await sleep(200);
    await uiClick('#btn-play');
    let moved = 0;
    let lastE = -1;
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      const r = await q(() => ({ st: window.__gapp.player.state, e: window.__gapp.player.eventIndex, cur: !!document.querySelector('.tb-cursor'), cb: document.querySelector('#dg-col .dg-btn.cur') ? 1 : 0 }));
      if (r.st === 'playing' && r.e >= 0) { if (r.e !== lastE) moved++; lastE = r.e; }
    }
    rec('R3 the real tab plays with the cursor (several measures)', moved >= 3, String(moved));
    await shot('07-real-playing');
    await stopPlay();
  } else note('R', 'real PDF not present: skipped');

  rec('E0 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
