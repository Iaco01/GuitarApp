// Player on top of an <audio> element: the audio is the clock. Same surface as createPlayer
// (play, pause, stop, playFromEvent, playFromTime, setTimeline, setMetronome, setLoop, getInfo...)
// plus setRate (speed with preserved pitch) and setLatency. The timeline given to it is built with
// speed 1 and the anchors of the song, so its times are positions in the audio file.
//
// Display time = audio.currentTime - latency (the sound reaches the ears later than the media
// clock reports it). Metronome clicks go through the same AudioContext as the audio (the element is
// routed through it the first time the click is turned on) and are scheduled with lookahead from the
// media position, converted to context time (see audiosync.js).

import { eventIndexAtTime, beatIndexAtTime } from './timeline.js';
import { createWakeKeeper } from './player.js';
import { createMediaClickCore, loopSeekTarget, LOOP_PREROLL_SEC } from './audiosync.js';
import { createDriftRecorder } from './diagnostics.js';
import { scanMp3 } from './mp3frames.js';
import { mp3Layout, mp3Kind, mp3DurationSec, planMp3Slice } from './mp3seek.js';

const AUDIO_TICK_MS = 25;
const REVOKE_DELAY_MS = 10000;
const CLICK_LATE_TOLERANCE_SEC = 0.05; // = lateTolerance of createMediaClickCore

export function createAudioPlayer({ timeline, blob, latencyMs = 0, onFrame, onState, onNotice, onError } = {}) {
  let tl = timeline;
  let state = 'stopped'; // stopped | playing | paused
  let latency = (Number(latencyMs) || 0) / 1000;
  let rate = 1;
  let metronome = false;
  let loopSection = null;
  let destroyed = false;
  let raf = 0;
  let timer = null;
  let ctx = null;
  let sourceNode = null;
  let core = createMediaClickCore({ beats: tl.beats });
  let scheduled = []; // { osc, when }
  const wake = createWakeKeeper({ onNotice, isDestroyed: () => destroyed });
  const hasRaf = typeof requestAnimationFrame === 'function';

  // Exact seeking (mp3seek.js): once the file is scanned, every jump loads a Blob that starts at an exact frame, and the
  // media position is `originSec + el.currentTime`. Until then (and for other formats) the plain element seek is used.
  const fullUrl = URL.createObjectURL(blob);
  let sliceUrl = null;
  let originSec = 0;
  let loading = false; // a new source is loading: the element clock is not running yet
  let scanDone = false;
  let memBlob = blob;
  let exact = null; // { scan, layout, kind } after the scan of an mp3
  const drift = createDriftRecorder();
  let bestDrift = null;
  const restartDrift = () => {
    const cur = drift.summary();
    if (cur.rows.length >= 2 && (!bestDrift || cur.rows.length >= bestDrift.rows.length)) bestDrift = cur;
    drift.reset(rate);
  };
  let diag = { seeks: 0, lastSeekMs: 0, maxSeekMs: 0, slices: 0, lastGapMs: 0, maxGapMs: 0 };
  let gapFrom = 0; // when the last jump during play began (ms): the silence of a jump lasts until the element plays again
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const el = new Audio();
  el.preload = 'auto';
  el.src = fullUrl;
  function applyRate() {
    for (const k of ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch']) {
      if (k in el) el[k] = true;
    }
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }
  applyRate();

  // (while a new source loads the element may still report the position of the old one: the origin is the position)
  const mediaPos = () => originSec + (loading ? 0 : el.currentTime);
  // (right after a jump the blob plays its few lead frames before the wanted time: the position shown never goes before the time asked)
  let floorSec = 0;
  // (the delay of the output path is real time: at a slower rate it covers less of the file)
  const latMedia = () => latency * rate;
  const pos = () => Math.max(mediaPos(), floorSec) - latMedia();

  const scanReady = (async () => {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const scan = scanMp3(bytes);
      if (scan && !destroyed) {
        // the slices are cut from a copy in memory: slicing a Blob that lives in IndexedDB crashed the renderer after a few jumps
        memBlob = new Blob([bytes], { type: blob.type || 'audio/mpeg' });
        const layout = mp3Layout(bytes, scan);
        exact = { scan, layout, kind: mp3Kind(bytes, scan) };
      }
    } catch { /* not readable: plain seeking */ }
    scanDone = true;
    return !!exact;
  })();
  // runs `fn` now, or when the scan is done (a seek before that would be the inexact one)
  function whenScanned(fn) {
    if (scanDone) { fn(); return Promise.resolve(); }
    return scanReady.then(() => { if (!destroyed) fn(); });
  }

  // Moves the media position to `t` (seconds of the file timeline) without changing play/pause; if the player is playing
  // it carries on from the new place.
  function seekMedia(t) {
    const target = Math.max(0, t);
    floorSec = target;
    restartDrift();
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const wasPlaying = state === 'playing';
    if (!exact) {
      el.currentTime = target;
      resetClicks(target);
      return;
    }
    const plan = planMp3Slice(exact.scan, exact.layout, target);
    const next = URL.createObjectURL(memBlob.slice(plan.byteStart));
    const old = sliceUrl;
    sliceUrl = next;
    originSec = plan.originSec;
    loading = true;
    el.src = next;
    applyRate();
    // (revoked a little later: with the media element still letting go of the old source a renderer crash was seen in Chromium)
    if (old) setTimeout(() => URL.revokeObjectURL(old), REVOKE_DELAY_MS);
    diag.slices++;
    diag.seeks++;
    diag.lastSeekMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
    diag.maxSeekMs = Math.max(diag.maxSeekMs, diag.lastSeekMs);
    resetClicks(originSec);
    gapFrom = wasPlaying ? nowMs() : 0;
    if (wasPlaying) {
      const pr = el.play();
      if (pr && pr.catch) pr.catch(() => {});
    }
  }

  function info() {
    const timeSec = pos();
    return {
      state,
      timeSec,
      eventIndex: eventIndexAtTime(tl, timeSec),
      beatIndex: beatIndexAtTime(tl, timeSec),
      countdown: 0,
      startEvent: -1,
      loopSection,
    };
  }

  function setState(s) {
    state = s;
    if (onState) onState(s);
  }

  // ---- clicks ----
  function click(whenIn, accent, mediaTime = NaN) {
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
    scheduled.push({ osc, gain, when, mt: mediaTime });
  }

  // Cancels the clicks not yet sounded (after a seek, pause or rate change).
  function cancelClicks() {
    if (!ctx) {
      scheduled = [];
      return;
    }
    const now = ctx.currentTime;
    for (const s of scheduled) {
      if (s.when > now) {
        try { s.osc.stop(); } catch { /* already stopped */ }
        try { s.gain.disconnect(); } catch { /* ignore */ }
      }
    }
    scheduled = [];
  }

  function resetClicks(mediaSec) {
    cancelClicks();
    core.reset(mediaSec);
  }

  function tick() {
    if (state === 'playing' && !loading && typeof performance !== 'undefined') drift.tick(mediaPos(), ctx ? ctx.currentTime : NaN, performance.now() / 1000);
    if (!ctx || state !== 'playing' || !metronome) return;
    const now = ctx.currentTime;
    if (loading) return;
    const due = core.pull({ ctxNow: now, mediaNow: mediaPos(), rate, limitSec: loopSection !== null && tl.sections[loopSection] ? tl.sections[loopSection].endSec : Infinity });
    for (const b of due) click(b.when, b.accent, b.mediaTime);
    if (scheduled.length > 64) scheduled = scheduled.filter((s) => s.when > now - 0.1);
  }

  async function ensureGraph() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!ctx) ctx = new AC();
      if (!sourceNode) {
        sourceNode = ctx.createMediaElementSource(el);
        sourceNode.connect(ctx.destination);
      }
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 600))]);
      return ctx.state === 'running';
    } catch {
      return false;
    }
  }

  // ---- seeking and loop ----
  function seekDisplay(sec) {
    seekMedia(Math.max(0, sec + latMedia()));
  }

  function checkLoop() {
    if (loopSection === null || state !== 'playing' || loading) return;
    const target = loopSeekTarget(pos(), tl.sections[loopSection]);
    if (target !== null) seekDisplay(Math.max(0, target - LOOP_PREROLL_SEC));
  }

  function frame() {
    raf = 0;
    if (destroyed || state !== 'playing') return;
    checkLoop();
    if (onFrame) onFrame(info());
    raf = hasRaf ? requestAnimationFrame(frame) : setTimeout(frame, 16);
  }

  function halt() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (raf) {
      if (hasRaf) cancelAnimationFrame(raf);
      else clearTimeout(raf);
    }
    raf = 0;
    cancelClicks();
    wake.release();
  }

  async function startPlaying() {
    if (destroyed) return;
    if (metronome) await ensureGraph();
    await scanReady;
    try {
      await el.play();
    } catch (err) {
      if (onError) onError('Non riesco a riprodurre l’audio: ' + (err && err.message ? err.message : 'riproduzione bloccata'));
      return;
    }
    if (destroyed) return;
    if (state === 'playing' && raf) return;
    setState('playing');
    resetClicks(mediaPos());
    timer = timer || setInterval(tick, AUDIO_TICK_MS);
    tick();
    wake.acquire();
    if (!raf) frame();
  }

  el.addEventListener('timeupdate', () => {
    // fallback for the loop when animation frames are throttled (hidden tab)
    checkLoop();
  });
  el.addEventListener('seeked', () => {
    if (state === 'playing') resetClicks(mediaPos());
  });
  // (a source that is going to play keeps `loading` until the element really plays: before that its clock is stopped and the clicks
  // scheduled from it would sound early)
  el.addEventListener('loadedmetadata', () => { if (el.paused) loading = false; });
  el.addEventListener('playing', () => {
    loading = false;
    if (gapFrom) {
      diag.lastGapMs = Math.round(nowMs() - gapFrom);
      diag.maxGapMs = Math.max(diag.maxGapMs, diag.lastGapMs);
      gapFrom = 0;
    }
    if (state === 'playing') resetClicks(mediaPos());
  });
  el.addEventListener('ended', () => {
    halt();
    // stopped first: seekMedia carries on playing when the state is still 'playing' (the new slice would restart the song)
    state = 'stopped';
    seekMedia(0);
    el.pause();
    setState('stopped');
    if (onFrame) onFrame(info());
  });
  el.addEventListener('error', () => {
    if (onError) onError('Il file audio non può essere letto da questo browser.');
  });

  function onVisibility() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && state === 'playing') {
      wake.acquire();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const api = {
    kind: 'audio',
    element: el,
    play() {
      if (state === 'playing') return Promise.resolve();
      return startPlaying();
    },
    pause() {
      if (state !== 'playing') return;
      el.pause();
      halt();
      restartDrift();
      setState('paused');
      if (onFrame) onFrame(info());
    },
    stop() {
      el.pause();
      halt();
      seekMedia(0);
      setState('stopped');
      if (onFrame) onFrame(info());
    },
    playFromEvent(eventIndex) {
      const e = tl.events[eventIndex];
      return e ? api.playFromTime(e.startSec) : Promise.resolve();
    },
    playFromTime(sec) {
      return whenScanned(() => seekDisplay(sec)).then(() => {
        if (destroyed) return undefined;
        if (state === 'playing') {
          if (onFrame) onFrame(info());
          return undefined;
        }
        return startPlaying();
      });
    },
    // moves the position without starting or stopping (scrubbing)
    seek(sec) {
      whenScanned(() => {
        seekDisplay(sec);
        if (onFrame) onFrame(info());
      });
    },
    setTimeline(next) {
      tl = next;
      core = createMediaClickCore({ beats: tl.beats });
      if (state === 'playing') resetClicks(mediaPos());
      if (state !== 'playing' && onFrame) onFrame(info());
    },
    setMetronome(on) {
      metronome = !!on;
      if (!metronome) {
        cancelClicks();
        return;
      }
      if (state === 'playing') ensureGraph().then(() => resetClicks(mediaPos()));
    },
    setRate(r) {
      rate = Math.min(2, Math.max(0.25, Number(r) || 1));
      el.defaultPlaybackRate = rate;
      el.playbackRate = rate;
      restartDrift();
      // the beats up to the current position were already heard: restarting from "a beat just behind" (the tolerance of reset)
      // would sound the last one twice
      if (state === 'playing') {
        // (the media clock is read in steps: a click that already sounded can have a beat time a little ahead of the position)
        const now = ctx ? ctx.currentTime : 0;
        let lastHeard = -Infinity;
        for (const sc of scheduled) if (sc.when <= now && sc.mt > lastHeard) lastHeard = sc.mt;
        cancelClicks();
        core.reset(Math.max(mediaPos(), lastHeard + 0.001) + CLICK_LATE_TOLERANCE_SEC);
      }
    },
    setLatency(ms) {
      latency = (Number(ms) || 0) / 1000;
      if (state === 'playing') resetClicks(mediaPos());
    },
    setLoop(sectionIndex) {
      loopSection = sectionIndex;
      if (sectionIndex === null || state !== 'playing') return;
      const s = tl.sections[sectionIndex];
      if (!s) return;
      const t = pos();
      if (t < s.startSec || t >= s.endSec) seekDisplay(Math.max(0, s.startSec - LOOP_PREROLL_SEC));
      else resetClicks(mediaPos());
    },
    getLoop: () => loopSection,
    getState: () => state,
    getInfo: info,
    currentTime: pos,
    // media duration, once known (NaN before metadata is loaded)
    duration: () => (exact ? mp3DurationSec(exact.scan, exact.layout) : el.duration),
    // resolves when the scan of the file is done (true: exact seeking is on)
    ready: () => scanReady,
    isExact: () => !!exact,
    // The element as the tests and the old scripts see it: `currentTime` is the media position of the file (what the player means by
    // it) and setting it makes an exact jump; everything else is the element's.
    elementView() {
      return new Proxy(el, {
        get(target, prop) {
          if (prop === 'currentTime') return mediaPos();
          if (prop === 'duration') return api.duration();
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set(target, prop, value) {
          if (prop === 'currentTime') { api.seek(Number(value) - latMedia()); return true; }
          return Reflect.set(target, prop, value, target);
        },
      });
    },
    // media position (file timeline, without the latency) and the facts that go to the exported diagnostics
    mediaTime: mediaPos,
    diagnostics: () => ({
      exactSeek: !!exact,
      mp3: exact ? exact.kind : null,
      frontSamples: exact ? exact.layout.frontSamples : null,
      browserDurationSec: Number.isFinite(el.duration) ? el.duration : null,
      scanDurationSec: exact ? exact.kind.durationSec : null,
      seeks: diag.seeks,
      lastSeekMs: diag.lastSeekMs,
      maxSeekMs: diag.maxSeekMs,
      lastGapMs: diag.lastGapMs,
      maxGapMs: diag.maxGapMs,
      latencyMs: Math.round(latency * 1000),
      audioContext: ctx ? { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency ?? null, outputLatency: ctx.outputLatency ?? null } : null,
      drift: (() => { const cur = drift.summary(); return cur.rows.length >= 2 && (!bestDrift || cur.rows.length >= bestDrift.rows.length) ? cur : bestDrift; })(),
    }),
    destroy() {
      destroyed = true;
      halt();
      try { el.pause(); } catch { /* ignore */ }
      el.removeAttribute('src');
      try { el.load(); } catch { /* ignore */ }
      URL.revokeObjectURL(fullUrl);
      if (sliceUrl) { const u = sliceUrl; setTimeout(() => URL.revokeObjectURL(u), REVOKE_DELAY_MS); }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) { try { ctx.close(); } catch { /* ignore */ } }
    },
  };
  return api;
}
