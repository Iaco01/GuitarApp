// Metronome and player: a pure scheduler core (testable in Node) plus the Web Audio / rAF shell.
// The song position always comes from one clock (AudioContext.currentTime, or performance.now()
// when audio is unavailable); highlighting is computed from it, never from timers.

import { beatIndexAtTime, eventIndexAtTime, beatPositionAtTime, timeAtBeatPosition } from './timeline.js';

// Decides which metronome clicks must be scheduled. `beats` is timeline.beats. Song time
// `offsetSec` corresponds to clock time `originCtx`. `loop` = { fromIdx, toIdx, startSec, endSec }
// wraps from beat toIdx (exclusive) back to fromIdx, keeping the clock continuous.
export function createSchedulerCore({ beats, lookahead = 0.1, lateTolerance = 0.05, loop = null }) {
  let next = 0;
  let origin = 0;
  let offset = 0;
  const loopOk = loop && loop.toIdx > loop.fromIdx && loop.endSec > loop.startSec;
  return {
    start({ fromIndex, offsetSec, originCtx }) {
      next = Math.max(0, fromIndex);
      offset = offsetSec;
      origin = originCtx;
    },
    // Beats whose click time falls before now + lookahead and that were not yet returned.
    pull(now) {
      const out = [];
      for (;;) {
        if (loopOk && next >= loop.toIdx) {
          origin += loop.endSec - loop.startSec;
          next = loop.fromIdx;
          continue;
        }
        if (next >= beats.length) break;
        const b = beats[next];
        const when = origin + (b.timeSec - offset);
        if (when >= now + lookahead) break;
        if (when >= now - lateTolerance) out.push({ index: b.index, when, accent: b.isDownbeat });
        next++;
      }
      return out;
    },
    nextIndex() {
      return next;
    },
  };
}

// First beat index at or after song time `sec`.
export function firstBeatIndexFrom(timeline, sec) {
  if (timeline.beats.length === 0) return 0;
  let i = beatIndexAtTime(timeline, sec + 1e-9);
  if (i < 0) return 0;
  if (timeline.beats[i].timeSec < sec - 1e-9) i++;
  return i;
}

export function createPlayer({ timeline, timeSignature = [4, 4], onFrame, onState, onNotice } = {}) {
  let tl = timeline;
  let state = 'stopped'; // stopped | counting | playing | paused
  let ctx = null;
  let usingAudio = false;
  let anchor = 0; // clock time at which song time == offset
  let offset = 0;
  let restPos = 0; // song time while paused / stopped
  let metronome = true;
  let loopSection = null;
  let core = null;
  let timer = null;
  let raf = 0;
  let wakeLock = null;
  let wakeWarned = false;
  let countSpb = 0.5;
  let countBeats = timeSignature[0] || 4;
  let destroyed = false;

  const hasRaf = typeof requestAnimationFrame === 'function';
  const clock = () => (usingAudio ? ctx.currentTime : performance.now() / 1000);
  const latency = () => (usingAudio ? ctx.outputLatency || ctx.baseLatency || 0 : 0);

  function loopSpec() {
    if (loopSection === null || !tl.sections[loopSection]) return null;
    const s = tl.sections[loopSection];
    if (s.endBeat <= s.startBeat) return null;
    return { fromIdx: s.startBeat, toIdx: s.endBeat, startSec: s.startSec, endSec: s.endSec };
  }

  function position() {
    if (state === 'paused' || state === 'stopped') return restPos;
    let pos = clock() - latency() - anchor + offset;
    const lp = loopSpec();
    if (lp && pos >= lp.endSec) pos = lp.startSec + ((pos - lp.startSec) % (lp.endSec - lp.startSec));
    return pos;
  }

  function info() {
    const timeSec = position();
    let countdown = 0;
    if (state === 'counting') {
      const left = anchor - (clock() - latency());
      countdown = Math.min(countBeats, Math.max(1, Math.ceil(left / countSpb - 1e-9)));
    }
    return {
      state,
      timeSec,
      eventIndex: state === 'counting' ? -1 : eventIndexAtTime(tl, timeSec),
      beatIndex: state === 'counting' ? -1 : beatIndexAtTime(tl, timeSec),
      countdown,
      startEvent: state === 'counting' ? Math.max(0, eventIndexAtTime(tl, offset)) : -1,
      loopSection,
    };
  }

  function setState(s) {
    state = s;
    if (onState) onState(s);
  }

  function click(when, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(accent ? 0.6 : 0.4, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.04);
  }

  function tick() {
    if (!usingAudio || !core) return;
    const due = core.pull(ctx.currentTime);
    if (metronome) for (const b of due) click(b.when, b.accent);
  }

  function frame() {
    raf = 0;
    if (destroyed || (state !== 'counting' && state !== 'playing')) return;
    if (state === 'counting' && clock() - latency() >= anchor) setState('playing');
    if (state === 'playing' && !loopSpec() && position() >= tl.totalSec) {
      finish();
      return;
    }
    if (onFrame) onFrame(info());
    raf = hasRaf ? requestAnimationFrame(frame) : setTimeout(frame, 16);
  }

  function finish() {
    halt();
    restPos = 0;
    setState('stopped');
    if (onFrame) onFrame(info());
  }

  function halt() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (raf) {
      if (hasRaf) cancelAnimationFrame(raf);
      else clearTimeout(raf);
    }
    raf = 0;
    releaseWake();
  }

  async function ensureAudio() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) {
      usingAudio = false;
      return;
    }
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state !== 'running') {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 600))]);
      }
      usingAudio = ctx.state === 'running';
    } catch {
      usingAudio = false;
    }
  }

  async function acquireWake() {
    if (!(typeof navigator !== 'undefined' && navigator.wakeLock && navigator.wakeLock.request)) {
      if (!wakeWarned) {
        wakeWarned = true;
        if (onNotice) onNotice('Il tuo browser non può tenere lo schermo acceso: lo schermo potrebbe spegnersi.');
      }
      return;
    }
    try {
      if (!wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      wakeLock = null;
    }
  }

  function releaseWake() {
    if (wakeLock) {
      try { wakeLock.release(); } catch { /* ignore */ }
      wakeLock = null;
    }
  }

  function onVisibility() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && (state === 'playing' || state === 'counting')) {
      acquireWake();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  function sectionBpmAt(sec) {
    const e = eventIndexAtTime(tl, sec);
    const ev = tl.events[Math.max(0, e)];
    return ev ? ev.bpm : 80;
  }

  // Starts playing from song time `sec`, with a one-bar count-in unless `count` is false.
  async function startAt(sec, { count = true } = {}) {
    if (destroyed || tl.events.length === 0) return;
    halt();
    const token = Symbol('start');
    startAt.token = token;
    await ensureAudio();
    if (startAt.token !== token || destroyed) return;
    restPos = sec;
    countBeats = timeSignature[0] || 4;
    countSpb = 60 / sectionBpmAt(sec) / tl.speed;
    const t0 = clock() + 0.08;
    if (count) {
      if (usingAudio && metronome) for (let k = 0; k < countBeats; k++) click(t0 + k * countSpb, k === 0);
      anchor = t0 + countBeats * countSpb;
      setState('counting');
    } else {
      anchor = t0;
      setState('playing');
    }
    offset = sec;
    core = createSchedulerCore({ beats: tl.beats, loop: loopSpec() });
    core.start({ fromIndex: firstBeatIndexFrom(tl, sec), offsetSec: sec, originCtx: anchor });
    if (usingAudio) {
      timer = setInterval(tick, 25);
      tick();
    }
    acquireWake();
    frame();
  }

  // Rebuilds timing after the timeline changed (durations, BPM, speed), keeping the beat position.
  function setTimeline(next) {
    const old = tl;
    const live = state === 'playing' || state === 'counting';
    const pos = position();
    const beatPos = beatPositionAtTime(old, pos);
    tl = next;
    if (state === 'paused' || state === 'stopped') {
      restPos = state === 'stopped' ? 0 : timeAtBeatPosition(tl, beatPos);
      return;
    }
    if (!live) return;
    if (state === 'playing') {
      offset = timeAtBeatPosition(tl, beatPos);
      anchor = clock() - latency();
    } else {
      offset = timeAtBeatPosition(tl, beatPositionAtTime(old, offset));
    }
    core = createSchedulerCore({ beats: tl.beats, loop: loopSpec() });
    core.start({ fromIndex: firstBeatIndexFrom(tl, offset + 0.001), offsetSec: offset, originCtx: anchor });
  }

  const api = {
    play() {
      if (state === 'playing' || state === 'counting') return Promise.resolve();
      return startAt(state === 'paused' ? restPos : 0);
    },
    pause() {
      if (state !== 'playing' && state !== 'counting') return;
      restPos = state === 'counting' ? offset : position();
      startAt.token = null;
      halt();
      setState('paused');
      if (onFrame) onFrame(info());
    },
    stop() {
      startAt.token = null;
      halt();
      restPos = 0;
      setState('stopped');
      if (onFrame) onFrame(info());
    },
    playFromEvent(eventIndex) {
      const e = tl.events[eventIndex];
      return e ? startAt(e.startSec) : Promise.resolve();
    },
    playFromTime(sec, opts) {
      return startAt(sec, opts);
    },
    setTimeline,
    setMetronome(on) {
      metronome = !!on;
    },
    setLoop(sectionIndex) {
      const live = state === 'playing' || state === 'counting';
      const p = live ? position() : 0;
      loopSection = sectionIndex;
      if (!live) return;
      const s = sectionIndex === null ? null : tl.sections[sectionIndex];
      if (s) {
        startAt(s.startSec, { count: false });
      } else {
        offset = p;
        anchor = clock() - latency();
        core = createSchedulerCore({ beats: tl.beats, loop: null });
        core.start({ fromIndex: firstBeatIndexFrom(tl, p + 0.001), offsetSec: p, originCtx: anchor });
      }
    },
    getLoop: () => loopSection,
    getState: () => state,
    getInfo: info,
    // Current song time for tap recording (latency compensated like the highlight).
    currentTime: position,
    destroy() {
      destroyed = true;
      startAt.token = null;
      halt();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) { try { ctx.close(); } catch { /* ignore */ } }
    },
  };
  return api;
}
