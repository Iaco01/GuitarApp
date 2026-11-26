# Round 11 tester, A2/A4: per section, how many of the metronome clicks sit within 40 / 80 ms of an attack of the recording (own method), median interval
# in beats of the section tempo, and the tempo of the section. Needs clicks-raw-SE.json and real22.wav. Counts and times only.
import json, importlib.util, numpy as np
spec = importlib.util.spec_from_file_location('ind', '/home/user/guitarapp/test/e2e/round11-tester-indep.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
raw = json.load(open(m.D + 'clicks-raw-SE.json')); al = raw['al']; tl = raw['tl']
pc = np.array([(c, me - c) for c, me in raw['pairs']])
def media_of(w):
    k = np.abs(pc[:, 0] - w) < 2; return w + np.median(pc[k, 1]) if k.any() else np.nan
ck = np.array(sorted((media_of(w), f > 900) for w, f, _ in raw['clicks'])); ck = ck[np.isfinite(ck[:, 0])]; t = ck[:, 0]
o = m.N / 2 / m.SR; A = m.ATT; tt = np.arange(len(A)) / m.fps + o
pk = np.array([tt[k] for k in range(1, len(A) - 1) if A[k] >= A[k-1] and A[k] > A[k+1] and A[k] > 5.0])
def nd(x): k = np.searchsorted(pk, x); c = pk[max(0, k - 1):k + 1]; return np.min(abs(c - x))
print('sec | tempo | free | clicks | within 40 ms | within 80 ms | median |click-attack| ms | null(+half beat) within 40 ms')
for si, (s, e, bpm) in enumerate(tl['sec']):
    c = t[(t >= s) & (t < e)]
    if len(c) < 5: continue
    per = 60 / bpm; d = np.array([nd(x) for x in c]); d0 = np.array([nd(x + per / 2) for x in c])
    free = al['sections'][si].get('bpm') is None
    iv = np.diff(c) / per
    print('%2d | %5.1f | %s | %3d | %3.0f%% | %3.0f%% | %3.0f | %3.0f%% | interval/beat median %.2f p5 %.2f p95 %.2f' % (si + 1, bpm, 'free  ' if free else 'stable', len(c), 100 * (d < .04).mean(), 100 * (d < .08).mean(), np.median(d) * 1e3, 100 * (d0 < .04).mean(), np.median(iv), np.percentile(iv, 5), np.percentile(iv, 95)))
# free-tempo sections: clicks on the chord changes vs the intermediate ones
st = np.array([e[0] for e in tl['ev'] if not e[4]])
print('free sections: clicks on a chord change (within 30 ms of an event start) vs intermediate clicks')
for si in (0, 10, 11):
    s, e, bpm = tl['sec'][si]; c = t[(t >= s) & (t < e)]
    on = np.array([np.min(abs(st - x)) < 0.03 for x in c]); d = np.array([nd(x) for x in c])
    # distance between consecutive intermediate clicks and neighbours
    inter = c[~on]
    print('section %d: clicks %d, on changes %d (within 40 ms of an attack %.0f%%), intermediate %d (within 40 ms %.0f%%, within 80 ms %.0f%%, median %.0f ms); events %d, changes without a click %d' % (si + 1, len(c), on.sum(), 100 * (d[on] < .04).mean(), (~on).sum(), 100 * (d[~on] < .04).mean(), 100 * (d[~on] < .08).mean(), np.median(d[~on]) * 1e3, ((st >= s) & (st < e)).sum(), sum(1 for x in st[(st >= s) & (st < e)] if np.min(abs(c - x)) > 0.03)))
