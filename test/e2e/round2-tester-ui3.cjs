// Round 2 tester, browser part 3: E (durations) and the footprint of the bottom panel.
// Run: npm run build && node test/e2e/round2-tester-ui3.cjs [E|P]   Needs the git-ignored real file. Prints no song text.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test/fixtures/local/american-pie.mht');
const OUT = path.join(ROOT, 'test-artifacts', 'round-2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (id, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${info || ''}`); };
const info = (id, t) => console.log(`INFO ${id} ${t}`);
const only = process.argv[2] || '';
const W360 = { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } };
const song = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))));
const tlOf = (page) => page.evaluate(() => ({ events: window.__gapp.timeline.events.map((e) => ({ s: e.startSec, ref: e.ref, sec: e.sectionIndex, beats: e.beats })), sections: window.__gapp.timeline.sections, total: window.__gapp.timeline.totalSec }));
async function open(prof = W360) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(URL);
  await page.setInputFiles('#import-input', REAL);
  await page.waitForSelector('#song-title');
  return { browser, page, errors };
}
const beatsClickFor = (page) => async (n) => { await page.evaluate(() => { document.querySelector('details.settings').open = true; }); await page.click(`.beats-opt[data-beats="${n}"]`); };
const beatsAll = (s) => s.sections.flatMap((x) => x.lines.flatMap((l) => l.chords.map((c) => c.beats)));

(async () => {
  if (!only || only === 'E') {
    const { browser, page, errors } = await open();
    const dialogs = [];
    let answer = true;
    page.on('dialog', async (d) => { dialogs.push(d.message()); if (answer) await d.accept(); else await d.dismiss(); });
    const base = await tlOf(page);
    const beatsClick = beatsClickFor(page);
    // E1: beats per chord (default data: no confirm)
    const totals = {};
    for (const n of [2, 8, 4]) { await beatsClick(n); totals[n] = (await tlOf(page)).total; }
    const mine = base.total; // 4 beats
    rec('E1-beats-per-chord-2-4-8', Math.abs(totals[2] - mine / 2) < 1e-6 && Math.abs(totals[8] - mine * 2) < 1e-6 && Math.abs(totals[4] - mine) < 1e-6 && dialogs.length === 0, `2: ${totals[2].toFixed(1)} (want ${(mine / 2).toFixed(1)}), 8: ${totals[8].toFixed(1)} (want ${(mine * 2).toFixed(1)}), 4: ${totals[4].toFixed(1)}; confirms asked ${dialogs.length}`);
    // E2: manual +/- limits, source 'edited'
    await page.click('#btn-edit');
    await page.locator('.ch[data-ref="0.0.0"]').click();
    for (let i = 0; i < 6; i++) await page.click('#eb-minus');
    const min = await page.textContent('#eb-val');
    for (let i = 0; i < 40; i++) await page.click('#eb-plus');
    const max = await page.textContent('#eb-val');
    for (let i = 0; i < 28; i++) await page.click('#eb-minus');
    const s1 = await song(page);
    rec('E2-limits-1-32-and-source', min === '1' && max === '32' && s1.sections[0].lines[0].chords[0].beats === 4 && s1.timingSource === 'edited', `min ${min}, max ${max}, final ${s1.sections[0].lines[0].chords[0].beats}, source ${s1.timingSource}`);
    await page.screenshot({ path: path.join(OUT, 't-e-edit.png') });
    // make one real edit in Chorus 1 (section 1, first chord) to 6
    await page.locator('.ch[data-ref="1.0.0"]').scrollIntoViewIfNeeded();
    await page.locator('.ch[data-ref="1.0.0"]').click();
    for (let i = 0; i < 2; i++) await page.click('#eb-plus');
    // E3: copy buttons
    const labels = await page.locator('.copy-beats').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-sec'), b.textContent]));
    const s2 = await song(page);
    const sigs = s2.sections.map((x) => x.lines.flatMap((l) => l.chords.map((c) => c.name)).join(' '));
    const base_ = s2.sections.map((x) => x.name.replace(/\s*\d+\s*$/, '').trim());
    const expected = sigs.map((sg, i) => sigs.map((_, j) => j).filter((j) => j !== i && base_[j] === base_[i] && sigs[j] === sg).length);
    const got = Array(12).fill(0); labels.forEach(([si, t]) => { got[Number(si)] = Number(/(\d+)/.exec(t)[1]); });
    rec('E3-copy-button-counts-match-plan-definition', JSON.stringify(got) === JSON.stringify(expected), `button counts ${got} vs own computation ${expected}; Chorus 1 (index 1) proposes ${got[1]}`);
    info('E3-copy-buttons', `${labels.length} buttons; label example "${labels.find((l) => l[0] === '1')[1]}"`);
    // click the Chorus 1 copy button
    await page.locator('.copy-beats[data-sec="1"]').scrollIntoViewIfNeeded();
    await page.locator('.copy-beats[data-sec="1"]').click();
    const s3 = await song(page);
    const targets = expected[1] ? sigs.map((sg, j) => (j !== 1 && base_[j] === 'Chorus' && sg === sigs[1] ? j : -1)).filter((j) => j >= 0) : [];
    const src = s3.sections[1].lines.flatMap((l) => l.chords.map((c) => c.beats));
    const okT = targets.every((t) => JSON.stringify(s3.sections[t].lines.flatMap((l) => l.chords.map((c) => c.beats))) === JSON.stringify(src));
    const untouched = [0, 2, 4, 6, 8, 10, 11].every((j) => JSON.stringify(s3.sections[j].lines.flatMap((l) => l.chords.map((c) => c.beats))) === JSON.stringify(s2.sections[j].lines.flatMap((l) => l.chords.map((c) => c.beats))));
    rec('E3-copy-clicked-copies-to-identical-sections-only', okT && untouched && src[0] === 6 && targets.length === 4, `targets ${targets}, first chord now ${targets.map((t) => s3.sections[t].lines[0].chords[0].beats)}, other sections untouched ${untouched}`);
    // timeline after copy: total
    const tAfter = await tlOf(page);
    const myTotal = (() => { let t = 0; s3.sections.forEach((x, i) => { const bpm = x.bpm; x.lines.forEach((l) => l.chords.forEach((c) => { t += c.beats * 60 / bpm; })); }); return t; })();
    rec('E-timeline-total-matches-own-sum-after-edits', Math.abs(tAfter.total - myTotal) < 0.001, `${tAfter.total.toFixed(3)} vs ${myTotal.toFixed(3)}`);
    // E1 confirm: with edited durations changing beats per chord asks, cancel keeps, accept resets
    await page.click('#btn-edit'); // leave edit mode
    answer = false;
    await beatsClick(8);
    const sKeep = await song(page);
    answer = true;
    const n0 = dialogs.length;
    await beatsClick(2);
    const sReset = await song(page);
    rec('E1-confirm-when-edited', dialogs.length === n0 + 1 && n0 >= 1 && JSON.stringify(beatsAll(sKeep)) === JSON.stringify(beatsAll(s3)) && beatsAll(sReset).every((b) => b === 2) && sReset.timingSource === 'default', `confirm text "${dialogs[0]}"; cancel kept edits: ${JSON.stringify(beatsAll(sKeep)) === JSON.stringify(beatsAll(s3))}; accept -> all 2: ${beatsAll(sReset).every((b) => b === 2)}`);
    await beatsClick(4);
    // E5 persistence after reload of an edit
    await page.click('#btn-edit');
    await page.locator('.ch[data-ref="2.0.0"]').scrollIntoViewIfNeeded();
    await page.locator('.ch[data-ref="2.0.0"]').click();
    await page.click('#eb-plus');
    await page.reload(); await page.waitForSelector('#song-title');
    const sp = await song(page);
    const tp = await tlOf(page);
    rec('E5-persist-edit-after-reload', sp.sections[2].lines[0].chords[0].beats === 5 && sp.timingSource === 'edited' && tp.events.find((e) => e.ref === '2.0.0').beats === 5, `beats ${sp.sections[2].lines[0].chords[0].beats}, source ${sp.timingSource}`);

    // ---------- E4 tap recording ----------
    async function record({ sec, plan, endAfter = null, double = null, action = 'save', speedDowns = 0, label }) {
      // plan: array of chord durations in beats for the first plan.length chords; taps fall at the end of each chord except the last (Fine closes it)
      await page.click('#btn-edit').catch(() => {});
      const inEdit = await page.evaluate(() => document.getElementById('btn-edit').getAttribute('aria-pressed') === 'true');
      if (!inEdit) await page.click('#btn-edit');
      const before = await song(page);
      const tl = await tlOf(page);
      const first = tl.events.findIndex((e) => e.sec === sec);
      const bpm = tl.sections[sec].bpm;
      await page.locator(`.rec-sec[data-sec="${sec}"]`).scrollIntoViewIfNeeded();
      await page.locator(`.rec-sec[data-sec="${sec}"]`).click();
      await page.waitForSelector('#rec-tap');
      await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 20000 });
      const ends = []; let pos = 0; for (const d of plan) { pos += d; ends.push(pos); }
      const startSec = tl.events[first].s;
      const spb = 60 / bpm / (await page.evaluate(() => window.__gapp.timeline.speed));
      let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const jit = plan.jitter || 0;
      const targets = ends.map((p) => startSec + p * spb + (rnd() * 2 - 1) * (plan.jitter || 0) / 1000);
      // taps for all chords except the last: the last chord is closed by "Fine"
      await page.evaluate(async ({ targets, double, endTarget }) => {
        const wait = (t) => new Promise((res) => { const f = () => (window.__gapp.player.timeSec >= t ? res() : requestAnimationFrame(f)); f(); });
        const btn = document.getElementById('rec-tap');
        for (let k = 0; k < targets.length - 1; k++) {
          await wait(targets[k]); btn.click();
          if (double === k) { await new Promise((r) => setTimeout(r, 60)); btn.click(); }
        }
        await wait(endTarget); document.getElementById('rec-end').click();
      }, { targets, double, endTarget: targets[targets.length - 1] });
      await page.waitForSelector('#rec-summary');
      const rows = await page.locator('#rec-rows li .rec-row-val').allTextContents();
      const parsed = rows.map((t) => t.split('→').map((x) => Number(x.trim())));
      await page.screenshot({ path: path.join(OUT, `t-e-preview-${label}.png`) });
      const got = parsed.slice(0, plan.length).map((p) => p[1]);
      const rest = parsed.slice(plan.length).every((p, i) => p[1] === p[0]);
      rec(`E4-${label}-preview`, JSON.stringify(got) === JSON.stringify(plan.slice()) && rest && parsed.length === tl.events.filter((e) => e.sec === sec).length, `want ${plan.join(',')} got ${got.join(',')}; remaining chords keep their length: ${rest}; rows ${parsed.length}`);
      if (action === 'discard') {
        await page.click('#rec-discard');
        const after = await song(page);
        rec(`E4-${label}-discard-keeps-old`, JSON.stringify(beatsAll(after)) === JSON.stringify(beatsAll(before)) && after.timingSource === before.timingSource, `source ${after.timingSource}`);
      } else {
        await page.click('#rec-save');
        const after = await song(page);
        const b2 = beatsAll(after); const offs = before.sections.slice(0, sec).reduce((a, s) => a + s.lines.reduce((x, l) => x + l.chords.length, 0), 0);
        rec(`E4-${label}-saved`, after.timingSource === 'recorded' && JSON.stringify(b2.slice(offs, offs + plan.length)) === JSON.stringify(plan.slice()), `source ${after.timingSource}; saved ${b2.slice(offs, offs + plan.length).join(',')}`);
      }
      return { before };
    }
    // restore all to default 4 before recording
    await page.click('#btn-edit'); // leave edit
    answer = true; await beatsClick(4);
    // 142 BPM (Verse 2 = index 2): exact taps, varied durations
    const plan142 = [4, 4, 2, 1, 3, 4, 2, 2];
    await record({ sec: 2, plan: plan142, label: 'sec142-exact' });
    // jitter +-80 ms at 142 BPM
    const planJ = [4, 2, 2, 1, 1, 4, 3, 2]; planJ.jitter = 80;
    await record({ sec: 4, plan: planJ, label: 'sec142-jitter80' });
    // 62 BPM (Verse 1 = index 0) exact
    const plan62 = [4, 4, 2, 4, 3, 4]; await record({ sec: 0, plan: plan62, label: 'sec62-exact' });
    const plan62j = [4, 2, 4, 4, 1, 4]; plan62j.jitter = 80; await record({ sec: 0, plan: plan62j, label: 'sec62-jitter80', double: 1 });
    // discard path
    const planD = [2, 2, 2, 2]; await record({ sec: 6, plan: planD, label: 'discard', action: 'discard' });
    // Chorus at 96 BPM with speed 50%
    await page.click('#btn-edit');
    await page.screenshot({ path: path.join(OUT, 't-e-after-recordings.png') });
    // persistence after reload
    const sRec = await song(page);
    await page.reload(); await page.waitForSelector('#song-title');
    const sAfter = await song(page);
    rec('E5-persist-recordings-after-reload', JSON.stringify(beatsAll(sAfter)) === JSON.stringify(beatsAll(sRec)) && sAfter.timingSource === 'recorded', `source ${sAfter.timingSource}`);
    rec('E-console-clean', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // ---------- speed < 100% recording ----------
  if (!only || only === 'E2') {
    const { browser, page } = await open();
    for (let i = 0; i < 10; i++) await page.click('#btn-speed-down');
    await page.click('#btn-edit');
    const tl = await tlOf(page);
    await page.locator('.rec-sec[data-sec="1"]').click();
    await page.waitForSelector('#rec-tap');
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 25000 });
    const info2 = await page.evaluate(() => ({ sp: window.__gapp.timeline.speed }));
    const spb = 60 / 96 / info2.sp;
    const plan = [4, 2, 4, 2];
    await page.evaluate(async ({ start, spb, plan }) => {
      const wait = (t) => new Promise((res) => { const f = () => (window.__gapp.player.timeSec >= t ? res() : requestAnimationFrame(f)); f(); });
      let pos = 0;
      for (let k = 0; k < plan.length - 1; k++) { pos += plan[k]; await wait(start + pos * spb); document.getElementById('rec-tap').click(); }
      pos += plan[plan.length - 1]; await wait(start + pos * spb); document.getElementById('rec-end').click();
    }, { start: tl.events.findIndex((e) => e.sec === 1) >= 0 ? tl.events.find((e) => e.sec === 1).s : 0, spb, plan });
    await page.waitForSelector('#rec-summary');
    const rows = await page.locator('#rec-rows li .rec-row-val').allTextContents();
    const got = rows.slice(0, 4).map((t) => Number(t.split('→')[1]));
    rec('E4-recording-at-speed-50', JSON.stringify(got) === JSON.stringify(plan), `speed ${info2.sp}; want ${plan} got ${got}`);
    await page.click('#rec-discard');
    await browser.close();
  }

  // ---------- Panel footprint ----------
  if (!only || only === 'P') {
    for (const [name, prof] of [['pixel7', devices['Pixel 7']], ['iphone13', devices['iPhone 13']], ['w360x780', W360]]) {
      const { browser, page } = await open(prof);
      const tl = await tlOf(page);
      for (const scale of [1.0, 1.5]) {
        let cur = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).view.fontScale);
        while (Math.abs(cur - scale) > 0.01) { await page.click(cur < scale ? '#btn-font-up' : '#btn-font-down'); cur = await page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/')[2]))).view.fontScale); }
        await page.click('#btn-stop').catch(() => {});
        await page.click('#btn-play');
        await page.waitForFunction(() => window.__gapp.player.state === 'counting' || window.__gapp.player.state === 'playing');
        const loc = page.locator(`.ch[data-ref="${tl.events[12].ref}"]`).first();
        await loc.scrollIntoViewIfNeeded(); await loc.click();
        await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 });
        await sleep(2500); // let the smooth scroll settle
        const r = await page.evaluate(() => {
          const p = document.getElementById('playpanel').getBoundingClientRect();
          const tb = document.querySelector('.topbar'); const tbr = tb.getBoundingClientRect();
          const sticky = getComputedStyle(tb).position;
          const topLimit = sticky === 'sticky' || sticky === 'fixed' ? tbr.bottom : 0;
          const lines = [...document.querySelectorAll('.song-body .line')].map((l) => l.getBoundingClientRect()).filter((r) => r.width > 0);
          const vis = lines.filter((r) => r.top >= topLimit && r.bottom <= p.top);
          const partial = lines.filter((r) => r.bottom > topLimit && r.top < p.top).length;
          const plainLine = lines.length ? lines[1].height : 0;
          return { vh: innerHeight, panelH: Math.round(p.height), panelTop: Math.round(p.top), topLimit: Math.round(topLimit), freeH: Math.round(p.top - topLimit), fullLines: vis.length, partialLines: partial, lineH: Math.round(plainLine), pad: getComputedStyle(document.querySelector('.screen.song')).paddingBottom };
        });
        info(`P-${name}@${scale}`, JSON.stringify(r) + `; panel = ${(100 * r.panelH / r.vh).toFixed(0)}% of height`);
        await page.screenshot({ path: path.join(OUT, `t-p-${name}-${scale}.png`) });
        // last line reachable
        await page.click('#btn-stop');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(300);
        const end = await page.evaluate(() => { const p = document.getElementById('playpanel').getBoundingClientRect(); const f = document.querySelector('#btn-delete').getBoundingClientRect(); const lines = [...document.querySelectorAll('.song-body .line')].filter((l) => l.getBoundingClientRect().width > 0); const l = lines[lines.length - 1].getBoundingClientRect(); return { lastLineBottom: Math.round(l.bottom), panelTop: Math.round(p.top), deleteBtnBottom: Math.round(f.bottom), vh: innerHeight }; });
        rec(`D2-last-line-and-footer-reachable ${name}@${scale}`, end.lastLineBottom <= end.panelTop && end.deleteBtnBottom <= end.panelTop + 1, JSON.stringify(end));
      }
      await browser.close();
    }
  }
  console.log(fails ? fails + ' FAILURES' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
