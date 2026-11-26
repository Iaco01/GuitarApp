// Round 12, item 1a: exact seeking. Builds a tiny harness page from src/audio.js (no app, no sync), plays an mp3 from a
// list of seek targets and measures, by cross-correlation of the captured output against the ffmpeg decode, how far the
// reported media position is from the audio actually played.  "plain" = the old way (el.currentTime = T on the whole
// file), "exact" = createAudioPlayer (blob that starts at an exact frame).
// Usage: node test/e2e/round12-seek.cjs [file.mp3] [out-dir]   (needs ffmpeg and python3+numpy; prints times only)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const MP3 = process.argv[2] || path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = process.argv[3] || path.join(ROOT, 'test-artifacts', 'round-12', 'seek');
const TARGETS = (process.env.TARGETS || '30,63,150,300,450').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

async function buildHarness() {
  const { buildProject } = await import(path.join(ROOT, 'scripts', 'build.mjs'));
  const tmp = path.join(OUT, 'harness');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    const st = fs.statSync(path.join(ROOT, 'src', f));
    if (st.isFile()) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(tmp, 'src', f));
  }
  fs.writeFileSync(path.join(tmp, 'src', 'main.js'), "import { createAudioPlayer } from './audio.js';\nwindow.__mk = (blob) => createAudioPlayer({ timeline: { beats: [], events: [], sections: [] }, blob });\n");
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="src/styles.css"></head><body><script src="src/main.js"></script></body></html>');
  const r = buildProject({ root: tmp, outFile: path.join(tmp, 'out.html') });
  return r.outFile;
}

(async () => {
  if (!fs.existsSync(MP3)) { console.log('mp3 absent: skip'); return; }
  const html = await buildHarness();
  const ref = path.join(OUT, 'ref.f32');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', MP3, '-map', '0:a', '-ac', '1', '-ar', '44100', '-f', 'f32le', ref]);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + html);
  await page.setContent(fs.readFileSync(html, 'utf8'));
  await page.waitForFunction(() => typeof window.__mk === 'function');
  const b64 = fs.readFileSync(MP3).toString('base64');
  const caps = await page.evaluate(async ({ b64, targets }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const ctx = new AudioContext({ sampleRate: 44100 });
    const results = { sampleRate: ctx.sampleRate, runs: [] };
    const record = async (el, posFn, secs) => {
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      proc.onaudioprocess = (e) => { chunks.push({ pos: posFn(), ct: ctx.currentTime, data: Array.from(e.inputBuffer.getChannelData(0)) }); };
      return { proc, chunks };
    };
    for (const mode of ['plain', 'exact']) {
      let el, player = null, posFn;
      if (mode === 'plain') { el = new Audio(); el.src = URL.createObjectURL(blob); posFn = () => el.currentTime; }
      else { player = window.__mk(blob); await player.ready(); el = player.element; posFn = () => player.mediaTime(); }
      const src = ctx.createMediaElementSource(el);
      const dur0 = performance.now();
      for (const T of [0, ...targets]) {
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        const chunks = [];
        proc.onaudioprocess = (e) => { chunks.push({ pos: posFn(), ct: ctx.currentTime, data: Array.from(e.inputBuffer.getChannelData(0)) }); };
        src.connect(proc); proc.connect(ctx.destination);
        const t0 = performance.now();
        if (mode === 'plain') { el.currentTime = T; await el.play(); }
        else { await player.playFromTime(T); }
        // wait until audio flows from the new position, then collect 3 s
        await new Promise((r) => setTimeout(r, 4200));
        const gap = chunks.length ? 0 : -1;
        if (mode === 'plain') el.pause(); else player.pause();
        src.disconnect(proc); proc.disconnect();
        results.runs.push({ mode, T, startPos: chunks.length ? chunks[0].pos : null, chunks: chunks.map((c) => ({ pos: c.pos, ct: c.ct, d: c.data })), ms: Math.round(performance.now() - t0) });
      }
    }
    return results;
  }, { b64, targets: TARGETS });
  // write raw captures for the analysis
  const meta = [];
  caps.runs.forEach((r, i) => {
    const flat = new Float32Array(r.chunks.reduce((n, c) => n + c.d.length, 0));
    let o = 0; for (const c of r.chunks) { flat.set(c.d, o); o += c.d.length; }
    fs.writeFileSync(path.join(OUT, `cap-${i}.f32`), Buffer.from(flat.buffer));
    meta.push({ i, mode: r.mode, T: r.T, pos: r.chunks.map((c) => c.pos), ct: r.chunks.map((c) => c.ct), n: r.chunks.length });
  });
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ sampleRate: caps.sampleRate, runs: meta, errors }));
  await browser.close();
  console.log('captured', meta.length, 'runs; errors', errors.length);
  const py = path.join(__dirname, 'round12-seek-analyse.py');
  console.log(execFileSync('python3', ['-I', py, OUT], { encoding: 'utf8' }));
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
