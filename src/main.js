// Bootstrap and hash routing: "#/" is the library, "#/song/<id>" is a song.

import { parseSongFromMht } from './parser.js';
import { getSong, saveSong, listSongs, markOpened } from './storage.js';
import { migrateSong, sameChordStructure, readChordBeats, findDuplicateSongs } from './model.js';
import { choiceDialog } from './ui/dialog.js';
import { showLibraryScreen, formatDateIt } from './ui/library.js';
import { showSongScreen, applyTheme, leaveSongScreen } from './ui/songview.js';

const appRoot = document.getElementById('app');

// Songs already in the library that come from the same page (newest import first).
function findExisting(song) {
  return findDuplicateSongs(song, listSongs().map((e) => getSong(e.id)));
}

// Replacing keeps id, view, edited tempos and (if the chord structure is identical) the durations.
function mergeIntoExisting(fresh, old) {
  const oldSong = migrateSong(old);
  const sameStructure = sameChordStructure(oldSong, fresh);
  const merged = { ...fresh, id: oldSong.id, view: { ...fresh.view, ...oldSong.view }, source: { ...fresh.source, importedAt: oldSong.source.importedAt } };
  if (sameStructure) {
    const beats = readChordBeats(oldSong);
    let k = 0;
    for (const sec of merged.sections) for (const l of sec.lines) for (const c of l.chords) c.beats = beats[k++];
    merged.timingSource = oldSong.timingSource;
    merged.sections.forEach((sec, i) => {
      if (oldSong.sections[i].bpmSource === 'edited') {
        sec.bpm = oldSong.sections[i].bpm;
        sec.bpmSource = 'edited';
      }
    });
    if (oldSong.bpm) merged.bpm = oldSong.bpm;
  }
  return { merged, sameStructure, hadEdits: oldSong.timingSource !== 'default' };
}

async function importSongFile(file) {
  const text = await file.text();
  const song = parseSongFromMht(text);
  song.source.fileName = file.name;
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  song.view.theme = dark ? 'dark' : 'light';
  let toSave = song;
  let note = '';
  const copies = findExisting(song);
  if (copies.length) {
    const many = copies.length > 1;
    const label = (c) => `«${c.title}» importato il ${formatDateIt(c.source && c.source.importedAt) || '?'}`;
    const choice = await choiceDialog({
      title: 'Questo brano è già in libreria',
      message: many
        ? `Ci sono ${copies.length} copie. Quale vuoi sostituire?`
        : `«${copies[0].title}» è già stato importato. Cosa vuoi fare?`,
      buttons: [
        ...copies.map((c, i) => ({ label: many ? 'Sostituisci ' + label(c) : 'Sostituisci', value: 'replace:' + i, primary: i === 0 })),
        { label: 'Tieni entrambi', value: 'both' },
        { label: 'Annulla', value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (choice === 'cancel') return;
    if (choice.startsWith('replace:')) {
      const r = mergeIntoExisting(song, copies[Number(choice.slice(8))]);
      toSave = r.merged;
      if (!r.sameStructure && r.hadEdits) note = 'Gli accordi sono cambiati: le durate sono tornate predefinite.';
    }
  }
  const saved = saveSong(toSave);
  if (note) window.alert(note);
  window.location.hash = '#/song/' + encodeURIComponent(saved.id);
}

function routeNow(message) {
  leaveSongScreen();
  const m = /^#\/song\/(.+)$/.exec(window.location.hash);
  if (m) {
    const stored = getSong(decodeURIComponent(m[1]));
    const song = stored ? migrateSong(stored) : null;
    if (song && Array.isArray(song.sections)) {
      window.scrollTo(0, 0);
      markOpened(song.id);
      showSongScreen(appRoot, song, {
        onBack: () => { window.location.hash = '#/'; },
        onDeleted: () => { window.location.hash = '#/'; },
      });
      return;
    }
    message = 'Brano non trovato';
  }
  applyTheme(null);
  showLibraryScreen(appRoot, { onImportFile: importSongFile, message });
}

window.addEventListener('hashchange', () => routeNow());
routeNow();
