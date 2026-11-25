// "Correggi a orecchio": the audio plays from 2 s before a section and the person taps "Cambio!" at every
// chord change they hear. The taps (corrected for the device latency by the player and for the average
// reaction delay) replace the start times of the section. A preview with highlight comes before saving;
// the section then becomes "verificata".

import { domEl } from './dom.js';
import { eventRefs, sectionEventIndices, previewReplace, replaceSectionStarts } from '../alignment.js';
import { tapsToStarts } from '../taprecord.js';
import { formatClock } from '../audiosync.js';
import { getDevice, saveDevice } from '../storage.js';
import { chordColorVar } from '../render.js';

export const CORRECT_LEAD_SEC = 2;
const REACTION_STEP_MS = 10;
const REACTION_MIN_MS = -200;
const REACTION_MAX_MS = 600;

// song, sectionIndex, name: what to correct. getPlayer(): the audio player of the sync screen.
// timelineWith(alignmentOrNull): timeline for an alignment (null = the saved one). addFrameListener(fn) -> remove().
// persist(): saves the song. onSaved(): runs after a successful save (the caller redraws).
export function openCorrection({ song, sectionIndex, name, getPlayer, timelineWith, addFrameListener, persist, onSaved }) {
  const alignment = song.audio.alignment;
  const refs = eventRefs(song);
  const idx = sectionEventIndices(song)[sectionIndex];
  const N = idx.length;
  let taps = [];
  let previewing = false;
  let reactionMs = Number.isFinite(getDevice().reactionMs) ? getDevice().reactionMs : 0;
  let lastCur = -2;

  const player = () => getPlayer();
  const status = domEl('p', { class: 'corr-status', id: 'corr-status', role: 'status' }, '');
  const count = domEl('div', { class: 'corr-count', id: 'corr-count' }, '');
  const chips = domEl('ol', { class: 'corr-chips', id: 'corr-chips' });
  const chipEls = idx.map((j, k) => {
    const li = domEl('li', { class: 'corr-chip', 'data-k': k, style: { '--cc': refs[j].rest ? 'var(--muted)' : chordColorVar(song, refs[j].name) } }, refs[j].rest ? '—' : refs[j].name);
    chips.append(li);
    return li;
  });
  const tapBtn = domEl('button', { type: 'button', class: 'btn primary corr-tap', id: 'corr-tap', 'aria-label': 'Cambio d’accordo adesso' }, 'Cambio!');
  const previewBtn = domEl('button', { type: 'button', class: 'btn', id: 'corr-preview', onclick: () => preview() }, 'Anteprima: ascolta');
  const saveBtn = domEl('button', { type: 'button', class: 'btn primary', id: 'corr-save', onclick: () => save() }, 'Salva');
  const undoBtn = domEl('button', { type: 'button', class: 'btn', id: 'corr-undo-tap', onclick: () => { taps.pop(); paint(); } }, 'Togli ultimo tocco');
  const restartBtn = domEl('button', { type: 'button', class: 'btn', id: 'corr-restart', onclick: () => restart() }, 'Ricomincia');
  const reactionLbl = domEl('span', { class: 'corr-react-val', id: 'corr-react-val' }, '');
  const stepReaction = (d) => {
    reactionMs = Math.min(REACTION_MAX_MS, Math.max(REACTION_MIN_MS, reactionMs + d));
    try { saveDevice({ ...getDevice(), reactionMs }); } catch { /* storage full: keep it for this session */ }
    paint();
  };
  const reaction = domEl('div', { class: 'corr-react' },
    domEl('span', null, 'Ritardo di reazione'),
    domEl('button', { type: 'button', class: 'btn icon', id: 'corr-react-down', 'aria-label': 'Meno 10 millisecondi', onclick: () => stepReaction(-REACTION_STEP_MS) }, '−'),
    reactionLbl,
    domEl('button', { type: 'button', class: 'btn icon', id: 'corr-react-up', 'aria-label': 'Più 10 millisecondi', onclick: () => stepReaction(REACTION_STEP_MS) }, '+'));

  function sectionStart() {
    const tl = timelineWith(null);
    return tl.sections[sectionIndex] ? tl.sections[sectionIndex].startSec : 0;
  }

  function restart() {
    const p = player();
    if (!p) return;
    taps = [];
    previewing = false;
    p.setMetronome(false);
    p.setTimeline(timelineWith(null));
    p.playFromTime(Math.max(0, sectionStart() - CORRECT_LEAD_SEC));
    setStatus(`Tocca «Cambio!» a ogni cambio d’accordo (sono ${N}, il primo compreso).`);
    paint();
  }

  function setStatus(t, error = false) {
    status.textContent = t;
    status.classList.toggle('error', !!error);
  }

  function tap() {
    const p = player();
    if (!p || p.getState() !== 'playing' || previewing) {
      setStatus(previewing ? 'Stai ascoltando l’anteprima: premi «Ricomincia» per registrare di nuovo.' : 'Prima fai partire l’audio con «Ricomincia».', true);
      return;
    }
    if (taps.length >= N) {
      setStatus(`Hai già toccato ${N} volte: premi «Anteprima» o «Togli ultimo tocco».`, true);
      return;
    }
    taps.push(p.currentTime());
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* ignore */ } }
    if (taps.length === N) setStatus('Fatto: ascolta l’anteprima e poi salva.');
    paint();
  }
  tapBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    tap();
  });
  tapBtn.addEventListener('click', (e) => { if (e.detail === 0) tap(); }); // keyboard

  function result() {
    return tapsToStarts({ tapTimesSec: taps, eventCount: N, reactionSec: reactionMs / 1000 });
  }

  function preview() {
    const p = player();
    if (!p) return;
    const r = result();
    if (!r.ok) {
      setStatus(`Servono ${N} tocchi, ne hai ${r.count}.`, true);
      return;
    }
    const pr = previewReplace(alignment, song, sectionIndex, r.starts);
    if (!pr.ok) {
      setStatus(pr.reason, true);
      return;
    }
    previewing = true;
    p.setTimeline(timelineWith(pr.alignment));
    p.playFromTime(Math.max(0, r.starts[0] - 1.5));
    setStatus('Anteprima: l’accordo evidenziato deve cambiare insieme a quello che senti.');
    paint();
  }

  function save() {
    const r = result();
    if (!r.ok) {
      setStatus(`Servono ${N} tocchi, ne hai ${r.count}.`, true);
      return;
    }
    const res = replaceSectionStarts(alignment, song, sectionIndex, r.starts);
    if (!res.ok) {
      setStatus(res.reason, true);
      return;
    }
    persist();
    close(true);
  }

  function paint() {
    count.textContent = `${taps.length} / ${N} cambi`;
    chipEls.forEach((c, k) => {
      c.classList.toggle('tapped', k < taps.length);
      c.classList.toggle('next', !previewing && k === taps.length);
    });
    reactionLbl.textContent = `${reactionMs} ms`;
    const full = taps.length === N;
    previewBtn.disabled = !full;
    saveBtn.disabled = !full;
    undoBtn.disabled = taps.length === 0;
  }

  const removeFrame = addFrameListener((info) => {
    if (!previewing) return;
    const cur = info.eventIndex - idx[0];
    if (cur === lastCur) return;
    lastCur = cur;
    chipEls.forEach((c, k) => { c.classList.toggle('now', k === cur); c.classList.toggle('tapped', previewing); });
  });

  function close(saved) {
    removeFrame();
    document.removeEventListener('keydown', onKey);
    const p = player();
    if (p) {
      p.pause();
      p.setTimeline(timelineWith(null));
    }
    overlay.remove();
    if (saved && onSaved) onSaved();
  }
  const onKey = (e) => { if (e.key === 'Escape') close(false); };

  const overlay = domEl('div', { class: 'rec corr', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Correggi a orecchio' },
    domEl('div', { class: 'sync-head' },
      domEl('div', { class: 'rec-title' }, `Correggi a orecchio: ${name}`),
      domEl('button', { type: 'button', class: 'btn', id: 'corr-close', onclick: () => close(false) }, 'Annulla')),
    domEl('p', { class: 'muted small' }, `L’audio parte ${CORRECT_LEAD_SEC} secondi prima della sezione (da ${formatClock(Math.max(0, sectionStart() - CORRECT_LEAD_SEC))}). Tocca «Cambio!» appena senti cambiare l’accordo.`),
    count,
    chips,
    status,
    tapBtn,
    domEl('div', { class: 'row' }, undoBtn, restartBtn),
    reaction,
    domEl('div', { class: 'row corr-final' }, previewBtn, saveBtn));
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  paint();
  restart();
  return () => close(false);
}
