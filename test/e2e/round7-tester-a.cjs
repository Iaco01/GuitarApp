// Round 7 tester, part A (corrections of round 6): rhythm row, BPM limit, +/- buttons. Independent of round7-panel.cjs.
// Run: npm run build && node test/e2e/round7-tester-a.cjs [360|SE|13|all]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-7', 'tester');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; let dev = '';
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const PROFILES = {
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  13: devices['iPhone 13'],
};
const which = process.argv[2] || 'all';

async function run(name, prof) {
  dev = name;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#btn-play', { timeout: 20000 });
  const rhythmVisibleByDefault = await page.evaluate(() => window.innerHeight >= 700); // the row is off by default under 700 px (idle it is empty, so it cannot be measured)
  console.log(`INFO [${dev}] viewport ${prof.viewport.width}x${prof.viewport.height}; rhythm row visible by default: ${rhythmVisibleByDefault}`);
  if (!rhythmVisibleByDefault) {
    await page.click('#btn-more');
    await page.click('#btn-pp-rhythm');
    await page.click('#btn-more');
  }
  // A4: buttons and label
  const b = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const x = e.getBoundingClientRect(); return { w: x.width, h: x.height }; };
    return { minus: r('#btn-bpm-down'), plus: r('#btn-bpm-up'), label: document.querySelector('#pp-bpm').textContent };
  });
  rec('A4 − / + at least 44x44 px', b.minus.w >= 44 && b.minus.h >= 44 && b.plus.w >= 44 && b.plus.h >= 44, JSON.stringify(b));
  rec('A4 label looks like "♩=NN" with no space', /^♩=\d+(\.\d)?$/.test(b.label.trim()), JSON.stringify(b.label));
  const hIdle = await page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
  // two independent samplers: rAF and a 7 ms interval; also a distinct-index counter
  const res = await page.evaluate(() => new Promise((resolve) => {
    const seen = new Set(); let frames = 0, bad = 0, multi = 0, tot = 0, badI = 0; let lastIdx = -1, moves = 0;
    const sample = (isRaf) => {
      if (window.__gapp.player.state !== 'playing') return;
      const cells = [...document.querySelectorAll('#pp-pattern .pp-cell')];
      const idx = cells.map((c, i) => (c.classList.contains('now') ? i : -1)).filter((i) => i >= 0);
      if (isRaf) { frames++; if (idx.length === 0) bad++; if (idx.length > 1) multi++; } else { tot++; if (idx.length !== 1) badI++; }
      if (idx.length === 1) { seen.add(idx[0]); if (idx[0] !== lastIdx) { moves++; lastIdx = idx[0]; } }
    };
    const iv = setInterval(() => sample(false), 7);
    const t0 = performance.now();
    (function loop() { sample(true); if (performance.now() - t0 < 8000) requestAnimationFrame(loop); else { clearInterval(iv); resolve({ frames, bad, multi, intervalSamples: tot, intervalBad: badI, distinct: seen.size, moves }); } })();
  }));
  const geo = await page.evaluate(() => {
    const pat = document.querySelector('#pp-pattern');
    const cells = [...pat.querySelectorAll('.pp-cell')];
    const rs = cells.map((c) => c.getBoundingClientRect());
    return { n: cells.length, minW: Math.min(...rs.map((r) => r.width)), minH: Math.min(...rs.map((r) => r.height)), left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), vw: innerWidth, sw: pat.scrollWidth, cw: pat.clientWidth, h: document.querySelector('#playpanel').getBoundingClientRect().height, fs: parseFloat(getComputedStyle(cells[0]).fontSize) };
  });
  rec('A1 cells >= 14 px wide and tall enough', geo.n >= 8 && geo.minW >= 14 && geo.minH >= 14, JSON.stringify(geo));
  rec('A1 all cells inside the screen, row not clipped', geo.left >= 0 && geo.right <= geo.vw + 0.5 && geo.sw <= geo.cw + 1, `left ${geo.left} right ${geo.right} vw ${geo.vw} scrollW ${geo.sw}/${geo.cw}`);
  rec('A1 current cell lit in every rAF frame and every 7 ms sample', res.bad === 0 && res.multi === 0 && res.intervalBad === 0 && res.frames > 200, JSON.stringify(res));
  rec('A1 the lit cell moves with the beat (>= 4 distinct cells, >= 6 moves in 8 s at 62-96 BPM)', res.distinct >= 4 && res.moves >= 6, `${res.distinct} cells, ${res.moves} moves`);
  console.log(`INFO [${dev}] panel height idle ${hIdle} -> playing ${geo.h}; cell font ${geo.fs}px`);
  await page.screenshot({ path: path.join(OUT, `a-${name}-play.png`) });
  await page.click('#btn-play');
  await sleep(300);

  // A2: BPM limit, no audio
  const bpms = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))); return s.sections.map((x) => x.bpm); });
  const base = await bpms();
  console.log(`INFO [${dev}] section BPMs: ${base.join(' ')}`);
  const hBefore = await page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
  await page.click('#pp-bpm');
  await page.fill('#pp-bpm-field', '280');
  await page.click('#pp-bpm-apply');
  await sleep(300);
  const after = await bpms();
  const note = await page.evaluate(() => { const n = document.querySelector('#pp-bpm-note'); return { hidden: n.hidden, text: n.textContent, undo: !!document.querySelector('#btn-bpm-undo') && document.querySelector('#btn-bpm-undo').getBoundingClientRect().height }; });
  const ratio = base.map((v, i) => after[i] / v);
  const kSpread = Math.max(...ratio) - Math.min(...ratio);
  console.log(`INFO [${dev}] after "280": ${after.join(' ')}; factor ${ratio[0].toFixed(3)}, spread of factors ${kSpread.toFixed(3)}; note: ${JSON.stringify(note.text)}`);
  rec('A2 limit: every section within 30-300', after.every((v) => v >= 30 && v <= 300));
  rec('A2 limit: ratios between sections preserved (factor spread < 0.01)', kSpread < 0.01, kSpread.toFixed(4));
  rec('A2 limit: note visible with the limit mentioned and Annulla button', !note.hidden && /30.300|limite/i.test(note.text) && note.undo > 0, JSON.stringify(note));
  await page.screenshot({ path: path.join(OUT, `a-${name}-limit.png`) });
  await page.click('#btn-bpm-undo');
  await sleep(200);
  const undone = await bpms();
  const note2 = await page.evaluate(() => document.querySelector('#pp-bpm-note').hidden);
  rec('A2 Annulla restores every section exactly and hides the note (no audio)', undone.join() === base.join() && note2, `${undone.join(' ')} hidden=${note2}`);
  // a change that does not hit the limit: no note, panel height unchanged
  await page.click('#pp-bpm'); await page.fill('#pp-bpm-field', String(Math.round(base[0] + 3))); await page.click('#pp-bpm-apply'); await sleep(200);
  const nh = await page.evaluate(() => ({ hidden: document.querySelector('#pp-bpm-note').hidden, h: document.querySelector('#playpanel').getBoundingClientRect().height }));
  rec('A2 normal change: no note and panel height unchanged', nh.hidden && Math.abs(nh.h - hBefore) < 1, JSON.stringify({ ...nh, hBefore }));
  // low limit: 31 for the whole song
  await page.click('#pp-bpm'); await page.fill('#pp-bpm-field', '31'); await page.click('#pp-bpm-apply'); await sleep(200);
  const low = await bpms();
  rec('A2 low limit: all >= 30', low.every((v) => v >= 30 && v <= 300), low.join(' '));
  rec('A2 errors', errors.length === 0, errors.join('|'));
  await browser.close();
}
(async () => {
  for (const [n, p] of Object.entries(PROFILES)) if (which === 'all' || which === n) await run(n, p);
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
