// Fixed bottom panel shown during playback: current / next chord, bar dots, strumming pattern,
// section tempo and the transport controls.

import { domEl, domClear } from './dom.js';
import { chordColorVar, formatBpm } from '../render.js';

const SPEED_MIN = 50;
const SPEED_MAX = 100;

// `diagramSvg(label)` (optional) returns the small SVG of a chord shown next to its name.
export function createPlayPanel(song, { onPlayPause, onStop, onSpeed, onMetronome, onTap, speedPct = 100, metronomeOn = true, diagramSvg = null }) {
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
  const bpmEl = domEl('span', { class: 'pp-bpm', id: 'pp-bpm' }, '');
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
      onMetronome(metro);
    },
  }, metro ? 'Clic: sì' : 'Clic: no');
  const tapBtn = domEl('button', { type: 'button', class: 'btn', id: 'btn-tap', onclick: onTap }, 'Tap tempo');
  const more = domEl('div', { class: 'pp-more', id: 'pp-more', hidden: true }, speedBox, metroBtn, tapBtn, stopBtn);
  const moreBtn = domEl('button', {
    type: 'button', class: 'btn pp-more-btn', id: 'btn-more', 'aria-label': 'Altri comandi', 'aria-expanded': 'false', 'aria-controls': 'pp-more',
    onclick: () => {
      more.hidden = !more.hidden;
      moreBtn.setAttribute('aria-expanded', String(!more.hidden));
    },
  }, '⋯');
  const noticeText = domEl('span', null, '');
  const notice = domEl('div', { class: 'pp-notice', id: 'pp-notice', role: 'status', hidden: true }, noticeText,
    domEl('button', { type: 'button', class: 'btn icon', 'aria-label': 'Chiudi avviso', onclick: () => { notice.hidden = true; } }, '×'));

  const el = domEl('div', { class: 'playpanel', id: 'playpanel', role: 'region', 'aria-label': 'Riproduzione' },
    notice,
    domEl('div', { class: 'pp-row1' }, cur, next, playBtn),
    domEl('div', { class: 'pp-row2' }, dotsEl, bpmEl, patEl, moreBtn),
    more);

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
        if (d.event) curName.style.setProperty('--cc', chordColorVar(song, d.event.name));
        setDiagram(curDg, d.event ? label : null);
      }
      if (d.state === 'counting') setDiagram(curDg, null);
      setDiagram(nextDg, d.nextEvent ? d.nextLabel || d.nextEvent.name : null);
      nextName.textContent = d.nextEvent ? d.nextLabel || d.nextEvent.name : '–';
      nextName.style.setProperty('--cc', d.nextEvent ? chordColorVar(song, d.nextEvent.name) : 'var(--muted)');
      nextBadge.textContent = d.nextEvent && d.beatsLeft > 0 ? String(d.beatsLeft) : '';
      dots.forEach((dot, i) => dot.classList.toggle('on', d.beatInBar === i));
      bpmEl.textContent = `♩ = ${formatBpm(d.bpm)}`;
      const key = (d.strum ? d.strum.beats.length : 'none') + ':' + d.strumId;
      if (key !== lastKey) {
        lastKey = key;
        renderPattern(d.strum, d.strumCell);
      } else if (d.strum) {
        const cells = patEl.children;
        for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('now', i === d.strumCell);
      }
    },
    showNotice(text) {
      noticeText.textContent = text;
      notice.hidden = !text;
    },
    setProgress(p) {
      curBar.firstChild.style.width = Math.round(p * 100) + '%';
    },
    getSpeed: () => speed,
  };
}
