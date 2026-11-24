// Chord diagram row, chord sheet (big diagram + alternatives) and capo sheet.

import { domEl } from './dom.js';
import { chordColorVar } from '../render.js';
import { getChordShapes } from '../chords-db.js';
import { renderDiagramSvg } from '../diagram.js';
import { displayChordName, suggestCapo, difficultyLabel } from '../transpose.js';

// Small SVG of a chord (by shown name), or '' when the chord has no diagram.
export function smallDiagramSvg(label) {
  const shapes = getChordShapes(label);
  return shapes.length ? renderDiagramSvg(shapes[0], { size: 30 }) : '';
}

// Row of diagrams in the song header (scrolls horizontally inside the row). `onTap(writtenName)`.
export function renderDiagramRow(song, onTap) {
  const row = domEl('div', { class: 'dg-row', id: 'dg-row', 'aria-label': 'Accordi usati' });
  for (const name of song.chords) {
    const shown = displayChordName(song, name);
    const shapes = getChordShapes(shown);
    const btn = domEl('button', {
      type: 'button',
      class: 'dg-btn' + (shapes.length ? '' : ' none'),
      'data-chord': shown,
      'data-orig': name,
      'aria-label': 'Accordo ' + shown,
      style: { '--cc': chordColorVar(song, name) },
      onclick: () => onTap(name),
    });
    if (shapes.length) btn.innerHTML = renderDiagramSvg(shapes[0], { size: 64, label: shown });
    else btn.append(domEl('span', { class: 'dg-name' }, shown), domEl('span', { class: 'dg-na' }, 'diagramma non disponibile'));
    row.append(btn);
  }
  return row;
}

function openSheet(label, build) {
  const close = () => {
    sheet.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const card = domEl('div', { class: 'sheet-card' });
  const sheet = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, onclick: (e) => { if (e.target === sheet) close(); } }, card);
  build(card, close);
  document.addEventListener('keydown', onKey);
  document.body.append(sheet);
  const first = card.querySelector('button');
  if (first) first.focus();
  return close;
}

// Sheet of one chord: name as shown, big diagram, alternative shapes.
export function openChordSheet(song, writtenName) {
  const shown = displayChordName(song, writtenName);
  const shapes = getChordShapes(shown);
  return openSheet('Accordo ' + shown, (card, close) => {
    let idx = 0;
    const main = domEl('div', { class: 'sheet-dg', id: 'sheet-dg', style: { '--cc': chordColorVar(song, writtenName) } });
    const alts = domEl('div', { class: 'sheet-alts', id: 'sheet-alts' });
    const draw = () => {
      main.innerHTML = renderDiagramSvg(shapes[idx], { size: 160 });
      const bass = shapes[idx].bass;
      if (bass) main.append(domEl('p', { class: 'sheet-bass', id: 'sheet-bass' }, 'Basso: ' + bass));
      alts.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === idx)));
    };
    card.append(domEl('div', { class: 'sheet-name', id: 'sheet-name', style: { color: chordColorVar(song, writtenName) } }, shown));
    if (!shapes.length) {
      card.append(domEl('p', { class: 'muted', id: 'sheet-na' }, 'Diagramma non disponibile'));
    } else {
      card.append(main);
      if (shapes.length > 1) {
        shapes.forEach((s, i) => {
          const b = domEl('button', { type: 'button', class: 'sheet-alt', 'aria-label': `Forma ${i + 1} di ${shapes.length}`, onclick: () => { idx = i; draw(); } });
          b.innerHTML = renderDiagramSvg(s, { size: 54 });
          alts.append(b);
        });
        card.append(domEl('p', { class: 'muted small' }, 'Altre forme'), alts);
      }
      draw();
    }
    card.append(domEl('button', { type: 'button', class: 'btn primary', id: 'sheet-close', onclick: close }, 'Chiudi'));
  });
}

// Capo sheet: the best positions for the current transposition. `onChange()` runs after a choice.
export function openCapoSheet(song, onChange) {
  return openSheet('Capotasto', (card, close) => {
    const current = Number.isInteger(song.capo) ? song.capo : 0;
    const all = suggestCapo(song, { maxCapo: 7, top: 8 });
    const options = all.slice(0, 3);
    if (!options.some((o) => o.capo === current)) {
      const cur = all.find((o) => o.capo === current);
      if (cur) options.push(cur);
    }
    const list = domEl('div', { class: 'capo-list', id: 'capo-list' });
    for (const o of options) {
      const text = o.capo === 0 ? 'Senza capotasto' : `Capo ${o.capo}`;
      list.append(domEl('button', {
        type: 'button',
        class: 'btn capo-opt',
        'data-capo': o.capo,
        'aria-pressed': String(o.capo === current),
        onclick: () => {
          song.capo = o.capo;
          song.view.showShapes = o.capo > 0;
          onChange();
          close();
        },
      }, domEl('span', { class: 'capo-main' }, `${text}: forme ${o.shapes.join(', ')}`), domEl('span', { class: 'capo-diff' }, difficultyLabel(o.score))));
    }
    if (!options.some((o) => o.capo === 0)) {
      list.append(domEl('button', {
        type: 'button', class: 'btn capo-opt', 'data-capo': 0, 'aria-pressed': String(current === 0),
        onclick: () => { song.capo = 0; song.view.showShapes = false; onChange(); close(); },
      }, domEl('span', { class: 'capo-main' }, 'Senza capotasto')));
    }
    const shapes = domEl('input', { type: 'checkbox', id: 'capo-shapes', checked: !!song.view.showShapes && current > 0, disabled: current === 0 });
    shapes.addEventListener('change', () => {
      song.view.showShapes = shapes.checked;
      onChange();
    });
    // free choice 0-12
    const free = domEl('select', {
      id: 'capo-free',
      'aria-label': 'Capotasto, tasto da 0 a 12',
      onchange: () => {
        const v = Number(free.value);
        song.capo = v;
        song.view.showShapes = v > 0;
        onChange();
        close();
      },
    }, Array.from({ length: 13 }, (_, i) => domEl('option', { value: String(i), selected: i === current }, i === 0 ? '0 (nessuno)' : String(i))));
    card.append(
      domEl('h2', { class: 'dlg-title' }, 'Capotasto'),
      domEl('p', { class: 'muted small' }, 'Le migliori posizioni per gli accordi di questo brano, con la trasposizione attuale.'),
      list,
      domEl('label', { class: 'capo-free' }, 'Altro tasto: ', free),
      domEl('label', { class: 'capo-shapes' }, shapes, ' Mostra le forme da suonare'),
      domEl('button', { type: 'button', class: 'btn primary', id: 'capo-close', onclick: close }, 'Chiudi'));
  });
}
