// Song screen: header, settings, body with chords above lyrics, playback panel, duration editing.

import { domEl, domClear } from './dom.js';
import { renderSongBody, renderChordChip, formatBpm } from '../render.js';
import { saveSong, deleteSong } from '../storage.js';
import { buildTimeline } from '../timeline.js';
import { createPlayer } from '../player.js';
import { createPlayPanel } from './playpanel.js';
import { openRecorder } from './recorder.js';
import { createTapTempo } from '../taprecord.js';
import { effectiveSectionBpms, groupRepeatedSections, setAllChordBeats, sectionSignature, baseSectionName } from '../model.js';

const FONT_MIN = 0.7;
const FONT_MAX = 2.0;
const BPM_MIN = 30;
const BPM_MAX = 300;
const BEATS_MIN = 1;
const BEATS_MAX = 32;
const LONG_PRESS_MS = 500;
const MANUAL_SCROLL_PAUSE_MS = 4000;

let activeScreen = null;

// Stops the player of the song screen that is on display (called by the router).
export function leaveSongScreen() {
  if (activeScreen) activeScreen.destroy();
  activeScreen = null;
}

function clampScale(v) {
  return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, v)) * 10) / 10;
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// Hook for round 3 (chord diagrams): called with (ref, chordName) when a chord is tapped.
function openChordSheet(ref, name) {
  const close = () => {
    sheet.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const sheet = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Accordo ' + name, onclick: (e) => { if (e.target === sheet) close(); } },
    domEl('div', { class: 'sheet-card' },
      domEl('div', { class: 'sheet-name', id: 'sheet-name' }, name),
      domEl('p', { class: 'muted' }, 'Diagramma non ancora disponibile'),
      domEl('button', { type: 'button', class: 'btn primary', onclick: close }, 'Chiudi')));
  document.addEventListener('keydown', onKey);
  document.body.append(sheet);
  sheet.querySelector('button').focus();
}

const SUN_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';

function parseRef(ref) {
  return ref.split('.').map(Number);
}

export function showSongScreen(root, song, { onBack, onDeleted }) {
  leaveSongScreen();
  domClear(root);

  let editMode = false;
  let speed = 1;
  let metronomeOn = true;
  let timeline = buildTimeline(song, { speed });
  let selectedRef = null;
  let evEl = []; // event index -> chord label element (rendered, possibly merged section)
  let groupFirst = [];
  let curEl = null;
  let nextEl = null;
  let curLine = null;
  let curSec = null;
  let lastKey = '';
  let lastEvKey = '';
  let lastProgress = -1;
  let manualScrollUntil = 0;
  const openedDetails = new Set();
  const tapTempo = createTapTempo();

  const notice = domEl('div', { class: 'msg', role: 'alert' });
  const showError = (text) => {
    notice.textContent = text;
    notice.className = 'msg error';
  };
  const showNote = (text) => {
    notice.textContent = text;
    notice.className = 'msg';
  };
  const persist = () => {
    try {
      saveSong(song);
    } catch (err) {
      showError(err.message);
    }
  };

  // ---- window.__gapp: read-only state for tests ----
  const gapp = { player: { state: 'stopped', timeSec: 0, eventIndex: -1, beatIndex: -1 }, timeline };
  window.__gapp = gapp;

  const player = createPlayer({
    timeline,
    timeSignature: song.timeSignature,
    onFrame: (info) => onFrame(info),
    onState: (st) => onState(st),
    onNotice: (text) => showNote(text),
  });

  function rebuildTimeline() {
    timeline = buildTimeline(song, { speed });
    gapp.timeline = timeline;
    player.setTimeline(timeline);
    mapRefs();
  }

  // ---- body ----
  const bodyHolder = domEl('div', { class: 'body-holder' });
  const metaHolder = domEl('div', { class: 'meta-holder' });
  const settingsHolder = domEl('div', { class: 'settings-holder' });

  function mapRefs() {
    const groups = editMode ? null : groupRepeatedSections(song.sections);
    groupFirst = song.sections.map((_, i) => i);
    if (groups) for (const g of groups) for (const i of g.indices) groupFirst[i] = g.indices[0];
    const byRef = new Map();
    for (const el of bodyHolder.querySelectorAll('.ch[data-ref]')) byRef.set(el.getAttribute('data-ref'), el);
    evEl = timeline.events.map((e) => {
      const [s, l, c] = parseRef(e.ref);
      return byRef.get(`${groupFirst[s]}.${l}.${c}`) || null;
    });
    lastKey = '';
    lastEvKey = '';
    curEl = nextEl = curLine = curSec = null;
  }

  function onChordTap(ref, name) {
    if (editMode) {
      selectChord(ref);
      return;
    }
    const st = player.getState();
    if (st === 'playing' || st === 'counting' || st === 'paused') {
      const i = evEl.findIndex((el) => el && el.getAttribute('data-ref') === ref);
      if (i >= 0) player.playFromEvent(i);
      return;
    }
    openChordSheet(ref, name);
  }

  function sectionNameOf(i) {
    return song.sections[i].name;
  }

  function chordsOfSection(si) {
    return song.sections[si].lines.flatMap((l) => l.chords);
  }

  function copyTargets(si) {
    const sig = sectionSignature(song.sections[si]);
    const base = baseSectionName(sectionNameOf(si));
    const out = [];
    song.sections.forEach((s, i) => {
      if (i !== si && baseSectionName(s.name) === base && sectionSignature(s) === sig) out.push(i);
    });
    return out;
  }

  function startRecording(firstEventIndex, eventCount, label) {
    if (eventCount === 0) return;
    player.stop();
    openRecorder({
      song,
      player,
      getTimeline: () => timeline,
      span: { firstEventIndex, eventCount, label },
      onSave: (beats) => {
        const all = song.sections.flatMap((s) => s.lines.flatMap((l) => l.chords));
        beats.forEach((b, k) => { all[firstEventIndex + k].beats = b; });
        song.timingSource = 'recorded';
        persist();
        buildBody();
        rebuildTimeline();
        showNote('Durate registrate salvate');
      },
    });
  }

  function decorateSection(head, info) {
    const si = info.first;
    if (editMode) {
      const tools = domEl('div', { class: 'sec-tools' });
      const targets = copyTargets(si);
      if (targets.length >= 1) {
        tools.append(domEl('button', {
          type: 'button',
          class: 'btn small copy-beats',
          'data-sec': si,
          onclick: () => {
            const src = chordsOfSection(si).map((c) => c.beats);
            for (const t of targets) chordsOfSection(t).forEach((c, k) => { c.beats = src[k]; });
            song.timingSource = 'edited';
            persist();
            buildBody();
            rebuildTimeline();
            showNote(`Durate copiate su ${targets.length} ${targets.length === 1 ? 'sezione' : 'sezioni'}`);
          },
        }, `Copia durate su ${targets.length} ${targets.length === 1 ? 'sezione uguale' : 'sezioni uguali'}`));
      }
      tools.append(domEl('button', {
        type: 'button',
        class: 'btn small rec-sec',
        'data-sec': si,
        onclick: () => {
          const first = timeline.events.findIndex((e) => e.sectionIndex === si);
          const count = timeline.events.filter((e) => e.sectionIndex === si).length;
          startRecording(first, count, sectionNameOf(si) || 'sezione');
        },
      }, 'Registra'));
      head.append(tools);
      return;
    }
    // long press on the header starts a section loop
    let timer = null;
    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        startLoop(si);
      }, LONG_PRESS_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) head.addEventListener(ev, cancel);
    head.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function startLoop(si) {
    if (editMode) return;
    const st = player.getState();
    player.setLoop(si);
    if (st === 'stopped' || st === 'paused') player.playFromTime(timeline.sections[si].startSec);
    setLoopUi(si);
  }

  function setLoopUi(si) {
    for (const el of bodyHolder.querySelectorAll('.looping')) el.classList.remove('looping');
    for (const el of bodyHolder.querySelectorAll('.loop-x')) el.remove();
    if (si === null || si === undefined) return;
    const head = bodyHolder.querySelector(`.sec-head[data-sec="${si}"]`);
    if (!head) return;
    head.parentElement.classList.add('looping');
    head.append(domEl('button', {
      type: 'button',
      class: 'btn small loop-x',
      'aria-label': 'Esci dal loop',
      onclick: () => {
        player.setLoop(null);
        setLoopUi(null);
      },
    }, '× Loop'));
  }

  function refreshBpmButtons() {
    const bpms = effectiveSectionBpms(song);
    for (const b of bodyHolder.querySelectorAll('.sec-bpm')) {
      b.textContent = `♩ = ${formatBpm(bpms[Number(b.getAttribute('data-sec'))])}`;
    }
  }

  function openBpmEditor(info, head) {
    const open = head.parentElement.querySelector('.bpm-edit');
    if (open) {
      open.remove();
      return;
    }
    const current = effectiveSectionBpms(song)[info.first];
    const name = sectionNameOf(info.first);
    const same = song.sections.map((s, i) => i).filter((i) => song.sections[i].name.trim().toLowerCase() === name.trim().toLowerCase());
    const input = domEl('input', { type: 'number', inputmode: 'decimal', min: String(BPM_MIN), max: String(BPM_MAX), step: '1', class: 'bpm-field', 'aria-label': 'BPM della sezione', value: String(current) });
    const apply = (indices) => {
      const v = parseFloat(String(input.value).replace(',', '.'));
      if (!(v >= BPM_MIN && v <= BPM_MAX)) {
        showError(`Inserisci un BPM tra ${BPM_MIN} e ${BPM_MAX}`);
        return;
      }
      showNote('');
      for (const i of indices) {
        song.sections[i].bpm = v;
        song.sections[i].bpmSource = 'edited';
      }
      persist();
      rebuildTimeline();
      refreshBpmButtons();
      box.remove();
    };
    const box = domEl('div', { class: 'bpm-edit' },
      domEl('label', null, 'BPM', input),
      domEl('button', { type: 'button', class: 'btn primary small', onclick: () => apply(info.indices) }, 'Applica'),
      same.length > 1 ? domEl('button', { type: 'button', class: 'btn small apply-all', onclick: () => apply(same) }, `Applica a tutte le sezioni «${name}» (${same.length})`) : null,
      domEl('button', { type: 'button', class: 'btn small', onclick: () => box.remove() }, 'Annulla'));
    head.after(box);
    input.focus();
  }

  function buildBody() {
    domClear(bodyHolder);
    bodyHolder.append(renderSongBody(song, {
      onChordTap,
      collapseRepeats: song.view.collapseRepeats && !editMode,
      flat: editMode,
      editMode,
      onSectionBpm: openBpmEditor,
      decorate: decorateSection,
    }));
    mapRefs();
    setLoopUi(player.getLoop());
    if (selectedRef) {
      const el = bodyHolder.querySelector(`.ch[data-ref="${selectedRef}"]`);
      if (el) el.classList.add('sel');
    }
  }

  // ---- header / settings ----
  const buildMeta = () => {
    domClear(metaHolder);
    const items = [];
    if (song.difficulty) items.push(['Difficoltà', song.difficulty]);
    if (song.tuning) items.push(['Accordatura', song.tuning]);
    items.push(['Capotasto', song.capo ? String(song.capo) : 'nessuno']);
    if (song.key) items.push(['Tonalità', song.key]);
    const dl = domEl('dl', { class: 'meta' });
    for (const [k, v] of items) dl.append(domEl('div', null, domEl('dt', null, k), domEl('dd', null, v)));
    if (song.bpm) {
      dl.append(domEl('div', null, domEl('dt', null, 'BPM di partenza'), domEl('dd', { id: 'bpm-value' }, formatBpm(song.bpm))));
    }
    metaHolder.append(dl);
  };

  const buildSettings = () => {
    domClear(settingsHolder);
    const input = domEl('input', { type: 'number', inputmode: 'decimal', min: String(BPM_MIN), max: String(BPM_MAX), step: '1', id: 'bpm-input', 'aria-label': 'BPM di partenza', placeholder: '80', value: song.bpm ? String(song.bpm) : '' });
    const saveBpm = () => {
      const v = parseFloat(String(input.value).replace(',', '.'));
      if (!(v >= BPM_MIN && v <= BPM_MAX)) {
        showError(`Inserisci un BPM tra ${BPM_MIN} e ${BPM_MAX}`);
        return;
      }
      showNote('');
      song.bpm = v;
      persist();
      buildMeta();
      rebuildTimeline();
      refreshBpmButtons();
    };
    const beatsBtns = [2, 4, 8].map((n) => domEl('button', {
      type: 'button',
      class: 'btn beats-opt',
      'data-beats': n,
      'aria-pressed': String(song.view.beatsPerChord === n),
      onclick: () => {
        if (song.timingSource !== 'default' && !window.confirm('Perderai le durate modificate. Continuare?')) return;
        song.view.beatsPerChord = n;
        setAllChordBeats(song, n);
        song.timingSource = 'default';
        persist();
        buildSettings();
        buildBody();
        rebuildTimeline();
      },
    }, String(n)));
    settingsHolder.append(domEl('details', { class: 'settings' },
      domEl('summary', null, 'Impostazioni del brano'),
      domEl('div', { class: 'set-row' },
        domEl('label', { for: 'bpm-input' }, song.bpm ? 'BPM di partenza' : 'BPM non trovato: BPM di partenza'),
        input,
        domEl('button', { type: 'button', class: 'btn', id: 'bpm-save', onclick: saveBpm }, 'Salva')),
      domEl('div', { class: 'set-row' },
        domEl('span', null, 'Battiti per accordo'),
        domEl('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Battiti per accordo' }, beatsBtns))));
  };

  // ---- playback highlight ----
  // `startEvent` >= 0 while counting in: nothing is current yet, that chord is the next one.
  function applyEvent(i, startEvent) {
    const counting = startEvent >= 0;
    if (curEl) curEl.classList.remove('cur');
    if (nextEl) nextEl.classList.remove('next');
    curEl = !counting && i >= 0 ? evEl[i] : null;
    nextEl = (counting ? evEl[startEvent] : evEl[i + 1]) || null;
    if (curEl) {
      curEl.classList.add('cur');
      curEl.style.setProperty('--p', '0');
    }
    if (nextEl) nextEl.classList.add('next');
    lastProgress = -1;
    const anchorEl = curEl || (counting ? nextEl : null);
    const line = anchorEl ? anchorEl.closest('.line') : null;
    const sec = anchorEl ? anchorEl.closest('.sec') : null;
    if (sec !== curSec) {
      if (curSec) curSec.classList.remove('playing');
      curSec = sec;
      if (sec) {
        sec.classList.add('playing');
        if (sec.tagName === 'DETAILS' && !sec.open) {
          sec.open = true;
          openedDetails.add(sec);
        }
      }
    }
    if (line && line !== curLine) {
      curLine = line;
      autoScroll(line);
    }
  }

  function autoScroll(line) {
    if (Date.now() < manualScrollUntil) return;
    const target = line.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3;
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  const noteManualScroll = () => { manualScrollUntil = Date.now() + MANUAL_SCROLL_PAUSE_MS; };
  for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) window.addEventListener(ev, noteManualScroll, { passive: true });

  let panel;
  function onFrame(info) {
    gapp.player.state = info.state;
    gapp.player.timeSec = info.timeSec;
    gapp.player.eventIndex = info.eventIndex;
    gapp.player.beatIndex = info.beatIndex;
    const key = `${info.state}|${info.eventIndex}|${info.beatIndex}|${info.countdown}`;
    const ev = info.eventIndex >= 0 ? timeline.events[info.eventIndex] : null;
    if (key !== lastKey) {
      lastKey = key;
      const evKey = info.eventIndex + (info.state === 'counting' ? 'c' + info.startEvent : '');
      if (evKey !== lastEvKey) {
        lastEvKey = evKey;
        applyEvent(info.eventIndex, info.state === 'counting' ? info.startEvent : -1);
      }
      const nextEvent = info.state === 'counting' ? timeline.events[info.startEvent] : timeline.events[info.eventIndex + 1] || null;
      const beat = info.beatIndex >= 0 ? timeline.beats[info.beatIndex] : null;
      const startEv = info.state === 'counting' ? timeline.events[info.startEvent] : ev || timeline.events[0];
      const secIdx = startEv ? startEv.sectionIndex : 0;
      const section = song.sections[secIdx];
      const strum = section && section.strumIndex !== null && section.strumIndex !== undefined ? song.strumming[section.strumIndex] : null;
      let strumCell = -1;
      if (strum && beat) {
        const on = strum.beats.map((c, i) => (c.onBeat ? i : -1)).filter((i) => i >= 0);
        if (on.length) strumCell = on[beat.beatInBar % on.length];
      }
      panel.update({
        state: info.state,
        countdown: info.countdown,
        event: ev,
        nextEvent,
        beatsLeft: ev && beat ? ev.startBeat + ev.beats - beat.index : 0,
        beatInBar: info.state === 'counting' ? timeline.events.length ? perBarIndexFromCountdown(info.countdown) : -1 : beat ? beat.beatInBar : -1,
        bpm: timeline.sections[secIdx] ? timeline.sections[secIdx].bpm : 80,
        strum,
        strumId: section ? section.strumIndex : null,
        strumCell,
      });
    }
    if (ev && curEl) {
      const p = Math.min(1, Math.max(0, (info.timeSec - ev.startSec) / ev.durSec));
      if (Math.abs(p - lastProgress) >= 0.005) {
        lastProgress = p;
        curEl.style.setProperty('--p', p.toFixed(3));
        panel.setProgress(p);
      }
    }
  }

  function perBarIndexFromCountdown(n) {
    const perBar = (song.timeSignature && song.timeSignature[0]) || 4;
    return perBar - n;
  }

  function onState(st) {
    if (panel) panel.setPlayLabel(st);
    if (st === 'stopped') {
      if (curEl) curEl.classList.remove('cur');
      if (nextEl) nextEl.classList.remove('next');
      if (curSec) curSec.classList.remove('playing');
      curEl = nextEl = curSec = curLine = null;
      for (const d of openedDetails) d.open = false;
      openedDetails.clear();
      lastKey = '';
      lastEvKey = '';
      if (panel) panel.update({ state: 'stopped', countdown: 0, event: null, nextEvent: timeline.events[0] || null, beatsLeft: 0, beatInBar: -1, bpm: timeline.sections[0] ? timeline.sections[0].bpm : 80, strum: null, strumId: null, strumCell: -1 });
      if (panel) panel.setProgress(0);
    }
  }

  panel = createPlayPanel(song, {
    onPlayPause: () => {
      const st = player.getState();
      if (st === 'playing' || st === 'counting') player.pause();
      else player.play();
    },
    onStop: () => {
      player.setLoop(null);
      setLoopUi(null);
      player.stop();
    },
    onSpeed: (v) => {
      speed = v;
      rebuildTimeline();
    },
    onMetronome: (on) => {
      metronomeOn = on;
      player.setMetronome(on);
    },
    onTap: () => {
      const bpm = tapTempo.tap(performance.now() / 1000);
      if (bpm === null) return;
      const v = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
      const info = player.getInfo();
      const ev = info.eventIndex >= 0 ? timeline.events[info.eventIndex] : timeline.events[0];
      if (!ev) return;
      const sec = song.sections[ev.sectionIndex];
      sec.bpm = v;
      sec.bpmSource = 'edited';
      persist();
      rebuildTimeline();
      refreshBpmButtons();
      lastKey = '';
    },
    speedPct: 100,
    metronomeOn,
  });

  // ---- duration editing ----
  const editInfo = domEl('div', { class: 'eb-info', id: 'eb-info' }, 'Tocca un accordo per cambiarne i battiti');
  const stepVal = domEl('span', { class: 'eb-val', id: 'eb-val' }, '');
  const stepMinus = domEl('button', { type: 'button', class: 'btn icon', id: 'eb-minus', 'aria-label': 'Un battito in meno', onclick: () => stepBeats(-1) }, '−');
  const stepPlus = domEl('button', { type: 'button', class: 'btn icon', id: 'eb-plus', 'aria-label': 'Un battito in più', onclick: () => stepBeats(1) }, '+');
  const stepper = domEl('div', { class: 'eb-step', hidden: true }, stepMinus, stepVal, stepPlus, domEl('span', null, 'battiti'));
  const recAllBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-rec-all', onclick: () => startRecording(0, timeline.events.length, 'tutto il brano') }, 'Registra tutto il brano');
  const editBar = domEl('div', { class: 'playpanel editbar', id: 'editbar', hidden: true }, editInfo, stepper, recAllBtn);

  function selectedChord() {
    if (!selectedRef) return null;
    const [s, l, c] = parseRef(selectedRef);
    return song.sections[s].lines[l].chords[c];
  }

  function selectChord(ref) {
    const old = bodyHolder.querySelector('.ch.sel');
    if (old) old.classList.remove('sel');
    selectedRef = ref;
    const el = bodyHolder.querySelector(`.ch[data-ref="${ref}"]`);
    if (el) el.classList.add('sel');
    const chord = selectedChord();
    editInfo.textContent = `Accordo ${chord.name}`;
    stepper.hidden = false;
    stepVal.textContent = String(chord.beats);
  }

  function stepBeats(d) {
    const chord = selectedChord();
    if (!chord) return;
    chord.beats = Math.min(BEATS_MAX, Math.max(BEATS_MIN, chord.beats + d));
    song.timingSource = 'edited';
    stepVal.textContent = String(chord.beats);
    const el = bodyHolder.querySelector(`.ch[data-ref="${selectedRef}"] .bt`);
    if (el) el.textContent = String(chord.beats);
    persist();
    rebuildTimeline();
  }

  const editBtn = domEl('button', {
    type: 'button',
    class: 'btn',
    id: 'btn-edit',
    'aria-pressed': 'false',
    onclick: () => {
      editMode = !editMode;
      editBtn.setAttribute('aria-pressed', String(editMode));
      editBtn.textContent = editMode ? 'Fine modifica' : 'Modifica durate';
      player.setLoop(null);
      player.stop();
      selectedRef = null;
      stepper.hidden = true;
      editInfo.textContent = 'Tocca un accordo per cambiarne i battiti';
      panel.el.hidden = editMode;
      editBar.hidden = !editMode;
      buildBody();
      syncPad();
    },
  }, 'Modifica durate');

  // ---- chrome ----
  const themeBtn = domEl('button', {
    type: 'button',
    class: 'btn theme-btn',
    id: 'btn-theme',
    onclick: () => {
      song.view.theme = song.view.theme === 'dark' ? 'light' : 'dark';
      applyTheme(song.view.theme);
      paintTheme();
      persist();
    },
  });
  function paintTheme() {
    const toLight = song.view.theme === 'dark';
    themeBtn.innerHTML = (toLight ? SUN_ICON : MOON_ICON) + `<span>${toLight ? 'Chiaro' : 'Scuro'}</span>`;
    themeBtn.setAttribute('aria-label', toLight ? 'Passa al tema chiaro' : 'Passa al tema scuro');
  }

  const setScale = (v) => {
    song.view.fontScale = clampScale(v);
    screen.style.setProperty('--fs', String(song.view.fontScale));
    persist();
  };
  const collapseBtn = domEl('button', {
    type: 'button',
    class: 'btn',
    id: 'btn-collapse',
    'aria-pressed': String(!!song.view.collapseRepeats),
    onclick: () => {
      song.view.collapseRepeats = !song.view.collapseRepeats;
      collapseBtn.setAttribute('aria-pressed', String(song.view.collapseRepeats));
      collapseBtn.textContent = song.view.collapseRepeats ? 'Ripetizioni: compresse' : 'Ripetizioni: aperte';
      buildBody();
      persist();
    },
  }, song.view.collapseRepeats ? 'Ripetizioni: compresse' : 'Ripetizioni: aperte');

  const topbar = domEl('div', { class: 'topbar' },
    domEl('button', { type: 'button', class: 'btn', id: 'btn-back', onclick: onBack }, '‹ Libreria'),
    domEl('span', { class: 'spacer' }),
    domEl('button', { type: 'button', class: 'btn icon', id: 'btn-font-down', 'aria-label': 'Testo più piccolo', onclick: () => setScale(song.view.fontScale - 0.1) }, 'A−'),
    domEl('button', { type: 'button', class: 'btn icon', id: 'btn-font-up', 'aria-label': 'Testo più grande', onclick: () => setScale(song.view.fontScale + 0.1) }, 'A+'),
    themeBtn);

  const chips = domEl('div', { class: 'chips', 'aria-label': 'Accordi usati' },
    song.chords.map((c) => renderChordChip(song, c, openChordSheet)));

  const warnings = song.importInfo && song.importInfo.warnings && song.importInfo.warnings.length
    ? domEl('details', { class: 'warnings' },
      domEl('summary', null, `Avvisi di importazione (${song.importInfo.warnings.length})`),
      domEl('ul', null, song.importInfo.warnings.map((w) => domEl('li', null, w))))
    : null;

  const bottom = domEl('div', { class: 'bottombar' }, panel.el, editBar);

  const screen = domEl('div', { class: 'screen song', style: { '--fs': String(song.view.fontScale) } },
    topbar,
    domEl('header', { class: 'song-head' },
      domEl('h1', { id: 'song-title' }, song.title),
      song.artist ? domEl('p', { class: 'artist', id: 'song-artist' }, song.artist) : null,
      metaHolder,
      chips,
      settingsHolder,
      domEl('div', { class: 'tools' }, collapseBtn, editBtn)),
    notice,
    bodyHolder,
    warnings,
    domEl('footer', { class: 'song-foot' },
      domEl('button', {
        type: 'button',
        class: 'btn danger',
        id: 'btn-delete',
        onclick: () => {
          if (!window.confirm(`Eliminare «${song.title}» dalla libreria?`)) return;
          try {
            deleteSong(song.id);
          } catch (err) {
            showError(err.message);
            return;
          }
          onDeleted();
        },
      }, 'Elimina brano')),
    bottom);

  function syncPad() {
    const visible = editMode ? editBar : panel.el;
    screen.style.setProperty('--pp-h', Math.ceil(visible.getBoundingClientRect().height) + 'px');
  }

  let resizeObs = null;
  if (typeof ResizeObserver === 'function') {
    resizeObs = new ResizeObserver(syncPad);
    resizeObs.observe(panel.el);
    resizeObs.observe(editBar);
  }

  applyTheme(song.view.theme);
  paintTheme();
  buildMeta();
  buildSettings();
  buildBody();
  root.append(screen);
  panel.update({ state: 'stopped', countdown: 0, event: null, nextEvent: timeline.events[0] || null, beatsLeft: 0, beatInBar: -1, bpm: timeline.sections[0] ? timeline.sections[0].bpm : 80, strum: null, strumId: null, strumCell: -1 });
  panel.setPlayLabel('stopped');
  syncPad();

  activeScreen = {
    destroy() {
      player.destroy();
      if (resizeObs) resizeObs.disconnect();
      for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) window.removeEventListener(ev, noteManualScroll);
      if (window.__gapp === gapp) delete window.__gapp;
    },
  };
}
