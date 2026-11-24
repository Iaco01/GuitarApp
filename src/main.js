// Bootstrap and hash routing: "#/" is the library, "#/song/<id>" is a song.

import { parseSongFromMht } from './parser.js';
import { getSong, saveSong, listSongs, markOpened } from './storage.js';
import { migrateSong, mergeIntoExisting, findDuplicateSongs, labelCopies } from './model.js';
import { choiceDialog } from './ui/dialog.js';
import { showLibraryScreen, formatDateTimeIt } from './ui/library.js';
import { showSongScreen, applyTheme, leaveSongScreen } from './ui/songview.js';

const appRoot = document.getElementById('app');

// Songs already in the library that come from the same page (newest import first).
function findExisting(song) {
  return findDuplicateSongs(song, listSongs().map((e) => getSong(e.id)));
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
    const labels = labelCopies(copies, formatDateTimeIt);
    const choice = await choiceDialog({
      title: 'Questo brano è già in libreria',
      message: many
        ? `Ci sono ${copies.length} copie. Quale vuoi sostituire?`
        : `«${copies[0].title}» è già stato importato. Cosa vuoi fare?`,
      buttons: [
        ...copies.map((c, i) => ({ label: many ? 'Sostituisci ' + labels[i] : 'Sostituisci', value: 'replace:' + i, primary: i === 0 })),
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
