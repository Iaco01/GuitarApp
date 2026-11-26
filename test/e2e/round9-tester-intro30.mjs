// Round 9 tester: long foreign intro (20..60 s) - first events error, colour and confidence of section 1.  Synthetic only.
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeTrack, makeForeign, concat } from './round8-tester-make.mjs';
for (const seed of [61, 88]) {
  const base = makeTrack({ seed }); const sr = base.sampleRate; const evs = songEvents(base.song);
  for (const kind of ['foreign', 'sameVerse']) for (const L of [20, 25, 30, 45, 60]) {
    const chords = kind === 'foreign' ? ['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A'] : ['Am', 'F', 'C', 'G'];
    const f = makeForeign({ chords: Array.from({ length: 40 }, (_, i) => chords[i % chords.length]), bpm: 110, seed: seed + 3, rate: sr }).samples.subarray(0, Math.floor(L * sr));
    const res = analyseAndAlign({ samples: concat([f, base.samples]), sampleRate: sr, song: base.song });
    const al = makeAlignment(res, base.song);
    const secEv = evs.map((e, j) => (e.section === 0 ? j : -1)).filter((j) => j >= 0);
    const wrong = secEv.filter((j) => Math.abs(res.eventStartSec[j] - (base.truth[j] + L)) > 0.25).length;
    console.log(`seed ${seed} ${kind} ${L}s: first err ${(res.eventStartSec[0] - base.truth[0] - L).toFixed(2)} s, conf ${res.confidence[0].toFixed(2)}, section1 ${sectionState(al, 0)} wrong ${wrong}/${secEv.length}, gaps ${res.gaps.length}`);
  }
}
