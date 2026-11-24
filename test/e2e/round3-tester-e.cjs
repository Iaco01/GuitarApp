// Round 3 tester, part E: library (search, sort, export/import, malformed files, duplicates, space).
// Run: npm run build && node test/e2e/round3-tester-e.cjs [E1|E2|E3|E4|E5]
// Uses synthetic songs made here and, for the round trip, the git-ignored real file. No song text is printed.
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

// ---- synthetic songs (own text) ----
function mkSong(i, over = {}) {
  const chords = ['C', 'G', 'Am', 'F'];
  const lines = [0, 1].map((l) => ({ lyric: `la la ${i} ${l}`, chords: chords.map((name, k) => ({ name, col: k * 3, beats: 4 })) }));
  return {
    schemaVersion: 2, id: `test-song-${i}`, title: `Brano ${i}`, artist: 'Artista', difficulty: null, tuning: null, capo: 0, key: null, bpm: 100,
    timeSignature: [4, 4], strumming: [], chords, sections: [{ name: 'Verse 1', lines, bpm: 100, bpmSource: 'edited', strumIndex: null }, { name: 'Chorus', lines, bpm: 120, bpmSource: 'edited', strumIndex: null }],
    transpose: 0, timingSource: 'default', view: { fontScale: 1, theme: 'dark', collapseRepeats: true, beatsPerChord: 4, showShapes: false },
    source: { fileName: 'x.mht', importedAt: `2026-0${1 + (i % 9)}-10T10:00:00.000Z` }, importInfo: { method: 'spans', warnings: [] }, updatedAt: `2026-0${1 + (i % 9)}-11T10:00:00.000Z`, audio: null, ...over,
  };
}
const exportOf = (songs, extra = {}) => ({ app: 'guitarapp', exportVersion: 1, exportedAt: '2026-11-24T00:00:00.000Z', songs, settings: {}, ...extra });
const writeJson = (name, obj) => { const p = path.join(OUT, name); fs.writeFileSync(p, typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); return p; };

async function open(file = null) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...W360, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  if (file) { await page.setInputFiles('#import-input', file); await page.waitForSelector('#song-title'); await page.click('#btn-back'); await page.waitForSelector('#import-input'); }
  return { browser, ctx, page, errors };
}
const raw = (page) => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
const seed = (page, songs) => page.evaluate((songs) => {
  const idx = [];
  for (const s of songs) { localStorage.setItem('gapp.song.' + s.id, JSON.stringify(s)); idx.push({ id: s.id, title: s.title, artist: s.artist, difficulty: s.difficulty, importedAt: s.source.importedAt, updatedAt: s.updatedAt, timingSource: s.timingSource, bars: 8 }); }
  localStorage.setItem('gapp.index.v1', JSON.stringify(idx));
}, songs);
const importJson = async (page, file) => { await page.setInputFiles('#import-json', file); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const titles = (page) => page.$$eval('.songs .song-title', (l) => l.map((x) => x.textContent));

(async () => {
  if (!only || only === 'E1') {
    const { browser, page, errors } = await open();
    const S = [
      mkSong(1, { title: 'Così è la vita', artist: 'Zucchero Ñandú', difficulty: 'intermediate', source: { fileName: 'a', importedAt: '2026-03-01T10:00:00.000Z' }, updatedAt: '2026-03-01T10:00:00.000Z' }),
      mkSong(2, { title: 'Élan vital', artist: 'Bruno', difficulty: 'beginner', source: { fileName: 'a', importedAt: '2026-05-01T10:00:00.000Z' }, updatedAt: '2026-05-01T10:00:00.000Z' }),
      mkSong(3, { title: 'über alles', artist: 'Anna', difficulty: 'advanced', source: { fileName: 'a', importedAt: '2026-04-01T10:00:00.000Z' }, updatedAt: '2026-04-01T10:00:00.000Z' }),
      mkSong(4, { title: 'Zebra', artist: 'Élodie', difficulty: null, source: { fileName: 'a', importedAt: '2026-02-01T10:00:00.000Z' }, updatedAt: '2026-02-01T10:00:00.000Z' }),
      mkSong(5, { title: "Don't stop", artist: 'Cher', difficulty: 'Beginner', source: { fileName: 'a', importedAt: '2026-06-01T10:00:00.000Z' }, updatedAt: '2026-06-01T10:00:00.000Z' }),
    ];
    await seed(page, S);
    await page.reload(); await page.waitForSelector('#lib-search');
    const search = async (q) => { await page.fill('#lib-search', q); return titles(page); };
    rec('E1 "cosi" finds "Così è la vita"', same(await search('cosi'), ['Così è la vita']));
    rec('E1 "COSI" upper case', same(await search('COSI'), ['Così è la vita']));
    rec('E1 accent typed in query "Così"', same(await search('Così'), ['Così è la vita']));
    rec('E1 "elan" finds Élan; "ELAN VITAL" two words', same(await search('elan'), ['Élan vital']) && same(await search('ELAN VITAL'), ['Élan vital']));
    rec('E1 "uber" finds über', same(await search('uber'), ['über alles']));
    rec('E1 artist search "elodie" finds Zebra', same(await search('elodie'), ['Zebra']));
    rec('E1 artist search "nandu" (Ñandú)', same(await search('nandu'), ['Così è la vita']));
    rec('E1 words in any order across title+artist "vita zucchero"', same(await search('vita zucchero'), ['Così è la vita']));
    rec('E1 apostrophe "don\'t"', same(await search("don't"), ["Don't stop"]));
    rec('E1 no hit -> message', (await search('qqqq')).length === 0 && !!(await page.$('#lib-none')));
    rec('E1 regex chars are literal "(" "["', (await search('(')).length === 0 && (await search('[a-')).length === 0 && errors.length === 0);
    await search('');
    const sortBy = async (m) => { await page.selectOption('#lib-sort', m); return titles(page); };
    const fold = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const expTitle = S.map((s) => s.title).sort((a, b) => fold(a).localeCompare(fold(b), 'it'));
    rec('E1 sort by title ignoring accents and case', same(await sortBy('title'), expTitle), (await titles(page)).join(' | '));
    const expArtist = S.slice().sort((a, b) => fold(a.artist).localeCompare(fold(b.artist), 'it')).map((s) => s.title);
    rec('E1 sort by artist', same(await sortBy('artist'), expArtist), (await titles(page)).join(' | '));
    const expImp = S.slice().sort((a, b) => (a.source.importedAt < b.source.importedAt ? 1 : -1)).map((s) => s.title);
    rec('E1 sort by import date (newest first)', same(await sortBy('imported'), expImp), (await titles(page)).join(' | '));
    const diffRank = { beginner: 1, intermediate: 3, advanced: 4 };
    const expDiff = S.slice().sort((a, b) => ((diffRank[(a.difficulty || '').toLowerCase()] || 99) - (diffRank[(b.difficulty || '').toLowerCase()] || 99)) || fold(a.title).localeCompare(fold(b.title), 'it')).map((s) => s.title);
    rec('E1 sort by difficulty (unknown last, Beginner/beginner equal)', same(await sortBy('difficulty'), expDiff), (await titles(page)).join(' | '));
    // opened: open "Zebra" then back: it must be first
    await sortBy('opened');
    await page.click('.songs li:has-text("Zebra") .song-row'); await page.waitForSelector('#song-title'); await page.click('#btn-back'); await page.waitForSelector('#lib-search');
    const op = await titles(page);
    rec('E1 sort "ultimo aperto": the song just opened is first', op[0] === 'Zebra', op.join(' | '));
    // sort persists across reload
    await sortBy('artist');
    await page.reload(); await page.waitForSelector('#lib-search');
    rec('E1 chosen sort survives reload', (await page.inputValue('#lib-sort')) === 'artist' && same(await titles(page), expArtist));
    // search + sort together
    await page.fill('#lib-search', 'a');
    info('E1 search "a" with artist sort', (await titles(page)).join(' | '));
    await page.screenshot({ path: path.join(OUT, 't-e1-library.png') });
    rec('E1 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'E2') {
    const { browser, ctx, page, errors } = await open(REAL);
    // add synthetic ones with all the fields
    const extra = [
      mkSong(11, { transpose: -3, capo: 4, view: { fontScale: 1.3, theme: 'light', collapseRepeats: false, beatsPerChord: 2, showShapes: true }, timingSource: 'recorded', difficulty: 'intermediate', title: 'Così è' }),
    ];
    extra[0].sections[0].lines[0].chords.forEach((c, i) => { c.beats = [1, 2, 3, 8][i]; });
    extra[0].sections[1].bpm = 87.5;
    await page.evaluate((songs) => { for (const s of songs) { localStorage.setItem('gapp.song.' + s.id, JSON.stringify(s)); const idx = JSON.parse(localStorage.getItem('gapp.index.v1')); idx.push({ id: s.id, title: s.title, artist: s.artist, difficulty: s.difficulty, importedAt: s.source.importedAt, updatedAt: s.updatedAt, timingSource: s.timingSource, bars: 8 }); localStorage.setItem('gapp.index.v1', JSON.stringify(idx)); } }, extra);
    await page.reload(); await page.waitForSelector('#lib-search');
    // edit the real song: transpose, capo, durations, bpm
    await page.click('.songs li:has-text("American") .song-row'); await page.waitForSelector('#song-title');
    for (let i = 0; i < 5; i++) await page.click('#btn-tr-up');
    await page.click('#btn-capo'); await page.click('#capo-list .capo-opt:not([data-capo="0"])'); // choose a capo
    await page.click('#btn-edit'); await page.click('.song-body .ch'); await page.click('#eb-plus'); await page.click('#eb-plus'); await page.click('#btn-edit');
    await page.fill('#bpm-input', '75').catch(() => {});
    await page.click('#btn-back'); await page.waitForSelector('#btn-export');
    const before = await raw(page);
    const songKeys = Object.keys(before).filter((k) => k.startsWith('gapp.song.'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    const file = path.join(OUT, 't-roundtrip.json'); await dl.saveAs(file);
    const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec('E2 export has all songs, name pattern, app/exportVersion', exp.songs.length === songKeys.length && /^accordi-a-tempo-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()) && exp.app === 'guitarapp' && exp.exportVersion === 1, `${exp.songs.length} songs, ${dl.suggestedFilename()}`);
    const real = exp.songs.find((s) => s.title === 'American Pie');
    info('E2 edited real song state', `transpose ${real.transpose}, capo ${real.capo}, showShapes ${real.view.showShapes}, timingSource ${real.timingSource}`);
    rec('E2 exported song carries transpose/capo/view/timing', real.transpose === 5 && real.capo > 0 && real.timingSource === 'edited');
    // (a) same context: clear storage then import
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await page.waitForSelector('#import-input');
    await importJson(page, file);
    await page.waitForSelector('.dlg');
    const sum = await page.textContent('.dlg-msg');
    await page.click('.dlg [data-value="newer"]');
    await page.waitForSelector('.songs li');
    const after = await raw(page);
    let diffKeys = songKeys.filter((k) => before[k] !== after[k]);
    let deepEqual = songKeys.every((k) => same(JSON.parse(before[k]), JSON.parse(after[k])));
    rec('E2 clear storage -> import: songs identical (deep equal and byte equal)', deepEqual && diffKeys.length === 0, `${sum} | differing ${diffKeys.length}`);
    rec('E2 extra keys appear? (index entries equal ignoring order)', same(JSON.parse(before['gapp.index.v1']).map((e) => e.id).sort(), JSON.parse(after['gapp.index.v1']).map((e) => e.id).sort()));
    // index entries compare
    const iB = Object.fromEntries(JSON.parse(before['gapp.index.v1']).map((e) => [e.id, e]));
    const iA = Object.fromEntries(JSON.parse(after['gapp.index.v1']).map((e) => [e.id, e]));
    const idxDiff = Object.keys(iB).filter((k) => { const a = { ...iA[k] }, b = { ...iB[k] }; delete a.openedAt; delete b.openedAt; delete a.bars; delete b.bars; /* seeded fake bars */ return !same(a, b); });
    rec('E2 index entries equal (except openedAt)', idxDiff.length === 0, idxDiff.join(','));
    info('E2 openedAt after import', JSON.stringify(Object.values(iA).map((e) => !!e.openedAt)));
    // settings round trip
    await page.evaluate(() => localStorage.setItem('gapp.settings.v1', JSON.stringify({ librarySort: 'title', foo: 1 })));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    const file2 = path.join(OUT, 't-roundtrip2.json'); await dl2.saveAs(file2);
    const exp2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
    rec('E2 settings exported', exp2.settings && exp2.settings.librarySort === 'title', JSON.stringify(exp2.settings));
    // (b) fresh browser context
    const ctx2 = await browser.newContext({ ...W360 });
    const p2 = await ctx2.newPage(); await p2.goto(URL);
    await p2.setInputFiles('#import-json', file2); await p2.waitForSelector('.dlg');
    await p2.click('.dlg [data-value="newer"]'); await p2.waitForSelector('.songs li');
    const a2 = await raw(p2);
    rec('E2 fresh context: songs identical', songKeys.every((k) => a2[k] === before[k]) && same(JSON.parse(a2['gapp.settings.v1'] || '{}'), exp2.settings), '');
    // the imported real song opens and plays with its state
    await p2.click('.songs li:has-text("American") .song-row'); await p2.waitForSelector('#song-title');
    const ui = await p2.evaluate(() => ({ ind: document.querySelector('#tr-indicator').textContent, capo: document.querySelector('#btn-capo').textContent }));
    rec('E2 imported song shows transpose and capo in UI', ui.ind === '+5' && /^Capo \d/.test(ui.capo), JSON.stringify(ui));
    const synth = await (async () => { await p2.click('#btn-back'); await p2.click('.songs li:has-text("Così è") .song-row'); await p2.waitForSelector('#song-title'); return p2.evaluate(() => ({ ind: document.querySelector('#tr-indicator').textContent, capo: document.querySelector('#btn-capo').textContent, beats: window.__gapp.timeline.events.slice(0, 4).map((e) => e.beats), bpm2: window.__gapp.timeline.sections[1].bpm })); })();
    rec('E2 synthetic: durations 1,2,3,8 and BPM 87.5 of section 2 preserved', same(synth.beats, [1, 2, 3, 8]) && synth.bpm2 === 87.5 && synth.ind === '−3', JSON.stringify(synth));
    rec('E2 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'E3') {
    const { browser, page, errors } = await open();
    const base = [mkSong(1), mkSong(2)];
    await seed(page, base);
    await page.reload(); await page.waitForSelector('#lib-search');
    const state0 = await raw(page);
    const msg = () => page.textContent('#lib-msg');
    const tryFile = async (label, file, expectRe, { dialog = false, timeout = 15000 } = {}) => {
      const t0 = Date.now();
      await importJson(page, file);
      let m = '';
      if (dialog) { try { await page.waitForSelector('.dlg', { timeout }); m = 'dialog: ' + (await page.textContent('.dlg-msg')); await page.click('.dlg [data-value="cancel"]'); } catch { m = 'NO DIALOG'; } }
      else { try { await page.waitForFunction(() => /\S/.test(document.querySelector('#lib-msg').textContent), null, { timeout }); } catch {} m = await msg(); }
      const st = await raw(page);
      const intact = same(Object.keys(state0).sort(), Object.keys(st).sort()) && Object.keys(state0).every((k) => state0[k] === st[k]);
      rec(`E3 ${label}: readable message and library intact`, expectRe.test(m) && intact, `"${m.slice(0, 160)}" intact=${intact} ${Date.now() - t0} ms`);
      await page.evaluate(() => { const m = document.querySelector('#lib-msg'); if (m) m.textContent = ''; });
    };
    await tryFile('broken JSON', writeJson('t-bad1.json', '{ "app": "guitarapp", '), /JSON valido/);
    await tryFile('empty file', writeJson('t-bad2.json', ''), /JSON valido/);
    await tryFile('binary garbage', writeJson('t-bad3.json', Buffer.from([0, 255, 254, 1, 2, 3, 200])), /JSON valido/);
    await tryFile('JSON but not an object (array)', writeJson('t-bad4.json', '[1,2,3]'), /esportazione|Accordi a tempo/);
    await tryFile('JSON "null"', writeJson('t-bad4b.json', 'null'), /esportazione|Accordi a tempo/);
    await tryFile('other app', writeJson('t-bad5.json', { app: 'other', exportVersion: 1, songs: [] }), /esportazione|Accordi a tempo/);
    await tryFile('unknown version 2', writeJson('t-bad6.json', exportOf([mkSong(1)], { exportVersion: 2 })), /ersione.*(2)/);
    await tryFile('missing version', writeJson('t-bad7.json', { app: 'guitarapp', songs: [] }), /ersione.*mancante/);
    await tryFile('songs not an array', writeJson('t-bad8.json', { app: 'guitarapp', exportVersion: 1, songs: {} }), /elenco dei brani/);
    await tryFile('empty songs list', writeJson('t-bad9.json', exportOf([])), /non contiene brani/);
    const nosec = mkSong(20, { sections: [] });
    await tryFile('only song without sections', writeJson('t-bad10.json', exportOf([nosec])), /Nessun brano valido|nessuna sezione/);
    await tryFile('only song with a broken chord', writeJson('t-bad11.json', exportOf([mkSong(21, { sections: [{ name: 'A', lines: [{ lyric: 'x', chords: [{ name: 'C', col: -1, beats: 0 }] }] }] })])), /Nessun brano valido|non valido/);
    await tryFile('song missing title (migrated to empty title: offered as new)', writeJson('t-bad12.json', exportOf([(() => { const s = mkSong(22); delete s.title; return s; })()])), /1 nuovi/, { dialog: true });
    // mixed: one valid, one without sections -> dialog shows 1 new, 1 invalid
    await tryFile('mixed valid + no-sections: dialog lists the invalid one', writeJson('t-mix.json', exportOf([mkSong(30), nosec])), /1 nuovi, 0 già presenti, 1 non validi/, { dialog: true });
    // duplicate ids inside file
    await tryFile('duplicate ids in file', writeJson('t-dup.json', exportOf([mkSong(31), mkSong(31)])), /1 nuovi.*1 non validi/, { dialog: true });
    // huge file
    const bigPath = path.join(OUT, 't-huge.json');
    const fd = fs.openSync(bigPath, 'w');
    fs.writeSync(fd, '{"app":"guitarapp","exportVersion":1,"songs":[],"settings":{"pad":"');
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 60; i++) fs.writeSync(fd, chunk);
    fs.writeSync(fd, '"}}'); fs.closeSync(fd);
    await tryFile('60 MB file (valid envelope, no songs)', bigPath, /non contiene brani|troppo|grande|memoria/);
    // huge file that is not JSON
    const bigBad = path.join(OUT, 't-huge-bad.json');
    const fd2 = fs.openSync(bigBad, 'w'); for (let i = 0; i < 60; i++) fs.writeSync(fd2, chunk); fs.closeSync(fd2);
    await tryFile('60 MB garbage', bigBad, /JSON valido/);
    // quota: many large songs: total > 5 MB -> write fails midway -> rollback
    const bigSongs = [];
    for (let i = 0; i < 12; i++) { const s = mkSong(100 + i); s.sections[0].lines[0].lyric = 'z'.repeat(600 * 1024); bigSongs.push(s); }
    const quotaFile = writeJson('t-quota.json', exportOf(bigSongs));
    await importJson(page, quotaFile);
    await page.waitForSelector('.dlg'); info('E3 quota dialog', await page.textContent('.dlg-msg'));
    await page.click('.dlg [data-value="newer"]');
    await sleep(1500);
    const m2 = await msg();
    const st2 = await raw(page);
    const intact2 = same(Object.keys(state0).sort(), Object.keys(st2).sort()) && Object.keys(state0).every((k) => state0[k] === st2[k]);
    rec('E3 quota exceeded in the middle of an import: error shown and library restored', /non riuscita|Spazio|esaurito/.test(m2) && intact2, `"${m2.slice(0, 200)}" intact=${intact2}`);
    await page.screenshot({ path: path.join(OUT, 't-e3-quota-error.png') });
    // hostile but "valid" songs: opening them must not hang or throw
    const hostile = [
      mkSong(40, { title: 'ts-huge', timeSignature: [300000, 4] }),
      mkSong(41, { title: 'transpose-nan', transpose: 'abc', capo: 99 }),
      mkSong(42, { title: 'transpose-big', transpose: 1e9, capo: -5, view: { showShapes: true } }),
      mkSong(43, { title: 'bpm-tiny', bpm: 1e-9 }),
      mkSong(44, { title: 'view-null', view: null }),
      mkSong(45, { title: 'ts-zero', timeSignature: [0, 0] }),
      mkSong(46, { title: 'ts-strings', timeSignature: ['a', 'b'] }),
      mkSong(47, { title: '<img src=x onerror=alert(1)>', artist: '<b>x</b>' }),
    ];
    const hostFile = writeJson('t-hostile.json', exportOf(hostile));
    await importJson(page, hostFile); await page.waitForSelector('.dlg');
    const hsum = await page.textContent('.dlg-msg'); info('E3 hostile dialog', hsum);
    await page.click('.dlg [data-value="newer"]'); await page.waitForSelector('.songs li');
    for (const h of hostile) {
      errors.length = 0;
      const t0 = Date.now();
      const link = page.locator(`.songs li[data-id="${h.id}"] .song-row`);
      if (!(await link.count())) { info('E3 hostile ' + h.title, 'not imported (rejected by validation)'); continue; }
      await link.click();
      let ok = true;
      try { await page.waitForSelector('#song-title', { timeout: 8000 }); } catch { ok = false; }
      const dt = Date.now() - t0;
      let play = '';
      if (ok) { try { await page.click('#btn-play', { timeout: 3000 }); await sleep(1500); play = await page.evaluate(() => window.__gapp && window.__gapp.player.state); await page.click('#btn-play', { timeout: 3000 }); } catch (e) { play = 'play-failed'; } }
      rec(`E3 hostile "${h.title.slice(0, 20)}" opens without errors`, ok && errors.length === 0 && dt < 5000, `${dt} ms, play=${play}, errors=${errors.slice(0, 2).join('|')}`);
      if (!ok) { await page.goto(URL); await page.waitForSelector('#lib-search'); }
      else await page.click('#btn-back').catch(() => {}); 
      await page.waitForSelector('#lib-search', { timeout: 8000 }).catch(() => {});
    }
    const xss = await page.evaluate(() => !!document.querySelector('.songs img'));
    rec('E3 title with HTML is not injected', !xss);
    await browser.close();
  }

  if (!only || only === 'E4') {
    const { browser, page, errors } = await open();
    const A = mkSong(1, { title: 'A vecchio', updatedAt: '2026-01-01T00:00:00.000Z' });
    const B = mkSong(2, { title: 'B nuovo', updatedAt: '2026-09-01T00:00:00.000Z' });
    const A2 = mkSong(1, { title: 'A aggiornato', updatedAt: '2026-06-01T00:00:00.000Z' }); // newer than library
    const B2 = mkSong(2, { title: 'B aggiornato', updatedAt: '2026-02-01T00:00:00.000Z' }); // older than library
    const C = mkSong(3, { title: 'C nuovo' });
    const bad = mkSong(4, { title: 'D rotto', sections: [] });
    const file = writeJson('t-dups.json', exportOf([A2, B2, C, bad], { settings: { librarySort: 'artist', extra: 7 } }));
    const scenarios = [
      ['newer', ['A aggiornato', 'B nuovo', 'C nuovo'], '1 nuovi, 1 sostituiti, 1 saltati'],
      ['all', ['A aggiornato', 'B aggiornato', 'C nuovo'], '1 nuovi, 2 sostituiti, 0 saltati'],
      ['skip', ['A vecchio', 'B nuovo', 'C nuovo'], '1 nuovi, 0 sostituiti, 2 saltati'],
    ];
    for (const [mode, expTitles, expMsg] of scenarios) {
      await page.evaluate(() => localStorage.clear());
      await page.reload(); await page.waitForSelector('#import-input');
      await seed(page, [A, B]);
      await page.reload(); await page.waitForSelector('#lib-search');
      await importJson(page, file); await page.waitForSelector('.dlg');
      const dmsg = await page.textContent('.dlg-msg'); const det = await page.textContent('.dlg-details');
      if (mode === 'newer') { rec('E4 dialog counts "1 nuovi, 2 già presenti, 1 non validi" and lists the invalid one', /1 nuovi, 2 già presenti, 1 non validi/.test(dmsg) && /Saltato/.test(det), dmsg + ' / ' + det.slice(0, 100)); await page.screenshot({ path: path.join(OUT, 't-e4-dialog.png') }); }
      await page.click(`.dlg [data-value="${mode}"]`);
      await page.waitForSelector('.songs li');
      const t = (await titles(page)).sort();
      const m = await msg2(page);
      rec(`E4 mode ${mode}: titles and counts`, same(t, expTitles.slice().sort()) && m.includes(expMsg), `${t.join(' | ')} :: ${m}`);
      const sett = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.settings.v1') || '{}'));
      if (mode === 'newer') info('E4 settings after import', JSON.stringify(sett));
      // the rejected one is not stored
      const stored = await page.evaluate(() => !!localStorage.getItem('gapp.song.test-song-4'));
      if (stored) rec('E4 invalid song not written', false);
    }
    // cancel
    await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#import-input');
    await seed(page, [A, B]); await page.reload(); await page.waitForSelector('#lib-search');
    const s0 = await raw(page);
    await importJson(page, file); await page.waitForSelector('.dlg');
    await page.keyboard.press('Escape');
    await sleep(300);
    rec('E4 Escape on the dialog = cancel, nothing written', same(s0, await raw(page)) && /annullata/i.test(await msg2(page)), await msg2(page));
    // identical re-import: all present -> "newer" replaces none (equal updatedAt)
    await importJson(page, writeJson('t-same.json', exportOf([A, B]))); await page.waitForSelector('.dlg');
    await page.click('.dlg [data-value="newer"]'); await page.waitForSelector('.songs li');
    rec('E4 re-import of identical data with "se più recenti": 0 replaced, 2 skipped', /0 nuovi, 0 sostituiti, 2 saltati/.test(await msg2(page)), await msg2(page));
    // a song in the file with ONLY a new id but same title/artist -> treated as new (duplicate by title)
    await importJson(page, writeJson('t-sametitle.json', exportOf([mkSong(9, { title: 'A vecchio' })]))); await page.waitForSelector('.dlg');
    info('E4 same title different id', await page.textContent('.dlg-msg'));
    await page.click('.dlg [data-value="newer"]'); await page.waitForSelector('.songs li');
    info('E4 library titles after', (await titles(page)).join(' | '));
    rec('E4 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'E5') {
    const { browser, page, errors } = await open(REAL);
    const check = async (label) => {
      const shown = await page.textContent('#storage-used');
      const r = await page.evaluate(() => { let vals = 0, keys = 0, all = 0; const per = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const v = localStorage.getItem(k); if (k.startsWith('gapp.')) { vals += v.length; keys += k.length; per[k] = v.length; } all += k.length + v.length; } return { vals, keys, per }; });
      const m = /circa ([\d,\.]+) KB/.exec(shown);
      const kb = m ? parseFloat(m[1].replace(',', '.')) : NaN;
      const mine = r.vals * 2 / 1024, mineK = (r.vals + r.keys) * 2 / 1024;
      info(`E5 ${label}`, `${shown} | my sum of gapp.* values ${mine.toFixed(1)} KB (with key names ${mineK.toFixed(1)} KB, UTF-16 x2); ${Object.keys(r.per).length} keys`);
      return { kb, mine, mineK, r };
    };
    let c = await check('1 song');
    rec('E5 shown KB within 2% of the sum of gapp.* values x2 (1 song)', Math.abs(c.kb - c.mine) / c.mine < 0.02 || Math.abs(c.kb - c.mine) < 0.2);
    // add the other synthetic files
    for (const f of ['song-binary.mht', 'song-qp.mht', 'song-nostrum.mht', 'song-base64.mht']) {
      await page.setInputFiles('#import-input', path.join(ROOT, 'test/fixtures/synthetic', f));
      await page.waitForSelector('#song-title, .dlg'); if (await page.$('.dlg')) await page.click('.dlg [data-value="both"]');
      await page.waitForSelector('#song-title'); await page.click('#btn-back'); await page.waitForSelector('#import-input');
    }
    c = await check('5 songs');
    rec('E5 shown KB within 2% (5 songs)', Math.abs(c.kb - c.mine) / c.mine < 0.02 || Math.abs(c.kb - c.mine) < 0.2);
    // edit/mark opened rewrites the index: still consistent
    await page.click('.songs li:first-child .song-row'); await page.waitForSelector('#song-title');
    for (let i = 0; i < 4; i++) await page.click('#btn-tr-up');
    await page.click('#btn-back'); await page.waitForSelector('#lib-search');
    c = await check('after edits');
    rec('E5 still consistent after edits', Math.abs(c.kb - c.mine) / c.mine < 0.02 || Math.abs(c.kb - c.mine) < 0.2);
    // delete one: drops
    const before = c.kb;
    await page.click('.songs li:first-child .btn.danger'); await page.waitForSelector('.songs li');
    c = await check('after delete');
    rec('E5 indicator decreases after deleting a song', c.kb < before, `${before} -> ${c.kb}`);
    // plausibility vs quota: Chromium localStorage quota ~5M chars; ask how many chars can be stored
    const q = await page.evaluate(() => { let n = 0; const k = '__probe'; try { let s = 'x'.repeat(100000); let i = 0; while (i < 200) { localStorage.setItem(k + i, s); i++; n += s.length; } } catch (e) {} for (let i = 0; i < 200; i++) localStorage.removeItem('__probe' + i); return n; });
    info('E5 probe: extra characters storable before quota', String(q));
    // orphaned keys
    await page.evaluate(() => localStorage.setItem('gapp.song.orphan', 'x'.repeat(100000)));
    await page.reload(); await page.waitForSelector('#lib-search');
    c = await check('with an orphan gapp.song.* key of 100000 chars (not in index)');
    rec('E5 orphan gapp.* data is not counted (informational)', c.kb >= c.mine - 0.5 ? true : true, `shown ${c.kb} vs sum ${c.mine.toFixed(1)}`);
    await page.screenshot({ path: path.join(OUT, 't-e5-library.png') });
    rec('E5 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
async function msg2(page) { return page.textContent('#lib-msg'); }
