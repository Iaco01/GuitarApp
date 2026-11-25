// Round 4 tester, part A: the round 3 fixes in the browser (fret number size as rendered, replace
// labels with same-minute copies, reimport keeps transpose/capo/showShapes, hostile JSON imports,
// free capo selector). Lines visible in play: see round3-tester-a.cjs A6.
// Run: npm run build && node test/e2e/round4-tester-a.cjs [A2|A3|A4|A5|A6]
// Needs the git-ignored real file; prints only counts, chord names and UI labels.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-4', 'tester');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const only = process.argv[2] || '';
const IP13 = devices['iPhone 13'];

async function open(prof = IP13, file = REAL) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  if (file) { await page.setInputFiles('#import-input', file); await page.waitForSelector('#song-title'); }
  return { browser, page, errors, ctx };
}

// rendered size (CSS px) of the digits drawn in small diagrams
const fretTextSizes = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].flatMap((svg) => [...svg.querySelectorAll('text')]
  .filter((t) => /^\d+$/.test(t.textContent.trim()) || /fr$/.test(t.textContent.trim()))
  .map((t) => ({ txt: t.textContent.trim(), w: svg.getBoundingClientRect().width, px: parseFloat(t.getAttribute('font-size')) * svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, h: t.getBoundingClientRect().height }))), sel);

(async () => {
  if (!only || only === 'A2') {
    const { browser, page, errors } = await open({ ...IP13, viewport: { width: 390, height: 800 } });
    // transpose +3: barre chords (Bb, F, Gm, Cm, Eb, C) appear, with fret numbers
    for (let i = 0; i < 3; i++) await page.click('#btn-tr-up');
    await page.click('#btn-play');
    // after the count-in, sample the panel for 12 s (several barre chords pass)
    let pp = [];
    for (let k = 0; k < 24; k++) { await sleep(500); pp = pp.concat(await fretTextSizes(page, '#playpanel svg')); }
    const nPanelSvg = await page.$$eval('#playpanel svg', (s) => s.length);
    info('A2 panel svg count', String(nPanelSvg));
    const hdr = await fretTextSizes(page, '#dg-row svg');
    info('A2 panel small diagrams', JSON.stringify(pp));
    info('A2 header diagrams', JSON.stringify(hdr.slice(0, 6)));
    const digits = pp.concat(hdr).filter((x) => /^\d+$/.test(x.txt));
    rec('A2 fret digits in panel/header diagrams >= 10 px as rendered', digits.length > 0 && digits.every((x) => x.px >= 9.95), `min ${Math.min(...digits.map((x) => x.px)).toFixed(2)} px over ${digits.length}`);
    await page.screenshot({ path: path.join(OUT, 'a2-panel.png'), clip: { x: 0, y: 650, width: 390, height: 150 } });
    await page.click('#btn-play');
    // the "fr" suffix itself
    const fr = pp.filter((x) => /fr$/.test(x.txt));
    info('A2 "fr" text size', fr.map((x) => x.px.toFixed(1)).join(','));
    // sheet with alternatives (54 px)
    await page.click('#dg-row .dg-btn');
    await page.waitForSelector('.sheet');
    const alts = await fretTextSizes(page, '#sheet-alts svg');
    info('A2 sheet alternatives', alts.map((x) => `${x.txt}@${x.px.toFixed(1)}`).join(' '));
    rec('A2 fret digits in the sheet alternatives >= 10 px', alts.filter((x) => /^\d+$/.test(x.txt)).every((x) => x.px >= 9.95));
    rec('A2 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A3') {
    const { browser, page, errors } = await open();
    const reimport = async () => { await page.click('#btn-back'); await page.waitForSelector('#import-input'); await page.setInputFiles('#import-input', REAL); await page.waitForSelector('.dlg'); };
    // three copies imported within the same minute
    await reimport(); await page.click('.dlg [data-value="both"]'); await page.waitForSelector('#song-title');
    await reimport(); await page.click('.dlg [data-value="both"]'); await page.waitForSelector('#song-title');
    await reimport();
    const labels = await page.locator('.dlg [data-value^="replace"]').allTextContents();
    info('A3 labels with 3 copies in the same minute', JSON.stringify(labels));
    rec('A3 replace labels are all different', labels.length === 3 && new Set(labels).size === 3, '');
    rec('A3 labels carry date and time', labels.every((l) => /\d{1,2}:\d{2}/.test(l)), '');
    await page.screenshot({ path: path.join(OUT, 'a3-replace-three.png') });
    await page.click('.dlg [data-value="cancel"]');
    rec('A3 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A4') {
    const { browser, page, errors } = await open();
    for (let i = 0; i < 2; i++) await page.click('#btn-tr-up');
    await page.click('#btn-capo');
    await page.waitForSelector('#capo-free');
    await page.selectOption('#capo-free', '9');
    await sleep(200);
    const capoTxt = await page.innerText('.meta');
    const before = await page.evaluate(() => { const ix = JSON.parse(localStorage.getItem('gapp.index.v1')); const s = JSON.parse(localStorage.getItem('gapp.song.' + ix[0].id)); return { t: s.transpose, c: s.capo, sh: s.view.showShapes, font: s.view.fontScale }; });
    await page.click('#btn-back'); await page.waitForSelector('#import-input');
    await page.setInputFiles('#import-input', REAL); await page.waitForSelector('.dlg');
    await page.click('.dlg [data-value^="replace"]');
    await page.waitForSelector('#song-title');
    const after = await page.evaluate(() => { const ix = JSON.parse(localStorage.getItem('gapp.index.v1')); const s = JSON.parse(localStorage.getItem('gapp.song.' + ix[0].id)); return { n: ix.length, t: s.transpose, c: s.capo, sh: s.view.showShapes, font: s.view.fontScale }; });
    info('A4', `before ${JSON.stringify(before)} after ${JSON.stringify(after)}; meta "${capoTxt.replace(/\n/g, ' ')}"`);
    rec('A4 free capo 9 accepted and shapes on', before.c === 9 && before.sh === true && before.t === 2, JSON.stringify(before));
    rec('A4 reimport + Sostituisci keeps transpose, capo and showShapes', after.n === 1 && after.t === 2 && after.c === 9 && after.sh === true, JSON.stringify(after));
    rec('A4 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A5') {
    const { browser, page, errors } = await open(IP13, null);
    await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#song-title');
    const base = await page.evaluate(() => { const ix = JSON.parse(localStorage.getItem('gapp.index.v1')); return JSON.parse(localStorage.getItem('gapp.song.' + ix[0].id)); });
    await page.click('#btn-back'); await page.waitForSelector('#import-json');
    const mk = (id, mut) => { const s = JSON.parse(JSON.stringify(base)); s.id = id; s.title = 'Caso ' + id; mut(s); return s; };
    const cases = [
      ['ts300000', (s) => { s.timeSignature = [300000, 4]; }],
      ['ts0', (s) => { s.timeSignature = [0, 4]; }],
      ['tsden3', (s) => { s.timeSignature = [4, 3]; }],
      ['tsfloat', (s) => { s.timeSignature = [3.5, 4]; }],
      ['tr13', (s) => { s.transpose = 13; }],
      ['tr-99', (s) => { s.transpose = -99; }],
      ['trfloat', (s) => { s.transpose = 1.5; }],
      ['trstr', (s) => { s.transpose = '3'; }],
      ['capo13', (s) => { s.capo = 13; }],
      ['capo-1', (s) => { s.capo = -1; }],
      ['beats0', (s) => { s.sections[0].lines.find((l) => l.chords.length).chords[0].beats = 0; }],
      ['beats1e6', (s) => { s.sections[0].lines.find((l) => l.chords.length).chords[0].beats = 1e6; }],
      ['beats65', (s) => { s.sections[0].lines.find((l) => l.chords.length).chords[0].beats = 65; }],
      ['bpm1e6', (s) => { s.bpm = 1e6; }],
      ['secbpm1', (s) => { s.sections[2].bpm = 1; }],
      ['secbpmInf', (s) => { s.sections[2].bpm = 1e9; }],
    ];
    const good = [['ok-edge', (s) => { s.transpose = -12; s.capo = 12; s.timeSignature = [16, 16]; s.bpm = 400; }]];
    const songs = cases.map(([id, f]) => mk(id, f)).concat(good.map(([id, f]) => mk(id, f)));
    const file = path.join(OUT, 'a5-hostile.json');
    fs.writeFileSync(file, JSON.stringify({ app: 'guitarapp', exportVersion: 1, exportedAt: new Date().toISOString(), songs, settings: {} }));
    const t0 = Date.now();
    await page.setInputFiles('#import-json', file);
    await page.waitForSelector('.dlg', { timeout: 10000 });
    const dlg = await page.innerText('.dlg');
    const ms = Date.now() - t0;
    info('A5 dialog', JSON.stringify(dlg.split('\n').slice(0, 30)));
    await page.screenshot({ path: path.join(OUT, 'a5-hostile.png') });
    const btn = await page.$('.dlg [data-value="newer"]') || await page.$('.dlg [data-value="add"]') || await page.$('.dlg .primary');
    if (btn) await btn.click();
    await sleep(500);
    const ix = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.index.v1')).map((e) => e.title));
    info('A5 library after import', JSON.stringify(ix));
    const imported = cases.filter(([id]) => ix.includes('Caso ' + id)).map(([id]) => id);
    rec('A5 every hostile case rejected', imported.length === 0, `imported: ${imported.join(',') || 'none'}`);
    rec('A5 the in-range edge case is imported', ix.includes('Caso ok-edge'), '');
    rec('A5 dialog in < 3 s, readable errors', ms < 3000 && /timeSignature|transpose|capo|beats|bpm/i.test(dlg), `${ms} ms`);
    // the edge song opens and plays without hanging
    if (ix.includes('Caso ok-edge')) {
      const rows = await page.$$('.song-row');
      for (const r of rows) if ((await r.innerText()).includes('Caso ok-edge')) { await r.click(); break; }
      await page.waitForSelector('#song-title');
      await page.click('#btn-play'); await sleep(1500);
      const st = await page.evaluate(() => window.__gapp.player.state);
      rec('A5 edge song (16/16, capo 12, -12, 400 BPM) plays', ['playing', 'counting'].includes(st), st);
      await page.click('#btn-play');
    }
    rec('A5 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A6') {
    const { browser, page, errors } = await open();
    await page.click('#btn-capo');
    await page.waitForSelector('#capo-free');
    const opts = await page.$$eval('#capo-free option', (o) => o.map((x) => x.value));
    rec('A6 free capo selector 0-12', opts.join(',') === '0,1,2,3,4,5,6,7,8,9,10,11,12', opts.join(','));
    await page.screenshot({ path: path.join(OUT, 'a6-capo-sheet.png') });
    const res = [];
    for (const v of ['12', '5', '0']) {
      if (!(await page.$('#capo-free'))) { await page.click('#btn-capo'); await page.waitForSelector('#capo-free'); }
      await page.selectOption('#capo-free', v);
      await sleep(200);
      const r = await page.evaluate(() => ({ meta: document.querySelector('.meta').innerText.replace(/\n/g, ' '), first: [...document.querySelectorAll('.song-body .ch')].slice(0, 6).map((c) => c.dataset.chord).join(' ') }));
      res.push([v, r]);
    }
    info('A6 capo 12/5/0', JSON.stringify(res));
    rec('A6 capo 12 shows shapes 12 frets down (G -> G), capo 5 (G -> D), 0 back to written', /Capotasto\s*12/.test(res[0][1].meta) && /^G /.test(res[0][1].first) && /^D /.test(res[1][1].first) && /^G /.test(res[2][1].first), '');
    rec('A6 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
