// "Sincronizza audio": load the audio, set the start of the first chord (offset) with a fine
// adjustment, optional section anchors, BPM suggestions between anchors, latency calibration.

import { domEl, domClear } from './dom.js';
import { createAudioPlayer } from '../audio.js';
import { buildTimeline } from '../timeline.js';
import { effectiveSectionBpms } from '../model.js';
import { audioStoreGet } from '../audiostore.js';
import { getDevice } from '../storage.js';
import { formatBpm } from '../render.js';
import { audioAnchors, formatClock, setAnchor, removeAnchor, suggestSectionBpms, applyBpmSuggestion, listenFromSec } from '../audiosync.js';
import { attachAudioFile, removeAudioFile, AUDIO_ACCEPT } from './audiofile.js';
import { openCalibration } from './calibrate.js';

const SYNC_FINE_MS = [-50, -10, 10, 50];
const SYNC_NUDGE_SEC = 0.1;
const SYNC_BPM_STEP = 0.5;
const SYNC_SKIP_SEC = 5;

// Opens the screen for `song`. `persist()` saves the song; `onClose({ changed })` runs afterwards.
export function openSyncScreen({ song, persist, onClose, blob = null }) {
  let player = null;
  let currentBlob = blob;
  let changed = false;
  let nextIdx = 1;
  let listening = false;
  let message = '';
  let lastPosKey = '';

  const sectionName = (i) => song.sections[i].name || `Sezione ${i + 1}`;
  const latencyMs = () => (Number.isFinite(getDevice().latencyMs) ? getDevice().latencyMs : 0);
  const buildTl = () => buildTimeline(song, { speed: 1, anchors: audioAnchors(song.audio) });

  const posLbl = domEl('div', { class: 'sync-pos', id: 'sync-pos', 'aria-live': 'off' }, '0:00,0');
  const scrub = domEl('input', {
    type: 'range', id: 'sync-scrub', min: '0', max: '1', step: '0.1', value: '0', 'aria-label': 'Posizione nell’audio',
    oninput: () => { if (player) player.seek(Number(scrub.value)); },
  });
  const playBtn = domEl('button', { type: 'button', class: 'btn primary', id: 'sync-play', onclick: () => togglePlay() }, 'Play');
  const msg = domEl('p', { class: 'msg', id: 'sync-msg', role: 'status' }, '');
  const dyn = domEl('div', { class: 'sync-dyn', id: 'sync-dyn' });
  const fileInput = domEl('input', {
    type: 'file', id: 'sync-file', class: 'file-input', accept: AUDIO_ACCEPT,
    onchange: async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      setMsg('Carico «' + file.name + '»…');
      if (player) player.stop();
      const r = await attachAudioFile(song, file, () => window.confirm('Questo file è diverso da quello di prima (nome o dimensione). Tenere l’inizio e le ancore già fissati?'));
      if (!r.ok) {
        setMsg(r.error, true);
        return;
      }
      changed = true;
      persist();
      currentBlob = file;
      setMsg(r.kept ? 'Audio sostituito: inizio e ancore conservati.' : 'Audio caricato. Ora fissa l’inizio del primo accordo.');
      makePlayer();
      render();
    },
  });

  function setMsg(text, error = false) {
    message = text;
    msg.textContent = text;
    msg.className = 'msg' + (error ? ' error' : '');
  }

  function makePlayer() {
    if (player) player.destroy();
    player = null;
    if (!song.audio || !currentBlob) return;
    player = createAudioPlayer({
      timeline: buildTl(),
      blob: currentBlob,
      latencyMs: latencyMs(),
      onFrame: paintPos,
      onState: (st) => {
        playBtn.textContent = st === 'playing' ? 'Pausa' : 'Play';
        if (st !== 'playing' && listening) {
          listening = false;
          player.setMetronome(false);
        }
      },
      onError: (t) => setMsg(t, true),
    });
    player.setMetronome(false);
    scrub.max = String(song.audio.durationSec || 1);
    window.__gappSync = { player, element: player.element };
  }

  function rebuildTl() {
    if (player) player.setTimeline(buildTl());
    changed = true;
    persist();
  }

  function paintPos(info) {
    const t = info.timeSec;
    const key = Math.round(t * 10) + '|' + info.state;
    if (key === lastPosKey) return;
    lastPosKey = key;
    posLbl.textContent = `${formatClock(t)} / ${formatClock(song.audio ? song.audio.durationSec : 0)}`;
    if (document.activeElement !== scrub) scrub.value = String(Math.max(0, t));
  }

  function togglePlay() {
    if (!player) return;
    if (player.getState() === 'playing') player.pause();
    else player.play();
  }

  const now = () => (player ? player.currentTime() : 0);

  function setAnchorAt(i, sec) {
    const r = setAnchor(song.audio, i, sec, song.sections.length);
    if (!r.ok) {
      setMsg(r.reason, true);
      return false;
    }
    setMsg('');
    rebuildTl();
    render();
    return true;
  }

  function listenFrom(sec, withClick) {
    if (!player) return;
    listening = !!withClick;
    player.setMetronome(!!withClick);
    player.playFromTime(Math.max(0, sec));
  }

  // ---- dynamic part ----
  function render() {
    domClear(dyn);
    const audio = song.audio;
    // 1. file
    const fileBox = domEl('section', { class: 'sync-box', id: 'sync-file-box' }, domEl('h3', null, '1. File audio'));
    if (audio) {
      fileBox.append(
        domEl('p', { class: 'sync-file-name', id: 'sync-file-name' }, `${audio.fileName} · ${formatClock(audio.durationSec).replace(/,\d$/, '')}`),
        domEl('div', { class: 'row' },
          domEl('label', { class: 'btn', for: 'sync-file' }, 'Sostituisci file'),
          domEl('button', {
            type: 'button', class: 'btn danger', id: 'sync-remove',
            onclick: async () => {
              if (!window.confirm('Eliminare l’audio di questo brano? L’inizio e le ancore andranno perse.')) return;
              if (player) player.destroy();
              player = null;
              await removeAudioFile(song);
              currentBlob = null;
              changed = true;
              persist();
              setMsg('Audio eliminato.');
              render();
            },
          }, 'Elimina audio')));
      if (!currentBlob) fileBox.append(domEl('p', { class: 'msg error' }, `Audio mancante: ricarica «${audio.fileName}» con «Sostituisci file».`));
    } else {
      fileBox.append(
        domEl('p', { class: 'muted' }, 'Scegli il file audio della canzone (mp3, m4a, wav). Resta sul tuo telefono, non viene caricato da nessuna parte.'),
        domEl('label', { class: 'btn primary', for: 'sync-file', id: 'sync-pick' }, 'Carica audio'));
    }
    dyn.append(fileBox);
    if (!audio || !currentBlob) return;

    // latency
    const lat = getDevice().latencyMs;
    dyn.append(domEl('section', { class: 'sync-box' },
      domEl('h3', null, 'Latenza del dispositivo'),
      domEl('p', { class: 'muted small', id: 'sync-latency' }, Number.isFinite(lat) ? `Impostata a ${lat} ms.` : 'Non ancora calibrata (0 ms). Con le cuffie Bluetooth conviene calibrarla.'),
      domEl('button', {
        type: 'button', class: 'btn', id: 'sync-calibrate',
        onclick: () => {
          if (player) player.pause();
          openCalibration({ onSaved: (ms) => { if (player) player.setLatency(ms); changed = true; render(); } });
        },
      }, 'Calibra la latenza')));

    // 2. offset
    const fine = domEl('div', { class: 'row sync-fine' }, SYNC_FINE_MS.map((d) => domEl('button', {
      type: 'button', class: 'btn', 'data-ms': d, 'aria-label': `${d > 0 ? '+' : '−'}${Math.abs(d)} millisecondi`,
      onclick: () => setAnchorAt(0, Math.max(0, audio.offsetSec + d / 1000)),
    }, `${d > 0 ? '+' : '−'}${Math.abs(d)}`)));
    dyn.append(domEl('section', { class: 'sync-box', id: 'sync-offset-box' },
      domEl('h3', null, '2. Inizio'),
      domEl('p', { class: 'muted' }, 'Premi Play e, appena senti il primo accordo, tocca il pulsante grande.'),
      domEl('button', { type: 'button', class: 'rec-tap sync-tap', id: 'sync-first', onclick: () => setAnchorAt(0, now()) }, 'Primo accordo!'),
      domEl('p', { class: 'sync-offset', id: 'sync-offset' }, `Inizio: ${formatClock(audio.offsetSec)} (${Math.round(audio.offsetSec * 1000)} ms)`),
      fine,
      domEl('button', { type: 'button', class: 'btn', id: 'sync-listen', onclick: () => listenFrom(listenFromSec(audio.offsetSec), true) }, 'Ascolta da qui (con il clic)')));

    // 3. anchors
    const n = song.sections.length;
    if (nextIdx >= n) nextIdx = n;
    const nextBtn = nextIdx < n
      ? domEl('button', { type: 'button', class: 'btn primary sync-next', id: 'sync-next', onclick: () => { if (setAnchorAt(nextIdx, now())) { nextIdx = nextAfter(nextIdx); render(); } } }, `Inizio sezione: ${sectionName(nextIdx)}`)
      : domEl('p', { class: 'muted small' }, 'Tutte le sezioni sono state fissate.');
    const bpms = effectiveSectionBpms(song);
    const rows = domEl('ul', { class: 'sync-rows', id: 'sync-rows' });
    song.sections.forEach((s, i) => {
      const t = i === 0 ? audio.offsetSec : audio.anchors[i];
      const has = t !== undefined;
      rows.append(domEl('li', { 'data-sec': i, class: has ? 'has' : '' },
        domEl('div', { class: 'sync-row-top' },
          domEl('span', { class: 'sync-row-name' }, i === 0 ? `${sectionName(i)} (inizio)` : sectionName(i)),
          domEl('span', { class: 'sync-row-time' }, has ? `⚓ ${formatClock(t)}` : '—')),
        domEl('div', { class: 'row' },
          has ? domEl('button', { type: 'button', class: 'btn small', 'data-act': 'minus', onclick: () => { setAnchorAt(i, t - SYNC_NUDGE_SEC); render(); } }, '−0,1 s') : null,
          has ? domEl('button', { type: 'button', class: 'btn small', 'data-act': 'plus', onclick: () => { setAnchorAt(i, t + SYNC_NUDGE_SEC); render(); } }, '+0,1 s') : null,
          has ? domEl('button', { type: 'button', class: 'btn small', 'data-act': 'listen', onclick: () => listenFrom(t - 1, false) }, 'Ascolta') : null,
          i > 0 && has ? domEl('button', { type: 'button', class: 'btn small danger', 'data-act': 'remove', 'aria-label': `Togli l’ancora di ${sectionName(i)}`, onclick: () => { removeAnchor(audio, i); rebuildTl(); render(); } }, '✕ Togli') : null,
          i > 0 && !has ? domEl('button', { type: 'button', class: 'btn small', 'data-act': 'here', onclick: () => { if (setAnchorAt(i, now())) { nextIdx = Math.max(nextIdx, i + 1); render(); } } }, 'Fissa qui') : null),
        domEl('div', { class: 'row sync-bpm' },
          domEl('span', null, `♩ = ${formatBpm(bpms[i])}`),
          domEl('button', { type: 'button', class: 'btn small', 'data-act': 'bpm-', 'aria-label': 'BPM meno 0,5', onclick: () => { stepBpm(i, -SYNC_BPM_STEP); } }, '−0,5'),
          domEl('button', { type: 'button', class: 'btn small', 'data-act': 'bpm+', 'aria-label': 'BPM più 0,5', onclick: () => { stepBpm(i, SYNC_BPM_STEP); } }, '+0,5'))));
    });
    dyn.append(domEl('section', { class: 'sync-box', id: 'sync-anchors-box' },
      domEl('h3', null, '3. Sezioni (facoltativo)'),
      domEl('p', { class: 'muted' }, 'Se il brano cambia tempo o la registrazione “scivola”, segna l’inizio di ogni sezione mentre ascolti.'),
      nextBtn,
      nextIdx < n ? domEl('button', { type: 'button', class: 'btn small', id: 'sync-skip', onclick: () => { nextIdx = nextAfter(nextIdx); render(); } }, 'Salta questa sezione') : null,
      rows,
      domEl('div', { class: 'row' },
        domEl('button', {
          type: 'button', class: 'btn', id: 'sync-end',
          onclick: () => {
            const t = now();
            const lastA = Math.max(...Object.values(audioAnchors(audio)));
            if (!(t > lastA)) {
              setMsg('La fine del brano deve cadere dopo l’ultima ancora.', true);
              return;
            }
            audio.endSec = t;
            setMsg('');
            rebuildTl();
            render();
          },
        }, 'Fine brano'),
        audio.endSec ? domEl('span', { class: 'sync-row-time', id: 'sync-end-time' }, `⚓ ${formatClock(audio.endSec)}`) : null,
        audio.endSec ? domEl('button', { type: 'button', class: 'btn small danger', id: 'sync-end-clear', onclick: () => { delete audio.endSec; rebuildTl(); render(); } }, '✕') : null)));

    // 4. suggestions
    const sugs = suggestSectionBpms(song, audio);
    const list = domEl('div', { class: 'sync-sugs', id: 'sync-sugs' });
    if (!sugs.length) list.append(domEl('p', { class: 'muted small', id: 'sync-nosug' }, audio.endSec || Object.keys(audio.anchors).length ? 'I tempi delle sezioni coincidono con l’audio.' : 'Fissa almeno un’ancora (o la fine del brano) per avere un suggerimento sul BPM.'));
    for (const s of sugs) {
      const names = s.from === s.to ? `La sezione ${sectionName(s.from)} sembra` : `Le sezioni ${sectionName(s.from)}–${sectionName(s.to)} sembrano`;
      list.append(domEl('div', { class: 'sync-sug' },
        domEl('span', null, `${names} a ${formatBpm(s.suggested)} BPM (ora ${formatBpm(s.current)})`),
        domEl('button', {
          type: 'button', class: 'btn small primary', 'data-act': 'apply',
          onclick: () => { applyBpmSuggestion(song, s); rebuildTl(); render(); },
        }, 'Applica')));
    }
    dyn.append(domEl('section', { class: 'sync-box', id: 'sync-sug-box' }, domEl('h3', null, '4. Tempo'), list));
  }

  function nextAfter(i) {
    return i + 1;
  }

  function stepBpm(i, d) {
    const sec = song.sections[i];
    const cur = effectiveSectionBpms(song)[i];
    sec.bpm = Math.min(300, Math.max(30, Math.round((cur + d) * 10) / 10));
    sec.bpmSource = 'edited';
    rebuildTl();
    render();
  }

  const close = () => {
    if (player) player.destroy();
    player = null;
    delete window.__gappSync;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose({ changed });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const overlay = domEl('div', { class: 'rec sync', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sincronizza audio' },
    domEl('div', { class: 'sync-head' },
      domEl('div', { class: 'rec-title' }, 'Sincronizza audio'),
      domEl('button', { type: 'button', class: 'btn primary', id: 'sync-close', onclick: close }, 'Fatto')),
    msg,
    domEl('div', { class: 'sync-transport', id: 'sync-transport' },
      domEl('div', { class: 'row' },
        domEl('button', { type: 'button', class: 'btn', id: 'sync-back5', 'aria-label': '5 secondi indietro', onclick: () => { if (player) player.seek(Math.max(0, now() - SYNC_SKIP_SEC)); } }, '−5 s'),
        playBtn,
        domEl('button', { type: 'button', class: 'btn', id: 'sync-fwd5', 'aria-label': '5 secondi avanti', onclick: () => { if (player) player.seek(now() + SYNC_SKIP_SEC); } }, '+5 s')),
      posLbl, scrub),
    dyn,
    fileInput);

  function start() {
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    if (song.audio && song.audio.durationSec) scrub.max = String(song.audio.durationSec);
    const last = Math.max(0, ...Object.keys((song.audio && song.audio.anchors) || {}).map(Number));
    nextIdx = last + 1;
    (async () => {
      if (song.audio && !currentBlob) currentBlob = await audioStoreGet(song.id);
      if (song.audio && currentBlob) makePlayer();
      render();
      if (message) msg.textContent = message;
    })();
  }
  start();
  return close;
}
