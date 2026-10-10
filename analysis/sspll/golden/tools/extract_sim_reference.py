#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract the time-domain simulator's stored fine-grid results (analysis/sspll/sim/results.json,
26 MB) into a compact reference file used by the golden tests and the web export.

kappa conventions (exactly those of the simulator):
  kP = phos_min_re(closed loop) / phos_min_re(open loop H==1, same record)
  kG = mS_gg(closed loop) / mS_gg(open loop)        (open-loop reference keeps the regressor DC)
  LS = large-signal secant slope g_v(A) / g_v^open-loop(A), worst over the 6 directions.
Run:  python3 tools/extract_sim_reference.py
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SIM = os.path.join(HERE, '..', '..', 'sim', 'results.json')
OUT = os.path.join(HERE, '..', 'reference', 'sim_fine_reference.json')
KEYS = {'L1': 'L1', 'L2': 'L2_pm60', 'L3': 'L3_imp_pm60'}


def main():
    R = json.load(open(SIM))
    out = dict(source='analysis/sspll/sim/results.json (time-domain simulator, 2^16-sample records, '
                      'erf estimator = exact average over the comparator noise, 32-bit accumulator)',
               config={k: R['config'][k] for k in ('f_ref_Hz', 'f_vco_Hz_illustrative', 'Delta_ps', 'sigma_v_ps',
                                                   'a_gos', 'eps_ps', 'delta_perturbation_ps', 'accumulator_bits')},
               loops={})
    for k, sk in KEYS.items():
        f = R['fine'][sk]
        ol = f['open_loop_H1']
        olp = np.array(ol['phos_min_re'], float)
        olg = np.array(ol['mS_gg'], float)
        d = dict(alpha=f['alpha'], kP={}, kG={})
        for v, vd in f['variants'].items():
            for est in ('erf', 'lin'):
                if est == 'lin' and v != 'raw':
                    continue
                tag = v if est == 'erf' else v + '|lin'
                d['kP'][tag] = (np.array(vd[est]['phos_min_re'], float) / olp).round(7).tolist()
                d['kG'][tag] = (np.array(vd[est]['mS_gg'], float) / olg).round(7).tolist()
        ls = R['large_signal_fine'][sk]
        g0 = np.array(ls['g_open_loop']['erf'], float)            # (500, 6 dirs, 2 amps)
        d['LS'] = {}
        for v in ls['variants']:
            g = np.array(ls['g'][v]['erf'], float)
            with np.errstate(divide='ignore', invalid='ignore'):
                kn = np.where(np.abs(g0) > 1e-9, g / np.where(np.abs(g0) > 1e-9, g0, 1.0), np.nan)
            d['LS'][v] = {f'A={a:g}ps': np.nanmin(kn[:, :, i], axis=1).round(6).tolist()
                          for i, a in enumerate(ls['amps_ps'])}
        d['LS_summary'] = {v: {A: dict(n_inverted=s['n_inverted'], worst=s['worst'])
                               for A, s in ls['summary'][v].items()} for v in ls['variants']}
        out['loops'][k] = d
    with open(OUT, 'w') as fh:
        json.dump(out, fh)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
