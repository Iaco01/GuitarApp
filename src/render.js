// Song -> DOM for the song view. Chords sit above the syllable they belong to (see segments.js).

import { domEl } from './ui/dom.js';
import { buildLineGroups } from './segments.js';
import { groupRepeatedSections, baseSectionName, effectiveSectionBpms } from './model.js';
import { displayChordName } from './transpose.js';

export const CHORD_PALETTE_SIZE = 10;

export function chordColorVar(song, name) {
  const i = song.chords.indexOf(name);
  return `var(--c${(i < 0 ? 0 : i) % CHORD_PALETTE_SIZE})`;
}

function renderChordLabel(song, chord, ref, onTap, showBeats) {
  if (chord.rest) return renderRestLabel(chord, ref, onTap, showBeats);
  // shown name follows transposition and the capo shapes view; the colour stays tied to the written chord
  const shown = displayChordName(song, chord.name);
  const label = domEl('span', {
    class: 'ch',
    role: 'button',
    tabindex: '0',
    'data-chord': shown,
    'data-orig': chord.name,
    'data-ref': ref,
    style: { '--cc': chordColorVar(song, chord.name) },
  }, shown, chord.mark ? domEl('sup', { class: 'mk' }, chord.mark) : null,
  showBeats ? domEl('span', { class: 'bt' }, String(chord.beats)) : null);
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

// Rest bar ("pausa"): grey label, no diagram, no chord colour.
function renderRestLabel(chord, ref, onTap, showBeats) {
  const label = domEl('span', {
    class: 'ch rest',
    role: 'button',
    tabindex: '0',
    'data-orig': chord.name,
    'data-rest': '1',
    'data-ref': ref,
    style: { '--cc': 'var(--muted)' },
  }, 'pausa', showBeats ? domEl('span', { class: 'bt' }, String(chord.beats)) : null);
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

export function renderLine(song, line, sectionIndex, lineIndex, onTap, showBeats) {
  const { instrumental, items } = buildLineGroups(line);
  if (items.length === 0 || !line.chords.length) return domEl('div', { class: 'line plain' }, line.lyric);
  // Chord labels hang over the text without taking room (zero-width holder). The text under a chord is
  // widened only when its label would touch the next label of the same line: by what is missing.
  const order = line.chords.map((c, index) => ({ c, index })).sort((x, y) => x.c.col - y.c.col || x.index - y.index);
  const gapToNext = new Map(order.map((o, k) => [o.index, k + 1 < order.length ? order[k + 1].c.col - o.c.col : null]));
  const renderSeg = (s) => {
    const chord = line.chords[s.index];
    const ref = `${sectionIndex}.${lineIndex}.${s.index}`;
    const need = (chord.rest ? 5 : displayChordName(song, chord.name).length) + (chord.mark ? chord.mark.length : 0) + (showBeats ? 2 : 0) + 1;
    const gap = gapToNext.get(s.index);
    const textLen = s.text.length;
    let width = 0;
    if (textLen === 0) width = need; // nothing to hang over (instrumental line, chord past the lyric)
    else if (gap !== null && gap < need) width = textLen + (need - gap);
    return domEl('span', { class: 'seg', style: width ? { minWidth: width + 'ch' } : null },
      domEl('span', { class: 'chw' }, renderChordLabel(song, chord, ref, onTap, showBeats)),
      domEl('span', { class: 'ly' }, s.text));
  };
  const parts = items.map((it) => {
    if (it.space !== undefined) return it.space;
    return domEl('span', { class: 'w' }, it.group.map((p) => (p.seg ? renderSeg(p.seg) : p.text)));
  });
  return domEl('div', { class: 'line' + (instrumental ? ' instr' : '') }, parts);
}

function renderLines(song, section, sectionIndex, onTap, showBeats) {
  return section.lines.map((line, li) => renderLine(song, line, sectionIndex, li, onTap, showBeats));
}

export function formatBpm(bpm) {
  return Number.isInteger(bpm) ? String(bpm) : String(Math.round(bpm * 10) / 10).replace('.', ',');
}

// Section header: title plus the section tempo button; `decorate(head, info)` adds more tools.
function renderSectionHead(song, title, info, opts) {
  const bpms = effectiveSectionBpms(song);
  const bpm = bpms[info.first];
  const head = domEl('header', { class: 'sec-head', 'data-sec': info.first },
    title ? domEl('h3', { class: 'sec-title' }, title) : domEl('span', { class: 'sec-title' }),
    domEl('button', {
      type: 'button',
      class: 'sec-bpm',
      'data-sec': info.first,
      'aria-label': `Tempo della sezione: ${formatBpm(bpm)} BPM`,
      onclick: () => opts.onSectionBpm && opts.onSectionBpm(info, head),
    }, `\u2669 = ${formatBpm(bpm)}`));
  if (opts.decorate) opts.decorate(head, info);
  return head;
}

// Renders the whole song. Options: onChordTap(ref, name), collapseRepeats, flat (one box per
// section, no merging or collapsing: used while editing durations), editMode (shows beats on
// chord labels), onSectionBpm(info, head), decorate(head, info).
export function renderSongBody(song, opts = {}) {
  const { onChordTap, collapseRepeats, flat } = opts;
  const body = domEl('div', { class: 'song-body' + (opts.editMode ? ' editing' : '') });
  const groups = flat
    ? song.sections.map((section, index) => ({ key: String(index), section, indices: [index], count: 1, repeat: false }))
    : groupRepeatedSections(song.sections);
  for (const g of groups) {
    const first = g.indices[0];
    const info = { first, indices: g.indices };
    const base = g.count > 1 ? baseSectionName(g.section.name) || g.section.name : g.section.name;
    const title = g.count > 1 ? `${base} (\u00d7${g.count})` : g.section.name;
    if (g.repeat && collapseRepeats) {
      body.append(domEl('details', { class: 'sec rep', 'data-sec': first },
        domEl('summary', null, `${title || 'Sezione'} \u2014 come sopra`),
        renderSectionHead(song, '', info, opts),
        renderLines(song, g.section, first, onChordTap, opts.editMode)));
    } else {
      body.append(domEl('section', { class: 'sec', 'data-sec': first },
        renderSectionHead(song, title, info, opts),
        renderLines(song, g.section, first, onChordTap, opts.editMode)));
    }
  }
  return body;
}
