// Fixed bottom panel shown during playback: current / next chord, bar dots, strumming pattern,
// section tempo and the transport controls.

import { domEl, domClear } from './dom.js';
import { chordColorVar, formatBpm } from '../render.js';

const SPEED_MIN = 25;
const SPEED_MAX = 100;

// `diagramSvg(label)` (optional) returns the small SVG of a chord shown next to its name.
export function createPlayPanel(song, { onLoopExit = null, onPlayPause, onStop, onSpeed, onMetronome, onTap, speedPct = 100, metronomeOn = true, diagramSvg = null, diagramsOn = true, onDiagrams = null, onNoticeClosed = null, onBpmStep = null, onBpmSet = null, onScope = null, onBpmUndo = null, bpmScope = 'all', rhythmOn = true, onRhythm = null, onOffset = null, onOffsetListen = null, autoCollapse = true, collapseMs = 4000, synthOn = true, onSynth = null, synthVolume = 0.8, onSynthVolume = null }) {
  const perBar = (song.timeSignature && song.timeSignature[0]) || 4;
  let speed = speedPct;
  let metro = metronomeOn;
  let lastKey = '';

  const curName = domEl('div', { class: 'pp-cur-name', id: 'pp-current' }, '–');
  const curDg = domEl('span', { class: 'pp-dg', id: 'pp-current-dg' });
  const curBar = domEl('div', { class: 'pp-cur-bar' }, domEl('div', { class: 'pp-cur-fill' }));
  // inside music that is not in the sheet: the bar gives way to the countdown to the next chord
  const curGap = domEl('div', { class: 'pp-cur-gap', id: 'pp-gap', hidden: true }, '');
  // free tempo (round 12): what the clicks do, on the line of the bar (its own element: #pp-gap means music that is not in the sheet)
  const curFree = domEl('div', { class: 'pp-cur-gap pp-cur-free', id: 'pp-free', hidden: true }, 'tempo libero: un tic a ogni cambio');
  const cur = domEl('div', { class: 'pp-cur' }, domEl('div', { class: 'pp-cur-main' }, curDg, curName), curBar, curGap, curFree);
  const nextName = domEl('span', { class: 'pp-next-name', id: 'pp-next' }, '–');
  const nextDg = domEl('span', { class: 'pp-dg', id: 'pp-next-dg' });
  const nextBadge = domEl('span', { class: 'pp-badge', id: 'pp-left', title: 'Battiti al cambio' }, '');
  const next = domEl('div', { class: 'pp-next' }, domEl('span', { class: 'pp-next-lbl' }, 'Poi'), nextDg, nextName, nextBadge);
  const dots = [];
  const dotsEl = domEl('div', { class: 'pp-dots', 'aria-hidden': 'true' });
  for (let i = 0; i < perBar; i++) {
    const d = domEl('span', { class: 'pp-dot' + (i === 0 ? ' acc' : '') });
    dots.push(d);
    dotsEl.append(d);
  }
  // BPM control: − / + (hold to repeat), tap on the number opens a field, scope switch next to it
  const HOLD_DELAY_MS = 450;
  const HOLD_EVERY_MS = 200;
  let scope = bpmScope;
  function holdButton(id, label, dir, aria, stepFn = null, cls = 'pp-bpm-step') {
    let timer = null;
    let iv = null;
    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      if (iv !== null) clearInterval(iv);
      timer = iv = null;
    };
    const step = () => { if (stepFn) stepFn(dir); else if (onBpmStep) onBpmStep(dir); };
    const b = domEl('button', { type: 'button', class: 'btn icon ' + cls, id, 'aria-label': aria }, label);
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return;
      stop();
      step();
      timer = setTimeout(() => { timer = null; iv = setInterval(step, HOLD_EVERY_MS); }, HOLD_DELAY_MS);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
    b.addEventListener('click', (e) => { if (e.detail === 0) step(); }); // keyboard
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }
  const bpmEl = domEl('button', { type: 'button', class: 'pp-bpm', id: 'pp-bpm', 'aria-label': 'BPM: tocca per scriverlo', onclick: () => toggleBpmEdit() }, '');
  const bpmMinus = holdButton('btn-bpm-down', '−', -1, 'Un BPM in meno');
  const bpmPlus = holdButton('btn-bpm-up', '+', 1, 'Un BPM in più');
  const toggleScope = () => {
    scope = scope === 'all' ? 'section' : 'all';
    paintScope();
    if (onScope) onScope(scope);
  };
  // in the row only while the scope is "this section" (a chip that returns to "whole song"); the full
  // switch lives in the field that opens when the number is tapped (no room for both on 360 px)
  const scopeBtn = domEl('button', { type: 'button', class: 'btn pp-scope', id: 'btn-bpm-scope', onclick: toggleScope });
  const scopeBtn2 = domEl('button', { type: 'button', class: 'btn small', id: 'btn-bpm-scope2', onclick: toggleScope });
  function paintScope() {
    const all = scope === 'all';
    scopeBtn.hidden = all;
    scopeBtn.textContent = 'Sez.';
    scopeBtn.setAttribute('aria-label', 'BPM: cambia solo questa sezione. Tocca per cambiare tutto il brano');
    scopeBtn2.textContent = all ? 'Tutto il brano' : 'Solo questa sezione';
    scopeBtn2.setAttribute('aria-label', all ? 'BPM: cambia tutto il brano. Tocca per cambiare solo la sezione' : 'BPM: cambia solo questa sezione. Tocca per cambiare tutto il brano');
    scopeBtn.dataset.scope = scopeBtn2.dataset.scope = scope;
  }
  const bpmBox = domEl('div', { class: 'pp-bpmbox', role: 'group', 'aria-label': 'BPM' }, bpmMinus, bpmEl, bpmPlus);
  const bpmField = domEl('input', { type: 'number', inputmode: 'decimal', min: '30', max: '300', step: '1', class: 'bpm-field', id: 'pp-bpm-field', 'aria-label': 'BPM' });
  const applyBtn = domEl('button', { type: 'button', class: 'btn primary small', id: 'pp-bpm-apply', onclick: () => { const v = parseFloat(String(bpmField.value).replace(',', '.')); if (onBpmSet && onBpmSet(v) !== false) bpmEdit.hidden = true; } }, 'Applica');
  const tapBtn2 = domEl('button', { type: 'button', class: 'btn small', id: 'pp-bpm-tap', onclick: () => { if (onTap) onTap(); } }, 'Tap tempo');
  const bpmEdit = domEl('div', { class: 'pp-bpmedit', id: 'pp-bpmedit', hidden: true },
    bpmField,
    scopeBtn2,
    applyBtn,
    tapBtn2,
    domEl('button', { type: 'button', class: 'btn small', onclick: () => { bpmEdit.hidden = true; } }, 'Chiudi'));
  function toggleBpmEdit() {
    bpmEdit.hidden = !bpmEdit.hidden;
    if (!bpmEdit.hidden) {
      bpmField.value = (bpmEl.dataset.v || '').replace(',', '.');
      bpmField.focus();
      bpmField.select();
    }
  }
  const bpmNoteText = domEl('span', { id: 'pp-bpm-note-text' }, '');
  const bpmNote = domEl('div', { class: 'pp-notice pp-bpmnote', id: 'pp-bpm-note', role: 'status', hidden: true }, bpmNoteText,
    domEl('button', { type: 'button', class: 'btn small', id: 'btn-bpm-undo', onclick: () => { if (onBpmUndo) onBpmUndo(); } }, 'Annulla'));
  // with the automatic sync the times come from the audio: − / + stay visible but off, with this note
  const lockNote = domEl('div', { class: 'pp-lock-note', id: 'pp-bpm-lock', hidden: true }, 'Con la sincronizzazione automatica il tempo segue l’audio: per correggere una sezione usa «Correggi a orecchio»');
  const patEl = domEl('div', { class: 'pp-pat', id: 'pp-pattern' });

  const playBtn = domEl('button', { type: 'button', class: 'btn primary pp-play', id: 'btn-play', 'aria-label': 'Avvia', onclick: onPlayPause }, 'Play');
  const stopBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-stop', 'aria-label': 'Ferma e torna all’inizio', onclick: onStop }, 'Stop');
  // ---- Tempo (round 13): the slowdown, in percent and BPM, always in the open bar ----
  let baseBpm = 0; // tempo of the current section at 100%
  const tempoPct = domEl('span', { class: 'pp-tempo-pct', id: 'pp-tempo-pct' }, '');
  const tempoBpm = domEl('span', { class: 'pp-tempo-bpm', id: 'pp-tempo-bpm' }, '');
  const tempoVal = domEl('button', { type: 'button', class: 'pp-tempo-val', id: 'pp-tempo', 'aria-label': 'Tempo: tocca per scrivere un BPM', onclick: () => toggleTempoEdit() }, tempoPct, tempoBpm);
  const mini = Math.round;
  function paintSpeed() {
    tempoPct.textContent = speed + '%';
    tempoBpm.textContent = baseBpm > 0 ? `♩ ${mini(baseBpm * speed / 100)} (di ${mini(baseBpm)})` : '';
    tempoVal.dataset.pct = String(speed);
    chips.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.pct) === speed)));
    miniSpeed.textContent = speed + '%';
    miniSpeed.hidden = speed === 100;
    el.classList.toggle('pp-slow', speed !== 100);
  }
  const setSpeed = (v, notify = true) => {
    const nv = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(v)));
    if (nv === speed && notify) return;
    speed = nv;
    paintSpeed();
    if (notify && onSpeed) onSpeed(speed / 100);
  };
  const stepSpeed = (dir) => setSpeed(dir > 0 ? Math.floor(speed / 5) * 5 + 5 : Math.ceil(speed / 5) * 5 - 5);
  const speedDown = holdButton('btn-speed-down', '−', -1, 'Più lento di 5 per cento', stepSpeed, 'pp-speed-step');
  const speedUp = holdButton('btn-speed-up', '+', 1, 'Più veloce di 5 per cento', stepSpeed, 'pp-speed-step');
  const chips = [50, 75, 100].map((p) => domEl('button', { type: 'button', class: 'btn pp-chip', id: 'btn-speed-' + p, 'data-pct': String(p), 'aria-label': `Velocità ${p} per cento`, onclick: () => setSpeed(p) }, String(p)));
  const tempoRow = domEl('div', { class: 'pp-tempo', id: 'pp-tempo-row', role: 'group', 'aria-label': 'Tempo: rallenta audio, evidenziazione e clic' }, speedDown, tempoVal, speedUp, ...chips);
  const speedField = domEl('input', { type: 'number', inputmode: 'decimal', min: '10', max: '300', step: '1', class: 'bpm-field', id: 'pp-speed-field', 'aria-label': 'BPM obiettivo' });
  const speedHint = domEl('span', { class: 'pp-speed-hint', id: 'pp-speed-hint' }, '');
  const speedEdit = domEl('div', { class: 'pp-bpmedit', id: 'pp-speededit', hidden: true },
    domEl('span', { class: 'pp-speed-lbl' }, 'BPM obiettivo'),
    speedField,
    domEl('button', { type: 'button', class: 'btn primary small', id: 'pp-speed-apply', onclick: () => applySpeedTarget() }, 'Applica'),
    domEl('button', { type: 'button', class: 'btn small', onclick: () => { speedEdit.hidden = true; } }, 'Chiudi'),
    speedHint);
  function applySpeedTarget() {
    const v = parseFloat(String(speedField.value).replace(',', '.'));
    if (!(v > 0) || !(baseBpm > 0)) { speedHint.textContent = 'Scrivi un BPM'; return; }
    const pct = Math.round((v / baseBpm) * 100);
    if (pct < SPEED_MIN) { speedHint.textContent = `Al massimo ${SPEED_MIN}% (♩ ${mini(baseBpm * SPEED_MIN / 100)})`; setSpeed(SPEED_MIN); return; }
    if (pct > SPEED_MAX) { speedHint.textContent = `Al massimo 100% (♩ ${mini(baseBpm)})`; setSpeed(SPEED_MAX); return; }
    speedHint.textContent = '';
    setSpeed(pct);
    speedEdit.hidden = true;
  }
  function toggleTempoEdit() {
    speedEdit.hidden = !speedEdit.hidden;
    if (!speedEdit.hidden) {
      speedHint.textContent = '';
      speedField.value = baseBpm > 0 ? String(mini(baseBpm * speed / 100)) : '';
      speedField.focus();
      speedField.select();
    }
  }
  const metroBtn = domEl('button', {
    type: 'button', class: 'btn', id: 'btn-metro', 'aria-pressed': String(metro),
    onclick: () => {
      metro = !metro;
      metroBtn.setAttribute('aria-pressed', String(metro));
      metroBtn.textContent = metro ? 'Clic: sì' : 'Clic: no';
      paintClick();
      onMetronome(metro);
    },
  }, metro ? 'Clic: sì' : 'Clic: no');
  const tapBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-tap', onclick: onTap }, 'Tap tempo');
  let dgOn = diagramsOn;
  const dgBtn = domEl('button', {
    type: 'button', class: 'btn', id: 'btn-pp-dg', 'aria-pressed': String(dgOn),
    onclick: () => {
      dgOn = !dgOn;
      paintDg();
      if (onDiagrams) onDiagrams(dgOn);
    },
  });
  function paintDg() {
    dgBtn.setAttribute('aria-pressed', String(dgOn));
    dgBtn.textContent = dgOn ? 'Diagrammi: sì' : 'Diagrammi: no';
    el.classList.toggle('pp-nodg', !dgOn);
  }
  // always visible: click on/off icon and the active loop (tap = leave the loop)
  const clickIcon = domEl('button', {
    type: 'button', class: 'btn pp-click', id: 'btn-click-icon', 'aria-pressed': String(metro),
    onclick: () => metroBtn.click(),
  });
  const loopBadge = domEl('button', {
    type: 'button', class: 'btn pp-loop', id: 'pp-loop', hidden: true, 'aria-label': 'Loop attivo: tocca per uscire',
    onclick: () => { if (onLoopExit) onLoopExit(); },
  });
  function paintClick() {
    clickIcon.setAttribute('aria-pressed', String(metro));
    clickIcon.textContent = metro ? '🔔' : '🔕';
    clickIcon.setAttribute('aria-label', metro ? 'Clic acceso: tocca per spegnere' : 'Clic spento: tocca per accendere');
  }
  let rhOn = rhythmOn;
  const rhBtn = domEl('button', {
    type: 'button', class: 'btn', id: 'btn-pp-rhythm', 'aria-pressed': String(rhOn),
    onclick: () => {
      rhOn = !rhOn;
      paintRhythm();
      if (onRhythm) onRhythm(rhOn);
    },
  });
  function paintRhythm() {
    rhBtn.setAttribute('aria-pressed', String(rhOn));
    rhBtn.textContent = rhOn ? 'Ritmo: sì' : 'Ritmo: no';
    el.classList.toggle('pp-norhythm', !rhOn);
  }
  // highlight earlier / later (audio only): the latency of the device, in steps of 50 ms, with a 5 s listen to hear the effect
  const offLbl = domEl('output', { class: 'pp-off-val', id: 'pp-offset-val', 'aria-live': 'polite' }, '');
  const offRow = domEl('div', { class: 'pp-offset', id: 'pp-offset', hidden: true, role: 'group', 'aria-label': 'Evidenziazione in anticipo o in ritardo' },
    domEl('span', { class: 'pp-off-title' }, 'Evidenziazione'),
    domEl('div', { class: 'pp-off-ctl' },
      domEl('button', { type: 'button', class: 'btn', id: 'btn-offset-later', 'aria-label': 'Evidenzia 50 millisecondi più tardi', onclick: () => { if (onOffset) onOffset(-1); } }, 'Più tardi'),
      offLbl,
      domEl('button', { type: 'button', class: 'btn', id: 'btn-offset-earlier', 'aria-label': 'Evidenzia 50 millisecondi prima', onclick: () => { if (onOffset) onOffset(1); } }, 'Prima')),
    domEl('button', { type: 'button', class: 'btn small', id: 'btn-offset-listen', onclick: () => { if (onOffsetListen) onOffsetListen(); } }, 'Ascolta e regola (5 s)'));
  // synth guitar (tab songs): on/off and volume
  let synOn = synthOn;
  const synBtn = onSynth ? domEl('button', {
    type: 'button', class: 'btn', id: 'btn-pp-synth', 'aria-pressed': String(synOn),
    onclick: () => { synOn = !synOn; paintSyn(); onSynth(synOn); },
  }) : null;
  const volInput = onSynth ? domEl('input', {
    type: 'range', id: 'pp-synth-vol', class: 'pp-vol', min: '0', max: '100', step: '1', value: String(Math.round(synthVolume * 100)), 'aria-label': 'Volume della chitarra',
    oninput: () => { if (onSynthVolume) onSynthVolume(Number(volInput.value) / 100); },
  }) : null;
  function paintSyn() {
    if (!synBtn) return;
    synBtn.setAttribute('aria-pressed', String(synOn));
    synBtn.textContent = synOn ? 'Chitarra: sì' : 'Chitarra: no';
    paintFlags();
  }
  const synRow = onSynth ? domEl('div', { class: 'pp-synth-row' }, synBtn, domEl('label', { class: 'pp-vol-lbl' }, 'Volume', volInput)) : null;
  const more = domEl('div', { class: 'pp-more', id: 'pp-more', hidden: true }, synRow, metroBtn, tapBtn, dgBtn, rhBtn, stopBtn, offRow);
  const moreBtn = domEl('button', {
    type: 'button', class: 'btn pp-more-btn', id: 'btn-more', 'aria-label': 'Altri comandi', 'aria-expanded': 'false', 'aria-controls': 'pp-more',
    onclick: () => {
      more.hidden = !more.hidden;
      moreBtn.setAttribute('aria-expanded', String(!more.hidden));
    },
  }, '⋯');
  const noticeText = domEl('span', null, '');
  const notice = domEl('div', { class: 'pp-notice', id: 'pp-notice', role: 'status', hidden: true }, noticeText,
    domEl('button', { type: 'button', class: 'btn icon', 'aria-label': 'Chiudi avviso', onclick: () => { notice.hidden = true; if (onNoticeClosed) onNoticeClosed(); } }, '×'));

  // ---- mini bar (round 13): what is left of the panel after a few seconds without touches ----
  const miniPlay = domEl('button', { type: 'button', class: 'btn primary pp-mini-play', id: 'btn-mini-play', 'aria-label': 'Avvia', onclick: (e) => { e.stopPropagation(); if (onPlayPause) onPlayPause(); } }, 'Play');
  const miniCur = domEl('span', { class: 'pp-mini-cur', id: 'pp-mini-cur' }, '–');
  const miniNext = domEl('span', { class: 'pp-mini-next', id: 'pp-mini-next' }, '');
  const miniTime = domEl('span', { class: 'pp-mini-time', id: 'pp-mini-time' }, '');
  const miniSpeed = domEl('span', { class: 'pp-mini-speed', id: 'pp-mini-speed', hidden: true }, '');
  const miniFlags = domEl('span', { class: 'pp-mini-flags', id: 'pp-mini-flags' }, '');
  const miniHandle = domEl('button', { type: 'button', class: 'btn pp-mini-handle', id: 'btn-mini-open', 'aria-label': 'Apri la barra', onclick: (e) => { e.stopPropagation(); expand(); } }, '▲');
  const miniBar = domEl('div', { class: 'pp-mini', id: 'pp-mini', role: 'button', tabindex: '0', 'aria-label': 'Barra ridotta: tocca per aprire', onclick: () => expand(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); } } },
    miniPlay, domEl('span', { class: 'pp-mini-chords' }, miniCur, domEl('span', { class: 'pp-mini-arrow', 'aria-hidden': 'true' }, '›'), miniNext), miniFlags, miniSpeed, miniTime, miniHandle);
  const full = domEl('div', { class: 'pp-full', id: 'pp-full' },
    notice,
    bpmNote,
    lockNote,
    domEl('div', { class: 'pp-row1' }, cur, next, playBtn),
    domEl('div', { class: 'pp-row2' }, dotsEl, bpmBox, scopeBtn, domEl('span', { class: 'pp-spacer' }), loopBadge, clickIcon, moreBtn),
    tempoRow,
    patEl,
    bpmEdit,
    speedEdit,
    more);
  const el = domEl('div', { class: 'playpanel', id: 'playpanel', role: 'region', 'aria-label': 'Riproduzione' }, full, miniBar);

  // collapse: after `collapseMs` without touches on the bar, never while something is being used
  let auto = !!autoCollapse;
  let collapsed = false;
  let collapseTimer = null;
  let pointerIsDown = false;
  const busy = () => !more.hidden || !bpmEdit.hidden || !speedEdit.hidden || !notice.hidden || !bpmNote.hidden || pointerIsDown
    || (typeof document !== 'undefined' && !!document.querySelector('.sheet, .dlg'));
  function arm() {
    if (collapseTimer !== null) clearTimeout(collapseTimer);
    collapseTimer = null;
    if (!auto || collapsed) return;
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      if (busy()) arm();
      else collapse();
    }, collapseMs);
  }
  function collapse() {
    if (collapsed) return;
    collapsed = true;
    el.classList.add('collapsed');
    el.dataset.collapsed = '1';
  }
  function expand() {
    if (collapsed) {
      collapsed = false;
      el.classList.remove('collapsed');
      el.dataset.collapsed = '0';
    }
    arm();
  }
  for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown', 'input', 'focusin']) el.addEventListener(ev, () => { if (!collapsed) arm(); }, true);
  el.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
  if (typeof window !== 'undefined') {
    for (const ev of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) window.addEventListener(ev, () => { pointerIsDown = false; });
  }
  el.dataset.collapsed = '0';

  let freeNow = false;
  let loopOn = false;
  function paintFlags() {
    miniFlags.textContent = (loopOn ? '🔁' : '') + (freeNow ? ' libero' : '') + (onSynth && synOn ? '🎸' : '');
  }
  paintScope();
  paintSpeed();
  arm();
  paintDg();
  paintRhythm();
  paintClick();
  paintSyn();

  function setDiagram(holder, label) {
    const key = label === null || !diagramSvg ? '' : label;
    if (holder.dataset.k === key) return;
    holder.dataset.k = key;
    holder.innerHTML = key ? diagramSvg(key) : '';
  }

  function renderPattern(strum, activeCell) {
    domClear(patEl);
    if (!strum) {
      patEl.hidden = true;
      return;
    }
    patEl.hidden = false;
    strum.beats.forEach((c, i) => {
      patEl.append(domEl('span', { class: 'pp-cell' + (c.onBeat ? ' on' : '') + (i === activeCell ? ' now' : ''), 'data-i': i },
        c.dir === 'D' ? '↓' : c.dir === 'U' ? '↑' : '·'));
    });
  }

  return {
    el,
    setPlayLabel(state) {
      const playing = state === 'playing' || state === 'counting';
      playBtn.textContent = playing ? 'Pausa' : 'Play';
      playBtn.setAttribute('aria-label', playing ? 'Pausa' : 'Avvia');
      miniPlay.textContent = playing ? 'Pausa' : 'Play';
      miniPlay.setAttribute('aria-label', playing ? 'Pausa' : 'Avvia');
    },
    // data: { state, countdown, event, nextEvent, beatsLeft, beatInBar, progress, bpm, strum, strumCell, firstColor }
    update(d) {
      cur.classList.toggle('gap', !!d.gap);
      // free tempo (round 12): the line of the bar says what the clicks do
      const free = !d.gap && !!d.free && d.state !== 'counting';
      cur.classList.toggle('free', free);
      curFree.hidden = !free;
      curGap.hidden = !d.gap;
      if (d.gap) {
        curGap.textContent = `Riprende tra ${d.gap.left} s${d.gap.label ? ` con «${d.gap.label}»` : ''}`;
        curName.classList.remove('count');
        curName.textContent = 'Fuori dal foglio';
        curName.style.removeProperty('--cc');
        setDiagram(curDg, null);
      } else if (d.state === 'counting') {
        curName.textContent = String(d.countdown);
        curName.style.removeProperty('--cc');
        curName.classList.add('count');
      } else {
        curName.classList.remove('count');
        const label = d.event ? d.curLabel || d.event.name : '–';
        curName.textContent = label;
        if (d.event) curName.style.setProperty('--cc', d.event.rest ? 'var(--muted)' : chordColorVar(song, d.event.name));
        setDiagram(curDg, d.event ? label : null);
      }
      if (d.state === 'counting') setDiagram(curDg, null);
      setDiagram(nextDg, d.nextEvent ? d.nextLabel || d.nextEvent.name : null);
      nextName.textContent = d.nextEvent ? d.nextLabel || d.nextEvent.name : '–';
      nextName.style.setProperty('--cc', d.nextEvent && !d.nextEvent.rest ? chordColorVar(song, d.nextEvent.name) : 'var(--muted)');
      nextBadge.textContent = d.nextEvent && d.beatsLeft > 0 ? String(d.beatsLeft) : '';
      dots.forEach((dot, i) => dot.classList.toggle('on', d.beatInBar === i));
      // effective tempo (scaled between anchors); "≈" when it differs from the saved one
      const approx = Number.isFinite(d.savedBpm) && Math.abs(d.bpm - d.savedBpm) > 0.2;
      // (in a gap the tempo of the sheet means nothing: no number, so that «≈153,7» does not show up for music that is not in it)
      const bpmText = d.gap ? '–' : approx ? `≈${formatBpm(Math.round(d.bpm * 10) / 10)}` : `=${formatBpm(d.bpm)}`;
      if (bpmEl.dataset.t !== bpmText) {
        bpmEl.dataset.t = bpmText;
        // the note glyph has a wide side bearing in most fonts: it sits in its own tight span
        bpmEl.replaceChildren(domEl('span', { class: 'pp-note' }, '♩'), bpmText);
      }
      bpmEl.dataset.v = formatBpm(Number.isFinite(d.savedBpm) ? d.savedBpm : d.bpm);
      // tempo control: the base is the tempo of the current section at 100% (kept through a gap)
      if (!d.gap && Number.isFinite(d.bpm) && d.bpm > 0 && Math.abs(d.bpm - baseBpm) > 1e-6) { baseBpm = d.bpm; paintSpeed(); }
      // mini bar
      if (d.gap) {
        miniCur.textContent = `Fuori foglio · ${d.gap.left} s`;
        miniCur.style.removeProperty('--cc');
      } else if (d.state === 'counting') {
        miniCur.textContent = String(d.countdown);
        miniCur.style.removeProperty('--cc');
      } else {
        miniCur.textContent = d.event ? d.curLabel || d.event.name : '–';
        if (d.event) miniCur.style.setProperty('--cc', d.event.rest ? 'var(--muted)' : chordColorVar(song, d.event.name));
        else miniCur.style.removeProperty('--cc');
      }
      miniNext.textContent = d.nextEvent ? d.nextLabel || d.nextEvent.name : '';
      miniNext.style.setProperty('--cc', d.nextEvent && !d.nextEvent.rest ? chordColorVar(song, d.nextEvent.name) : 'var(--muted)');
      freeNow = !d.gap && !!d.free && d.state !== 'counting';
      paintFlags();
      const key = (d.strum ? d.strum.beats.length : 'none') + ':' + d.strumId;
      if (key !== lastKey) {
        lastKey = key;
        renderPattern(d.strum, d.strumCell);
      } else if (d.strum) {
        const cells = patEl.children;
        for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('now', i === d.strumCell);
      }
    },
    // "+2 BPM su tutto il brano" with an undo button (audio mode); empty text hides it
    setBpmNote(text) {
      bpmNoteText.textContent = text || '';
      bpmNote.hidden = !text;
    },
    setBpmLocked(locked) {
      // − / +, the number field with «Applica» and both tap tempo buttons: the times come from the audio
      bpmMinus.disabled = bpmPlus.disabled = bpmField.disabled = applyBtn.disabled = tapBtn.disabled = tapBtn2.disabled = !!locked;
      lockNote.hidden = !locked;
      if (locked) bpmEdit.hidden = true;
    },
    setScope(v) {
      scope = v;
      paintScope();
    },
    closeBpmEdit() {
      bpmEdit.hidden = true;
    },
    showNotice(text) {
      noticeText.textContent = text;
      notice.hidden = !text;
    },
    setProgress(p) {
      curBar.firstChild.style.width = Math.round(p * 100) + '%';
    },
    getSpeed: () => speed,
    // restores the saved slowdown without firing onSpeed
    setSpeedPct(v) { setSpeed(v, false); },
    // "1:05 / 3:42" in the mini bar
    setTime(sec, total) {
      const f = (t) => { const x = Math.max(0, Math.floor(t)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
      const text = `${f(sec)} / ${f(total)}`;
      if (miniTime.textContent !== text) miniTime.textContent = text;
    },
    setAutoCollapse(on) {
      auto = !!on;
      if (!auto) expand();
      else arm();
    },
    expand,
    isCollapsed: () => collapsed,
    // updates the click button without firing onMetronome (mode switch between metronome and audio)
    setMetronomeState(on) {
      metro = !!on;
      metroBtn.setAttribute('aria-pressed', String(metro));
      metroBtn.textContent = metro ? 'Clic: sì' : 'Clic: no';
      paintClick();
    },
    // the synth state from outside (without firing onSynth)
    setSynthState(on) { synOn = !!on; paintSyn(); },
    // text of the offset control, or null to hide it (no audio)
    setOffset(text) {
      offRow.hidden = text === null;
      if (text !== null) offLbl.textContent = text;
    },
    setLoop(name) {
      loopBadge.hidden = !name;
      loopBadge.textContent = name ? `🔁 ${name}` : '';
      loopOn = !!name;
      paintFlags();
    },
  };
}
