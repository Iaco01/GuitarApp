// Dumps structure numbers (no lyrics) of the imported real file. Helper for the round 2 tester.
const { chromium, devices } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  await page.goto('file://' + path.join(ROOT, 'dist', 'index.html'));
  await page.setInputFiles('#import-input', path.join(ROOT, 'test/fixtures/local/american-pie.mht'));
  await page.waitForSelector('#song-title');
  const d = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2])));
    return { bpm: s.bpm, strum: s.strumming.map((p) => ({ section: p.section, bpm: p.bpm, n: p.beats.length })), secs: s.sections.map((x, i) => ({ i, name: x.name, bpm: x.bpm, src: x.bpmSource, si: x.strumIndex, lines: x.lines.length, chords: x.lines.reduce((a, l) => a + l.chords.length, 0), sig: x.lines.flatMap((l) => l.chords.map((c) => c.name)).join(' ') })) };
  });
  console.log(JSON.stringify(d.strum), 'song.bpm', d.bpm);
  for (const x of d.secs) console.log(x.i, x.name, x.bpm, x.src, x.si, x.lines, x.chords);
  const sigs = {}; d.secs.forEach((x) => { (sigs[x.name.replace(/\s*\d+$/, '')] ||= []).push(x.sig); });
  for (const [k, v] of Object.entries(sigs)) console.log(k, v.map((s) => s.length).join(','), 'identical to first:', v.map((s) => s === v[0]).join(','));
  await b.close();
})();
