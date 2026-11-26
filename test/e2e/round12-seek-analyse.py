# Round 12: position error of the captures of round12-seek.cjs. For every run (mode, seek target T) the captured output
# (ScriptProcessor, mono) is located in the ffmpeg decode by FFT cross-correlation; the error is the reported media
# position of the capture minus the true time found.  The first run of each mode (T = 0, no seek) gives the fixed bias of
# the capture path, which is subtracted.  Prints times only.
import json, sys, numpy as np
D = sys.argv[1] + '/'
meta = json.load(open(D + 'meta.json')); sr = meta['sampleRate']
ref = np.fromfile(D + 'ref.f32', dtype='<f4')
def locate(x, around, span=12.0):
    a = max(0, int((around - span) * sr)); b = min(len(ref), int((around + span) * sr) + len(x))
    seg = ref[a:b]; n = 1
    while n < len(seg) + len(x): n *= 2
    c = np.fft.irfft(np.fft.rfft(seg, n) * np.conj(np.fft.rfft(x, n)), n)[:len(seg) - len(x) + 1]
    # normalise by local energy of the reference
    e = np.cumsum(np.concatenate([[0], seg.astype(np.float64) ** 2])); en = e[len(x):len(x) + len(c)] - e[:len(c)]
    c = c / np.sqrt(en + 1e-9)
    k = int(np.argmax(c)); return (a + k) / sr, float(c[k] / (np.linalg.norm(x) + 1e-9))
bias = {}
rows = []
for r in meta['runs']:
    x = np.fromfile(D + 'cap-%d.f32' % r['i'], dtype='<f4')
    if r['n'] < 6 or len(x) < sr * 2: print(r['mode'], r['T'], 'no audio captured'); continue
    # use the part from chunk 3 on (the start can contain the lead-in), 1.5 s long
    k0 = 3; s0 = k0 * 4096; seg = x[s0:s0 + int(1.5 * sr)]
    reported = r['pos'][k0]
    guess = reported
    true, corr = locate(seg, guess)
    # reported position changes with the chunks: use the median of the difference over a few chunks for the same reported moment
    err = reported - true
    rows.append((r['mode'], r['T'], err, corr))
for mode in ('plain', 'exact'):
    b = [e for m, T, e, c in rows if m == mode and T == 0]
    bias[mode] = b[0] if b else 0.0
print('bias of the capture path (T=0): plain %.0f ms, exact %.0f ms' % (bias['plain'] * 1e3, bias['exact'] * 1e3))
worst = {}
for m, T, e, c in rows:
    if T == 0: continue
    e2 = (e - bias[m]) * 1e3
    worst[m] = max(worst.get(m, 0), abs(e2))
    print('%-5s seek %5.0f s: position error %+7.0f ms (corr %.2f)' % (m, T, e2, c))
print('worst abs error: ' + ', '.join('%s %.0f ms' % (m, v) for m, v in worst.items()))
