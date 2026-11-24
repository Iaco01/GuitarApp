// Library screen: search, sort, list of imported songs, backup (JSON export/import), storage use.

import { domEl, domClear } from './dom.js';
import { listLibrary, deleteSong, getSettings, saveSettings, storageUsedBytes } from '../storage.js';
import { filterLibrary, sortLibrary, SORT_MODES, buildExport, exportFileName, parseExport, planImport, applyImport } from '../libio.js';
import { choiceDialog } from './dialog.js';

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function formatDateIt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatKb(bytes) {
  const kb = bytes / 1024;
  return kb < 10 ? kb.toFixed(1).replace('.', ',') + ' KB' : Math.round(kb) + ' KB';
}

// Sends the file to the user: share sheet on iOS (where downloads from a web app may do nothing),
// otherwise a normal download.
async function deliverFile(name, text) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios && typeof File === 'function' && navigator.canShare && navigator.share) {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // fall through to the download
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = domEl('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

export function showLibraryScreen(root, { onImportFile, message }) {
  domClear(root);
  const msg = domEl('div', { class: 'msg' + (message ? ' error' : ''), role: 'alert', id: 'lib-msg' }, message || '');
  const setMsg = (text, error = false) => {
    msg.className = 'msg' + (error ? ' error' : '');
    msg.textContent = text;
  };
  const input = domEl('input', {
    type: 'file',
    id: 'import-input',
    class: 'file-input',
    accept: '.mht,.mhtml,.html,message/rfc822,multipart/related',
    onchange: async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setMsg('Importazione in corso…');
      try {
        await onImportFile(file);
      } catch (err) {
        setMsg(`Impossibile importare «${file.name}»: ${err.message || err}`, true);
      }
      input.value = '';
    },
  });

  const header = domEl('header', { class: 'lib-head' },
    domEl('h1', null, 'Accordi a tempo'),
    domEl('label', { class: 'btn primary', for: 'import-input' }, 'Importa .mht'),
    input);

  const settings = getSettings();
  let sortMode = SORT_MODES.some(([k]) => k === settings.librarySort) ? settings.librarySort : 'opened';
  let query = '';
  const entries = listLibrary();

  const search = domEl('input', { type: 'search', id: 'lib-search', placeholder: 'Cerca…', 'aria-label': 'Cerca titolo o artista', autocomplete: 'off', oninput: () => { query = search.value; renderList(); } });
  const sort = domEl('select', {
    id: 'lib-sort',
    'aria-label': 'Ordina per',
    onchange: () => {
      sortMode = sort.value;
      try { saveSettings({ ...getSettings(), librarySort: sortMode }); } catch { /* not essential */ }
      renderList();
    },
  }, SORT_MODES.map(([k, label]) => domEl('option', { value: k, selected: k === sortMode }, label)));
  const tools = domEl('div', { class: 'lib-tools' }, search, sort);

  const listHolder = domEl('div', { class: 'list-holder' });
  function renderList() {
    domClear(listHolder);
    const shown = sortLibrary(filterLibrary(entries, query), sortMode);
    if (!shown.length) {
      listHolder.append(domEl('p', { class: 'no-results', id: 'lib-none' }, 'Nessun brano corrisponde alla ricerca.'));
      return;
    }
    const list = domEl('ul', { class: 'songs' });
    for (const s of shown) {
      const meta = [s.artist, s.difficulty, formatDateIt(s.importedAt)].filter(Boolean).join(' · ');
      const edited = s.timingSource && s.timingSource !== 'default';
      list.append(domEl('li', { 'data-id': s.id },
        domEl('a', { class: 'song-row', href: '#/song/' + encodeURIComponent(s.id) },
          domEl('span', { class: 'song-title' }, s.title || 'Senza titolo'),
          domEl('span', { class: 'song-meta' }, meta),
          edited ? domEl('span', { class: 'song-badges' }, domEl('span', { class: 'badge', 'data-badge': 'durate' }, `durate ✓${s.bars ? ' · ' + s.bars + ' battute' : ''}`)) : null),
        domEl('button', {
          type: 'button',
          class: 'btn icon danger',
          'aria-label': `Elimina ${s.title}`,
          onclick: () => {
            if (!window.confirm(`Eliminare «${s.title}» dalla libreria?`)) return;
            try {
              deleteSong(s.id);
            } catch (err) {
              setMsg(err.message, true);
              return;
            }
            showLibraryScreen(root, { onImportFile });
          },
        }, '✕')));
    }
    listHolder.append(list);
  }

  // ---- backup ----
  const used = domEl('p', { class: 'muted small', id: 'storage-used' }, '');
  const paintUsed = () => {
    used.textContent = `Spazio usato nel browser: circa ${formatKb(storageUsedBytes())} (${entries.length} ${entries.length === 1 ? 'brano' : 'brani'}).`;
  };
  const jsonInput = domEl('input', {
    type: 'file',
    id: 'import-json',
    class: 'file-input',
    accept: '.json,application/json',
    onchange: async () => {
      const file = jsonInput.files && jsonInput.files[0];
      if (!file) return;
      try {
        await importLibraryFile(file);
      } catch (err) {
        setMsg(`Importazione non riuscita: ${err.message || err}. La libreria non è stata modificata.`, true);
      }
      jsonInput.value = '';
    },
  });

  async function importLibraryFile(file) {
    const parsed = parseExport(await file.text());
    if (parsed.error) {
      setMsg(parsed.error, true);
      return;
    }
    const plan = planImport(parsed);
    const details = parsed.invalid.map((x) => `Saltato ${x.label}: ${x.errors.slice(0, 2).join('; ')}`);
    const summary = `${plan.fresh.length} nuovi, ${plan.present.length} già presenti${parsed.invalid.length ? `, ${parsed.invalid.length} non validi` : ''}.`;
    if (!plan.fresh.length && !plan.present.length) {
      setMsg(parsed.invalid.length ? `Nessun brano valido nel file. ${details.join(' ')}` : 'Il file non contiene brani.', true);
      return;
    }
    let mode = 'newer';
    const buttons = plan.present.length
      ? [
        { label: 'Sostituisci se più recenti', value: 'newer', primary: true },
        { label: 'Sostituisci tutti', value: 'all' },
        { label: 'Salta quelli già presenti', value: 'skip' },
        { label: 'Annulla', value: 'cancel' },
      ]
      : [{ label: 'Importa', value: 'newer', primary: true }, { label: 'Annulla', value: 'cancel' }];
    mode = await choiceDialog({ title: 'Importa libreria', message: summary, details, buttons, cancel: 'cancel' });
    if (mode === 'cancel') {
      setMsg('Importazione annullata.');
      return;
    }
    const r = applyImport(plan, mode, parsed.settings);
    showLibraryScreen(root, { onImportFile });
    const m = document.getElementById('lib-msg');
    if (m) {
      m.className = 'msg';
      m.textContent = `Importazione completata: ${r.added} nuovi, ${r.replaced} sostituiti, ${r.skipped} saltati.`;
    }
  }

  const backup = domEl('section', { class: 'lib-backup' },
    domEl('h2', null, 'Copia di sicurezza'),
    domEl('div', { class: 'row' },
      domEl('button', {
        type: 'button',
        class: 'btn',
        id: 'btn-export',
        disabled: entries.length === 0,
        onclick: async () => {
          try {
            const data = buildExport();
            await deliverFile(exportFileName(), JSON.stringify(data));
            setMsg(`Esportati ${data.songs.length} ${data.songs.length === 1 ? 'brano' : 'brani'} in ${exportFileName()}.`);
          } catch (err) {
            setMsg(`Esportazione non riuscita: ${err.message || err}`, true);
          }
        },
      }, 'Esporta libreria'),
      domEl('label', { class: 'btn', for: 'import-json' }, 'Importa libreria'),
      jsonInput),
    used);
  paintUsed();

  const empty = domEl('section', { class: 'empty' },
    domEl('h2', null, 'Nessun brano ancora'),
    domEl('p', null, 'Importa una pagina di Ultimate Guitar salvata come file .mht.'),
    domEl('ol', null,
      domEl('li', null, 'Apri il brano su Ultimate Guitar nel browser.'),
      domEl('li', null, 'Salva la pagina come MHTML. Da Chrome per computer: menu ⋮ → Salva, stampa e condividi → Salva pagina come, formato «Pagina web, singolo file (.mht)». Su telefono il salvataggio MHTML può non essere disponibile: in quel caso salva da Chrome per computer e passa il file al telefono.'),
      domEl('li', null, 'Tocca «Importa .mht» e scegli il file.')));

  renderList();
  root.append(domEl('div', { class: 'screen lib' }, header, msg, entries.length ? tools : null, entries.length ? listHolder : empty, backup));
}
