# Round 11 tester: independent audio analysis (numpy only; own STFT, chroma, bass chroma, band flux), not the app's engine.
# Reads test-artifacts/round-11/vs-r10.json (event times of r10 and r11) and real22.wav (ffmpeg -ac 1 -ar 22050 of the mp3).
# Gives, for each event, a change-point estimate of the chord change (full chroma, bass chroma) and the nearest attack (flux).
import json, wave, sys, numpy as np
D = '/home/user/guitarapp/test-artifacts/round-11/'
w = wave.open(D + 'real22.wav'); SR = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
HOP = 512; N = 4096
def stft(n):
    win = np.hanning(n).astype(np.float32); nf = (len(x) - n) // HOP
    idx = np.arange(n)[None, :] + HOP * np.arange(nf)[:, None]
    out = np.empty((nf, n // 2 + 1), np.float32)
    for a in range(0, nf, 2000):
        out[a:a+2000] = np.abs(np.fft.rfft(x[idx[a:a+2000]] * win, axis=1))
    return out
def chroma(S, n, lo, hi):
    f = np.fft.rfftfreq(n, 1 / SR); m = (f >= lo) & (f <= hi)
    pc = (np.round(12 * np.log2(f[m] / 440.0)) + 9) % 12  # 0 = C
    C = np.zeros((S.shape[0], 12), np.float32); L = np.log1p(30 * S[:, m])
    for k in range(12): C[:, k] = L[:, pc == k].sum(1)
    C -= C.mean(1, keepdims=True); return C
def centre(A, n):
    sh = (n // 2) // HOP  # frames to drop at the start so that row i is centred at i*HOP
    return np.concatenate([np.repeat(A[:1], sh, 0), A])[:len(A)] if False else np.concatenate([np.repeat(A[:1], 0, 0), A])
S = stft(N); fps = SR / HOP
CH = chroma(S, N, 100, 2000)
Sb = stft(8192); CB = chroma(Sb, 8192, 41, 200)
# attacks: half-wave rectified flux in low (<200 Hz: kick/bass) and high (2-8k: snare/strum) bands
def flux(S, n, lo, hi):
    f = np.fft.rfftfreq(n, 1 / SR); m = (f >= lo) & (f <= hi); L = np.log1p(30 * S[:, m]); d = np.maximum(L[1:] - L[:-1], 0).sum(1)
    return np.concatenate([[0], d])
FL = flux(S, N, 60, 250); FH = flux(S, N, 2000, 8000); FM = flux(S, N, 250, 2000)
def z(a): 
    k = int(fps * 4); m = np.convolve(a, np.ones(k) / k, 'same'); return a / (m + 1e-6)
ATT = z(FL) + z(FH) + z(FM)
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def tpl(name):
    r = NOTE[name[0]]; minor = name[1:2] == 'm'
    v = np.zeros(12, np.float32)
    for iv, wt in ((0, 1.0), (3 if minor else 4, 0.8), (7, 0.8)): v[(r + iv) % 12] = wt
    v -= v.mean(); return v / np.linalg.norm(v)
def bass(name):
    v = np.zeros(12, np.float32); v[NOTE[name[0]]] = 1; v -= v.mean(); return v / np.linalg.norm(v)
def sc(C, v):
    return (C @ v) / (np.linalg.norm(C, axis=1) + 1e-3)
OFF=[0.0]
def cp(C, tf, a, b, t0, t1, off=0.0):
    OFF[0] = off
    """best split of [t0,t1]: frames before ~ a, after ~ b. returns time and margin."""
    i0, i1 = int((t0 - off) * fps), int((t1 - off) * fps); d = sc(C[i0:i1], tf(b)) - sc(C[i0:i1], tf(a))
    c = np.cumsum(d); tot = c[-1]; best, bi = -1e9, 0
    for k in range(1, len(d) - 1):
        v = -c[k] + (tot - c[k]); 
        if v > best: best, bi = v, k
    return (i0 + bi) / fps + OFF[0], best / max(1, len(d))
def attack_near(t, rad=0.4):
    o = N / 2 / SR; i0, i1 = max(1, int((t - o - rad) * fps)), int((t - o + rad) * fps)
    seg = ATT[i0:i1]
    if len(seg) == 0: return None, 0
    k = int(np.argmax(seg)); return (i0 + k) / fps + o, float(seg[k])
if __name__ == '__main__':
    d = json.load(open(D + 'vs-r10.json')); ch = d['chords']; r10 = d['r10']; r11 = d['r11']
    rows = []
    for j in range(1, len(ch)):
        if ch[j] == ch[j - 1]: rows.append(None); continue
        t = r11[j]; lo = max(r11[j - 1] + 0.15, min(r10[j], r11[j]) - 0.6); hi = min(r11[j + 1] - 0.15 if j + 1 < len(ch) else t + 1, max(r10[j], r11[j]) + 0.6)
        if hi - lo < 0.5: rows.append(None); continue
        tf, mf = cp(CH, tpl, ch[j - 1], ch[j], lo, hi, N / 2 / SR); tb, mb = cp(CB, bass, ch[j - 1], ch[j], lo, hi, 4096 / SR)
        ta, za = attack_near(tf)
        rows.append(dict(j=j, chord=ch[j], prev=ch[j - 1], r10=r10[j], r11=r11[j], cp=tf, cpm=float(mf), cb=tb, cbm=float(mb), att=ta, attz=za))
    json.dump(rows, open(D + 'indep.json', 'w'))
    ok = [r for r in rows if r]
    print('events with a chord change', len(ok))
    for lab in ('r10', 'r11'):
        for ref in ('cp', 'cb', 'att'):
            e = np.array([r[lab] - r[ref] for r in ok if r[ref] is not None])
            print(lab, 'vs', ref, 'median %.0f ms, mean abs %.0f ms, p90 abs %.0f ms' % (np.median(e) * 1e3, np.abs(e).mean() * 1e3, np.percentile(np.abs(e), 90) * 1e3))
