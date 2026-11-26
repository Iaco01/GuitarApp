// Round 10 tester, real mp3 on a phone profile (touch events through CDP): A4 coherence of the beat counter / rhythm dots / "poi"
// badge with the clicks; loop and clicks at the wrap; B on the real song (chord after the 59-63 s gap, free-tempo section,
// nudge + "Correggi a orecchio"/"Sposta tutto"/anchors conflicts), E3 user trial notes. Prints counts/timings/section names only.
// Screenshots (they show the song text: never commit) in test-artifacts/round-10/real/.
// Run: node scripts/build.mjs && node test/e2e/round10-tester-real.cjs <SE|13> [coherence,loop,gap,user]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'index.html');
const REAL = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mht');
const MP3 = path.join(ROOT, 'test', 'fixtures', 'local', 'american-pie.mp3');
const OUT = path.join(ROOT, 'test-artifacts', 'round-10', 'real');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = process.argv[2] || 'SE';
const modes = (process.argv[3] || 'coherence,loop,gap,user').split(',');
const PROFILES = { SE: devices['iPhone SE (3rd gen)'] || { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, 13: devices['iPhone 13'] };
let fails = 0;
const rec = (id, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} [${dev}] ${id} ${info}`); };
const info = (id, t) => console.log(`INFO [${dev}] ${id} ${t}`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
let shotN = 0;
(async () => {
  if (!fs.existsSync(MP3)) { console.log('real mp3 absent: skip'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(PROFILES[dev]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', async (d) => { info('dialog', `"${d.message().slice(0, 80)}"`); await d.accept(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${dev}-${String(++shotN).padStart(2, '0')}-${n}.png`) });
  await page.addInitScript(() => {
    window.__clicks = []; window.__pairs = []; window.__samples = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { const o = orig.call(this); const st = o.start.bind(o); o.start = (when) => { window.__clicks.push([when, o.frequency.value, this.currentTime]); return st(when); }; return o; };
    const cg = AudioContext.prototype.createGain; AudioContext.prototype.createGain = function () { window.__ctx = this; return cg.call(this); };
    setInterval(() => { try { const el = window.__gapp && window.__gapp.audioEl; if (el && window.__ctx && !el.paused) window.__pairs.push([window.__ctx.currentTime, el.currentTime]); } catch (e) {} }, 100);
    window.__sampling = false;
    setInterval(() => { if (!window.__sampling) return; const el = window.__gapp.audioEl; const dots = Array.from(document.querySelectorAll('.pp-dot')); window.__samples.push([el.currentTime, window.__gapp.player.beatIndex, dots.findIndex((d) => d.classList.contains('on')), (document.querySelector('#pp-left') || {}).textContent, (document.querySelector('#pp-current') || {}).textContent, window.__gapp.player.eventIndex]); }, 15);
  });
  await page.goto(URL);
  const longPress = async (sel, ms = 700, idx = 0) => {
    const loc = page.locator(sel).nth(idx); await loc.scrollIntoViewIfNeeded(); await sleep(400);
    const b = await loc.boundingBox(); const x = b.x + Math.min(b.width / 2, 30), y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  };
  const al = () => page.evaluate(() => JSON.parse(localStorage.getItem('gapp.song.' + decodeURIComponent(location.hash.split('/').pop()))).audio.alignment);
  const tl = () => page.evaluate(() => ({ ev: window.__gapp.timeline.events.map((e) => [e.startSec, e.durSec, e.beats, e.sectionIndex, e.ref]), sec: window.__gapp.timeline.sections.map((s) => [s.startSec, s.endSec, s.bpm, s.skipped ? 1 : 0]), gaps: (window.__gapp.timeline.gaps || []).map((g) => [g.startSec, g.endSec]) }));
  const clickMedia = async () => { const r = await page.evaluate(() => ({ c: window.__clicks, p: window.__pairs })); const pc = r.p.map(([c, m]) => [c, m - c]); return r.c.map(([w, f]) => ({ t: w + med(pc.filter(([c]) => Math.abs(c - w) < 2).map((p) => p[1])), acc: f > 900 })).sort((a, b) => a.t - b.t); };
  const t0 = Date.now();
  await page.setInputFiles('#import-input', REAL); await page.waitForSelector('#btn-play', { timeout: 20000 });
  await page.locator('#btn-sync').tap(); await page.waitForSelector('#sync-file', { state: 'attached' });
  await page.setInputFiles('#sync-file', MP3); await page.waitForSelector('#as-start'); const tS = Date.now(); await page.locator('#as-start').tap();
  await page.waitForSelector('#as-rows', { timeout: 240000 });
  info('sync', `analysis ${((Date.now() - tS) / 1000).toFixed(1)} s`);
  await page.locator('#as-accept').tap().catch(() => {}); await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
  const A = await al(); const T = await tl();
  const secStable = A.sections.map((s, i) => (Number.isFinite(s.bpm) ? i : -1)).filter((i) => i >= 0);
  info('sections', `${A.sections.length}; stable ${secStable.map((i) => i + 1).join(',')}; gaps ${JSON.stringify(T.gaps.map((g) => g.map((x) => +x.toFixed(1))))}`);
  const startPlay = async () => { await page.locator('#btn-play').tap(); await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 15000 }); if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.locator('#btn-click-icon').tap(); };

  if (modes.includes('coherence')) {
    const si = secStable.find((i) => T.sec[i][1] - T.sec[i][0] > 30 && i >= 2);
    await startPlay();
    await page.evaluate((t) => { window.__clicks.length = 0; window.__samples.length = 0; window.__sampling = true; window.__gapp.audioEl.currentTime = t; }, T.sec[si][0] + 1);
    await sleep(22000);
    await page.evaluate(() => { window.__sampling = false; });
    await shot('play-coherence');
    const S = await page.evaluate(() => window.__samples); const C = await clickMedia();
    // beat index transitions
    const trans = []; for (let i = 1; i < S.length; i++) if (S[i][1] !== S[i - 1][1] && S[i][1] >= 0) trans.push({ t: S[i][0], b: S[i][1], dot: S[i][2], left: S[i][3] });
    const lags = C.filter((c) => c.t > S[0][0] + 1).map((c) => { const k = trans.find((x) => x.t >= c.t - 0.05); return k ? k.t - c.t : null; }).filter((v) => v !== null);
    info('A4', `section ${si + 1}: ${C.length} clicks, ${trans.length} beat-counter changes, lag counter-after-click median ${(med(lags) * 1000).toFixed(0)} ms, 90% ${(lags.sort((a, b) => a - b)[Math.floor(lags.length * 0.9)] * 1000).toFixed(0)} ms, max ${(Math.max(...lags) * 1000).toFixed(0)}`);
    rec('A4a number of beat-counter changes equals the number of clicks (±2)', Math.abs(trans.length - C.length) <= 2, `${trans.length} vs ${C.length}`);
    // rhythm dots: the lit dot index = beatInBar of the timeline: accents (click 1000 Hz) must light dot 0
    const accC = C.filter((c) => c.acc && c.t > S[0][0] + 1);
    const dotAtAcc = accC.map((c) => { const s = S.find((x) => x[0] >= c.t + 0.04); return s ? s[2] : -9; });
    rec('A4b the accented click lights dot 1 of the rhythm row', dotAtAcc.filter((d) => d === 0).length >= dotAtAcc.length * 0.95, `${dotAtAcc.filter((d) => d === 0).length}/${dotAtAcc.length}`);
    // badge "beats left" never greater than 8 and monotone within a chord
    const lefts = S.map((s) => Number(s[3])).filter((v) => Number.isFinite(v));
    info('A4c', `"beats to the change" badge values seen: ${[...new Set(lefts)].sort((a, b) => a - b).join(',')}`);
    // beats left vs ticks: for each chord change (eventIndex change), ticks since last chord change should equal beats of chord
    const chg = []; for (let i = 1; i < S.length; i++) if (S[i][5] !== S[i - 1][5]) chg.push({ t: S[i][0], ev: S[i][5] });
    let okc = 0, totc = 0; const bad = [];
    for (let k = 1; k + 1 < chg.length; k++) { const n = C.filter((c) => c.t >= chg[k].t - 0.06 && c.t < chg[k + 1].t - 0.06).length; totc++; const eb = T.ev[chg[k].ev][2]; if (n === eb) okc++; else bad.push(`ev${chg[k].ev} beats ${eb} heard ${n}`); }
    rec('A4d for each chord shown, the clicks heard while it is highlighted equal its beats', okc >= totc - 1, `${okc}/${totc} ${bad.slice(0, 5).join('; ')}`);
    await page.locator('#btn-play').tap(); await sleep(300);
    // the panel tempo
    info('A4e', `panel tempo text: ${await page.locator('#pp-bpm').textContent()} (section measured ${A.sections[si].bpm.toFixed(1)})`);
  }

  if (modes.includes('loop')) {
    const si = secStable.find((i) => T.sec[i][1] - T.sec[i][0] > 12 && T.sec[i][1] - T.sec[i][0] < 30 && i >= 3);
    await page.evaluate(() => { window.__gapp.audioEl.pause(); });
    await longPress(`.sec-head[data-sec="${si}"] .sec-title`, 700);
    const looping = await page.locator('.looping').count();
    rec('L1 long press on the section header starts a loop (touch)', looping === 1, `section ${si + 1}, length ${(T.sec[si][1] - T.sec[si][0]).toFixed(1)} s`);
    await page.waitForFunction(() => window.__gapp.player.state === 'playing', null, { timeout: 8000 }).catch(() => {});
    if ((await page.getAttribute('#btn-click-icon', 'aria-pressed')) !== 'true') await page.locator('#btn-click-icon').tap();
    await sleep(500); await page.evaluate(() => { window.__clicks.length = 0; });
    const len = T.sec[si][1] - T.sec[si][0];
    await sleep((len * 2 + 4) * 1000);
    const raw = await page.evaluate(() => window.__clicks.map((c) => c[0]));
    const beat = 60 / A.sections[si].bpm; const nbeats = T.ev.filter((e) => e[3] === si).reduce((s, e) => s + e[2], 0);
    const iv = raw.slice(1).map((t, i) => t - raw[i]);
    const odd = iv.map((d, i) => ({ d, i })).filter((x) => x.d < 0.6 * beat || x.d > 1.5 * beat);
    info('L2', `section ${si + 1}: ${nbeats} beats per pass, ${raw.length} clicks over ${(raw[raw.length - 1] - raw[0]).toFixed(1)} s (loop ${(T.sec[si][1] - T.sec[si][0]).toFixed(1)} s); intervals outside 0,6-1,5 beat: ${odd.map((x) => `#${x.i} ${(x.d * 1000).toFixed(0)} ms`).join(', ') || 'none'}; min ${(Math.min(...iv) * 1000).toFixed(0)} ms max ${(Math.max(...iv) * 1000).toFixed(0)} ms (beat ${(beat * 1000).toFixed(0)} ms)`);
    // one pass = the loop duration: clicks in the second pass after the first wrap
    const periods = []; const tpass = T.sec[si][1] - T.sec[si][0];
    rec('L3 clicks per loop pass equal the beats of the section (+-1)', Math.abs(raw.length / ((raw[raw.length - 1] - raw[0] + beat) / tpass) - nbeats) <= 1.5, `${(raw.length / ((raw[raw.length - 1] - raw[0] + beat) / tpass)).toFixed(1)} vs ${nbeats}`);
    rec('L4 no double click at the loop wrap or at chord boundaries (nothing closer than 0,6 beat)', odd.filter((x) => x.d < 0.6 * beat).length === 0, `${odd.filter((x) => x.d < 0.6 * beat).length}`);
    await page.locator('.loop-x').first().tap().catch(() => {}); await page.locator('#btn-play').tap().catch(() => {}); await sleep(300);
  }

  if (modes.includes('gap')) {
    // B3: nudge the chord just after the real gap (59-63 s), the one just before, and the whole section after it
    const gp = A.gaps[0]; const jb = gp.before; // first chord after the gap
    const chordHold = async (j) => {
      const ref = await page.evaluate((j) => window.__gapp.timeline.events[j].ref, j);
      await longPress(`.ch[data-ref="${ref}"]`, 700);
      return page.locator('#nudge-time').count();
    };
    const step = async (d) => { await page.locator(`.nudge-sheet [data-s="${d}"]`).tap(); await sleep(150); };
    const closeSheet = async () => { await page.locator('#nudge-close').tap(); await sleep(200); };
    const gapsNow = async () => (await tl()).gaps.map((g) => g.map((x) => +x.toFixed(2)));
    info('GAP0', `gap ${gp.startSec.toFixed(2)}-${gp.endSec.toFixed(2)} s before chord ${jb}; timeline gaps ${JSON.stringify(await gapsNow())}`);
    for (const [label, j, d] of [['chord after the gap', jb, '-0.05'], ['chord after the gap', jb, '-0.25'], ['chord after the gap', jb, '0.25'], ['chord before the gap', jb - 1, '0.25'], ['chord before the gap', jb - 1, '-0.25']]) {
      const A1 = await al(); const opened = await chordHold(j);
      if (!opened) { rec(`GAP ${label} ${d}: sheet opens`, false); continue; }
      // the release can land on a button: take the state after opening as reference
      const Ao = await al();
      await step(d);
      const A2 = await al(); const G2 = await gapsNow();
      rec(`GAP ${label} ${d}: the gap is kept`, A2.gaps.length === A1.gaps.length && G2.length === 1, `saved gaps ${A1.gaps.length}->${A2.gaps.length}${A2.gaps[0] ? ` (${A2.gaps[0].startSec}-${A2.gaps[0].endSec} vs chord ${A2.eventStartSec[jb]})` : ''}; timeline gaps ${JSON.stringify(G2)}; chord moved ${((A2.eventStartSec[j] - Ao.eventStartSec[j]) * 1000).toFixed(0)} ms`);
      await page.locator('#nudge-undo').tap().catch(() => {}); await sleep(100); if (!(await page.locator('#nudge-undo').isDisabled())) { for (let k = 0; k < 4 && !(await page.locator('#nudge-undo').isDisabled()); k++) await page.locator('#nudge-undo').tap(); }
      await closeSheet();
      const A3 = await al();
      rec(`GAP ${label} ${d}: undo gives back the gap exactly`, JSON.stringify(A3.gaps) === JSON.stringify(A1.gaps) && JSON.stringify(A3.eventStartSec) === JSON.stringify(A1.eventStartSec), `gaps ${JSON.stringify(A3.gaps)}`);
    }
    // in play: is the 'Fuori dal foglio' state still there after a -0.05 on the chord after the gap (no undo)?
    const ref = await page.evaluate((j) => window.__gapp.timeline.events[j].ref, jb);
    await longPress(`.ch[data-ref="${ref}"]`, 700); await page.locator('.nudge-sheet [data-s="-0.05"]').tap(); await sleep(200); await page.locator('#nudge-close').tap(); await sleep(200);
    const Tn = await tl();
    info('GAP1', `after -0,05 on the chord after the gap: timeline gaps ${JSON.stringify(Tn.gaps.map((g) => g.map((x) => +x.toFixed(2))))}; the chord before the gap now lasts ${(Tn.ev[jb - 1][1]).toFixed(2)} s`);
    await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, 61);
    await page.locator('#btn-play').tap().catch(() => {}); await sleep(1200);
    info('GAP2', `in play at 1:01 -> panel "${await page.locator('#pp-current').textContent()}", countdown "${await page.locator('#pp-gap').textContent()}", highlighted chords ${await page.locator('.cur').count()}`);
    await page.locator('#btn-play').tap().catch(() => {});
  }

  if (modes.includes('user')) {
    const vp = PROFILES[dev].viewport; const notes = [];
    const note = (t) => { notes.push(t); info('NOTE', t); };
    const inView = async (sel, label) => { const b = await page.locator(sel).first().boundingBox().catch(() => null); if (!b) { note(`"${label}" not found`); return; } if (b.y < 0 || b.y + b.height > vp.height) note(`"${label}" not fully visible without scrolling (y ${Math.round(b.y)}, h ${Math.round(b.height)}, screen ${vp.height})`); if (b.height < 40 || b.width < 40) note(`"${label}" small target ${Math.round(b.width)}x${Math.round(b.height)}`); };
    await shot('user-song-after-sync');
    note(`header section buttons "⇄" visible after the sync (no other action): ${await page.locator('.sec-nudge').count()} of ${await page.locator('.sec-head').count()} headers`);
    // 1. play, listen to the click in a stable section
    await page.evaluate((t) => { window.__gapp.audioEl.currentTime = t; }, T.sec[2][0] + 2);
    await startPlay(); await sleep(7000); await shot('user-playing');
    note(`panel while playing: current "${await page.locator('#pp-current').textContent()}", next "${await page.locator('#pp-next').textContent()}", tempo "${await page.locator('#pp-bpm').textContent()}", click button "${await page.getAttribute('#btn-click-icon', 'aria-pressed')}"`);
    // 2. a chord that "arrives late": tap pause, long press a chord of the yellow Verse 2 section, nudge -0.25 and listen
    await page.locator('#btn-play').tap(); await sleep(300);
    const secY = A.sections.findIndex((x, i) => i >= 2 && x.confidence < 0.75 && x.confidence >= 0.5);
    const idxs = T.ev.map((e, i) => (e[3] === secY ? i : -1)).filter((i) => i >= 0);
    const jn = idxs[Math.floor(idxs.length / 2)];
    const refN = T.ev[jn][4];
    const before = (await al()).eventStartSec[jn];
    await longPress(`.ch[data-ref="${refN}"]`, 700);
    const hasSheet = await page.locator('#nudge-time').count();
    note(`long press (700 ms) on chord ${jn} of section ${secY + 1}: sheet ${hasSheet ? 'opened' : 'NOT opened'}`);
    if (hasSheet) {
      await shot('user-nudge-sheet');
      note(`sheets in the DOM ${await page.locator('.nudge-sheet').count()}; radios ${JSON.stringify(await page.locator('.nudge-sheet input[type=radio]').evaluateAll((e) => e.map((x) => x.value + ':' + x.checked)))}`);
      await inView('#nudge-close', 'Chiudi'); await inView('.nudge-sheet [data-s="-0.25"]', '-0,25'); await inView('#nudge-listen', 'Ascolta da qui');
      const opened = (await al()).eventStartSec[jn];
      note(`time at the moment the sheet opened vs before the long press: ${(opened - before).toFixed(3)} s (0 expected)`);
      await page.locator('.nudge-sheet [data-s="-0.25"]').tap(); await sleep(150);
      await page.locator('.nudge-sheet [data-s="-0.05"]').tap(); await sleep(150);
      await page.locator('#nudge-listen').tap(); await sleep(1500); await shot('user-nudge-listen'); await sleep(3500);
      const stt = await page.evaluate(() => window.__gapp.player.state);
      note(`"Ascolta da qui": after 5 s the player is ${stt}`);
      await page.locator('#nudge-close').tap(); await sleep(200);
    }
    // 3. move a whole section: from the song sheet header (⇄) and from the sync screen
    const hdrBtn = await page.locator(`.sec-nudge[data-sec="${secY}"]`).count();
    note(`⇄ on the header of section ${secY + 1}: ${hdrBtn ? 'present' : 'ABSENT'}`);
    await page.locator('#btn-sync').tap(); await page.waitForSelector('#as-rows');
    note(`sync screen: how a person finds the section nudge: row text only (title "${await page.locator(`.as-row[data-sec="${secY}"] [data-act="nudge"]`).getAttribute('title')}"), no icon or label`);
    await page.locator(`.as-row[data-sec="${secY}"] [data-act="nudge"]`).scrollIntoViewIfNeeded(); await page.locator(`.as-row[data-sec="${secY}"] [data-act="nudge"]`).tap(); await page.waitForSelector('#nudge-close');
    await shot('user-section-sheet');
    await page.locator('.nudge-sheet [data-s="0.25"]').tap(); await sleep(150);
    note(`row state after moving the whole section: ${await page.locator(`.as-row[data-sec="${secY}"]`).getAttribute('data-state')}, counts "${await page.innerText('#as-counts')}"`);
    await page.locator('#nudge-close').tap(); await sleep(200);
    await page.locator('#sync-close').tap(); await page.waitForSelector('#btn-play');
    // 4. play from the middle: tap on a chord (stopped), then play, then tap on a chord while playing
    const jm = T.ev.findIndex((e) => e[0] > 250);
    const refM = T.ev[jm][4];
    const loc = page.locator(`.ch[data-ref="${refM}"]`).first(); await loc.scrollIntoViewIfNeeded(); await sleep(300);
    await loc.tap(); await sleep(500);
    note(`tap on a chord in the middle with the player stopped: ${await page.locator('.sheet').count() ? 'opens a sheet (the chord diagram), does not play' : 'nothing visible'}; player state ${await page.evaluate(() => window.__gapp.player.state)}`);
    await page.keyboard.press('Escape'); await page.locator('.sheet button').first().tap().catch(() => {}); await sleep(300);
    await shot('user-after-chord-tap');
    await startPlay(); await sleep(1500);
    await loc.scrollIntoViewIfNeeded(); await sleep(400);
    const t0m = await page.evaluate(() => window.__gapp.audioEl.currentTime);
    await loc.tap(); await sleep(1200);
    const t1m = await page.evaluate(() => window.__gapp.audioEl.currentTime);
    note(`tap on a chord while playing: media time ${t0m.toFixed(1)} -> ${t1m.toFixed(1)} s (chord at ${T.ev[jm][0].toFixed(1)} s)`);
    rec('U1 tap on a chord while playing seeks there', Math.abs(t1m - 1.2 - T.ev[jm][0]) < 3, '');
    await shot('user-play-mid');
    // 5. in-play gap
    await page.evaluate(() => { window.__gapp.audioEl.currentTime = 56.5; }); await sleep(800);
    const gl = []; const tt = Date.now(); let sy0 = await page.evaluate(() => window.scrollY);
    while (Date.now() - tt < 9000) { const st = await page.evaluate(() => ({ t: window.__gapp.audioEl.currentTime, name: document.querySelector('#pp-current').textContent, gap: document.querySelector('#pp-gap').textContent, bpm: document.querySelector('#pp-bpm').textContent, sy: window.scrollY })); gl.push(st); if (st.t > 60.8 && !gl.shot) { gl.shot = 1; await shot('user-gap'); } await sleep(250); }
    const inG = gl.filter((x) => x.t > 59.8 && x.t < 63.2);
    note(`in the gap: panel names ${JSON.stringify([...new Set(inG.map((x) => x.name))])}, countdown texts ${JSON.stringify([...new Set(inG.map((x) => x.gap))])}, tempo texts ${JSON.stringify([...new Set(inG.map((x) => x.bpm))])}, page scrolled ${Math.round(Math.abs(gl[gl.length - 1].sy - gl[0].sy))} px over the window`);
    await page.locator('#btn-play').tap().catch(() => {});
    fs.writeFileSync(path.join(OUT, `${dev}-user-notes.txt`), notes.join('\n'));
  }
  rec('Rz no page errors', errors.length === 0, errors.join('|').slice(0, 120));
  fs.writeFileSync(path.join(OUT, `${dev}-state.json`), JSON.stringify({ A, T }));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${fails} FAIL`);
  await browser.close();
})().catch((e) => { console.log('FAILED', e); process.exit(1); });
