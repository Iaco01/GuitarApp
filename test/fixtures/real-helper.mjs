// Helper of the tests on the real, copyrighted recording and sheet (test/fixtures/local, gitignored): loads them, decodes the
// mp3 with ffmpeg and checks a result against the expected event times. Counts, times and section numbers only.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState } from '../../src/alignment.js';

const L = new URL('./local/', import.meta.url).pathname;
export const haveReal = existsSync(L + 'american-pie.mp3') && existsSync(L + 'american-pie.mht') && existsSync('/usr/bin/ffmpeg');
export const realSkip = haveReal ? false : 'no local fixture (test/fixtures/local) or no ffmpeg';

let cache = null;
export function loadReal() {
  if (cache) return cache;
  const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', L + 'american-pie.mp3', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  const X = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
  const evs = songEvents(song);
  const SR = 44100;
  const run = (samples) => { const res = analyseAndAlign({ samples, sampleRate: SR, song }); const al = makeAlignment(res, song); return { res, al, st: song.sections.map((_, si) => sectionState(al, si)) }; };
  const whole = run(X);
  const secStart = (si) => whole.res.eventStartSec[evs.findIndex((e) => e.section === si)];
  const secEnd = (si) => (si + 1 < song.sections.length ? secStart(si + 1) : X.length / SR);
  cache = { song, X, SR, evs, run, whole, secStart, secEnd, durationSec: X.length / SR };
  return cache;
}

// The audio without the sections in `list` (indices). Returns { samples, expected(j) } where expected(j) is where event j
// should start in the new audio (null for the events of the removed sections).
export function withoutSections(real, list) {
  const { X, SR, song, evs, secStart, secEnd, whole } = real;
  const parts = [];
  for (let si = 0; si < song.sections.length; si++) {
    if (list.includes(si)) continue;
    parts.push(X.subarray(Math.floor((si === 0 ? 0 : secStart(si)) * SR), Math.floor(secEnd(si) * SR)));
  }
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  const removedBefore = (t) => list.reduce((s, si) => s + (secStart(si) < t - 1e-6 ? secEnd(si) - secStart(si) : 0), 0);
  const expected = (j) => (list.includes(evs[j].section) ? null : whole.res.eventStartSec[j] - removedBefore(whole.res.eventStartSec[j]));
  return { samples: out, expected };
}

// Sections with the same chord sequence are interchangeable for the engine (the audio of a verse is the audio of any other
// verse as far as the chords go).
export function sisterSections(real, si) {
  const key = (k) => real.evs.filter((e) => e.section === k).map((e) => e.name).join('|');
  return real.song.sections.map((_, k) => k).filter((k) => key(k) === key(si));
}

// Green sections whose events are off by > 250 ms for more than 10% of them, with respect to expected(j) (where the event
// should be) or to the place of an equivalent section. Returns strings "section:bad/n".
export function wrongGreens(real, res, st, expected) {
  const idxOf = (si) => real.evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0);
  const badShare = (si, other) => {
    const a = idxOf(si);
    const b = idxOf(other);
    if (a.length !== b.length) return null;
    let n = 0;
    let bad = 0;
    a.forEach((j, q) => { const ex = expected(b[q]); if (ex === null) return; n++; if (Math.abs(res.eventStartSec[j] - ex) > 0.25) bad++; });
    return n ? { n, bad } : null;
  };
  const out = [];
  st.forEach((s, si) => {
    if (s !== 'green') return;
    const own = badShare(si, si);
    if (!own || own.bad / own.n <= 0.1) return;
    const alt = sisterSections(real, si).map((k) => badShare(si, k)).filter(Boolean);
    if (!alt.some((x) => x.bad / x.n <= 0.1)) out.push(`${si + 1}:${own.bad}/${own.n}`);
  });
  return out;
}
