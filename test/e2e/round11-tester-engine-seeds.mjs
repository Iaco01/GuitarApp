// Round 11 tester: copy of round9-tester-engine.mjs with five other seeds (311..359); original: Round 9 tester, B: engine checks with NEW seeds. Synthetic material only (no song text).
//   node test/e2e/round9-tester-engine.mjs cut | missing | intro | free | all
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';
import { makeTrack, makeForeign, concat, secOfEvents } from './round8-tester-make.mjs';
import { makeBench } from './round8-tester-bench.mjs';
const COL = { green: 'g', yellow: 'y', red: 'r', verified: 'v', skipped: 's' };
const mode = process.argv[2] || 'all';
const SEEDS = [311, 317, 331, 347, 359];
const want = (m) => mode === 'all' || mode === m;
const run = (samples, sr, song) => { const t0 = Date.now(); const res = analyseAndAlign({ samples, sampleRate: sr, song }); return { res, al: makeAlignment(res, song), ms: Date.now() - t0 }; };
const fx = (chords, dur, seed, sr, bpm = 100) => { const many = Array.from({ length: 60 }, (_, i) => chords[i % chords.length]); const x = makeForeign({ chords: many, bpm, seed, rate: sr }).samples; if (x.length < dur * sr) throw new Error('foreign audio shorter than asked'); return x.subarray(0, Math.floor(dur * sr)); };

if (want('cut')) {
  console.log('\n== B1 audio cut at 40..95% (seeds ' + SEEDS.join(',') + ')');
  let cuts = 0, wrongGreen = 0, wrongSkip = 0, greenSecs = 0, badRed = 0;
  for (const seed of SEEDS) {
    const base = makeTrack({ seed }); const sr = base.sampleRate; const evs = songEvents(base.song);
    for (const frac of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
      const cut = base.meta.durationSec * frac;
      const { res, al } = run(base.samples.subarray(0, Math.floor(cut * sr)), sr, base.song);
      const st = base.song.sections.map((_, si) => sectionState(al, si));
      const per = base.song.sections.map(() => ({ n: 0, bad: 0 }));
      evs.forEach((e, j) => { if (base.truth[j] > cut - 1) return; const s = per[e.section]; s.n++; if (Math.abs(res.eventStartSec[j] - base.truth[j]) > 0.25) s.bad++; });
      const gw = [], ws = [];
      st.forEach((s, si) => {
        if (s === 'green') { greenSecs++; if (per[si].n && per[si].bad / per[si].n > 0.1) { wrongGreen++; gw.push(`${si + 1}:${per[si].bad}/${per[si].n}`); } }
        if (s === 'skipped' && per[si].n >= 2) { wrongSkip++; ws.push(`${si + 1}(audible ${per[si].n})`); }
      });
      cuts++;
      console.log(`seed ${seed} cut ${(frac * 100) | 0}%: ${st.map((s) => COL[s]).join('')} wrong-green ${gw.join(' ') || '-'} wrong-skip ${ws.join(' ') || '-'}`);
    }
  }
  console.log(`B1 TOTAL cuts ${cuts}, green sections ${greenSecs}, WRONG GREEN ${wrongGreen}, WRONG SKIPPED (audible, >=2 events) ${wrongSkip}`);
}

if (want('missing')) {
  console.log('\n== B2 sections missing in the middle of the audio');
  for (const seed of SEEDS) {
    const base = makeTrack({ seed }); const sr = base.sampleRate; const evs = songEvents(base.song);
    const idx = (si) => secOfEvents(evs, si);
    const tS = (si) => base.truth[idx(si)[0]];
    const tE = (si) => { const l = idx(si); return l[l.length - 1] + 1 < base.truth.length ? base.truth[l[l.length - 1] + 1] : base.meta.durationSec; };
    const slice = (a, b) => base.samples.subarray(Math.floor(a * sr), Math.floor(b * sr));
    const total = base.meta.durationSec;
    const cases = [
      { name: 'minus Bridge(5)', rm: [5], solo: false },
      { name: 'minus Verse2(4)', rm: [4], solo: false },
      { name: 'minus Verse2+Bridge', rm: [4, 5], solo: false },
      { name: 'minus Chorus1(2)+Verse2', rm: [2, 4], solo: false },
      { name: 'Bridge->solo 20s', rm: [5], solo: true },
    ];
    for (const c of cases) {
      const parts = []; let t = 0; const gapsTrue = []; const keep = (j) => !c.rm.includes(evs[j].section);
      for (let si = 0; si < base.song.sections.length; si++) {
        const a = tS(si), b = tE(si);
        if (c.rm.includes(si)) { if (c.solo) { const s = fx(['Dm', 'Bb', 'F', 'A', 'Gm', 'Bb', 'F', 'A'], 20, seed + 5, sr, 96); gapsTrue.push([a, a + 20]); parts.push(s); } continue; }
        parts.push(slice(si === 0 ? 0 : a, b));
      }
      const { res, al } = run(concat(parts), sr, base.song);
      // truth for kept events: shift by removed duration before
      const removedBefore = (tt) => c.rm.reduce((s, si) => s + (tS(si) < tt - 1e-6 ? (tE(si) - tS(si)) - (c.solo ? 20 : 0) : 0), 0);
      let n = 0, ok = 0; const st = base.song.sections.map((_, si) => sectionState(al, si));
      evs.forEach((e, j) => { if (!keep(j)) return; n++; if (Math.abs(res.eventStartSec[j] - (base.truth[j] - removedBefore(base.truth[j]))) <= 0.25) ok++; });
      const skippedSecs = st.map((s, si) => (s === 'skipped' ? si + 1 : null)).filter(Boolean);
      const wrongSk = skippedSecs.filter((s) => !c.rm.includes(s - 1));
      const missedSk = c.rm.filter((s) => st[s] !== 'skipped').map((s) => s + 1);
      console.log(`seed ${seed} ${c.name.padEnd(24)} ${st.map((s) => COL[s]).join('')} kept within250 ${(100 * ok / n).toFixed(1)}% skipped=[${skippedSecs}] wrong-skip=[${wrongSk}] missed-skip=[${missedSk}] gaps=${res.gaps.map((g) => g.startSec.toFixed(1) + '-' + g.endSec.toFixed(1)).join(' ') || '-'} true gaps=${gapsTrue.map((g) => g[0].toFixed(1) + '-' + g[1].toFixed(1)).join(' ') || '-'}`);
    }
  }
}

if (want('intro')) {
  console.log('\n== B3 foreign intro (5/15/30 s) and intro with the same chords as the Verse; first-event error (s)');
  for (const seed of SEEDS) {
    const base = makeTrack({ seed }); const sr = base.sampleRate;
    const row = [];
    for (const L of [5, 15, 30]) {
      const intro = fx(['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'F', 'A'], L, seed + 1, sr, 110);
      const { res, al } = run(concat([intro, base.samples]), sr, base.song);
      row.push(`foreign${L}s: err ${(res.eventStartSec[0] - (base.truth[0] + L)).toFixed(2)} conf ${res.confidence[0].toFixed(2)} sec1=${COL[sectionState(al, 0)]} gaps=${res.gaps.length}`);
    }
    for (const L of [15, 30]) {
      const intro = fx(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'], L, seed + 2, sr, 120);
      const { res, al } = run(concat([intro, base.samples]), sr, base.song);
      row.push(`sameVerse${L}s: err ${(res.eventStartSec[0] - (base.truth[0] + L)).toFixed(2)} conf ${res.confidence[0].toFixed(2)} sec1=${COL[sectionState(al, 0)]}`);
    }
    console.log(`seed ${seed}: ` + row.join(' | '));
  }
}

if (want('free')) {
  console.log('\n== B4 free tempo bench (new seeds): share within 250 ms per colour, Spearman(conf, error)');
  const S = (name, kind, bpm, chords) => ({ name, kind, bpm, chords });
  const stable = [['C', 4], ['Am', 4], ['Em', 4], ['G', 4], ['C', 4], ['Am', 4], ['F', 4], ['G', 4]];
  // arpeggio whose first note is shared with the previous chord (Am->C share C/E, C->G..., F->Am share A/C)
  const shared = [['Am', 4], ['C', 4], ['Am', 4], ['F', 4], ['C', 4], ['Em', 4], ['G', 4], ['Em', 4]];
  const held = [['Em', 8], ['A', 8], ['D', 8], ['G', 8], ['Em', 8]];
  const rare = [['Em', 4], ['D', 12], ['C', 4], ['G', 16], ['Am', 4]]; // voice alone, rare chords: free kind with few events
  const rows = [];
  const defs = [
    ['arp-shared', (k) => [S('A1' + k, 'free', null, shared), S('T1', 'stable', 100, stable), S('A2' + k, 'free', null, shared.slice().reverse())]],
    ['rubato', (k) => [S('R1' + k, 'rubato', 90, stable), S('T2', 'stable', 110, stable), S('R2' + k, 'rubato', 120, stable)]],
    ['held', (k) => [S('H1' + k, 'free', null, held), S('T3', 'stable', 100, stable), S('H2' + k, 'free', null, held.slice(1))]],
    ['voice-rare', (k) => [S('V1' + k, 'free', null, rare), S('T4', 'stable', 120, stable), S('V2' + k, 'free', null, rare.slice().reverse())]],
  ];
  const seedsB = [41, 52, 67];
  const sec = [];
  for (const [id, mk] of defs) for (const seed of seedsB) {
    const secs = mk(seed); const b = makeBench(secs, { seed });
    const { res, al } = run(b.samples, b.sampleRate, b.song);
    const evs = songEvents(b.song);
    const per = secs.map(() => ({ n: 0, ok: 0 }));
    evs.forEach((e, j) => { const err = Math.abs(res.eventStartSec[j] - b.truth[j]); per[e.section].n++; if (err <= 0.25) per[e.section].ok++; if (al.sections[e.section].bpm === null && b.kind[j] !== 'stable') rows.push({ conf: res.confidence[j], err }); });
    secs.forEach((s, si) => { if (s.kind === 'stable') return; sec.push({ id, seed, name: s.name, st: sectionState(al, si), nofbeat: al.sections[si].bpm === null, n: per[si].n, ok: per[si].ok, share: per[si].ok / per[si].n }); });
  }
  sec.forEach((s) => console.log(`${s.id.padEnd(11)} seed ${s.seed} ${s.name.padEnd(8)} state=${s.st.padEnd(6)} free=${s.nofbeat} within250 ${(100 * s.share).toFixed(0)}% (${s.ok}/${s.n})`));
  for (const free of [true, false]) for (const c of ['green', 'yellow', 'red']) {
    const ss = sec.filter((s) => s.nofbeat === free && s.st === c); if (!ss.length) continue;
    const n = ss.reduce((a, s) => a + s.n, 0), ok = ss.reduce((a, s) => a + s.ok, 0);
    console.log(`${free ? 'FREE (no stable beat)' : 'with beat (rubato/other)'} ${c.padEnd(6)} ${ss.length} sections ${n} changes ${(100 * ok / n).toFixed(1)}% within 250 ms`);
  }
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); let i = 0; while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  if (rows.length > 3) { const a = rank(rows.map((r) => r.conf)), b = rank(rows.map((r) => r.err)); const m = (x) => x.reduce((s, v) => s + v, 0) / x.length; const ma = m(a), mb = m(b); let nu = 0, da = 0, db = 0; a.forEach((v, i) => { nu += (v - ma) * (b[i] - mb); da += (v - ma) ** 2; db += (b[i] - mb) ** 2; }); console.log(`Spearman(conf, err) on ${rows.length} free-section events: ${(nu / Math.sqrt(da * db)).toFixed(3)} (negative = good)`); }
}
