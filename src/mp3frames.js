// MP3 frame scanner (pure): finds the frames of an MPEG audio layer III stream so that a long song can be decoded in
// pieces (each piece a few seconds of the file: the decoded audio of a whole song is a few hundred MB of native memory
// at once, and one long task of the main thread when it arrives).

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const MP3_MIN_FRAMES = 100;

// Header at `p`: { length, sampleRate, spf } or null.
function mp3Header(b, p) {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[p + 1] >> 3) & 3; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5, 1: reserved
  const layer = (b[p + 1] >> 1) & 3; // 1: layer III
  const br = b[p + 2] >> 4;
  const sr = (b[p + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return null;
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATES_V1 : BITRATES_V2)[br] * 1000;
  const sampleRate = RATES[version][sr];
  const pad = (b[p + 2] >> 1) & 1;
  return { length: Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + pad, sampleRate, spf: v1 ? 1152 : 576 };
}

// bytes: Uint8Array of the whole file. Returns { offsets: Int32Array (start of every frame, plus the end of the last
// one), sampleRate, spf } or null if this is not a plain layer III stream (other formats, too few frames, a change of
// sample rate): the caller decodes the whole file instead.
export function scanMp3(bytes) {
  const n = bytes.length;
  let p = 0;
  if (n > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    p = 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f) + (bytes[5] & 0x10 ? 10 : 0);
  }
  const offsets = [];
  let rate = 0;
  let spf = 0;
  let lost = 0;
  let chainEnd = -1;
  while (p + 4 <= n) {
    const h = mp3Header(bytes, p);
    // a header counts if the next one follows exactly where it says, or the file ends there, or the chain of frames has
    // been going on (the last frame before a tag at the end of the file)
    const next = h ? p + h.length : 0;
    if (h && (next === n || next + 4 > n || mp3Header(bytes, next) || (offsets.length >= 2 && p === chainEnd))) {
      if (rate && (h.sampleRate !== rate || h.spf !== spf)) return null;
      rate = h.sampleRate;
      spf = h.spf;
      offsets.push(p);
      p = next;
      chainEnd = next;
      lost = 0;
    } else {
      p++;
      // a tag or garbage at the end is fine; in the middle of the audio it is not
      if (++lost > 65536 && offsets.length < MP3_MIN_FRAMES) return null;
    }
  }
  if (offsets.length < MP3_MIN_FRAMES) return null;
  offsets.push(Math.min(n, p));
  return { offsets: Int32Array.from(offsets), sampleRate: rate, spf };
}
