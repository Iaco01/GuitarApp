// Bootstrap and hash routing: "#/" is the library, "#/song/<id>" is a song.

import { parseSongFromMht } from './parser.js';
import { getSong, saveSong, listSongs } from './storage.js';
import { migrateSong, sameChordStructure, readChordBeats } from './model.js';
import { choiceDialog } from './ui/dialog.js';
import { showLibraryScreen } from './ui/library.js';
import { showSongScreen, applyTheme, leaveSongScreen } from './ui/songview.js';

const appRoot = document.getElementById('app');

// Finds a song already in the library that comes from the same page (same source URL, or same
// title and artist when there is no URL).
function findExisting(song) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  for (const entry of listSongs()) {
    const stored = getSong(entry.id);
    if (!stored) continue;
    const url = stored.source && stored.source.url;
    if (song.source.url && url) {
      if (url === song.source.url) return stored;
    } else if (norm(stored.title) === norm(song.title) && norm(stored.artist) === norm(song.artist)) {
      return stored;
    }
  }
  return null;
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
  const existing = findExisting(song);
  if (existing) {
    const choice = await choiceDialog({
      title: 'Questo brano è già in libreria',
      message: `«${existing.title}» è già stato importato. Cosa vuoi fare?`,
      buttons: [
        { label: 'Sostituisci', value: 'replace', primary: true },
        { label: 'Tieni entrambi', value: 'both' },
        { label: 'Annulla', value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (choice === 'cancel') return;
    if (choice === 'replace') {
      const r = mergeIntoExisting(song, existing);
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
