// Fixed bottom panel shown during playback: current / next chord, bar dots, strumming pattern,
// section tempo and the transport controls.

import { domEl, domClear } from './dom.js';
import { chordColorVar, formatBpm } from '../render.js';

const SPEED_MIN = 50;
const SPEED_MAX = 100;

// `diagramSvg(label)` (optional) returns the small SVG of a chord shown next to its name.
export function createPlayPanel(song, { onLoopExit = null, onPlayPause, onStop, onSpeed, onMetronome, onTap, speedPct = 100, metronomeOn = true, diagramSvg = null, diagramsOn = true, onDiagrams = null, onNoticeClosed = null, onBpmStep = null, onBpmSet = null, onScope = null, onBpmUndo = null, bpmScope = 'all' }) {
  const perBar = (song.timeSignature && song.timeSignature[0]) || 4;
  let speed = speedPct;
  let metro = metronomeOn;
  let lastKey = '';

  const curName = domEl('div', { class: 'pp-cur-name', id: 'pp-current' }, '–');
  const curDg = domEl('span', { class: 'pp-dg', id: 'pp-current-dg' });
  const curBar = domEl('div', { class: 'pp-cur-bar' }, domEl('div', { class: 'pp-cur-fill' }));
  const cur = domEl('div', { class: 'pp-cur' }, domEl('div', { class: 'pp-cur-main' }, curDg, curName), curBar);
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
  function holdButton(id, label, dir, aria) {
    let timer = null;
    let iv = null;
    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      if (iv !== null) clearInterval(iv);
      timer = iv = null;
    };
    const step = () => { if (onBpmStep) onBpmStep(dir); };
    const b = domEl('button', { type: 'button', class: 'btn icon pp-bpm-step', id, 'aria-label': aria }, label);
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
  const bpmEdit = domEl('div', { class: 'pp-bpmedit', id: 'pp-bpmedit', hidden: true },
    bpmField,
    scopeBtn2,
    domEl('button', { type: 'button', class: 'btn primary small', id: 'pp-bpm-apply', onclick: () => { const v = parseFloat(String(bpmField.value).replace(',', '.')); if (onBpmSet && onBpmSet(v) !== false) bpmEdit.hidden = true; } }, 'Applica'),
    domEl('button', { type: 'button', class: 'btn small', onclick: () => { if (onTap) onTap(); } }, 'Tap tempo'),
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
  const patEl = domEl('div', { class: 'pp-pat', id: 'pp-pattern' });

  const playBtn = domEl('button', { type: 'button', class: 'btn primary pp-play', id: 'btn-play', 'aria-label': 'Avvia', onclick: onPlayPause }, 'Play');
  const stopBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-stop', 'aria-label': 'Ferma e torna all’inizio', onclick: onStop }, 'Stop');
  const speedLbl = domEl('span', { class: 'pp-speed-val', id: 'pp-speed' }, speed + '%');
  const setSpeed = (v) => {
    speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
    speedLbl.textContent = speed + '%';
    onSpeed(speed / 100);
  };
  const speedBox = domEl('div', { class: 'pp-speed', 'aria-label': 'Velocità' },
    domEl('button', { type: 'button', class: 'btn icon', id: 'btn-speed-down', 'aria-label': 'Più lento', onclick: () => setSpeed(speed - 5) }, '−'),
    speedLbl,
    domEl('button', { type: 'button', class: 'btn icon', id: 'btn-speed-up', 'aria-label': 'Più veloce', onclick: () => setSpeed(speed + 5) }, '+'));
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
  const more = domEl('div', { class: 'pp-more', id: 'pp-more', hidden: true }, speedBox, metroBtn, tapBtn, dgBtn, stopBtn);
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

  const el = domEl('div', { class: 'playpanel', id: 'playpanel', role: 'region', 'aria-label': 'Riproduzione' },
    notice,
    bpmNote,
    domEl('div', { class: 'pp-row1' }, cur, next, playBtn),
    domEl('div', { class: 'pp-row2' }, dotsEl, bpmBox, scopeBtn, patEl, loopBadge, clickIcon, moreBtn),
    bpmEdit,
    more);

  paintScope();
  paintDg();
  paintClick();

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
    },
    // data: { state, countdown, event, nextEvent, beatsLeft, beatInBar, progress, bpm, strum, strumCell, firstColor }
    update(d) {
      if (d.state === 'counting') {
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
      bpmEl.textContent = approx ? `♩ ≈ ${formatBpm(Math.round(d.bpm * 10) / 10)}` : `♩ = ${formatBpm(d.bpm)}`;
      bpmEl.dataset.v = formatBpm(Number.isFinite(d.savedBpm) ? d.savedBpm : d.bpm);
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
    // updates the click button without firing onMetronome (mode switch between metronome and audio)
    setMetronomeState(on) {
      metro = !!on;
      metroBtn.setAttribute('aria-pressed', String(metro));
      metroBtn.textContent = metro ? 'Clic: sì' : 'Clic: no';
      paintClick();
    },
    setLoop(name) {
      loopBadge.hidden = !name;
      loopBadge.textContent = name ? `🔁 ${name}` : '';
    },
  };
}
