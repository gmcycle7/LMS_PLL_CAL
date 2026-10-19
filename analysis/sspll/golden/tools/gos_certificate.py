#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GOS D = 0 theorem: run the computer-assisted certificate (sspll_golden.gos_certificate) on the nominal loops and the
dense-scan variants, plus the extended L2/L3 certificate down to beta = 2^-10 and the single-point certificates used by
the hand calculation HC-CS.10.  Writes results/gos_certificate.json (read by src/pages/case-sspll/gosTheorem.test.ts).
Run from analysis/sspll/golden:  python3 tools/gos_certificate.py"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from sspll_golden.gos_certificate import certificate, kernel_min, lipschitz, point_certificate, typeI_positive  # noqa: E402
from sspll_golden.loops import make_L1, make_L2, make_L3, nominal_loops  # noqa: E402
from sspll_golden.predictions import gamma_eff, gos_harmonic  # noqa: E402


def main():
    t0 = time.time()
    L = nominal_loops()
    loops = dict(L1=L['L1'], L2=L['L2'], L3=L['L3'], L2_pm45=make_L2(45), L2_pm75=make_L2(75),
                 L2_lat2=make_L2(60, lat=2), L3_pm45=make_L3(45), L3_pm55=make_L3(55), L3_halfT=make_L3(60, 'halfT'),
                 L1_lat5_band=make_L1(lat=5), L1_pole200M_band=make_L1(f_pole=200e6))
    out = dict(_doc='GOS D=0 certificate (section 7b); keys: nominal (beta >= 0.016, M = 1000), extended (L2/L3, beta >= 2^-10), '
                    'points (HC-CS.10), typeI (L1 one-line proof), asymptote_ratio (beta < beta_0 check)')
    nominal = {}
    for nm, lp in loops.items():
        r = certificate(lp)
        nominal[nm] = {k: v for k, v in r.items() if k != 'lipschitz'}
        nominal[nm]['lipschitz'] = r['lipschitz']
        print(f"{nm:18s} ok={r['ok']} steps={r['steps']} Lg={r['Lg']:.6f} g_min={r['g_min']:.6f} worst={r['worst_lower']:.6e} @ {r['worst_at']:.6f}", flush=True)
    out['nominal'] = nominal
    ext = {}
    for nm in ('L2', 'L3'):
        r = certificate(loops[nm], beta_min=2 ** -10, M=16000)
        ext[nm] = {k: v for k, v in r.items() if k != 'lipschitz'}
        print(f"extended {nm}: ok={r['ok']} steps={r['steps']} worst={r['worst_lower']:.6e} @ {r['worst_at']:.6f}", flush=True)
    out['extended'] = ext
    # hand calculation: L2, M = 4, a few betas
    lip = lipschitz(loops['L2'])
    gm = kernel_min(loops['L2'], lip['Lg'])['g_min']
    out['points'] = {str(b): point_certificate(loops['L2'], b, 4, lip, gm) for b in (0.25, 0.3, 0.123, 0.05)}
    # L1 one-line proof: first term and partial sums at a few betas
    K = float(loops['L1'].params['K'])
    out['typeI'] = dict(K=K, points={str(b): typeI_positive(K, b) for b in (0.016, 0.123, 0.25, 0.5)})
    # beta < beta_0: ratio of the exact harmonic sum to the asymptote beta^2/Ki (L2), beta = 1/b
    Ki = float(loops['L2'].params['Ki'])
    ratio = {}
    for b in (64, 128, 256, 512, 1000):
        beta = 1.0 / b
        C = gos_harmonic(beta / 8, gamma_eff(loops['L2']), M=200000)
        ratio[str(b)] = dict(beta=beta, C=C, asym=beta ** 2 / Ki, ratio=C / (beta ** 2 / Ki))
    out['asymptote_ratio'] = dict(Ki=Ki, rows=ratio)
    out['_runtime_s'] = time.time() - t0
    with open(os.path.join(ROOT, 'results', 'gos_certificate.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print('wrote results/gos_certificate.json in %.1f s' % out['_runtime_s'])


if __name__ == '__main__':
    main()
