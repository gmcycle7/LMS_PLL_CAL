#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dither_sweep.py -- code source x dither x rotation x alpha x loop sweep for the case page section 10b
(docs/analysis/sspll-dither-interaction.md).  Writes results/dither_interaction.json:

  factors        closed-form spectral factors per source and mode (|phi|^2, R~, line weights, GOS R~_c)
  closed         kappa_m / kappa_min / worst mode / GOS C for every (loop, source) on the selected alphas and the fine grid
  numeric        the same quantities measured on the actual sequence (linear correlation, 2^17 samples)
  sim_compare    closed form vs numeric vs the time-domain simulator's stored kappa (results/sim_dither_extract.json)
  large_signal   1-bit slope kappa_inf along mode 1 and along the closed form's worst mode (A -> inf, plus A = 1, 5 ps)
  mc             multi-seed closed-loop sign-LMS: divergence fraction with 95 % Wilson CI, closed-form verdict, cross-check
                 (F-CS.28 = linear stage only; the dead zone is n/a), plus the scores of the candidate dead-zone rules
                 (kappa_inf_worst / candidates per row, mc._summary.candidates; see score_candidates)
  headline       the L2-PM45 / MASH / alpha = 0.03 case term by term (why the restoring force vanishes), and the hand-calculation numbers

Run from analysis/sspll/golden:  python3 tools/dither_sweep.py   (about 3 minutes; --subset-only rewrites only the page subset;
--rescore re-scores the stored MC rows with score_candidates -- no new simulation -- and rewrites both files)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from sspll_golden import dither_interaction as di  # noqa: E402
from sspll_golden.loops import make_L2, nominal_loops  # noqa: E402

TAU_DEAD = 0.05
SEL_ALPHAS = [0.002, 0.01, 0.02, 0.03, 0.137, 0.253, 0.496]
FINE_ALPHAS = [round(0.005 * i, 6) for i in range(1, 101)]
SOURCES = list(di.CODE_SOURCES)
SIM_KEY = {'L2': 'L2_pm60', 'L3': 'L3_imp_pm60', 'L2_pm45': None}
MC_SEEDS = list(range(8))
MC_BLOCKS = 1500


def _finite(x):
    """Replace non-finite floats (GOS kappa = C/var at beta = 0, where var = 0) by null so the file is strict JSON."""
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    if isinstance(x, (float, np.floating)):
        return float(x) if np.isfinite(x) else None
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def loops_under_test():
    L = nominal_loops()
    return {'L2': L['L2'], 'L2_pm45': make_L2(45.0), 'L3': L['L3']}


def main():
    t0 = time.time()
    loops = loops_under_test()
    sim = json.load(open(HERE / 'results' / 'sim_dither_extract.json'))
    out = {
        '_meta': {
            'generated_by': 'analysis/sspll/golden/tools/dither_sweep.py',
            'model': 'linear small-signal PLL (H_PD = 1/(1+L)), frozen weights, D = 0; code sources as in sim.py SeqSource; '
                     'mash / dq / rot closed forms assume the random part is iid (mash: e3 iid uniform)',
            'tau_dead': TAU_DEAD,
            'tolerances': {
                'closed_vs_ts_port': 'identical formulas: relative 1e-9 (kappa, GOS C, factors)',
                'closed_vs_numeric_kappa_min': 'abs 0.03 (mash at near-rational alpha has tones; others < 0.01)',
                'closed_vs_sim_kappa_min': 'abs 0.03',
                'gos_kappa_e2_vs_sim_kG': 'rel 0.10 (the simulator normalises GOS by E[c^2] of its own record incl. (1-a))',
                'mc': '8 seeds x 1500 blocks, N = 512, N_tau = 25; diverged: final > 2 x initial PHOS rms; converged: < 1/4',
            },
            'loops': {k: dict(name=v.name, params={kk: (float(vv) if isinstance(vv, (int, float, np.floating)) else vv)
                                                       for kk, vv in v.params.items()}) for k, v in loops.items()},
            'sources': SOURCES,
            'code_range_delta': di.CODE_RANGE,
            'selected_alphas': SEL_ALPHAS,
            'fine_alphas': FINE_ALPHAS,
        },
        'factors': {},
        'closed': {},
        'numeric': {},
        'sim_compare': {},
        'large_signal': {},
        'mc': {},
        'headline': {},
    }
    # ---- factors ----
    for src in SOURCES:
        f = {}
        for m in range(1, 8):
            sm = di.code_spectral_model(src, m)
            lines = {str(l): w for l, w in sm['lines'].items() if abs(l - m) <= 32}
            f[f'm{m}'] = dict(lines=lines, total=sm['total'], rtilde=sm['rtilde'])
            if src == 'mash':
                f[f'm{m}'].update(di.mash_factors(m))
            if src == 'dq':
                f[f'm{m}']['white'] = di.dq_white(m)
            if src.startswith('rot'):
                f[f'm{m}']['D2'] = di.rot_factor(int(src[3:]), m)
        out['factors'][src] = f
    # ---- closed / numeric / sim compare / large signal ----
    max_cn, max_cs = 0.0, 0.0
    for lk, lp in loops.items():
        for src in SOURCES:
            key = f'{lk}|{src}'
            cl, nu, sc, ls = {}, {}, {}, {}
            for a in sorted(set(SEL_ALPHAS + FINE_ALPHAS)):
                kp = di.kappa_phos_closed(lp, a, src)
                g = di.gos_closed(lp, a, src)
                cl[str(a)] = dict(kappa_m=kp['kappa_m'], kappa_min=kp['kappa_min'], worst_mode=kp['worst_mode'], gos=g,
                                  verdict=di.verdict_closed(lp, a, src, TAU_DEAD)['verdict'])
            for a in SEL_ALPHAS:
                n = di.kappa_numeric(lp, a, src)
                nu[str(a)] = n
                d_cn = abs(n['kappa_min'] - cl[str(a)]['kappa_min'])
                max_cn = max(max_cn, d_cn)
                row = dict(closed=cl[str(a)]['kappa_min'], numeric=n['kappa_min'], diff_closed_numeric=d_cn)
                sk = SIM_KEY[lk]
                simrow = sim['dither'].get(f'{sk}|{src}', {}).get(str(a)) if sk else None
                if simrow:
                    row.update(sim=simrow['kP'], diff_closed_sim=abs(simrow['kP'] - cl[str(a)]['kappa_min']),
                               sim_kG=simrow['kG'], gos_kappa_e2=cl[str(a)]['gos']['kappa_e2'])
                    max_cs = max(max_cs, row['diff_closed_sim'])
                sc[str(a)] = row
                wm = cl[str(a)]['worst_mode']
                ls[str(a)] = {'m1': di.large_signal_code(lp, a, src, 1)}
                if wm != 1:
                    ls[str(a)][f'm{wm}'] = di.large_signal_code(lp, a, src, wm)
            out['closed'][key] = cl
            out['numeric'][key] = nu
            out['sim_compare'][key] = sc
            out['large_signal'][key] = ls
    out['sim_compare']['_summary'] = dict(max_abs_diff_closed_numeric=max_cn, max_abs_diff_closed_sim=max_cs)
    print(f'closed/numeric/large-signal done in {time.time() - t0:.0f} s; max |closed - numeric| = {max_cn:.4f}, '
          f'max |closed - sim| = {max_cs:.4f}', flush=True)
    # ---- Monte Carlo ----
    n_ok = n_bad = n_na = 0
    for lk, lp in loops.items():
        for src in SOURCES:
            key = f'{lk}|{src}'
            mcs = {}
            for a in SEL_ALPHAS:
                v = di.verdict_closed(lp, a, src, TAU_DEAD)
                mc = di.divergence_mc(lp, a, src, MC_SEEDS, n_blocks=MC_BLOCKS)
                cc = di.crosscheck(v['verdict'], mc)
                n_ok += cc['status'] == 'ok'
                n_bad += cc['status'] == 'mismatch'
                n_na += cc['status'] == 'n/a'
                mcs[str(a)] = dict(mc, verdict=v['verdict'], kappa_min=v['kappa_min'], worst_mode=v['worst_mode'],
                                   kappa_inf_m1=out['large_signal'][key][str(a)]['m1']['kappa_inf'], crosscheck=cc)
            out['mc'][key] = mcs
            print(f'  mc {key}: ' + ', '.join(f'{a}:{m["n_div"]}/{m["n"]}({m["verdict"][0]})' for a, m in mcs.items()), flush=True)
    out['mc']['_summary'] = dict(n_ok=n_ok, n_mismatch=n_bad, n_na=n_na, seeds=MC_SEEDS, n_blocks=MC_BLOCKS)
    score_candidates(out)
    # ---- headline: L2-PM45, MASH, alpha = 0.03 term by term ----
    lp = loops['L2_pm45']
    a = 0.03
    h = lp.impulse(3)
    f1 = di.mash_factors(1)
    reh = float(np.real(lp.H(a)))
    terms = dict(carrier=f1['phi2'] * reh, k0=h[0] * f1['rtilde'][0], k1=h[1] * np.cos(2 * np.pi * a) * f1['rtilde'][1],
                 k2=h[2] * np.cos(4 * np.pi * a) * f1['rtilde'][2])
    kappa1 = sum(terms.values())
    out['headline'] = dict(
        loop='L2_pm45', source='mash', alpha=a, f_MHz=a * 4000, ReH=reh, h=[float(x) for x in h], phi2=f1['phi2'],
        rtilde=f1['rtilde'], terms=terms, kappa_1=float(kappa1), kappa_closed=out['closed']['L2_pm45|mash'][str(a)],
        pm60=dict(ReH=float(np.real(loops['L2'].H(a))), kappa_1=out['closed']['L2|mash'][str(a)]['kappa_m'][0],
                  kappa_inf=out['large_signal']['L2|mash'][str(a)]['m1']['kappa_inf']),
        kappa_inf=out['large_signal']['L2_pm45|mash'][str(a)]['m1']['kappa_inf'],
        mc=out['mc']['L2_pm45|mash'][str(a)],
        sim_final_phos_fs=sim['lms']['L2_pm45|mash']['0.03|raw']['final_phos_rms_fs'],
        handcalc_dq=dict(white=di.dq_white(1), line_m1=di.dq_line_weight(1, 0), lines_pm1=[di.dq_line_weight(1, 1), di.dq_line_weight(1, -1)],
                         kappa_1=out['closed']['L2_pm45|dq'][str(a)]['kappa_m'][0]),
        handcalc_rot8=dict(D2=di.rot_factor(8, 1), kappa_1=out['closed']['L2_pm45|rot8'][str(a)]['kappa_m'][0]),
        handcalc_rot4=dict(D2=di.rot_factor(4, 1), raw_kappa_1=out['closed']['L2_pm45|acc1'][str(a)]['kappa_m'][0],
                           kappa_1=out['closed']['L2_pm45|rot4'][str(a)]['kappa_m'][0]),
    )
    path = HERE / 'results' / 'dither_interaction.json'
    json.dump(_finite(out), open(path, 'w'), indent=1, allow_nan=False)
    print(f'wrote {path} ({path.stat().st_size / 1e6:.1f} MB) in {time.time() - t0:.0f} s; '
          f'mc cross-check ok/mismatch/n/a = {n_ok}/{n_bad}/{n_na}')
    write_page_subset(out)


CANDIDATES = ('two_stage', 'two_stage_m1', 'efold')


def score_candidates(out: dict) -> None:
    """In place: refresh the F-CS.28 (linear stage) cross-check of every stored MC row and score the candidate dead-zone rules
    (dither_interaction.two_stage_verdict with kappa_inf along the worst mode / mode 1, and efold_verdict over the MC window) with the
    same crosscheck rules.  Adds per row `kappa_inf_worst` (kappa_inf along the closed form's worst mode; = kappa_inf_m1 when that is
    mode 1) and `candidates`, and to mc._summary the linear-stage scope, the dead-zone count and `candidates` (totals over the 105 rows,
    the same counts restricted to the 18 dead-zone rows, and the list of mismatching rows)."""
    tau = out['_meta']['tau_dead']
    zero = lambda: dict(n_ok=0, n_mismatch=0, n_na=0)  # noqa: E731
    tot = {c: dict(zero(), dead_zone=zero(), mismatches=[]) for c in CANDIDATES}
    lin = zero()
    n_dead = 0
    for key, rows in out['mc'].items():
        if key.startswith('_'):
            continue
        for a, row in rows.items():
            ls = out['large_signal'][key][a]
            wm = int(row['worst_mode'])
            k_w = ls.get(f'm{wm}', ls['m1'])['kappa_inf']        # tools stores m{wm} whenever the worst mode is not 1
            k_1 = ls['m1']['kappa_inf']
            assert abs(k_1 - row['kappa_inf_m1']) < 1e-15
            row['kappa_inf_worst'] = k_w
            row['crosscheck'] = di.crosscheck(row['verdict'], row)
            lin[{'ok': 'n_ok', 'mismatch': 'n_mismatch', 'n/a': 'n_na'}[row['crosscheck']['status']]] += 1
            ef = di.efold_verdict(row['kappa_min'], row['n_blocks'], row['tau_blocks'], row['grow'], row['shrink'])
            cand = {
                'two_stage': dict(verdict=di.two_stage_verdict(row['kappa_min'], k_w, tau)),
                'two_stage_m1': dict(verdict=di.two_stage_verdict(row['kappa_min'], k_1, tau)),
                'efold': dict(verdict=ef['verdict'], growth=ef['growth']),
            }
            dead = row['verdict'] == 'dead'
            n_dead += dead
            for c, v in cand.items():
                st = di.crosscheck(v['verdict'], row)['status']
                v['status'] = st
                k = {'ok': 'n_ok', 'mismatch': 'n_mismatch', 'n/a': 'n_na'}[st]
                tot[c][k] += 1
                if dead:
                    tot[c]['dead_zone'][k] += 1
                if st == 'mismatch':
                    tot[c]['mismatches'].append(f'{key}|{a}')
            row['candidates'] = cand
    s = out['mc']['_summary']
    assert (s['n_ok'], s['n_mismatch'], s['n_na']) == (lin['n_ok'], lin['n_mismatch'], lin['n_na'])
    tot['efold'].update(di.efold_window(MC_BLOCKS, 25.0))
    s.update(scope='F-CS.28 linear stage only: |kappa_min| <= tau_dead is n/a (not scored); candidates are scored, not used',
             n_dead=n_dead, candidates=tot)


PAGE_SUBSET = HERE.parents[2] / 'src' / 'pages' / 'case-sspll' / 'ditherNumbers.json'


MC_ROW_DROP = ('seeds', 'diverged', 'converged', 'candidates')


def page_subset(out: dict) -> dict:
    """The subset of dither_interaction.json the case page imports statically (it ends up in the page's JS chunk, so only what the
    page reads): numeric (kappa_min / worst mode / GOS, without the per-mode arrays), sim_compare, mc (without the per-seed arrays
    and the per-row candidate scores -- their totals stay in mc._summary.candidates) and headline.  The fine-grid closed forms, the spectral factors and the large-signal slopes are recomputed live by the TS port.
    src/pages/case-sspll/ditherNumbers.test.ts checks every value against the full file."""
    return {
        '_meta': dict(source='analysis/sspll/golden/results/dither_interaction.json', keys=['numeric', 'sim_compare', 'mc', 'headline'],
                      note='Subset of dither_interaction.json read by the case page (closed forms, factors and large-signal slopes are computed live by the TS port). '
                           'Do not edit by hand: regenerate with tools/dither_sweep.py (--subset-only reuses the stored results); ditherNumbers.test.ts checks every value.',
                      tau_dead=out['_meta']['tau_dead'], tolerances=out['_meta']['tolerances'], loops=out['_meta']['loops'],
                      sources=out['_meta']['sources'], code_range_delta=out['_meta']['code_range_delta'], selected_alphas=out['_meta']['selected_alphas']),
        'numeric': {k: {a: {kk: vv for kk, vv in row.items() if kk != 'kappa_m'} for a, row in v.items()} for k, v in out['numeric'].items()},
        'sim_compare': out['sim_compare'],
        'mc': {k: (v if k.startswith('_') else {a: {kk: vv for kk, vv in row.items() if kk not in MC_ROW_DROP} for a, row in v.items()})
               for k, v in out['mc'].items()},
        'headline': out['headline'],
    }


def write_page_subset(out: dict) -> None:
    json.dump(_finite(page_subset(out)), open(PAGE_SUBSET, 'w'), indent=1, allow_nan=False)
    print(f'wrote {PAGE_SUBSET} ({PAGE_SUBSET.stat().st_size / 1e3:.0f} KB)')


if __name__ == '__main__':
    if '--subset-only' in sys.argv:          # rewrite only the page subset from the stored results (no Monte Carlo)
        write_page_subset(json.load(open(HERE / 'results' / 'dither_interaction.json')))
    elif '--rescore' in sys.argv:            # re-score the stored MC rows (no new simulation), rewrite results and the page subset
        path = HERE / 'results' / 'dither_interaction.json'
        stored = json.load(open(path))
        score_candidates(stored)
        hk = stored['headline']
        stored['headline']['mc'] = stored['mc'][f"{hk['loop']}|{hk['source']}"][str(hk['alpha'])]
        json.dump(_finite(stored), open(path, 'w'), indent=1, allow_nan=False)
        sm = stored['mc']['_summary']
        print(f'rescored {path}: linear ok/mismatch/n/a = {sm["n_ok"]}/{sm["n_mismatch"]}/{sm["n_na"]}; ' +
              '; '.join(f'{c}: {v["n_ok"]}/{v["n_mismatch"]}/{v["n_na"]} (dead zone {v["dead_zone"]["n_ok"]}/{v["dead_zone"]["n_mismatch"]}/'
                        f'{v["dead_zone"]["n_na"]})' for c, v in sm['candidates'].items()))
        write_page_subset(stored)
    else:
        main()
