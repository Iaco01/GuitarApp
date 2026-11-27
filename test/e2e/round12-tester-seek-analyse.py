# Round 12 tester, A: analysis of the captures of round12-tester-seek.cjs (numpy only, own method, not the app's clocks).
# For each run: the captured audio (the element's output, ScriptProcessor tap) is located in the ffmpeg decode of the real mp3 by
# correlation, window by window, which gives the TRUE file position of every moment of the run.  Then:
#   position error   = position the player claimed - true position (the implementer's metric)
#   highlight error  = file time at which the highlight changed to event k - my own attack of event k (spectral flux, round 11 method)
#   clicks           = metronome oscillators at their true file time vs the beat grid: doubles, missing, offset
#   silence          = stretches of digital silence in the output (loop turns, jumps)
# usage: python3 -I round12-tester-seek-analyse.py <build-dir> [ref.f32 sr]   prints only times / counts.
import sys, os, json, glob, importlib.util
import numpy as np
ROOT = '/home/user/guitarapp'
D = sys.argv[1]
_j0 = sorted(glob.glob(os.path.join(D, '*.json')))
SR_REF = next(json.load(open(f))['sr'] for f in _j0 if os.path.basename(f) not in ('timeline.json', 'mem.json', 'analysis.json') and 'sr' in json.load(open(f)))
REF = os.path.join(ROOT, 'test-artifacts', 'round-12', 'tester', os.environ.get('R12_REF_NAME', 'ref') + '%d.f32' % SR_REF)
if not os.path.exists(REF):
    os.system(f"ffmpeg -y -v error -i {os.environ.get('R12_REF_SRC', ROOT + '/test/fixtures/local/american-pie.mp3')} -map 0:a -ac 1 -ar {SR_REF} -f f32le {REF}")
ref = np.fromfile(REF, dtype=np.float32)
# attacks: my round 11 analysis module (own STFT of the 22.05 kHz decode); importing it computes the STFT once
spec = importlib.util.spec_from_file_location('indep', ROOT + '/test/e2e/round11-tester-indep.py')
indep = importlib.util.module_from_spec(spec); spec.loader.exec_module(indep)

def load(name):
    j = json.load(open(os.path.join(D, name + '.json')))
    pcm = np.fromfile(os.path.join(D, name + '.pcm'), dtype=np.int16).astype(np.float32) / 32767
    return j, pcm

def assemble(j, pcm):
    """samples laid contiguously (ScriptProcessor delivers every block; playbackTime of a block is jittery, ~+-15 ms, so the context
    time of sample i is t0 + i/sr with t0 = median over blocks of (playbackTime - offset/sr)).  returns x, t0, sr."""
    sr = j['sr']; tab = j['table']
    if not tab: return None, 0, sr
    t0 = float(np.median([pt - off / sr for pt, off, ln in tab]))
    return pcm, t0, sr

def env(x, sr, hop_ms=5):
    h = int(sr * hop_ms / 1000); n = len(x) // h
    e = np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1) + 1e-10)
    return np.log(e + 1e-4)

def xcorr_lag(a, b):
    """lag L (samples) maximising sum a[i] * b[i+L]; b longer than a.  returns (L, peak/rms ratio)"""
    n = 1
    while n < len(a) + len(b): n *= 2
    A = np.fft.rfft(a, n); B = np.fft.rfft(b, n)
    c = np.fft.irfft(np.conj(A) * B, n)[:len(b) - len(a) + 1]
    # normalise by local energy of b
    cs = np.concatenate([[0], np.cumsum(b.astype(np.float64) ** 2)])
    en = np.sqrt(cs[len(a):len(a) + len(c)] - cs[:len(c)] + 1e-9) * np.sqrt((a.astype(np.float64) ** 2).sum() + 1e-9)
    r = c / en
    k = int(np.argmax(r)); return k, float(r[k])

def locate(x, sr, t0, guess_file_t, rate, win=1.5, step=1.0, span=6.0):
    """list of (ctx_time_centre, file_time_centre, corr) for windows of the capture; rate 1: waveform correlation, else envelope."""
    out = []
    nwin = int(win * sr); nstep = int(step * sr)
    for s in range(0, len(x) - nwin, nstep):
        seg = x[s:s + nwin]
        if np.sqrt((seg ** 2).mean()) < 1e-3: continue
        ctx_c = t0 + (s + nwin / 2) / sr
        g = guess_file_t(ctx_c)
        if g is None: continue
        if rate == 1.0:
            f0 = max(0, int((g - win / 2 - span) * SR_REF)); f1 = min(len(ref), int((g + win / 2 + span) * SR_REF))
            if sr != SR_REF: raise SystemExit('sr mismatch %d' % sr)
            L, r = xcorr_lag(seg, ref[f0:f1])
            out.append((ctx_c, (f0 + L + nwin / 2) / SR_REF, r))
        else:
            # envelope correlation, capture time axis stretched by the rate onto the file axis (5 ms bins in file time)
            e = env(seg, sr, 5 / rate)  # capture bins of 5/rate ms = 5 ms of file time
            f0 = max(0, int((g - win * rate / 2 - span) * SR_REF)); f1 = min(len(ref), int((g + win * rate / 2 + span) * SR_REF))
            er = env(ref[f0:f1], SR_REF, 5)
            e = e - e.mean(); er = er - er.mean()
            k, r = xcorr_lag(e.astype(np.float32), er.astype(np.float32))
            # parabolic refine
            out.append((ctx_c, f0 / SR_REF + (k + len(e) / 2) * 0.005, r))
    return out

def fit_piecewise(win_pts, rate):
    """true file time as a function of context time: nearest accepted window, with slope `rate` (corr >= .6 for waveform, .5 envelope)"""
    thr = 0.7 if rate == 1.0 else 0.6
    pts = [(c, f, r) for c, f, r in win_pts if r >= thr]
    if rate != 1.0 and len(pts) >= 4:
        # one continuous stretch after the jump (no pause, no loop in these runs): the offset file - rate*ctx is constant; drop mislocked windows
        offs = np.array([f - rate * c for c, f, r in pts]); m = np.median(offs)
        pts = [p for p, o in zip(pts, offs) if abs(o - m) < 0.15]
    return pts

def true_file(pts, rate, c, span=1.0):
    """true file time at context time c from the window whose span contains c (None if no window covers c within `span` s of its centre)"""
    if not pts: return None
    k = min(range(len(pts)), key=lambda i: abs(pts[i][0] - c))
    cc, ff, _ = pts[k]
    if abs(c - cc) > span: return None
    return ff + rate * (c - cc)

def med(a): return float(np.median(a)) if len(a) else float('nan')
def mx(a): return float(np.max(np.abs(a))) if len(a) else float('nan')

TL = json.load(open(os.path.join(D, 'timeline.json'))) if os.path.exists(os.path.join(D, 'timeline.json')) else None
EV = TL['ev'] if TL else []
# reference attack for each event: strongest attack of my curve within +-0.12 s of the event start, kept only if strong (z >= 3)
ATTK = {}
for i, e in enumerate(EV):
    if e[5]: continue
    if os.environ.get('R12_NOHL'): continue
    t, z = indep.attack_near(e[0], 0.12)
    if t is not None and z >= 3.0: ATTK[i] = t
BEATS = np.array([b[0] for b in TL['beats']]) if TL else np.array([])

results = []
for jf in sorted(glob.glob(os.path.join(D, '*.json'))):
    name = os.path.basename(jf)[:-5]
    if name in ('timeline', 'mem', 'analysis'): continue
    j, pcm = load(name)
    x, t0, sr = assemble(j, pcm)
    if x is None or len(x) < sr: print(name, 'no audio'); continue
    rate = j.get('rate', 1.0)
    claims = [c for c in j['claim'] if c[0] is not None and c[2] is not None]
    cl_c = np.array([c[0] for c in claims]); cl_m = np.array([c[2] for c in claims])
    def guess(c):
        if not len(cl_c): return None
        k = int(np.argmin(np.abs(cl_c - c))); return cl_m[k]
    pts = fit_piecewise(locate(x, sr, t0, guess, rate, span=(6.0 if rate == 1.0 else 1.6)), rate)
    if not pts: print(name, 'could not locate'); continue
    # position error: claimed - true at the claim times, for claims after the first located window
    perr = []
    for c, _, m, _, st in j['claim']:
        if c is None or m is None or (st != 'playing' and j.get('type') != 'scrub'): continue
        tf = true_file(pts, rate, c)
        if tf is None: continue
        if abs(m - tf) < 5.0: perr.append((c, m - tf))  # (larger: the claim has jumped, the sound has not yet)
    perr = np.array(perr)
    # highlight error
    herr = []
    first_hl = True
    for c, w, ei, key in j['hl']:
        if c is None: continue
        if ei is None or ei < 0: continue
        if first_hl: first_hl = False; continue  # the change caused by the jump itself
        tf = true_file(pts, rate, c)
        if tf is None: continue
        if ei in ATTK: herr.append((ei, tf - ATTK[ei]))
    # clicks
    cerr = []; clk_f = []
    for w, fq, cur in j['clk']:
        tf = true_file(pts, rate, w)
        if tf is not None: clk_f.append((tf, fq))
    clk_f.sort()
    # silence: runs of |x| < 1e-4 longer than 20 ms
    sil = np.abs(x) < 1e-4; runs = []; s = None
    nz0 = np.nonzero(np.abs(x) > 1e-3)[0]; i0 = int(nz0[0]) if len(nz0) else 0
    for i, v in enumerate(sil):
        if i < i0: continue
        if v and s is None: s = i
        if not v and s is not None:
            if (i - s) / sr >= 0.02: runs.append(((s / sr) + t0, (i - s) / sr))
            s = None
    first_audio = None
    nz = np.nonzero(np.abs(x) > 1e-3)[0]
    if len(nz): first_audio = t0 + nz[0] / sr
    act = j['act'][-1][0] if j['act'] else None
    res = dict(name=name, type=j.get('type'), target=j.get('target'), rate=rate, nwin=len(pts), corr_min=min(p[2] for p in pts),
               perr_med=med(perr[:, 1]) if len(perr) else None, perr_max=mx(perr[:, 1]) if len(perr) else None, perr_vals=[round(float(v), 4) for v in perr[:, 1]] if len(perr) else [], perr_n=len(perr),
               herr=[(e, round(v, 3)) for e, v in herr], silences=[(round(a, 2), round(b, 3)) for a, b in runs],
               start_true=true_file(pts, rate, pts[0][0] - 0.5) if pts else None,
               lag_to_audio_ms=(round((first_audio - act) * 1000) if (first_audio is not None and act is not None and j.get('type') in ('base', 'listen', 'scrub')) else None),
               clicks=clk_f)
    results.append(res)
json.dump(results, open(os.path.join(D, 'analysis.json'), 'w'))
def fmt(v): return 'n/a' if v is None or v != v else '%.0f' % (v * 1000)
print('%-14s %5s %6s %6s %6s | %5s %7s %7s | %s' % ('run', 'nwin', 'corr', 'perrMed', 'perrMax', 'nHl', 'hlMed', 'hlMax', 'silences>20ms / lag to audio'))
for r in results:
    h = [v for _, v in r['herr']]
    print('%-14s %5d %6.2f %6s %6s | %5d %7s %7s | %s  lag %s ms' % (r['name'], r['nwin'], r['corr_min'], fmt(r['perr_med']), fmt(r['perr_max']), len(h), fmt(med(h)), fmt(mx(h)), r['silences'][:6], r['lag_to_audio_ms']))
