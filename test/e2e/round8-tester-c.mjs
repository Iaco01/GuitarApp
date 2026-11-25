// Round 8 tester C (engine): noise / silence / other song / right song with strong noise; transposed audio.
// Decision = what the app does: alignmentRecognised (no "pronta" if not), transposeTrusted (proposal yes/no).
// node test/e2e/round8-tester-c.mjs
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised, transposeTrusted, effectiveEventTimes } from '../../src/alignment.js';
import { makeTrack, addNoiseSnr, secOfEvents } from './round8-tester-make.mjs';
import { makeBench } from './round8-tester-bench.mjs';

const COL = { green: 'g', yellow: 'y', red: 'r', verified: 'v' };
function verdict(res, song) {
  if (!res) return { out: 'NULL (message: cannot align)' };
  const al = makeAlignment(res, song);
  const rec = alignmentRecognised(al, song);
  const colors = song.sections.map((_, si) => COL[sectionState(al, si)]).join('');
  return { rec, colors, transpFound: res.transposeFound, margin: res.transposeMargin, score: res.transposeScore, ratio: res.transposeMargin / Math.abs(res.transposeScore), trusted: transposeTrusted(res), stored: al.transposeFound };
}
const show = (nm, v) => console.log(`${nm.padEnd(34)} ${v.out || `recognised=${v.rec} colors=${v.colors} transposeFound=${v.transpFound} ratio=${v.ratio.toFixed(3)} proposal=${v.stored !== 0 ? 'YES(' + v.stored + ')' : 'no'}`}`);
const base = makeTrack({ seed: 5, semis: 0, cents: 0 });
const sr = base.sampleRate;
const song = base.song;
const evs = songEvents(song);
// noise (white, 150 s), silence, other song
const R = (() => { let s = 12345; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
const noise = new Float32Array(150 * sr).map(() => (R() * 2 - 1) * 0.3);
show('white noise 150 s', verdict(analyseAndAlign({ samples: noise, sampleRate: sr, song }), song));
// pink-ish (random walk filtered) noise
{ let y = 0; const pink = new Float32Array(150 * sr).map(() => { y = 0.98 * y + (R() * 2 - 1) * 0.1; return y; }); show('brown noise 150 s', verdict(analyseAndAlign({ samples: pink, sampleRate: sr, song }), song)); }
show('silence 150 s', verdict(analyseAndAlign({ samples: new Float32Array(150 * sr), sampleRate: sr, song }), song));
show('very quiet noise (-60 dB)', verdict(analyseAndAlign({ samples: noise.map((v) => v * 0.001), sampleRate: sr, song }), song));
// another song: the bench generator with other chords, same length-ish
{
  const other = makeBench([
    { name: 'A', kind: 'stable', bpm: 100, chords: [['Dm', 4], ['Bb', 4], ['Gm', 4], ['A', 4], ['Dm', 4], ['Bb', 4], ['F', 4], ['A', 4]] },
    { name: 'B', kind: 'stable', bpm: 120, chords: [['E', 4], ['B', 4], ['C#m', 4], ['A', 4], ['E', 4], ['B', 4], ['A', 4], ['E', 4]] },
    { name: 'C', kind: 'stable', bpm: 80, chords: [['F#m', 4], ['D', 4], ['A', 4], ['E', 4], ['F#m', 4], ['D', 4], ['A', 4], ['E', 4]] },
    { name: 'D', kind: 'stable', bpm: 110, chords: [['Bb', 4], ['Eb', 4], ['Cm', 4], ['F', 4], ['Bb', 4], ['Eb', 4], ['F', 4], ['Bb', 4]] },
  ], { seed: 3 });
  show('another song (other chords)', verdict(analyseAndAlign({ samples: other.samples, sampleRate: other.sampleRate, song }), song));
}
// right song with strong noise: SNR sweep
console.log('\nright song, white noise at SNR (dB) -> boundary');
for (const snr of [20, 10, 5, 0, -5, -10]) {
  const noisy = addNoiseSnr(base.samples, snr, 77);
  const res = analyseAndAlign({ samples: noisy, sampleRate: sr, song });
  const v = verdict(res, song);
  const within = res ? evs.map((e, j) => (e.section === 3 ? null : Math.abs(res.eventStartSec[j] - base.truth[j]) <= 0.25)).filter((x) => x !== null) : [];
  console.log(`SNR ${String(snr).padStart(3)} dB: ` + (v.out || `recognised=${v.rec} colors=${v.colors} stable-within-250ms=${(100 * within.filter(Boolean).length / within.length).toFixed(0)}% transposeFound=${v.transpFound} ratio=${v.ratio.toFixed(3)} proposal=${v.stored !== 0 ? 'YES(' + v.stored + ')' : 'no'}`));
}
console.log('\nsame at a second seed (11), pink-ish noise');
for (const snr of [5, 0, -5]) {
  const b2 = makeTrack({ seed: 11, semis: 0, cents: 0 });
  let y = 0; const rs = (() => { let s = 99; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
  const pn = b2.samples.map(() => { y = 0.9 * y + (rs() * 2 - 1); return y; });
  const sig = Math.sqrt(b2.samples.reduce((s, v) => s + v * v, 0) / b2.samples.length), nz = Math.sqrt(pn.reduce((s, v) => s + v * v, 0) / pn.length);
  const mixed = b2.samples.map((v, i) => v + pn[i] * (sig / nz) / 10 ** (snr / 20));
  const res = analyseAndAlign({ samples: mixed, sampleRate: sr, song: b2.song });
  const v = verdict(res, b2.song);
  const within = res ? songEvents(b2.song).map((e, j) => (e.section === 3 ? null : Math.abs(res.eventStartSec[j] - b2.truth[j]) <= 0.25)).filter((x) => x !== null) : [];
  console.log(`SNR ${snr} dB pink: ` + (v.out || `recognised=${v.rec} colors=${v.colors} stable-within-250ms=${(100 * within.filter(Boolean).length / within.length).toFixed(0)}% proposal=${v.stored !== 0 ? 'YES(' + v.stored + ')' : 'no'}`));
}
console.log('\ntransposed audio');
for (const semis of [2, -5, 1, -1, 6]) {
  const tr = makeTrack({ seed: 5, semis, cents: 0 });
  const res = analyseAndAlign({ samples: tr.samples, sampleRate: sr, song });
  const v = verdict(res, song);
  console.log(`audio ${semis > 0 ? '+' : ''}${semis} semitones: ` + (v.out || `transposeFound=${v.transpFound} (expected ${semis > 6 ? semis - 12 : semis}) ratio=${v.ratio.toFixed(3)} proposal=${v.stored !== 0 ? 'YES(' + v.stored + ')' : 'no'} recognised=${v.rec} colors=${v.colors}`));
}
