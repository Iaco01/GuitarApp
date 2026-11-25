// Round 8 tester A2: false-positive gaps. Plain synthetic tracks (several seeds and damage variants) and the real mp3 (local only).
// Prints counts, positions and section names only.   node test/e2e/round8-tester-fp.mjs
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { parseSongFromMht } from '../../src/parser.js';
import { makeTrack, addWhite } from './round8-tester-make.mjs';
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
let n = 0, fp = 0;
for (const seed of [1, 2, 4, 6, 9, 13, 21, 34]) {
  const variants = [['plain', {}], ['nodrums', { drums: false }], ['novoice', { voice: false }], ['noise', null], ['drop2', { dropEvents: new Set([10, 33]) }]];
  for (const [nm, o] of variants) {
    const t = o === null ? (() => { const b = makeTrack({ seed }); return { ...b, samples: addWhite(b.samples, 0.15, seed) }; })() : makeTrack({ seed, ...o });
    const res = analyseAndAlign({ samples: t.samples, sampleRate: t.sampleRate, song: t.song });
    n++;
    const g = res ? res.gaps.filter((x) => x.endSec - x.startSec >= 3) : [];
    if (g.length) { fp++; console.log(`FALSE GAP seed ${seed} ${nm}: ${g.map((x) => `${x.startSec.toFixed(1)}-${x.endSec.toFixed(1)}`).join(' ')}`); }
  }
}
console.log(`synthetic: ${fp} tracks with a gap >= 3 s out of ${n} (no extra music present)`);
const DIR = '/home/user/guitarapp/test/fixtures/local/';
if (existsSync(DIR + 'american-pie.mp3')) {
  const song = parseSongFromMht(readFileSync(DIR + 'american-pie.mht', 'utf-8'));
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', DIR + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  const b = r.stdout; const samples = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
  const t0 = Date.now();
  const res = analyseAndAlign({ samples, sampleRate: 44100, song: song });
  const evs = songEvents(song);
  console.log(`real: ${(samples.length / 44100).toFixed(1)} s audio, ${evs.length} events, ${res.computeMs} ms, total gaps (>=1 s) ${res.gaps.length}`);
  res.gaps.forEach((g) => console.log(`  gap ${mmss(g.startSec)}-${mmss(g.endSec)} (${(g.endSec - g.startSec).toFixed(1)} s) before event ${g.before}, section ${evs[g.before].section + 1} "${song.sections[evs[g.before].section].name}", after "${song.sections[evs[g.before - 1].section].name}"`));
  console.log('  first event ' + mmss(res.eventStartSec[0]) + ', last event ' + mmss(res.eventStartSec[evs.length - 1]) + ', last end ' + mmss(res.eventEndSec[evs.length - 1]));
  console.log('  sections: ' + res.sections.map((s, i) => `${i + 1}:${mmss(s.startSec)}-${mmss(s.endSec)}`).join(' '));
  // event durations > 15 s?
  const longEv = res.eventEndSec.map((e, j) => [e - res.eventStartSec[j], j]).filter(([d]) => d > 12);
  console.log(`  events longer than 12 s: ${longEv.length} ${longEv.map(([d, j]) => d.toFixed(0) + 's@' + j).join(' ')}`);
}
