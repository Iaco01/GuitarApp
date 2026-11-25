// Round 5 tester: independent Node checks of the tempo suggestion (bug 1, 2) and of the timeline
// between anchors (bug 4). Expected values are computed here from beats and BPM, not with src/.
// Prints only numbers and section names (no lyrics of the real file).
// Run: node test/e2e/round4-tester-make.mjs && node test/e2e/round5-tester-core.mjs
import { readFileSync, existsSync } from 'node:fs';
import { parseSongFromMht } from '../../src/parser.js';
import { effectiveSectionBpms } from '../../src/model.js';
import { buildTimeline } from '../../src/timeline.js';
import { suggestSectionBpms, applyBpmSuggestion } from '../../src/audiosync.js';

let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const beatsOf = (sec) => sec.lines.reduce((n, l) => n + l.chords.reduce((m, c) => m + Math.max(1, Math.round(c.beats)), 0), 0);
const secLen = (s, bpms) => s.sections.map((sec, i) => (beatsOf(sec) * 60) / bpms[i]);
const D = new URL('../../test-artifacts/round-4/tester/', import.meta.url).pathname;

// ---------- 1. real file ----------
const REAL = new URL('../fixtures/local/american-pie.mht', import.meta.url).pathname;
if (existsSync(REAL)) {
  const base = parseSongFromMht(readFileSync(REAL, 'utf-8'));
  const bp0 = effectiveSectionBpms(base);
  info('real', `${base.sections.length} sections; BPM ${[...new Set(bp0)].join('/')}; beats ${base.sections.map(beatsOf).reduce((a, b) => a + b, 0)}`);
  const total = secLen(base, bp0).reduce((a, b) => a + b, 0);
  for (const pct of [-0.5, -3, 2]) {
    const s = structuredClone(base);
    const OFF = 3;
    const end = OFF + total * (1 + pct / 100);
    s.audio = { offsetSec: OFF, anchors: {}, endSec: end };
    const sug = suggestSectionBpms(s, s.audio);
    rec(`bug1 real ${pct}%: one suggestion`, sug.length === 1, JSON.stringify(sug.map((x) => [x.from, x.to])));
    applyBpmSuggestion(s, sug[0]);
    const bp1 = effectiveSectionBpms(s);
    const lens = secLen(s, bp1);
    const endErr = (OFF + lens.reduce((a, b) => a + b, 0) - end) * 1000;
    // ratios: every section must keep its ratio to section 0 within the 0.1 BPM rounding
    const ratioErr = Math.max(...bp1.map((b, i) => Math.abs(b / bp1[0] - bp0[i] / bp0[0]) / (bp0[i] / bp0[0])));
    const distinct = [...new Set(bp1)];
    info(`bug1 real ${pct}%`, `BPM before ${[...new Set(bp0)].join('/')} -> after ${distinct.join('/')}; end error ${endErr.toFixed(0)} ms; max ratio error ${(ratioErr * 100).toFixed(2)}%`);
    rec(`bug1 real ${pct}%: tempos stay different (not flattened)`, distinct.length === new Set(bp0).size);
    rec(`bug1 real ${pct}%: end error < 100 ms (song is ${total.toFixed(0)} s)`, Math.abs(endErr) < 100, `${endErr.toFixed(0)} ms`);
    rec(`bug1 real ${pct}%: ratios kept within 0.3%`, ratioErr < 0.003, `${(ratioErr * 100).toFixed(2)}%`);
    // timeline built by the app: where does the last section end vs the audio end?
    const tl = buildTimeline(s, { anchors: { 0: OFF } });
    rec(`bug1 real ${pct}%: timeline end within 100 ms of the audio end`, Math.abs(tl.totalSec + 0 - (end - OFF) ) < 0.1 || Math.abs(tl.sections.at(-1).endSec - end) < 0.1, `${((tl.sections.at(-1).endSec - end) * 1000).toFixed(0)} ms`);
    rec(`bug1 real ${pct}%: no second suggestion after Apply`, suggestSectionBpms(s, s.audio).length === 0);
  }
  // anchors on three sections + wrong tail, apply each suggestion, nothing left
  {
    const s = structuredClone(base);
    const OFF = 3;
    const t = [OFF];
    secLen(base, bp0).forEach((l, i) => t.push(t[i] + l * (i < 4 ? 1.01 : 0.985)));
    s.audio = { offsetSec: OFF, anchors: { 4: t[4], 8: t[8] }, endSec: t[12] };
    const sug = suggestSectionBpms(s, s.audio);
    info('bug1 real multi', `${sug.length} suggestions: ${sug.map((x) => `${x.from + 1}-${x.to + 1} x${x.factor.toFixed(4)}`).join(', ')}`);
    for (const x of sug) applyBpmSuggestion(s, x);
    rec('bug1 real multi: all applied -> no more suggestions', suggestSectionBpms(s, s.audio).length === 0);
  }
} else info('real', 'file absent, skipped');

// ---------- 2. threshold of the tempo suggestion, synthetic song ----------
const t4 = JSON.parse(readFileSync(D + 't4-song.json', 'utf-8')).songs[0];
const bp = effectiveSectionBpms(t4);
const L = secLen(t4, bp);
const OFF = 2.345;
const starts = [OFF]; L.forEach((l, i) => starts.push(starts[i] + l));
info('thr', `sections ${t4.sections.map((s, i) => `${s.name} ${bp[i]} BPM ${L[i].toFixed(2)} s`).join('; ')}`);
const firstSug = (mk) => { for (let d = 0; d <= 600; d += 1) { const a = mk(d / 1000); if (suggestSectionBpms(t4, a).length) return d; } return null; };
// anchor of the Finale tapped d late, "Fine brano" exact
const thrFin = firstSug((d) => ({ offsetSec: OFF, anchors: { 3: starts[3] + d }, endSec: starts[4] }));
// anchor of the Ponte tapped d late, nothing else
const thrPonte = firstSug((d) => ({ offsetSec: OFF, anchors: { 2: starts[2] + d } }));
// anchor of the Strofa tapped d early
const thrEarly = firstSug((d) => ({ offsetSec: OFF, anchors: { 1: starts[1] - d } }));
info('thr', `smallest tap error that raises a suggestion: late Finale anchor (stretch Intro-Ponte ${(starts[3] - OFF).toFixed(1)} s) ${thrFin} ms; late Ponte anchor (Intro-Strofa ${(starts[2] - OFF).toFixed(1)} s) ${thrPonte} ms; early Strofa anchor (Intro ${L[0].toFixed(1)} s) ${thrEarly} ms`);
rec('bug2 78 ms late tap: no suggestion (Finale, Ponte, early Strofa)', [78, 100, 140].every((d) => !suggestSectionBpms(t4, { offsetSec: OFF, anchors: { 3: starts[3] + d / 1000 }, endSec: starts[4] }).length));
rec('bug2 threshold above 100 ms and at most 250 ms', thrFin > 100 && thrFin <= 250 && thrPonte > 100 && thrPonte <= 250, `${thrFin}/${thrPonte}`);
// does a real tempo error of 1 BPM on the Finale (97 vs 96, 20 s) get caught?
{
  const s = structuredClone(t4); s.sections[3].bpm = 97;
  const a = { offsetSec: OFF, anchors: { 3: starts[3] }, endSec: starts[4] };
  const sug = suggestSectionBpms(s, a);
  rec('bug2 1 BPM wrong on a 20 s section is still detected', sug.length === 1 && sug[0].from === 3, JSON.stringify(sug.map((x) => [x.from, x.to, x.suggested])));
  // smallest BPM error on the Finale that is detected
  let found = null; for (let e = 0.05; e < 5; e += 0.05) { const s2 = structuredClone(t4); s2.sections[3].bpm = 96 + e; if (suggestSectionBpms(s2, a).length) { found = e; break; } }
  info('thr', `smallest tempo error detected on the 20 s Finale: ${found && found.toFixed(2)} BPM (${found && (found / 96 * 100).toFixed(2)}%)`);
}

// ---------- 3. timeline between anchors: no gap, no jump, ever-increasing events (bug 4) ----------
for (const [label, secIdx, val] of [['Strofa 100', 1, 100], ['Strofa 92', 1, 92], ['Strofa 120', 1, 120], ['Strofa 70', 1, 70], ['Intro 90', 0, 90], ['Finale 110', 3, 110]]) {
  const s = structuredClone(t4); s.sections[secIdx].bpm = val;
  const anchors = { 0: OFF, 1: starts[1], 2: starts[2], 3: starts[3] };
  const tl = buildTimeline(s, { anchors });
  let gap = 0, over = 0;
  for (let i = 0; i < 3; i++) { gap = Math.max(gap, Math.abs(tl.sections[i + 1].startSec - tl.sections[i].endSec)); }
  // events strictly increasing and every event ends where the next starts
  let mono = true, seam = 0;
  for (let i = 1; i < tl.events.length; i++) { if (tl.events[i].startSec <= tl.events[i - 1].startSec) mono = false; seam = Math.max(seam, Math.abs(tl.events[i].startSec - tl.events[i - 1].startSec - tl.events[i - 1].durSec)); }
  // scan every 10 ms: the current event index never skips one nor goes back
  let prev = -1, skip = 0, back = 0;
  for (let t = OFF; t < starts[3] + 5; t += 0.01) {
    let idx = -1; for (let i = 0; i < tl.events.length; i++) if (tl.events[i].startSec <= t) idx = i; else break;
    if (idx < prev) back++; if (idx - prev > 1) skip++; prev = idx;
  }
  rec(`bug4 ${label} all anchored: no gap, monotone, seamless, no skip/back`, gap < 1e-6 && mono && seam < 1e-6 && skip === 0 && back === 0, `gap ${(gap * 1000).toFixed(3)} ms, seam ${(seam * 1000).toFixed(3)} ms, skip ${skip}, back ${back}`);
}
// anchor error on every event for a +1 BPM section, anchors at every section (what the browser test also does)
{
  const s = structuredClone(t4); s.sections[3].bpm = 97;
  const tl0 = buildTimeline(s, { anchors: { 0: OFF } });
  const tl1 = buildTimeline(s, { anchors: { 0: OFF, 1: starts[1], 2: starts[2], 3: starts[3] } });
  const err = (tl) => Math.max(...tl.events.map((e, i) => Math.abs(e.startSec - (starts[e.sectionIndex] + (tl.events[i].startBeat - tl.sections[e.sectionIndex].startBeat) * 60 / bp[e.sectionIndex]))));
  info('bug1 synth', `Finale at 97 instead of 96: max event error without anchors ${(err(tl0) * 1000).toFixed(0)} ms, anchors at every section ${(err(tl1) * 1000).toFixed(0)} ms (the Finale is the last section: no later anchor, only the suggestion fixes it)`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
