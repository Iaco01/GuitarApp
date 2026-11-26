// Exact seeking in an MP3 (pure): the browsers estimate the byte position of a time from the bitrate (or from a coarse
// Xing table), and for a VBR file they land seconds away from the time asked while still reporting the time asked.
// The player avoids seeking: it plays a Blob that starts at an exact frame, so the position is
// `origin + el.currentTime` in every browser. This module finds the frame and the origin.

export const MP3_SEEK_LEAD_FRAMES = 3; // frames decoded before the wanted one (bit reservoir); ~78 ms at 48 kHz

// Layout of the start of the stream given the scan: is the first frame a Xing/Info/VBRI tag (not audio), and how many
// samples the decoders drop at the start of the whole file (the tag frame and, with a LAME tag, the encoder delay plus
// the 529 samples of the decoder). The timeline of an alignment is the one of the whole file in the browser.
export function mp3Layout(bytes, scan) {
  const { offsets, spf } = scan;
  const p = offsets[0];
  let tag = false;
  let delay = 0;
  const end = Math.min(bytes.length, p + 200);
  const at = (i, s) => i + s.length <= end && [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  for (let i = p + 4; i < Math.min(end, p + 48); i++) {
    if (at(i, 'Xing') || at(i, 'Info')) {
      tag = true;
      const flags = bytes[i + 7];
      let q = i + 8;
      if (flags & 1) q += 4;
      if (flags & 2) q += 4;
      if (flags & 4) q += 100;
      if (flags & 8) q += 4;
      if (q + 24 <= end && (at(q, 'LAME') || at(q, 'Lavf') || at(q, 'Lavc'))) {
        delay = ((bytes[q + 21] << 4) | (bytes[q + 22] >> 4)) + 529;
      }
      break;
    }
    if (at(i, 'VBRI')) { tag = true; break; }
  }
  const firstAudio = tag ? 1 : 0;
  return { tag, firstAudio, frontSamples: tag ? spf + delay : 0 };
}

// Kind of stream, for the diagnostics: { vbr, tag, frames, durationSec }.
export function mp3Kind(bytes, scan) {
  const { offsets, sampleRate, spf } = scan;
  const lay = mp3Layout(bytes, scan);
  let vbr = false;
  const first = offsets[lay.firstAudio + 1] - offsets[lay.firstAudio];
  for (let i = lay.firstAudio + 1; i < offsets.length - 1 && !vbr; i++) {
    const len = offsets[i + 1] - offsets[i];
    if (Math.abs(len - first) > 1) vbr = true; // (padding makes the length differ by one byte)
  }
  return { vbr, tag: lay.tag, frames: offsets.length - 1, durationSec: mp3DurationSec(scan, lay) };
}

export function mp3DurationSec(scan, layout) {
  return ((scan.offsets.length - 1) * scan.spf - layout.frontSamples) / scan.sampleRate;
}

// Where to cut the file to play from `tSec`: { frame, byteStart, originSec }. The blob made from `byteStart` plays from
// `originSec` (media time of its first sample) in a straight line.
export function planMp3Slice(scan, layout, tSec, lead = MP3_SEEK_LEAD_FRAMES) {
  const { offsets, sampleRate, spf } = scan;
  const count = offsets.length - 1;
  const wanted = Math.floor((Math.max(0, tSec) * sampleRate + layout.frontSamples) / spf);
  const frame = Math.min(count - 1, Math.max(layout.firstAudio, wanted - lead));
  return { frame, byteStart: offsets[frame], originSec: (frame * spf - layout.frontSamples) / sampleRate };
}
