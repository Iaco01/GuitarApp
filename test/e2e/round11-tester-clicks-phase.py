# Round 11 tester, A2: phase of the metronome clicks against the beats of the real recording, measured with my own method
# (numpy STFT, attack strength = log-flux of low/mid/high bands; no use of the app's engine or its beat grid).
# Input: test-artifacts/round-11/clicks-raw-SE.json (round11-tester-clicks.cjs) + real22.wav. Prints times/counts only.
# Method 1: click -> nearest attack peak (strength > 4 in the local z-score) within +-0.15 s; null = the same clicks moved by half a beat.
# Method 2: in every 12 s window of a stable section, comb score of the attack curve on the click grid; the best phase shift of the comb
#           against the click grid is the window's phase error (wrapped to +-half a beat).
import json, sys, importlib.util, numpy as np
spec = importlib.util.spec_from_file_location('ind', '/home/user/guitarapp/test/e2e/round11-tester-indep.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
raw = json.load(open(m.D + 'clicks-raw-SE.json')); al = raw['al']; tl = raw['tl']; clicks = raw['clicks']; pairs = raw['pairs']
pc = np.array([(c, me - c) for c, me in pairs]); 
def media_of(when):
    k = np.abs(pc[:, 0] - when) < 2; return when + np.median(pc[k, 1]) if k.any() else np.nan
ck = np.array(sorted((media_of(w), f > 900) for w, f, _ in clicks)); ck = ck[np.isfinite(ck[:, 0])]
t = ck[:, 0]
o = m.N / 2 / m.SR; A = m.ATT
tt = np.arange(len(A)) / m.fps + o
pk = np.array([tt[k] for k in range(1, len(A) - 1) if A[k] >= A[k-1] and A[k] > A[k+1] and A[k] > 4.0])
secs = tl['sec']; stable = [i for i in range(len(secs)) if al['sections'][i].get('bpm') is not None and np.isfinite(al['sections'][i]['bpm'])] if 'sections' in al else []
def sec_of(x):
    for i, (s, e, b) in enumerate(secs):
        if s <= x < e: return i
    return -1
def nearest(x, arr):
    k = np.searchsorted(arr, x); c = arr[max(0, k - 1):k + 1]; return c[np.argmin(abs(c - x))]
rows = []
for x in t:
    si = sec_of(x)
    if si not in stable: continue
    bpm = secs[si][2]; per = 60 / bpm
    off = x - nearest(x, pk); off0 = (x + per / 2) - nearest(x + per / 2, pk)
    rows.append((si, off, off0, per))
rows = np.array(rows)
inw = abs(rows[:, 1]) < 0.15; inw0 = abs(rows[:, 2]) < 0.15
print('clicks in stable sections %d; within +-150 ms of an attack: %d (%.0f%%); null (clicks shifted half a beat): %d (%.0f%%)' % (len(rows), inw.sum(), 100 * inw.mean(), inw0.sum(), 100 * inw0.mean()))
a = rows[inw, 1]; print('offset click - attack (those within 150 ms): median %.0f ms, mean abs %.0f ms, p90 abs %.0f ms' % (np.median(a) * 1e3, abs(a).mean() * 1e3, np.percentile(abs(a), 90) * 1e3))
# method 2
res = []
for si in stable:
    s, e, bpm = secs[si]; per = 60 / bpm
    ct = t[(t >= s) & (t < e)]
    for w0 in np.arange(s + 1, e - 12, 6.0):
        c = ct[(ct >= w0) & (ct < w0 + 12)]
        if len(c) < 12: continue
        base = c % per  # phase of the clicks modulo the beat period (their own period = the grid)
        # comb: for shifts d in [-per/2, per/2), score = mean attack strength at (c + d)
        ds = np.arange(-per / 2, per / 2, 0.005)
        # attack curve interpolated
        def val(x): return np.interp(x, tt, A)
        sc = np.array([val(c + d).mean() for d in ds]); d = ds[np.argmax(sc)]
        res.append((si, w0, d, sc.max() / (sc.mean() + 1e-6)))
res = np.array(res)
print('windows %d (12 s, stable sections); comb shift needed to land on the attacks: median %.0f ms, mean abs %.0f ms, p90 abs %.0f ms; windows with |shift| > 60 ms: %d' % (len(res), np.median(res[:, 2]) * 1e3, abs(res[:, 2]).mean() * 1e3, np.percentile(abs(res[:, 2]), 90) * 1e3, (abs(res[:, 2]) > 0.06).sum()))
good = res[res[:, 3] > 1.5]
print('windows with a clear comb peak (peak/mean > 1.5): %d; median shift %.0f ms, p90 abs %.0f ms, > 60 ms: %d' % (len(good), np.median(good[:, 2]) * 1e3, np.percentile(abs(good[:, 2]), 90) * 1e3, (abs(good[:, 2]) > 0.06).sum()))
for si in sorted(set(int(r) for r in res[:, 0])):
    r = res[res[:, 0] == si]; print('section %d: %d windows, median shift %.0f ms, max abs %.0f ms' % (si + 1, len(r), np.median(r[:, 2]) * 1e3, abs(r[:, 2]).max() * 1e3))
json.dump(res.tolist(), open(m.D + 'clicks-phase.json', 'w'))
