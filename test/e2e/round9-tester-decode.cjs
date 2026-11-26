// Round 9 tester, D1/D2: the MP3 decoded in pieces (src/ui/audiodecode.js, loaded as a module over a local http server)
// against the whole-file decode of the same bytes in the same browser. Files come from test-artifacts/round-9/dec (made
// by ffmpeg from synthetic audio, see the commands in the report).   node test/e2e/round9-tester-decode.cjs [file ...]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DEC = path.join(ROOT, 'test-artifacts', 'round-9', 'dec');
const extra = process.argv.slice(2).map((f) => path.resolve(f));
const files = extra.length ? extra : fs.readdirSync(DEC).filter((f) => /\.(mp3|ogg)$/.test(f)).map((f) => path.join(DEC, f));
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.mp3': 'audio/mpeg' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/blank.html') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><title>x</title>'); }
  const p = path.join(u.startsWith('/files/') ? '/' : ROOT, u.startsWith('/files/') ? u.slice(7) : u);
  fs.readFile(p, (e, d) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', MIME[path.extname(p)] || 'application/octet-stream'); res.end(d); });
});
(async () => {
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/blank.html`);
  for (const f of files) {
    const r = await page.evaluate(async ({ url, port }) => {
      const mod = await import(`http://localhost:${port}/src/ui/audiodecode.js`);
      const bytes = await (await fetch(url)).arrayBuffer();
      const out = { size: bytes.byteLength };
      let calls = 0; const orig = OfflineAudioContext.prototype.decodeAudioData; OfflineAudioContext.prototype.decodeAudioData = function (...x) { calls++; return orig.apply(this, x); };
      let t0 = performance.now();
      let a = null;
      try { a = await mod.decodeForAnalysis(new Blob([bytes])); } catch (e) { out.chunkErr = String(e && e.message || e); }
      out.chunkMs = Math.round(performance.now() - t0); out.calls = calls; OfflineAudioContext.prototype.decodeAudioData = orig;
      // whole decode, same rate, same bytes
      let w = null;
      try {
        const ctx = new OfflineAudioContext(1, 1, 11025);
        const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(bytes.slice(0), res, rej); if (p && p.then) p.then(res, rej); });
        const m = new Float32Array(buf.length); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < m.length; i++) m[i] += d[i] / buf.numberOfChannels; }
        w = { samples: m, n: buf.length };
      } catch (e) { out.wholeErr = String(e && e.message || e); }
      if (a) { out.chunkLen = a.samples.length; out.chunkDur = a.durationSec; }
      if (w) out.wholeLen = w.n;
      if (a && w) {
        const A = a.samples, W = w.samples;
        const n = Math.min(A.length, W.length);
        let max = 0, at = 0, sumsq = 0, ref = 0;
        for (let i = 0; i < n; i++) { const d = Math.abs(A[i] - W[i]); if (d > max) { max = d; at = i; } sumsq += d * d; ref += W[i] * W[i]; }
        out.maxDiff = max; out.maxAtSec = at / 11025; out.relRmsDiff = Math.sqrt(sumsq / (ref || 1));
        // lag by cross-correlation on 5 windows (1 s each) at several places: samples of lag (|lag|<=40)
        const lags = [];
        for (let k = 1; k <= 8; k++) {
          const c = Math.floor((n / 9) * k); const L = 11025;
          if (c + L + 50 > n || c < 60) continue;
          let best = 0, bl = 0;
          for (let lag = -40; lag <= 40; lag++) { let s = 0; for (let i = 0; i < L; i += 2) s += A[c + i + lag] * W[c + i]; if (s > best) { best = s; bl = lag; } }
          lags.push(bl);
        }
        out.lags = lags;
        // per-boundary lag (window of 0.5 s just after each 45 s piece boundary) and the diff after removing the local lag
        const perPiece0 = Math.max(50, Math.round((45 * 44100) / 1152));
        const bl = []; let sq = 0, rf = 0;
        for (let b = 0; b * perPiece0 * 1152 / 44100 * 11025 + 20000 < n; b++) {
          const c0 = Math.round(b * perPiece0 * 1152 / 44100 * 11025) + 200; const L = 5500;
          let best = -Infinity, lg = 0;
          for (let lag = -40; lag <= 40; lag++) { let q = 0; for (let i = 0; i < L; i++) q += A[c0 + i + lag] * W[c0 + i]; if (q > best) { best = q; lg = lag; } }
          bl.push(lg);
          for (let i = 0; i < L; i++) { const d = A[c0 + i + lg] - W[c0 + i]; sq += d * d; rf += W[c0 + i] * W[c0 + i]; }
        }
        // same measure in windows in the middle of the pieces (no boundary)
        let sq2 = 0, rf2 = 0;
        for (let b = 0; (b + 0.5) * perPiece0 * 1152 / 44100 * 11025 + 20000 < n; b++) {
          const c0 = Math.round((b + 0.5) * perPiece0 * 1152 / 44100 * 11025); const L = 5500;
          let best = -Infinity, lg = 0;
          for (let lag = -40; lag <= 40; lag++) { let q = 0; for (let i = 0; i < L; i++) q += A[c0 + i + lag] * W[c0 + i]; if (q > best) { best = q; lg = lag; } }
          for (let i = 0; i < L; i++) { const d = A[c0 + i + lg] - W[c0 + i]; sq2 += d * d; rf2 += W[c0 + i] * W[c0 + i]; }
        }
        out.relRmsMid = Math.sqrt(sq2 / (rf2 || 1));
        out.boundaryLags = bl; out.relRmsAligned = Math.sqrt(sq / (rf || 1));
        // clicks: biggest sample-to-sample jump in A vs in W (in the 1000 samples around every 45 s boundary)
        const jumpsA = [], jumpsW = [];
        const perPiece = Math.max(50, Math.round((45 * 44100) / 1152));
        for (let b = 1; b < 30; b++) {
          const idx = Math.round(b * perPiece * 1152 / 44100 * 11025);
          if (idx + 600 > n) break;
          let ja = 0, jw = 0;
          for (let i = idx - 600; i < idx + 600; i++) { ja = Math.max(ja, Math.abs(A[i + 1] - A[i])); jw = Math.max(jw, Math.abs(W[i + 1] - W[i])); }
          jumpsA.push(+ja.toFixed(4)); jumpsW.push(+jw.toFixed(4));
        }
        out.jumpsChunk = jumpsA; out.jumpsWhole = jumpsW;
      }
      return out;
    }, { url: `http://localhost:${port}/files/${f}`, port });
    const name = path.basename(f);
    const durDiff = r.chunkLen && r.wholeLen ? ((r.chunkLen - r.wholeLen) / 11025 * 1000).toFixed(1) : 'n/a';
    console.log(`${name.padEnd(16)} size ${(r.size / 1e6).toFixed(2)}MB chunk ${r.chunkErr ? 'ERR ' + r.chunkErr : r.chunkLen + ' smp / ' + r.chunkMs + ' ms'} decodeAudioData calls ${r.calls} whole ${r.wholeErr ? 'ERR ' + r.wholeErr : r.wholeLen + ' smp'} lenDiff ${durDiff} ms` +
      (r.maxDiff !== undefined ? ` maxDiff ${r.maxDiff.toFixed(4)} (at ${r.maxAtSec.toFixed(1)} s) relRMS ${r.relRmsDiff.toFixed(4)} lags@11025 [${r.lags}] boundaryLags [${r.boundaryLags}] relRMS after lag fix: at boundaries ${r.relRmsAligned.toFixed(4)} / mid-piece ${r.relRmsMid.toFixed(4)} boundary-jump chunk/whole max ${Math.max(0, ...r.jumpsChunk)}/${Math.max(0, ...r.jumpsWhole)}` : ''));
  }
  console.log(errors.length ? 'PAGE ERRORS ' + errors.join('|') : 'no page errors');
  await browser.close(); srv.close();
})().catch((e) => { console.log('FAILED', e); process.exit(2); });
