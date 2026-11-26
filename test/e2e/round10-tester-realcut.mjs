// Round 10 tester, C1-C3, C5: the REAL song (local only, copyrighted) with sections removed / repeated, cut at the end / at the
// start, a foreign "solo" instead of a section. Reference = analysis of the whole file with the same engine; "expected" times
// follow from the edit. Measures: wrong greens (green section with >10% of its events > 250 ms from the expected place),
// wrongly skipped sections, absent-but-not-skipped sections, and what the user would see: events (and seconds) whose time falls
// inside a stretch of the audio that really belongs to ANOTHER section of the sheet (wrong text highlighted).
// Counts and section numbers only. Run: node test/e2e/round10-tester-realcut.mjs [srcdir] [scenarios,comma]
//   srcdir defaults to ../../src (current); pass /tmp/r9wt/src for the round-9 engine.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const SRC = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..', 'src'));
const only = process.argv[3] ? process.argv[3].split(',') : null;
const { parseSongFromMht } = await import(path.join(SRC, 'parser.js'));
const { analyseAndAlign, songEvents } = await import(path.join(SRC, 'analysis', 'autosync.js'));
const { makeAlignment, sectionState, alignmentRecognised } = await import(path.join(SRC, 'alignment.js'));
const L = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(L + 'american-pie.mp3')) { console.log('file reali assenti'); process.exit(0); }
const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
const evs = songEvents(song);
const decode = (args) => { const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', ...args, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 }); return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4))); };
const X = decode(['-i', L + 'american-pie.mp3']);
const SR = 44100; const DUR = X.length / SR;
const run = (x) => { const t0 = Date.now(); const res = analyseAndAlign({ samples: x, sampleRate: SR, song }); if (!res) return { res: null }; const al = makeAlignment(res, song); return { res, al, st: song.sections.map((_, si) => sectionState(al, si)), ms: Date.now() - t0 }; };
const ref = run(X);
const refT = ref.res.eventStartSec;
console.log(`engine ${SRC}\nwhole: ${DUR.toFixed(1)} s colours ${ref.st.map((s) => s[0]).join('')} gaps ${ref.res.gaps.length} compute ${ref.ms} ms`);
const secStart = (si) => refT[evs.findIndex((e) => e.section === si)];
const secEnd = (si) => (si + 1 < song.sections.length ? secStart(si + 1) : DUR);
const secLen = (si) => secEnd(si) - secStart(si);
console.log('sections: ' + song.sections.map((s, i) => `${i + 1}:${s.name}(${secLen(i).toFixed(0)}s)`).join(' '));
const splice = (parts) => { const total = parts.reduce((s, p) => s + p.length, 0); const out = new Float32Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const seg = (a, b) => X.subarray(Math.floor(a * SR), Math.min(X.length, Math.floor(b * SR)));
const textOf = song.sections.map((sec) => JSON.stringify(sec.lines.map((l) => [l.lyric, l.chords.map((c) => c.name)])));
const sameText = (a, b) => a === b || textOf[a] === textOf[b];
// piece(j) in the NEW audio: list of {src:[a,b), dst:a0} mapping of the reference audio; 'pieces' describe the new audio
// expected(j): start of event j in the new audio or null. truthSection(t): which sheet section really plays at new time t (or -1 foreign)
function scenario(name, pieces) {
  // pieces: [{a,b} from reference audio | {foreign: Float32Array, label}]; builds audio, expected map, truth timeline
  let t = 0; const map = []; const parts = [];
  for (const p of pieces) {
    if (p.foreign) { parts.push(p.foreign); map.push({ ns: t, ne: t + p.foreign.length / SR, os: null, oe: null }); t += p.foreign.length / SR; }
    else { parts.push(seg(p.a, p.b)); const len = Math.min(p.b, DUR) - p.a; map.push({ ns: t, ne: t + len, os: p.a, oe: p.a + len }); t += len; }
  }
  const x = splice(parts);
  const candidates = (j) => { const o = refT[j]; const c = []; for (const m of map) if (m.os !== null && o >= m.os - 1e-9 && o < m.oe - 0.5) c.push(m.ns + (o - m.os)); return c; }; // events within the last 0.5 s of a piece are too close to the edit
  const expected = (j) => { const c = candidates(j); return c.length ? c[0] : null; };
  const truthSecAt = (tn) => { for (const m of map) if (tn >= m.ns && tn < m.ne) { if (m.os === null) return -1; const o = m.os + (tn - m.ns); let s = -1; for (let si = 0; si < song.sections.length; si++) if (o >= secStart(si) - 1e-9) s = si; return s; } return -1; };
  const out = run(x);
  if (!out.res) { console.log(`${name.padEnd(30)} analysis returned null (audio refused before any alignment)`); return { refused: true }; }
  const { res, al, st, ms } = out;
  const per = song.sections.map(() => ({ n: 0, bad: 0 }));
  evs.forEach((e, j) => { const ex = expected(j); if (ex === null) return; per[e.section].n++; if (!candidates(j).some((c) => Math.abs(res.eventStartSec[j] - c) <= 0.25)) per[e.section].bad++; });
  const skippedSet = new Set(al.skipped || []);
  const wrongSkip = [], wrongGreen = [], missedSkip = [], wrongYellow = [];
  st.forEach((s, si) => {
    const sec = per[si];
    if (s === 'skipped' && sec.n >= 3) wrongSkip.push(`${si + 1}(${sec.n} ev)`);
    if (s === 'green' && sec.n && sec.bad / sec.n > 0.1) wrongGreen.push(`${si + 1}:${sec.bad}/${sec.n}`);
    if (s === 'yellow' && sec.n && sec.bad / sec.n > 0.5) wrongYellow.push(`${si + 1}:${sec.bad}/${sec.n}`);
    if (s !== 'skipped' && sec.n === 0 && evs.some((e) => e.section === si)) missedSkip.push(si + 1);
  });
  // what the user sees: for every present (not skipped) event, which sheet section really plays at its aligned time
  let present = 0, wrongText = 0, wrongSecs = 0; const wrongBy = {};
  evs.forEach((e, j) => { if (skippedSet.has(j)) return; present++; const ts = truthSecAt(res.eventStartSec[j] + 0.05); if (ts === -1 || !sameText(ts, e.section)) { wrongText++; wrongBy[e.section + 1] = (wrongBy[e.section + 1] || 0) + 1; } });
  if (process.env.DETAIL) console.log('   detail: ' + song.sections.map((sec, si) => { const j = evs.findIndex((e) => e.section === si); return `${si + 1}${skippedSet.has(j) ? 'S' : ''}@${res.eventStartSec[j].toFixed(0)}=>truth ${truthSecAt(res.eventStartSec[j] + 0.05) + 1}`; }).join(' '));
  const nSec = song.sections.map((_, si) => evs.filter((e, j) => e.section === si && !skippedSet.has(j)).length);
  const greenWrongText = st.map((s, si) => ((s === 'green' || s === 'verified') && nSec[si] && (wrongBy[si + 1] || 0) / nSec[si] > 0.1 ? `${si + 1}:${wrongBy[si + 1]}/${nSec[si]}` : null)).filter(Boolean);
  const sk = st.map((s, i) => (s === 'skipped' ? i + 1 : null)).filter(Boolean);
  console.log(`${name.padEnd(30)} rec=${alignmentRecognised(al, song) ? 'SI' : 'NO'} ${st.map((s) => s[0]).join('')} skipped [${sk}] wrongSkip [${wrongSkip}] absentNotSkipped [${missedSkip}] wrongGreen(time) [${wrongGreen}] GREEN-WITH-WRONG-TEXT [${greenWrongText}] wrongYellow [${wrongYellow}] gaps ${res.gaps.length} | events on a different section's music: ${wrongText}/${present}${wrongText ? ' by section ' + JSON.stringify(wrongBy) : ''} | ${(ms / 1000).toFixed(1)} s`);
  return { wrongGreen: wrongGreen.length, wrongText, present };
}
const want = (n) => !only || only.includes(n);
if (want('remove')) {
  console.log('--- C1 sections removed');
  for (const si of [2, 3, 4, 5, 6, 8]) scenario(`remove section ${si + 1}`, [{ a: 0, b: secStart(si) }, { a: secEnd(si), b: DUR }]);
  for (const [a, b] of [[3, 4], [6, 7], [2, 8], [4, 8]]) scenario(`remove ${a + 1} and ${b + 1}`, [{ a: 0, b: secStart(a) }, { a: secEnd(a), b: secStart(b) }, { a: secEnd(b), b: DUR }]);
  for (const [r, d] of [[3, 5], [4, 6], [2, 7]]) scenario(`remove ${r + 1}, repeat ${d + 1}`, [{ a: 0, b: secStart(r) }, { a: secEnd(r), b: secEnd(d) }, { a: secStart(d), b: secEnd(d) }, { a: secEnd(d), b: DUR }]);
}
if (want('cut')) {
  console.log('--- C2 cuts');
  for (const f of [0.2, 0.3, 0.45, 0.7]) scenario(`cut at ${f * 100}%`, [{ a: 0, b: DUR * f }]);
  scenario('first 60 s removed', [{ a: 60, b: DUR }]);
  for (const f of [0.2, 0.3, 0.45, 0.7]) scenario(`first 60 s removed + cut ${f * 100}%`, [{ a: 60, b: DUR * f }]);
}
if (want('solo')) {
  console.log('--- C3 solo instead of a section (20 s of another part, transposed)');
  const clip = (from, semis) => { const f = 2 ** (semis / 12); const x = decode(['-ss', String(from), '-t', '20', '-i', L + 'american-pie.mp3', '-af', `asetrate=${Math.round(44100 * f)},aresample=44100,atempo=${(1 / f).toFixed(5)}`]); return x; };
  for (const [si, from, semis] of [[3, secStart(8) + 2, 3], [5, secStart(2) + 2, -2], [7, secStart(4) + 2, 5], [6, 30, 0]]) scenario(`solo for section ${si + 1} (+${semis}st)`, [{ a: 0, b: secStart(si) }, { foreign: clip(from, semis) }, { a: secEnd(si), b: DUR }]);
}
