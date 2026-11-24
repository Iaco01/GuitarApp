// Round 1 UI checks (C1-C12) on dist/index.html. Run: npm run build && node test/e2e/ui-round1.cjs
// Needs the git-ignored real file. Screenshots go to test-artifacts/round-1/ (never committed).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const SYN = path.join(ROOT, 'test', 'fixtures', 'synthetic', 'song-binary.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-1');
fs.mkdirSync(OUT, { recursive: true });

const profiles = {
  'pixel7': { ...devices['Pixel 7'] },
  'iphone13': { ...devices['iPhone 13'] },
  'w360': { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } },
};
let fails = 0;
const results = [];
const rec = (dev, id, ok, info) => { results.push({ dev, id, ok, info }); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info || ''}`); };

// Runs inside the page: aligns each chord label with the lyric character at its column.
function alignmentProbe() {
  const idm = /#\/song\/(.+)$/.exec(location.hash);
  const song = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(idm[1])));
  const stat = { spaceChords: 0, spaceMaxShift: 0, midWord: 0, splitWords: 0, checked: 0, bad: 0, skippedPastEnd: 0, skippedUnmapped: 0, worst: 0, badList: [] };
  for (const line of document.querySelectorAll('.line')) {
    const labels = [...line.querySelectorAll('.ch')];
    if (!labels.length) continue;
    const first = labels[0].getAttribute('data-ref').split('.').map(Number);
    const data = song.sections[first[0]].lines[first[1]];
    const lyric = data.lyric;
    // flat list of non-label chars, skipping placeholder spaces of empty-word segments
    const chars = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement.closest('.ch')) continue;
      // a .ly that holds only a space is the placeholder for a chord sitting on whitespace
      if (n.parentElement.closest('.ly') && (n.data === ' ' || n.data === '\u00a0')) continue;
      for (let i = 0; i < n.data.length; i++) chars.push([n, i]);
    }
    const mapped = chars.length === lyric.length && chars.every(([nd, i], k) => nd.data[i] === lyric[k]);
    for (const lab of labels) {
      const ref = lab.getAttribute('data-ref').split('.').map(Number);
      const col = data.chords[ref[2]].col;
      if (lyric === '') continue; // instrumental
      if (!mapped) { stat.skippedUnmapped++; continue; }
      if (col >= lyric.length) { stat.skippedPastEnd++; continue; }
      const [nd, i] = chars[col];
      const r = document.createRange();
      r.setStart(nd, i); r.setEnd(nd, i + 1);
      const cr = r.getBoundingClientRect();
      const lr = lab.getBoundingClientRect();
      if (lr.width === 0) continue; // hidden (collapsed)
      const d = Math.abs(cr.left - lr.left);
      if (/\s/.test(lyric[col])) { // chord on whitespace: reported separately
        stat.spaceChords++; if (d > stat.spaceMaxShift) stat.spaceMaxShift = d; continue;
      }
      if (col > 0 && /\S/.test(lyric[col - 1])) { // chord in the middle of a word: is the word split across rows?
        stat.midWord++;
        const [pn, pi] = chars[col - 1];
        const r0 = document.createRange(); r0.setStart(pn, pi); r0.setEnd(pn, pi + 1);
        if (Math.abs(r0.getBoundingClientRect().top - cr.top) > 4) stat.splitWords++;
      }
      stat.checked++;
      if (d > stat.worst) stat.worst = d;
      if (d > 2) { stat.bad++; if (stat.badList.length < 5) stat.badList.push({ name: lab.getAttribute('data-chord'), col, d: Math.round(d * 10) / 10 }); }
    }
  }
  return stat;
}

function overlapProbe() {
  const rects = [...document.querySelectorAll('.song-body .ch')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  let hits = 0;
  // sort by top for speed
  rects.sort((a, b) => a.top - b.top);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length && rects[j].top < rects[i].bottom; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 0.5 && oy > 0.5) hits++;
    }
  }
  return { n: rects.length, hits };
}

const widths = () => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth });

async function run(name, prof) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${name}-${n}.png`) });

  // C1 empty library
  await page.goto(URL);
  await page.waitForSelector('.empty');
  const emptyText = await page.innerText('.empty');
  await shot('c1-empty');
  rec(name, 'C1', /Nessun brano/.test(emptyText) && /\.mht/.test(emptyText) && /Importa/.test(await page.innerText('.lib-head')), `empty text ${emptyText.length} chars`);
  rec(name, 'C3-lib', (await page.evaluate(widths)).sw <= prof.viewport.width, JSON.stringify(await page.evaluate(widths)));

  // C2 import
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title', { timeout: 10000 });
  const head = await page.evaluate(() => ({ t: document.getElementById('song-title').textContent, a: document.getElementById('song-artist').textContent, meta: document.querySelector('.meta').innerText, secs: document.querySelectorAll('.sec').length, labels: document.querySelectorAll('.ch').length, chips: document.querySelectorAll('.chip').length, h3: [...document.querySelectorAll('.sec-title,.sec.rep>summary')].map((e) => e.textContent) }));
  await shot('c2-song-top');
  rec(name, 'C2', head.t === 'American Pie' && head.a === 'Don McLean' && /Beginner/.test(head.meta) && /E A D G B E/.test(head.meta) && head.chips === 6, JSON.stringify({ t: head.t, a: head.a, meta: head.meta.replace(/\n/g, ' '), secs: head.secs, labels: head.labels, chips: head.chips }));
  console.log('   section headings:', head.h3.join(' | '));
  const sid = await page.evaluate(() => decodeURIComponent(location.hash.replace('#/song/', '')));

  // C7 collapse count: with collapse on, labels rendered vs total 328
  const expandedCount = async () => { await page.click('#btn-collapse'); const open = await page.evaluate(() => { document.querySelectorAll('details.rep').forEach((d) => { d.open = true; }); return document.querySelectorAll('.ch').length; }); return open; };
  const labelsCollapsedDom = await page.evaluate(() => document.querySelectorAll('.ch').length);
  const repCount = await page.evaluate(() => document.querySelectorAll('details.rep').length);
  const modeBefore = await page.textContent('#btn-collapse');
  // open all details to count visible chords when compressed
  const openAllCount = await page.evaluate(() => { document.querySelectorAll('details.rep').forEach((d) => { d.open = true; }); return document.querySelectorAll('.ch').length; });
  console.log('   collapse: mode', modeBefore, 'details', repCount, 'labels dom', labelsCollapsedDom, 'labels with all details opened', openAllCount);
  await page.click('#btn-collapse');
  const afterOpenMode = await page.textContent('#btn-collapse');
  const labelsExpanded = await page.evaluate(() => document.querySelectorAll('.ch').length);
  const totalSecEls = await page.evaluate(() => document.querySelectorAll('.sec').length);
  await shot('c7-expanded');
  rec(name, 'C7', afterOpenMode !== modeBefore && labelsExpanded === 328 && totalSecEls === 12, `mode "${modeBefore}" -> "${afterOpenMode}"; expanded: ${totalSecEls} sections, ${labelsExpanded} labels; compressed: ${repCount} details, ${labelsCollapsedDom} labels, after opening details ${openAllCount}`);
  // back to compressed, check toggling a details open/close
  await page.click('#btn-collapse');
  const det = page.locator('details.rep').first();
  await det.locator('summary').click();
  const opened = await det.evaluate((d) => d.open);
  await det.locator('summary').click();
  const closed = await det.evaluate((d) => !d.open);
  rec(name, 'C7-toggle', opened && closed, `summary click opens=${opened} closes=${closed}`);
  await page.click('#btn-collapse'); // leave expanded for the layout tests
  const modeNow = await page.textContent('#btn-collapse');

  // C3/C4/C5 at several scales
  for (const scale of [1.0, 1.5, 2.0]) {
    // set scale by clicking A+/A- from current
    let cur = await page.evaluate(() => parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')));
    while (cur < scale - 0.01) { await page.click('#btn-font-up'); cur = Math.round((cur + 0.1) * 10) / 10; }
    while (cur > scale + 0.01) { await page.click('#btn-font-down'); cur = Math.round((cur - 0.1) * 10) / 10; }
    const w = await page.evaluate(widths);
    rec(name, `C3@${scale}`, w.sw <= w.iw && w.bw <= w.iw, JSON.stringify(w));
    const al = await page.evaluate(alignmentProbe);
    rec(name, `C4@${scale}`, al.bad === 0, `checked ${al.checked}, out of tolerance ${al.bad}, worst ${al.worst.toFixed(1)}px, chords on whitespace (reported apart) ${al.spaceChords} max shift ${al.spaceMaxShift.toFixed(1)}px, mid-word chords ${al.midWord} of which word split across rows ${al.splitWords}, skipped past-end ${al.skippedPastEnd}, unmapped ${al.skippedUnmapped}${al.badList.length ? ' e.g. ' + JSON.stringify(al.badList) : ''}`);
    const ov = await page.evaluate(overlapProbe);
    rec(name, `C5@${scale}`, ov.hits === 0, `${ov.n} labels, ${ov.hits} overlapping pairs`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.querySelector('.song-body').scrollIntoView());
    await shot(`c4-scale-${scale}`);
  }
  // max: try to go beyond
  for (let i = 0; i < 5; i++) await page.click('#btn-font-up');
  const maxScale = await page.evaluate(() => parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')));
  for (let i = 0; i < 20; i++) await page.click('#btn-font-down');
  const minScale = await page.evaluate(() => parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')));
  const wmin = await page.evaluate(alignmentProbe);
  rec(name, 'C6-limits', maxScale === 2 && minScale === 0.7, `max ${maxScale} min ${minScale}; at min: checked ${wmin.checked}, bad ${wmin.bad}`);
  await page.evaluate(() => document.querySelector('.song-body').scrollIntoView());
  await shot('c4-scale-min');

  // C6 persistence: font 1.3, light theme -> reload
  for (let i = 0; i < 6; i++) await page.click('#btn-font-up'); // 0.7 -> 1.3
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#btn-theme');
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  await page.waitForSelector('#song-title');
  const afterReload = await page.evaluate(() => ({ fs: parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')), th: document.documentElement.dataset.theme, collapsed: document.getElementById('btn-collapse').textContent }));
  rec(name, 'C6-persist', afterReload.fs === 1.3 && afterReload.th === themeAfter && themeAfter !== themeBefore, `fs ${afterReload.fs}, theme ${themeBefore}->${themeAfter}, after reload ${afterReload.th}; collapse "${afterReload.collapsed}" (was "${modeNow}")`);
  await shot('c6-after-reload');
  // theme both ways visible
  await page.click('#btn-theme');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('c6-theme-other');
  await page.click('#btn-theme');

  // second song: per-song settings
  await page.click('#btn-back');
  await page.waitForSelector('#import-input');
  await page.setInputFiles('#import-input', SYN);
  await page.waitForSelector('#song-title');
  const syn = await page.evaluate(() => ({ t: document.getElementById('song-title').textContent, fs: parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')) }));
  rec(name, 'C6-per-song', syn.fs === 1 && syn.fs !== afterReload.fs, `second song "${syn.t}" fs ${syn.fs}; first song kept ${afterReload.fs}`);
  await shot('c6-synthetic-song');
  await page.click('#btn-back');
  await page.waitForSelector('.songs');
  const rows = await page.locator('.song-row').count();
  await shot('c9-library-two');
  // reopen first song, check font persisted independently
  await page.locator('.song-row', { hasText: 'American Pie' }).click();
  await page.waitForSelector('#song-title');
  const fs1 = await page.evaluate(() => parseFloat(document.querySelector('.screen.song').style.getPropertyValue('--fs')));
  rec(name, 'C6-per-song-2', fs1 === 1.3, `first song font after switching ${fs1}`);

  // C8 chord tap
  await page.evaluate(() => window.scrollTo(0, 0));
  const label = page.locator('.song-body .ch').first();
  await label.scrollIntoViewIfNeeded();
  await label.tap();
  await page.waitForSelector('.sheet');
  const sheetName = await page.innerText('.sheet-name');
  await shot('c8-sheet');
  await page.click('.sheet .btn');
  const gone1 = (await page.locator('.sheet').count()) === 0;
  await label.tap();
  await page.waitForSelector('.sheet');
  await page.mouse.click(5, 5); // backdrop
  const gone2 = (await page.locator('.sheet').count()) === 0;
  // chip tap
  await page.locator('.chip').first().scrollIntoViewIfNeeded();
  await page.locator('.chip').first().tap();
  const chipOpens = (await page.locator('.sheet').count()) === 1;
  await page.keyboard.press('Escape');
  const gone3 = (await page.locator('.sheet').count()) === 0;
  rec(name, 'C8', !!sheetName && gone1 && gone2 && chipOpens && gone3, `sheet "${sheetName}"; close button ${gone1}, backdrop ${gone2}, chip ${chipOpens}, Esc ${gone3}`);
  // touch target of a label (tap area)
  const hit = await page.evaluate(() => { const l = document.querySelector('.song-body .ch'); const r = l.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  console.log('   label box', JSON.stringify(hit));

  // C10 history.back from song
  await page.goBack().catch(() => {});
  // We arrived at the song via click (hash push), so back should reach the library
  await page.waitForTimeout(200);
  const afterBack = await page.evaluate(() => ({ h: location.hash, lib: !!document.querySelector('.lib') }));
  // second scenario: import flow history: library -> import -> song -> back
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('#import-input');
  await page.setInputFiles('#import-input', SYN);
  await page.waitForSelector('#song-title');
  await page.goBack();
  await page.waitForTimeout(200);
  const afterBack2 = await page.evaluate(() => ({ h: location.hash, lib: !!document.querySelector('.lib') }));
  rec(name, 'C10', afterBack.lib && afterBack2.lib, `after open-from-list back: ${JSON.stringify(afterBack)}; after import back: ${JSON.stringify(afterBack2)}`);

  // C9 persistence + delete with confirm
  await page.reload();
  await page.waitForSelector('.songs');
  const listed = await page.locator('.song-row').count();
  rec(name, 'C9-persist', listed >= 2, `${listed} songs after reload (was ${rows} before)`);
  const dialogs = [];
  page.once('dialog', async (d) => { dialogs.push(d.message().length ? 'dismiss' : ''); await d.dismiss(); });
  await page.locator('button[aria-label^="Elimina"]').first().click();
  await page.waitForTimeout(150);
  const afterDismiss = await page.locator('.song-row').count();
  page.once('dialog', async (d) => { dialogs.push('accept'); await d.accept(); });
  await page.locator('button[aria-label^="Elimina"]').first().click();
  await page.waitForTimeout(150);
  const afterAccept = await page.locator('.song-row').count();
  // delete from song screen
  await page.locator('.song-row').first().click();
  await page.waitForSelector('#btn-delete');
  page.once('dialog', async (d) => { await d.accept(); });
  await page.click('#btn-delete');
  await page.waitForSelector('.empty', { timeout: 3000 }).catch(() => {});
  const emptyAgain = (await page.locator('.song-row').count()) === afterAccept - 1;
  const lsLeft = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gapp.song.')).length);
  await page.reload();
  const stillEmpty = (await page.locator('.song-row').count()) === afterAccept - 1;
  rec(name, 'C9-delete', afterDismiss === listed && afterAccept === listed - 1 && emptyAgain && stillEmpty && lsLeft === afterAccept - 1, `dismiss kept ${afterDismiss}/${listed}; accept -> ${afterAccept}; song-screen delete -> rows ok ${emptyAgain}; leftover song keys ${lsLeft}`);

  // import error messages for bad files
  await page.setInputFiles('#import-input', { name: 'rand.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world, nothing here') });
  await page.waitForTimeout(300);
  const err1 = await page.innerText('#lib-msg');
  await page.setInputFiles('#import-input', { name: 'empty.mht', mimeType: 'message/rfc822', buffer: Buffer.from('') });
  await page.waitForTimeout(300);
  const err2 = await page.innerText('#lib-msg');
  await shot('c1-import-error');
  rec(name, 'C2-errors', /Impossibile importare/.test(err1) && /Impossibile importare/.test(err2), `txt: "${err1.slice(0, 90)}" | empty: "${err2.slice(0, 90)}"`);
  // same file twice (value reset)
  await page.setInputFiles('#import-input', SYN);
  await page.waitForSelector('#song-title');
  await page.goBack(); await page.waitForSelector('#import-input');
  await page.setInputFiles('#import-input', SYN);
  await page.waitForSelector('#song-title');
  await page.click('#btn-back'); await page.waitForSelector('.songs');
  const dupRows = await page.locator('.song-row').count();
  console.log('   same file imported twice -> rows:', dupRows);

  // C12
  rec(name, 'C12', errors.length === 0, errors.length ? errors.join(' || ').slice(0, 300) : '0 console errors/warnings');
  rec(name, 'NET', requests.length === 0, requests.length ? requests.join(',') : 'no network requests');
  await browser.close();
}

(async () => {
  if (!fs.existsSync(REAL)) { console.log('real file missing'); return; }
  for (const [n, p] of Object.entries(profiles)) {
    try { await run(n, p); } catch (e) { rec(n, 'SCRIPT', false, e.stack.split('\n').slice(0, 4).join(' / ')); }
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
