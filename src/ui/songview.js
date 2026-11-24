// Song screen: header, controls, body with chords above lyrics, chord sheet.

import { domEl, domClear } from './dom.js';
import { renderSongBody, renderChordChip } from '../render.js';
import { saveSong, deleteSong } from '../storage.js';

const FONT_MIN = 0.7;
const FONT_MAX = 2.0;

function clampScale(v) {
  return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, v)) * 10) / 10;
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// Hook for round 3 (chord diagrams): called with (ref, chordName) when a chord is tapped.
function openChordSheet(ref, name) {
  const close = () => {
    sheet.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const sheet = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Accordo ' + name, onclick: (e) => { if (e.target === sheet) close(); } },
    domEl('div', { class: 'sheet-card' },
      domEl('div', { class: 'sheet-name', id: 'sheet-name' }, name),
      domEl('p', { class: 'muted' }, 'Diagramma non ancora disponibile'),
      domEl('button', { type: 'button', class: 'btn primary', onclick: close }, 'Chiudi')));
  document.addEventListener('keydown', onKey);
  document.body.append(sheet);
  sheet.querySelector('button').focus();
}

export function showSongScreen(root, song, { onBack, onDeleted }) {
  domClear(root);
  const persist = () => {
    try {
      saveSong(song);
    } catch (err) {
      notice.textContent = err.message;
      notice.className = 'msg error';
    }
  };
  const notice = domEl('div', { class: 'msg', role: 'alert' });

  const bodyHolder = domEl('div', { class: 'body-holder' });
  const metaHolder = domEl('div', { class: 'meta-holder' });

  const setScale = (v) => {
    song.view.fontScale = clampScale(v);
    screen.style.setProperty('--fs', String(song.view.fontScale));
    persist();
  };
  const buildBody = () => {
    domClear(bodyHolder);
    bodyHolder.append(renderSongBody(song, { onChordTap: openChordSheet, collapseRepeats: song.view.collapseRepeats }));
  };
  const buildMeta = () => {
    domClear(metaHolder);
    const items = [];
    if (song.difficulty) items.push(['Difficoltà', song.difficulty]);
    if (song.tuning) items.push(['Accordatura', song.tuning]);
    items.push(['Capotasto', song.capo ? String(song.capo) : 'nessuno']);
    if (song.key) items.push(['Tonalità', song.key]);
    const dl = domEl('dl', { class: 'meta' });
    for (const [k, v] of items) dl.append(domEl('div', null, domEl('dt', null, k), domEl('dd', null, v)));
    if (song.bpm) {
      dl.append(domEl('div', null, domEl('dt', null, 'BPM'), domEl('dd', { id: 'bpm-value' }, String(song.bpm))));
    }
    metaHolder.append(dl);
    if (!song.bpm) {
      const input = domEl('input', { type: 'number', inputmode: 'numeric', min: '30', max: '300', step: '1', id: 'bpm-input', 'aria-label': 'BPM', placeholder: '80' });
      metaHolder.append(domEl('div', { class: 'bpm-missing' },
        domEl('strong', null, 'BPM non trovato'),
        input,
        domEl('button', {
          type: 'button',
          class: 'btn',
          id: 'bpm-save',
          onclick: () => {
            const v = parseFloat(input.value);
            if (!(v >= 30 && v <= 300)) {
              notice.textContent = 'Inserisci un BPM tra 30 e 300';
              notice.className = 'msg error';
              return;
            }
            notice.textContent = '';
            notice.className = 'msg';
            song.bpm = v;
            persist();
            buildMeta();
          },
        }, 'Salva')));
    }
  };

  const themeBtn = domEl('button', {
    type: 'button',
    class: 'btn icon',
    id: 'btn-theme',
    'aria-label': 'Cambia tema chiaro/scuro',
    onclick: () => {
      song.view.theme = song.view.theme === 'dark' ? 'light' : 'dark';
      applyTheme(song.view.theme);
      persist();
    },
  }, '◐');
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

  const chips = domEl('div', { class: 'chips', 'aria-label': 'Accordi usati' },
    song.chords.map((c) => renderChordChip(song, c, openChordSheet)));

  const warnings = song.importInfo && song.importInfo.warnings && song.importInfo.warnings.length
    ? domEl('details', { class: 'warnings' },
      domEl('summary', null, `Avvisi di importazione (${song.importInfo.warnings.length})`),
      domEl('ul', null, song.importInfo.warnings.map((w) => domEl('li', null, w))))
    : null;

  const screen = domEl('div', { class: 'screen song', style: { '--fs': String(song.view.fontScale) } },
    topbar,
    domEl('header', { class: 'song-head' },
      domEl('h1', { id: 'song-title' }, song.title),
      song.artist ? domEl('p', { class: 'artist', id: 'song-artist' }, song.artist) : null,
      metaHolder,
      chips,
      domEl('div', { class: 'tools' }, collapseBtn)),
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
            notice.textContent = err.message;
            notice.className = 'msg error';
            return;
          }
          onDeleted();
        },
      }, 'Elimina brano')));

  applyTheme(song.view.theme);
  buildMeta();
  buildBody();
  root.append(screen);
}
