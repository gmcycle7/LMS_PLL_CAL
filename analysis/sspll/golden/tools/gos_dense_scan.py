#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dense GOS (D = 0, raw regressor) sign scan supporting the CONJECTURE 'C_GOS > 0 for every alpha'.
For beta = a/b (reduced), C_GOS = sum_{k=1}^{b-1} Re H(k/b) / (4 b^2 sin^2(pi k/b)) over the beta-orbit (exact).
Loops: nominal L1/L2/L3 + PM / latency / mapping variants + Type-I loops that DO have a Re H < 0 band.
Run from analysis/sspll/golden:  python3 tools/gos_dense_scan.py   -> results/gos_dense_scan.json"""
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from sspll_golden.loops import make_L1, make_L2, make_L3, nominal_loops  # noqa: E402

BMAX = int(sys.argv[1]) if len(sys.argv) > 1 else 1000


def scan(lp):
    nneg = ntot = 0
    worst = (np.inf, None)
    negs = []
    for bb in range(2, BMAX + 1):
        k = np.arange(1, bb)
        w = 1 / (4 * bb ** 2 * np.sin(np.pi * k / bb) ** 2)
        Rb = np.r_[0.0, lp.H(k / bb).real]
        a = np.array([x for x in range(1, bb // 2 + 1) if math.gcd(x, bb) == 1])
        Ca = (Rb[np.outer(a, k) % bb] * w).sum(1)
        ntot += len(a)
        neg = Ca < 0
        nneg += int(neg.sum())
        if neg.any() and len(negs) < 10:
            negs += [(int(x), bb, float(12 * c)) for x, c in zip(a[neg], Ca[neg])][:10 - len(negs)]
        j = int(np.argmin(Ca))
        if 12 * Ca[j] < worst[0]:
            worst = (float(12 * Ca[j]), (int(a[j]), bb))
    return dict(b_max=BMAX, n_beta=ntot, n_negative=nneg, min_12C=worst[0], at=worst[1], first_negatives=negs)


def main():
    t0 = time.time()
    L = nominal_loops()
    loops = dict(L1=L['L1'], L2=L['L2'], L3=L['L3'], L2_pm45=make_L2(45), L2_pm75=make_L2(75),
                 L2_lat2=make_L2(60, lat=2), L3_pm45=make_L3(45), L3_pm55=make_L3(55), L3_halfT=make_L3(60, 'halfT'),
                 L1_lat5_band=make_L1(lat=5), L1_pole200M_band=make_L1(f_pole=200e6))
    out = {}
    for nm, lp in loops.items():
        b = lp.inversion_bands()
        out[nm] = dict(scan(lp), ReH_neg_band_MHz=[[x['f_lo'] * 4e3, x['f_hi'] * 4e3, x['min_ReH']] for x in b])
        print(f"{nm:18s} band {[[round(v, 2) for v in q] for q in out[nm]['ReH_neg_band_MHz']]}: {out[nm]['n_beta']} betas, "
              f"negative {out[nm]['n_negative']}, min 12C {out[nm]['min_12C']:.4e} at {out[nm]['at']}", flush=True)
    out['_runtime_s'] = time.time() - t0
    with open(os.path.join(ROOT, 'results', 'gos_dense_scan.json'), 'w') as fh:
        json.dump(out, fh, indent=1)


if __name__ == '__main__':
    main()
