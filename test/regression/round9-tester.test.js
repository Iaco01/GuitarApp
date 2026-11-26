// Round 9 tester: defects still open, as `todo` tests (they do not fail the run). Not part of `npm test`
// (that runs test/*.test.js only): node --test "test/regression/round9-tester.test.js"
// The synthetic ones use the tester's generator (no song text); the "real song" ones read test/fixtures/local (gitignored,
// copyrighted) and are skipped when the files are absent. They assert counts and section numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised } from '../../src/alignment.js';
import { parseSongFromMht } from '../../src/parser.js';
import { makeTrack, makeForeign, concat, secOfEvents } from '../e2e/round8-tester-make.mjs';

// Bug 1 (bassa): a sheet section replaced in the audio by a 20 s solo: the section is not marked skipped and the gap is
// split in two pieces that cover only 2/3 of the solo.
test('one section replaced by a 20 s solo: the gap covers at least 90% of the solo', { todo: 'round 9 tester bug 1' }, () => {
  const base = makeTrack({ seed: 61, semis: 0, cents: 0 });
  const sr = base.sampleRate; const evs = songEvents(base.song);
  const idx = (si) => secOfEvents(evs, si);
  const a = base.truth[idx(5)[0]]; const l = idx(5); const b = base.truth[l[l.length - 1] + 1];
  const ch = ['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A'];
  const solo = makeForeign({ chords: Array.from({ length: 60 }, (_, i) => ch[i % 8]), bpm: 96, seed: 66, semis: 0, cents: 0, rate: sr }).samples.subarray(0, 20 * sr);
  const sl = (x, y) => base.samples.subarray(Math.floor(x * sr), Math.floor(y * sr));
  const res = analyseAndAlign({ samples: concat([sl(0, a), solo, sl(b, base.meta.durationSec)]), sampleRate: sr, song: base.song });
  const covered = res.gaps.reduce((s, g) => s + Math.max(0, Math.min(g.endSec, a + 20) - Math.max(g.startSec, a)), 0);
  assert.ok(covered >= 18, `gaps cover ${covered.toFixed(1)} s of the 20 s solo`);
});

// Real song, local only. Whole-file reference and a spliced / cut variant, built with ffmpeg in memory.
const L = new URL('../fixtures/local/', import.meta.url).pathname;
const have = existsSync(L + 'american-pie.mp3') && existsSync(L + 'american-pie.mht');
function realSetup() {
  const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
  return { song, X, SR: 44100 };
}

// Bug 2 (media): the real song cut at 40% (or 60%) of its length is "not recognised" and every section after the cut is red
// instead of "non presente nell'audio".
test('REAL song cut at 40%: recognised, and the sections after the cut are skipped, not red', { todo: 'round 9 tester bug 2', skip: have ? false : 'no local fixture' }, () => {
  const { song, X, SR } = realSetup();
  const res = analyseAndAlign({ samples: X.subarray(0, Math.floor(X.length * 0.4)), sampleRate: SR, song });
  const al = makeAlignment(res, song);
  assert.ok(alignmentRecognised(al, song), 'recognised');
  const st = song.sections.map((_, si) => sectionState(al, si));
  assert.ok(st.slice(6).every((s) => s === 'skipped'), `sections 7..12 are ${st.slice(6).join(',')}`);
});

// Bug 3 (media): the real song with one middle section removed: the section that follows is green but most of its changes
// are off by up to 4 s (with respect to the analysis of the whole file); the removed section is not skipped.
test('REAL song with section 5 removed from the audio: no green section has > 10% of its changes off by > 250 ms', { todo: 'round 9 tester bug 3', skip: have ? false : 'no local fixture' }, () => {
  const { song, X, SR } = realSetup();
  const evs = songEvents(song);
  const ref = analyseAndAlign({ samples: X, sampleRate: SR, song });
  const t0 = ref.eventStartSec[evs.findIndex((e) => e.section === 4)]; const t1 = ref.eventStartSec[evs.findIndex((e) => e.section === 5)];
  const A = Math.floor(t0 * SR); const B = Math.floor(t1 * SR);
  const out = new Float32Array(X.length - (B - A)); out.set(X.subarray(0, A)); out.set(X.subarray(B), A);
  const res = analyseAndAlign({ samples: out, sampleRate: SR, song });
  const al = makeAlignment(res, song);
  song.sections.forEach((_, si) => {
    if (sectionState(al, si) !== 'green') return;
    const js = evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0);
    const bad = js.filter((j) => Math.abs(res.eventStartSec[j] - (ref.eventStartSec[j] - (ref.eventStartSec[j] >= t1 ? t1 - t0 : 0))) > 0.25).length;
    assert.ok(bad / js.length <= 0.1, `section ${si + 1} is green with ${bad}/${js.length} changes wrong`);
  });
});
