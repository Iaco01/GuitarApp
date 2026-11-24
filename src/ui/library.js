// Library screen: list of imported songs, import button, empty state with instructions.

import { domEl, domClear } from './dom.js';
import { listSongs, deleteSong } from '../storage.js';

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function formatDateIt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
}

export function showLibraryScreen(root, { onImportFile, message }) {
  domClear(root);
  const msg = domEl('div', { class: 'msg' + (message ? ' error' : ''), role: 'alert', id: 'lib-msg' }, message || '');
  const input = domEl('input', {
    type: 'file',
    id: 'import-input',
    class: 'file-input',
    accept: '.mht,.mhtml,.html,message/rfc822,multipart/related',
    onchange: async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      msg.className = 'msg';
      msg.textContent = 'Importazione in corso…';
      try {
        await onImportFile(file);
      } catch (err) {
        msg.className = 'msg error';
        msg.textContent = `Impossibile importare «${file.name}»: ${err.message || err}`;
      }
      input.value = '';
    },
  });

  const header = domEl('header', { class: 'lib-head' },
    domEl('h1', null, 'Accordi a tempo'),
    domEl('label', { class: 'btn primary', for: 'import-input' }, 'Importa .mht'),
    input);

  const songs = listSongs();
  const list = domEl('ul', { class: 'songs' });
  for (const s of songs) {
    const meta = [s.artist, s.difficulty, formatDateIt(s.importedAt)].filter(Boolean).join(' · ');
    list.append(domEl('li', null,
      domEl('a', { class: 'song-row', href: '#/song/' + encodeURIComponent(s.id) },
        domEl('span', { class: 'song-title' }, s.title || 'Senza titolo'),
        domEl('span', { class: 'song-meta' }, meta)),
      domEl('button', {
        type: 'button',
        class: 'btn icon danger',
        'aria-label': `Elimina ${s.title}`,
        onclick: () => {
          if (!window.confirm(`Eliminare «${s.title}» dalla libreria?`)) return;
          try {
            deleteSong(s.id);
          } catch (err) {
            msg.className = 'msg error';
            msg.textContent = err.message;
            return;
          }
          showLibraryScreen(root, { onImportFile });
        },
      }, '✕')));
  }

  const empty = domEl('section', { class: 'empty' },
    domEl('h2', null, 'Nessun brano ancora'),
    domEl('p', null, 'Importa una pagina di Ultimate Guitar salvata come file .mht.'),
    domEl('ol', null,
      domEl('li', null, 'Apri il brano su Ultimate Guitar nel browser.'),
      domEl('li', null, 'Salva la pagina come MHTML. Da Chrome per computer: menu ⋮ → Salva, stampa e condividi → Salva pagina come, formato «Pagina web, singolo file (.mht)». Su telefono il salvataggio MHTML può non essere disponibile: in quel caso salva da Chrome per computer e passa il file al telefono.'),
      domEl('li', null, 'Tocca «Importa .mht» e scegli il file.')));

  root.append(domEl('div', { class: 'screen lib' }, header, msg, songs.length ? list : empty));
}
