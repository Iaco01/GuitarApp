import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSongs, getSong, saveSong, deleteSong, getSettings, saveSettings } from '../src/storage.js';
import { createSong } from '../src/model.js';

function fakeStorage({ quota = Infinity } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      let total = 0;
      for (const [kk, vv] of m) if (kk !== k) total += vv.length;
      if (total + v.length > quota) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}

test('save, list (newest first), get and delete', () => {
  const st = fakeStorage();
  const a = createSong({ title: 'A', artist: 'x' });
  const b = createSong({ title: 'B', artist: 'y' });
  saveSong(a, st);
  saveSong(b, st);
  assert.deepEqual(listSongs(st).map((e) => e.title), ['B', 'A']);
  assert.equal(getSong(a.id, st).title, 'A');
  saveSong({ ...a, title: 'A2' }, st);
  assert.deepEqual(listSongs(st).map((e) => e.title), ['A2', 'B']);
  deleteSong(b.id, st);
  assert.deepEqual(listSongs(st).map((e) => e.title), ['A2']);
  assert.equal(getSong(b.id, st), null);
});

test('index entries carry the library fields only', () => {
  const st = fakeStorage();
  const a = createSong({ title: 'A', artist: 'x', difficulty: 'Beginner' });
  saveSong(a, st);
  assert.deepEqual(Object.keys(listSongs(st)[0]).sort(), ['artist', 'bars', 'difficulty', 'id', 'importedAt', 'timingSource', 'title', 'updatedAt']);
});

test('quota errors become a clear message', () => {
  const st = fakeStorage({ quota: 50 });
  assert.throws(() => saveSong(createSong({ title: 'x'.repeat(200) }), st), /Spazio esaurito/);
});

test('corrupt data does not throw on read', () => {
  const st = fakeStorage();
  st.setItem('gapp.index.v1', '{not json');
  st.setItem('gapp.song.zz', '{oops');
  assert.deepEqual(listSongs(st), []);
  assert.equal(getSong('zz', st), null);
});

test('settings round trip and missing storage', () => {
  const st = fakeStorage();
  assert.deepEqual(getSettings(st), {});
  saveSettings({ a: 1 }, st);
  assert.deepEqual(getSettings(st), { a: 1 });
  const none = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.deepEqual(listSongs(none), []);
  assert.throws(() => saveSong(createSong(), none), /salvare/);
});
