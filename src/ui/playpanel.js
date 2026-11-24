// Fixed bottom panel shown during playback: current / next chord, bar dots, strumming pattern,
// section tempo and the transport controls.

import { domEl, domClear } from './dom.js';
import { chordColorVar, formatBpm } from '../render.js';

const SPEED_MIN = 50;
const SPEED_MAX = 100;

export function createPlayPanel(song, { onPlayPause, onStop, onSpeed, onMetronome, onTap, speedPct = 100, metronomeOn = true }) {
  const perBar = (song.timeSignature && song.timeSignature[0]) || 4;
  let speed = speedPct;
  let metro = metronomeOn;
  let lastKey = '';

  const curName = domEl('div', { class: 'pp-cur-name', id: 'pp-current' }, '–');
  const curBar = domEl('div', { class: 'pp-cur-bar' }, domEl('div', { class: 'pp-cur-fill' }));
  const cur = domEl('div', { class: 'pp-cur' }, curName, curBar);
  const nextName = domEl('span', { class: 'pp-next-name', id: 'pp-next' }, '–');
  const nextBadge = domEl('span', { class: 'pp-badge', id: 'pp-left', title: 'Battiti al cambio' }, '');
  const next = domEl('div', { class: 'pp-next' }, domEl('span', { class: 'pp-next-lbl' }, 'Prossimo'), nextName, nextBadge);
  const dots = [];
  const dotsEl = domEl('div', { class: 'pp-dots', 'aria-hidden': 'true' });
  for (let i = 0; i < perBar; i++) {
    const d = domEl('span', { class: 'pp-dot' + (i === 0 ? ' acc' : '') });
    dots.push(d);
    dotsEl.append(d);
  }
  const bpmEl = domEl('span', { class: 'pp-bpm', id: 'pp-bpm' }, '');
  const patEl = domEl('div', { class: 'pp-pat', id: 'pp-pattern' });
  const info = domEl('div', { class: 'pp-info' }, bpmEl, patEl);

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
  const ctrl = domEl('div', { class: 'pp-ctrl' }, playBtn, stopBtn, speedBox, metroBtn, tapBtn);

  const el = domEl('div', { class: 'playpanel', id: 'playpanel', role: 'region', 'aria-label': 'Riproduzione' },
    domEl('div', { class: 'pp-top' }, cur, next),
    domEl('div', { class: 'pp-mid' }, dotsEl, info),
    ctrl);

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
        curName.textContent = d.event ? d.event.name : '–';
        if (d.event) curName.style.setProperty('--cc', chordColorVar(song, d.event.name));
      }
      nextName.textContent = d.nextEvent ? d.nextEvent.name : '–';
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
    setProgress(p) {
      curBar.firstChild.style.width = Math.round(p * 100) + '%';
    },
    getSpeed: () => speed,
  };
}
