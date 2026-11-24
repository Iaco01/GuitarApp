// Round 3 checks on dist/index.html with the real (git-ignored) file.
// Run: npm run build && node test/e2e/round3.cjs   Screenshots go to test-artifacts/round-3/.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const SYN = path.join(ROOT, 'test', 'fixtures', 'synthetic');
const OUT = path.join(ROOT, 'test-artifacts', 'round-3');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  // ---- diagrams ----
  const dg = await page.evaluate(() => [...document.querySelectorAll('#dg-row .dg-btn')].map((b) => [b.dataset.chord, !!b.querySelector('svg')]));
  rec('diagrams for 6 chords', dg.length === 6 && dg.every((d) => d[1]), JSON.stringify(dg.map((d) => d[0])));
  const rowScroll = await page.evaluate(() => { const r = document.querySelector('#dg-row'); return [r.scrollWidth, r.clientWidth]; });
  rec('diagram row scrolls inside itself', rowScroll[0] > rowScroll[1] && (await overflow()) === 0, JSON.stringify(rowScroll));
  const size = await page.evaluate(() => { const b = document.querySelector('#dg-row .dg-btn svg').getBoundingClientRect(); return [b.width, b.height]; });
  console.log('diagram size', size);
  await page.click('#btn-theme'); // dark -> light or light -> dark depending on system
  const theme1 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `diagrams-${theme1}`);
  await page.click('#btn-theme');
  const theme2 = await page.evaluate(() => document.documentElement.dataset.theme);
  await shot(page, `diagrams-${theme2}`);
  rec('both themes captured', theme1 !== theme2, `${theme1}/${theme2}`);

  // ---- chord sheet ----
  await page.click('#dg-row .dg-btn[data-chord="G"]');
  await page.waitForSelector('#sheet-dg svg');
  const alts = await page.$$('#sheet-alts button');
  rec('chord sheet with alternative shapes', alts.length >= 2, `${alts.length} forme`);
  await shot(page, 'chord-sheet');
  await page.click('#sheet-close');
  // tap on a chord in the text opens the sheet too
  await page.click('.song-body .ch[data-orig="Em"]');
  await page.waitForSelector('#sheet-dg svg');
  rec('tap on chord in text shows diagram', true);
  await page.click('#sheet-close');

  // ---- transposition ----
  const names = () => page.evaluate(() => [...document.querySelectorAll('.song-body .ch')].map((e) => e.dataset.chord));
  const orig = await names();
  rec('chords before', orig.length === 328, String(orig.length));
  let ok = true;
  const seen = [];
  for (let n = 1; n <= 12; n++) {
    await page.click('#btn-tr-up');
    const t = await page.evaluate(() => document.querySelector('#tr-indicator').textContent);
    const cur = await names();
    seen.push(`${t}:${[...new Set(cur)].slice(0, 6).join(' ')}`);
    if (t !== '+' + n) ok = false;
  }
  rec('+12 half tones shows +12 and returns to original names', ok && JSON.stringify(await names()) === JSON.stringify(orig), seen[2] + ' | ' + seen[11]);
  for (let n = 1; n <= 12; n++) await page.click('#btn-tr-down');
  await page.click('#btn-tr-down'); // -1
  const t1 = await page.evaluate(() => document.querySelector('#tr-indicator').textContent);
  await page.click('#tr-indicator');
  const t0 = await page.evaluate(() => document.querySelector('#tr-indicator').textContent);
  rec('-1 indicator and tap resets to Originale', t1 === '−1' && t0 === 'Originale' && JSON.stringify(await names()) === JSON.stringify(orig), `${t1} -> ${t0}`);
  const colorBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.song-body .ch[data-orig="D"]')).borderColor);
  await page.click('#btn-tr-up'); await page.click('#btn-tr-up');
  const colorAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.song-body .ch[data-orig="D"]')).borderColor);
  rec('colour stays tied to the written chord', colorBefore === colorAfter, colorBefore);
  const shown = await page.evaluate(() => [...new Set([...document.querySelectorAll('.song-body .ch')].map((e) => e.dataset.chord))]);
  rec('+2 shows A E F#m Bm D B', shown.join(' ') === 'A E F#m Bm D B', shown.join(' '));
  console.log('shown at +2:', shown.join(' '));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'transposed-plus2');

  // ---- capo sheet ----
  await page.click('#btn-capo');
  await page.waitForSelector('#capo-list');
  const opts = await page.$$eval('#capo-list .capo-opt', (b) => b.map((x) => x.textContent));
  console.log('capo options at +2:', opts);
  rec('capo sheet: 3 options, best is capo 2 with G D Em Am C A', opts.length >= 3 && /^Capo 2: forme G, D, Em, Am, C, A/.test(opts[0]), opts[0]);
  await shot(page, 'capo-sheet');
  await page.click('#capo-list .capo-opt[data-capo="2"]');
  const hdr = await page.evaluate(() => [document.querySelector('#btn-capo').textContent, [...new Set([...document.querySelectorAll('.song-body .ch')].map((e) => e.dataset.chord))].join(' '), document.querySelector('.meta').textContent]);
  rec('shapes view after choosing capo 2', hdr[0] === 'Capo 2 — forme' && hdr[1] === 'G D Em Am C A' && /2 — forme/.test(hdr[2]), JSON.stringify(hdr));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'capo-shapes-view');
  const stored = await page.evaluate(() => { const i = JSON.parse(localStorage.getItem('gapp.index.v1'))[0]; const s = JSON.parse(localStorage.getItem('gapp.song.' + i.id)); return [s.transpose, s.capo, s.view.showShapes]; });
  rec('transpose and capo persisted', stored.join() === '2,2,true', stored.join());
  await page.reload();
  await page.waitForSelector('#song-title');
  rec('state survives reload', (await page.evaluate(() => document.querySelector('#btn-capo').textContent)) === 'Capo 2 — forme');

  // ---- play panel with small diagrams ----
  await page.click('#btn-play');
  await sleep(6000);
  const pp = await page.evaluate(() => ({ h: document.querySelector('#playpanel').getBoundingClientRect().height, cur: document.querySelector('#pp-current').textContent, next: document.querySelector('#pp-next').textContent, dg: [...document.querySelectorAll('#playpanel .pp-dg svg')].length, w: document.documentElement.scrollWidth - innerWidth }));
  rec('panel with diagrams <= 120 px and no overflow', pp.h <= 120 && pp.dg === 2 && pp.w === 0, JSON.stringify(pp));
  await shot(page, 'panel-diagrams');
  await page.click('#btn-play');

  // ---- library ----
  await page.click('#btn-back');
  await page.waitForSelector('#lib-search');
  for (const f of ['song-binary.mht', 'song-qp.mht', 'song-nostrum.mht']) {
    await page.setInputFiles('#import-input', path.join(SYN, f));
    await page.waitForSelector('#song-title, .dlg');
    if (await page.$('.dlg')) await page.click('.dlg [data-value="both"]');
    await page.waitForSelector('#song-title');
    await page.click('#btn-back');
    await page.waitForSelector('#lib-search');
  }
  const total = await page.$$eval('.songs li', (l) => l.length);
  console.log('songs in library:', total);
  const titles = await page.$$eval('.songs .song-title', (l) => l.map((x) => x.textContent));
  console.log('titles:', titles.join(' | '));
  await page.fill('#lib-search', 'AMERICAN');
  const hit = await page.$$eval('.songs li', (l) => l.length);
  rec('search narrows (case-insensitive)', hit === 1 && total > 1, `${hit}/${total}`);
  await shot(page, 'library-search');
  await page.fill('#lib-search', 'zzzz');
  rec('no results message', !!(await page.$('#lib-none')));
  await page.fill('#lib-search', '');
  await page.selectOption('#lib-sort', 'title');
  const sorted = await page.$$eval('.songs .song-title', (l) => l.map((x) => x.textContent));
  rec('sort by title', JSON.stringify(sorted) === JSON.stringify(sorted.slice().sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))), sorted.join('|'));
  // a song with edited durations shows the badge
  await page.click('.songs li:first-child .song-row');
  await page.waitForSelector('#btn-edit');
  await page.click('#btn-edit');
  await page.click('.song-body .ch');
  await page.click('#eb-plus');
  await page.click('#btn-edit');
  await page.click('#btn-back');
  await page.waitForSelector('#lib-search');
  const badge = await page.$$eval('[data-badge="durate"]', (l) => l.map((x) => x.textContent));
  rec('badge durate with bars', badge.length === 1 && /durate ✓ · \d+ battute/.test(badge[0]), badge.join());
  console.log('storage line:', await page.textContent('#storage-used'));
  await shot(page, 'library');

  // ---- export / import round trip ----
  const snapshot = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('gapp.song.')) o[k] = localStorage.getItem(k); } return o; });
  const before = await snapshot();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const file = path.join(OUT, 'export.json');
  await download.saveAs(file);
  console.log('download name:', download.suggestedFilename());
  rec('export file name', /^accordi-a-tempo-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()));
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec('export content', exported.app === 'guitarapp' && exported.exportVersion === 1 && exported.songs.length === Object.keys(before).length, `${exported.songs.length} songs`);

  const ctx2 = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } });
  const page2 = await ctx2.newPage();
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(e.message));
  await page2.goto(URL);
  await page2.setInputFiles('#import-json', file);
  await page2.waitForSelector('.dlg');
  const summary = await page2.textContent('.dlg-msg');
  console.log('import summary:', summary);
  await shot(page2, 'import-dialog');
  await page2.click('.dlg [data-value="newer"]');
  await page2.waitForSelector('.songs li');
  const after = await page2.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('gapp.song.')) o[k] = localStorage.getItem(k); } return o; });
  rec('round trip identical songs', JSON.stringify(Object.keys(before).sort()) === JSON.stringify(Object.keys(after).sort()) && Object.keys(before).every((k) => before[k] === after[k]), `${Object.keys(after).length} songs`);
  console.log('after import:', await page2.textContent('#lib-msg'));
  // importing again: all present
  await page2.setInputFiles('#import-json', file);
  await page2.waitForSelector('.dlg');
  console.log('second import summary:', await page2.textContent('.dlg-msg'));
  await shot(page2, 'import-dialog-present');
  await page2.click('.dlg [data-value="skip"]');
  await sleep(200);
  // malformed file
  fs.writeFileSync(path.join(OUT, 'bad.json'), '{ not json');
  await page2.setInputFiles('#import-json', path.join(OUT, 'bad.json'));
  await sleep(300);
  const badMsg = await page2.textContent('#lib-msg');
  rec('malformed import gives a readable error', /JSON valido/.test(badMsg) && (await page2.$$eval('.songs li', (l) => l.length)) === Object.keys(before).length, badMsg);
  await shot(page2, 'import-error');
  rec('no page errors', errs.length === 0 && errs2.length === 0, JSON.stringify([...errs, ...errs2]));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
