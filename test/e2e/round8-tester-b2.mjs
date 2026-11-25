// Round 8 tester B (adversarial): stable sections where the audio does not follow the grid the engine expects:
// chords anticipated by half a beat or a whole beat, entering late, double-time changes. Looking for a WRONG GREEN.
// node test/e2e/round8-tester-b2.mjs
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeBench } from './round8-tester-bench.mjs';
const hard = [['C', 4], ['Am', 4], ['Em', 4], ['G', 4], ['C', 4], ['Am', 4], ['F', 4], ['G', 4]];
const hard2 = [['Am', 4], ['C', 4], ['Em', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['Em', 4]];
const sec = (name, bpm, shift, chords = hard) => ({ name, kind: 'stable', bpm, chords, shift });
const TR = [
  { id: 'anticip-0.5beat', secs: [sec('A1', 90, -0.5), sec('A2', 120, -0.5, hard2), sec('A3', 100, -0.5), sec('A4', 140, -0.5, hard2)] },
  { id: 'anticip-1beat', secs: [sec('B1', 90, -1), sec('B2', 120, -1, hard2), sec('B3', 100, -1), sec('B4', 70, -1, hard2)] },
  { id: 'late-0.25beat', secs: [sec('L1', 90, 0.25), sec('L2', 120, 0.25, hard2), sec('L3', 100, 0.25), sec('L4', 140, 0.25, hard2)] },
  { id: 'late-0.5beat', secs: [sec('M1', 90, 0.5), sec('M2', 120, 0.5, hard2), sec('M3', 100, 0.5), sec('M4', 140, 0.5, hard2)] },
  { id: 'mixed-control', secs: [sec('C1', 90, 0), sec('C2', 120, -0.5, hard2), sec('C3', 100, 0), sec('C4', 140, 0.25, hard2)] },
];
const rows = [];
for (const tr of TR) for (const seed of [3, 14]) {
  const b = makeBench(tr.secs, { seed });
  const res = analyseAndAlign({ samples: b.samples, sampleRate: b.sampleRate, song: b.song });
  if (!res) { console.log(tr.id, seed, 'null'); continue; }
  const al = makeAlignment(res, b.song); const evs = songEvents(b.song);
  const per = tr.secs.map(() => ({ n: 0, ok: 0, errs: [] }));
  evs.forEach((e, j) => { const err = res.eventStartSec[j] - b.truth[j]; const p = per[e.section]; p.n++; if (Math.abs(err) <= 0.25) p.ok++; p.errs.push(err); });
  const line = tr.secs.map((s, si) => { const st = sectionState(al, si); rows.push({ id: tr.id, seed, st, share: per[si].ok / per[si].n, conf: al.sections[si].confidence }); const med = per[si].errs.slice().sort((x, y) => x - y)[per[si].errs.length >> 1]; return `${s.name}:${st[0]}/${al.sections[si].confidence.toFixed(2)}/${(100 * per[si].ok / per[si].n).toFixed(0)}%/med${(med * 1000).toFixed(0)}ms`; }).join(' ');
  console.log(`${tr.id}/${seed}: ${line}`);
}
const wg = rows.filter((r) => r.st === 'green' && r.share < 0.9);
console.log(`\nwrong greens (green, < 90% within 250 ms): ${wg.length} of ${rows.filter((r) => r.st === 'green').length} green sections`);
wg.forEach((r) => console.log(`  ${r.id}/${r.seed} conf ${r.conf} share ${(100 * r.share).toFixed(0)}%`));
