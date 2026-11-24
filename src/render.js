// Song -> DOM for the song view. Chords sit above the syllable they belong to (see segments.js).

import { domEl } from './ui/dom.js';
import { buildLineGroups } from './segments.js';
import { groupRepeatedSections, baseSectionName } from './model.js';

export const CHORD_PALETTE_SIZE = 10;

export function chordColorVar(song, name) {
  const i = song.chords.indexOf(name);
  return `var(--c${(i < 0 ? 0 : i) % CHORD_PALETTE_SIZE})`;
}

export function renderChordChip(song, name, onTap) {
  return domEl('button', {
    type: 'button',
    class: 'chip',
    'data-chord': name,
    style: { '--cc': chordColorVar(song, name) },
    onclick: () => onTap && onTap(null, name),
  }, name);
}

function renderChordLabel(song, chord, ref, onTap) {
  const label = domEl('span', {
    class: 'ch',
    role: 'button',
    tabindex: '0',
    'data-chord': chord.name,
    'data-ref': ref,
    style: { '--cc': chordColorVar(song, chord.name) },
  }, chord.name, chord.mark ? domEl('sup', { class: 'mk' }, chord.mark) : null);
  const fire = () => onTap && onTap(ref, chord.name);
  label.addEventListener('click', fire);
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fire();
    }
  });
  return label;
}

export function renderLine(song, line, sectionIndex, lineIndex, onTap) {
  const { instrumental, items } = buildLineGroups(line);
  if (items.length === 0 || !line.chords.length) return domEl('div', { class: 'line plain' }, line.lyric);
  const renderSeg = (s) => {
    const chord = line.chords[s.index];
    const ref = `${sectionIndex}.${lineIndex}.${s.index}`;
    const width = chord.name.length + (chord.mark ? chord.mark.length : 0) + 1;
    return domEl('span', { class: 'seg', style: { minWidth: width + 'ch' } },
      renderChordLabel(song, chord, ref, onTap),
      domEl('span', { class: 'ly' }, s.text));
  };
  const parts = items.map((it) => {
    if (it.space !== undefined) return it.space;
    return domEl('span', { class: 'w' }, it.group.map((p) => (p.seg ? renderSeg(p.seg) : p.text)));
  });
  return domEl('div', { class: 'line' + (instrumental ? ' instr' : '') }, parts);
}

function renderLines(song, section, sectionIndex, onTap) {
  return section.lines.map((line, li) => renderLine(song, line, sectionIndex, li, onTap));
}

export function renderSongBody(song, { onChordTap, collapseRepeats } = {}) {
  const body = domEl('div', { class: 'song-body' });
  const groups = groupRepeatedSections(song.sections);
  for (const g of groups) {
    const first = g.indices[0];
    const base = g.count > 1 ? baseSectionName(g.section.name) || g.section.name : g.section.name;
    const title = g.count > 1 ? `${base} (×${g.count})` : g.section.name;
    if (g.repeat && collapseRepeats) {
      body.append(domEl('details', { class: 'sec rep', 'data-sec': first },
        domEl('summary', null, `${title || 'Sezione'} — come sopra`),
        renderLines(song, g.section, first, onChordTap)));
    } else {
      body.append(domEl('section', { class: 'sec', 'data-sec': first },
        title ? domEl('h3', { class: 'sec-title' }, title) : null,
        renderLines(song, g.section, first, onChordTap)));
    }
  }
  return body;
}
