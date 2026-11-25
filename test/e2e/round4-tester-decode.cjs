// Round 4 tester: tone onsets of t4.wav / t4.mp3 as Chromium decodes them (is the mp3 encoder delay removed?)
// Run after round4-tester-make.mjs: node test/e2e/round4-tester-decode.cjs
// decode the tester's wav/mp3 in Chromium (decodeAudioData) and find tone onsets
const { chromium } = require('playwright');
const fs = require('fs');
const EXP = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '..', '..', 'test-artifacts', 'round-4', 'tester', 't4-expected.json')));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<input type=file id=f>');
  for (const f of ['t4.wav', 't4.mp3']) {
    await p.setInputFiles('#f', require('path').resolve(__dirname, '..', '..', 'test-artifacts', 'round-4', 'tester', f));
    const on = await p.evaluate(async () => {
      const buf = await document.querySelector('#f').files[0].arrayBuffer();
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const ab = await ctx.decodeAudioData(buf);
      const x = ab.getChannelData(0); const r = ab.sampleRate; const out = []; let q = r;
      for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) > 0.05) { if (q >= 0.015 * r) out.push(i / r); q = 0; } else q++; }
      return { out, dur: ab.duration };
    });
    const exp = EXP.events.filter((e) => !e.rest).map((e) => e.startSec);
    const d = on.out.map((t, i) => (t - exp[i]) * 1000);
    console.log(f, 'dur', on.dur.toFixed(3), 'onsets', on.out.length, 'err ms', Math.min(...d).toFixed(1), Math.max(...d).toFixed(1));
  }
  await b.close();
})();
