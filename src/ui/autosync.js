// "Sincronizza automaticamente": the box of the sync screen that runs the analysis of the audio, shows the
// summary by section (colour = how much to trust it), lets the person listen, correct a section by ear,
// accept, redo or discard, and exports the sections verified by ear.

import { domEl, domClear } from './dom.js';
import { runAutoSync, AUTOSYNC_CANCELLED } from './audiodecode.js';
import { openCorrection } from './correct.js';
import { eventRefs, sectionState, sectionEventIndices, alignmentFits, countVerified, shiftAlignment, applyMeasuredTiming, exportTruth } from '../alignment.js';
import { formatClock } from '../audiosync.js';
import { formatBpm } from '../render.js';

const AS_STATE_TEXT = {
  green: 'sicura',
  yellow: 'da controllare',
  red: 'incerta',
  verified: 'verificata ✓',
};
const AS_SHIFT_MS = [-100, -50, 50, 100];
const AS_LEAD_SEC = 2;

export function describeSemitones(n) {
  const a = Math.abs(n);
  return `${a} ${a === 1 ? 'semitono' : 'semitoni'} ${n > 0 ? 'sopra' : 'sotto'}`;
}

// Opens a download of a text file (the verified corrections).
function asDownload(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = domEl('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// song: the song (song.audio.alignment is read and written); getBlob(): the audio Blob or null;
// getPlayer(): the audio player; timelineWith(alignment|null): timeline; persist(): saves the song;
// rebuild(): rebuilds the player timeline and saves; setMsg(text, error); addFrameListener(fn) -> remove().
export function createAutoSyncPanel({ song, getBlob, getPlayer, timelineWith, persist, rebuild, setMsg, addFrameListener, onChange }) {
  const el = domEl('section', { class: 'sync-box as-box', id: 'as-box' });
  let running = false;
  let cancel = false;
  let progress = 0;
  let progressLabel = '';
  let stats = null;
  let nowText = '';
  let lastEv = -2;
  let progBar = null;
  let progText = null;
  const secName = (i) => song.sections[i].name || `Sezione ${i + 1}`;
  const getAlign = () => (song.audio && song.audio.alignment) || null;

  async function start() {
    const blob = getBlob();
    if (!blob || running) return;
    const old = getAlign();
    if (old && countVerified(old) > 0 && !window.confirm(`Rifacendo la sincronizzazione perdi le ${countVerified(old)} sezioni verificate a orecchio. Continuare?`)) return;
    const p = getPlayer();
    if (p) p.pause();
    running = true;
    cancel = false;
    progress = 0;
    progressLabel = 'Preparo…';
    stats = null;
    refresh();
    try {
      const r = await runAutoSync({
        song,
        blob,
        shouldCancel: () => cancel,
        onProgress: (f, label) => { progress = f; progressLabel = label; paintProgress(); },
      });
      song.audio.alignment = r.alignment;
      const first = r.alignment.eventStartSec[0];
      song.audio.offsetSec = Math.max(0, first);
      stats = r.stats;
      window.__gappAutosync = { ...r.stats, events: r.alignment.eventStartSec.length, transposeFound: r.alignment.transposeFound };
      running = false;
      rebuild();
      setMsg(`Sincronizzazione pronta in ${(r.stats.totalMs / 1000).toFixed(1)} s. Ascolta e controlla le sezioni gialle e rosse.`);
    } catch (err) {
      running = false;
      if (err && err.message === AUTOSYNC_CANCELLED) setMsg('Sincronizzazione annullata.');
      else if (err && err.message === 'decode') setMsg('Questo telefono non riesce a decodificare il file audio (formato non supportato o memoria insufficiente). Prova con un mp3 più piccolo, oppure usa la sincronizzazione manuale qui sotto.', true);
      else if (err && err.message === 'no-alignment') setMsg('Non sono riuscito ad allineare questo brano all’audio. Usa la sincronizzazione manuale qui sotto.', true);
      else setMsg('Errore durante l’analisi: ' + (err && err.message ? err.message : 'sconosciuto') + '. Se il telefono è lento o con poca memoria, usa la sincronizzazione manuale.', true);
    }
    refresh();
    if (onChange) onChange();
  }

  function paintProgress() {
    // while decoding (native, no way to know how far it is) the bar is indeterminate
    const known = progress >= 0.1;
    if (progBar) { if (known) progBar.value = progress; else progBar.removeAttribute('value'); }
    if (progText) progText.textContent = known ? `${progressLabel} ${Math.round(progress * 100)}%` : progressLabel;
  }

  function listenFrom(sec, click = false) {
    const p = getPlayer();
    if (!p) return;
    p.setMetronome(click);
    p.playFromTime(Math.max(0, sec));
  }

  function discard() {
    if (!window.confirm('Scartare la sincronizzazione automatica? Le correzioni a orecchio andranno perse.')) return;
    delete song.audio.alignment;
    rebuild();
    refresh();
    if (onChange) onChange();
  }

  function renderSummary(a) {
    const tl = timelineWith(null);
    const idx = sectionEventIndices(song);
    const refs = eventRefs(song);
    const counts = { green: 0, yellow: 0, red: 0, verified: 0 };
    const rows = domEl('ul', { class: 'as-rows', id: 'as-rows' });
    song.sections.forEach((_, si) => {
      if (!idx[si].length) return;
      const st = sectionState(a, si);
      counts[st]++;
      const s = a.sections[si];
      const tsec = tl.sections[si];
      rows.append(domEl('li', { class: 'as-row', 'data-sec': si, 'data-state': st },
        domEl('span', { class: 'as-dot', 'aria-hidden': 'true' }),
        domEl('div', { class: 'as-info' },
          domEl('div', { class: 'as-top' }, domEl('span', { class: 'as-name' }, secName(si)), domEl('span', { class: 'as-time' }, formatClock(tsec ? tsec.startSec : 0))),
          domEl('div', { class: 'as-sub' }, `${AS_STATE_TEXT[st]} · ${s.bpm === null ? 'tempo libero' : formatBpm(s.bpm) + ' BPM'} · ${idx[si].length} accordi`)),
        domEl('div', { class: 'as-btns' },
          domEl('button', { type: 'button', class: 'btn small', 'data-act': 'listen', onclick: () => listenFrom((tsec ? tsec.startSec : 0) - 1) }, 'Ascolta'),
          domEl('button', {
            type: 'button', class: 'btn small' + (st === 'yellow' || st === 'red' ? ' primary' : ''), 'data-act': 'correct', 'aria-label': `Correggi a orecchio ${secName(si)}`,
            onclick: () => correct(si),
          }, 'Correggi a orecchio'))));
    });
    return { rows, counts, refs };
  }

  function correct(si) {
    openCorrection({
      song,
      sectionIndex: si,
      name: secName(si),
      getPlayer,
      timelineWith,
      addFrameListener,
      persist,
      onSaved: () => { rebuild(); setMsg(`«${secName(si)}» verificata a orecchio.`); refresh(); if (onChange) onChange(); },
    });
  }

  function exportCorrections(a) {
    const t = exportTruth(song, a);
    if (!t.sections.length) return;
    const base = (song.title || 'brano').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brano';
    asDownload(`correzioni-${base}.json`, JSON.stringify(t, null, 1));
    setMsg(`Esportate ${t.sections.length} sezioni verificate (solo tempi e nomi degli accordi).`);
  }

  function refresh() {
    domClear(el);
    progBar = progText = null;
    el.append(domEl('h3', null, 'Sincronizzazione automatica'));
    const blob = getBlob();
    const a = getAlign();
    if (running) {
      progBar = domEl('progress', { id: 'as-progress', max: '1', value: String(progress), 'aria-label': 'Avanzamento dell’analisi' });
      progText = domEl('p', { class: 'as-prog-text', id: 'as-prog-text', role: 'status' }, '');
      el.append(
        domEl('p', { class: 'muted' }, 'L’app sta ascoltando il brano: può volerci qualche decina di secondi. Tieni lo schermo acceso.'),
        progBar, progText,
        domEl('button', { type: 'button', class: 'btn danger', id: 'as-cancel', onclick: () => { cancel = true; progressLabel = 'Annullo…'; paintProgress(); } }, 'Annulla'));
      paintProgress();
      return;
    }
    if (!blob) {
      el.append(domEl('p', { class: 'muted' }, 'Carica di nuovo il file audio per sincronizzare.'));
      return;
    }
    if (a && !alignmentFits(a, song)) {
      el.append(
        domEl('p', { class: 'msg error', id: 'as-stale' }, 'Gli accordi del foglio sono cambiati dopo la sincronizzazione: non corrisponde più. Rifallo, oppure scartala.'),
        domEl('div', { class: 'row' },
          domEl('button', { type: 'button', class: 'btn primary', id: 'as-start', onclick: start }, 'Sincronizza automaticamente'),
          domEl('button', { type: 'button', class: 'btn danger', id: 'as-discard', onclick: discard }, 'Scarta')));
      return;
    }
    if (!a) {
      el.append(
        domEl('p', { class: 'muted' }, 'L’app ascolta il file e trova da sola l’inizio del brano, il tempo e il momento in cui cambia ogni accordo. Poi controlli e correggi le parti incerte.'),
        domEl('button', { type: 'button', class: 'btn primary as-start', id: 'as-start', onclick: start }, 'Sincronizza automaticamente'));
      return;
    }
    const sum = renderSummary(a);
    const c = sum.counts;
    el.append(
      domEl('p', { class: 'as-counts', id: 'as-counts' },
        `${c.green} sicure · ${c.yellow} da controllare · ${c.red} incerte · ${c.verified} verificate a orecchio`),
      domEl('p', { class: 'muted small' }, 'Verde: sicura. Giallo: da controllare. Rosso: incerta. Verde scuro: verificata a orecchio. Il colore indica quanto l’app si fida, non quanto è giusta.'));
    if (stats) el.append(domEl('p', { class: 'muted small', id: 'as-stats' }, `Calcolo: decodifica ${(stats.decodeMs / 1000).toFixed(1)} s, analisi ${(stats.analyseMs / 1000).toFixed(1)} s.`));
    if (a.transposeFound !== 0) {
      const applied = (song.transpose || 0) === a.transposeFound;
      el.append(domEl('div', { class: 'as-transpose', id: 'as-transpose' },
        domEl('span', null, `La registrazione è ${describeSemitones(a.transposeFound)} il foglio.`),
        applied ? domEl('span', { class: 'muted small' }, 'Foglio già trasposto ✓') : domEl('button', {
          type: 'button', class: 'btn small primary', id: 'as-apply-transpose',
          onclick: () => { song.transpose = a.transposeFound; persist(); refresh(); if (onChange) onChange(); setMsg(`Foglio trasposto di ${a.transposeFound > 0 ? '+' : ''}${a.transposeFound} semitoni.`); },
        }, 'Trasponi il foglio')));
    }
    if (Math.abs(a.tuningCents) >= 25) el.append(domEl('p', { class: 'muted small' }, `La registrazione è ${a.tuningCents > 0 ? 'più alta' : 'più bassa'} di circa ${Math.abs(Math.round(a.tuningCents))} cent rispetto all’accordatura standard.`));
    const nowEl = domEl('p', { class: 'as-now', id: 'as-now', 'aria-live': 'off' }, nowText || ' ');
    const first = timelineWith(null).events[0];
    el.append(
      domEl('div', { class: 'row as-actions' },
        domEl('button', { type: 'button', class: 'btn primary', id: 'as-listen', onclick: () => listenFrom((first ? first.startSec : 0) - AS_LEAD_SEC) }, 'Ascolta e controlla'),
        a.accepted ? domEl('span', { class: 'as-accepted', id: 'as-accepted' }, 'Accettata ✓') : domEl('button', { type: 'button', class: 'btn', id: 'as-accept', onclick: () => { a.accepted = true; persist(); refresh(); if (onChange) onChange(); setMsg('Sincronizzazione accettata.'); } }, 'Accetta')),
      nowEl,
      sum.rows,
      domEl('div', { class: 'row sync-fine as-shift' },
        domEl('span', { class: 'muted small' }, 'Sposta tutto:'),
        AS_SHIFT_MS.map((d) => domEl('button', {
          type: 'button', class: 'btn', 'data-ms': d, 'aria-label': `Sposta tutto di ${d > 0 ? '+' : '−'}${Math.abs(d)} millisecondi`,
          onclick: () => { shiftAlignment(a, d / 1000); rebuild(); refresh(); },
        }, `${d > 0 ? '+' : '−'}${Math.abs(d)}`))),
      domEl('div', { class: 'row' },
        domEl('button', { type: 'button', class: 'btn', id: 'as-measured', onclick: () => {
          if (!window.confirm('Portare nel brano i BPM e le durate misurati dall’audio? Servono per studiare con il metronomo con i tempi veri (anche senza audio). Le durate di ogni accordo e il BPM delle sezioni con tempo stabile cambiano.')) return;
          const r = applyMeasuredTiming(song, a);
          persist();
          rebuild();
          setMsg(`Portati nel brano ${r.sections} tempi e ${r.events} durate.`);
          if (onChange) onChange();
        } }, 'Usa durate e BPM misurati'),
        domEl('button', { type: 'button', class: 'btn', id: 'as-export', disabled: countVerified(a) === 0, onclick: () => exportCorrections(a) }, `Esporta correzioni (${countVerified(a)})`),
        domEl('button', { type: 'button', class: 'btn', id: 'as-redo', onclick: start }, 'Rifai'),
        domEl('button', { type: 'button', class: 'btn danger', id: 'as-discard', onclick: discard }, 'Scarta')));
    const refs = sum.refs;
    lastEv = -2;
    nowRefs = refs;
  }
  let nowRefs = null;

  // called by the sync screen at every frame of the player
  function onFrame(info) {
    if (running || !nowRefs || info.eventIndex === lastEv) return;
    lastEv = info.eventIndex;
    const r = nowRefs[info.eventIndex];
    nowText = r && info.state === 'playing' ? `${secName(r.section)} · ${r.rest ? 'pausa' : r.name}` : '';
    const nowEl = el.querySelector('#as-now');
    if (nowEl) nowEl.textContent = nowText || ' ';
    el.querySelectorAll('.as-row.playing').forEach((n) => n.classList.remove('playing'));
    if (r && info.state === 'playing') {
      const row = el.querySelector(`.as-row[data-sec="${r.section}"]`);
      if (row) row.classList.add('playing');
    }
  }

  return { el, refresh, onFrame, isRunning: () => running };
}
