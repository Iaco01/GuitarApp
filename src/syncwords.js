// The words of the automatic sync summary (pure, so that Node can test them): the state of a section, why it is not
// "sicura", and the stretches of music that the sheet does not have.

import { formatClock } from './audiosync.js';

// the same words everywhere (rows, legend, counts): whole words, never cut. At 320 px the row has two lines for them.
export const AS_STATE_TEXT = {
  green: 'sicura',
  yellow: 'da controllare',
  red: 'incerta',
  verified: 'verificata ✓',
  skipped: 'non presente nell’audio',
};
export const AS_FREE_TEXT = 'tempo libero';
// why a section is yellow or red, in one line
const AS_WHY_FREE = 'tempo libero: i cambi sono stimati';
const AS_WHY_SISTERS = 'dura diversamente dalle sezioni uguali';
const AS_WHY_OFFGRID = 'i cambi non cadono sui battiti';
const AS_WHY_WEAK = 'tempi poco netti';
// a stretch of music that the sheet does not have: a short one is a bar of passage, a long one a part
export const AS_GAP_LONG_SEC = 6;
export const AS_GAP_NOTE = 'nessuna azione richiesta';
// when more chords than this are left without a tap in a correction, say how many instead of listing them
export const AS_MANY_MISSING = 8;

// The line that says why a section is not "sicura" (null for the others). `section`: { bpm, why } of the alignment.
export function sectionWhy(section, state) {
  if (state !== 'yellow' && state !== 'red') return null;
  if (section.bpm === null) return AS_WHY_FREE;
  if (section.why === 'sisters') return AS_WHY_SISTERS;
  if (section.why === 'offgrid') return AS_WHY_OFFGRID;
  return AS_WHY_WEAK;
}

// The text of a stretch of music that is not in the sheet: "0:59–1:03: passaggio non scritto nel foglio (4 s)" under
// AS_GAP_LONG_SEC, "…: parte non presente nel foglio" from there on.
export function gapLabel(startSec, endSec) {
  const len = endSec - startSec;
  const clock = (t) => formatClock(t).replace(/,\d$/, '');
  const what = len < AS_GAP_LONG_SEC ? `passaggio non scritto nel foglio (${Math.round(len)} s)` : 'parte non presente nel foglio';
  return `${clock(startSec)}–${clock(endSec)}: ${what}`;
}
