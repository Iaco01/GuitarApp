// Loading, replacing and removing the audio file of a song (IndexedDB + song.audio metadata).

import { audioStorePut, audioStoreDelete } from '../audiostore.js';
import { matchAudioFile } from '../audiosync.js';

export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac';

// Duration in seconds of an audio file, or a rejection when the browser cannot decode it.
export function probeAudioDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (fn, v) => {
      clearTimeout(timer);
      a.removeAttribute('src');
      URL.revokeObjectURL(url);
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('timeout')), 10000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? resolve : reject, Number.isFinite(a.duration) && a.duration > 0 ? a.duration : new Error('durata sconosciuta'));
    a.onerror = () => done(reject, new Error('formato non riconosciuto'));
    a.src = url;
  });
}

// Stores `file` for the song and updates `song.audio`. When the song already had audio metadata
// (replacing a file, or an import without the file): the same name and size keep offset and
// anchors; a different file asks (`confirmKeep()` -> boolean) whether to keep them.
// Returns { ok: true, kept } or { ok: false, error }. The caller saves the song.
export async function attachAudioFile(song, file, confirmKeep = () => false) {
  let durationSec;
  try {
    durationSec = await probeAudioDuration(file);
  } catch {
    return { ok: false, error: `Questo browser non riesce a leggere «${file.name}». Prova con un mp3, m4a o wav.` };
  }
  try {
    await audioStorePut(song.id, file);
  } catch (err) {
    return { ok: false, error: 'Non riesco a salvare l’audio sul telefono: ' + (err && err.message ? err.message : 'spazio esaurito') };
  }
  const old = song.audio;
  const meta = { fileName: file.name, mimeType: file.type || '', size: file.size, durationSec, addedAt: new Date().toISOString() };
  let kept = false;
  if (old) kept = matchAudioFile(old, file) === 'same' || !!confirmKeep();
  song.audio = kept
    ? { ...old, ...meta }
    : { ...meta, offsetSec: 0, anchors: {}, metronome: false };
  return { ok: true, kept };
}

export async function removeAudioFile(song) {
  await audioStoreDelete(song.id);
  song.audio = null;
}
