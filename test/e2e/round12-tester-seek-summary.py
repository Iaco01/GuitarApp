# Round 12 tester, A: summary table of round12-tester-seek-analyse.py output (analysis.json) for one or two builds.
# usage: python3 -I round12-tester-seek-summary.py <new-dir> [<old-dir>]
# bias B = median (claimed - true) of the 'base' runs of the SAME build (Play from the start, no jump): it is the delay of my capture path
# (ScriptProcessor, about 100 ms), not the app; corrected position error = claimed - true - B, corrected highlight error = (file time of the
# highlight - my attack) + B.  Prints times only.
import sys, os, json, numpy as np
def load(d):
    a = json.load(open(os.path.join(d, 'analysis.json'))); t = json.load(open(os.path.join(d, 'timeline.json')))
    return a, t
def ms(v): return 'n/a' if v is None or v != v else '%+.0f' % (v * 1000)
def summarise(d, label, Bfixed=None):
    a, tl = load(d)
    Bd = {}
    for rt in sorted(set(r['rate'] for r in a)):
        base = [r['perr_med'] for r in a if r['type'] == 'base' and r['rate'] == rt and r['perr_med'] is not None]
        if base: Bd[rt] = float(np.median(base))
    if Bfixed is not None: Bd = Bfixed
    print(f'=== {label}: bias of the capture path per speed (ms): ' + ', '.join(f'x{k}: {v*1000:.0f}' for k, v in Bd.items()) + ' ===')
    beats = np.array([b[0] for b in tl['beats']])
    types = []
    for r in a:
        if r['type'] not in types: types.append(r['type'])
    allpos = {}
    for ty in types:
        rows = [r for r in a if r['type'] == ty]
        print(f'-- {ty}')
        print('   %-14s %7s | %8s %8s | %4s %8s %8s | %s' % ('run', 'target', 'pos med', 'pos p95', 'nHl', 'hl med', 'hl max', 'clicks: n / doubles / missing / off-beat med,max (ms)'))
        pe_all = []; he_all = []
        for r in rows:
            B = Bd.get(r['rate'], Bd.get(1.0, 0.0))
            pe = None if r['perr_med'] is None else r['perr_med'] - B
            pmx = None
            h = [v + B for _, v in r['herr']]
            # position error max: recompute from perr_max is raw; use |perr_max - B| approx (max of abs raw minus B)
            pv = np.abs(np.array(r.get('perr_vals', [])) - B)
            pmx = float(np.percentile(pv, 95)) if len(pv) else None
            ck = sorted([c[0] + B for c in r['clicks']])
            ckmsg = ''
            if len(ck) > 3 and r['type'] not in ('scrub',):
                ck = np.array(ck)
                # skip clicks of the first 0.4 s after the jump (the click scheduling starts when the element plays)
                lo, hi = ck[0], ck[-1]
                inb = beats[(beats > lo - 0.02) & (beats < hi + 0.02)]
                # every beat in [lo, hi] should have a click within 80 ms
                miss = sum(1 for b in inb if np.min(np.abs(ck - b)) > 0.08)
                # doubles: two clicks closer than 40% of the median beat interval
                d = np.diff(ck); medb = np.median(np.diff(inb)) if len(inb) > 2 else 0.5
                dbl = int((d < 0.4 * medb).sum() - ((d < 0.01).sum() * 0))
                off = np.array([np.min(np.abs(inb - c)) * np.sign(c - inb[np.argmin(np.abs(inb - c))]) for c in ck])
                ckmsg = '%d / %d / %d / %s,%s' % (len(ck), dbl, miss, ms(np.median(off)), ms(np.max(np.abs(off))))
            print('   %-14s %7s | %8s %8s | %4d %8s %8s | %s' % (r['name'], '%.1f' % (r['target'] or 0), ms(pe), ms(pmx), len(h), ms(np.median(h) if h else None), ms(np.max(np.abs(h)) if h else None), ckmsg))
            if pe is not None: pe_all.append(abs(pe))
            he_all += [abs(x) for x in h]
        if he_all: print('   => type %s: |position error| median %s max %s ms; |highlight error| median %s max %s ms over %d highlight changes' % (ty, ms(np.median(pe_all)) if pe_all else 'n/a', ms(max(pe_all)) if pe_all else 'n/a', ms(np.median(he_all)), ms(max(he_all)), len(he_all)))
    return Bd
B = summarise(sys.argv[1], 'build ' + os.path.basename(sys.argv[1].rstrip('/')))
if len(sys.argv) > 2: summarise(sys.argv[2], 'build ' + os.path.basename(sys.argv[2].rstrip('/')), B)
