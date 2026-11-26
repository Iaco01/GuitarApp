// Round 9 tester, A: the real song must never be refused. Decodes ffmpeg-made variants of the local mp3 (in
// test-artifacts/round-9/variants, never committed) and runs the analysis.  Prints counts, colours, timings only.
//   node test/e2e/round9-tester-variants.mjs [name ...]
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSongFromMht } from '../../src/parser.js';
import { analyseAndAlign, songEvents } from '../../src/analysis/autosync.js';
import { makeAlignment, sectionState, alignmentRecognised, sectionEventIndices } from '../../src/alignment.js';
const ROOT = '/home/user/guitarapp/';
const L = ROOT + 'test/fixtures/local/';
const V = ROOT + 'test-artifacts/round-9/variants/';
if (!existsSync(L + 'american-pie.mp3')) { console.log('file reali assenti'); process.exit(0); }
const song = parseSongFromMht(readFileSync(L + 'american-pie.mht', 'utf-8'));
const evs = songEvents(song);
function decode(path) {
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)));
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }
function pinkNoise(n, seed) {
  const R = rng(seed); const o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) { const w = R() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; o[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
  return o;
}
function withNoise(x, snr, seed) { const nz = pinkNoise(x.length, seed); const k = rms(x) / 10 ** (snr / 20) / rms(nz); const o = new Float32Array(x.length); for (let i = 0; i < o.length; i++) o[i] = x[i] + nz[i] * k; return o; }
const cases = [
  ['original', () => decode(L + 'american-pie.mp3')],
  ['64 kbps', () => decode(V + 'v64k.mp3')], ['320 kbps', () => decode(V + 'v320k.mp3')], ['mono 22 kHz 64k', () => decode(V + 'vmono22.mp3')],
  ['-12 dB', () => decode(V + 'vvol.mp3')], ['first 10 s cut', () => decode(V + 'vcut10.mp3')], ['5 s silence in front', () => decode(V + 'vsil5.mp3')],
  ['phone EQ 300-3400', () => decode(V + 'vphone.mp3')], ['reverb aecho', () => decode(V + 'vreverb.mp3')],
  ['pink noise 10 dB', () => withNoise(decode(L + 'american-pie.mp3'), 10, 11)], ['pink noise 0 dB', () => withNoise(decode(L + 'american-pie.mp3'), 0, 12)],
  ['tempo x1.03', () => decode(V + 'vtempo.mp3')], ['pitch +1 semitone', () => decode(V + 'vpitch.mp3')],
  ['pink noise -5 dB', () => withNoise(decode(L + 'american-pie.mp3'), -5, 13)], ['pink noise -10 dB', () => withNoise(decode(L + 'american-pie.mp3'), -10, 14)],
  ['phone + noise 10 dB', () => withNoise(decode(V + 'vphone.mp3'), 10, 15)], ['phone EQ 500-2500', () => decode(V + 'vphone2.mp3')], ['32k mono 16kHz', () => decode(V + 'v32k.mp3')],
  ['phone + noise 0 dB', () => withNoise(decode(V + 'vphone.mp3'), 0, 16)], ['phone + noise -5 dB', () => withNoise(decode(V + 'vphone.mp3'), -5, 17)],
  ['pitch + noise 0 dB', () => withNoise(decode(V + 'vpitch.mp3'), 0, 18)], ['reverb + noise 0 dB', () => withNoise(decode(V + 'vreverb.mp3'), 0, 19)],
  ['pink noise -7 dB', () => withNoise(decode(L + 'american-pie.mp3'), -7, 20)], ['pink noise -12 dB', () => withNoise(decode(L + 'american-pie.mp3'), -12, 21)], ['pink noise -15 dB', () => withNoise(decode(L + 'american-pie.mp3'), -15, 22)],
  ['phone500 + noise 0 dB', () => withNoise(decode(V + 'vphone2.mp3'), 0, 31)], ['phone500 + noise -5 dB', () => withNoise(decode(V + 'vphone2.mp3'), -5, 32)], ['phone500 + noise 5 dB', () => withNoise(decode(V + 'vphone2.mp3'), 5, 33)],
  ['phone + reverb + noise 0 dB', () => withNoise(decode(V + 'vphonerev.mp3'), 0, 34)], ['phone + pitch + noise 0 dB', () => withNoise(decode(V + 'vphonepitch.mp3'), 0, 35)],
  ['m4a/AAC', () => decode(V + 'vaac.m4a')], ['ogg', () => decode(V + 'vogg.ogg')], ['wav', () => decode(V + 'vwav.wav')],
];
const want = process.argv.slice(2);
let ref = null;
const MAP = { 'first 10 s cut': (t) => t - 10, '5 s silence in front': (t) => t + 5, 'tempo x1.03': (t) => t / 1.03 };
for (const [name, mk] of cases) {
  if (want.length && !want.includes(name)) continue;
  const samples = mk();
  const t0 = Date.now();
  const res = analyseAndAlign({ samples, sampleRate: 44100, song });
  const ms = Date.now() - t0;
  const al = makeAlignment(res, song);
  const st = song.sections.map((_, si) => sectionState(al, si));
  const idx = sectionEventIndices(song);
  let n = 0, red = 0, skipped = 0, good = 0, yellow = 0;
  idx.forEach((l, si) => { if (!l.length) return; if (st[si] === 'skipped') { skipped++; return; } n++; if (st[si] === 'red') red++; if (st[si] === 'green' || st[si] === 'verified') good++; if (st[si] === 'yellow') yellow++; });
  const rec = alignmentRecognised(al, song);
  if (name === 'original') ref = res.eventStartSec.slice();
  let cmp = '';
  if (ref) {
    const f = MAP[name] || ((t) => t);
    const bySec = {};
    evs.forEach((e, j) => { const c = st[e.section][0]; const ok = Math.abs(res.eventStartSec[j] - f(ref[j])) <= 0.25; const k = c; bySec[k] = bySec[k] || [0, 0]; bySec[k][1]++; if (ok) bySec[k][0]++; });
    const bad = [];
    song.sections.forEach((_, si) => { if (st[si] !== 'green') return; const js = evs.map((e, j) => (e.section === si ? j : -1)).filter((j) => j >= 0); const w = js.filter((j) => Math.abs(res.eventStartSec[j] - f(ref[j])) > 0.25).length; if (w / js.length > 0.1) bad.push(`${si + 1}:${w}/${js.length}`); });
    cmp = ' WRONG-GREEN-SECTIONS[' + bad.join(',') + ']' + ' within250ms(vs original) ' + Object.entries(bySec).map(([k, v]) => `${k}:${v[0]}/${v[1]}`).join(' ');
  }
  console.log(`${name.padEnd(22)} rec=${rec ? 'SI' : 'NO'} match=${al.match} shiftUntrusted=${al.shiftUntrusted} transp=${res.transposeFound} g/y/r/skip=${good}/${yellow}/${red}/${skipped} redFrac=${(red / Math.max(1, n)).toFixed(2)} colours=${st.map((s) => s[0]).join('')} gaps=${res.gaps.length} skippedEvents=${res.skipped.filter(Boolean).length} t=${(ms / 1000).toFixed(1)}s first=${res.eventStartSec[0].toFixed(1)}${cmp}`);
}
