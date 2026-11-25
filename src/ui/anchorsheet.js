// Bottom sheet to fine-tune or remove the anchor of one section (±10 / ±50 ms, remove).

import { domEl } from './dom.js';
import { formatClock, setAnchor, removeAnchor } from '../audiosync.js';

const FINE_MS = [-50, -10, 10, 50];

// `onChange()` runs after every change (the caller saves and redraws).
export function openAnchorSheet({ song, index, name, onChange }) {
  const audio = song.audio;
  if (!audio) return;
  const getT = () => (index === 0 ? audio.offsetSec : audio.anchors && audio.anchors[index]);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const time = domEl('p', { class: 'anchor-time', id: 'anchor-time' });
  const err = domEl('p', { class: 'msg error', role: 'status' });
  const paint = () => {
    const t = getT();
    time.textContent = t === undefined ? '' : `⚓ ${formatClock(t)} (${Math.round(t * 1000)} ms)`;
  };
  const nudge = (d) => {
    const t = getT();
    if (t === undefined) return;
    const r = setAnchor(audio, index, Math.max(0, t + d / 1000), song.sections.length);
    err.textContent = r.ok ? '' : r.reason;
    if (r.ok) {
      onChange();
      paint();
    }
  };
  const overlay = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ancora di ' + name },
    domEl('div', { class: 'sheet-card dlg anchor-sheet' },
      domEl('h2', { class: 'dlg-title' }, `Ancora: ${name}`),
      time,
      domEl('div', { class: 'row sync-fine' }, FINE_MS.map((d) => domEl('button', {
        type: 'button', class: 'btn', 'data-ms': d, 'aria-label': `${d > 0 ? '+' : '−'}${Math.abs(d)} millisecondi`,
        onclick: () => nudge(d),
      }, `${d > 0 ? '+' : '−'}${Math.abs(d)}`))),
      err,
      domEl('div', { class: 'dlg-btns' },
        index > 0 ? domEl('button', { type: 'button', class: 'btn danger', id: 'anchor-remove', onclick: () => { removeAnchor(audio, index); onChange(); close(); } }, 'Togli l’ancora') : null,
        domEl('button', { type: 'button', class: 'btn primary', id: 'anchor-close', onclick: close }, 'Chiudi'))));
  paint();
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  overlay.querySelector('#anchor-close').focus();
}
