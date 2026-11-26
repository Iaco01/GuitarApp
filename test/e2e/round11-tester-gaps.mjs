// Round 11 tester, B3: gaps on synthetic material. A section of the audio is replaced by a 20 s solo (a) on other chords,
// (b) strummed vamp on the same chord as the last chord of the previous section, (c) one strum of that chord that rings out
// and decays into silence (the held chord of the real song), (d) the same without drums; plus a repeated section and a foreign intro.
// Synthetic only. node test/e2e/round11-tester-gaps.mjs
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeTrack, makeForeign, concat, secOfEvents } from './round8-tester-make.mjs';
const SEEDS = [211, 223, 239];
const COL = { green: 'g', yellow: 'y', red: 'r', verified: 'v', skipped: 's' };
const run = (samples, sr, song) => { const res = analyseAndAlign({ samples, sampleRate: sr, song }); return { res, al: makeAlignment(res, song) }; };
let bad = 0;
for (const seed of SEEDS) {
  const base = makeTrack({ seed }); const sr = base.sampleRate; const evs = songEvents(base.song);
  const idx = (si) => secOfEvents(evs, si);
  const tS = (si) => base.truth[idx(si)[0]];
  const tE = (si) => { const l = idx(si); return l[l.length - 1] + 1 < base.truth.length ? base.truth[l[l.length - 1] + 1] : base.meta.durationSec; };
  const slice = (a, b) => base.samples.subarray(Math.floor(a * sr), Math.floor(b * sr));
  const rm = 5; const prevChord = evs[idx(rm)[0] - 1].name;
  const fx = (chords, bpm, beatsEach, drums, semis = 1, cents = -25) => makeForeign({ chords, bpm, beatsEach, seed: seed + 3, rate: sr, semis, cents, drums }).samples;
  const cases = [
    { name: 'a solo other chords 20s', audio: fx(['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A'], 96, 4, true) },
    { name: 'b vamp same chord 20s', audio: fx([prevChord], 90, 30, true, 0, 0) },
    { name: 'c one strum rings out 20s', audio: concat([fx([prevChord], 30, 1, false, 0, 0), new Float32Array(Math.floor(18 * sr))]) },
    { name: 'd vamp same chord, no drums', audio: fx([prevChord], 90, 30, false, 0, 0) },
  ];
  for (const c of cases) {
    const parts = []; const dur = c.audio.length / sr;
    for (let si = 0; si < base.song.sections.length; si++) { if (si === rm) { parts.push(c.audio); continue; } parts.push(slice(si === 0 ? 0 : tS(si), tE(si))); }
    const { res, al } = run(concat(parts), sr, base.song);
    const removed = (tE(rm) - tS(rm)) - dur;
    const truthOf = (j) => base.truth[j] - (base.truth[j] > tS(rm) + 1e-6 ? removed : 0);
    let n = 0, ok = 0; const st = base.song.sections.map((_, si) => sectionState(al, si));
    evs.forEach((e, j) => { if (e.section === rm) return; n++; if (Math.abs(res.eventStartSec[j] - truthOf(j)) <= 0.25) ok++; });
    const wrongG = st.map((s, si) => (s === 'green' && si !== rm ? null : null)).filter(Boolean);
    console.log(`seed ${seed} ${c.name.padEnd(28)} ${st.map((s) => COL[s]).join('')} kept within250 ${(100 * ok / n).toFixed(1)}% sec${rm + 1} state=${COL[st[rm]]} gaps=${res.gaps.map((g) => g.startSec.toFixed(1) + '-' + g.endSec.toFixed(1)).join(' ') || '-'} true gap=${tS(rm).toFixed(1)}-${(tS(rm) + dur).toFixed(1)}`);
  }
  // repeated section: the Chorus (2) played twice in the audio
  { const parts = []; for (let si = 0; si < base.song.sections.length; si++) { parts.push(slice(si === 0 ? 0 : tS(si), tE(si))); if (si === 2) parts.push(slice(tS(2), tE(2))); }
    const { res, al } = run(concat(parts), sr, base.song); const st = base.song.sections.map((_, si) => sectionState(al, si));
    console.log(`seed ${seed} ${'repeat section 3 once more'.padEnd(28)} ${st.map((s) => COL[s]).join('')} gaps=${res.gaps.map((g) => g.startSec.toFixed(1) + '-' + g.endSec.toFixed(1)).join(' ') || '-'}  repeated-section length ${(tE(2) - tS(2)).toFixed(1)} s at ${tE(2).toFixed(1)}`); }
  // foreign intro 12 s
  { const intro = fx(['Dm', 'Bb', 'F', 'A'], 100, 4, true); const parts = [intro, slice(0, base.meta.durationSec)];
    const { res, al } = run(concat(parts), sr, base.song); const st = base.song.sections.map((_, si) => sectionState(al, si)); const d = intro.length / sr;
    let ok = 0; evs.forEach((e, j) => { if (Math.abs(res.eventStartSec[j] - (base.truth[j] + d)) <= 0.25) ok++; });
    console.log(`seed ${seed} ${'foreign intro'.padEnd(28)} ${st.map((s) => COL[s]).join('')} within250 ${(100 * ok / evs.length).toFixed(1)}% gaps=${res.gaps.map((g) => g.startSec.toFixed(1) + '-' + g.endSec.toFixed(1)).join(' ') || '-'} intro ${d.toFixed(1)} s`); }
}
