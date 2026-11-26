# Round 11 tester: frame trace (chord scores, bass note, attack strength) around a time range. usage: round11-tester-trace.py t0 t1 chordA chordB [step]
import sys; sys.argv_ = sys.argv
import importlib.util, numpy as np
spec = importlib.util.spec_from_file_location('ind', '/home/user/guitarapp/test/e2e/round11-tester-indep.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
t0, t1, A, B = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3], sys.argv[4]; step = float(sys.argv[5]) if len(sys.argv) > 5 else 0.1
names = 'C C# D D# E F F# G G# A A# B'.split()
print('t   %s %s | bass pc (top) | full chroma top3 | attack' % (A, B))
t = t0
while t < t1:
    i = int((t - m.N / 2 / m.SR) * m.fps); ib = int((t - 4096 / m.SR) * m.fps)
    a = m.sc(m.CH[i:i+1], m.tpl(A))[0]; b = m.sc(m.CH[i:i+1], m.tpl(B))[0]
    bc = m.CB[ib]; top = np.argsort(-bc)[:2]; ft = np.argsort(-m.CH[i])[:3]
    print('%.2f %+.2f %+.2f | %s %s | %s | %.1f' % (t, a, b, names[top[0]], names[top[1]], ' '.join(names[k] for k in ft), m.ATT[i]))
    t += step
