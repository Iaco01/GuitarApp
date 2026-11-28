// Tab song screen (round 14): the tab in monospace reflowed to the screen width, a cursor that moves with the play,
// the chord diagrams as written in the tab, the part selector and the order of the sections.

import { domEl, domClear } from './dom.js';
import { saveSong, deleteSong, getDevice, saveDevice } from '../storage.js';
import { createPlayer } from '../player.js';
import { createPlayPanel } from './playpanel.js';
import { applyTheme } from './songview.js';
import { createSynthEngine } from '../synthvoice.js';
import { buildNotePlan } from '../tabsynth.js';
import { renderDiagramSvg } from '../diagram.js';
import { getChordShapes } from '../chords-db.js';
import { formatBpm } from '../render.js';
import { buildTabTimeline, tabColumnAt, tabChordAt, tabSectionBpm, arrangementRepeat, arrangementRemove, arrangementMove, arrangementAdd, TAB_BPM_MIN, TAB_BPM_MAX } from '../tabplay.js';
import { layoutTabMeasures, tabCursorPlace, tabRowLabels } from '../tablayout.js';
import { tabChordVoices, tabPartHasChords, tabArrangement, tabDefaultArrangement, tabSectionTitle, tabTechniquesUsed, TAB_TECHNIQUES, normalizeTab, tabMeasureCount } from '../tab.js';

const TB_FONT_MIN = 0.7;
const TB_FONT_MAX = 2.0;
const TB_SCROLL_PAUSE_MS = 4000;
const TB_LOW_SCREEN_PX = 700;
const TB_FONT_PX = 11;

let tbActive = null;

export function leaveTabScreen() {
  if (tbActive) tbActive.destroy();
  tbActive = null;
}

const tbClampFont = (v) => Math.round(Math.min(TB_FONT_MAX, Math.max(TB_FONT_MIN, v)) * 10) / 10;

const TB_SUN_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
const TB_MOON_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';

export function showTabScreen(root, song, { onBack, onDeleted }) {
  leaveTabScreen();
  domClear(root);
  normalizeTab(song);
  const tab = song.tab;
  const partCount = tab.parts.length;

  const devPref = (key, fallback) => { try { const v = getDevice()[key]; return v === undefined ? fallback : v; } catch { return fallback; } };
  const setDevPref = (key, value) => { try { saveDevice({ ...getDevice(), [key]: value }); } catch { /* no storage */ }};
  let dgMode = ['side', 'top', 'none'].includes(devPref('diagramMode', 'side')) ? devPref('diagramMode', 'side') : 'side';
  let barAuto = devPref('barAutoCollapse', true) !== false;
  const savedPct = Number(song.view.speedPct);
  let speed = Number.isFinite(savedPct) ? Math.min(100, Math.max(25, Math.round(savedPct))) / 100 : 1;
  let partSel = song.view.tabPart === 'all' ? 'all' : Number.isInteger(song.view.tabPart) && song.view.tabPart < partCount ? song.view.tabPart : tab.guide;
  if (partCount < 2) partSel = 0;
  let panel = null;
  let manualScrollUntil = 0;
  let curKey = null;
  let nextKey = null;
  let lastFrameKey = '';
  let lastCursor = '';
  let countScrolled = -1;
  let layouts = new Map(); // "part.sec" -> { lines, lineEls, measures }
  let segEls = new Map(); // "part.sec.measure" -> [{ hl, lineEl, line, seg }]
  let chw = 6.6;
  let widthChars = 0;
  let voiceBtns = new Map();
  let sideNames = { cur: null, next: null };
  let sideCur = null;
  let sideNext = null;

  const guideIndex = () => (partSel === 'all' ? Math.min(Math.max(0, tab.guide), partCount - 1) : partSel);
  const notice = domEl('div', { class: 'msg', role: 'alert' });
  const showError = (text) => { notice.textContent = text; notice.className = 'msg error'; };
  const showNote = (text) => { notice.textContent = text; notice.className = 'msg'; };
  const persist = () => {
    try { saveSong(song); } catch (err) { showError(err.message); }
  };

  let timeline = buildTabTimeline(song, { speed, guide: guideIndex() });
  const gapp = { player: { state: 'stopped', timeSec: 0, eventIndex: -1, beatIndex: -1 }, timeline, tab: { part: partSel, guide: guideIndex() }, synth: { on: true, volume: 0.8, click: false, capo: 0 } };
  window.__gapp = gapp;

  const onNotice = (text) => { if (!song.view.wakeNoticeClosed && panel) panel.showNotice(text); };
  // the synth guitar plays the tab (it takes the place of the recording); the click is optional and off by default
  let synthOn = song.view.synthOn !== false;
  let synthVol = Number.isFinite(song.view.synthVolume) ? Math.min(1, Math.max(0, song.view.synthVolume)) : 0.8;
  let clickOn = song.view.tabClick === true;
  const player = createPlayer({ timeline, timeSignature: song.timeSignature, onFrame: (info) => onFrame(info), onState: (st) => onState(st), onNotice, synth: { create: createSynthEngine } });
  player.setMetronome(clickOn);
  player.setSynth(synthOn);
  player.setSynthVolume(synthVol);
  const synthParts = () => {
    if (partSel !== 'all') return [partSel];
    const sel = Array.isArray(song.view.synthParts) ? song.view.synthParts : [];
    const on = tab.parts.map((_, i) => i).filter((i) => sel.length === 0 || sel.includes(i));
    return on.length ? on : [guideIndex()];
  };
  let notePlan = [];

  function rebuildTimeline() {
    timeline = buildTabTimeline(song, { speed, guide: guideIndex() });
    notePlan = buildNotePlan(song, timeline, { guide: guideIndex(), parts: synthParts() });
    player.setNotePlan(notePlan);
    player.setTimeline(timeline);
    gapp.timeline = timeline;
    gapp.plan = notePlan;
    gapp.synth = { on: synthOn, volume: synthVol, click: clickOn, capo: song.capo || 0 };
    gapp.tab.part = partSel;
    gapp.tab.guide = guideIndex();
    lastFrameKey = '';
    lastCursor = '';
    if (player.getState() === 'stopped') idlePanel();
  }

  // ---- voices (chord diagrams as written in the tab) ----
  function diagramPartIndex() {
    if (partSel === 'all') return null;
    if (tabPartHasChords(tab.parts[partSel])) return partSel;
    // a part without chord names (a riff) shows the diagrams of the first part that has them
    const first = tab.parts.findIndex((p) => tabPartHasChords(p));
    return first >= 0 ? first : partSel;
  }
  const voiceKeyOf = (c) => c.name + '|' + (c.shape ? c.shape.frets.join('.') : '');
  let voices = [];
  const shapeOfVoice = (v) => v.shape || getChordShapes(v.name)[0] || null;
  function voiceByName(name) {
    return voices.find((v) => v.name === name) || tabChordVoices(song).find((v) => v.name === name) || { name, shape: null };
  }
  function smallDiagram(label) {
    const shape = shapeOfVoice(voiceByName(label));
    return shape ? renderDiagramSvg(shape, { size: 30 }) : '';
  }
  const colorOf = (name) => `var(--c${Math.max(0, song.chords.indexOf(name)) % 10})`;

  function openVoiceSheet(v) {
    const shape = shapeOfVoice(v);
    const close = () => { sheet.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const dgBox = domEl('div', { class: 'sheet-dg', style: { '--cc': colorOf(v.name) } });
    if (shape) dgBox.innerHTML = renderDiagramSvg(shape, { size: 200 });
    const card = domEl('div', { class: 'sheet-card' },
      domEl('div', { class: 'sheet-name', style: { '--cc': colorOf(v.name) } }, v.name),
      shape ? dgBox : domEl('p', null, 'Diagramma non disponibile'),
      domEl('p', { class: 'tb-voice-note' }, v.shape ? `Come è scritto nella tab${v.shape.baseFret > 1 ? ' (dal tasto ' + v.shape.baseFret + ')' : ''}` : 'Forma del dizionario: la tab non dà una voce chiara'),
      domEl('button', { type: 'button', class: 'btn primary', onclick: close }, 'Chiudi'));
    const sheet = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Accordo ' + v.name, onclick: (e) => { if (e.target === sheet) close(); } }, card);
    document.addEventListener('keydown', onKey);
    document.body.append(sheet);
    card.querySelector('button').focus();
  }

  // ---- diagrams: side column / row ----
  const dgHolder = domEl('div', { class: 'dg-holder' });
  const sideHolder = domEl('aside', { class: 'side-holder' });
  let sideCol = null;
  function buildDiagrams() {
    domClear(dgHolder);
    domClear(sideHolder);
    sideCol = null;
    voiceBtns = new Map();
    sideCur = sideNext = null;
    const dp = diagramPartIndex();
    voices = tabChordVoices(song, dp);
    if (dgMode === 'none') return;
    const col = domEl('div', { class: dgMode === 'side' ? 'dg-col' : 'dg-row', id: dgMode === 'side' ? 'dg-col' : 'dg-row', 'aria-label': 'Accordi della tab' });
    voices.forEach((v) => {
      const shape = shapeOfVoice(v);
      const btn = domEl('button', {
        type: 'button',
        class: (dgMode === 'side' ? 'dg-btn dg-side-btn' : 'dg-btn') + (shape ? '' : ' none') + (v.shape ? ' from-tab' : ''),
        'data-chord': v.name,
        'data-orig': v.name,
        'data-key': v.key,
        'aria-label': 'Accordo ' + v.name + (v.shape ? ' come nella tab' : ''),
        style: { '--cc': colorOf(v.name) },
        onclick: () => openVoiceSheet(v),
      });
      if (dgMode === 'side') {
        const holder = domEl('span', { class: 'dg-svg' });
        if (shape) holder.innerHTML = renderDiagramSvg(shape, { size: 64 });
        btn.append(holder, domEl('span', { class: 'dg-name' }, v.name));
      } else if (shape) btn.innerHTML = renderDiagramSvg(shape, { size: 64, label: v.name });
      else btn.append(domEl('span', { class: 'dg-name' }, v.name), domEl('span', { class: 'dg-na' }, 'diagramma non disponibile'));
      voiceBtns.set(v.key, btn);
      col.append(btn);
    });
    if (dgMode === 'side') { sideCol = col; sideHolder.append(col); } else dgHolder.append(col);
    paintSideChords();
  }
  function paintSideChords() {
    const c = sideNames.cur ? voiceBtns.get(sideNames.cur) || null : null;
    const n = sideNames.next ? voiceBtns.get(sideNames.next) || null : null;
    if (sideCur && sideCur !== c) sideCur.classList.remove('cur');
    if (sideNext && sideNext !== n) sideNext.classList.remove('next');
    sideCur = c;
    sideNext = n && n !== c ? n : null;
    if (sideCur) sideCur.classList.add('cur');
    if (sideNext) sideNext.classList.add('next');
    const target = sideCur || sideNext;
    if (target && sideCol) {
      const top = target.offsetTop;
      const h = target.offsetHeight;
      const view = sideCol.clientHeight;
      if (top < sideCol.scrollTop + 6 || top + h > sideCol.scrollTop + view - 6) sideCol.scrollTo({ top: Math.max(0, top - Math.max(6, (view - h) / 3)), behavior: 'smooth' });
    }
  }

  // ---- the tab ----
  const bodyHolder = domEl('div', { class: 'body-holder tb-body' });
  const probe = domEl('span', { class: 'tb-probe', 'aria-hidden': 'true' }, 'MMMMMMMMMMMMMMMMMMMM');
  const visibleParts = () => (partSel === 'all' ? tab.parts.map((_, i) => i) : [partSel]);

  function buildBody() {
    domClear(bodyHolder);
    layouts = new Map();
    segEls = new Map();
    curKey = nextKey = null;
    lastCursor = '';
    const guide = guideIndex();
    const multi = visibleParts().length > 1;
    const containers = [];
    for (const pi of visibleParts()) {
      const part = tab.parts[pi];
      const wrap = domEl('div', { class: 'tb-part', 'data-part': pi });
      if (multi) wrap.append(domEl('h2', { class: 'tb-part-title' }, part.label || part.name));
      part.sections.forEach((sec, si) => {
        const box = domEl('div', { class: 'tb-lines' });
        const head = domEl('div', { class: 'sec-head', 'data-sec': si },
          domEl('span', { class: 'sec-title' }, tabSectionTitle(sec, si)),
          pi === guide ? domEl('button', { type: 'button', class: 'btn small sec-bpm', 'data-sec': si, onclick: () => openBpmEditor(sec, head) }, `♩ = ${formatBpm(tabSectionBpm(song, sec))}`) : null,
          pi === guide ? domEl('button', { type: 'button', class: 'btn small tb-loop', 'data-sec': si, onclick: () => startLoop(si) }, 'Loop') : null);
        const card = domEl('section', { class: 'sec tb-sec', 'data-part': pi, 'data-sec': si }, head, box);
        wrap.append(card);
        containers.push({ pi, si, box });
      });
      bodyHolder.append(wrap);
    }
    // measure the width of a character and of the container, then fill the lines
    const first = containers[0];
    if (!first) {
      bodyHolder.append(domEl('p', { class: 'no-results' }, 'Nessuna battuta riconosciuta in questa tab.'));
      return;
    }
    first.box.append(probe);
    chw = probe.getBoundingClientRect().width / probe.textContent.length || 6.6;
    const w = first.box.clientWidth;
    probe.remove();
    widthChars = Math.max(10, Math.floor(w / chw) - 0);
    for (const { pi, si, box } of containers) fillSection(pi, si, box);
    box0Style();
    paintLoopUi();
    refreshHighlight();
  }
  function box0Style() { bodyHolder.style.setProperty('--chw', chw + 'px'); }

  function fillSection(pi, si, box) {
    const sec = tab.parts[pi].sections[si];
    const labels = tab.tuning && tab.tuning.notes ? tabRowLabels(sec.measures[0].rows.length, tab.tuning.notes) : null;
    const lines = layoutTabMeasures(sec.measures, widthChars, { labels });
    const lineEls = [];
    lines.forEach((ln, li) => {
      const lineEl = domEl('div', { class: 'tb-line', 'data-line': li });
      const chordRow = domEl('div', { class: 'tb-chords' });
      for (const c of ln.chords) {
        const meas = sec.measures[c.m];
        const chord = meas.chords[c.index];
        chordRow.append(domEl('button', {
          type: 'button',
          class: 'tb-chord',
          'data-chord': c.name,
          'data-x': c.x,
          style: { left: `calc(var(--chw) * ${c.x})`, '--cc': colorOf(c.name) },
          onclick: () => openVoiceSheet({ name: c.name, shape: chord.shape, key: voiceKeyOf(chord) }),
        }, c.name));
      }
      lineEl.append(chordRow);
      const rows = domEl('div', { class: 'tb-rows' });
      ln.rows.forEach((r) => rows.append(domEl('div', { class: 'tb-row' }, r)));
      lineEl.append(rows);
      for (const sg of ln.segs) {
        const key = `${pi}.${si}.${sg.m}`;
        const hl = domEl('div', {
          class: 'tb-hl',
          'data-measure': sg.m,
          style: { left: `calc(var(--chw) * ${sg.x0})`, width: `calc(var(--chw) * ${sg.to - sg.from + (sg.last ? 1 : 0)})` },
          onclick: () => seekToMeasure(pi, si, sg.m),
        });
        lineEl.append(hl);
        if (!segEls.has(key)) segEls.set(key, []);
        segEls.get(key).push({ hl, lineEl, line: li });
      }
      box.append(lineEl);
      lineEls.push(lineEl);
    });
    layouts.set(`${pi}.${si}`, { lines, lineEls });
  }

  function seekToMeasure(pi, si, mi) {
    const st = player.getState();
    if (pi !== guideIndex() || (st !== 'playing' && st !== 'counting' && st !== 'paused')) return;
    const i = timeline.events.findIndex((e) => e.sectionRef === si && e.measureIndex === mi);
    if (i >= 0) player.playFromEvent(i);
  }

  // ---- cursor and highlight ----
  const cursorEl = domEl('div', { class: 'tb-cursor', 'aria-hidden': 'true' });
  function refreshHighlight() {
    // the elements were rebuilt: put the current/next marks back
    const k1 = curKey;
    const k2 = nextKey;
    curKey = nextKey = null;
    markMeasure(k1, k2);
    lastCursor = '';
  }
  function markMeasure(cur, next) {
    if (curKey && curKey !== cur) for (const s of segEls.get(curKey) || []) s.hl.classList.remove('cur');
    if (nextKey && nextKey !== next) for (const s of segEls.get(nextKey) || []) s.hl.classList.remove('next');
    curKey = cur;
    nextKey = next;
    for (const s of segEls.get(cur) || []) s.hl.classList.add('cur');
    for (const s of segEls.get(next) || []) if (next !== cur) s.hl.classList.add('next');
  }
  const keyOfEvent = (e) => (e ? `${guideIndex()}.${e.sectionRef}.${e.measureIndex}` : null);
  function placeCursor(ev, x) {
    const lay = layouts.get(`${guideIndex()}.${ev.sectionRef}`);
    if (!lay) return null;
    const place = tabCursorPlace(lay.lines, ev.measureIndex, x);
    if (!place) { cursorEl.remove(); return null; }
    const lineEl = lay.lineEls[place.line];
    if (cursorEl.parentNode !== lineEl) lineEl.append(cursorEl);
    cursorEl.style.left = `calc(var(--chw) * ${place.col})`;
    cursorEl.hidden = false;
    return lineEl;
  }
  function hideCursor() { cursorEl.remove(); lastCursor = ''; }

  // the sheet follows the cursor; a touch or a scroll of the user pauses it for a few seconds, then it comes back to the line
  let wantScroll = null;
  function autoScroll(el) {
    wantScroll = el;
    flushScroll();
  }
  function flushScroll() {
    if (!wantScroll || Date.now() < manualScrollUntil) return;
    const el = wantScroll;
    wantScroll = null;
    if (!el.isConnected) return;
    const panelH = panel.el.getBoundingClientRect().height;
    const target = el.getBoundingClientRect().top + window.scrollY - 0.25 * (window.innerHeight - panelH);
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
  const noteManualScroll = () => { manualScrollUntil = Date.now() + TB_SCROLL_PAUSE_MS; };
  for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) window.addEventListener(ev, noteManualScroll, { passive: true });

  const measureOf = (e) => tab.parts[guideIndex()].sections[e.sectionRef].measures[e.measureIndex];
  const firstChordName = (e) => {
    if (!e) return '';
    const m = measureOf(e);
    return m.chords.length ? m.chords[0].name : `Batt. ${e.measureIndex + 1}`;
  };

  function onFrame(info) {
    gapp.player.state = info.state;
    gapp.player.timeSec = info.timeSec;
    gapp.player.eventIndex = info.eventIndex;
    gapp.player.beatIndex = info.beatIndex;
    if (!panel) return;
    panel.setTime(Math.max(0, info.timeSec), timeline.totalSec);
    flushScroll();
    const counting = info.state === 'counting';
    const eventIndex = counting ? -1 : info.eventIndex;
    const ev = eventIndex >= 0 ? timeline.events[eventIndex] : null;
    const startEv = counting ? timeline.events[info.startEvent] : null;
    const nextEvent = counting ? startEv : timeline.events[eventIndex + 1] || null;
    let progress = 0;
    let col = -1;
    let chordNow = null;
    if (ev) {
      progress = Math.min(1, Math.max(0, (info.timeSec - ev.startSec) / ev.durSec));
      const m = measureOf(ev);
      col = tabColumnAt(m, progress);
      chordNow = tabChordAt(m, progress);
    }
    const key = `${info.state}|${eventIndex}|${info.beatIndex}|${info.countdown}|${chordNow ? chordNow.name : ''}`;
    if (key !== lastFrameKey) {
      lastFrameKey = key;
      markMeasure(counting ? null : keyOfEvent(ev), keyOfEvent(nextEvent));
      const beat = info.beatIndex >= 0 ? timeline.beats[info.beatIndex] : null;
      const secIdx = (ev || startEv || timeline.events[0] || { sectionIndex: 0 }).sectionIndex;
      const tsec = timeline.sections[secIdx];
      const label = ev ? (chordNow ? chordNow.name : `Batt. ${ev.measureIndex + 1}`) : undefined;
      panel.update({
        state: info.state,
        countdown: info.countdown,
        event: ev ? { ...ev, name: chordNow ? chordNow.name : ev.name } : null,
        nextEvent,
        beatsLeft: ev && beat ? Math.max(0, ev.startBeat + ev.beats - beat.index) : 0,
        gap: null,
        curLabel: label,
        nextLabel: nextEvent ? firstChordName(nextEvent) : undefined,
        beatInBar: counting ? (song.timeSignature[0] || 4) - info.countdown : beat ? beat.beatInBar : -1,
        bpm: tsec ? tsec.bpm : 100,
        savedBpm: tsec ? tsec.savedBpm : undefined,
        strum: null,
        strumId: null,
        strumCell: -1,
        free: false,
      });
      const guideHasChords = tabPartHasChords(tab.parts[guideIndex()]);
      const dp = diagramPartIndex();
      const sameSet = dp === null || dp === guideIndex();
      const keyOf = (c) => (c ? voiceKeyOf(c) : null);
      sideNames = {
        cur: !counting && chordNow && guideHasChords && sameSet ? keyOf(chordNow) : null,
        next: nextEvent && guideHasChords && sameSet ? keyOf(tabChordAt(measureOf(nextEvent), 0)) : null,
      };
      paintSideChords();
    }
    if (ev) {
      const cursorKey = `${eventIndex}|${col}`;
      if (cursorKey !== lastCursor) {
        const moved = !lastCursor || lastCursor.split('|')[0] !== String(eventIndex);
        lastCursor = cursorKey;
        const m = measureOf(ev);
        const x = col >= 0 ? m.columns[col].x : 0;
        const lineEl = placeCursor(ev, x);
        if (lineEl && moved) autoScroll(lineEl);
      }
      panel.setProgress(progress);
    } else if (counting) {
      hideCursor();
      const el = nextEvent ? (segEls.get(keyOfEvent(nextEvent)) || [])[0] : null;
      if (el && countScrolled !== info.startEvent) { countScrolled = info.startEvent; autoScroll(el.lineEl); }
    }
  }

  function onState(st) {
    if (panel) panel.setPlayLabel(st);
    screen.classList.toggle('is-playing', st === 'counting' || st === 'playing');
    if (typeof syncPad === 'function' && panel) syncPad();
    if (st === 'counting' || st === 'playing') { lastFrameKey = ''; lastCursor = ''; }
    if (st !== 'counting') countScrolled = -1;
    if (st === 'stopped') {
      markMeasure(null, null);
      hideCursor();
      lastFrameKey = '';
      sideNames = { cur: null, next: null };
      paintSideChords();
      idlePanel();
      if (panel) panel.setProgress(0);
    }
  }

  function idlePanel() {
    if (!panel) return;
    panel.setTime(0, timeline.totalSec);
    const first = timeline.events[0] || null;
    panel.update({
      state: 'stopped', countdown: 0, event: null, nextEvent: first, nextLabel: first ? firstChordName(first) : undefined, beatsLeft: 0, beatInBar: -1,
      bpm: timeline.sections[0] ? timeline.sections[0].bpm : tab.bpm, savedBpm: timeline.sections[0] ? timeline.sections[0].savedBpm : undefined, strum: null, strumId: null, strumCell: -1, free: false,
    });
  }

  // ---- tempo ----
  const bpmScope = () => (song.view.bpmScope === 'section' ? 'section' : 'all');
  function currentSectionRef() {
    const info = player.getInfo();
    const i = info.state === 'counting' ? info.startEvent : info.eventIndex;
    const ev = timeline.events[i >= 0 ? i : 0];
    return ev ? ev.sectionRef : 0;
  }
  function refreshBpmButtons() {
    const g = tab.parts[guideIndex()];
    for (const b of bodyHolder.querySelectorAll('.sec-bpm')) b.textContent = `♩ = ${formatBpm(tabSectionBpm(song, g.sections[Number(b.getAttribute('data-sec'))]))}`;
  }
  function setBpm(v, scope, secIndex) {
    const g = tab.parts[guideIndex()];
    if (scope === 'section') g.sections[secIndex].bpm = v;
    else {
      tab.bpm = v;
      for (const p of tab.parts) for (const s of p.sections) s.bpm = null;
    }
    persist();
    rebuildTimeline();
    refreshBpmButtons();
  }
  function stepBpm(dir) {
    const g = tab.parts[guideIndex()];
    const si = currentSectionRef();
    const cur = tabSectionBpm(song, g.sections[si]);
    const v = Math.min(TAB_BPM_MAX, Math.max(TAB_BPM_MIN, Math.round(cur) + dir));
    setBpm(v, bpmScope(), si);
  }
  function openBpmEditor(sec, head) {
    const open = head.parentElement.querySelector('.bpm-edit');
    if (open) { open.remove(); return; }
    const si = Number(head.getAttribute('data-sec'));
    const input = domEl('input', { type: 'number', inputmode: 'decimal', min: String(TAB_BPM_MIN), max: String(TAB_BPM_MAX), step: '1', class: 'bpm-field', 'aria-label': 'BPM della sezione', value: String(tabSectionBpm(song, sec)) });
    const apply = (scope) => {
      const v = parseFloat(String(input.value).replace(',', '.'));
      if (!(v >= TAB_BPM_MIN && v <= TAB_BPM_MAX)) { showError(`Inserisci un BPM tra ${TAB_BPM_MIN} e ${TAB_BPM_MAX}`); return; }
      showNote('');
      setBpm(v, scope, si);
      box.remove();
    };
    const box = domEl('div', { class: 'bpm-edit' },
      domEl('label', null, 'BPM', input),
      domEl('button', { type: 'button', class: 'btn primary small', onclick: () => apply('section') }, 'Applica a questa sezione'),
      domEl('button', { type: 'button', class: 'btn small apply-all', onclick: () => apply('all') }, 'Applica a tutto il brano'),
      domEl('button', { type: 'button', class: 'btn small', onclick: () => box.remove() }, 'Annulla'));
    head.after(box);
    input.focus();
  }

  // ---- loop ----
  function startLoop(si) {
    const k = timeline.sections.findIndex((s) => s.sectionRef === si);
    if (k < 0) { showNote('Questa sezione non è nell’ordine di riproduzione: aggiungila da «Ordine delle sezioni»'); return; }
    const st = player.getState();
    player.setLoop(k);
    if (st === 'stopped' || st === 'paused') player.playFromTime(timeline.sections[k].startSec);
    paintLoopUi();
  }
  function paintLoopUi() {
    const k = player.getLoop();
    for (const el of bodyHolder.querySelectorAll('.looping')) el.classList.remove('looping');
    for (const el of bodyHolder.querySelectorAll('.loop-x')) el.remove();
    const s = k === null || k === undefined ? null : timeline.sections[k];
    if (panel) panel.setLoop(s ? s.name : null);
    if (!s) return;
    const head = bodyHolder.querySelector(`.tb-sec[data-part="${guideIndex()}"] .sec-head[data-sec="${s.sectionRef}"]`);
    if (!head) return;
    head.parentElement.classList.add('looping');
    head.append(domEl('button', { type: 'button', class: 'btn small loop-x', 'aria-label': 'Esci dal loop', onclick: () => { player.setLoop(null); paintLoopUi(); } }, '× Loop'));
  }

  // ---- play panel ----
  panel = createPlayPanel(song, {
    diagramSvg: smallDiagram,
    onLoopExit: () => { player.setLoop(null); paintLoopUi(); },
    onPlayPause: () => {
      const st = player.getState();
      if (st === 'playing' || st === 'counting') player.pause();
      else player.play();
    },
    onStop: () => { player.setLoop(null); paintLoopUi(); player.stop(); },
    onSpeed: (v) => {
      speed = v;
      song.view.speedPct = Math.round(v * 100);
      persist();
      rebuildTimeline();
    },
    onMetronome: (on) => { clickOn = on; player.setMetronome(on); song.view.tabClick = on; persist(); gapp.synth.click = on; },
    synthOn,
    onSynth: (on) => setSynth(on),
    synthVolume: synthVol,
    onSynthVolume: (v) => setVolume(v),
    onTap: () => {},
    bpmScope: bpmScope(),
    onBpmStep: (dir) => stepBpm(dir),
    onBpmSet: (v) => {
      if (!(v >= TAB_BPM_MIN && v <= TAB_BPM_MAX)) { showError(`Inserisci un BPM tra ${TAB_BPM_MIN} e ${TAB_BPM_MAX}`); return false; }
      showNote('');
      setBpm(v, bpmScope(), currentSectionRef());
      return true;
    },
    onScope: (scope) => { song.view.bpmScope = scope; persist(); },
    speedPct: Math.round(speed * 100),
    autoCollapse: barAuto,
    metronomeOn: clickOn,
    diagramsOn: typeof song.view.panelDiagrams === 'boolean' ? song.view.panelDiagrams : window.innerHeight >= TB_LOW_SCREEN_PX,
    onDiagrams: (on) => { song.view.panelDiagrams = on; persist(); },
    rhythmOn: false,
    onRhythm: () => {},
    onNoticeClosed: () => { song.view.wakeNoticeClosed = true; persist(); },
  });

  // ---- part selector, legend, arrangement, settings ----
  const partRow = domEl('div', { class: 'tb-parts', role: 'group', 'aria-label': 'Parte da seguire' });
  function buildPartRow() {
    domClear(partRow);
    if (partCount < 2) return;
    const opts = [...tab.parts.map((p, i) => ({ v: i, label: p.label || p.name })), { v: 'all', label: 'Tutte' }];
    for (const o of opts) {
      partRow.append(domEl('button', {
        type: 'button', class: 'btn tb-part-opt', id: 'btn-part-' + o.v, 'data-part': String(o.v), 'aria-pressed': String(partSel === o.v),
        onclick: () => setPart(o.v),
      }, o.label));
    }
  }
  function setPart(v) {
    if (partSel === v) return;
    player.stop();
    player.setLoop(null);
    partSel = v;
    song.view.tabPart = v;
    if (v !== 'all') tab.guide = v;
    persist();
    buildPartRow();
    buildDiagrams();
    buildBody();
    buildArrangement();
    rebuildTimeline();
    paintLoopUi();
  }

  const legendText = domEl('p', { class: 'tb-legend-text', id: 'tb-legend-text', role: 'status' }, '');
  const legendRow = domEl('div', { class: 'tb-legend', id: 'tb-legend' });
  function buildLegend() {
    domClear(legendRow);
    const used = tabTechniquesUsed(song);
    if (!used.length) { legendRow.hidden = true; legendText.hidden = true; return; }
    legendRow.append(domEl('span', { class: 'tb-legend-lbl' }, 'Simboli'));
    for (const k of used) {
      legendRow.append(domEl('button', {
        type: 'button', class: 'btn small tb-sym', 'data-sym': k, 'aria-label': `${k}: ${TAB_TECHNIQUES[k]}`,
        onclick: () => { legendText.textContent = `${k} = ${TAB_TECHNIQUES[k]}`; },
      }, k));
    }
    legendRow.title = 'Tocca un simbolo per sapere cosa vuol dire';
  }

  const arrHolder = domEl('div', { class: 'tb-arr-holder' });
  function buildArrangement() {
    domClear(arrHolder);
    const gi = guideIndex();
    const part = tab.parts[gi];
    if (!part) return;
    const arr = tabArrangement(song, gi);
    const apply = (next) => {
      player.stop();
      player.setLoop(null);
      tab.arrangement[gi] = next;
      persist();
      rebuildTimeline();
      buildArrangement();
      paintLoopUi();
    };
    const rows = arr.map((si, i) => domEl('li', { class: 'tb-arr-row', 'data-i': i },
      domEl('span', { class: 'tb-arr-n' }, String(i + 1)),
      domEl('span', { class: 'tb-arr-name' }, tabSectionTitle(part.sections[si], si)),
      domEl('button', { type: 'button', class: 'btn icon tb-arr-up', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => apply(arrangementMove(arr, i, -1)) }, '↑'),
      domEl('button', { type: 'button', class: 'btn icon tb-arr-down', 'aria-label': 'Sposta giù', disabled: i === arr.length - 1, onclick: () => apply(arrangementMove(arr, i, 1)) }, '↓'),
      domEl('button', { type: 'button', class: 'btn icon tb-arr-rep', 'aria-label': 'Ripeti questa sezione', onclick: () => apply(arrangementRepeat(arr, i)) }, '⧉'),
      domEl('button', { type: 'button', class: 'btn icon tb-arr-del', 'aria-label': 'Togli questa sezione', onclick: () => apply(arrangementRemove(arr, i)) }, '✕')));
    const select = domEl('select', { id: 'tb-arr-add', 'aria-label': 'Sezione da aggiungere' }, part.sections.map((s, si) => domEl('option', { value: String(si) }, tabSectionTitle(s, si))));
    const details = domEl('div', { class: 'tb-arr', id: 'tb-arr' },
      domEl('h3', { class: 'tb-sub' }, `Ordine delle sezioni (${arr.length})`),
      domEl('p', { class: 'tb-arr-hint' }, 'È l’ordine in cui suona il metronomo. Per ora lo scrivi tu; dall’mp3 verrà proposto dal motore.'),
      domEl('ol', { class: 'tb-arr-list' }, rows),
      domEl('div', { class: 'set-row' },
        select,
        domEl('button', { type: 'button', class: 'btn', id: 'tb-arr-add-btn', onclick: () => apply(arrangementAdd(arr, Number(select.value))) }, 'Aggiungi'),
        domEl('button', { type: 'button', class: 'btn', id: 'tb-arr-reset', onclick: () => apply(tabDefaultArrangement(song, gi)) }, 'Ordine della tab')));
    arrHolder.append(details);
  }

  const settingsHolder = domEl('div', { class: 'settings-holder' });
  function buildSettings() {
    domClear(settingsHolder);
    const synthBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-synth', 'aria-pressed': String(synthOn), onclick: () => setSynth(!synthOn) }, synthOn ? 'Chitarra synth: sì' : 'Chitarra synth: no');
    const vol = domEl('input', { type: 'range', id: 'synth-vol', class: 'pp-vol', min: '0', max: '100', step: '1', value: String(Math.round(synthVol * 100)), 'aria-label': 'Volume della chitarra', oninput: () => setVolume(Number(vol.value) / 100) });
    const clickBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-synth-click', 'aria-pressed': String(clickOn), onclick: () => { clickOn = !clickOn; player.setMetronome(clickOn); song.view.tabClick = clickOn; persist(); panel.setMetronomeState(clickOn); gapp.synth.click = clickOn; buildSettings(); } }, clickOn ? 'Con il metronomo' : 'Solo chitarra');
    const partChecks = partSel === 'all' && partCount > 1 ? domEl('div', { class: 'set-row' }, domEl('span', null, 'Suona'), tab.parts.map((p, i) => domEl('label', { class: 'tb-chk' }, domEl('input', {
      type: 'checkbox', class: 'synth-part', 'data-part': String(i), checked: synthParts().includes(i),
      onchange: (e) => {
        const cur = new Set(synthParts());
        if (e.target.checked) cur.add(i); else cur.delete(i);
        song.view.synthParts = [...cur].sort();
        persist();
        rebuildTimeline();
        buildSettings();
      },
    }), ' ' + (p.label || p.name)))) : null;
    settingsHolder.append(domEl('div', { class: 'tb-settings' },
      domEl('h3', { class: 'tb-sub' }, 'Suono'),
      domEl('div', { class: 'tb-synth-row' }, synthBtn, domEl('label', { class: 'pp-vol-lbl' }, 'Volume', vol), clickBtn),
      partChecks,
      domEl('h3', { class: 'tb-sub' }, 'Impostazioni'),
      domEl('div', { class: 'set-row' },
        domEl('span', null, 'Diagrammi'),
        domEl('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Posizione dei diagrammi' },
          [['side', 'Di lato'], ['top', 'In cima'], ['none', 'Nascosti']].map(([m, label]) => domEl('button', {
            type: 'button', class: 'btn dg-mode-opt', 'data-dgmode': m, 'aria-pressed': String(dgMode === m),
            onclick: () => { dgMode = m; setDevPref('diagramMode', m); buildSettings(); applyDgMode(); },
          }, label)))),
      domEl('div', { class: 'set-row' },
        domEl('span', null, 'Barra in basso'),
        domEl('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Barra in basso' },
          [[true, 'Si riduce da sola'], [false, 'Sempre aperta']].map(([v, label]) => domEl('button', {
            type: 'button', class: 'btn bar-auto-opt', 'data-barauto': String(v), 'aria-pressed': String(barAuto === v),
            onclick: () => { barAuto = v; setDevPref('barAutoCollapse', v); buildSettings(); panel.setAutoCollapse(v); },
          }, label)))),
      domEl('div', { class: 'set-row' },
        domEl('span', null, 'Tono'),
        domEl('span', { class: 'tb-note' }, 'La tab scrive i tasti da premere: non si trasporta. Il capotasto è solo un’informazione.'))));
  }
  function setSynth(on) {
    synthOn = !!on;
    song.view.synthOn = synthOn;
    persist();
    player.setSynth(synthOn);
    panel.setSynthState(synthOn);
    gapp.synth.on = synthOn;
    buildSettings();
  }
  function setVolume(v) {
    synthVol = Math.min(1, Math.max(0, v));
    song.view.synthVolume = synthVol;
    player.setSynthVolume(synthVol);
    gapp.synth.volume = synthVol;
    persist();
  }
  function applyDgMode() {
    screen.dataset.dg = dgMode;
    buildDiagrams();
    relayout();
    syncPad();
  }

  // ---- chrome ----
  const themeBtn = domEl('button', {
    type: 'button', class: 'btn theme-btn', id: 'btn-theme',
    onclick: () => {
      song.view.theme = song.view.theme === 'dark' ? 'light' : 'dark';
      applyTheme(song.view.theme);
      paintTheme();
      persist();
    },
  });
  function paintTheme() {
    const toLight = song.view.theme === 'dark';
    themeBtn.innerHTML = (toLight ? TB_SUN_ICON : TB_MOON_ICON) + `<span>${toLight ? 'Chiaro' : 'Scuro'}</span>`;
    themeBtn.setAttribute('aria-label', toLight ? 'Passa al tema chiaro' : 'Passa al tema scuro');
  }
  const setScale = (v) => {
    song.view.fontScale = tbClampFont(v);
    screen.style.setProperty('--fs', String(song.view.fontScale));
    persist();
    relayout();
  };
  const topbar = domEl('div', { class: 'topbar' },
    domEl('button', { type: 'button', class: 'btn', id: 'btn-back', onclick: onBack }, '‹ Libreria'),
    domEl('span', { class: 'spacer' }),
    domEl('button', { type: 'button', class: 'btn icon', id: 'btn-font-down', 'aria-label': 'Testo più piccolo', onclick: () => setScale(song.view.fontScale - 0.1) }, 'A−'),
    domEl('button', { type: 'button', class: 'btn icon', id: 'btn-font-up', 'aria-label': 'Testo più grande', onclick: () => setScale(song.view.fontScale + 0.1) }, 'A+'),
    themeBtn);

  // ---- capo: read from the page, editable here; the frets of a tab are written relative to it ----
  const metaText = domEl('span', { id: 'tb-meta-text' }, '');
  const capoBtn = domEl('button', { type: 'button', class: 'btn small', id: 'btn-capo', onclick: () => openCapo() });
  const meta = domEl('div', { class: 'tb-meta', id: 'tb-meta' }, metaText, capoBtn);
  function paintMeta() {
    metaText.textContent = `Accordatura: ${tab.tuning && tab.tuning.name ? tab.tuning.name : 'Standard'} · ${tabMeasureCount(song)} battute`;
    capoBtn.textContent = song.capo ? `Capo ${song.capo}° tasto` : 'Capotasto: nessuno';
    capoBtn.setAttribute('aria-label', song.capo ? `Capotasto al ${song.capo}° tasto: tocca per cambiarlo` : 'Nessun capotasto: tocca per impostarlo');
  }
  function openCapo() {
    const close = () => { sheet.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const sel = domEl('select', {
      id: 'capo-free', 'aria-label': 'Capotasto, tasto da 0 a 12',
      onchange: () => {
        const v = Number(sel.value);
        song.capo = v;
        tab.capo = v;
        persist();
        paintMeta();
        player.stop();
        rebuildTimeline();
        close();
      },
    }, Array.from({ length: 13 }, (_, i) => domEl('option', { value: String(i), selected: i === (song.capo || 0) }, i === 0 ? '0 (nessuno)' : String(i))));
    const card = domEl('div', { class: 'sheet-card dlg' },
      domEl('h2', { class: 'dlg-title' }, 'Capotasto'),
      domEl('p', { class: 'tb-note' }, 'I numeri della tab sono i tasti contati dal capotasto: con il capo al 2° tasto un 0 scritto suona due semitoni sopra la corda vuota. I diagrammi restano relativi al capo, come la tab.'),
      domEl('label', { class: 'capo-free' }, 'Tasto: ', sel),
      domEl('button', { type: 'button', class: 'btn primary', id: 'capo-close', onclick: close }, 'Chiudi'));
    const sheet = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Capotasto', onclick: (e) => { if (e.target === sheet) close(); } }, card);
    document.addEventListener('keydown', onKey);
    document.body.append(sheet);
    sel.focus();
  }
  paintMeta();
  const warnings = song.importInfo && song.importInfo.warnings && song.importInfo.warnings.length
    ? domEl('details', { class: 'warnings' },
      domEl('summary', null, `Avvisi di importazione (${song.importInfo.warnings.length})`),
      domEl('ul', null, song.importInfo.warnings.map((w) => domEl('li', null, w))))
    : null;

  const bottom = domEl('div', { class: 'bottombar' }, panel.el);
  const screen = domEl('div', { class: 'screen song tab', 'data-dg': dgMode, style: { '--fs': String(song.view.fontScale) } },
    topbar,
    domEl('header', { class: 'song-head' },
      domEl('h1', { id: 'song-title' }, song.title),
      song.artist ? domEl('p', { class: 'artist', id: 'song-artist' }, song.artist) : null,
      meta,
      partRow,
      dgHolder,
      domEl('details', { class: 'settings tb-tools', id: 'tb-tools' },
        domEl('summary', null, 'Ordine, simboli e impostazioni'),
        arrHolder,
        domEl('h3', { class: 'tb-sub' }, 'Simboli della tab'),
        legendRow,
        legendText,
        settingsHolder)),
    notice,
    domEl('div', { class: 'song-main' }, bodyHolder, sideHolder),
    warnings,
    domEl('footer', { class: 'song-foot' },
      domEl('button', {
        type: 'button', class: 'btn danger', id: 'btn-delete',
        onclick: () => {
          if (!window.confirm(`Eliminare «${song.title}» dalla libreria?`)) return;
          try { deleteSong(song.id); } catch (err) { showError(err.message); return; }
          onDeleted();
        },
      }, 'Elimina brano')),
    bottom);

  function syncPad() {
    const ph = Math.ceil(panel.el.getBoundingClientRect().height);
    screen.style.setProperty('--pp-h', ph + 'px');
    const playing = screen.classList.contains('is-playing');
    const tb = playing ? 0 : Math.ceil(topbar.getBoundingClientRect().height);
    screen.style.setProperty('--side-top', tb + 'px');
    screen.style.setProperty('--side-h', Math.max(120, window.innerHeight - ph - tb - 8) + 'px');
  }

  // the lines are laid out again when the width of a line (in characters) changes
  let relayoutTimer = null;
  function relayout(force = true) {
    if (relayoutTimer !== null) clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      relayoutTimer = null;
      if (!force) {
        const box = bodyHolder.querySelector('.tb-lines');
        if (box && Math.floor(box.clientWidth / chw) === widthChars) return;
      }
      buildBody();
      rebuildTimeline();
    }, 30);
  }
  let resizeObs = null;
  const onResize = () => { syncPad(); relayout(false); };
  if (typeof ResizeObserver === 'function') {
    resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(panel.el);
    resizeObs.observe(bodyHolder);
  }
  window.addEventListener('resize', onResize);

  applyTheme(song.view.theme);
  paintTheme();
  buildPartRow();
  buildSettings();
  buildLegend();
  buildArrangement();
  buildDiagrams();
  root.append(screen);
  buildBody();
  rebuildTimeline();
  idlePanel();
  panel.setPlayLabel('stopped');
  syncPad();

  tbActive = {
    destroy() {
      player.destroy();
      if (relayoutTimer !== null) clearTimeout(relayoutTimer);
      if (resizeObs) resizeObs.disconnect();
      window.removeEventListener('resize', onResize);
      for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) window.removeEventListener(ev, noteManualScroll);
      if (window.__gapp === gapp) delete window.__gapp;
    },
  };
}
