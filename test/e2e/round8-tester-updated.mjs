// Round 8 tester: updated version of the round 7 checks whose expected behaviour changed on purpose.
//  - C3c (round7-tester-app.cjs synth): "live highlight in the free section within 250 ms [expected weak spot]".
//    New rule (round 8 decision): a section without a stable beat is never green; its changes with an error > 250 ms must carry a
//    confidence < 0.6 (yellow at most, red when the sharpness is low). Checked on the engine for 3 seeds (the tester generator, free section = 3).
//  - C4a ("with a skipped tap nothing can be saved") is replaced by round8-tester-app.cjs correct (D1g-D1i): partial save allowed, the missing
//    chords keep the automatic time, a late tap is refused with a message.
// node test/e2e/round8-tester-updated.mjs
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeTrack } from './round8-tester-make.mjs';
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
for (const seed of [3, 11, 29, 5, 17]) {
  const t = makeTrack({ seed, semis: 1, cents: -25 });
  const res = analyseAndAlign({ samples: t.samples, sampleRate: t.sampleRate, song: t.song });
  const al = makeAlignment(res, t.song);
  const evs = songEvents(t.song);
  const idx = evs.map((e, j) => (e.section === 3 ? j : -1)).filter((j) => j >= 0);
  const wrongHigh = idx.filter((j) => Math.abs(res.eventStartSec[j] - t.truth[j]) > 0.25 && res.confidence[j] >= 0.6);
  const st = sectionState(al, 3);
  rec(`C3c-new seed ${seed}: free section not green (${st}); every change > 250 ms off has confidence < 0.6`, st !== 'green' && wrongHigh.length === 0, `errors ms ${idx.map((j) => (1000 * Math.abs(res.eventStartSec[j] - t.truth[j])).toFixed(0)).join('/')} conf ${idx.map((j) => res.confidence[j].toFixed(2)).join('/')}`);
}
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
