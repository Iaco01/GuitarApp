# Round 12 tester, B: for every pair of identical consecutive chords of the real song, is the boundary the engine gives on a clear attack
# of MY curve (round 11 method) or in the tail of the first chord?  Input: test-artifacts/round-12/tester/pairs-<tag>.json written by
# round12-tester-event35.mjs pairs.  Prints counts, times and chord-pair indices only.
# usage: python3 -I round12-tester-pairs.py [tag ...]   (default: new r11)
import sys, os, json, importlib.util, numpy as np
ROOT = '/home/user/guitarapp'
spec = importlib.util.spec_from_file_location('indep', ROOT + '/test/e2e/round11-tester-indep.py')
indep = importlib.util.module_from_spec(spec); spec.loader.exec_module(indep)
fps = indep.fps; N = indep.N; SR = indep.SR
x = indep.x
def env(t0, t1):
    a, b = int(max(0, t0) * SR), int(min(len(x) / SR, t1) * SR)
    return float(np.sqrt((x[a:b] ** 2).mean() + 1e-12)) if b > a else 0.0
tags = sys.argv[1:] or ['new', 'r11']
for tag in tags:
    f = f'{ROOT}/test-artifacts/round-12/tester/pairs-{tag}.json'
    if not os.path.exists(f): print('missing', f); continue
    d = json.load(open(f))
    on = tail = far = 0; rows = []
    for j, tp, tc, tn, cross in d['t']:
        # strongest attack within +-0.12 s of the boundary, and the strongest attack in the whole window [tp+0.5, tn-0.15]
        a, za = indep.attack_near(tc, 0.12)
        lo, hi = tp + 0.5, (tn - 0.15) if tn else tc + 2
        best, zb = (None, 0)
        if hi > lo:
            c = (lo + hi) / 2; best, zb = indep.attack_near(c, (hi - lo) / 2)
        before = env(tc - 0.35, tc - 0.05); after = env(tc + 0.05, tc + 0.35)
        onatt = a is not None and za >= 3.0
        intail = (not onatt) and after < before * 1.1 and best is not None and zb >= 4.0 and abs(best - tc) > 0.3
        on += onatt; tail += intail
        rows.append((j, round(tp, 2), round(tc, 2), round(tn or 0, 2), cross, round(za, 1), None if best is None else round(best, 2), round(zb, 1), 'ATTACK' if onatt else ('TAIL?' if intail else 'other')))
    print(f'== {tag}: {len(rows)} identical pairs; boundary on a clear attack (z>=3, +-120 ms): {on}; in a tail with a strong re-attack >0.3 s away: {tail}')
    for r in rows:
        if r[-1] != 'ATTACK': print('   event %d: prev %.2f  boundary %.2f  next %.2f  cross-section %d  attack-at-boundary z %.1f  strongest in window %s (z %.1f)  %s' % r)
