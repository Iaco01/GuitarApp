// Round 12 tester, B: the first G of Chorus 1 (event 35, ~63.4 s, must last < 1.5 s) and the boundary between two identical chords.
// Own decode variants (not the implementer's list: other sample rates, the fixed-point mp3 decoder, one channel, re-encodes at other
// bit rates / codecs, a decoder that does not drop the start delay, a phone-like band, compression, level) run through the engine of
// the working tree (or of another tree: R12_SRC=/path/to/src for the round 11 engine in a worktree).  Then own synthetic songs with a
// chord held ~5 s that dies out and the same chord re-attacking (round7-tester-make.mjs generator, own sheet).
// Prints only times, durations and counts (no text of the song).
// Run: node test/e2e/round12-tester-event35.mjs [real|synth|pairs|all]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = process.env.R12_SRC || join(ROOT, 'src');
const MP3 = join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const MHT = join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const OUT = join(ROOT, 'test-artifacts', 'round-12', 'tester');
mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] || 'all';
const imp = (f) => import(pathToFileURL(join(SRC, f)).href);
const { analyseAndAlign, songEvents } = await imp('analysis/autosync.js');
const { parseSongFromMht } = await imp('parser.js');

const ffmpeg = (inArgs, outArgs, ar, input = MP3) => {
  const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', ...inArgs, '-i', input, ...outArgs, '-f', 'f32le', '-ac', '1', '-ar', String(ar), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 4)));
};
const reenc = (name, codecArgs, ext) => {
  const f = join(OUT, `reenc-${name}.${ext}`);
  if (!existsSync(f)) { const r = spawnSync('/usr/bin/ffmpeg', ['-y', '-v', 'error', '-i', MP3, '-map', '0:a', ...codecArgs, f]); if (r.status !== 0) throw new Error(String(r.stderr)); }
  return f;
};

if (mode === 'real' || mode === 'all') {
  const song = parseSongFromMht(readFileSync(MHT, 'utf-8'));
  const evs = songEvents(song);
  const V = {
    'base 22050': () => [ffmpeg([], [], 22050), 22050],
    '16000': () => [ffmpeg([], [], 16000), 16000],
    '8000': () => [ffmpeg([], [], 8000), 8000],
    '32000': () => [ffmpeg([], [], 32000), 32000],
    '48000': () => [ffmpeg([], [], 48000), 48000],
    'soxr precision 28 @22050': () => [ffmpeg([], ['-af', 'aresample=resampler=soxr:precision=28'], 22050), 22050],
    'fixed-point mp3 decoder @22050': () => [ffmpeg(['-c:a', 'mp3'], [], 22050), 22050],
    'right channel only @22050': () => [ffmpeg([], ['-af', 'pan=mono|c0=c1'], 22050), 22050],
    'side-weighted mix (0.7 L + 0.3 R) @22050': () => [ffmpeg([], ['-af', 'pan=mono|c0=0.7*c0+0.3*c1'], 22050), 22050],
    're-encode CBR 96k stereo': () => [ffmpeg([], [], 22050, reenc('cbr96', ['-c:a', 'libmp3lame', '-b:a', '96k'], 'mp3')), 22050],
    're-encode mono 48k 22.05 kHz': () => [ffmpeg([], [], 22050, reenc('mono48', ['-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', '-ar', '22050'], 'mp3')), 22050],
    're-encode vorbis q2 (ogg)': () => [ffmpeg([], [], 22050, reenc('ogg', ['-c:a', 'libvorbis', '-q:a', '2'], 'ogg')), 22050],
    're-encode aac 96k (m4a)': () => [ffmpeg([], [], 22050, reenc('aac', ['-c:a', 'aac', '-b:a', '96k'], 'm4a')), 22050],
    'decoder keeps the start delay (+1152 samples = 26 ms)': () => [ffmpeg([], ['-af', 'adelay=26|26'], 22050), 22050],
    'decoder keeps frame + delay (+2257 samples = 51 ms)': () => [ffmpeg([], ['-af', 'adelay=51|51'], 22050), 22050],
    'decoder drops 2 more frames (-52 ms)': () => [ffmpeg([], ['-ss', '0.052'], 22050), 22050],
    'one second of silence in front': () => [ffmpeg([], ['-af', 'adelay=1000|1000'], 22050), 22050],
    'phone band (high-pass 150 Hz, low-pass 5 kHz)': () => [ffmpeg([], ['-af', 'highpass=f=150,lowpass=f=5000'], 22050), 22050],
    'strong compressor (pumping)': () => [ffmpeg([], ['-af', 'acompressor=threshold=0.02:ratio=12:attack=5:release=200:makeup=6'], 22050), 22050],
    'level -26 dB': () => [ffmpeg([], ['-af', 'volume=0.05'], 22050), 22050],
    'tempo x1.01 (clock 1% fast)': () => [ffmpeg([], ['-af', 'atempo=1.01'], 22050), 22050],
    'tempo x0.99 (clock 1% slow)': () => [ffmpeg([], ['-af', 'atempo=0.99'], 22050), 22050],
    'low-pass 1200 Hz': () => [ffmpeg([], ['-af', 'lowpass=f=1200'], 22050), 22050],
    'one frame (26 ms) missing at 30 s': () => { const x = ffmpeg([], [], 22050); const k = 30 * 22050, n = 573; const y = new Float32Array(x.length - n); y.set(x.subarray(0, k)); y.set(x.subarray(k + n), k); return [y, 22050]; },
    'one frame (26 ms) missing at 58 s': () => { const x = ffmpeg([], [], 22050); const k = 58 * 22050, n = 573; const y = new Float32Array(x.length - n); y.set(x.subarray(0, k)); y.set(x.subarray(k + n), k); return [y, 22050]; },
    '120 ms of silence inserted at 45 s': () => { const x = ffmpeg([], [], 22050); const k = 45 * 22050, n = 2646; const y = new Float32Array(x.length + n); y.set(x.subarray(0, k)); y.set(x.subarray(k), k + n); return [y, 22050]; },
    'level +12 dB clipped': () => [ffmpeg([], ['-af', 'volume=4,alimiter=limit=1'], 22050), 22050],
  };
  const only = process.env.R12_ONLY ? process.env.R12_ONLY.split('|') : null;
  console.log('variant | ev34 | ev35 | ev36 | dur35 | t35 in [63.0,63.6] and dur<1.5');
  const rows = [];
  for (const [name, f] of Object.entries(V)) {
    if (only && !only.includes(name)) continue;
    let samples, sampleRate;
    try { [samples, sampleRate] = f(); } catch (e) { console.log(name, 'decode failed', String(e).slice(0, 80)); continue; }
    const t0 = Date.now();
    const res = analyseAndAlign({ samples, sampleRate, song });
    const t = res.eventStartSec;
    // the engine's events are in the same order as songEvents(song) (name/section of event 35 are not printed)
    const lead = name.startsWith('one second') ? 1.0 : 0;
    const warp = /tempo x1.01/.test(name) ? 1.01 : /tempo x0.99/.test(name) ? 0.99 : 1; if (warp !== 1) { for (const k of [34, 35, 36]) t[k] *= warp; }
    const ok = t[35] - lead >= 63.0 && t[35] - lead <= 63.6 && t[36] - t[35] < 1.5;
    rows.push({ name, t34: t[34], t35: t[35], t36: t[36] });
    console.log(`${name} | ${(t[34] - lead).toFixed(2)} | ${(t[35] - lead).toFixed(3)} | ${(t[36] - lead).toFixed(3)} | ${(t[36] - t[35]).toFixed(2)} | ${ok ? 'OK' : 'FAIL'}  (${((Date.now() - t0) / 1000).toFixed(0)} s, ${evs.length} events)`);
  }
  writeFileSync(join(OUT, `event35-${process.env.R12_TAG || 'new'}.json`), JSON.stringify(rows));
}

if (mode === 'pairs' || mode === 'all') {
  // every consecutive pair of identical chords in the real sheet: where the engine puts the second one, against my own strongest attack
  const song = parseSongFromMht(readFileSync(MHT, 'utf-8'));
  const evs = songEvents(song);
  const x = ffmpeg([], [], 22050);
  const res = analyseAndAlign({ samples: x, sampleRate: 22050, song });
  const t = res.eventStartSec;
  const pairs = [];
  for (let j = 1; j < evs.length; j++) if (evs[j].name && evs[j].name === evs[j - 1].name && !evs[j].rest && !evs[j - 1].rest) pairs.push(j);
  writeFileSync(join(OUT, `pairs-${process.env.R12_TAG || 'new'}.json`), JSON.stringify({ pairs, t: pairs.map((j) => [j, t[j - 1], t[j], t[j + 1] || null, evs[j].section !== evs[j - 1].section ? 1 : 0]) }));
  console.log('identical consecutive pairs:', pairs.length, ' (details in pairs-*.json; analysed by round12-tester-pairs.py)');
}

if (mode === 'synth' || mode === 'all') {
  // own synthesis (not the round 7 generator, whose chords are strummed on every beat and so never "hold"): a chord marked held is strummed ONCE and
  // rings out (decay tau), optionally damped to silence after `mute` s; a normal chord is strummed on every beat.  The sheet gives 4 beats to every chord.
  const { SHEET, buildSong } = await import(pathToFileURL(join(import.meta.dirname, 'round7-tester-make.mjs')).href);
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pcsOf = (n) => { const m = /^([A-G])(m?)/.exec(n); const r = NOTE[m[1]]; return [r, (r + (m[2] ? 3 : 4)) % 12, (r + 7) % 12]; };
  const rngf = (seed) => { let q = seed >>> 0 || 1; return () => { q ^= q << 13; q >>>= 0; q ^= q >>> 17; q ^= q << 5; q >>>= 0; return q / 4294967296; }; };
  const render = ({ seed, tau, mute, noise, rate = 22050, bpm = 96 }) => {
    const R = rngf(seed); const spb = 60 / bpm;
    const verse = [['C', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['G', 4], ['Em', 4], ['G', 8, 'h']];
    const chorus = [['G', 4], ['C', 4], ['D', 4], ['Em', 4], ['G', 8, 'h'], ['G', 4], ['C', 4], ['D', 8, 'h']];
    const secs = [verse, chorus, verse, chorus, verse, chorus];
    SHEET.length = 0; for (const sc of secs) SHEET.push([sc === verse ? 'Verse' : 'Chorus', bpm, sc.map((c) => [c[0], c[1]])]);
    const events = []; let t = 1.0 + R();
    for (const sc of secs) for (const [name, q, h] of sc) { events.push({ name, t0: t, dur: q * spb, held: !!h }); t += q * spb; }
    const total = t + 3; const N = Math.ceil(total * rate); const x = new Float32Array(N);
    const addNote = (f, t0, amp, tauN, dur, muteAt) => {
      const i0 = Math.floor(t0 * rate); const n = Math.min(Math.floor(dur * rate), N - i0);
      for (let h = 1; h <= 7; h++) { const fh = f * h * (1 + 0.0004 * h * h); if (fh > rate / 2.2) break; const a = amp / h ** 1.15, th = tauN / (1 + 0.35 * (h - 1)), w = (2 * Math.PI * fh) / rate, ph = R() * 6.28;
        for (let i = 0; i < n; i++) { const tt = i / rate; let e = Math.exp(-tt / th) * Math.min(1, tt / 0.003); if (muteAt && tt > muteAt) e *= Math.max(0, 1 - (tt - muteAt) / 0.08); x[i0 + i] += a * e * Math.sin(w * i + ph); } }
    };
    for (const ev of events) {
      const [r, th, fi] = pcsOf(ev.name); const f = (pc, oct) => 440 * 2 ** ((pc + 12 * (oct - 4) - 9) / 12);
      const voicing = [[r, 2], [fi, 2], [r, 3], [th, 3], [fi, 3], [r, 4]];
      const strum = (t0, amp, nd, muteAt) => voicing.forEach(([pc, oct], k) => addNote(f(pc, oct), t0 + k * 0.012 + (R() - 0.5) * 0.004, amp * (0.8 + 0.3 * R()), tau, nd, muteAt));
      if (ev.held) strum(ev.t0, 0.16, Math.min(ev.dur + 0.5, 6), mute || 0);
      else for (let b = 0; b < Math.round(ev.dur / spb); b++) strum(ev.t0 + b * spb, b === 0 ? 0.16 : 0.1, 1.6, 0);
    }
    for (let i = 0; i < N; i++) x[i] += (R() * 2 - 1) * noise;
    let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(x[i])); for (let i = 0; i < N; i++) x[i] *= 0.9 / pk;
    return { samples: x, rate, events };
  };
  let bad = 0, total = 0, rb = 0, rt = 0; const lines = [];
  const CASES = (process.env.R12_ONECASE ? [[3, 1.1, 0, 0.004]] : [[3, 1.1, 0, 0.004], [11, 0.7, 0, 0.004], [29, 2.0, 0, 0.004], [41, 1.1, 3.0, 0.004], [53, 0.7, 2.5, 0.004], [67, 1.1, 0, 0.02], [79, 1.4, 3.5, 0.02]]);
  for (const [seed, tau, mute, noise] of CASES) {
    const tr = render({ seed, tau, mute, noise });
    const song = buildSong('t12', 'Prova dodici');
    for (const sec of song.sections) for (const l of sec.lines) for (const c of l.chords) c.beats = 4;
    song.timingSource = 'default'; for (const sec of song.sections) sec.bpmSource = 'default';
    const res = analyseAndAlign({ samples: tr.samples, sampleRate: tr.rate, song });
    const t = res.eventStartSec; const out = [];
    for (let k = 1; k < tr.events.length; k++) if (tr.events[k].name === tr.events[k - 1].name) {
      const err = t[k] - tr.events[k].t0; total++; if (Math.abs(err) > 0.25) bad++;
      if (process.env.R12_DEBUG && Math.abs(err) > 0.25) {
        const { computeFeatures } = await imp('analysis/features.js'); const { reattacks } = await imp('analysis/samechord.js');
        const feat = computeFeatures(tr.samples); const f = (a) => JSON.stringify(a.map((c) => ({ t: +c.t.toFixed(2), s: +c.strength.toFixed(1), rise: +c.rise.toFixed(2) })));
        const rms = (a, b) => { let e = 0; const i0 = Math.floor(a * tr.rate), i1 = Math.floor(b * tr.rate); for (let i = i0; i < i1; i++) e += tr.samples[i] ** 2; return Math.sqrt(e / (i1 - i0)); };
        console.log(`  debug rms before/after truth (-0.3..-0.05 / +0.05..+0.3 s): ${rms(tr.events[k].t0 - 0.3, tr.events[k].t0 - 0.05).toFixed(4)} / ${rms(tr.events[k].t0 + 0.05, tr.events[k].t0 + 0.3).toFixed(4)}; engine boundary rms after ${rms(t[k] + 0.05, t[k] + 0.3).toFixed(4)}`);
        console.log(`  debug pair ${k}: truth ${tr.events[k].t0.toFixed(2)} engine ${t[k].toFixed(2)}; attacks in the keep window (+-0.12 s of the engine boundary, strength>=3): ${f(reattacks(feat, t[k] - 0.12, t[k] + 0.12, 3))}; re-attacks with rise>=1.25 in the window: ${f(reattacks(feat, t[k - 1] + 0.5, t[k + 1] - 0.15).filter((c) => c.rise >= 1.25))}`);
      }
      out.push(`${tr.events[k].name}:${err >= 0 ? '+' : ''}${(err * 1000).toFixed(0)}ms`);
    }
    const all = tr.events.map((e, k) => Math.abs(t[k] - e.t0)).sort((a, b) => a - b);
    lines.push(`seed ${seed} tau ${tau}${mute ? ' damped at ' + mute + ' s' : ''} noise ${noise}: identical pairs ${out.join(' ')} | all ${tr.events.length} events: median ${(all[all.length >> 1] * 1000).toFixed(0)} ms, max ${(all[all.length - 1] * 1000).toFixed(0)} ms`);
  }
  console.log(lines.join('\n'));
  console.log(`identical-chord boundaries: ${total}, off by more than 250 ms: ${bad}`);
}
