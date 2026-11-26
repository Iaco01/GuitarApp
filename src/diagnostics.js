// The exportable technical information (pure): what the phone does with the audio, without any text of the song. The user
// sends the JSON to whoever looks after the app.

export const DIAG_VERSION = 1;
export const DRIFT_EVERY_SEC = 10;
const DRIFT_MAX = 60;

// Drift of the media clock against the wall clock while playing: samples { wall, media, ctx? } (seconds) taken every
// DRIFT_EVERY_SEC. Returns { slope, rows } with slope = d(media)/d(wall) per stretch of playback at rate 1 (1 = no drift)
// and the offset in ms of each sample from the line of the first one: media - media0 - (wall - wall0) * rate.
export function driftSummary(samples, rate = 1) {
  const rows = [];
  if (!samples.length) return { slope: null, rows };
  const s0 = samples[0];
  for (const s of samples) {
    const r = { t: Math.round((s.wall - s0.wall) * 10) / 10, offsetMs: Math.round(((s.media - s0.media) - (s.wall - s0.wall) * rate) * 1000) };
    if (Number.isFinite(s.ctx) && Number.isFinite(s0.ctx)) r.vsCtxMs = Math.round(((s.media - s0.media) - (s.ctx - s0.ctx) * rate) * 1000);
    rows.push(r);
  }
  const last = samples[samples.length - 1];
  const dw = last.wall - s0.wall;
  const slope = dw > 1 ? Math.round(((last.media - s0.media) / dw / rate) * 1e5) / 1e5 : null;
  return { slope, rows: rows.slice(-DRIFT_MAX) };
}

// Collects the drift samples of a player (call tick(playing, mediaSec, ctxSec, nowSec) often; it keeps one per 10 s of
// uninterrupted play and starts over after a seek, pause or change of rate).
export function createDriftRecorder() {
  let samples = [];
  let last = null;
  let rate = 1;
  return {
    reset(newRate = rate) { samples = []; last = null; rate = newRate; },
    tick(mediaSec, ctxSec, wallSec) {
      if (last !== null && wallSec - last < DRIFT_EVERY_SEC) return;
      last = wallSec;
      samples.push({ wall: wallSec, media: mediaSec, ctx: Number.isFinite(ctxSec) ? ctxSec : undefined });
      if (samples.length > DRIFT_MAX) samples.shift();
    },
    summary: () => driftSummary(samples, rate),
  };
}

// facts: { userAgent, platform, audioContext: { sampleRate, baseLatency, outputLatency } | null, device, player: player.diagnostics() | null,
// drift }, song: the saved song (only the alignment and counts are used). No names of chords or text of the song.
export function buildDiagnostics({ userAgent = '', platform = '', language = '', audioContext = null, device = {}, player = null, drift = null, song = null, nowIso = '' } = {}) {
  const al = song && song.audio && song.audio.alignment ? song.audio.alignment : null;
  return {
    kind: 'guitarapp-diagnostics',
    version: DIAG_VERSION,
    createdAt: nowIso,
    userAgent,
    platform,
    language,
    audioContext,
    latencyMs: Number.isFinite(device.latencyMs) ? device.latencyMs : 0,
    player,
    drift,
    audio: song && song.audio ? { fileName: song.audio.fileName ? '(present)' : null, anchors: Array.isArray(song.audio.anchors) ? song.audio.anchors.length : 0 } : null,
    alignment: al
      ? {
        events: al.eventStartSec.length,
        decode: al.decode || null,
        createdAt: al.createdAt || null,
        accepted: !!al.accepted,
        musicEndSec: al.musicEndSec,
        firstEventTimesSec: al.eventStartSec.slice(0, 60),
      }
      : null,
  };
}
