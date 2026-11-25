// Round 8 tester A5: audio shorter than the sheet. Wrong greens: green sections whose changes are wrong.
// node test/e2e/round8-tester-cut.mjs
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeTrack } from './round8-tester-make.mjs';
const COL = { green: 'g', yellow: 'y', red: 'r', verified: 'v', skipped: 's' };
let wrongGreen = 0, greenEvents = 0, total = 0;
for (const seed of [5, 17, 42, 8, 23]) {
  const base = makeTrack({ seed }); const sr = base.sampleRate; const evs = songEvents(base.song);
  for (const frac of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const cut = base.meta.durationSec * frac;
    const res = analyseAndAlign({ samples: base.samples.subarray(0, Math.floor(cut * sr)), sampleRate: sr, song: base.song });
    const al = makeAlignment(res, base.song);
    const st = base.song.sections.map((_, si) => sectionState(al, si));
    const perSec = base.song.sections.map(() => ({ n: 0, bad: 0 }));
    evs.forEach((e, j) => { if (base.truth[j] > cut - 1) return; const s = perSec[e.section]; s.n++; if (Math.abs(res.eventStartSec[j] - base.truth[j]) > 0.25) s.bad++; });
    const gw = st.map((s, si) => (s === 'green' && perSec[si].n && perSec[si].bad / perSec[si].n > 0.1 ? `${si}:${perSec[si].bad}/${perSec[si].n}` : null)).filter(Boolean);
    st.forEach((s, si) => { if (s === 'green') { greenEvents += perSec[si].n; if (perSec[si].n && perSec[si].bad / perSec[si].n > 0.1) { wrongGreen++; } } });
    total++;
    console.log(`seed ${seed} cut ${(frac * 100) | 0}%: colors ${st.map((s) => COL[s]).join('')} bad(>250ms)/audible per section ${perSec.map((p) => p.bad + '/' + p.n).join(' ')} wrong-green sections: ${gw.join(' ') || '-'}`);
  }
}
console.log(`wrong-green sections (green but >10% of audible changes off by >250 ms): ${wrongGreen} over ${total} cuts`);
