// Round 3 tester, part B/C/D in the browser: transposition on the real file (DOM), capo sheet,
// chord diagrams visuals. Expected chord names come from tables in this file.
// Run: npm run build && node test/e2e/round3-tester-b.cjs [B|C|D]
// Needs the git-ignored real file. Screenshots go to test-artifacts/round-3/ (not committed).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-3');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const only = process.argv[2] || '';
const W360 = { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = (n) => (PCS[n[0]] + (n[1] === '#' ? 1 : n[1] === 'b' ? -1 : 0) + 12) % 12;
// flat spelling for the resulting major key (G major + n)
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db (F# -> sharps)
const expectedName = (orig, n) => {
  const m = /^([A-G][#b]?)(.*)$/.exec(orig);
  const tonic = (7 + n + 120) % 12;
  const flats = FLAT_MAJOR_TONICS.has(tonic);
  return (flats ? FLAT : SHARP)[(pcOf(m[1]) + n + 120) % 12] + m[2];
};

async function open(prof = W360, file = REAL) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...prof, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  if (file) { await page.setInputFiles('#import-input', file); await page.waitForSelector('#song-title'); }
  return { browser, page, errors, ctx };
}
const song = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))));
const snap = (page) => page.evaluate(() => ({
  ch: [...document.querySelectorAll('.song-body .ch')].map((e) => ({ ref: e.dataset.ref, orig: e.dataset.orig, chord: e.dataset.chord, text: e.firstChild.textContent, color: getComputedStyle(e).getPropertyValue('--cc') || e.style.getPropertyValue('--cc'), cc: e.style.getPropertyValue('--cc') })),
  dg: [...document.querySelectorAll('#dg-row .dg-btn')].map((b) => ({ chord: b.dataset.chord, orig: b.dataset.orig, aria: b.getAttribute('aria-label'), svgText: (b.querySelector('svg text') || {}).textContent || null, cc: b.style.getPropertyValue('--cc') })),
  ind: document.querySelector('#tr-indicator').textContent,
  meta: document.querySelector('.meta').textContent,
  capoBtn: document.querySelector('#btn-capo').textContent,
  overflow: document.documentElement.scrollWidth - innerWidth,
}));

(async () => {
  if (!only || only === 'B') {
    const { browser, page, errors } = await open();
    const base = await snap(page);
    const origNames = base.ch.map((c) => c.orig);
    const uniq = [...new Set(origNames)];
    info('B real chords', uniq.join(' ') + ` (${origNames.length} in text)`);
    rec('B real file: 328 chords, 6 distinct G D Em Am C A', origNames.length === 328 && ['G', 'D', 'Em', 'Am', 'C', 'A'].every((c) => uniq.includes(c)) && uniq.length === 6, uniq.join(' '));
    rec('B text equals data-chord at 0 and header chips equal the 6 chords', base.ch.every((c) => c.text === c.orig) && base.dg.length === 6);
    // key estimate in Node
    const { parseSongFromMht } = await import(path.join(ROOT, 'src/parser.js'));
    const { estimateKey } = await import(path.join(ROOT, 'src/transpose.js'));
    const s0 = parseSongFromMht(fs.readFileSync(REAL, 'latin1'));
    const k = estimateKey(s0);
    rec('B4 estimateKey on real file = G major', k.root === 'G' && !k.minor, `${k.root}${k.minor ? 'm' : ''}; song.key=${s0.key}`);
    // all shifts -12..12
    let bad = [];
    const results = {};
    for (const n of [...Array(25).keys()].map((i) => i - 12)) {
      await page.click('#tr-indicator'); // reset
      const steps = n;
      for (let i = 0; i < Math.abs(steps); i++) await page.click(steps > 0 ? '#btn-tr-up' : '#btn-tr-down');
      const s = await snap(page);
      const st = await song(page);
      const labelOk = s.ind === (n === 0 ? 'Originale' : (n > 0 ? '+' : '−') + Math.abs(n));
      const textBad = s.ch.filter((c) => c.text !== expectedName(c.orig, n) || c.chord !== c.text).length;
      const dgBad = s.dg.filter((d) => d.chord !== expectedName(d.orig, n) || d.svgText !== d.chord || d.aria !== 'Accordo ' + d.chord).length;
      // written names untouched in storage
      const stored = [];
      for (const sec of st.sections) for (const l of sec.lines) for (const c of l.chords) stored.push(c.name);
      const storedOk = JSON.stringify(stored) === JSON.stringify(origNames) && st.transpose === n;
      results[n] = [...new Set(s.ch.map((c) => c.chord))].join(' ');
      if (!labelOk || textBad || dgBad || !storedOk || s.overflow !== 0) bad.push(`n=${n} label=${labelOk} textBad=${textBad} dgBad=${dgBad} stored=${storedOk} overflow=${s.overflow}`);
      // colors identical to the original
      const colBad = s.ch.filter((c, i) => c.cc !== base.ch[i].cc).length;
      if (colBad) bad.push(`n=${n} colour differs on ${colBad}`);
    }
    rec('B1/B6 DOM text, header diagrams, indicator, storage and colours for -12..+12 vs my table', bad.length === 0, bad.slice(0, 6).join(' | '));
    info('B spellings', [-2, 3, 4, 8, 6, 5].map((n) => `${n}: ${results[n]}`).join(' ; '));
    // B2: +12 and -12 return to the original in model and DOM
    await page.click('#tr-indicator');
    for (let i = 0; i < 12; i++) await page.click('#btn-tr-up');
    let s = await snap(page);
    rec('B2 +12 DOM equals original names', JSON.stringify(s.ch.map((c) => c.chord)) === JSON.stringify(origNames) && s.ind === '+12');
    // can it go beyond 12?
    await page.click('#btn-tr-up');
    s = await snap(page);
    info('B2 +13 attempt', s.ind);
    await page.click('#tr-indicator');
    for (let i = 0; i < 12; i++) await page.click('#btn-tr-down');
    s = await snap(page);
    rec('B2 -12 DOM equals original names', JSON.stringify(s.ch.map((c) => c.chord)) === JSON.stringify(origNames) && s.ind === '−12');
    // B6: header meta follows transposition? (key shown?)
    await page.click('#tr-indicator');
    for (let i = 0; i < 3; i++) await page.click('#btn-tr-up');
    s = await snap(page);
    info('B6 meta at +3', JSON.stringify(s.meta));
    rec('B6 header meta line does not show a stale (untransposed) key', !/Tonalit/.test(s.meta) || /Bb/.test(s.meta), s.meta);
    // chord sheet follows transposition
    await page.click('#dg-row .dg-btn[data-orig="G"]');
    await page.waitForSelector('#sheet-dg svg');
    const sh = await page.evaluate(() => ({ name: document.querySelector('#sheet-name').textContent, aria: document.querySelector('.sheet').getAttribute('aria-label'), alts: document.querySelectorAll('#sheet-alts button').length }));
    rec('B6 sheet shows transposed name (G+3 = Bb)', sh.name === 'Bb' && /Bb/.test(sh.aria), JSON.stringify(sh));
    await page.screenshot({ path: path.join(OUT, 't-b-sheet-bb.png') });
    await page.click('#sheet-close');
    await page.click('.song-body .ch[data-orig="Em"]');
    rec('B6 tap on text chord opens sheet with transposed name (Em+3 = Gm)', (await page.textContent('#sheet-name')) === 'Gm');
    await page.click('#sheet-close');
    // play panel follows transposition
    await page.click('#btn-play'); await sleep(7000);
    const pp = await page.evaluate(() => ({ cur: document.querySelector('#pp-current').textContent, next: document.querySelector('#pp-next').textContent, curDg: document.querySelector('#pp-current-dg').innerHTML, nextDg: document.querySelector('#pp-next-dg').innerHTML, curHi: document.querySelector('.ch.cur') && document.querySelector('.ch.cur').dataset.chord }));
    const { getChordShapes } = await import(path.join(ROOT, 'src/chords-db.js'));
    const { renderDiagramSvg } = await import(path.join(ROOT, 'src/diagram.js'));
    const norm = (h) => h.replace(/><\/(line|circle|rect|path|text)>/g, '/>').replace(/\s*\/>/g, '/>');
    const smallOf = (n) => norm(renderDiagramSvg(getChordShapes(n)[0], { size: 30 }));
    const okNames = ['Bb', 'F', 'Gm', 'Cm', 'Eb', 'C'];
    rec('B6 panel current/next and small diagrams show transposed names', okNames.includes(pp.cur) && okNames.includes(pp.next) && norm(pp.curDg) === smallOf(pp.cur) && norm(pp.nextDg) === smallOf(pp.next) && pp.cur === pp.curHi, JSON.stringify({ cur: pp.cur, next: pp.next, curHi: pp.curHi }));
    await page.screenshot({ path: path.join(OUT, 't-b-panel-plus3.png') });
    // change transposition during play: panel updates
    await page.click('#btn-tr-up'); await sleep(1500);
    const pp2 = await page.evaluate(() => ({ cur: document.querySelector('#pp-current').textContent, hi: document.querySelector('.ch.cur') && document.querySelector('.ch.cur').dataset.chord, st: window.__gapp.player.state }));
    rec('B6 transposing during play keeps playing and panel follows', pp2.st === 'playing' && pp2.cur === pp2.hi, JSON.stringify(pp2));
    await page.click('#btn-play');
    await page.click('#btn-more').catch(() => {}); await page.click('#btn-stop').catch(() => {});
    // recorder follows transposition (name shown in recorder)
    await page.click('#btn-edit');
    await page.locator('.rec-sec[data-sec="2"]').scrollIntoViewIfNeeded();
    await page.locator('.rec-sec[data-sec="2"]').click();
    await page.waitForSelector('#rec-tap');
    await sleep(500);
    const rname = await page.textContent('#rec-expected');
    rec('B6 recorder shows transposed chord name', ['Bb', 'B', 'F', 'F#', 'Gm', 'G#m', 'Cm', 'C#m', 'Eb', 'E', 'C', 'C#'].includes(rname) && rname !== 'G' && rname !== 'D', rname);
    await page.click('#rec-cancel');
    rec('B console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'C') {
    const { browser, page, errors } = await open();
    const st0 = await song(page);
    // beats weights per written chord
    const w = {};
    for (const sec of st0.sections) for (const l of sec.lines) for (const c of l.chords) w[c.name] = (w[c.name] || 0) + c.beats;
    // difficulty table from the plan (independent copy), plain major/minor only needed
    const DIFF = (n) => { const m = /^([A-G][#b]?)(m?)$/.exec(n); if (!m) return 5; const [, r, mi] = m; if (!mi) return ['C', 'G', 'D', 'A', 'E'].includes(r) ? 1 : r === 'F' ? 3 : 4; return ['A', 'E', 'D'].includes(r) ? 1 : r === 'B' ? 3 : 4; };
    const myTop = (t) => {
      const total = Object.values(w).reduce((a, b) => a + b, 0);
      const rows = [];
      const tonic = (c) => (7 + t - c + 120) % 12;
      for (let c = 0; c <= 7; c++) {
        const flats = FLAT_MAJOR_TONICS.has(tonic(c));
        const shapes = []; let score = 0;
        for (const [name, b] of Object.entries(w)) {
          const m = /^([A-G][#b]?)(.*)$/.exec(name);
          const sh = (flats ? FLAT : SHARP)[(pcOf(m[1]) + t - c + 120) % 12] + m[2];
          score += DIFF(sh) * b; if (!shapes.includes(sh)) shapes.push(sh);
        }
        rows.push({ capo: c, shapes, score: score / total });
      }
      return rows.sort((a, b) => a.score - b.score || a.capo - b.capo).slice(0, 3);
    };
    const optsOf = async () => page.$$eval('#capo-list .capo-opt', (b) => b.map((x) => ({ capo: Number(x.dataset.capo), txt: x.textContent, pressed: x.getAttribute('aria-pressed') })));
    for (const t of [0, 2, 3, 5, -4]) {
      await page.click('#tr-indicator');
      for (let i = 0; i < Math.abs(t); i++) await page.click(t > 0 ? '#btn-tr-up' : '#btn-tr-down');
      await page.click('#btn-capo');
      await page.waitForSelector('#capo-list');
      const o = await optsOf();
      const mine = myTop(t);
      const app3 = o.slice(0, 3);
      const sameCapos = JSON.stringify(app3.map((x) => x.capo)) === JSON.stringify(mine.map((x) => x.capo));
      const shapesOk = app3.every((x, i) => x.txt.includes('forme ' + mine[i].shapes.join(', ')) || x.txt.includes(mine[i].shapes.join(', ')));
      rec(`C1 transpose ${t}: top-3 capos and shapes equal my scoring (real weights)`, sameCapos && shapesOk, 'app: ' + o.map((x) => x.txt).join(' || ') + ' ## mine: ' + mine.map((m) => `${m.capo}:${m.shapes.join(',')}(${m.score.toFixed(2)})`).join(' ; '));
      if (t === 3) await page.screenshot({ path: path.join(OUT, 't-c-capo-sheet-plus3.png') });
      await page.click('#capo-close');
    }
    // transpose 0 -> best capo 0; +2 -> capo 2
    await page.click('#tr-indicator');
    await page.click('#btn-capo');
    let o = await optsOf();
    rec('C1 transpose 0: best is capo 0 and it is marked current', o[0].capo === 0 && o[0].pressed === 'true', JSON.stringify(o[0]));
    await page.click('#capo-close');
    await page.click('#btn-tr-up'); await page.click('#btn-tr-up');
    await page.click('#btn-capo');
    o = await optsOf();
    rec('C1 transpose +2: best capo 2 forme G, D, Em, Am, C, A', o[0].capo === 2 && /forme G, D, Em, Am, C, A/.test(o[0].txt), o[0].txt);
    // choose capo 3 (not best) on +2 -> shapes view with t-capo = -1
    const c3 = o.find((x) => x.capo === 7) || o[1];
    await page.click(`#capo-list .capo-opt[data-capo="${c3.capo}"]`);
    let s = await snap(page);
    const exp = (orig) => expectedName(orig, 2 - c3.capo);
    info('C2 choose capo ' + c3.capo, `${s.capoBtn} | ${[...new Set(s.ch.map((c) => c.chord))].join(' ')} | ${s.meta}`);
    // for key spelling in shapes view the resulting key is G + (2 - capo)
    rec(`C2 capo ${c3.capo}: header button, text names, diagrams = shapes`, s.capoBtn === `Capo ${c3.capo} — forme` && s.ch.every((c) => c.chord === exp(c.orig)) && s.dg.every((d) => d.chord === exp(d.orig) && d.svgText === d.chord), s.capoBtn);
    await page.screenshot({ path: path.join(OUT, 't-c-shapes-capo.png') });
    // toggle the checkbox: shapes off -> real names
    await page.click('#btn-capo');
    await page.click('#capo-shapes');
    s = await snap(page);
    rec('C2 untick "mostra le forme": names go back to transposed chords, capo kept', s.ch.every((c) => c.chord === expectedName(c.orig, 2)) && s.capoBtn === `Capo ${c3.capo}`, s.capoBtn + ' ' + [...new Set(s.ch.map((c) => c.chord))].join(' '));
    await page.click('#capo-close');
    // capo 2 shapes with +2, persistence, reload
    await page.click('#btn-capo');
    await page.click('#capo-list .capo-opt[data-capo="2"]');
    s = await snap(page);
    rec('C2 +2 capo 2 shapes = original names G D Em Am C A', [...new Set(s.ch.map((c) => c.chord))].join(' ') === 'G D Em Am C A' && s.capoBtn === 'Capo 2 — forme', s.capoBtn);
    await page.reload(); await page.waitForSelector('#song-title');
    s = await snap(page);
    const st = await song(page);
    rec('C3 capo, transpose, shapes view survive reload', s.capoBtn === 'Capo 2 — forme' && s.ind === '+2' && st.capo === 2 && st.view.showShapes === true && st.transpose === 2, `${s.capoBtn} ${s.ind}`);
    // capo with transposition changes in shapes view: indicator semantic
    await page.click('#btn-tr-up');
    s = await snap(page);
    info('C2 in shapes view, transpose +3 capo 2', `${s.ind} shows ${[...new Set(s.ch.map((c) => c.chord))].join(' ')}`);
    // "Senza capotasto"
    await page.click('#btn-capo');
    const hasNone = await page.$('#capo-list .capo-opt[data-capo="0"]');
    rec('C "Senza capotasto" option exists when capo > 0', !!hasNone);
    await page.click('#capo-list .capo-opt[data-capo="0"]');
    s = await snap(page);
    rec('C choosing no capo restores names and button', s.capoBtn === 'Capotasto' && s.ch.every((c) => c.chord === expectedName(c.orig, 3)), s.capoBtn);
    // reimport from .mht of same page: transpose/capo state
    rec('C console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'D') {
    const { browser, page, errors } = await open();
    // header row
    const r = await page.evaluate(() => { const row = document.querySelector('#dg-row'); const b = row.querySelector('svg').getBoundingClientRect(); return { sw: row.scrollWidth, cw: row.clientWidth, ox: getComputedStyle(row).overflowX, svg: [b.width, b.height], page: document.documentElement.scrollWidth - innerWidth, btnH: row.querySelector('.dg-btn').getBoundingClientRect().height }; });
    rec('D3 row scrolls inside itself, page does not', r.sw > r.cw && r.page === 0 && /auto|scroll/.test(r.ox), JSON.stringify(r));
    // scroll the row to the end, page still does not scroll horizontally
    await page.evaluate(() => { document.querySelector('#dg-row').scrollLeft = 9999; });
    const after = await page.evaluate(() => ({ x: window.scrollX, page: document.documentElement.scrollWidth - innerWidth, rowLeft: document.querySelector('#dg-row').scrollLeft }));
    rec('D3 scrolling the row leaves the page still', after.x === 0 && after.page === 0 && after.rowLeft > 0, JSON.stringify(after));
    await page.evaluate(() => { document.querySelector('#dg-row').scrollLeft = 0; window.scrollTo(0, 0); });
    // font sizes of fret number as rendered
    await page.click('#btn-tr-up'); await page.click('#btn-tr-up'); await page.click('#btn-tr-up'); // Bb... barre shapes with numbers
    const fretNums = await page.evaluate(() => [...document.querySelectorAll('#dg-row .dg-btn')].map((b) => { const svg = b.querySelector('svg'); const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent); const vb = svg.viewBox.baseVal.width; const scale = svg.getBoundingClientRect().width / vb; return { chord: b.dataset.chord, texts, fretPx: texts.length > 1 ? (19 * scale).toFixed(1) : null, namePx: (17 * scale).toFixed(1) }; }));
    info('D3 header diagrams at +3', JSON.stringify(fretNums));
    for (const th of ['dark', 'light']) {
      const cur = await page.evaluate(() => document.documentElement.dataset.theme);
      if (cur !== th) await page.click('#btn-theme');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, `t-d-header-${th}.png`) });
      // contrast: svg stroke colour vs background of the button
      const col = await page.evaluate(() => { const b = document.querySelector('#dg-row .dg-btn'); const s = b.querySelector('svg'); return { fg: getComputedStyle(s).color, bg: getComputedStyle(b).backgroundColor, page: getComputedStyle(document.body).backgroundColor }; });
      info(`D3 ${th} colours`, JSON.stringify(col));
      // sheet with a barre chord with fret number
      await page.click('#dg-row .dg-btn[data-orig="D"]');
      await page.waitForSelector('#sheet-dg svg');
      await page.screenshot({ path: path.join(OUT, `t-d-sheet-${th}.png`) });
      const alts = await page.$$('#sheet-alts button');
      if (alts.length > 1) { await alts[alts.length - 1].click(); await page.screenshot({ path: path.join(OUT, `t-d-sheet-alt-${th}.png`) }); }
      await page.click('#sheet-close');
    }
    // text contrast of the chip under both themes computed via colour parse
    await page.click('#btn-play'); await sleep(6000);
    for (const th of ['dark', 'light']) {
      const cur = await page.evaluate(() => document.documentElement.dataset.theme);
      if (cur !== th) await page.click('#btn-theme');
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, `t-d-panel-${th}.png`) });
      const sizes = await page.evaluate(() => [...document.querySelectorAll('#playpanel .pp-dg svg')].map((s) => { const r = s.getBoundingClientRect(); const texts = [...s.querySelectorAll('text')].length; return [Math.round(r.width), Math.round(r.height), texts]; }));
      info(`D3 panel diagram size ${th}`, JSON.stringify(sizes));
    }
    await page.click('#btn-play');
    // clip of the panel diagram magnified for the Read tool
    await page.locator('#playpanel').screenshot({ path: path.join(OUT, 't-d-panel-crop.png') });
    rec('D console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
