#!/usr/bin/env python3
"""Extract the simulator's (analysis/sspll/sim) randomisation results (MASH-1-1-1, PMUX random rotation, dithered
quantiser) -- sim-only evidence, no theory in golden.  kappa = phos_min_re / same-entry open-loop (H == 1) reference.
Run from analysis/sspll/golden: python3 tools/extract_sim_dither.py -> results/sim_dither_extract.json"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
R = json.load(open(os.path.join(ROOT, '..', 'sim', 'results.json')))
out = {}
for key in ('L2_pm60', 'L3_imp_pm60'):
    for m in ('lsb', 'dq', 'mash', 'rot4', 'rot8'):
        e = R['dither_grid'].get(f'{key}|{m}')
        if e is None:
            continue
        rows = {}
        for s in e['summary']:
            if s['alpha'] not in (0.002, 0.01, 0.03, 0.253, 0.496, 0.137):
                continue
            ol = s['open_loop_H1']['erf']
            v = s['variants']['raw']['erf']
            rows[s['alpha']] = dict(kP=v['phos_min_re'] / ol['phos_min_re'], kG=v['mS_gg'] / ol['mS_gg'],
                                    phases_visited=s['phases_visited'])
        out[f'{key}|{m}'] = rows
        print(key, m, {a: (round(r['kP'], 3), round(r['kG'], 3)) for a, r in rows.items()})
json.dump(dict(dither=out), open(os.path.join(ROOT, 'results', 'sim_dither_extract.json'), 'w'), indent=1)
# closed-loop LMS with randomised fractional sequences (sim): final PHOS rms (fs) per alpha
lms = {}
for key in ('L2_pm60|mash', 'L2_pm60|rot8', 'L2_pm45|mash', 'L2_pm45|rot8', 'L3_imp_pm60|mash', 'L3_imp_pm60|rot8',
            'L2_pm60|acc1', 'L2_pm45|acc1'):
    v = R['lms'].get(key)
    if v is None:
        continue
    lms[key] = {}
    for lk, e in v['lanes'].items():
        lms[key][lk] = dict(final_phos_rms_fs=e['phos_err_final_med_fs'], max_phos_rms_fs=e['phos_err_max_fs'],
                            final_gos_fs=e['gos_err_final_med_fs'])
    print(key, {k: (round(x['final_phos_rms_fs'], 1) if x['final_phos_rms_fs'] is not None else None) for k, x in lms[key].items()})
json.dump(dict(dither=out, lms=lms), open(os.path.join(ROOT, 'results', 'sim_dither_extract.json'), 'w'), indent=1)
# freeze experiment (sim): calibrate at alpha = 0.137 (phase 1), then switch to alpha = 0.01 / 0.03 with LMS on or frozen
frz = {}
for k, v in R['freeze']['phase2'].items():
    frz[k] = {lk: dict(phos_initial_fs=e['phos_err_initial_fs'], phos_final_fs=e['phos_err_final_med_fs'],
                       gos_final_fs=e['gos_err_final_med_fs']) for lk, e in v['lanes'].items()}
    print(k, {lk: (round(x['phos_initial_fs'], 2), round(x['phos_final_fs'], 1), round(x['gos_final_fs'], 2)) for lk, x in frz[k].items()})
json.dump(dict(dither=out, lms=lms, freeze=frz), open(os.path.join(ROOT, 'results', 'sim_dither_extract.json'), 'w'), indent=1)
