// Round 3 tester, part A: round-2 fixes (wake lock, notice, replace picker, suspicious durations,
// scroll position, compact panel). Run: npm run build && node test/e2e/round3-tester-a.cjs [A1|A2|A3|A4|A5|A6]
// Needs the git-ignored real file. Screenshots go to test-artifacts/round-3/ (not committed).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-3');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const only = process.argv[2] || '';
const W360 = { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } };
const PATCH = () => {
  window.__wl = { req: 0, rel: 0, active: 0, delay: 0 };
  if (!location.search.includes('nowl')) {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => new Promise((res) => setTimeout(() => {
      window.__wl.req++; window.__wl.active++;
      const ls = [];
      res({ released: false, addEventListener: (n, f) => ls.push(f), release() { window.__wl.rel++; window.__wl.active--; ls.forEach((f) => f()); return Promise.resolve(); } });
    }, window.__wl.delay)) } });
  } else {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
  }
};
async function open(prof = W360, query = '', file = REAL) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(PATCH);
  await page.goto(URL + query);
  if (file) { await page.setInputFiles('#import-input', file); await page.waitForSelector('#song-title'); }
  return { browser, page, errors, ctx };
}
const setScale = async (page, scale) => {
  const get = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.screen.song')).getPropertyValue('--fs')));
  let cur = await get();
  while (Math.abs(cur - scale) > 0.01) { await page.click(cur < scale ? '#btn-font-up' : '#btn-font-down'); cur = await get(); }
};

(async () => {
  if (!only || only === 'A1') {
    const { browser, page, errors } = await open();
    await page.evaluate(() => { window.__wl.delay = 400; });
    await page.click('#btn-play'); await sleep(100); await page.click('#btn-play');
    await sleep(1200);
    let wl = await page.evaluate(() => window.__wl);
    rec('A1 pause before grant releases the lock', wl.active === 0, JSON.stringify(wl));
    // rapid play/pause x5
    for (let i = 0; i < 5; i++) { await page.click('#btn-play'); await sleep(60); await page.click('#btn-play'); await sleep(40); }
    await sleep(1500);
    wl = await page.evaluate(() => window.__wl);
    rec('A1 rapid play/pause x5 leaves no lock', wl.active === 0, JSON.stringify(wl));
    // normal play holds exactly one, stop releases
    await page.evaluate(() => { window.__wl.delay = 0; });
    await page.click('#btn-play'); await sleep(800);
    wl = await page.evaluate(() => window.__wl);
    rec('A1 playing holds one lock', wl.active === 1, JSON.stringify(wl));
    await page.click('#btn-more'); await page.click('#btn-stop'); await sleep(300);
    wl = await page.evaluate(() => window.__wl);
    rec('A1 stop releases', wl.active === 0, JSON.stringify(wl));
    // play then stop before grant
    await page.evaluate(() => { window.__wl.delay = 400; });
    await page.click('#btn-play'); await sleep(100); await page.click('#btn-stop'); await sleep(1000);
    wl = await page.evaluate(() => window.__wl);
    rec('A1 stop before grant releases', wl.active === 0, JSON.stringify(wl));
    rec('A1 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A2') {
    const { browser, page, errors } = await open(W360, '?nowl');
    await page.click('#btn-play'); await sleep(2000);
    const vis = async () => page.evaluate(() => { const n = document.querySelector('#pp-notice'); const p = document.querySelector('#playpanel'); if (!n) return null; const r = n.getBoundingClientRect(); return { hidden: n.hidden, inViewport: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, insidePanel: p.contains(n), text: n.textContent.length }; });
    let v = await vis();
    rec('A2 notice visible in panel at play start', v && !v.hidden && v.inViewport && v.insidePanel, JSON.stringify(v));
    await page.screenshot({ path: path.join(OUT, 't-a2-notice.png') });
    await sleep(30000);
    v = await vis();
    rec('A2 notice still visible after 30 s of scrolling', v && !v.hidden && v.inViewport, JSON.stringify(v));
    const h = await page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
    info('A2 panel height with notice', h + ' px');
    await page.click('#pp-notice button');
    v = await vis();
    rec('A2 notice closable', v.hidden === true);
    await page.click('#btn-play'); await sleep(200); await page.click('#btn-play'); await sleep(1500);
    v = await vis();
    info('A2 notice after pause+play when closed', JSON.stringify(v));
    const count = await page.evaluate(() => document.querySelectorAll('#pp-notice').length);
    rec('A2 single notice element', count === 1);
    rec('A2 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A3') {
    const { browser, page, errors } = await open(W360, '');
    const idx = () => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.index.v1')));
    const reimport = async () => { await page.click('#btn-back'); await page.waitForSelector('#import-input'); await page.setInputFiles('#import-input', REAL); await page.waitForSelector('.dlg'); };
    await reimport();
    await page.click('.dlg [data-value="both"]');
    await page.waitForSelector('#song-title');
    let ix = await idx();
    rec('A3 two copies after keep both', ix.length === 2, `${ix.length}`);
    await sleep(1100);
    await reimport();
    const labels1 = await page.locator('.dlg button').allTextContents();
    info('A3 dialog buttons with 2 copies', JSON.stringify(labels1));
    const msg = await page.textContent('.dlg');
    const replaceBtns = await page.locator('.dlg [data-value^="replace"]').count();
    rec('A3 two replace buttons listed (one per copy)', replaceBtns === 2, `${replaceBtns}`);
    await page.screenshot({ path: path.join(OUT, 't-a3-replace-two.png') });
    const vals = await page.locator('.dlg button').evaluateAll((b) => b.map((x) => x.dataset.value));
    // pick the OLDER copy (last button)
    const before = Object.fromEntries((await idx()).map((e) => [e.id, e.updatedAt]));
    const target = vals.filter((v) => v.startsWith('replace'))[1];
    info('A3 values', vals.join(','));
    await sleep(1100);
    await page.click(`.dlg [data-value="${target}"]`);
    await page.waitForSelector('#song-title');
    ix = await idx();
    const after = Object.fromEntries(ix.map((e) => [e.id, e.updatedAt]));
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    const labelsOrder = ix.length;
    rec('A3 still 2 copies, exactly one touched', ix.length === 2 && changed.length === 1, `changed ${changed.length}`);
    // which one: the dialog lists most recent first, so the second button is the older copy
    const ids = Object.keys(before).sort((a, b) => before[a] < before[b] ? 1 : -1);
    rec('A3 the older copy (second listed) was the one replaced', changed[0] === ids[1], `changed=${changed[0]} older=${ids[1]} newer=${ids[0]}`);
    // third copy then pick the first
    await reimport();
    await page.click('.dlg [data-value="both"]'); await page.waitForSelector('#song-title');
    await reimport();
    const n3 = await page.locator('.dlg [data-value^="replace"]').count();
    rec('A3 three copies -> three replace buttons', n3 === 3, `${n3}`);
    await page.click('.dlg [data-value="cancel"]');
    ix = await idx();
    rec('A3 cancel leaves 3 copies', ix.length === 3);
    rec('A3 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  if (!only || only === 'A4') {
    const { browser, page, errors } = await open(W360, '');
    await page.click('#btn-edit');
    const tl = await page.evaluate(() => ({ events: window.__gapp.timeline.events.map((e) => ({ s: e.startSec, sec: e.sectionIndex })), sections: window.__gapp.timeline.sections }));
    async function recordPlan(sec, plan, skipTapAt) {
      const first = tl.events.findIndex((e) => e.sec === sec);
      const bpm = tl.sections[sec].bpm;
      await page.locator(`.rec-sec[data-sec="${sec}"]`).scrollIntoViewIfNeeded();
      await page.locator(`.rec-sec[data-sec="${sec}"]`).click();
      await page.waitForSelector('#rec-tap');
      await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
      const spb = 60 / bpm;
      let pos = 0; const ends = plan.map((d) => (pos += d));
      const startSec = tl.events[first].s;
      await page.evaluate(async ({ targets, skip }) => {
        const wait = (t) => new Promise((res) => { const f = () => (window.__gapp.player.timeSec >= t ? res() : requestAnimationFrame(f)); f(); });
        const btn = document.getElementById('rec-tap');
        for (let k = 0; k < targets.length - 1; k++) { await wait(targets[k]); if (k !== skip) btn.click(); }
        await wait(targets[targets.length - 1]); document.getElementById('rec-end').click();
      }, { targets: ends.map((p) => startSec + p * spb), skip: skipTapAt });
      await page.waitForSelector('#rec-summary');
    }
    // all taps present (plan all 4): no warning expected
    await recordPlan(2, [4, 4, 4, 4, 4, 4, 4, 4], -1);
    const warnNone = await page.locator('.rec-warn').count();
    const sumNone = await page.locator('#rec-warn-sum').count();
    rec('A4 no taps skipped -> no warning', warnNone === 0 && sumNone === 0, `${warnNone}/${sumNone}`);
    await page.click('#rec-discard');
    // skipping one tap in the middle (tap 3 missed): durations 4,4,8 then shifted
    await recordPlan(2, [4, 4, 4, 4, 4, 4, 4, 4], 2);
    const rows = await page.locator('#rec-rows li').evaluateAll((l) => l.map((x) => ({ warn: x.classList.contains('warn'), txt: x.textContent })));
    const vals = await page.locator('#rec-rows li .rec-row-val').allTextContents();
    info('A4 values with skipped tap', vals.slice(0, 8).join(' | '));
    const flagged = rows.map((r, i) => (r.warn ? i : -1)).filter((i) => i >= 0);
    rec('A4 a skipped tap highlights the suspicious row', flagged.length >= 1 && flagged.includes(2), `flagged rows ${flagged.join(',')}`);
    rec('A4 summary warning present', (await page.locator('#rec-warn-sum').count()) === 1);
    await page.screenshot({ path: path.join(OUT, 't-a4-suspicious.png') });
    // do the highlighted rows look different (bg)?
    const bg = await page.locator('#rec-rows li.warn').first().evaluate((e) => getComputedStyle(e).backgroundColor + '|' + getComputedStyle(e).borderLeftColor);
    info('A4 warn style', bg);
    await page.click('#rec-discard');
    // skipped tap on a chord of 2 beats (2x median? ), double-length chord is legitimately long
    await recordPlan(4, [4, 4, 8, 4, 4, 4, 4, 4], -1);
    const w3 = await page.locator('#rec-rows li.warn').count();
    info('A4 genuine 8-beat chord among 4s (false positive?)', `${w3} rows flagged`);
    await page.click('#rec-discard');
    rec('A4 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }

  const sampleScroll = async (page, secs, step = 200) => {
    const out = [];
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) {
      out.push(await page.evaluate(() => {
        const p = document.querySelector('#playpanel').getBoundingClientRect();
        const cur = document.querySelector('.ch.cur');
        if (!cur) return null;
        const line = cur.closest('.line').getBoundingClientRect();
        return { top: line.top, bottom: line.bottom, panelTop: p.top, frac: line.top / p.top, idx: window.__gapp.player.eventIndex, state: window.__gapp.player.state };
      }));
      await sleep(step);
    }
    return out.filter(Boolean);
  };

  if (!only || only === 'A5') {
    for (const [name, prof] of [['w360', W360], ['iphone13', devices['iPhone 13']]]) {
      for (const scale of [1.0, 1.5]) {
        const { browser, page, errors } = await open(prof, '');
        await setScale(page, scale);
        await page.click('#btn-play');
        // begin at three places
        const refs = ['0.0.0', '2.2.0', '6.1.0'];
        for (const r of refs) {
          await page.evaluate((t) => document.querySelector(`.ch[data-ref="${t}"]`).click(), r);
          await sleep(4500);
          const s = (await sampleScroll(page, 20)).filter((x) => x.state === 'playing');
          const fr = s.map((x) => x.frac);
          const settled = s.slice(5); // skip the scroll animation after a jump
          const fs_ = settled.map((x) => x.frac);
          const sortedF = fs_.slice().sort((a, b) => a - b); const mn = sortedF[0], mx = sortedF[Math.floor(sortedF.length * 0.95)], mxAbs = sortedF[sortedF.length - 1];
          const inView = settled.every((x) => x.top >= 0 && x.bottom <= x.panelTop);
          const idxs = new Set(s.map((x) => x.idx)).size;
          rec(`A5 ${name} x${scale} from ${r}: line top at ~25% of height above the panel`, mn > 0.15 && mx < 0.35 && inView, `frac min ${mn.toFixed(3)} p95 ${mx.toFixed(3)} max(transient while the smooth scroll catches up) ${mxAbs.toFixed(3)} mean ${(fs_.reduce((a, b) => a + b, 0) / fs_.length).toFixed(3)}, fully in view ${inView}, ${s.length} samples, ${idxs} chords`);
        }
        // pause, play: re-applies
        await page.click('#btn-play'); await sleep(500); await page.click('#btn-play'); await sleep(5000);
        const s2 = (await sampleScroll(page, 6)).filter((x) => x.state === 'playing');
        const f2 = s2.map((x) => x.frac);
        rec(`A5 ${name} x${scale} after pause/play`, f2.length > 0 && Math.min(...f2) > 0.15 && Math.max(...f2) < 0.35, f2.length ? `${Math.min(...f2).toFixed(3)}..${Math.max(...f2).toFixed(3)}` : 'no samples');
        if (scale === 1.5) await page.screenshot({ path: path.join(OUT, `t-a5-${name}.png`) });
        rec(`A5 ${name} x${scale} console clean`, errors.length === 0, errors.join('|'));
        await browser.close();
      }
    }
  }

  if (!only || only === 'A6') {
    for (const [name, prof] of [['w360', W360], ['pixel7', devices['Pixel 7']], ['iphone13', devices['iPhone 13']], ['iphoneSE', devices['iPhone SE']]]) {
      const { browser, page } = await open(prof, '');
      for (const scale of [1.0, 1.5]) {
        await page.click('#btn-stop').catch(() => {});
        await setScale(page, scale);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.click('#btn-play');
        const res = [];
        const refs = ['0.0.0', '1.3.0', '2.2.0', '3.0.0', '4.1.0', '5.2.0', '6.1.0', '8.0.0', '10.1.0'];
        let maxH = 0;
        for (const r of refs) {
          await page.evaluate((t) => document.querySelector(`.ch[data-ref="${t}"]`) && document.querySelector(`.ch[data-ref="${t}"]`).click(), r);
          await sleep(3800);
          const m = await page.evaluate(() => {
            const p = document.querySelector('#playpanel').getBoundingClientRect();
            const lines = [...document.querySelectorAll('.song-body .line')].filter((l) => l.getBoundingClientRect().width > 0);
            const tbEl = document.querySelector('.topbar');
            const tb = getComputedStyle(tbEl).position === 'sticky' || getComputedStyle(tbEl).position === 'fixed' ? tbEl.getBoundingClientRect().bottom : 0;
            const vis = lines.filter((l) => { const r = l.getBoundingClientRect(); return r.top >= tb && r.bottom <= p.top; });
            return { h: p.height, full: vis.length, w: document.documentElement.scrollWidth - innerWidth, sticky: tb };
          });
          maxH = Math.max(maxH, m.h);
          res.push(m.full);
        }
        info(`A6 ${name} x${scale}`, `panel max ${maxH.toFixed(0)} px, full lines per position ${res.join(',')} (min ${Math.min(...res)})`);
        if (name === 'w360' && scale === 1.0) rec('A6 panel <= 120 px at 360 px width in play', maxH <= 120, `${maxH} px`);
        if (name === 'iphone13' && scale === 1.5) {
          rec('A6 iPhone 13 x1.5: >= 5 full lines at every position', Math.min(...res) >= 5, res.join(','));
          await page.screenshot({ path: path.join(OUT, 't-a6-iphone13-1.5.png') });
        }
      }
      await browser.close();
    }
    // controls behind the "..." button
    const { browser, page, errors } = await open(W360, '');
    await page.click('#btn-play'); await sleep(2500);
    const hiddenBefore = await page.evaluate(() => document.querySelector('#pp-more').hidden);
    await page.click('#btn-more');
    const shown = await page.evaluate(() => !document.querySelector('#pp-more').hidden);
    rec('A6 ... opens the second row', hiddenBefore && shown);
    await page.screenshot({ path: path.join(OUT, 't-a6-more-open.png') });
    const h = await page.evaluate(() => document.querySelector('#playpanel').getBoundingClientRect().height);
    info('A6 panel height with row open', h + ' px');
    await page.click('#btn-speed-down');
    let sp = await page.evaluate(() => [document.querySelector('#pp-speed').textContent, window.__gapp.timeline.speed]);
    rec('A6 speed - works', sp[0] === '95%' && Math.abs(sp[1] - 0.95) < 1e-9 || sp[0] === '95%', JSON.stringify(sp));
    await page.click('#btn-speed-up');
    sp = await page.evaluate(() => document.querySelector('#pp-speed').textContent);
    rec('A6 speed + works', sp === '100%', sp);
    const osc0 = await page.evaluate(() => document.querySelector('#btn-metro').textContent);
    await page.click('#btn-metro');
    const osc1 = await page.evaluate(() => document.querySelector('#btn-metro').textContent);
    rec('A6 click toggle works', osc0 !== osc1, `${osc0} -> ${osc1}`);
    await page.click('#btn-metro');
    const bpmBefore = await page.evaluate(() => document.querySelector('#pp-bpm').textContent);
    for (let i = 0; i < 6; i++) { await page.click('#btn-tap'); await sleep(500); }
    const bpmAfter = await page.evaluate(() => document.querySelector('#pp-bpm').textContent);
    rec('A6 tap tempo works', bpmBefore !== bpmAfter, `${bpmBefore} -> ${bpmAfter}`);
    const stBefore = await page.evaluate(() => window.__gapp.player.state);
    await page.click('#btn-stop'); await sleep(300);
    const stAfter = await page.evaluate(() => [window.__gapp.player.state, window.__gapp.player.timeSec]);
    rec('A6 stop works', stBefore === 'playing' && stAfter[0] === 'stopped' && stAfter[1] === 0, JSON.stringify([stBefore, stAfter]));
    // is the row closed again after stop? and the playing state with row open then play again
    await page.click('#btn-more');
    rec('A6 ... toggles closed', await page.evaluate(() => document.querySelector('#pp-more').hidden));
    rec('A6 console clean', errors.length === 0, errors.join('|'));
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
