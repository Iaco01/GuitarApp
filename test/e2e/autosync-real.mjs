// Automatic sync on the real song (local only: copyrighted files outside git).
//   node test/e2e/autosync-real.mjs [path/to/song.mht] [path/to/song.mp3] [--truth test/fixtures/local/truth.json]
// --truth: the corrections exported by the app ("Esporta correzioni", verified sections: only times and chord
// names); prints the real error of the engine on those sections (within 100/250/500 ms, median).
// The mp3 is decoded with ffmpeg (tests only). Prints times, section names, chord names and
// counts, never the text of the song.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { independentChroma, independentCheck } from './autosync-check.mjs';

const DIR = '/home/user/guitarapp/test/fixtures/local/';
const argv = process.argv.slice(2);
const ti = argv.indexOf('--truth');
const TRUTH = ti >= 0 ? argv[ti + 1] : null;
const pos = argv.filter((a, i) => !(ti >= 0 && (i === ti || i === ti + 1)));
const MHT = pos[0] || DIR + 'american-pie.mht';
const MP3 = pos[1] || DIR + 'american-pie.mp3';
if (!existsSync(MHT) || !existsSync(MP3)) {
  console.log('file reali assenti: niente da fare');
  process.exit(0);
}

function decode(rate) {
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', MP3, '-f', 'f32le', '-ac', '1', '-ar', String(rate), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

const song = parseSongFromMht(readFileSync(MHT, 'utf-8'));
const events = songEvents(song);
const sr = 44100;
const samples = decode(sr);
console.log(`audio: ${(samples.length / sr).toFixed(1)} s; ${events.length} eventi, ${song.sections.length} sezioni`);

const res = analyseAndAlign({ samples, sampleRate: sr, song });
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
console.log(`calcolo: ${res.computeMs} ms  ${JSON.stringify(res.timings)}`);
console.log(`trasposizione: ${res.transposeFound} semitoni (margine ${res.transposeMargin.toFixed(1)}), sintonia ${res.tuningCents.toFixed(1)} cent`);
console.log('sezione        inizio   fine    BPM    cand   confBPM reg   confAllin.');
res.sections.forEach((s, i) => {
  console.log(`${String(i + 1).padStart(2)} ${song.sections[i].name.padEnd(10)} ${mmss(s.startSec)}  ${mmss(s.endSec)}  ${s.bpm === null ? ' --- ' : s.bpm.toFixed(1).padStart(5)}  ${s.tempoCandidate.toFixed(1).padStart(6)}  ${s.bpmConfidence.toFixed(2)}    ${s.regularity.toFixed(2)}  ${s.confidence.toFixed(2)}`);
});
let ordered = true;
for (let j = 1; j < events.length; j++) if (res.eventStartSec[j] < res.eventStartSec[j - 1]) ordered = false;
let overl = 0;
res.sections.forEach((s, i) => { if (i && s.startSec < res.sections[i - 1].endSec - 1e-6) overl++; });
console.log(`eventi in ordine: ${ordered}, sezioni sovrapposte: ${overl}`);
const bandBpms = res.sections.filter((s, i) => i >= 2 && s.bpm).map((s) => s.bpm);
console.log(`sezioni con BPM: ${res.sections.filter((s) => s.bpm).length}/${res.sections.length}; fuori da 130-150 (escluse le prime due): ${bandBpms.filter((b) => b < 130 || b > 150).length}`);
const cs = res.confidence.slice().sort((a, b) => a - b);
const q = (p) => cs[Math.floor(p * (cs.length - 1))].toFixed(2);
console.log(`confidenza eventi: min ${q(0)} p10 ${q(0.1)} mediana ${q(0.5)} p90 ${q(0.9)}; < 0.3: ${cs.filter((c) => c < 0.3).length}, 0.3-0.6: ${cs.filter((c) => c >= 0.3 && c < 0.6).length}, >= 0.6: ${cs.filter((c) => c >= 0.6).length}`);
const durs = res.eventEndSec.map((e, j) => e - res.eventStartSec[j]).sort((a, b) => a - b);
console.log(`durate eventi (s): min ${durs[0].toFixed(2)} p10 ${durs[Math.floor(durs.length * 0.1)].toFixed(2)} mediana ${durs[durs.length >> 1].toFixed(2)} p90 ${durs[Math.floor(durs.length * 0.9)].toFixed(2)} max ${durs[durs.length - 1].toFixed(2)}`);
console.log(`primo evento a ${mmss(res.eventStartSec[0])}, ultimo evento a ${mmss(res.eventStartSec[events.length - 1])}`);

// ---- independent local check (own chroma, see autosync-check.mjs)
const ic = independentChroma(decode(22050), res.tuningCents);
const c0 = independentCheck(ic, events, res.eventStartSec, res.eventEndSec, res.transposeFound, { nSections: song.sections.length });
const c1 = independentCheck(ic, events, res.eventStartSec, res.eventEndSec, res.transposeFound, { offset: 0.9 });
const c2 = independentCheck(ic, events, res.eventStartSec, res.eventEndSec, res.transposeFound, { offset: -0.9 });
console.log(`controllo indipendente locale (${c0.n} cambi): entrambi ${c0.both.toFixed(1)}%  uscente ${c0.out.toFixed(1)}%  entrante ${c0.in.toFixed(1)}%`);
console.log(`  riferimento con i cambi spostati di +-0,9 s: ${c1.both.toFixed(1)}% / ${c2.both.toFixed(1)}%`);
console.log('  per sezione: ' + c0.perSection.map((p, i) => `${i + 1}:${p === null ? '-' : p + '%'}`).join(' '));

// ---- closeness of the changes to the tracked beats (stable-tempo sections only; chance about 24%
// for whole beats and about 48% for the beat + half-beat grid, at +-0.12 beat)
let nt = 0, nb = 0, nh = 0;
res.sections.forEach((s, i) => {
  if (!s.beatTimes || !s.bpm) return;
  const p = 60 / s.bpm;
  events.forEach((e, j) => {
    if (e.section !== i || j === 0) return;
    const t = res.eventStartSec[j];
    let d = Infinity, dh = Infinity;
    for (const b of s.beatTimes) { d = Math.min(d, Math.abs(b - t)); dh = Math.min(dh, Math.abs(b - t), Math.abs(b + p / 2 - t)); }
    nt++;
    if (d <= 0.12 * p) nb++;
    if (dh <= 0.12 * p) nh++;
  });
});
console.log(`vicino ai battiti (${nt} cambi, +-0,12 battiti): battito ${(100 * nb / nt).toFixed(0)}%  battito o mezzo battito ${(100 * nh / nt).toFixed(0)}%`);

// ---- real error on the sections verified by ear (exported by the app)
if (TRUTH) {
  const t = JSON.parse(readFileSync(TRUTH, 'utf-8'));
  const bySection = song.sections.map(() => []);
  events.forEach((e, j) => bySection[e.section].push(j));
  const errs = [];
  const perSection = [];
  for (const sec of t.sections) {
    const idx = bySection[sec.index] || [];
    if (idx.length !== sec.eventStartSec.length) { console.log(`verità: sezione ${sec.index + 1} ignorata (${sec.eventStartSec.length} tempi per ${idx.length} eventi)`); continue; }
    if (sec.chords.some((n, k) => n !== events[idx[k]].name)) { console.log(`verità: sezione ${sec.index + 1} ignorata (accordi diversi dal foglio)`); continue; }
    const e = idx.map((j, k) => Math.abs(res.eventStartSec[j] - sec.eventStartSec[k]));
    errs.push(...e);
    const within = (th) => (100 * e.filter((v) => v <= th).length) / e.length;
    perSection.push(`${sec.index + 1} ${sec.name}: ${within(0.1).toFixed(0)}/${within(0.25).toFixed(0)}/${within(0.5).toFixed(0)}%`);
  }
  if (errs.length) {
    const sorted = errs.slice().sort((a, b) => a - b);
    const within = (th) => ((100 * errs.filter((v) => v <= th).length) / errs.length).toFixed(1);
    console.log(`verità (${errs.length} cambi in ${perSection.length} sezioni): entro 100 ms ${within(0.1)}%, 250 ms ${within(0.25)}%, 500 ms ${within(0.5)}%; errore mediano ${(sorted[sorted.length >> 1] * 1000).toFixed(0)} ms`);
    console.log('  per sezione (100/250/500 ms): ' + perSection.join('; '));
  } else console.log('verità: nessuna sezione utilizzabile');
}
