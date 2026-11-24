// Tap recording overlay: the metronome plays from the start of the chosen span, the user taps a
// big button at every chord change; the taps are quantized to beats (taprecord.js).

import { domEl, domClear } from './dom.js';
import { chordColorVar } from '../render.js';
import { quantizeTaps, suspiciousDurations } from '../taprecord.js';
import { beatPositionAtTime } from '../timeline.js';
import { displayChordName } from '../transpose.js';

// Opens the overlay. `span` = { firstEventIndex, eventCount, label }. `player` is the shared
// player; `getTimeline()` returns the current timeline. `onSave(beats)` receives the new
// durations of the span; `onClose()` runs when the overlay is gone.
export function openRecorder({ song, player, getTimeline, span, onSave, onClose }) {
  const tl = getTimeline();
  const events = tl.events;
  const taps = [];
  let finished = false;
  let seen = false;
  let endTime = null;

  const close = () => {
    player.stop();
    clearInterval(poll);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const title = domEl('div', { class: 'rec-title' }, `Registra: ${span.label}`);
  const status = domEl('div', { class: 'rec-status', id: 'rec-status', role: 'status' }, '');
  const expName = domEl('div', { class: 'rec-exp', id: 'rec-expected' }, '');
  const nextName = domEl('div', { class: 'rec-next', id: 'rec-next' }, '');
  const info = domEl('div', { class: 'rec-info' }, status, expName, nextName);
  const tapBtn = domEl('button', { type: 'button', class: 'rec-tap', id: 'rec-tap', onclick: () => onTap() }, 'Cambio!');
  const endBtn = domEl('button', { type: 'button', class: 'btn', id: 'rec-end', onclick: () => finish(true) }, 'Fine');
  const cancelBtn = domEl('button', { type: 'button', class: 'btn', id: 'rec-cancel', onclick: close }, 'Annulla');
  const bar = domEl('div', { class: 'rec-bar' }, cancelBtn, endBtn);
  const overlay = domEl('div', { class: 'rec', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Registrazione col tap' },
    title, info, tapBtn, bar);

  function refresh() {
    if (finished) return;
    const st = player.getState();
    const done = taps.length;
    const e = events[span.firstEventIndex + Math.min(done, span.eventCount - 1)];
    const n = events[span.firstEventIndex + Math.min(done + 1, span.eventCount - 1)];
    if (st === 'counting') {
      status.textContent = 'Conteggio: ' + player.getInfo().countdown;
    } else {
      status.textContent = `Accordo ${Math.min(done + 1, span.eventCount)} di ${span.eventCount}`;
    }
    expName.textContent = e ? displayChordName(song, e.name) : '';
    if (e) expName.style.setProperty('--cc', chordColorVar(song, e.name));
    const hasNext = done + 1 < span.eventCount;
    nextName.textContent = hasNext && n ? 'Poi: ' + displayChordName(song, n.name) : done + 1 === span.eventCount ? 'Ultimo accordo: tocca per chiuderlo' : '';
    if (st === 'counting' || st === 'playing') seen = true;
    if (seen && st === 'stopped' && !finished) finish(false);
  }
  const poll = setInterval(refresh, 50);

  function onTap() {
    if (finished || player.getState() !== 'playing') return;
    const now = player.currentTime();
    const prev = taps.length ? taps[taps.length - 1] : events[span.firstEventIndex].startSec;
    // double tap (less than half a beat after the previous one): ignored, as in quantizeTaps
    if (beatPositionAtTime(tl, now) - beatPositionAtTime(tl, prev) < 0.5) return;
    taps.push(now);
    if (taps.length >= span.eventCount) finish(false);
    refresh();
  }

  function finish(useEnd) {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    if (useEnd) endTime = player.currentTime();
    player.stop();
    const result = quantizeTaps({ tapTimesSec: taps, timeline: tl, firstEventIndex: span.firstEventIndex, eventCount: span.eventCount, endTimeSec: endTime });
    showPreview(result);
  }

  function showPreview(result) {
    domClear(overlay);
    const rows = domEl('ul', { class: 'rec-rows', id: 'rec-rows' });
    let changed = 0;
    const odd = suspiciousDurations(result);
    result.forEach((beats, k) => {
      const ev = events[span.firstEventIndex + k];
      if (beats !== ev.beats) changed++;
      rows.append(domEl('li', { class: (beats !== ev.beats ? 'chg' : '') + (odd[k] ? ' warn' : '') },
        domEl('span', { class: 'rec-row-name', style: { '--cc': chordColorVar(song, ev.name) } }, displayChordName(song, ev.name)),
        odd[k] ? domEl('span', { class: 'rec-warn' }, 'forse hai saltato un tocco qui') : null,
        domEl('span', { class: 'rec-row-val' }, `${ev.beats} → ${beats}`)));
    });
    const oddCount = odd.filter(Boolean).length;
    overlay.append(
      domEl('div', { class: 'rec-title' }, 'Durate registrate'),
      domEl('p', { class: 'rec-sum', id: 'rec-summary' }, changed ? `${changed} accordi cambiati su ${result.length}` : 'Nessuna durata cambiata'),
      oddCount ? domEl('p', { class: 'rec-warn-sum', id: 'rec-warn-sum' }, `${oddCount} durate sospette: forse hai saltato un tocco. Controlla le righe evidenziate o scarta e riprova.`) : null,
      rows,
      domEl('div', { class: 'rec-bar' },
        domEl('button', { type: 'button', class: 'btn', id: 'rec-discard', onclick: close }, 'Scarta'),
        domEl('button', { type: 'button', class: 'btn primary', id: 'rec-save', onclick: () => { onSave(result); close(); } }, 'Salva')));
  }

  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  refresh();
  player.playFromEvent(span.firstEventIndex);
}
