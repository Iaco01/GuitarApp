// Round 9: the real song (local only, copyrighted): colours, skipped sections, gaps, free-tempo sections, with counts, times
// and section/chord names only.   node test/e2e/round9-real.mjs
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised, effectiveEventTimes } from '../../src/alignment.js';
const DIR = '/home/user/guitarapp/test/fixtures/local/';
if (!existsSync(DIR + 'american-pie.mp3')) { console.log('file reali assenti'); process.exit(0); }
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const song = parseSongFromMht(readFileSync(DIR + 'american-pie.mht', 'utf-8'));
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', DIR + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
const samples = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
const evs = songEvents(song);
const res = analyseAndAlign({ samples, sampleRate: 44100, song });
const al = makeAlignment(res, song);
const st = song.sections.map((_, si) => sectionState(al, si));
const cnt = {}; st.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; });
console.log(`audio ${(samples.length / 44100).toFixed(1)} s, ${evs.length} events, ${song.sections.length} sections, compute ${res.computeMs} ms, recognised ${alignmentRecognised(al, song)}, match ${al.match}`);
console.log('states: ' + JSON.stringify(cnt) + '  colours: ' + st.map((s) => s[0]).join(''));
console.log('free-tempo sections (no stable beat): ' + res.sections.filter((s) => s.bpm === null && !s.skipped).length + ' of ' + song.sections.length + '; skipped events ' + res.skipped.filter(Boolean).length);
console.log('gaps (>= 3 s): ' + res.gaps.length);
res.gaps.forEach((g) => console.log(`  ${mmss(g.startSec)}-${mmss(g.endSec)} (${(g.endSec - g.startSec).toFixed(1)} s) before event ${g.before}, section ${evs[g.before].section + 1} "${song.sections[evs[g.before].section].name}"`));
const eff = effectiveEventTimes(song, al);
const durs = eff.ends.map((e, j) => e - eff.starts[j]);
console.log(`event durations: min ${Math.min(...durs).toFixed(2)} s, max ${Math.max(...durs).toFixed(1)} s, shorter than 0.5 s: ${durs.filter((d) => d < 0.5).length}, longer than 8 s: ${durs.filter((d) => d > 8).length}`);
console.log('sectionconf: ' + res.sections.map((s, i) => i + 1 + ':' + s.confidence.toFixed(2)).join(' ')); console.log('sections: ' + song.sections.map((s, i) => `${i + 1}${st[i][0]}:${res.sections[i].bpm === null ? 'free' : res.sections[i].bpm}`).join(' '));
console.log('first event ' + mmss(res.eventStartSec[0]) + ' (conf ' + res.confidence[0].toFixed(2) + '), last start ' + mmss(res.eventStartSec[evs.length - 1]));
