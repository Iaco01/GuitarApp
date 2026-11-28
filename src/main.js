// Bootstrap and hash routing: "#/" is the library, "#/song/<id>" is a song.

import { parseSongFromMht } from './parser.js';
import { getSong, saveSong, listSongs, markOpened } from './storage.js';
import { migrateSong, mergeIntoExisting, findDuplicateSongs, labelCopies } from './model.js';
import { choiceDialog } from './ui/dialog.js';
import { showLibraryScreen, formatDateTimeIt } from './ui/library.js';
import { showSongScreen, applyTheme, leaveSongScreen } from './ui/songview.js';
import { showTabScreen, leaveTabScreen } from './ui/tabview.js';
import { readPdfText } from './pdf.js';
import { parseTabText, normalizeTab } from './tab.js';

const appRoot = document.getElementById('app');

// Songs already in the library that come from the same page (newest import first).
function findExisting(song) {
  return findDuplicateSongs(song, listSongs().map((e) => getSong(e.id)));
}

// Reads the file as a song: a tab page printed to PDF, a text file with a tab, or a saved Ultimate Guitar page (.mht).
async function songFromFile(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (isPdf) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await readPdfText(bytes);
    return tabSongFrom(r.text, { pdfTitle: r.title, fileName: file.name, method: 'tab-pdf', warnings: r.warnings });
  }
  const text = await file.text();
  if (/\.txt$/i.test(file.name) || file.type === 'text/plain') return tabSongFrom(text, { fileName: file.name, method: 'tab-text' });
  const song = parseSongFromMht(text);
  song.source.fileName = file.name;
  return song;
}

function tabSongFrom(text, opts) {
  const song = parseTabText(text, opts);
  if (opts.warnings && opts.warnings.length) song.importInfo.warnings.push(...opts.warnings);
  if (!song.tab.parts.length) throw new Error('Non ho trovato nessuna tablatura nel testo. Controlla che sia la pagina di una tab (righe e|B|G|D|A|E|)');
  return song;
}

// Tab pasted by hand (when the PDF cannot be read): the title is optional.
async function importTabText(text, title) {
  const song = tabSongFrom(text, { title: title || '', method: 'tab-pasted' });
  await saveImported(song);
}

async function importSongFile(file) {
  await saveImported(await songFromFile(file));
}

async function saveImported(song) {
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
      const old = copies[Number(choice.slice(8))];
      if (song.kind === 'tab') {
        toSave = { ...song, id: old.id, view: { ...song.view, theme: (old.view && old.view.theme) || song.view.theme } };
      } else {
        const r = mergeIntoExisting(song, old);
        toSave = r.merged;
        if (!r.sameStructure && r.hadEdits) note = 'Gli accordi sono cambiati: le durate sono tornate predefinite.';
      }
    }
  }
  const saved = saveSong(toSave);
  if (note) window.alert(note);
  window.location.hash = '#/song/' + encodeURIComponent(saved.id);
}

function routeNow(message) {
  leaveSongScreen();
  leaveTabScreen();
  const m = /^#\/song\/(.+)$/.exec(window.location.hash);
  if (m) {
    const stored = getSong(decodeURIComponent(m[1]));
    const song = stored ? migrateSong(stored) : null;
    if (song && Array.isArray(song.sections)) {
      window.scrollTo(0, 0);
      markOpened(song.id);
      const show = song.kind === 'tab' ? (root, sg, h) => showTabScreen(root, normalizeTab(sg), h) : showSongScreen;
      show(appRoot, song, {
        onBack: () => { window.location.hash = '#/'; },
        onDeleted: () => { window.location.hash = '#/'; },
      });
      return;
    }
    message = 'Brano non trovato';
  }
  applyTheme(null);
  showLibraryScreen(appRoot, { onImportFile: importSongFile, onPasteTab: importTabText, message });
}

window.addEventListener('hashchange', () => routeNow());
routeNow();
