// Bootstrap and hash routing: "#/" is the library, "#/song/<id>" is a song.

import { parseSongFromMht } from './parser.js';
import { getSong, saveSong } from './storage.js';
import { showLibraryScreen } from './ui/library.js';
import { showSongScreen, applyTheme } from './ui/songview.js';

const appRoot = document.getElementById('app');

async function importSongFile(file) {
  const text = await file.text();
  const song = parseSongFromMht(text);
  song.source.fileName = file.name;
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  song.view.theme = dark ? 'dark' : 'light';
  const saved = saveSong(song);
  window.location.hash = '#/song/' + encodeURIComponent(saved.id);
}

function routeNow(message) {
  const m = /^#\/song\/(.+)$/.exec(window.location.hash);
  if (m) {
    const song = getSong(decodeURIComponent(m[1]));
    if (song && Array.isArray(song.sections)) {
      window.scrollTo(0, 0);
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
