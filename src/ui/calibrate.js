// Latency calibration: regular clicks plus a circle that flashes on the beat; the user moves the
// slider until light and sound coincide. The value is a setting of the device (gapp.device.v1).

import { domEl } from './dom.js';
import { getDevice, saveDevice } from '../storage.js';
import { clampLatencyMs, initialLatencyMs, LATENCY_MIN_MS, LATENCY_MAX_MS } from '../audiosync.js';

const CAL_PERIOD_S = 0.6;
const CAL_FLASH_MS = 140;

// `onSaved(ms)` runs after saving. Returns a function that closes the screen.
export function openCalibration({ onSaved, onClose } = {}) {
  let ctx = null;
  let running = false;
  let nextClick = 0;
  let flashes = []; // context times of scheduled clicks still to flash
  let raf = 0;
  let timer = null;
  let proposed = null;

  const stored = getDevice().latencyMs;
  let value = initialLatencyMs(stored, undefined);

  const dot = domEl('div', { class: 'cal-dot', id: 'cal-dot', 'aria-hidden': 'true' });
  const valueLbl = domEl('output', { class: 'cal-val', id: 'cal-value', for: 'cal-slider' }, `${value} ms`);
  const slider = domEl('input', {
    type: 'range', id: 'cal-slider', min: String(LATENCY_MIN_MS), max: String(LATENCY_MAX_MS), step: '5', value: String(value),
    'aria-label': 'Latenza in millisecondi',
    oninput: () => setValue(Number(slider.value)),
  });
  const hint = domEl('p', { class: 'muted small', id: 'cal-hint' }, '');
  const startBtn = domEl('button', { type: 'button', class: 'btn primary', id: 'cal-start', onclick: () => (running ? stop() : start()) }, 'Avvia la prova');
  const useBtn = domEl('button', { type: 'button', class: 'btn', id: 'cal-use', hidden: true, onclick: () => { if (proposed !== null) setValue(proposed); } }, '');
  const nudge = (d) => domEl('button', { type: 'button', class: 'btn', 'aria-label': `${d > 0 ? '+' : '−'}${Math.abs(d)} millisecondi`, onclick: () => setValue(value + d) }, `${d > 0 ? '+' : '−'}${Math.abs(d)}`);

  function setValue(ms) {
    value = clampLatencyMs(ms);
    slider.value = String(value);
    valueLbl.textContent = `${value} ms`;
  }

  const close = () => {
    stop();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (ctx) { try { ctx.close(); } catch { /* ignore */ } }
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const overlay = domEl('div', { class: 'rec cal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Calibrazione della latenza' },
    domEl('div', { class: 'rec-title' }, 'Calibra la latenza'),
    domEl('p', null, 'Ascolta i clic e guarda il cerchio. Sposta il cursore finché il lampo e il suono sono nello stesso istante. Con le casse del telefono di solito basta 0; con le cuffie Bluetooth serve un valore più alto.'),
    domEl('div', { class: 'cal-stage' }, dot),
    domEl('div', { class: 'cal-row' }, nudge(-10), slider, nudge(10), valueLbl),
    hint,
    useBtn,
    startBtn,
    domEl('p', { class: 'muted small' }, 'Rifai la calibrazione ogni volta che cambi cuffie o altoparlante: il valore vale per questo dispositivo, non per il brano.'),
    domEl('div', { class: 'rec-bar' },
      domEl('button', { type: 'button', class: 'btn', id: 'cal-cancel', onclick: close }, 'Annulla'),
      domEl('button', {
        type: 'button', class: 'btn primary', id: 'cal-save',
        onclick: () => {
          try {
            saveDevice({ ...getDevice(), latencyMs: value });
          } catch (err) {
            hint.textContent = err.message;
            return;
          }
          if (onSaved) onSaved(value);
          close();
        },
      }, 'Salva')));

  function frame() {
    raf = 0;
    if (!running || !ctx) return;
    const now = ctx.currentTime - value / 1000;
    while (flashes.length && flashes[0] <= now) {
      flashes.shift();
      dot.classList.add('on');
      setTimeout(() => dot.classList.remove('on'), CAL_FLASH_MS);
    }
    raf = requestAnimationFrame(frame);
  }

  function tick() {
    if (!ctx) return;
    while (nextClick < ctx.currentTime + 0.3) {
      const t = nextClick;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1000;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
      flashes.push(t);
      nextClick += CAL_PERIOD_S;
    }
  }

  async function start() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) {
      hint.textContent = 'Questo browser non può riprodurre i clic.';
      return;
    }
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 600))]);
    } catch {
      hint.textContent = 'Non riesco ad avviare l’audio.';
      return;
    }
    const ol = ctx.outputLatency;
    if (Number.isFinite(ol) && ol > 0) {
      proposed = clampLatencyMs(ol * 1000);
      useBtn.textContent = `Usa il valore stimato dal telefono (${proposed} ms)`;
      useBtn.hidden = false;
    }
    running = true;
    flashes = [];
    nextClick = ctx.currentTime + 0.2;
    startBtn.textContent = 'Ferma la prova';
    timer = setInterval(tick, 50);
    tick();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    startBtn.textContent = 'Avvia la prova';
    dot.classList.remove('on');
  }

  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  startBtn.focus();
  return close;
}
