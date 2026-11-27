// Song screen: header, settings, body with chords above lyrics, playback panel, duration editing.

import { domEl, domClear } from './dom.js';
import { renderSongBody, formatBpm } from '../render.js';
import { saveSong, deleteSong } from '../storage.js';
import { buildTimeline } from '../timeline.js';
import { GAP_MIN_SEC, alignmentFits } from '../alignment.js';
import { createPlayer } from '../player.js';
import { createAudioPlayer } from '../audio.js';
import { audioTimelineOptions, formatClock, clampLatencyMs, offsetLabel, OFFSET_STEP_MS } from '../audiosync.js';
import { audioStoreGet, audioStoreDelete } from '../audiostore.js';
import { getDevice, saveDevice, saveDiag } from '../storage.js';
import { openSyncScreen } from './syncscreen.js';
import { openNudgeSheet } from './nudgesheet.js';
import { openAnchorSheet } from './anchorsheet.js';
import { attachAudioFile, AUDIO_ACCEPT } from './audiofile.js';
import { createPlayPanel } from './playpanel.js';
import { openRecorder } from './recorder.js';
import { createTapTempo } from '../taprecord.js';
import { displayChordName } from '../transpose.js';
import { openChordSheet, openCapoSheet, renderDiagramRow, smallDiagramSvg } from './chordsheet.js';
import { effectiveSectionBpms, groupRepeatedSections, setAllChordBeats, sectionSignature, baseSectionName, insertPause, removePause, hasEditedDurations, applyBpmChange, snapshotBpms, restoreBpms } from '../model.js';
import { estimateSongDurations } from '../durations.js';

const FONT_MIN = 0.7;
const FONT_MAX = 2.0;
const BPM_MIN = 30;
const BPM_MAX = 300;
const BEATS_MIN = 1;
const BEATS_MAX = 32;
const LONG_PRESS_MS = 500;
// a finger that moves less than this during a long press is still (a real finger never is)
const LONG_PRESS_SLOP_PX = 12;
const NUDGE_HINT = 'Tieni premuto un accordo per spostarlo un po’ avanti o indietro';
const MANUAL_SCROLL_PAUSE_MS = 4000;
const TRANSPOSE_MAX = 12;
const LOW_SCREEN_PX = 700;

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
  let panel = null;
  let plainTimeline = buildTimeline(song, { speed });
  let timeline = plainTimeline;
  let audioPlayer = null;
  let audioStatus = 'none'; // none | loading | ready | missing | error
  let audioGen = 0;
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
  let bpmUndo = null; // { snap, index, base } while a BPM change made from the panel can be undone

  const disp = (name) => displayChordName(song, name);
  const evLabel = (ev) => (ev.rest ? '—' : disp(ev.name));
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

  const onNotice = (text) => { if (!song.view.wakeNoticeClosed) panel.showNotice(text); };
  // metronome-only player (also used by the tap recorder, which needs the plain timeline) ...
  const metroPlayer = createPlayer({
    timeline,
    timeSignature: song.timeSignature,
    onFrame: (info) => onFrame(info),
    onState: (st) => onState(st),
    onNotice,
  });
  // ... and `player`, the one that is in charge: the audio player when the song has an audio file
  let player = metroPlayer;

  function rebuildTimeline() {
    plainTimeline = buildTimeline(song, { speed });
    metroPlayer.setTimeline(plainTimeline);
    if (player === audioPlayer && audioPlayer) {
      timeline = buildTimeline(song, audioTimelineOptions(song));
      audioPlayer.setTimeline(timeline);
    } else {
      timeline = plainTimeline;
    }
    gapp.timeline = timeline;
    mapRefs();
    paintBpmLock();
  }
  // times that come from the audio alignment do not follow the BPM: the panel buttons are off
  function bpmLocked() { return player === audioPlayer && !!audioPlayer && !!timeline.aligned; }
  function paintBpmLock() { if (panel) panel.setBpmLocked(bpmLocked()); }

  let listenToken = 0;
  let diagTimer = null;
  // what the player measures goes to the device storage every 10 s, for the exported technical information
  function startDiagSaver() {
    const save = () => {
      if (!audioPlayer) return;
      try { saveDiag({ songId: song.id, savedAt: new Date().toISOString(), player: audioPlayer.diagnostics() }); } catch { /* no storage */ }
    };
    diagTimer = setInterval(save, 10000);
    audioPlayer.ready().then(save);
  }
  function paintOffset() {
    if (!panel) return;
    if (!audioPlayer) { panel.setOffset(null); return; }
    const lat = getDevice().latencyMs;
    panel.setOffset(offsetLabel(Number.isFinite(lat) ? lat : 0));
  }

  // ---- audio file: load from IndexedDB, switch between metronome and audio ----
  function destroyAudioPlayer() {
    if (diagTimer !== null) clearInterval(diagTimer);
    diagTimer = null;
    if (audioPlayer) audioPlayer.destroy();
    audioPlayer = null;
    delete gapp.audioEl;
    delete gapp.audioPlayer;
    paintOffset();
  }

  function useMetronomePlayer() {
    if (player !== metroPlayer) {
      player.stop();
      player = metroPlayer;
    }
    metronomeOn = true;
    metroPlayer.setMetronome(true);
    if (panel) panel.setMetronomeState(true);
  }

  async function loadAudio() {
    const gen = ++audioGen;
    destroyAudioPlayer();
    if (!song.audio) {
      audioStatus = 'none';
      useMetronomePlayer();
      rebuildTimeline();
      paintAudioBar();
      return;
    }
    audioStatus = 'loading';
    paintAudioBar();
    const blob = await audioStoreGet(song.id);
    if (gen !== audioGen) return;
    if (!blob) {
      audioStatus = 'missing';
      useMetronomePlayer();
      rebuildTimeline();
      paintAudioBar();
      buildBody();
      return;
    }
    const lat = getDevice().latencyMs;
    audioPlayer = createAudioPlayer({
      timeline: buildTimeline(song, audioTimelineOptions(song)),
      blob,
      latencyMs: Number.isFinite(lat) ? lat : 0,
      onFrame: (info) => onFrame(info),
      onState: (st) => onState(st),
      onNotice,
      onError: (text) => showError(text),
    });
    if (player !== audioPlayer) metroPlayer.stop();
    player = audioPlayer;
    gapp.audioEl = audioPlayer.elementView(); // (a view whose currentTime is the media position: for the tests)
    gapp.audioPlayer = audioPlayer; // (for tests: seek, media time, diagnostics)
    startDiagSaver();
    paintOffset();
    audioStatus = 'ready';
    metronomeOn = !!song.audio.metronome;
    audioPlayer.setMetronome(metronomeOn);
    audioPlayer.setRate(speed);
    if (panel) panel.setMetronomeState(metronomeOn);
    rebuildTimeline();
    paintAudioBar();
    if (player.getState() === 'stopped') idlePanel();
    maybeShowNudgeHint();
  }

  // the first time a synced song is opened: a discreet line, once (per device)
  function maybeShowNudgeHint() {
    if (!nudgeActive() || !timeline.aligned) return;
    try {
      const dev = getDevice();
      if (dev.nudgeHintShown) return;
      saveDevice({ ...dev, nudgeHintShown: true });
    } catch { return; }
    showNote(NUDGE_HINT);
    setTimeout(() => { if (notice.textContent === NUDGE_HINT) { notice.textContent = ''; notice.className = 'msg'; } }, 12000);
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
    openChordSheet(song, name);
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
    metroPlayer.stop();
    openRecorder({
      song,
      player: metroPlayer,
      getTimeline: () => plainTimeline,
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
        class: 'btn small add-pause',
        'data-sec': si,
        onclick: () => {
          insertPause(song, si);
          song.timingSource = 'edited';
          clearSelection();
          persist();
          buildBody();
          rebuildTimeline();
          showNote('Pausa aggiunta all’inizio della sezione');
        },
      }, '+ pausa'));
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
    if (song.audio) {
      const t = si === 0 ? song.audio.offsetSec : song.audio.anchors && song.audio.anchors[si];
      if (t !== undefined) {
        head.append(domEl('button', {
          type: 'button',
          class: 'sec-anchor',
          'data-sec': si,
          'aria-label': `Ancora audio: ${formatClock(t)}. Tocca per regolare`,
          onclick: () => openAnchorSheet({ song, index: si, name: sectionNameOf(si) || `Sezione ${si + 1}`, onChange: () => { persist(); rebuildTimeline(); buildBody(); } }),
        }, `⚓ ${formatClock(t)}`));
      }
    }
    if (nudgeActive() && !(timeline.sections[si] && timeline.sections[si].skipped)) {
      head.append(domEl('button', {
        type: 'button', class: 'sec-nudge', 'data-sec': si, 'aria-label': 'Sposta la sezione di poco',
        onclick: () => openNudgeSheet({ song, kind: 'section', index: si, name: sectionNameOf(si) || `Sezione ${si + 1}`, getPlayer: () => audioPlayer, onChange: () => { persist(); rebuildTimeline(); } }),
      }, '⇄'));
    }
    // long press on the header starts a section loop
    let timer = null;
    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    let down = null;
    head.addEventListener('pointermove', (e) => {
      if (timer !== null && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > LONG_PRESS_SLOP_PX) cancel();
    });
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      cancel();
      down = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        startLoop(si);
      }, LONG_PRESS_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) head.addEventListener(ev, cancel);
    head.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // long press on a chord (with the automatic sync): quick fine correction of its time
  // (available as soon as the song has an alignment that fits the sheet, also while the audio is still loading: the buttons
  // must be there after the sync and after a reload, not only after the next redraw)
  const nudgeActive = () => !editMode && !!song.audio && !!song.audio.alignment && audioStatus !== 'missing' && alignmentFits(song.audio.alignment, song);
  let chordTimer = null;
  let chordDown = null;
  const cancelChord = () => { if (chordTimer !== null) clearTimeout(chordTimer); chordTimer = null; };
  bodyHolder.addEventListener('pointerdown', (e) => {
    const ch = e.target.closest && e.target.closest('.ch[data-ref]');
    if (!ch || !nudgeActive()) return;
    cancelChord();
    chordDown = { x: e.clientX, y: e.clientY };
    const pointerId = e.pointerId;
    const ref = ch.getAttribute('data-ref');
    chordTimer = setTimeout(() => {
      chordTimer = null;
      const j = timeline.events.findIndex((ev) => ev.ref === ref);
      if (j < 0 || timeline.events[j].skipped) return;
      openNudgeSheet({ song, kind: 'event', index: j, name: `Accordo ${timeline.events[j].name}`, getPlayer: () => audioPlayer, holdPointerId: pointerId, onChange: () => { persist(); rebuildTimeline(); } });
    }, LONG_PRESS_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) bodyHolder.addEventListener(ev, cancelChord);
  // the finger is never still: only a real movement (a scroll) cancels the long press
  bodyHolder.addEventListener('pointermove', (e) => {
    if (chordTimer === null || !chordDown) return;
    if (Math.hypot(e.clientX - chordDown.x, e.clientY - chordDown.y) > LONG_PRESS_SLOP_PX) cancelChord();
  });
  // no context menu / text selection callout on a chord (iOS shows them after a long press)
  bodyHolder.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.ch')) e.preventDefault(); });

  function startLoop(si) {
    if (editMode) return;
    // a section that the audio does not have: there is nothing to repeat
    if (timeline.sections[si] && timeline.sections[si].skipped) {
      showNote('Questa sezione non è nell’audio');
      return;
    }
    const st = player.getState();
    player.setLoop(si);
    if (st === 'stopped' || st === 'paused') player.playFromTime(timeline.sections[si].startSec);
    setLoopUi(si);
  }

  function setLoopUi(si) {
    for (const el of bodyHolder.querySelectorAll('.looping')) el.classList.remove('looping');
    for (const el of bodyHolder.querySelectorAll('.loop-x')) el.remove();
    if (panel) panel.setLoop(si === null || si === undefined ? null : sectionNameOf(si) || `Sezione ${si + 1}`);
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
    paintEstNote();
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
    items.push(['Capotasto', song.capo ? (song.view.showShapes ? `${song.capo} — forme` : String(song.capo)) : 'nessuno']);
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
    const mode = song.view.durationMode === 'fixed' ? 'fixed' : 'estimated';
    const applyDurations = (newMode, n) => {
      if (hasEditedDurations(song) && !window.confirm('Perderai le durate modificate. Continuare?')) return;
      song.view.durationMode = newMode;
      song.view.beatsPerChord = n;
      if (newMode === 'estimated') {
        song.sections = estimateSongDurations(song, { beatsPerChordAvg: n }).sections;
        song.timingSource = 'estimated';
      } else {
        setAllChordBeats(song, n);
        song.timingSource = 'default';
      }
      persist();
      buildSettings();
      buildBody();
      rebuildTimeline();
      paintEstNote();
    };
    const modeBtns = [['estimated', 'Stimate dal testo'], ['fixed', 'Fisse']].map(([m, label]) => domEl('button', {
      type: 'button',
      class: 'btn mode-opt',
      'data-mode': m,
      'aria-pressed': String(mode === m),
      onclick: () => { if (mode !== m) applyDurations(m, song.view.beatsPerChord || 4); },
    }, label));
    const beatsBtns = [2, 4, 8].map((n) => domEl('button', {
      type: 'button',
      class: 'btn beats-opt',
      'data-beats': n,
      'aria-pressed': String(song.view.beatsPerChord === n),
      onclick: () => applyDurations(mode, n),
    }, String(n)));
    settingsHolder.append(domEl('details', { class: 'settings' },
      domEl('summary', null, 'Impostazioni del brano'),
      domEl('div', { class: 'set-row' },
        domEl('label', { for: 'bpm-input' }, song.bpm ? 'BPM di partenza' : 'BPM non trovato: BPM di partenza'),
        input,
        domEl('button', { type: 'button', class: 'btn', id: 'bpm-save', onclick: saveBpm }, 'Salva')),
      domEl('div', { class: 'set-row' },
        domEl('span', null, 'Durate'),
        domEl('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Durate degli accordi' }, modeBtns)),
      domEl('div', { class: 'set-row' },
        domEl('span', null, mode === 'estimated' ? 'Durata media (battiti)' : 'Battiti per accordo'),
        domEl('div', { class: 'seg-btns', role: 'group', 'aria-label': mode === 'estimated' ? 'Durata media' : 'Battiti per accordo' }, beatsBtns))));
  };

  // ---- BPM from the play panel ----
  function currentSectionIndex() {
    const info = player.getInfo();
    const i = info.state === 'counting' ? info.startEvent : info.eventIndex;
    const ev = timeline.events[i >= 0 ? i : 0];
    return ev ? ev.sectionIndex : 0;
  }

  function paintBpmNote() {
    // the note (and its undo) shows with an audio, or without one when the 30-300 limit was hit
    if (!bpmUndo || (player !== audioPlayer && !bpmUndo.limited)) {
      panel.setBpmNote('');
      return;
    }
    const now = effectiveSectionBpms(song)[bpmUndo.index];
    const d = Math.round((now - bpmUndo.base) * 10) / 10;
    if (d === 0) {
      panel.setBpmNote('');
      return;
    }
    panel.setBpmNote(`${d > 0 ? '+' : '−'}${formatBpm(Math.abs(d))} BPM ${song.view.bpmScope === 'section' ? 'su questa sezione' : 'su tutto il brano'}${bpmUndo.limited ? ' (limite 30–300: i rapporti restano)' : ''}`);
  }

  function refreshAfterBpm() {
    persist();
    buildMeta();
    rebuildTimeline();
    refreshBpmButtons();
    lastKey = '';
    if (player.getState() === 'stopped') idlePanel();
    else onFrame(player.getInfo());
    paintBpmNote();
  }

  const tempoKey = () => JSON.stringify(snapshotBpms(song));

  // A run of changes from the panel starts from one snapshot: the "whole song" scaling is always
  // computed from it (no rounding drift after many steps) and "Annulla" returns to it. Tempos changed
  // elsewhere (section header, tap tempo, sync screen) start a new run.
  function changeBpm(newValue) {
    const index = currentSectionIndex();
    const scope = song.view.bpmScope === 'section' ? 'section' : 'all';
    if (bpmUndo && bpmUndo.key !== tempoKey()) bpmUndo = null;
    if (!bpmUndo) bpmUndo = { snap: snapshotBpms(song), index, base: effectiveSectionBpms(song)[index], key: '' };
    else if (scope === 'all') restoreBpms(song, bpmUndo.snap);
    applyBpmChange(song, index, newValue, scope);
    bpmUndo.limited = scope === 'all' && Math.abs(effectiveSectionBpms(song)[index] - Math.round(newValue * 10) / 10) > 0.05;
    bpmUndo.key = tempoKey();
    refreshAfterBpm();
  }

  function stepBpm(dir) {
    const cur = effectiveSectionBpms(song)[currentSectionIndex()];
    const v = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round((cur + dir) * 10) / 10));
    if (v === cur) return;
    changeBpm(v);
  }

  // ---- playback highlight ----
  // `startEvent` >= 0 while counting in: nothing is current yet, that chord is the next one.
  function applyEvent(i, startEvent, nextOverride = -1) {
    const counting = startEvent >= 0;
    if (curEl) curEl.classList.remove('cur');
    if (nextEl) nextEl.classList.remove('next');
    curEl = !counting && i >= 0 ? evEl[i] : null;
    nextEl = (counting ? evEl[startEvent] : nextOverride >= 0 ? evEl[nextOverride] : evEl[i + 1]) || null;
    if (curEl) {
      curEl.classList.add('cur');
      curEl.style.setProperty('--p', '0');
    }
    if (nextEl) nextEl.classList.add('next');
    lastProgress = -1;
    // in a gap (music that is not in the sheet) nothing is current: the sheet goes to the section that picks up again
    const inGap = !counting && nextOverride >= 0 && i < 0;
    const anchorEl = curEl || (counting || inGap ? nextEl : null);
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
      // (in a gap: the beginning of the section that resumes, with its heading, if its first chord is the next one)
      const first = inGap && sec && line === sec.querySelector('.line');
      autoScroll(first ? sec : line);
    }
  }

  function autoScroll(line) {
    if (Date.now() < manualScrollUntil) return;
    // the current line goes to 25% of the height visible above the bottom panel
    const panelH = (editMode ? editBar : panel.el).getBoundingClientRect().height;
    const target = line.getBoundingClientRect().top + window.scrollY - 0.25 * (window.innerHeight - panelH);
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  const noteManualScroll = () => { manualScrollUntil = Date.now() + MANUAL_SCROLL_PAUSE_MS; };
  for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) window.addEventListener(ev, noteManualScroll, { passive: true });

  function onFrame(info) {
    gapp.player.state = info.state;
    gapp.player.timeSec = info.timeSec;
    gapp.player.eventIndex = info.eventIndex;
    gapp.player.beatIndex = info.beatIndex;
    // inside a stretch of music that is not in the sheet (3 s or more): no chord is current, the panel counts down
    const gap = info.state !== 'counting' && timeline.gaps ? timeline.gaps.find((g) => g.endSec - g.startSec >= GAP_MIN_SEC && info.timeSec >= g.startSec && info.timeSec < g.endSec) : null;
    const eventIndex = gap ? -1 : info.eventIndex;
    const afterGap = gap ? timeline.events.findIndex((e) => !e.skipped && e.startSec >= gap.endSec - 1e-3) : -1;
    const gapLeft = gap ? Math.max(1, Math.ceil(gap.endSec - info.timeSec - 1e-6)) : 0;
    const key = `${info.state}|${eventIndex}|${info.beatIndex}|${info.countdown}|${gap ? 'g' + gapLeft : ''}`;
    const ev = eventIndex >= 0 ? timeline.events[eventIndex] : null;
    if (key !== lastKey) {
      lastKey = key;
      const evKey = eventIndex + (info.state === 'counting' ? 'c' + info.startEvent : '') + (gap ? 'g' + afterGap : '');
      if (evKey !== lastEvKey) {
        lastEvKey = evKey;
        applyEvent(eventIndex, info.state === 'counting' ? info.startEvent : -1, gap ? afterGap : -1);
      }
      const nextEvent = info.state === 'counting' ? timeline.events[info.startEvent] : gap ? timeline.events[afterGap] || null : timeline.events[eventIndex + 1] || null;
      const beat = info.beatIndex >= 0 ? timeline.beats[info.beatIndex] : null;
      const startEv = info.state === 'counting' ? timeline.events[info.startEvent] : ev || (gap && nextEvent) || timeline.events[0];
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
        beatsLeft: ev && beat ? Math.max(0, ev.startBeat + ev.beats - beat.index) : 0,
        gap: gap ? { left: gapLeft, label: nextEvent ? evLabel(nextEvent) : '' } : null,
        curLabel: ev ? evLabel(ev) : undefined,
        nextLabel: nextEvent ? evLabel(nextEvent) : undefined,
        beatInBar: info.state === 'counting' ? timeline.events.length ? perBarIndexFromCountdown(info.countdown) : -1 : beat && !gap ? beat.beatInBar : -1,
        bpm: timeline.sections[secIdx] ? timeline.sections[secIdx].bpm : 80,
        savedBpm: timeline.sections[secIdx] ? timeline.sections[secIdx].savedBpm : undefined,
        strum,
        strumId: section ? section.strumIndex : null,
        strumCell,
        free: !!(timeline.sections[secIdx] && timeline.sections[secIdx].free),
      });
    }
    if (gap && lastProgress !== 0) { lastProgress = 0; panel.setProgress(0); }
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
    screen.classList.toggle('is-playing', st === 'counting' || st === 'playing');
    if (st === 'counting' || st === 'playing') {
      // re-apply the highlight and scroll again (layout may have changed while paused)
      lastKey = '';
      lastEvKey = '';
      curLine = null;
    }
    if (st === 'stopped') {
      if (curEl) curEl.classList.remove('cur');
      if (nextEl) nextEl.classList.remove('next');
      if (curSec) curSec.classList.remove('playing');
      curEl = nextEl = curSec = curLine = null;
      for (const d of openedDetails) d.open = false;
      openedDetails.clear();
      lastKey = '';
      lastEvKey = '';
      idlePanel();
      if (panel) panel.setProgress(0);
    }
  }

  function idlePanel() {
    const first = timeline.events[0] || null;
    // the rhythm row of the first section is already there when stopped: the panel has the same height in play
    const sec0 = song.sections[first ? first.sectionIndex : 0];
    const strum0 = sec0 && sec0.strumIndex !== null && sec0.strumIndex !== undefined ? song.strumming[sec0.strumIndex] || null : null;
    panel.update({ state: 'stopped', countdown: 0, event: null, nextEvent: first, nextLabel: first ? evLabel(first) : undefined, beatsLeft: 0, beatInBar: -1, bpm: timeline.sections[0] ? timeline.sections[0].bpm : 80, strum: strum0, strumId: strum0 ? sec0.strumIndex : null, strumCell: -1, free: !!(first && timeline.sections[first.sectionIndex] && timeline.sections[first.sectionIndex].free) });
  }

  panel = createPlayPanel(song, {
    diagramSvg: smallDiagramSvg,
    onLoopExit: () => { player.setLoop(null); setLoopUi(null); },
    onPlayPause: () => {
      listenToken++;
      const st = player.getState();
      if (st === 'playing' || st === 'counting') player.pause();
      else player.play();
    },
    onStop: () => {
      listenToken++;
      player.setLoop(null);
      setLoopUi(null);
      player.stop();
    },
    onSpeed: (v) => {
      speed = v;
      // with audio the media time does not depend on the speed: only the playback rate changes
      if (audioPlayer) audioPlayer.setRate(v);
      rebuildTimeline();
    },
    onOffset: (dir) => {
      if (!audioPlayer) return;
      const cur = Number.isFinite(getDevice().latencyMs) ? getDevice().latencyMs : 0;
      const next = clampLatencyMs(cur - dir * OFFSET_STEP_MS);
      try { saveDevice({ ...getDevice(), latencyMs: next }); } catch { /* no storage: the value holds for this session */ }
      audioPlayer.setLatency(next);
      paintOffset();
    },
    onOffsetListen: () => {
      if (!audioPlayer) return;
      // plays 5 s from the current place (or a moment before it, to hear the chord change) and stops
      const token = ++listenToken;
      const t = audioPlayer.getState() === 'stopped' ? Math.max(0, audioPlayer.getInfo().timeSec) : audioPlayer.currentTime();
      audioPlayer.playFromTime(Math.max(0, t - 0.5));
      setTimeout(() => { if (token === listenToken && audioPlayer && audioPlayer.getState() === 'playing') audioPlayer.pause(); }, 5000);
    },
    onMetronome: (on) => {
      metronomeOn = on;
      player.setMetronome(on);
      if (player === audioPlayer && song.audio) {
        song.audio.metronome = on;
        persist();
      }
    },
    onTap: () => {
      if (bpmLocked()) return;
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
    bpmScope: song.view.bpmScope === 'section' ? 'section' : 'all',
    onBpmStep: (dir) => { if (!bpmLocked()) stepBpm(dir); },
    onBpmSet: (v) => {
      if (bpmLocked()) {
        showError('Con la sincronizzazione automatica il tempo segue l’audio: per correggere una sezione usa «Correggi a orecchio»');
        return false;
      }
      if (!(v >= BPM_MIN && v <= BPM_MAX)) {
        showError(`Inserisci un BPM tra ${BPM_MIN} e ${BPM_MAX}`);
        return false;
      }
      showNote('');
      changeBpm(v);
      return true;
    },
    onScope: (scope) => {
      song.view.bpmScope = scope;
      persist();
      bpmUndo = null;
      paintBpmNote();
    },
    onBpmUndo: () => {
      if (!bpmUndo) return;
      restoreBpms(song, bpmUndo.snap);
      bpmUndo = null;
      refreshAfterBpm();
    },
    speedPct: 100,
    metronomeOn,
    // short screens: small diagrams in the panel are off unless the user turned them on
    diagramsOn: typeof song.view.panelDiagrams === 'boolean' ? song.view.panelDiagrams : window.innerHeight >= LOW_SCREEN_PX,
    onDiagrams: (on) => {
      song.view.panelDiagrams = on;
      persist();
    },
    // short screens: the rhythm row is off unless the user turned it on
    rhythmOn: typeof song.view.panelRhythm === 'boolean' ? song.view.panelRhythm : window.innerHeight >= LOW_SCREEN_PX,
    onRhythm: (on) => {
      song.view.panelRhythm = on;
      persist();
    },
    onNoticeClosed: () => {
      song.view.wakeNoticeClosed = true;
      persist();
    },
  });
  paintBpmLock();
  paintOffset();

  // ---- duration editing ----
  const editInfo = domEl('div', { class: 'eb-info', id: 'eb-info' }, 'Tocca un accordo per cambiarne i battiti');
  const stepVal = domEl('span', { class: 'eb-val', id: 'eb-val' }, '');
  const stepMinus = domEl('button', { type: 'button', class: 'btn icon', id: 'eb-minus', 'aria-label': 'Un battito in meno', onclick: () => stepBeats(-1) }, '−');
  const stepPlus = domEl('button', { type: 'button', class: 'btn icon', id: 'eb-plus', 'aria-label': 'Un battito in più', onclick: () => stepBeats(1) }, '+');
  const stepper = domEl('div', { class: 'eb-step', hidden: true }, stepMinus, stepVal, stepPlus, domEl('span', null, 'battiti'));
  const delPauseBtn = domEl('button', {
    type: 'button',
    class: 'btn danger small',
    id: 'eb-del-pause',
    hidden: true,
    onclick: () => {
      if (!selectedRef) return;
      const [si, li, ci] = parseRef(selectedRef);
      if (!removePause(song, si, li, ci)) return;
      song.timingSource = 'edited';
      clearSelection();
      persist();
      buildBody();
      rebuildTimeline();
    },
  }, 'Elimina pausa');
  const estNote = domEl('div', { class: 'eb-note', id: 'eb-note', hidden: true }, 'Durate stimate dalla posizione degli accordi sul testo: controllale e correggile con −/+ o con la registrazione a tap');
  function paintEstNote() {
    estNote.hidden = song.timingSource !== 'estimated';
  }
  const recAllBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-rec-all', onclick: () => startRecording(0, timeline.events.length, 'tutto il brano') }, 'Registra tutto il brano');
  const editBar = domEl('div', { class: 'playpanel editbar', id: 'editbar', hidden: true }, estNote, editInfo, stepper, delPauseBtn, recAllBtn);

  function selectedChord() {
    if (!selectedRef) return null;
    const [s, l, c] = parseRef(selectedRef);
    return song.sections[s].lines[l].chords[c];
  }

  function clearSelection() {
    selectedRef = null;
    stepper.hidden = true;
    delPauseBtn.hidden = true;
    editInfo.textContent = 'Tocca un accordo per cambiarne i battiti';
  }

  function selectChord(ref) {
    const old = bodyHolder.querySelector('.ch.sel');
    if (old) old.classList.remove('sel');
    selectedRef = ref;
    const el = bodyHolder.querySelector(`.ch[data-ref="${ref}"]`);
    if (el) el.classList.add('sel');
    const chord = selectedChord();
    editInfo.textContent = chord.rest ? 'Pausa' : `Accordo ${disp(chord.name)}`;
    stepper.hidden = false;
    delPauseBtn.hidden = !chord.rest;
    stepVal.textContent = String(chord.beats);
  }

  function stepBeats(d) {
    const chord = selectedChord();
    if (!chord) return;
    chord.beats = Math.min(BEATS_MAX, Math.max(BEATS_MIN, chord.beats + d));
    song.timingSource = 'edited';
    paintEstNote();
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
      clearSelection();
      panel.el.hidden = editMode;
      editBar.hidden = !editMode;
      paintEstNote();
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
    curLine = null;
    lastKey = '';
    lastEvKey = '';
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

  // ---- audio bar: add / sync the audio file, missing file ----
  const audioBar = domEl('div', { class: 'audio-bar', id: 'audio-bar' });
  const reloadInput = domEl('input', {
    type: 'file', id: 'audio-reload', class: 'file-input', accept: AUDIO_ACCEPT,
    onchange: async () => {
      const file = reloadInput.files && reloadInput.files[0];
      reloadInput.value = '';
      if (!file) return;
      showNote('Carico «' + file.name + '»…');
      const r = await attachAudioFile(song, file, () => window.confirm('Questo file è diverso da quello di prima (nome o dimensione). Tenere l’inizio e le ancore già fissati?'));
      if (!r.ok) {
        showError(r.error);
        return;
      }
      showNote(r.kept ? 'Audio ricaricato: inizio e ancore conservati.' : 'Audio caricato.');
      persist();
      buildBody();
      await loadAudio();
    },
  });
  function paintAudioBar() {
    domClear(audioBar);
    const a = song.audio;
    const syncBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-sync', onclick: () => openSync() }, a ? 'Sincronizza audio' : 'Aggiungi audio');
    if (!a) {
      audioBar.append(syncBtn);
    } else if (audioStatus === 'missing') {
      audioBar.append(
        domEl('span', { class: 'audio-state error', id: 'audio-state' }, `Audio mancante: ricarica «${a.fileName}»`),
        domEl('label', { class: 'btn primary', for: 'audio-reload', id: 'btn-audio-reload' }, 'Ricarica audio'),
        syncBtn);
    } else {
      audioBar.append(
        domEl('span', { class: 'audio-state', id: 'audio-state' }, audioStatus === 'loading' ? 'Carico l’audio…' : `Audio: ${a.fileName}`),
        syncBtn);
    }
    audioBar.append(reloadInput);
  }

  function openSync() {
    if (editMode) return;
    player.stop();
    metroPlayer.stop();
    audioGen++;
    destroyAudioPlayer();
    openSyncScreen({
      song,
      persist,
      onClose: () => {
        refreshBpmButtons();
        buildBody();
        loadAudio();
      },
    });
  }

  const dgHolder = domEl('div', { class: 'dg-holder' });
  const buildDiagrams = () => {
    domClear(dgHolder);
    dgHolder.append(renderDiagramRow(song, (name) => openChordSheet(song, name)));
  };

  // ---- transposition and capo ----
  const trInd = domEl('button', { type: 'button', class: 'btn tr-ind', id: 'tr-indicator', onclick: () => setTranspose(0) });
  const trDown = domEl('button', { type: 'button', class: 'btn icon', id: 'btn-tr-down', 'aria-label': 'Mezzo tono più basso', onclick: () => setTranspose(song.transpose - 1) }, '−');
  const trUp = domEl('button', { type: 'button', class: 'btn icon', id: 'btn-tr-up', 'aria-label': 'Mezzo tono più alto', onclick: () => setTranspose(song.transpose + 1) }, '+');
  const capoBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-capo', onclick: () => openCapoSheet(song, onCapoChanged) });
  function paintTranspose() {
    const t = song.transpose || 0;
    trInd.textContent = t === 0 ? 'Originale' : (t > 0 ? '+' : '−') + Math.abs(t);
    trInd.dataset.tr = String(t);
    trInd.setAttribute('aria-label', t === 0 ? 'Tonalità originale' : `Trasposto di ${t} semitoni: tocca per tornare all’originale`);
    capoBtn.textContent = song.capo ? (song.view.showShapes ? `Capo ${song.capo} — forme` : `Capo ${song.capo}`) : 'Capotasto';
  }
  // Redraws everything that shows chord names (after transposition, capo or shapes view changes).
  function refreshChords() {
    song.transpose = Math.max(-TRANSPOSE_MAX, Math.min(TRANSPOSE_MAX, song.transpose || 0));
    paintTranspose();
    buildMeta();
    buildDiagrams();
    buildBody();
    rebuildTimeline();
    lastKey = '';
    lastEvKey = '';
    curLine = null;
    if (player.getState() === 'stopped') idlePanel();
    persist();
  }
  function setTranspose(v) {
    song.transpose = Math.max(-TRANSPOSE_MAX, Math.min(TRANSPOSE_MAX, v));
    refreshChords();
  }
  function onCapoChanged() {
    refreshChords();
  }
  const trRow = domEl('div', { class: 'tr-row' }, domEl('span', { class: 'tr-lbl' }, 'Tono'), trDown, trInd, trUp, capoBtn);

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
      trRow,
      dgHolder,
      settingsHolder,
      domEl('div', { class: 'tools' }, collapseBtn, editBtn),
      audioBar),
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
          audioStoreDelete(song.id);
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
  buildDiagrams();
  paintTranspose();
  buildBody();
  root.append(screen);
  idlePanel();
  panel.setPlayLabel('stopped');
  syncPad();
  paintAudioBar();
  if (song.audio) loadAudio();

  activeScreen = {
    destroy() {
      audioGen++;
      metroPlayer.destroy();
      destroyAudioPlayer();
      if (resizeObs) resizeObs.disconnect();
      for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) window.removeEventListener(ev, noteManualScroll);
      if (window.__gapp === gapp) delete window.__gapp;
    },
  };
}
