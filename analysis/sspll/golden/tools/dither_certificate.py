#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dither_certificate.py -- alpha-uniform certificate for the code sources (case page section 10b.7, F-CS.29;
docs/analysis/sspll-dither-interaction.md section 5b).  Writes results/dither_certificate.json:

  loops        L2 (PM 60), L2_pm45, L3: per source the certified lower bound LB_m of Re kappa_m over ALL alpha
               (g_min from the section-7b tools gos_certificate.lipschitz / kernel_min), its status, and the MASH kappa_min
               scan on the 1 MHz grid (minimum, dead-zone and inverted ranges)
  pm_sweep     L2 redesigned to 320 MHz at PM = 40 ... 70 deg: g_min, valley, LB for mash / rot4 / dq, MASH scan
  thresholds   PM where LB_mash = tau (certificate: every channel restoring above it) and where the MASH scan minimum = tau
               (a dead-zone channel exists below it), by bisection; plus the linear interpolation the web page uses

The TypeScript port (src/pages/case-sspll/codeCertificate.ts) is compared against this file in codeCertificate.test.ts.
Run from analysis/sspll/golden:  python3 tools/dither_certificate.py   (about 30 s)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from sspll_golden import dither_interaction as di  # noqa: E402
from sspll_golden.loops import make_L2, nominal_loops  # noqa: E402

TAU = 0.05


def loop_rows(lp):
    lip = di.gc.lipschitz(lp)
    certs = {s: di.code_certificate(lp, s, TAU, lip=lip) for s in di.CODE_SOURCES}
    return dict(name=lp.name, Lg=lip['Lg'], certificates=certs, mash_scan=di.mash_kappa_min_scan(lp))


def pm_row(pm):
    lp = make_L2(pm)
    lip = di.gc.lipschitz(lp)
    c = {s: di.code_certificate(lp, s, TAU, lip=lip) for s in ('mash', 'rot4', 'dq')}
    return dict(pm=pm, Kp=float(lp.params['Kp']), Ki=float(lp.params['Ki']), g_min=c['mash']['g_min'], f_at_min=c['mash']['f_at_min'],
                lb=dict((s, c[s]['lb_min']) for s in c), status_mash=c['mash']['status'], mash_scan=di.mash_kappa_min_scan(lp))


def bisect(fun, lo, hi, n=30):
    """root of the increasing function fun on [lo, hi]."""
    flo = fun(lo)
    for _ in range(n):
        mid = 0.5 * (lo + hi)
        fm = fun(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return 0.5 * (lo + hi)


def interp_threshold(pms, vals, level):
    """PM where the tabulated values cross `level` (linear interpolation; the page uses the same rule)."""
    for i in range(1, len(pms)):
        a, b = vals[i - 1] - level, vals[i] - level
        if a <= 0 < b:
            return pms[i - 1] + (pms[i] - pms[i - 1]) * (-a) / (b - a)
    return None


def main():
    t0 = time.time()
    L = nominal_loops()
    loops = {'L2': L['L2'], 'L2_pm45': make_L2(45.0), 'L3': L['L3']}
    out = {
        '_meta': {
            'generated_by': 'analysis/sspll/golden/tools/dither_certificate.py',
            'model': 'F-CS.27 (linear small signal, frozen weights, D = 0, random part iid); g_min from gos_certificate.lipschitz/kernel_min',
            'tau': TAU, 'nf': di.CERT_NF, 'pm_sweep': list(di.PM_SWEEP),
            'tolerances': {
                'ts_vs_golden': 'rel 1e-6 (same formulas; the PM designs are solved by root finding on both sides)',
                'lb_below_closed_form': 'LB_m <= Re kappa_m(alpha) on every stored alpha of dither_interaction.json (exact inequality, slack 1e-12)',
                'interp_vs_bisection': 'abs 1.5 deg',
            },
        },
        'loops': {k: loop_rows(v) for k, v in loops.items()},
    }
    rows = [pm_row(pm) for pm in di.PM_SWEEP]
    out['pm_sweep'] = rows
    pms = [r['pm'] for r in rows]

    def lb_mash(pm):
        return di.code_certificate(make_L2(pm), 'mash', TAU)['lb_min'] - TAU

    def scan_mash(pm):
        return di.mash_kappa_min_scan(make_L2(pm))['min'] - TAU
    out['thresholds'] = dict(
        pm_cert=bisect(lb_mash, 40.0, 70.0), pm_dead=bisect(scan_mash, 40.0, 70.0),
        pm_cert_interp=interp_threshold(pms, [r['lb']['mash'] for r in rows], TAU),
        pm_dead_interp=interp_threshold(pms, [r['mash_scan']['min'] for r in rows], TAU))
    path = HERE / 'results' / 'dither_certificate.json'
    json.dump(out, open(path, 'w'), indent=1, allow_nan=False)
    th = out['thresholds']
    print(f"wrote {path} in {time.time() - t0:.0f} s; PM thresholds: certificate {th['pm_cert']:.2f} deg (interp {th['pm_cert_interp']:.2f}), "
          f"dead zone {th['pm_dead']:.2f} deg (interp {th['pm_dead_interp']:.2f})")


if __name__ == '__main__':
    main()
