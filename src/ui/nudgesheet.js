// Bottom sheet for the quick fine correction of the automatic sync: move a chord (alone, or with the ones after it in its
// section) or a whole section a little earlier or later, listen, undo.

import { domEl } from './dom.js';
import { formatClock } from '../audiosync.js';
import { nudgeEvent, nudgeSection, snapshotTimes, restoreTimes } from '../alignment.js';

const NUDGE_STEPS = [-0.25, -0.05, 0.05, 0.25];
const NUDGE_LISTEN_LEAD = 2;
const NUDGE_LISTEN_TAIL = 2;

const fmtStep = (d) => `${d > 0 ? '+' : '−'}${String(Math.abs(d)).replace('.', ',')}`;

// kind 'event': index = chord index (reading order); 'section': index = section index.
// getPlayer(): the audio player (or null); onChange(): called after every change (the caller saves and redraws).
export function openNudgeSheet({ song, kind, index, name, getPlayer, onChange }) {
  const alignment = song.audio && song.audio.alignment;
  if (!alignment) return;
  const undo = [];
  let following = false;
  let stopTimer = null;
  const timeOf = () => {
    if (kind === 'event') return alignment.eventStartSec[index] + (alignment.shiftSec || 0);
    return (alignment.sections[index].startSec ?? 0) + (alignment.shiftSec || 0);
  };
  const close = () => {
    if (stopTimer) clearTimeout(stopTimer);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const time = domEl('p', { class: 'anchor-time', id: 'nudge-time' });
  const msg = domEl('p', { class: 'msg', role: 'status', id: 'nudge-msg' });
  const undoBtn = domEl('button', { type: 'button', class: 'btn', id: 'nudge-undo', disabled: true, onclick: () => {
    const snap = undo.pop();
    if (!snap) return;
    restoreTimes(alignment, snap);
    msg.textContent = 'Ritocco annullato.';
    onChange();
    paint();
  } }, 'Annulla');
  const paint = () => {
    time.textContent = `${name} · ${formatClock(timeOf())}`;
    undoBtn.disabled = undo.length === 0;
  };
  const step = (d) => {
    const snap = snapshotTimes(alignment);
    const r = kind === 'event' ? nudgeEvent(alignment, song, index, d, { following }) : nudgeSection(alignment, song, index, d);
    if (!r.ok) { msg.textContent = r.reason; msg.className = 'msg error'; return; }
    undo.push(snap);
    msg.className = 'msg';
    msg.textContent = Math.abs(r.applied - d) > 1e-9 ? `Spostato di ${String(r.applied).replace('.', ',')} s (più di così non c’è spazio).` : '';
    onChange();
    paint();
  };
  const listen = () => {
    const p = getPlayer && getPlayer();
    if (!p) return;
    const t = timeOf();
    p.playFromTime(Math.max(0, t - NUDGE_LISTEN_LEAD));
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => { try { p.pause(); } catch { /* already stopped */ } }, (NUDGE_LISTEN_LEAD + NUDGE_LISTEN_TAIL) * 1000);
  };
  const scope = kind === 'event'
    ? domEl('div', { class: 'nudge-scope', role: 'radiogroup', 'aria-label': 'Cosa spostare' },
      ...[['Solo questo accordo', false], ['Questo e i seguenti della sezione', true]].map(([label, val]) => domEl('label', { class: 'nudge-opt' },
        domEl('input', { type: 'radio', name: 'nudge-scope', value: val ? 'following' : 'one', checked: val === following, onchange: () => { following = val; } }), ' ' + label)))
    : null;
  const overlay = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ritocco di ' + name },
    domEl('div', { class: 'sheet-card dlg nudge-sheet' },
      domEl('h2', { class: 'dlg-title' }, kind === 'event' ? 'Sposta accordo' : 'Sposta sezione'),
      time,
      scope,
      domEl('div', { class: 'row sync-fine' }, NUDGE_STEPS.map((d) => domEl('button', {
        type: 'button', class: 'btn', 'data-s': d, 'aria-label': `${d > 0 ? 'Più tardi' : 'Più presto'} di ${Math.abs(d)} secondi`, onclick: () => step(d),
      }, `${fmtStep(d)} s`))),
      msg,
      domEl('div', { class: 'dlg-btns' },
        domEl('button', { type: 'button', class: 'btn', id: 'nudge-listen', onclick: listen }, 'Ascolta da qui'),
        undoBtn,
        domEl('button', { type: 'button', class: 'btn primary', id: 'nudge-close', onclick: close }, 'Chiudi'))));
  paint();
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  overlay.querySelector('#nudge-close').focus();
  return close;
}
