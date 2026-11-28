// Web Audio side of the synth guitar: the plucked strings of tabsynth.js as AudioBuffers (rendered once per pitch and kept),
// played with an envelope, the glides and the vibrato of the note, into one volume and a limiter.

import { renderPluck } from './tabsynth.js';

const SV_BUFFER_SEC = 2.6;
const SV_CACHE_MAX = 80;
const SV_MAX_VOICES = 28;
const SV_RELEASE_SEC = 0.09;

// engine: { play(note, when), silence(futureOnly), setVolume(v), destroy() } on the context `ctx`.
export function createSynthEngine(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter);
  limiter.connect(ctx.destination);
  const cache = new Map();
  let voices = [];

  function bufferFor(hz) {
    const key = Math.round(1200 * Math.log2(hz) / 2); // 2 cent steps
    let b = cache.get(key);
    if (b) {
      cache.delete(key);
      cache.set(key, b);
      return b;
    }
    const data = renderPluck(2 ** (key * 2 / 1200), { sampleRate: ctx.sampleRate, seconds: SV_BUFFER_SEC });
    b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.getChannelData(0).set(data);
    cache.set(key, b);
    if (cache.size > SV_CACHE_MAX) cache.delete(cache.keys().next().value);
    return b;
  }

  function drop(v) {
    voices = voices.filter((x) => x !== v);
  }

  function stopVoice(v, at, fade) {
    try {
      v.gain.gain.cancelScheduledValues(at);
      v.gain.gain.setTargetAtTime(0, at, fade / 4);
      v.src.stop(at + fade);
      if (v.lfo) v.lfo.stop(at + fade);
    } catch { /* already stopped */ }
  }

  return {
    // The note: { hz, vel, startSec..., glide, legato, mute, vibrato, endSec } at ctx time `when`.
    play(note, when) {
      const now = ctx.currentTime;
      const t0 = Math.max(when, now);
      const dur = Math.max(0.04, note.endSec - note.startSec);
      const startHz = note.glide && note.glide.startHz ? note.glide.startHz : note.hz;
      const src = ctx.createBufferSource();
      src.buffer = bufferFor(note.mute ? note.hz : startHz);
      const gain = ctx.createGain();
      const peak = Math.min(1, note.vel * (note.mute ? 0.6 : 1));
      // a soft but quick attack (no click), then the natural decay of the string; the end of the note is a release
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + (note.legato ? 0.008 : 0.0025));
      const endAt = t0 + dur;
      const rel = note.mute ? 0.03 : SV_RELEASE_SEC;
      gain.gain.setValueAtTime(peak, Math.max(t0 + 0.01, endAt - rel));
      gain.gain.linearRampToValueAtTime(0, endAt);
      src.connect(gain);
      gain.connect(master);
      const v = { src, gain, when: t0, lfo: null };
      if (note.glide) {
        const g = note.glide;
        const target = 1200 * Math.log2(g.hz / startHz);
        src.detune.setValueAtTime(0, t0);
        src.detune.setValueAtTime(0, t0 + g.from * dur);
        src.detune.linearRampToValueAtTime(target, t0 + Math.max(g.to, g.from + 0.02) * dur);
      }
      if (note.vibrato) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.3;
        depth.gain.setValueAtTime(0, t0);
        depth.gain.setValueAtTime(0, t0 + 0.2);
        depth.gain.linearRampToValueAtTime(22, t0 + 0.55);
        lfo.connect(depth);
        depth.connect(src.detune);
        lfo.start(t0);
        lfo.stop(endAt + 0.05);
        v.lfo = lfo;
      }
      src.onended = () => drop(v);
      src.start(t0);
      src.stop(endAt + 0.02);
      voices.push(v);
      if (voices.length > SV_MAX_VOICES) stopVoice(voices.shift(), ctx.currentTime, 0.04);
    },
    // Stops the notes: the ones that have not started yet (futureOnly) or all of them, with a short fade (no click).
    silence(futureOnly) {
      const now = ctx.currentTime;
      const keep = [];
      for (const v of voices) {
        if (futureOnly && v.when <= now) { keep.push(v); continue; }
        if (v.when > now) { try { v.src.stop(now); if (v.lfo) v.lfo.stop(now); } catch { /* ignore */ } } else stopVoice(v, now, 0.05);
      }
      voices = keep;
    },
    setVolume(v) {
      const x = Math.min(1, Math.max(0, v));
      master.gain.setTargetAtTime(x * x * 1.1, ctx.currentTime, 0.02);
    },
    destroy() {
      voices = [];
      cache.clear();
      try { master.disconnect(); limiter.disconnect(); } catch { /* ignore */ }
    },
  };
}
