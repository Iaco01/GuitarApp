// Library screen: search, sort, list of imported songs, backup (JSON export/import), storage use.

import { domEl, domClear } from './dom.js';
import { listLibrary, deleteSong, getSettings, saveSettings, storageUsedBytes, getDevice, getDiag, listSongs, getSong } from '../storage.js';
import { buildDiagnostics } from '../diagnostics.js';
import { filterLibrary, sortLibrary, SORT_MODES, buildExport, exportFileName, parseExport, planImport, applyImport } from '../libio.js';
import { choiceDialog } from './dialog.js';
import { openCalibration } from './calibrate.js';
import { audioStoreDelete, audioStoreHas, audioStoreTotals, audioStoreQuota } from '../audiostore.js';

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function formatDateIt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTimeIt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${formatDateIt(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatMb(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? mb.toFixed(1).replace('.', ',') + ' MB' : Math.round(mb).toLocaleString('it-IT') + ' MB';
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

export function showLibraryScreen(root, { onImportFile, onPasteTab = null, message }) {
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
    accept: '.mht,.mhtml,.html,.pdf,.txt,message/rfc822,multipart/related,application/pdf,text/plain',
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
    domEl('label', { class: 'btn primary', for: 'import-input' }, 'Importa .mht o PDF'),
    input,
    onPasteTab ? domEl('button', { type: 'button', class: 'btn', id: 'btn-paste-tab', onclick: () => openPasteTab() }, 'Incolla una tab') : null);

  // a tab pasted as text (the alternative when the PDF cannot be read)
  function openPasteTab() {
    const area = domEl('textarea', { id: 'paste-tab-text', class: 'paste-area', rows: '10', placeholder: 'Incolla qui il testo della tab (le righe e|B|G|D|A|E|)', 'aria-label': 'Testo della tab', spellcheck: 'false' });
    const title = domEl('input', { type: 'text', id: 'paste-tab-title', class: 'paste-title', placeholder: 'Titolo (facoltativo)', 'aria-label': 'Titolo' });
    const err = domEl('p', { class: 'msg error', id: 'paste-tab-err', role: 'alert' }, '');
    const close = () => sheet.remove();
    const go = domEl('button', {
      type: 'button', class: 'btn primary', id: 'paste-tab-go',
      onclick: async () => {
        err.textContent = '';
        if (!area.value.trim()) { err.textContent = 'Incolla prima il testo della tab'; return; }
        try {
          await onPasteTab(area.value, title.value.trim());
          close();
        } catch (e) {
          err.textContent = e.message || String(e);
        }
      },
    }, 'Importa');
    const sheet = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Incolla una tab' },
      domEl('div', { class: 'sheet-card dlg' }, domEl('h2', { class: 'dlg-title' }, 'Incolla una tab'), title, area, err,
        domEl('div', { class: 'dlg-btns' }, go, domEl('button', { type: 'button', class: 'btn', onclick: close }, 'Annulla'))));
    document.body.append(sheet);
    area.focus();
  }

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
  // does the audio file really exist in IndexedDB? Checked after the list is on screen.
  const audioPresent = new Map();
  const paintAudioBadge = (badge, present) => {
    badge.textContent = present === undefined ? 'audio' : present ? 'audio ✓' : 'audio mancante';
    badge.classList.toggle('missing', present === false);
  };
  async function checkAudioBadges() {
    for (const badge of listHolder.querySelectorAll('.badge[data-badge="audio"]')) {
      const id = badge.closest('li').getAttribute('data-id');
      if (!audioPresent.has(id)) {
        let ok = false;
        try { ok = await audioStoreHas(id); } catch (err) { ok = false; }
        audioPresent.set(id, ok);
      }
      if (badge.isConnected) paintAudioBadge(badge, audioPresent.get(id));
    }
  }
  function renderList() {
    domClear(listHolder);
    const shown = sortLibrary(filterLibrary(entries, query), sortMode);
    if (!shown.length) {
      listHolder.append(domEl('p', { class: 'no-results', id: 'lib-none' }, 'Nessun brano corrisponde alla ricerca.'));
      return;
    }
    const list = domEl('ul', { class: 'songs' });
    for (const s of shown) {
      const meta = [s.kind === 'tab' ? 'Tab' : '', s.artist, s.difficulty, formatDateIt(s.importedAt)].filter(Boolean).join(' · ');
      const edited = s.timingSource === 'edited' || s.timingSource === 'recorded';
      list.append(domEl('li', { 'data-id': s.id },
        domEl('a', { class: 'song-row', href: '#/song/' + encodeURIComponent(s.id) },
          domEl('span', { class: 'song-title' }, s.title || 'Senza titolo'),
          domEl('span', { class: 'song-meta' }, meta),
          edited || s.hasAudio ? domEl('span', { class: 'song-badges' }, edited ? domEl('span', { class: 'badge', 'data-badge': 'durate' }, `durate ✓${s.bars ? ' · ' + s.bars + ' battute' : ''}`) : null, s.hasAudio ? domEl('span', { class: 'badge', 'data-badge': 'audio' }, audioPresent.has(s.id) ? (audioPresent.get(s.id) ? 'audio ✓' : 'audio mancante') : 'audio') : null) : null),
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
            audioStoreDelete(s.id).then(() => {});
            showLibraryScreen(root, { onImportFile, onPasteTab });
          },
        }, '✕')));
    }
    listHolder.append(list);
    for (const b of list.querySelectorAll('.badge[data-badge="audio"]')) if (audioPresent.get(b.closest('li').getAttribute('data-id')) === false) b.classList.add('missing');
    checkAudioBadges();
  }

  // ---- backup ----
  const used = domEl('p', { class: 'muted small', id: 'storage-used' }, '');
  const paintUsed = async () => {
    const base = `Spazio usato nel browser: circa ${formatKb(storageUsedBytes())} (${entries.length} ${entries.length === 1 ? 'brano' : 'brani'}).`;
    used.textContent = base;
    const totals = await audioStoreTotals();
    const quota = await audioStoreQuota();
    const parts = [];
    if (totals.count) parts.push(`Audio: ${totals.count} ${totals.count === 1 ? 'file' : 'file'}, ${formatMb(totals.bytes)}.`);
    if (quota && quota.quota) parts.push(`Il browser ha usato ${formatMb(quota.usage)} su ${formatMb(quota.quota)} disponibili.`);
    if (parts.length) used.textContent = `${base} ${parts.join(' ')}`;
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
    showLibraryScreen(root, { onImportFile, onPasteTab });
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

  const latencyNote = domEl('p', { class: 'muted small', id: 'device-latency' }, '');
  const paintLatency = () => {
    const ms = getDevice().latencyMs;
    latencyNote.textContent = Number.isFinite(ms) ? `Latenza dell’audio su questo dispositivo: ${ms} ms.` : 'Latenza dell’audio non ancora calibrata (0 ms).';
  };
  paintLatency();
  const device = domEl('section', { class: 'lib-backup', id: 'lib-device' },
    domEl('h2', null, 'Audio e cuffie'),
    latencyNote,
    domEl('div', { class: 'row' },
      domEl('button', { type: 'button', class: 'btn', id: 'btn-calibrate', onclick: () => openCalibration({ onSaved: paintLatency }) }, 'Calibra la latenza')));

  // technical information: a JSON without any text of the song, to send to whoever looks after the app
  const diagOut = domEl('textarea', { class: 'diag-out', id: 'diag-out', readonly: true, rows: 8, hidden: true, 'aria-label': 'Informazioni tecniche' });
  const diagMsg = domEl('p', { class: 'muted small', id: 'diag-msg' }, '');
  async function exportDiagnostics() {
    try {
      const stored = getDiag();
      const idx = listSongs();
      const withAl = idx.map((e) => getSong(e.id)).filter((s) => s && s.audio && s.audio.alignment);
      const song = (stored && getSong(stored.songId)) || withAl[0] || null;
      let audioContext = stored && stored.player ? stored.player.audioContext : null;
      if (!audioContext && typeof AudioContext === 'function') {
        try { const c = new AudioContext(); audioContext = { sampleRate: c.sampleRate, baseLatency: c.baseLatency ?? null, outputLatency: c.outputLatency ?? null }; c.close(); } catch { /* none */ }
      }
      const data = buildDiagnostics({
        userAgent: navigator.userAgent, platform: navigator.platform || '', language: navigator.language || '',
        audioContext, device: getDevice(), player: stored ? stored.player : null, drift: stored && stored.player ? stored.player.drift : null, song, nowIso: new Date().toISOString(),
      });
      const text = JSON.stringify(data, null, 1);
      diagOut.value = text;
      diagOut.hidden = false;
      await deliverFile('guitarapp-diagnostica.json', text);
      diagMsg.textContent = stored ? 'Informazioni tecniche pronte (file scaricato o condiviso; puoi anche copiare il testo qui sotto).' : 'Informazioni tecniche pronte. Per i dati di riproduzione ascolta prima un brano con audio per almeno 30 secondi.';
    } catch (err) {
      diagMsg.textContent = `Non riesco a preparare le informazioni tecniche: ${err.message || err}`;
    }
  }
  device.append(
    domEl('div', { class: 'row' }, domEl('button', { type: 'button', class: 'btn', id: 'btn-diag', onclick: exportDiagnostics }, 'Informazioni tecniche')),
    domEl('p', { class: 'muted small' }, 'Un file con i dati tecnici del telefono e della riproduzione (nessun testo del brano), da mandare a chi cura l’app.'),
    diagMsg,
    diagOut);

  const empty = domEl('section', { class: 'empty' },
    domEl('h2', null, 'Nessun brano ancora'),
    domEl('p', null, 'Importa una pagina di Ultimate Guitar salvata come file .mht.'),
    domEl('ol', null,
      domEl('li', null, 'Apri il brano su Ultimate Guitar nel browser.'),
      domEl('li', null, 'Salva la pagina come MHTML. Da Chrome per computer: menu ⋮ → Salva, stampa e condividi → Salva pagina come, formato «Pagina web, singolo file (.mht)». Su telefono il salvataggio MHTML può non essere disponibile: in quel caso salva da Chrome per computer e passa il file al telefono.'),
      domEl('li', null, 'Tocca «Importa .mht» e scegli il file.')));

  renderList();
  root.append(domEl('div', { class: 'screen lib' }, header, msg, entries.length ? tools : null, entries.length ? listHolder : empty, device, backup));
}
