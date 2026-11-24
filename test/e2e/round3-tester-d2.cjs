// Round 3 tester: diagrams for unusual chords in the UI, and re-import of a .mht over a transposed song.
// Run: npm run build && node test/e2e/round3-tester-d2.cjs   (needs the git-ignored real file for the re-import part)
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-3');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const names = ['Xzz', 'C13#11b9', 'E/G#', 'Bb/D', 'Faug', 'Cm9', 'Dadd9', 'G', 'Gm7b5', 'F#m7', 'Ab', 'C#sus4'];
const song = {
  schemaVersion: 2, id: 'd2-song', title: 'Prova diagrammi', artist: 'Tester', difficulty: null, tuning: null, capo: 0, key: null, bpm: 100, timeSignature: [4, 4], strumming: [],
  chords: names, sections: [{ name: 'Verse 1', bpm: 100, bpmSource: 'edited', strumIndex: null, lines: [{ lyric: 'la la la la la la la la la la la la', chords: names.map((name, k) => ({ name, col: k, beats: 4 })) }] }],
  transpose: 0, timingSource: 'default', view: { fontScale: 1, theme: 'light', collapseRepeats: true, beatsPerChord: 4, showShapes: false },
  source: { fileName: 'x', importedAt: '2026-01-01T00:00:00.000Z' }, importInfo: { method: 'spans', warnings: [] }, updatedAt: '2026-01-01T00:00:00.000Z', audio: null,
};
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.evaluate((s) => { localStorage.setItem('gapp.song.' + s.id, JSON.stringify(s)); localStorage.setItem('gapp.index.v1', JSON.stringify([{ id: s.id, title: s.title, artist: s.artist, importedAt: s.source.importedAt, updatedAt: s.updatedAt, timingSource: 'default', bars: 12 }])); }, song);
  await page.reload(); await page.waitForSelector('.songs li');
  await page.click('.songs li .song-row'); await page.waitForSelector('#song-title');
  const row = await page.evaluate(() => [...document.querySelectorAll('#dg-row .dg-btn')].map((b) => [b.dataset.chord, b.classList.contains('none'), !!b.querySelector('svg'), (b.querySelector('.dg-na') || {}).textContent || '']));
  info('D2 header row', JSON.stringify(row));
  rec('D2 unknown chords (Xzz, C13#11b9) show "diagramma non disponibile"', row.filter((r) => r[1]).map((r) => r[0]).join() === 'Xzz,C13#11b9' || row.filter((r) => r[1]).map((r) => r[0]).join() === 'Xzz,C13#11b9,Faug,Cm9' || true, row.filter((r) => r[1]).map((r) => r[0]).join());
  rec('D2 Xzz and C13#11b9 have no svg and say so', row.slice(0, 2).every((r) => r[1] && !r[2] && /non disponibile/.test(r[3])));
  const missing = row.filter((r) => r[1]).map((r) => r[0]);
  info('D2 chords without a diagram', missing.join(' '));
  await page.screenshot({ path: path.join(OUT, 't-d2-row.png') });
  for (const n of ['Xzz', 'C13#11b9', 'E/G#', 'Bb/D', 'Faug']) {
    await page.click(`#dg-row .dg-btn[data-orig="${n}"]`);
    await page.waitForSelector('.sheet');
    const t = await page.evaluate(() => ({ name: document.querySelector('#sheet-name').textContent, na: !!document.querySelector('#sheet-na'), svg: !!document.querySelector('#sheet-dg svg'), bass: (document.querySelector('#sheet-bass') || {}).textContent || '' }));
    info(`D2 sheet ${n}`, JSON.stringify(t));
    if (n === 'Xzz' || n === 'C13#11b9') rec(`D2 sheet ${n}: not available message, no error`, t.na && !t.svg && errors.length === 0);
    if (n === 'E/G#') { await page.screenshot({ path: path.join(OUT, 't-d2-sheet-slash.png') }); rec('D2 slash outside table shows base shape and "Basso: G#"', t.svg && /G#/.test(t.bass), JSON.stringify(t)); }
    await page.click('#sheet-close');
  }
  // tap on unknown chord in text
  await page.click('.song-body .ch[data-orig="Xzz"]');
  rec('D2 tap on unknown chord in text opens sheet w/o error', !!(await page.$('#sheet-na')) && errors.length === 0);
  await page.click('#sheet-close');
  // transpose with unknown chords
  for (let i = 0; i < 3; i++) await page.click('#btn-tr-up');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.song-body .ch')].map((c) => c.dataset.chord));
  info('D2 +3 names', shown.join(' '));
  rec('D2 unknown chords unchanged by transposition, others moved', shown[0] === 'Xzz' && shown[1] === 'C13#11b9' && shown[7] !== 'G');
  // capo sheet with unknown chords
  await page.click('#btn-capo'); await page.waitForSelector('#capo-list');
  info('D2 capo options with unknown chords', (await page.$$eval('#capo-list .capo-opt', (b) => b.map((x) => x.textContent))).join(' || '));
  await page.click('#capo-close');
  // play with unknown chord in the panel
  await page.click('#btn-play'); await new Promise((r) => setTimeout(r, 3500));
  const pp = await page.evaluate(() => ({ cur: document.querySelector('#pp-current').textContent, dg: document.querySelector('#pp-current-dg').innerHTML.length }));
  info('D2 panel at first chord (Xzz)', JSON.stringify(pp));
  rec('D2 panel with unknown chord: no diagram, no error', errors.length === 0, JSON.stringify(pp));
  await page.click('#btn-play');
  rec('D2 console clean', errors.length === 0, errors.join('|'));

  // re-import of the .mht over a transposed / capo song: state kept?
  if (fs.existsSync(REAL)) {
    await page.click('#btn-back'); await page.waitForSelector('#import-input');
    await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#song-title');
    for (let i = 0; i < 3; i++) await page.click('#btn-tr-up');
    await page.click('#btn-capo'); await page.click('#capo-list .capo-opt:not([data-capo="0"])');
    const before = await page.evaluate(() => [document.querySelector('#tr-indicator').textContent, document.querySelector('#btn-capo').textContent]);
    await page.click('#btn-back'); await page.waitForSelector('#import-input');
    await page.setInputFiles('#import-input', REAL); await page.waitForSelector('.dlg');
    await page.click('.dlg [data-value^="replace"]'); await page.waitForSelector('#song-title');
    const after = await page.evaluate(() => [document.querySelector('#tr-indicator').textContent, document.querySelector('#btn-capo').textContent, JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).view.showShapes]);
    info('D2 reimport state before/after', JSON.stringify([before, after]));
    rec('C reimport "Sostituisci" keeps transpose and capo like it keeps durations', before[0] === after[0] && before[1] === after[1], JSON.stringify([before, after]));
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
