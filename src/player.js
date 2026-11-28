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

// Same as the scheduler core, for the notes of the synth guitar: `notes` sorted by startSec (song time). pull(now) gives
// [{ note, when }] for the notes due before now + lookahead; with a loop it wraps from loop.endSec to loop.startSec on the
// same continuous clock. A note of a loop range that is not there is simply not in the way.
export function createNoteScheduler({ notes, lookahead = 0.1, lateTolerance = 0.05, loop = null }) {
  let next = 0;
  let origin = 0;
  let offset = 0;
  const lowerBound = (t) => {
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].startSec < t - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const loopOk = !!loop && loop.endSec > loop.startSec && lowerBound(loop.startSec) < notes.length && notes[lowerBound(loop.startSec)].startSec < loop.endSec;
  return {
    start({ fromSec, offsetSec, originCtx }) {
      next = lowerBound(fromSec);
      offset = offsetSec;
      origin = originCtx;
    },
    pull(now) {
      const out = [];
      for (;;) {
        if (loopOk && (next >= notes.length || notes[next].startSec >= loop.endSec)) {
          origin += loop.endSec - loop.startSec;
          next = lowerBound(loop.startSec);
          if (origin - offset + loop.startSec >= now + lookahead + (loop.endSec - loop.startSec)) break;
          continue;
        }
        if (next >= notes.length) break;
        const n = notes[next];
        const when = origin + (n.startSec - offset);
        if (when >= now + lookahead) break;
        if (when >= now - lateTolerance) out.push({ note: n, when });
        next++;
      }
      return out;
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

// Screen Wake Lock held while something plays. `acquire()` asks for the lock (and warns once through
// onNotice when the browser cannot), `release()` gives it back, also when a request that was still
// pending resolves after the release.
export function createWakeKeeper({ onNotice, isDestroyed = () => false } = {}) {
  let wakeLock = null;
  let wakeWarned = false;
  let wakeWanted = false;
  let wakePending = false;
  return {
    async acquire() {
      if (!(typeof navigator !== 'undefined' && navigator.wakeLock && navigator.wakeLock.request)) {
        if (!wakeWarned) {
          wakeWarned = true;
          if (onNotice) onNotice('Il tuo browser non può tenere lo schermo acceso: lo schermo potrebbe spegnersi.');
        }
        return;
      }
      wakeWanted = true;
      if (wakeLock || wakePending) return;
      wakePending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!wakeWanted || isDestroyed()) {
          // paused or stopped while the request was pending: give the lock back at once
          try { lock.release(); } catch { /* ignore */ }
        } else {
          wakeLock = lock;
          lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
        }
      } catch {
        wakeLock = null;
      } finally {
        wakePending = false;
      }
    },
    release() {
      wakeWanted = false;
      if (wakeLock) {
        try { wakeLock.release(); } catch { /* ignore */ }
        wakeLock = null;
      }
    },
  };
}

// `synth` (optional): { create(ctx) -> engine } with engine.play(note, when), engine.silence(futureOnly), engine.destroy(): the notes of
// the synth guitar (setNotePlan) are scheduled on the same clock and with the same lookahead as the clicks.
export function createPlayer({ timeline, timeSignature = [4, 4], onFrame, onState, onNotice, synth = null } = {}) {
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
  let engine = null;
  let synthOn = false;
  let notePlan = [];
  let noteCore = null;
  let volumeWanted = 0.8;
  let timer = null;
  let raf = 0;
  const wake = createWakeKeeper({ onNotice, isDestroyed: () => destroyed });
  const acquireWake = wake.acquire;
  const releaseWake = wake.release;
  const pending = [];
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

  function click(whenIn, accent) {
    const when = Math.max(0, whenIn); // a click a few ms late on a brand new context would be negative
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
    pending.push({ osc, when });
    if (pending.length > 64) pending.splice(0, pending.length - 32);
  }

  // Silences the clicks already scheduled but not yet heard (before rebuilding the beat grid).
  function cancelPendingClicks() {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const p of pending) {
      if (p.when > now) { try { p.osc.stop(now); } catch { /* ignore */ } }
    }
    pending.length = 0;
  }

  function tick() {
    if (!usingAudio || !core) return;
    const due = core.pull(ctx.currentTime);
    if (metronome) for (const b of due) click(b.when, b.accent);
    if (noteCore && engine) for (const d of noteCore.pull(ctx.currentTime)) engine.play(d.note, d.when);
  }

  // the notes of the synth from song time `fromSec`, on the clock origin `originCtx`
  function makeNoteCore(fromSec, offsetSec, originCtx) {
    noteCore = null;
    if (!synthOn || !engine || !notePlan.length) return;
    noteCore = createNoteScheduler({ notes: notePlan, loop: loopSpec() });
    noteCore.start({ fromSec, offsetSec, originCtx });
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
    noteCore = null;
    if (engine) engine.silence(false);
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
      if (usingAudio && synth && !engine) { engine = synth.create(ctx); engine.setVolume(volumeWanted); }
    } catch {
      usingAudio = false;
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
      if (usingAudio && (metronome || (synthOn && notePlan.length))) for (let k = 0; k < countBeats; k++) click(t0 + k * countSpb, k === 0);
      anchor = t0 + countBeats * countSpb;
      setState('counting');
    } else {
      anchor = t0;
      setState('playing');
    }
    offset = sec;
    core = createSchedulerCore({ beats: tl.beats, loop: loopSpec() });
    core.start({ fromIndex: firstBeatIndexFrom(tl, sec), offsetSec: sec, originCtx: anchor });
    makeNoteCore(sec, sec, anchor);
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
      cancelPendingClicks();
      if (engine) engine.silence(true);
      offset = timeAtBeatPosition(tl, beatPos);
      anchor = clock() - latency();
    } else {
      offset = timeAtBeatPosition(tl, beatPositionAtTime(old, offset));
    }
    core = createSchedulerCore({ beats: tl.beats, loop: loopSpec() });
    core.start({ fromIndex: firstBeatIndexFrom(tl, offset + 0.001), offsetSec: offset, originCtx: anchor });
    if (state === 'playing') makeNoteCore(offset + 0.001, offset, anchor);
  }

  const api = {
    // The notes of the synth guitar for the current timeline (see tabsynth.js). Call before setTimeline when both change.
    setNotePlan(plan) {
      notePlan = plan || [];
      if (engine && state === 'playing') { engine.silence(true); makeNoteCore(position() + 0.001, offset, anchor); }
    },
    setSynth(on) {
      synthOn = !!on;
      if (!synthOn) { noteCore = null; if (engine) engine.silence(false); return; }
      if (state === 'playing') makeNoteCore(position() + 0.001, offset, anchor);
    },
    setSynthVolume(v) { if (engine) engine.setVolume(v); volumeWanted = v; },
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
        makeNoteCore(p + 0.001, p, anchor);
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
      if (engine) engine.destroy();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) { try { ctx.close(); } catch { /* ignore */ } }
    },
  };
  return api;
}
