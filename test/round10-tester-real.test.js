// Round 10 tester defects on the REAL local song, fixed in round 11 (skipped when test/fixtures/local is absent). Counts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../src/parser.js';
import { analyseAndAlign, songEvents } from '../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised } from '../src/alignment.js';

const L = new URL('./fixtures/local/', import.meta.url).pathname;
const have = existsSync(L + 'american-pie.mp3') && existsSync(L + 'american-pie.mht');
const opts = { skip: have ? false : 'no local fixture' };
let ctx = null;
function setup() {
  if (ctx) return ctx;
  const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
  const evs = songEvents(song);
  const run = (x) => { const res = analyseAndAlign({ samples: x, sampleRate: 44100, song }); const al = makeAlignment(res, song); return { res, al, st: song.sections.map((_, i) => sectionState(al, i)) }; };
  ctx = { song, X, evs, run, ref: run(X) };
  return ctx;
}

test('real song, first 60 s removed: only the section that lost its music may be "non presente"', opts, () => {
  const { X, run, song } = setup();
  const { st } = run(X.subarray(60 * 44100));
  const skipped = st.map((s, i) => (s === 'skipped' ? i : -1)).filter((i) => i >= 0);
  assert.ok(skipped.every((i) => i === 0), `skipped sections (0-based): ${skipped}`);
  assert.equal(song.sections.length, st.length);
});

test('real song cut at 45% (in the middle of a chorus): a green section has its events where the reference has them', opts, () => {
  const { X, run, evs, ref } = setup();
  const n = Math.floor(X.length * 0.45);
  const { res, st } = run(X.subarray(0, n));
  st.forEach((s, si) => {
    if (s !== 'green') return;
    const idx = evs.map((e, j) => (e.section === si && ref.res.eventStartSec[j] < n / 44100 - 1 ? j : -1)).filter((j) => j >= 0);
    const bad = idx.filter((j) => Math.abs(res.eventStartSec[j] - ref.res.eventStartSec[j]) > 0.25).length;
    assert.ok(!idx.length || bad / idx.length <= 0.1, `section ${si + 1} green with ${bad}/${idx.length} events > 250 ms from the reference`);
  });
});

test('real song cut at 20% (1:43 of 8:33) is recognised (the first two sections are in it)', opts, () => {
  const { X, run } = setup();
  const { al, st } = run(X.subarray(0, Math.floor(X.length * 0.2)));
  assert.ok(alignmentRecognised(al, setup().song), `not recognised, colours ${st.map((s) => s[0]).join('')}`);
});
