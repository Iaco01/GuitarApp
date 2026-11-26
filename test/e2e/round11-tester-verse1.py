# Round 11 tester, B1: events 28-40 (and any list given): engine times (r10, r11) against my own attack peaks (strongest 3 flux peaks within +-0.5 s)
# and chroma/bass change points. Times only. usage: python3 -I round11-tester-verse1.py 28 40
import sys, json, importlib.util, numpy as np
spec = importlib.util.spec_from_file_location('ind', '/home/user/guitarapp/test/e2e/round11-tester-indep.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
d = json.load(open(m.D + 'vs-r10.json')); ch = d['chords']
for j in range(int(sys.argv[1]), int(sys.argv[2]) + 1):
    t10, t11 = d['r10'][j], d['r11'][j]
    o = m.N / 2 / m.SR; c = (t10 + t11) / 2
    i0, i1 = int((c - o - 0.6) * m.fps), int((c - o + 0.6) * m.fps); seg = m.ATT[i0:i1]
    pk = [k for k in range(1, len(seg) - 1) if seg[k] >= seg[k-1] and seg[k] > seg[k+1] and seg[k] > 3.0]
    pk = sorted(pk, key=lambda k: -seg[k])[:3]; pk = sorted(pk)
    atts = ' '.join('%.2f(%.0f)' % ((i0 + k) / m.fps + o, seg[k]) for k in pk)
    lo = max(d['r11'][j-1] + 0.15, min(t10, t11) - 0.6); hi = min(d['r11'][j+1] - 0.15, max(t10, t11) + 0.6)
    if ch[j] != ch[j-1] and hi - lo > 0.5:
        tf, mf = m.cp(m.CH, m.tpl, ch[j-1], ch[j], lo, hi, o); tb, mb = m.cp(m.CB, m.bass, ch[j-1], ch[j], lo, hi, 4096 / m.SR)
    else: tf = tb = float('nan')
    print('ev %d %s>%s r10 %.2f r11 %.2f | chroma cp %.2f bass cp %.2f | attacks(strength) %s' % (j, ch[j-1], ch[j], t10, t11, tf, tb, atts))
