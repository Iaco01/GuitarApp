// Round 9: audio shorter than the sheet (skipped sections), a section missing in the middle, foreign intro
// (tester generator at 11 kHz, to keep it quick). The three `todo` tests of the round 8 tester live here now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseAndAlign, songEvents } from '../src/analysis/autosync.js';
import { makeAlignment, sectionState, effectiveEventTimes, normalizeAlignment, alignmentRecognised, capAtYellow } from '../src/alignment.js';
import { buildTimeline, eventIndexAtTime } from '../src/timeline.js';
import { makeTrack, makeForeign, concat, addNoiseSnr } from './e2e/round8-tester-make.mjs';

const RATE = 11025;
const base = makeTrack({ seed: 5, semis: 0, cents: 0, rate: RATE });
const sr = base.sampleRate;
const evs = songEvents(base.song);
const sectionsOf = (j) => evs[j].section;

test('audio cut at 50-90%: no green section with more than 10% of its audible changes off by > 250 ms', () => {
  for (const frac of [0.5, 0.7, 0.9]) {
    const cut = base.meta.durationSec * frac;
    const res = analyseAndAlign({ samples: base.samples.subarray(0, Math.floor(cut * sr)), sampleRate: sr, song: base.song });
    const al = makeAlignment(res, base.song);
    base.song.sections.forEach((_, si) => {
      if (sectionState(al, si) !== 'green') return;
      const idx = evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0 && base.truth[j] < cut - 1);
      if (!idx.length) return;
      const bad = idx.filter((j) => Math.abs(res.eventStartSec[j] - base.truth[j]) > 0.25).length;
      assert.ok(bad / idx.length <= 0.1, `cut ${frac}: section ${si} is green with ${bad}/${idx.length} wrong`);
    });
    // the sections after the cut have no time
    const last = base.song.sections.length - 1;
    const lastIdx = evs.map((e, j) => (e.section === last ? j : -1)).filter((j) => j >= 0);
    if (base.truth[lastIdx[0]] > cut + 1) {
      assert.equal(sectionState(al, last), 'skipped', `cut ${frac}: the last section is not in the audio`);
      assert.ok(lastIdx.every((j) => al.skipped.includes(j)));
    }
  }
});

test('a skipped section: no time, the timeline and the highlight pass over it', () => {
  const cut = base.meta.durationSec * 0.7;
  const res = analyseAndAlign({ samples: base.samples.subarray(0, Math.floor(cut * sr)), sampleRate: sr, song: base.song });
  const al = normalizeAlignment(JSON.parse(JSON.stringify(makeAlignment(res, base.song))));
  assert.ok(al.skipped.length > 0);
  const tl = buildTimeline(base.song, { alignment: al });
  const sk = tl.events.filter((e) => e.skipped);
  assert.equal(sk.length, al.skipped.length);
  assert.ok(sk.every((e) => e.durSec === 0 && e.beats === 0));
  assert.ok(tl.sections.some((s) => s.skipped));
  // no beat for the skipped events (no burst of clicks) and the highlight never rests on them
  assert.equal(tl.beats.length, tl.totalBeats);
  assert.ok(!tl.events[eventIndexAtTime(tl, tl.totalSec + 5)].skipped);
  const eff = effectiveEventTimes(base.song, al);
  for (let j = 1; j < eff.starts.length; j++) assert.ok(eff.starts[j] >= eff.starts[j - 1]);
});

test('a section missing in the middle of the audio is reported as not in the audio; the others stay aligned', () => {
  const sec = 5; // Bridge
  const idx = evs.map((e, j) => (e.section === sec ? j : -1)).filter((j) => j >= 0);
  const t0 = base.truth[idx[0]];
  const t1 = base.truth[idx[idx.length - 1] + 1];
  const a = Math.floor(t0 * sr);
  const b = Math.floor(t1 * sr);
  const res = analyseAndAlign({ samples: concat([base.samples.subarray(0, a), base.samples.subarray(b)]), sampleRate: sr, song: base.song });
  const al = makeAlignment(res, base.song);
  assert.equal(sectionState(al, sec), 'skipped');
  const L = t1 - t0;
  const rest = evs.map((e, j) => j).filter((j) => sectionsOf(j) !== sec && sectionsOf(j) !== 3);
  const ok = rest.filter((j) => Math.abs(res.eventStartSec[j] - (j > idx[idx.length - 1] ? base.truth[j] - L : base.truth[j])) <= 0.25).length;
  assert.ok(ok / rest.length >= 0.95, `${ok}/${rest.length} within 250 ms`);
  base.song.sections.forEach((_, si) => { if (si !== sec) assert.notEqual(sectionState(al, si), 'skipped'); });
});

test('a normal full track skips nothing', () => {
  const res = analyseAndAlign({ samples: base.samples, sampleRate: sr, song: base.song });
  assert.ok(res.skipped.every((v) => !v));
  assert.ok(!res.sections.some((s) => s.skipped));
});

// Round 8 tester bug 3: 15 s of foreign music before the song: the first chord of the sheet started 3 s early, with confidence 1.
test('foreign intro of 15 s: the first event starts where the sheet really starts (within 0.5 s)', () => {
  const intro = makeForeign({ chords: ['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A'], bpm: 110, seed: 8, semis: 0, cents: 0, rate: RATE }).samples.subarray(0, 15 * RATE);
  const res = analyseAndAlign({ samples: concat([intro, base.samples]), sampleRate: sr, song: base.song });
  assert.ok(Math.abs(res.eventStartSec[0] - (base.truth[0] + 15)) < 0.5, `first event at ${res.eventStartSec[0].toFixed(2)} s, true ${(base.truth[0] + 15).toFixed(2)} s`);
  // the start is judged on what is heard before it: a clean start after silence is trusted, one right after other music less so
  const clean = analyseAndAlign({ samples: base.samples, sampleRate: sr, song: base.song });
  assert.ok(clean.confidence[0] >= 0.75, `clean start: confidence ${clean.confidence[0]}`);
});

// Round 8 tester bug 5: the right song under very strong noise is aligned exactly but was refused as "not recognised".
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function addPink(x, snrDb, seed) {
  const R = rng(seed);
  const p = new Float32Array(x.length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < p.length; i++) {
    const w = R() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const k = rms(x) / 10 ** (snrDb / 20) / rms(p);
  return Float32Array.from(x, (v, i) => v + p[i] * k);
}

test('right song at SNR -10 dB white or -5 dB pink noise is recognised (aligned within 250 ms); noise, silence and another song are not', () => {
  const stableEv = evs.map((e, j) => (e.section !== 3 ? j : -1)).filter((j) => j >= 0);
  const check = (name, samples, expectRecognised) => {
    const res = analyseAndAlign({ samples, sampleRate: sr, song: base.song });
    const al = makeAlignment(res, base.song);
    assert.equal(alignmentRecognised(al, base.song), expectRecognised, `${name}: recognised = ${!expectRecognised}, match ${al.match}`);
    return res;
  };
  const white = check('white -10 dB', addNoiseSnr(base.samples, -10, 77), true);
  const ok = stableEv.filter((j) => Math.abs(white.eventStartSec[j] - base.truth[j]) <= 0.25).length;
  assert.ok(ok / stableEv.length >= 0.9, 'precondition: still aligned');
  check('pink -5 dB', addPink(base.samples, -5, 55), true);
  check('white noise only', Float32Array.from(base.samples, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1 * 0.1), false);
  check('silence', new Float32Array(base.samples.length), false);
  const f = makeForeign({ chords: ['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'F', 'A'], bpm: 110, seed: 8, semis: 0, cents: 0, rate: RATE }).samples;
  check('another song', Float32Array.from(base.samples, (_, i) => f[i % f.length]), false);
});

test('"Usa comunque" keeps an unrecognised alignment with every section yellow or red at most', () => {
  const res = analyseAndAlign({ samples: new Float32Array(base.samples.length).map((_, i) => ((i * 7919) % 2000) / 1e4 - 0.1), sampleRate: sr, song: base.song });
  const al = makeAlignment(res, base.song);
  capAtYellow(al);
  assert.ok(al.forced);
  base.song.sections.forEach((_, si) => assert.ok(['yellow', 'red', 'skipped'].includes(sectionState(al, si)), `section ${si}: ${sectionState(al, si)}`));
  assert.equal(normalizeAlignment(JSON.parse(JSON.stringify(al))).forced, true);
});
