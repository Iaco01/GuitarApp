import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSong, putSong, listSongs, getSong, getSettings, saveSettings, listLibrary, storageUsedBytes, markOpened } from '../src/storage.js';
import { createSong } from '../src/model.js';
import { foldText, filterLibrary, sortLibrary, buildExport, exportFileName, parseExport, planImport, applyImport, stripAudio } from '../src/libio.js';

function fakeStorage({ failAfter = Infinity } = {}) {
  const m = new Map();
  let writes = 0;
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (++writes === failAfter + 1) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}

const mk = (title, artist, extra = {}) => createSong({
  title, artist,
  chords: ['G', 'D'],
  sections: [{ name: 'Verse', bpm: 80, bpmSource: 'edited', strumIndex: null, lines: [{ lyric: 'la la', chords: [{ name: 'G', col: 0, beats: 4 }, { name: 'D', col: 3, beats: 2 }] }] }],
  ...extra,
});

test('foldText and search ignore case and accents', () => {
  assert.equal(foldText('  Fabrizio De André '), 'fabrizio de andre');
  const e = [{ title: 'Città vuota', artist: 'Mina' }, { title: 'Hey Jude', artist: 'The Beatles' }];
  assert.deepEqual(filterLibrary(e, 'CITTA').map((x) => x.title), ['Città vuota']);
  assert.deepEqual(filterLibrary(e, 'beatles jude').length, 1);
  assert.equal(filterLibrary(e, '').length, 2);
  assert.equal(filterLibrary(e, 'zzz').length, 0);
});

test('sorting modes', () => {
  const e = [
    { id: 1, title: 'b', artist: 'z', difficulty: 'Advanced', importedAt: '2026-01-02', updatedAt: '2026-01-02' },
    { id: 2, title: 'a', artist: 'y', difficulty: 'Beginner', importedAt: '2026-01-03', updatedAt: '2026-01-03', openedAt: '2026-03-01' },
    { id: 3, title: 'C', artist: 'x', difficulty: null, importedAt: '2026-01-01', updatedAt: '2026-01-01' },
  ];
  const ids = (m) => sortLibrary(e, m).map((x) => x.id);
  assert.deepEqual(ids('title'), [2, 1, 3]);
  assert.deepEqual(ids('artist'), [3, 2, 1]);
  assert.deepEqual(ids('imported'), [2, 1, 3]);
  assert.deepEqual(ids('difficulty'), [2, 1, 3]);
  assert.deepEqual(ids('opened'), [2, 1, 3]);
});

test('index carries bars, timing and opened date; space estimate', () => {
  const st = fakeStorage();
  const s = mk('A', 'x', { timingSource: 'edited' });
  saveSong(s, st);
  const e = listLibrary(st)[0];
  assert.equal(e.bars, 2); // 6 beats / 4 -> 1.5 -> 2
  assert.equal(e.timingSource, 'edited');
  markOpened(s.id, st);
  assert.ok(listSongs(st)[0].openedAt);
  saveSong(s, st);
  assert.ok(listSongs(st)[0].openedAt, 'kept on save');
  assert.ok(storageUsedBytes(st) > 100);
});

test('round trip export -> import on clean storage gives identical songs', () => {
  const a = fakeStorage();
  const s1 = putSong(mk('Uno', 'A', { transpose: 2, capo: 2, timingSource: 'recorded' }), a);
  const s2 = putSong(mk('Due', 'B', { view: { ...createSong().view, theme: 'light', fontScale: 1.4 } }), a);
  saveSettings({ x: 1 }, a);
  const text = JSON.stringify(buildExport(a, new Date('2026-05-04T10:00:00Z')));
  const parsed = parseExport(text);
  assert.deepEqual(parsed.invalid, []);
  const b = fakeStorage();
  const plan = planImport(parsed, b);
  assert.equal(plan.fresh.length, 2);
  assert.equal(plan.present.length, 0);
  assert.deepEqual(applyImport(plan, 'newer', parsed.settings, b), { added: 2, replaced: 0, skipped: 0 });
  assert.deepEqual(getSong(s1.id, b), s1);
  assert.deepEqual(getSong(s2.id, b), s2);
  assert.deepEqual(getSettings(b), { x: 1 });
  assert.equal(listSongs(b).length, 2);
  assert.equal(exportFileName(new Date(2026, 4, 4)), 'accordi-a-tempo-2026-05-04.json');
});

test('import: present songs are replaced by mode', () => {
  const a = fakeStorage();
  const s = putSong(mk('Uno', 'A', { updatedAt: '2026-02-01T00:00:00.000Z' }), a);
  const text = JSON.stringify(buildExport(a));
  const b = fakeStorage();
  putSong({ ...s, title: 'Locale', updatedAt: '2026-03-01T00:00:00.000Z' }, b); // local is newer
  const parsed = parseExport(text);
  let plan = planImport(parsed, b);
  assert.equal(plan.present.length, 1);
  assert.equal(plan.present[0].newer, false);
  assert.deepEqual(applyImport(plan, 'newer', {}, b), { added: 0, replaced: 0, skipped: 1 });
  assert.equal(getSong(s.id, b).title, 'Locale');
  assert.deepEqual(applyImport(plan, 'skip', {}, b), { added: 0, replaced: 0, skipped: 1 });
  assert.deepEqual(applyImport(plan, 'all', {}, b), { added: 0, replaced: 1, skipped: 0 });
  assert.equal(getSong(s.id, b).title, 'Uno');
  putSong({ ...s, title: 'Vecchio', updatedAt: '2026-01-01T00:00:00.000Z' }, b);
  plan = planImport(parsed, b);
  assert.equal(plan.present[0].newer, true);
  assert.equal(applyImport(plan, 'newer', {}, b).replaced, 1);
});

test('malformed files give readable errors and do not touch the library', () => {
  const st = fakeStorage();
  putSong(mk('Uno', 'A'), st);
  const before = JSON.stringify([...st.m]);
  const good = JSON.parse(JSON.stringify(buildExport(st)));
  assert.match(parseExport('{rotto').error, /JSON valido/);
  assert.match(parseExport('[1,2]').error, /esportazione/);
  assert.match(parseExport(JSON.stringify({ ...good, app: 'altro' })).error, /esportazione/);
  assert.match(parseExport(JSON.stringify({ ...good, exportVersion: 99 })).error, /Versione.*99/);
  assert.match(parseExport(JSON.stringify({ ...good, songs: 'x' })).error, /elenco/);
  const noSections = { ...good.songs[0], id: 'n1', title: 'Senza sezioni', sections: [] };
  const broken = { ...good.songs[0], id: 'n2', title: 'Rotto', sections: [{ name: 'A', lines: [{ lyric: 1, chords: [] }] }] };
  const p = parseExport(JSON.stringify({ ...good, songs: [good.songs[0], noSections, broken, 5] }));
  assert.equal(p.songs.length, 1);
  assert.equal(p.invalid.length, 3);
  assert.ok(p.invalid[0].errors.join(' ').includes('nessuna sezione'));
  assert.equal(p.invalid[0].label, '«Senza sezioni»');
  assert.equal(JSON.stringify([...st.m]), before);
});

test('a failing write rolls the library back', () => {
  const src = fakeStorage();
  putSong(mk('Uno', 'A'), src);
  putSong(mk('Due', 'B'), src);
  putSong(mk('Tre', 'C'), src);
  const parsed = parseExport(JSON.stringify(buildExport(src)));
  const dst = fakeStorage({ failAfter: 5 });
  const keep = putSong(mk('Gia', 'Z'), dst); // 2 writes
  const before = JSON.stringify([...dst.m]);
  const plan = planImport(parsed, dst);
  assert.throws(() => applyImport(plan, 'all', {}, dst), /Spazio esaurito/);
  assert.equal(listSongs(dst).length, 1);
  assert.equal(getSong(keep.id, dst).title, 'Gia');
  assert.equal(JSON.stringify([...dst.m]), before);
});

test('stripAudio keeps only plain metadata', () => {
  const s = mk('A', 'b', { audio: { name: 'x.mp3', offset: 1.5, blob: 'x'.repeat(5000), nested: { a: 1 } } });
  assert.deepEqual(stripAudio(s).audio, { name: 'x.mp3', offset: 1.5 });
  assert.equal(stripAudio(mk('A', 'b')).audio, null);
});
