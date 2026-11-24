// Round 3 tester: independent checks of transposition, capo and chord shapes.
// Expected values come from tables written here, not from src/transpose.js or src/chords-db.js.
// Run: node test/e2e/round3-tester-core.mjs
import { transposeChord, estimateKey, transposedKey, usesFlats, displayChordName, suggestCapo, chordDifficulty } from '../../src/transpose.js';
import { getChordShapes, getChordShape } from '../../src/chords-db.js';
import { renderDiagramSvg } from '../../src/diagram.js';

let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };

// ---- my own tables ----
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const pcOf = (n) => { let p = 'CDEFGAB'.indexOf(n[0]); p = [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(n[0])]; if (n[1] === '#') p++; if (n[1] === 'b') p--; return (p + 120) % 12; };
const spell = (pc, flats) => (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];
const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const QUALS = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'add9', 'dim', 'aug', 'm7b5', '6', '9'];
const expTrans = (root, q, bass, n, flats) => spell(pcOf(root) + n, flats) + q + (bass ? '/' + spell(pcOf(bass) + n, flats) : '');

// B1
let cases = 0, bad = [];
for (const root of ROOTS) for (const q of QUALS) for (const bass of [null, 'E', 'F#', 'Bb']) {
  const name = root + q + (bass ? '/' + bass : '');
  for (let n = -11; n <= 11; n++) {
    if (n === 0) continue;
    for (const flats of [false, true]) {
      cases++;
      const got = transposeChord(name, n, { preferFlats: flats });
      const exp = expTrans(root, q, bass, n, flats);
      if (got !== exp) bad.push(`${name} ${n} ${flats}: got ${got} exp ${exp}`);
    }
  }
}
rec('B1 transposeChord vs own table', bad.length === 0, `${cases} casi, ${bad.length} diversi ${bad.slice(0, 5).join(' | ')}`);

// +-12 identity (normalised)
let bad12 = [];
for (const root of ROOTS) for (const q of QUALS) {
  for (const flats of [false, true]) {
    const a = transposeChord(root + q, 12, { preferFlats: flats }), b = transposeChord(root + q, -12, { preferFlats: flats });
    const exp = spell(pcOf(root), flats) + q;
    if (a !== exp || b !== exp) bad12.push(root + q);
  }
}
rec('B1 +-12 = normalised original', bad12.length === 0, bad12.slice(0, 5).join(','));

// Unknown chords unchanged
rec('B1 unknown unchanged', transposeChord('Xzz', 3) === 'Xzz' && transposeChord('N.C.', 3) === 'N.C.', transposeChord('C13#11b9', 2));

// B3/B4 spelling via displayChordName on synthetic songs
const mk = (key, chords, transpose, capo, shapes) => ({
  key, transpose, capo: capo || 0, view: { showShapes: !!shapes }, chords: [...new Set(chords)],
  sections: [{ lines: [{ chords: chords.map((name) => ({ name, beats: 4 })) }] }],
});
const gsong = (t, extra = {}) => ({ ...mk('G', ['G', 'D', 'Em', 'C', 'Am'], t), ...extra });
const show = (s, n) => displayChordName(s, n);
const out = {};
out['G+3'] = ['G', 'D', 'Em', 'C', 'Am'].map((n) => show(gsong(3), n)).join(' ');
out['G-2'] = ['G', 'D', 'Em', 'C', 'Am'].map((n) => show(gsong(-2), n)).join(' ');
out['G+8'] = ['G', 'D', 'Em', 'C', 'Am'].map((n) => show(gsong(8), n)).join(' ');
const dsong = (t) => mk('D', ['D', 'A', 'Bm', 'G', 'F#m'], t);
out['D+4'] = ['D', 'A', 'Bm', 'G', 'F#m'].map((n) => show(dsong(4), n)).join(' ');
console.log(out);
rec('B3 G+3 -> Bb (not A#)', show(gsong(3), 'G') === 'Bb' && !/#/.test(out['G+3']), out['G+3']);
rec('B3 G-2 -> F with Bb (not A#)', show(gsong(-2), 'G') === 'F' && show(gsong(-2), 'D') === 'C' && !/#/.test(out['G-2']), out['G-2']);
rec('B3 G+8 -> Eb', show(gsong(8), 'G') === 'Eb' && !/#/.test(out['G+8']), out['G+8']);
rec('B3 D+4 -> F# sharps', show(dsong(4), 'D') === 'F#' && !/b/.test(out['D+4'].replace(/Bm|F#m/g, '')), out['D+4']);

// more spelling: all 12 major keys x 11 shifts, scale chords must never mix sharps and flats and
// must be the correct pitch class
let spellBad = [];
const MAJ_KEY_NAMES = { 0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B' };
const FLAT_KEYS_MAJ = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);
for (let k = 0; k < 12; k++) {
  const keyName = SHARP[k];
  const prog = [0, 5, 7].map((d) => spell(k + d, FLAT_KEYS_MAJ.has(spell(k, true)) && k !== 6 ? true : false));
  // use key C-based song transposed: source key C major, chords C F G Am Dm Em
  const s = mk('C', ['C', 'F', 'G', 'Am', 'Dm', 'Em'], k);
  const shown = ['C', 'F', 'G', 'Am', 'Dm', 'Em'].map((n) => show(s, n));
  const flatsExpected = FLAT_KEYS_MAJ.has(MAJ_KEY_NAMES[k]);
  shown.forEach((sn, i) => {
    const orig = ['C', 'F', 'G', 'Am', 'Dm', 'Em'][i];
    const o = /^([A-G][#b]?)(.*)$/.exec(orig);
    const expRoot = spell(pcOf(o[1]) + k, flatsExpected);
    if (sn !== expRoot + o[2]) spellBad.push(`C+${k} ${orig}: ${sn} vs ${expRoot + o[2]}`);
  });
}
rec('B3 C-major song spelled by resulting key, 12 shifts', spellBad.length === 0, spellBad.join(' | '));

// minor key spelling: Am song
let minBad = [];
const FLAT_MINORS = new Set(['D', 'G', 'C', 'F', 'Bb', 'Eb']);
const MIN_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
for (let k = 0; k < 12; k++) {
  const s = mk('Am', ['Am', 'Dm', 'E', 'F', 'G', 'C'], k);
  const flatsE = FLAT_MINORS.has(MIN_NAMES[(9 + k) % 12]);
  ['Am', 'Dm', 'E', 'F', 'G', 'C'].forEach((orig) => {
    const o = /^([A-G][#b]?)(.*)$/.exec(orig);
    const exp = spell(pcOf(o[1]) + k, flatsE) + o[2];
    if (show(s, orig) !== exp) minBad.push(`Am+${k} ${orig}: ${show(s, orig)} vs ${exp}`);
  });
}
rec('B3 minor-key song spelling', minBad.length === 0, minBad.slice(0, 6).join(' | '));

// B4 estimateKey on synthetic songs, all 12 major keys diatonic progressions, no key given
let keyBad = [];
for (let k = 0; k < 12; k++) {
  const deg = [[0, ''], [5, ''], [7, ''], [9, 'm'], [2, 'm'], [4, 'm']];
  const names = [0, 7, 9, 5].map((d) => spell(k + d, false) + (d === 9 ? 'm' : ''));
  const s = mk(null, names, 0);
  const key = estimateKey(s);
  if (pcOf(key.root) !== k || key.minor) keyBad.push(`${SHARP[k]} -> ${key.root}${key.minor ? 'm' : ''}`);
}
rec('B4 estimateKey I-V-vi-IV in 12 keys', keyBad.length === 0, keyBad.join(','));
let minKeyBad = [];
for (let k = 0; k < 12; k++) {
  const names = [[0, 'm'], [8, ''], [3, ''], [10, '']].map(([d, q]) => spell(k + d, false) + q);
  const key = estimateKey(mk(null, names, 0));
  if (pcOf(key.root) !== k || !key.minor) minKeyBad.push(`${SHARP[k]}m -> ${key.root}${key.minor ? 'm' : ''}`);
}
rec('B4 estimateKey i-VI-III-VII in 12 keys', minKeyBad.length === 0, minKeyBad.join(','));

// ---- C: capo on synthetic G song ----
const sc = (t) => suggestCapo(gsong(t));
console.log('capo G t0', JSON.stringify(sc(0)));
console.log('capo G t+2', JSON.stringify(sc(2)));
console.log('capo G t+3', JSON.stringify(sc(3)));
console.log('capo G t+1', JSON.stringify(sc(1)));
console.log('capo G t-1', JSON.stringify(sc(-1)));
// my own difficulty table scoring for transpose +3: written chords Bb Eb... shapes at capo c
const DIFF = (n) => { // independent copy of the plan's table
  const m = /^([A-G][#b]?)(m?)(7|maj7|sus2|sus4|add9)?$/.exec(n); if (!m) return 5;
  const [, r, mi, q] = m;
  if (!q) { if (!mi) return ['C', 'G', 'D', 'A', 'E'].includes(r) ? 1 : r === 'F' ? 3 : 4; return ['A', 'E', 'D'].includes(r) ? 1 : r === 'B' ? 3 : 4; }
  if (q === '7' && !mi) return ['G', 'D', 'A', 'E', 'C', 'B'].includes(r) ? 1.5 : 4;
  return 4;
};
for (const t of [3, 5, -3, 1]) {
  const base = ['G', 'D', 'Em', 'C', 'Am'];
  const flats = (c) => usesFlats(transposedKey({ root: 'G', minor: false }, t - c));
  const table = [];
  for (let c = 0; c <= 7; c++) {
    const shapes = base.map((n) => { const m = /^([A-G]#?)(.*)$/.exec(n); return spell(pcOf(m[1]) + t - c, flats(c)) + m[2]; });
    table.push({ capo: c, shapes, score: shapes.reduce((a, s) => a + DIFF(s), 0) / 5 });
  }
  table.sort((a, b) => a.score - b.score || a.capo - b.capo);
  const mine = table.slice(0, 3).map((x) => x.capo + ':' + x.shapes.join(','));
  const theirs = suggestCapo(gsong(t)).map((x) => x.capo + ':' + x.shapes.join(','));
  rec(`C1 capo top3 transpose ${t} vs own scoring (equal weights)`, JSON.stringify(mine) === JSON.stringify(theirs), 'mine ' + mine.join(' ; ') + ' || app ' + theirs.join(' ; '));
}
rec('C1 G t0 best capo 0', sc(0)[0].capo === 0);
rec('C1 G t+2 best capo 2 shapes G D Em C Am', sc(2)[0].capo === 2 && sc(2)[0].shapes.join(' ') === 'G D Em C Am', JSON.stringify(sc(2)[0]));

// ---- D1 chord shape musical check ----
const OPEN = [4, 9, 2, 7, 11, 4];
const INTERVALS = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 2, 4, 7], dim: [0, 3, 6], aug: [0, 4, 8], m7b5: [0, 3, 6, 10], 6: [0, 4, 7, 9], 9: [0, 4, 7, 10, 14], m6: [0, 3, 7, 9], dim7: [0, 3, 6, 9], '7sus4': [0, 5, 7, 10], m9: [0, 3, 7, 10, 14], 5: [0, 7] };
const SHAPE_QUALS = Object.keys(INTERVALS);
let total = 0, pass = 0, wrongs = [], noShape = [];
const check = (name, root, q, bass) => {
  const shapes = getChordShapes(name);
  if (!shapes.length) { noShape.push(name); return; }
  shapes.forEach((s, idx) => {
    total++;
    const probs = [];
    if (s.frets.length !== 6) probs.push('len');
    const notes = [];
    s.frets.forEach((f, i) => { if (f !== 'x') notes.push({ i, pc: (OPEN[i] + f) % 12, f }); });
    const chordPcs = INTERVALS[q].map((x) => (pcOf(root) + x) % 12);
    const bassPc = bass ? pcOf(bass) : null;
    if (bassPc !== null) chordPcs.push(bassPc);
    for (const n of notes) if (!chordPcs.includes(n.pc)) probs.push(`str${n.i} fret${n.f} extra note ${SHARP[n.pc]}`);
    if (!notes.some((n) => n.pc === pcOf(root))) probs.push('root missing');
    if (bass && notes.length && notes[0].pc !== bassPc && !s.bass) probs.push(`lowest ${SHARP[notes[0].pc]} != bass ${bass}`);
    // third present for maj/min types (except sus/5)
    const need = INTERVALS[q].filter((x) => x !== 0).slice(0, q === '5' ? 1 : 99);
    if (!bass && !(s.bass)) {
      const required = INTERVALS[q].slice(0, 2).concat([]); // root + second tone
      const missing = INTERVALS[q].filter((x, j) => j < 2 && !notes.some((n) => n.pc === (pcOf(root) + x) % 12));
      if (missing.length) probs.push('missing chord tone ' + missing);
    }
    // lowest sounded note should be root for non-slash (soft)
    if (!bass && !s.bass && notes.length && notes[0].pc !== pcOf(root)) probs.push(`bass ${SHARP[notes[0].pc]} not root (soft)`);
    // fret range
    const pos = s.frets.filter((f) => typeof f === 'number' && f > 0);
    if (pos.length && Math.max(...pos) > s.baseFret + 4) probs.push('span');
    if (pos.length && Math.min(...pos) < s.baseFret) probs.push('below baseFret');
    if (s.frets.some((f) => f !== 'x' && (!Number.isInteger(f) || f < 0 || f > 17))) probs.push('bad fret');
    if (s.baseFret > 1 && s.frets.includes(0)) probs.push('open string with baseFret>1');
    // barre check: barre fret must be played on from..to
    for (const b of s.barres || []) for (let i = b.from; i <= b.to; i++) if (s.frets[i] !== 'x' && s.frets[i] < b.fret) probs.push('barre under open string');
    // can it be played: count distinct fretted strings not covered by barre <= 4 fingers
    const barred = (s.barres || []).map((b) => b.fret);
    let fingers = (s.barres || []).length;
    s.frets.forEach((f, i) => { if (typeof f === 'number' && f > 0 && !((s.barres || []).some((b) => b.fret === f && i >= b.from && i <= b.to))) fingers++; });
    if (fingers > 4) probs.push('needs ' + fingers + ' fingers (soft)');
    // soft errors do not count as wrong
    const hard = probs.filter((p) => !/\(soft\)/.test(p));
    if (hard.length) wrongs.push(`${name}#${idx} [${s.frets.join(' ')}] ${hard.join('; ')}`);
    else pass++;
    if (probs.length !== hard.length) wrongs.push(`(soft) ${name}#${idx} [${s.frets.join(' ')}] ${probs.filter((p) => /soft/.test(p)).join('; ')}`);
  });
};
for (const root of ROOTS) for (const q of SHAPE_QUALS) check(root + q, root, q, null);
for (const sl of ['D/F#', 'G/B', 'C/G', 'C/E', 'Am/G', 'A/C#', 'F/C', 'Em/D', 'D/A', 'G/D', 'E/G#', 'Bb/D', 'C/Bb', 'Am/C']) {
  const m = /^([A-G][#b]?)(m?)\/([A-G][#b]?)$/.exec(sl);
  check(sl, m[1], m[2], m[3]);
}
const hardWrong = wrongs.filter((w) => !w.startsWith('(soft)'));
console.log(`D1 shapes: ${total} forme, ${pass} passano, ${hardWrong.length} sbagliate; nomi senza forma: ${noShape.length}`);
hardWrong.slice(0, 40).forEach((w) => console.log('  WRONG', w));
wrongs.filter((w) => w.startsWith('(soft)')).slice(0, 20).forEach((w) => console.log('  ' + w));
console.log('  no shape:', noShape.join(' '));
rec('D1 all shapes musically right', hardWrong.length === 0, `${pass}/${total}`);

// D2 coverage
const COV = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4'];
const missing = [];
for (const r of ROOTS) for (const q of COV) if (!getChordShape(r + q)) missing.push(r + q);
rec('D2 coverage 12 roots (17 spellings) x 7 qualities', missing.length === 0, missing.join(' '));
rec('D2 unknown -> null', getChordShape('Xzz') === null && getChordShape('C13#11b9') === null && getChordShape('') === null && getChordShape(null) === null);
// enharmonic equal
let enh = [];
for (const [a, b] of [['A#', 'Bb'], ['C#', 'Db'], ['D#', 'Eb'], ['F#', 'Gb'], ['G#', 'Ab']]) for (const q of COV) if (JSON.stringify(getChordShapes(a + q)) !== JSON.stringify(getChordShapes(b + q))) enh.push(a + q);
rec('D2 enharmonics same shapes', enh.length === 0, enh.join(' '));
// svg render sanity
let svgBad = 0;
for (const r of ROOTS) for (const q of COV) { const sh = getChordShape(r + q); const svg = renderDiagramSvg(sh, { size: 64, label: r + q }); if (!svg.startsWith('<svg') || /NaN|undefined/.test(svg)) svgBad++; }
rec('D2 svg render no NaN/undefined', svgBad === 0, String(svgBad));
// real file chords all transpositions
const real = ['G', 'D', 'Em', 'Am', 'C', 'A'];
let nr = [];
for (let n = -12; n <= 12; n++) for (const f of [false, true]) for (const c of real) { const x = transposeChord(c, n, { preferFlats: f }); if (!getChordShape(x)) nr.push(x); }
rec('D2 real-file chords all transpositions have a shape', nr.length === 0, nr.join(' '));
// shape with display name from G song: all
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
