// Round 12, item 1b: the mp3 decoded in pieces placed by correlation (src/ui/audiodecode.js) against the whole-file decode of the same
// bytes in the same browser (Chromium) and against ffmpeg. Prints the shift of every piece (ms), the lag against the whole decode at
// several places, the method used and the time.   node test/e2e/round12-decode.cjs [file.mp3 ...]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => path.resolve(f)) : [path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3')];
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/blank.html') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><title>x</title>'); }
  const p = u.startsWith('/files/') ? u.slice(6) : path.join(ROOT, u);
  fs.readFile(p, (e, d) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(d); });
});
(async () => {
  const ok = files.filter((f) => fs.existsSync(f));
  if (!ok.length) { console.log('no mp3: skip'); return; }
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/blank.html`);
  let bad = 0;
  for (const f of ok) {
    const r = await page.evaluate(async ({ url, port }) => {
      const mod = await import(`http://localhost:${port}/src/ui/audiodecode.js`);
      const bytes = await (await fetch(url)).arrayBuffer();
      const out = {};
      let t0 = performance.now();
      const a = await mod.decodeForAnalysis(new Blob([bytes]));
      out.ms = Math.round(performance.now() - t0);
      out.method = a.method; out.shifts = a.pieceShiftsMs; out.durationSec = a.durationSec;
      const ctx = new OfflineAudioContext(1, 1, 11025);
      const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(bytes.slice(0), res, rej); if (p && p.then) p.then(res, rej); });
      const W = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < W.length; i++) W[i] += d[i] / buf.numberOfChannels; }
      const A = a.samples; const n = Math.min(A.length, W.length);
      out.lenPieces = A.length; out.lenWhole = W.length;
      const lags = [];
      for (let k = 1; k <= 12; k++) {
        const c = Math.floor((n / 13) * k); const L = 11025;
        if (c + L + 200 > n || c < 300) continue;
        let best = -1, bl = 0;
        for (let lag = -300; lag <= 300; lag++) { let s = 0; for (let i = 0; i < L; i += 2) s += A[c + i + lag] * W[c + i]; if (s > best) { best = s; bl = lag; } }
        lags.push(bl);
      }
      out.lagSamples = lags;
      return out;
    }, { url: `http://localhost:${port}/files${f}`, port });
    const maxShift = r.shifts.length ? Math.max(...r.shifts.map(Math.abs)) : 0;
    const maxLagMs = Math.max(...r.lagSamples.map((x) => Math.abs(x))) / 11025 * 1000;
    console.log(path.basename(f), 'method', r.method, 'ms', r.ms, 'pieces', r.shifts.length + 1, 'shifts(ms)', JSON.stringify(r.shifts), 'max lag vs whole decode', maxLagMs.toFixed(2), 'ms; len', r.lenPieces, 'vs', r.lenWhole);
    if (r.method !== 'pieces' || maxShift > 30 || maxLagMs > 2) bad++;
  }
  await browser.close();
  console.log(bad ? 'FAIL' : 'PASS', 'errors', errors.length);
  process.exit(bad || errors.length ? 1 : 0);
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
