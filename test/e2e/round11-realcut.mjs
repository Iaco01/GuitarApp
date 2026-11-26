// Round 11 (from round10-realcut.mjs): the REAL song (local only, copyrighted) cut at the end or with whole sections removed: table of results with
// counts and section numbers only. The expected times come from the analysis of the whole file (saved reference).
//   node test/e2e/round11-realcut.mjs [cases]       cases: head | cut | rm | all   (the reference is the analysis of the whole file, run here)
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised } from '../../src/alignment.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(L + 'american-pie.mp3')) { console.log('file reali assenti'); process.exit(0); }
const which = process.argv[2] || 'all';
const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
const evs = songEvents(song);
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
const SR = 44100; const DUR = X.length / SR;
const ref = analyseAndAlign({ samples: X, sampleRate: SR, song }).eventStartSec;
const secStart = (si) => ref[evs.findIndex((e) => e.section === si)];
const secEnd = (si) => (si + 1 < song.sections.length ? secStart(si + 1) : DUR);
const rows = [];
// sections with the same chord sequence are interchangeable for the engine (the audio of a verse is the audio of any
// verse as far as the chords go): the checks are made by group
const keyOf = (si) => evs.filter((e) => e.section === si).map((e) => e.name).join('|');
const groupOf = (si) => song.sections.map((_, k) => k).filter((k) => keyOf(k) === keyOf(si));
function report(name, x, expected, absentSecs) {
  // expected(j): expected start of event j in the new audio, or null when the event is not in it
  const t0 = Date.now();
  const res = analyseAndAlign({ samples: x, sampleRate: SR, song });
  const al = makeAlignment(res, song);
  const st = song.sections.map((_, si) => sectionState(al, si));
  const per = song.sections.map(() => ({ n: 0, bad: 0 }));
  evs.forEach((e, j) => { const ex = expected(j); if (ex === null) return; per[e.section].n++; if (Math.abs(res.eventStartSec[j] - ex) > 0.25) per[e.section].bad++; });
  const idxOf = (si) => evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0);
  // a section is right when its events are where it expects them, or where those of one of its sisters are
  const sisterOk = (si) => groupOf(si).some((k) => {
    const a = idxOf(si); const b = idxOf(k);
    if (a.length !== b.length) return false;
    let n = 0; let bad = 0;
    a.forEach((j, q) => { const ex = expected(b[q]); if (ex === null) return; n++; if (Math.abs(res.eventStartSec[j] - ex) > 0.25) bad++; });
    return n > 0 && bad / n <= 0.1;
  });
  const wrongSkip = []; const wrongGreen = []; const missedSkip = [];
  song.sections.forEach((_, si) => {
    const g = groupOf(si);
    if (g[0] !== si) return;
    const skipped = g.filter((k) => st[k] === 'skipped').length; const removed = g.filter((k) => absentSecs.includes(k)).length;
    if (skipped < removed) missedSkip.push(`${g.map((k) => k + 1)}(${removed - skipped})`);
    if (skipped > removed) wrongSkip.push(`${g.map((k) => k + 1)}(${skipped - removed})`);
  });
  st.forEach((s, si) => { if (s === 'green' && per[si].n && per[si].bad / per[si].n > 0.1 && !sisterOk(si)) wrongGreen.push(`${si + 1}:${per[si].bad}/${per[si].n}`); });
  const present = per.reduce((a, p) => a + p.n, 0); const bad = per.reduce((a, p) => a + p.bad, 0);
  const row = { name, recognised: alignmentRecognised(al, song), colours: st.map((s) => s[0]).join(''), wrongSkip, wrongGreen, missedSkip, presentEvents: present, badEvents: bad, gaps: res.gaps.length, ms: Date.now() - t0 };
  rows.push(row);
  console.log(`${name.padEnd(26)} rec=${row.recognised ? 'SI' : 'NO'} ${row.colours} wrong-skip [${wrongSkip}] wrong-green [${wrongGreen}] absent-not-skipped [${missedSkip}] events off>250ms ${bad}/${present} gaps ${row.gaps} (${row.ms} ms)`);
}
if (which === 'all' || which === 'cut') {
  for (const f of [0.2, 0.3, 0.45, 0.5, 0.7, 0.8, 0.95]) {
    const n = Math.floor(X.length * f);
    const absent = song.sections.map((_, si) => si).filter((si) => secStart(si) > n / SR - 1);
    report(`cut at ${f * 100}%`, X.subarray(0, n), (j) => (ref[j] < n / SR - 1 ? ref[j] : null), absent);
  }
}
if (which === 'all' || which === 'head') {
  // the first `h` seconds removed (and optionally the tail too)
  for (const [h, f] of [[60, 1], [30, 1], [60, 0.7], [60, 0.45]]) {
    const a = Math.floor(h * SR); const n = Math.floor(X.length * f);
    const absent = song.sections.map((_, si) => si).filter((si) => secEnd(si) < h + 1 || secStart(si) > n / SR - 1);
    report(`head cut ${h}s, tail ${Math.round(f * 100)}%`, X.subarray(a, n), (j) => (ref[j] > h + 1 && ref[j] < n / SR - 1 ? ref[j] - h : null), absent);
  }
}
if (which === 'all' || which === 'rm') {
  const cutMid = (list) => {
    const keep = []; let t = 0;
    for (let si = 0; si < song.sections.length; si++) { if (list.includes(si)) continue; const a = si === 0 ? 0 : secStart(si); keep.push(X.subarray(Math.floor(a * SR), Math.floor(secEnd(si) * SR))); }
    const out = new Float32Array(keep.reduce((a, k) => a + k.length, 0)); let o = 0; for (const k of keep) { out.set(k, o); o += k.length; }
    return out;
  };
  for (const list of [[2], [3], [4], [5], [6], [8], [3, 4], [6, 7], [2, 8]]) {
    const removedBefore = (t) => list.reduce((s, si) => s + (secStart(si) < t - 1e-6 ? secEnd(si) - secStart(si) : 0), 0);
    report(`remove sections ${list.map((s) => s + 1).join('+')}`, cutMid(list), (j) => (list.includes(evs[j].section) ? null : ref[j] - removedBefore(ref[j])), list);
  }
}
console.log('ROWS ' + JSON.stringify(rows));
