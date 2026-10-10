#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_results.py -- compute EVERY number quoted in docs/analysis/sspll-gos-phos-polarity.md
and write results/doc_numbers.json (+ a human-readable results/doc_numbers.log).

Run from analysis/sspll/golden:   python3 tools/make_results.py        (~2-4 min, 1 core)
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from fractions import Fraction

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from sspll_golden.loops import (F_REF, TWO_PI, cppll_minus_ReL, make_L1, make_L2, make_L3, make_P_only_L2,  # noqa: E402
                                make_P_only_L3, nominal_loops, typeI_latency_criterion, typeI_pole_criterion,
                                typeI_ReH, typeII_f_inv, typeII_ReL)
from sspll_golden.predictions import (C_periodic, analyse_C, block_mean_stable, disc_constant,  # noqa: E402
                                      gamma_eff, gos_harmonic, gos_offset_bias, gos_small_beta, intervals,
                                      kappa_inf_worst, kappa_rational, kernel_min, large_signal_periodic,
                                      mode1_sure_band, one_diff_margin, phos_lambda_harmonic, physical_mix,
                                      sign_map_j4096, sim_cfg, single_line_phos, theory_point, Eq_offset,
                                      Kq_offset)
from sspll_golden.regressors import NPH, W1, W_SQUARE, X_rational, acc_side  # noqa: E402
from sspll_golden.simulator import final_stats, replica_S, replica_kappa, run_sign_lms  # noqa: E402

LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    LOG.append(s)
    print(s, flush=True)


def jsonable(o):
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return jsonable(o.tolist())
    if isinstance(o, (np.floating, float)):
        x = float(o)
        return None if not math.isfinite(x) else x
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, complex):
        return [o.real, o.imag]
    return o


def MHz(f):
    return f * F_REF / 1e6


def build_models():
    L = nominal_loops()
    M = dict(L1=dict(loop=L['L1'], models={'exact': L['L1'], 'bw0.8': make_L1(bw=0.8 * 320e6),
                                           'bw1.2': make_L1(bw=1.2 * 320e6), 'typeI': L['L1']}, ponly=None),
             L2=dict(loop=L['L2'], models={'exact': L['L2'], 'bw0.8': make_L2(60, bw=0.8 * 320e6),
                                           'bw1.2': make_L2(60, bw=1.2 * 320e6), 'typeI': L['L1']},
                     ponly=make_P_only_L2(L['L2'])),
             L3=dict(loop=L['L3'], models={'exact': L['L3'], 'bw0.8': make_L3(60, 'impulse', bw=0.8 * 320e6),
                                           'bw1.2': make_L3(60, 'impulse', bw=1.2 * 320e6), 'typeI': L['L1']},
                     ponly=make_P_only_L3(L['L3'])))
    return M


# ======================================================================================
def sec_loops(M, R):
    log("\n[A] loops")
    out = {}
    f = np.concatenate([np.geomspace(1e-8, 1e-3, 3000, endpoint=False), np.linspace(1e-3, 0.5, 400001)])
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        s = lp.summary()
        Lf = lp.L(f)
        Hf = lp.H(f)
        Tf = Lf / (1 + Lf)
        mism = int(np.sum((Hf.real < 0) != (Lf.real < -1)) + np.sum((Hf.real < 0) != (Tf.real > 1)))
        peak_viol = int(np.sum((Hf.real < 0) & (np.abs(Tf) <= 1)))
        s['identity_mismatches'] = mism
        s['ReH_neg_with_absT_le_1'] = peak_viol
        out[k] = s
        log(f"   {k}: params {lp.params}")
        log(f"       f3dB {s['f3dB_MHz']:.6f} MHz, PM {s['PM_deg']:.3f} deg, fc {s['fc_MHz']:.2f} MHz, "
            f"|T| peak {s['T_peak_dB']:.3f} dB, max Re H {s['max_ReH']:.5f}, bands {s['ReH_neg_bands_MHz']}, "
            f"identity mismatches {mism}, ReH<0 & |T|<=1: {peak_viol}")
    # closed forms
    L1, L2, L3 = M['L1']['loop'], M['L2']['loop'], M['L3']['loop']
    ff = np.linspace(1e-4, 0.5, 20001)
    cf = dict(
        L1_ReH_err=float(np.max(np.abs(L1.H(ff).real - typeI_ReH(L1.params['K'], ff)))),
        L1_min_ReH=float(L1.H(np.linspace(1e-6, 0.5, 200001)).real.min()),
        L2_ReL_rel_err=float(np.max(np.abs(L2.L(ff).real - typeII_ReL(L2.params['Kp'], L2.params['Ki'], ff))
                                    / np.abs(typeII_ReL(L2.params['Kp'], L2.params['Ki'], ff)))),
        L2_f_inv_MHz=MHz(typeII_f_inv(L2.params['Kp'], L2.params['Ki'])),
        L3_ReL_rel_err=float(np.max(np.abs(-L3.L(ff).real - cppll_minus_ReL(L3, ff)) / cppll_minus_ReL(L3, ff))),
        L3_B=L3.params['B'], L3_p=L3.params['p'], L3_K=L3.params['K'])
    # low-frequency expansion
    for k, lp, coef in (('L2', L2, 1 / L2.params['Ki']), ('L3', L3, 1 / L3.params['K'])):
        fl = 1e-4
        cf[f'{k}_lowf_ratio'] = float(lp.H(fl).real / (-(TWO_PI * fl) ** 2 * coef))
    cf['L1_lowf_ratio'] = float(L1.H(1e-4).real / ((2 - L1.params['K']) * (TWO_PI * 1e-4) ** 2 / (2 * L1.params['K'] ** 2)))
    out['closed_forms'] = cf
    log("   closed forms:", {q: (round(v, 10) if isinstance(v, float) else v) for q, v in cf.items()})
    # other L3 mappings + sensitivity loops
    sens = {}
    for nm, lp in (('L3_halfT', make_L3(60, 'halfT')), ('L3_zoh', make_L3(60, 'zoh')),
                   ('L2_pm45', make_L2(45)), ('L2_pm75', make_L2(75)), ('L2_lat2_redesign', make_L2(60, lat=2)),
                   ('L2_lat2_fixedKpKi', make_L2(Kp=L2.params['Kp'], Ki=L2.params['Ki'], lat=2)),
                   ('L3_pm45', make_L3(45)), ('L3_pm55', make_L3(55))):
        s = lp.summary()
        sens[nm] = dict(f3dB_MHz=s['f3dB_MHz'], PM_deg=s['PM_deg'], bands=s['ReH_neg_bands_MHz'], params=lp.params,
                        one_diff_margin=one_diff_margin(lp)['min'], d1_kernel_min=kernel_min(lp, '1diff')['min'])
        log(f"   {nm}: f3dB {s['f3dB_MHz']:.2f} PM {s['PM_deg']:.2f} bands {[[round(x, 3) for x in b] for b in s['ReH_neg_bands_MHz']]}"
            f" 1diff kernel min {sens[nm]['d1_kernel_min']:.2e}")
    for g in (0.6, 0.8, 1.25, 1.5):
        for k, lp in (('L2', make_L2(Kp=L2.params['Kp'], Ki=L2.params['Ki'], gain_scale=g)),
                      ('L3', make_L3(60, 'impulse', wc=L3.params['wc'], gain_scale=g))):
            s = lp.summary()
            sens[f'{k}_gain{g:g}'] = dict(f3dB_MHz=s['f3dB_MHz'], PM_deg=s['PM_deg'], bands=s['ReH_neg_bands_MHz'],
                                          d1_kernel_min=kernel_min(lp, '1diff')['min'])
            log(f"   {k} gain x{g}: f3dB {s['f3dB_MHz']:.2f} PM {s['PM_deg']:.2f} band "
                f"{[[round(x, 2) for x in b[:2]] + [round(b[2], 4)] for b in s['ReH_neg_bands_MHz']]}")
    out['sensitivity'] = sens
    # Type-I criteria
    ti = {}
    for lat in (1, 2, 3, 4, 5):
        lp = make_L1(lat=lat)
        s = lp.summary()
        ti[f'lat{lat}'] = dict(K=lp.params['K'], criterion=typeI_latency_criterion(lp.params['K'], lat),
                               PM_deg=s['PM_deg'], bands=s['ReH_neg_bands_MHz'])
    for fp in (1000e6, 500e6, 250e6, 200e6):
        lp = make_L1(f_pole=fp)
        p = math.exp(-TWO_PI * fp / F_REF)
        s = lp.summary()
        ti[f'pole{fp / 1e6:g}M'] = dict(K=lp.params['K'], p=p, criterion=typeI_pole_criterion(lp.params['K'], p),
                                       PM_deg=s['PM_deg'], bands=s['ReH_neg_bands_MHz'])
    for k, v in ti.items():
        log(f"   Type-I {k}: K {v['K']:.4f} criterion {v['criterion']:.3f} PM {v['PM_deg']:.1f} bands "
            f"{[[round(x, 2) for x in b[:3]] for b in v['bands']]}")
    out['typeI_criteria'] = ti
    # P-only loops
    po = {}
    for nm, lp, crit in (('L2_Ponly', M['L2']['ponly'], typeI_latency_criterion(L2.params['Kp'], 1)),
                         ('L3_Ponly_C1>>C2', M['L3']['ponly'], None),
                         ('L3_Ponly_exactRC2', make_P_only_L3(L3, exact_hold=True), None)):
        if crit is None:
            crit = typeI_pole_criterion(lp.params['A'], lp.params['p'])
        s = lp.summary()
        po[nm] = dict(f3dB_MHz=s['f3dB_MHz'], PM_deg=s['PM_deg'], bands=s['ReH_neg_bands_MHz'], criterion=crit,
                      params=lp.params, kernel_min=kernel_min(lp)['min'])
        log(f"   {nm}: f3dB {s['f3dB_MHz']:.2f} MHz PM {s['PM_deg']:.2f} criterion {crit:.4f} bands {s['ReH_neg_bands_MHz']}"
            f" min ReH {po[nm]['kernel_min']:.2e} params {lp.params}")
    out['P_only'] = po
    R['loops'] = out


# ======================================================================================
def sec_gos(M, R):
    log("\n[B] GOS")
    out = {}
    # small-beta asymptotes: alpha = (1+beta)/8 with beta = 1/P
    sb = {}
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        rows = []
        for P in (64, 256, 1024):
            beta = 1.0 / P
            fr = Fraction(1, 8) + Fraction(1, 8 * P)
            C0 = C_periodic(fr.numerator, fr.denominator, gamma_eff(lp), 'right')[0, 0]
            C1 = C_periodic(fr.numerator, fr.denominator, gamma_eff(lp, 'D:1'), 'right')[0, 0]
            rows.append(dict(P=P, beta=beta, C_D0=float(C0), asym_D0=gos_small_beta(lp, beta, 0),
                             C_D1=float(C1), asym_D1=gos_small_beta(lp, beta, 1)))
        sb[k] = rows
        log(f"   {k} small-beta:", [[r['P'], f"{r['C_D0']:.4g}", f"{r['asym_D0']:.4g}", f"{r['C_D1']:.4g}", f"{r['asym_D1']:.4g}"] for r in rows])
    out['small_beta'] = sb
    # exact rational scan: all reduced beta = a/b, b <= BMAX ; C_GOS = sum_k Re H(k/b) /(4 b^2 sin^2(pi k/b)) over the beta-orbit
    BMAX = 400
    scan = {}
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        nneg = ntot = 0
        worst = (np.inf, None)
        for bb in range(2, BMAX + 1):
            kk = np.arange(1, bb)
            w = 1 / (4 * bb ** 2 * np.sin(np.pi * kk / bb) ** 2)
            Rb = np.r_[0.0, lp.H(kk / bb).real]
            a = np.array([x for x in range(1, bb // 2 + 1) if math.gcd(x, bb) == 1])
            Ca = (Rb[(np.outer(a, kk)) % bb] * w).sum(1)
            ntot += len(a)
            nneg += int((Ca < 0).sum())
            j = int(np.argmin(Ca))
            if 12 * Ca[j] < worst[0]:
                worst = (12 * Ca[j], (int(a[j]), bb))
        scan[k] = dict(b_max=BMAX, n_beta=ntot, n_negative=nneg, min_12C=float(worst[0]), at_beta=worst[1],
                       asym_12beta2_over_Ki=(12 / BMAX ** 2 / lp.params['Ki']) if 'Ki' in lp.params else None)
        log(f"   {k} rational beta scan b<={BMAX}: {ntot} betas, negative {nneg}, min 12C {worst[0]:.4e} at {worst[1]}")
    out['rational_scan'] = scan
    # harmonic vs exact periodic for 8 | Q (irrational limit)
    hv = {}
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        errs = []
        for P, Q in ((85, 4096), (171, 8192), (1013, 8192), (2731, 8192)):
            Cp = C_periodic(P, Q, gamma_eff(lp))[0, 0]
            errs.append(abs(Cp - gos_harmonic(P / Q, gamma_eff(lp), M=8192)))
        hv[k] = float(max(errs))
    out['harmonic_vs_periodic_maxerr'] = hv
    log("   GOS harmonic vs periodic (8|Q) max err:", hv)
    R['gos'] = out


# ======================================================================================
def sec_phos(M, R):
    log("\n[C] PHOS")
    out = {}
    # alpha = 1/50 and 0.021 point values
    pts = {}
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        for (P, Q) in ((1, 50), (21, 1000)):
            r = kappa_rational(lp, P, Q)
            C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
            a = analyse_C(C, cov)
            lam = phos_lambda_harmonic(P / Q, gamma_eff(lp))
            pts[f'{k}|{P}/{Q}'] = dict(kP_occnorm=r['kP'], eightlam_min=8 * a['phos_min_re'], kG=r['kG'],
                                       twelveC=12 * C[0, 0], ergodic_min=float(8 * lam[1:].real.min()),
                                       single_line=single_line_phos(P / Q, gamma_eff(lp)),
                                       occupancy=r['occupancy'])
            log(f"   {k} alpha={P}/{Q}: kP(occ-norm) {r['kP']:+.4f}, 8 lam_min {8 * a['phos_min_re']:+.4f}, ergodic {8 * lam[1:].real.min():+.4f},"
                f" 1-line {pts[f'{k}|{P}/{Q}']['single_line']:+.4f}, 12C {12 * C[0, 0]:.4f}, kG {r['kG']:.4f}")
    out['points'] = pts
    # circulant / ergodic agreement for 8 | Q, lambda_0
    ce = {}
    for k in ('L2', 'L3'):
        lp = M[k]['loop']
        e_circ = e_erg = l0 = 0.0
        for (P, Q) in ((85, 4096), (171, 8192), (1013, 8192)):
            C = C_periodic(P, Q, gamma_eff(lp))
            Cp = C[1:, 1:]
            e_circ = max(e_circ, float(np.max(np.abs(Cp - np.roll(np.roll(Cp, 1, 0), 1, 1)))))
            r = kappa_rational(lp, P, Q)
            lam = phos_lambda_harmonic(P / Q, gamma_eff(lp))
            e_erg = max(e_erg, float(np.max(np.abs(np.array(r['km']) / 8 - lam[1:5]))))
            k_ = np.arange(8)
            v0 = np.ones(8)
            l0 = max(l0, float(abs(v0 @ Cp @ v0 / 8)))
        ce[k] = dict(circulant_err=e_circ, ergodic_vs_periodic_err=e_erg, lambda0_abs=l0)
    out['circulant_check'] = ce
    log("   circulant/ergodic checks:", ce)
    # weights
    ell = np.concatenate([1 + 8 * np.arange(0, 200000), 1 - 8 * np.arange(1, 200001)]).astype(float)
    out['weights'] = dict(W1=W1, W_square=W_SQUARE,
                          sum_mode1=float(np.sum(64 * np.sin(np.pi * ell / 8) ** 2 / (np.pi * ell) ** 2)))
    log("   weights:", out['weights'])
    # mode-1 sure bands
    sb = {k: mode1_sure_band(M[k]['loop']) for k in ('L2', 'L3')}
    out['mode1_sure'] = sb
    log("   mode-1 sure bands:", sb)
    # j/4096 maps
    maps = {}
    for k in ('L1', 'L2', 'L3'):
        m = sign_map_j4096(M[k]['loop'])
        fm = np.round(m['f_MHz'], 3).tolist()
        d = dict(worst_kP=float(m['kP'].min()), worst_at_MHz=float(m['f_MHz'][np.argmin(m['kP'])]),
                 n_gos_neg=int((m['kG'] < 0).sum()), min_kG=float(np.nanmin(m['kG'])),
                 min_kG_at_MHz=float(m['f_MHz'][np.nanargmin(m['kG'])]))
        for tau in (1e-3, 1e-2):
            d[f'bands_tau{tau:g}'] = intervals(fm, (m['kP'] < -tau).tolist())
            d[f'bands_m1_tau{tau:g}'] = intervals(fm, (m['km'][:, 0].real < -tau).tolist())
        sel = {}
        for a in (0.004, 0.245, 0.247, 0.249, 0.251, 0.253, 0.255, 0.49, 0.492, 0.494, 0.496):
            j = int(round(a * 4096))
            sel[f'{j}/4096'] = dict(f_MHz=j * 4000 / 4096, kP=float(m['kP'][j - 1]),
                                    m1_4=[round(float(x.real), 5) for x in m['km'][j - 1]])
        d['selected'] = sel
        maps[k] = d
        log(f"   {k} j/4096: worst {d['worst_kP']:+.4f} @ {d['worst_at_MHz']:.1f} MHz; tau1e-3 {d['bands_tau0.001']}; "
            f"tau1e-2 {d['bands_tau0.01']}; GOS neg {d['n_gos_neg']}, min kG {d['min_kG']:.4f} @ {d['min_kG_at_MHz']:.2f} MHz")
        log(f"       m1-only tau1e-3 {d['bands_m1_tau0.001']}")
        log("       selected:", sel)
    out['map_j4096'] = maps
    # 8 not | Q rationals near 1/4, 1/2 (Q <= 400): most negative
    al = {}
    for k in ('L2', 'L3'):
        lp = M[k]['loop']
        hits = []
        edge = sb[k]['impossible_above_MHz']
        for Q in range(2, 401):
            for P in range(1, Q // 2 + 1):
                if math.gcd(P, Q) != 1 or P / Q * 4000 <= edge:
                    continue
                r = kappa_rational(lp, P, Q)
                if np.isfinite(r['kP']) and r['kP'] < -1e-3:
                    hits.append((P, Q, round(P / Q * 4000, 1), round(r['kP'], 4)))
        far = [h for h in hits if min(abs(h[0] / h[1] - 0.25), abs(h[0] / h[1] - 0.5)) > 0.02]
        al[k] = dict(n_hits=len(hits), n_far=len(far), worst=sorted(hits, key=lambda h: h[3])[:6])
        log(f"   {k} PHOS-inverted rationals Q<=400 above mode-1 edge: {len(hits)} (far from 1/4,1/2: {len(far)}); worst {al[k]['worst']}")
    out['alias_rationals'] = al
    # PE failure at alpha = 1/4, 1/2: number of visited phases
    pe = {}
    for P, Q in ((1, 4), (1, 2), (1, 8), (3, 8)):
        X = X_rational(P, Q)
        pe[f'{P}/{Q}'] = dict(phases_visited=int((X[:, 1:].sum(0) > 0).sum()), var_rho=float(X[:, 0].var()))
    out['pe_failure'] = pe
    log("   PE failure:", pe)
    R['phos'] = out


# ======================================================================================
def sec_joint(M, R):
    log("\n[D] joint 9x9 / decoupling / theorem")
    out = {}
    dec = {}
    for (P, Q) in ((85, 4096), (13, 1000), (7, 120), (12, 383), (1, 50)):
        C = C_periodic(P, Q, gamma_eff(M['L2']['loop']))
        dec[f'{P}/{Q}'] = dict(eight_div_Q=Q % 8 == 0, max_cross=float(max(np.abs(C[0, 1:]).max(), np.abs(C[1:, 0]).max())))
    out['decoupling_L2'] = dec
    log("   GOS-PHOS cross terms (L2):", dec)
    QMAX = 200
    jo = {}
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        nj = ntot = 0
        only = []
        for Q in range(2, QMAX + 1):
            for P in range(1, Q // 2 + 1):
                if math.gcd(P, Q) != 1:
                    continue
                C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
                a = analyse_C(C, cov)
                ntot += 1
                cg = a['gos'] if a['gos_observable'] else np.nan
                inv_sep = (a['phos_min_re'] < -1e-6) or (np.isfinite(cg) and cg < -1e-6)
                inv_j = a['joint_min_re'] < -1e-6
                nj += int(inv_j)
                if inv_j and not inv_sep:
                    only.append((P, Q))
        jo[k] = dict(Q_max=QMAX, n_rationals=ntot, n_joint_inverted=nj, n_joint_only=len(only))
        log(f"   {k}: rationals Q<={QMAX}: {ntot}, joint-inverted {nj}, joint-only {len(only)}")
    out['joint_scan'] = jo
    # PSD theorem sanity: arbitrary kernel with Re >= 0
    rng = np.random.default_rng(1)
    worst = 1.0
    Gk = lambda fq: np.abs(1 + 0.9 * np.exp(-2j * np.pi * fq * 3)) ** 2 + 5j * np.sin(7 * 2 * np.pi * fq)  # noqa: E731
    for _ in range(300):
        Q = int(rng.integers(9, 300))
        P = int(rng.integers(1, Q))
        if math.gcd(P, Q) != 1:
            continue
        ev = np.linalg.eigvals(C_periodic(P, Q, Gk))
        worst = min(worst, float(ev.real.min()))
    out['theorem_random_kernel_min_re_eig'] = worst
    log("   theorem sanity (Re Gamma >= 0 kernel), min Re eig:", worst)
    # f_vco dependence (physical eps/Delta coupling)
    fv = {}
    for (P, Q) in ((21, 1000), (12, 383), (5, 163), (1, 50)):
        row = []
        for fvco in (12e9, 16e9, 24e9):
            cfg = sim_cfg(f_vco=fvco)
            C, cov, mu = C_periodic(P, Q, gamma_eff(M['L2']['loop']), 'right', True)
            a = analyse_C(C @ physical_mix(cfg), cov)
            row.append(dict(joint_min=a['joint_min_re'], C00=float((C @ physical_mix(cfg))[0, 0])))
        fv[f'{P}/{Q}'] = row
        log(f"   f_vco 12/16/24 GHz alpha={P}/{Q} (8|Q={Q % 8 == 0}): joint min {[f'{r['joint_min']:.7g}' for r in row]}, C00 {[f'{r['C00']:.7g}' for r in row]}")
    out['fvco'] = fv
    R['joint'] = out


# ======================================================================================
def sec_remedies(M, R):
    log("\n[E] remedy kernels")
    out = {}
    variants = ('raw', '1diff', '2diff', 'D:1', 'D:-1', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', 'fx:typeI')
    for k in ('L1', 'L2', 'L3'):
        lp, mods = M[k]['loop'], M[k]['models']
        d = {v: kernel_min(lp, v, mods)['min'] for v in variants}
        if M[k]['ponly'] is not None:
            d['P-only loop'] = kernel_min(M[k]['ponly'])['min']
        d['one_diff_margin'] = one_diff_margin(lp)['min']
        d['disc_const_1diff'] = disc_constant(lp, '1diff')
        d['H_half'] = float(lp.H(0.5).real)
        out[k] = d
        log(f"   {k}:", {q: round(v, 4) for q, v in d.items()})
    L2 = M['L2']['loop']
    Kp, Ki = L2.params['Kp'], L2.params['Ki']
    out['typeII_closed'] = dict(Kp_minus_Ki_over_2=Kp - Ki / 2, Kp_plus_Ki_over_2=Kp + Ki / 2,
                                D1_min_closed=-1 / (1 - (Kp + Ki / 2) / 2))
    log("   Type-II closed forms:", out['typeII_closed'])
    # filtered-x with a Type-I model: critical K_hat
    Kc = 1 / (Kp / Ki + 0.5)
    fxI = dict(K_hat_critical=Kc)
    ff = np.geomspace(1e-7, 0.5, 200001)
    for Kh in (0.389, 0.2, 0.13, 0.12, 0.10, 0.05):
        g = np.real(L2.H(ff) * np.conj(make_L1(K=Kh).H(ff)))
        neg = ff[g < 0]
        fxI[f'K_hat={Kh:g}'] = dict(min=float(g.min()), neg_up_to_MHz=float(MHz(neg.max())) if len(neg) else None)
    out['fx_typeI_model'] = fxI
    log("   fx with Type-I model:", fxI)
    # filtered-x with Type-II model errors: min cos(angle mismatch)
    cands = {'exact': L2, 'L2pm45': make_L2(45), 'L2pm75': make_L2(75), 'L2lat2': make_L2(60, lat=2),
             'Ki x0.5': make_L2(Kp=Kp, Ki=0.5 * Ki), 'Ki x2': make_L2(Kp=Kp, Ki=2 * Ki),
             'Kp x0.5': make_L2(Kp=0.5 * Kp, Ki=Ki), 'Kp x2': make_L2(Kp=2 * Kp, Ki=Ki),
             'gain x0.5': make_L2(Kp=Kp, Ki=Ki, gain_scale=0.5), 'gain x2': make_L2(Kp=Kp, Ki=Ki, gain_scale=2),
             'gain x3': make_L2(Kp=Kp, Ki=Ki, gain_scale=3)}
    fxr = {}
    fg = np.concatenate([np.geomspace(1e-7, 1e-3, 4000, endpoint=False), np.linspace(1e-3, 0.5, 200001)])
    for real_name in ('L2', 'L3'):
        H = M[real_name]['loop'].H(fg)
        for nm, m in cands.items():
            Hh = m.H(fg)
            c = np.real(H * np.conj(Hh)) / (np.abs(H) * np.abs(Hh))
            fxr[f'{real_name}|{nm}'] = float(c.min())
    out['fx_typeII_model_min_cos'] = fxr
    log("   fx Type-II model errors, min cos(dphi):", {q: round(v, 3) for q, v in fxr.items()})
    # finite-mu block stability on j/4096 (raw)
    fm = {}
    for k in ('L2', 'L3'):
        lp = M[k]['loop']
        ks = []
        for j in range(1, 2049):
            g = math.gcd(j, 4096)
            P, Q = j // g, 4096 // g
            C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
            Xc_basis = np.linalg.eigh(cov[1:, 1:])
            V = Xc_basis[1][:, Xc_basis[0] > 1e-9]
            ks.append((j, 8 * np.linalg.eigvals(V.T @ C[1:, 1:] @ V)))
        for tau in (25, 10, 5):
            ex = []
            for j, ev in ks:
                if np.all(ev.real > 1e-6) and not block_mean_stable(ev, tau):   # clearly restoring in the small-mu limit
                    kk = ev[np.argmax(np.abs(1 - ev / tau))]
                    ex.append([round(j * 4000 / 4096, 1), [round(float(kk.real), 4), round(float(kk.imag), 4)]])
            fm[f'{k}|tau{tau}'] = dict(n=len(ex), examples=ex[:6])
            log(f"   finite-mu {k} tau={tau} blocks: Re kappa>0 but unstable: {len(ex)} {ex[:4]}")
    out['finite_mu'] = fm
    R['remedies'] = out


# ======================================================================================
FINE = [round(0.001 * i, 3) for i in range(1, 501)]


def sec_fine(M, R, ref):
    log("\n[F] fine grid alpha = i/1000: exact periodic theory (sim physics, accumulator side) vs stored sim")
    out = {}
    variants = ('raw', '1diff', '2diff', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', 'D:1')
    cfg = sim_cfg()
    for k in ('L1', 'L2', 'L3'):
        lp, mods = M[k]['loop'], M[k]['models']
        th = {v: dict(kP=[], kG=[]) for v in variants}
        for a in FINE:
            for v in variants:
                t = theory_point(lp, a, v, mods, cfg, side='auto')
                th[v]['kP'].append(t['kP_simnorm'])
                th[v]['kG'].append(t['kG_simnorm'])
        sim = ref['loops'][k]
        d = {}
        for v in variants:
            sp = np.array(sim['kP'][v], float)
            tp = np.array(th[v]['kP'], float)
            sg = np.array(sim['kG'][v], float)
            tg = np.array(th[v]['kG'], float)
            row = dict(sim_phos_inv=int(np.sum(sp < -1e-3)), th_phos_inv=int(np.sum(tp < -1e-3)),
                       sim_gos_inv=int(np.nansum(sg < -1e-3)), th_gos_inv=int(np.nansum(tg < -1e-3)),
                       sim_phos_min=float(np.nanmin(sp)), th_phos_min=float(np.nanmin(tp)),
                       max_abs_diff_phos=float(np.nanmax(np.abs(sp - tp))))
            for tau in (1e-3, 1e-2):
                row[f'class_disagree_tau{tau:g}'] = int(np.sum((sp < -tau) != (tp < -tau)))
            if v == 'raw':
                spl = np.array(sim['kP']['raw|lin'], float)
                row['sim_lin_phos_inv'] = int(np.sum(spl < -1e-3))
                row['max_abs_diff_phos_lin'] = float(np.nanmax(np.abs(spl - tp)))
                for tau in (1e-3, 1e-2):
                    row[f'sim_intervals_tau{tau:g}'] = intervals(FINE, (sp < -tau).tolist())
                    row[f'th_intervals_tau{tau:g}'] = intervals(FINE, (tp < -tau).tolist())
                    row[f'class_disagree_lin_tau{tau:g}'] = int(np.sum((spl < -tau) != (tp < -tau)))
                row['gos_ratio_12C_over_sim_median'] = None
            d[v] = row
            log(f"   {k} {v:9s}: PHOS inv sim/th {row['sim_phos_inv']}/{row['th_phos_inv']}, GOS inv {row['sim_gos_inv']}/{row['th_gos_inv']},"
                f" min {row['sim_phos_min']:+.4f}/{row['th_phos_min']:+.4f}, max|diff| {row['max_abs_diff_phos']:.4f},"
                f" class disagree tau1e-3/1e-2 {row['class_disagree_tau0.001']}/{row['class_disagree_tau0.01']}")
        log(f"       raw sim intervals tau1e-2 {d['raw']['sim_intervals_tau0.01']}, theory {d['raw']['th_intervals_tau0.01']};"
            f" lin-estimator disagreements tau1e-3 {d['raw']['class_disagree_lin_tau0.001']}")
        # GOS normalisation ratio 12C_ergodic / kG_sim
        h12 = np.array([12 * gos_harmonic(a, gamma_eff(lp)) for a in FINE])
        sg = np.array(sim['kG']['raw'], float)
        ok = np.abs(sg) > 1e-6
        ratio = h12[ok] / sg[ok]
        d['raw']['gos_ratio_12C_over_sim_median'] = float(np.median(ratio))
        d['raw']['gos_ratio_5_95'] = [float(np.percentile(ratio, 5)), float(np.percentile(ratio, 95))]
        log(f"       GOS 12C_ergodic / kG_sim: median {np.median(ratio):.3f}, 5-95% {np.percentile(ratio, 5):.2f}-{np.percentile(ratio, 95):.2f}")
        out[k] = dict(summary=d, theory_raw_kP=th['raw']['kP'], theory_raw_kG=th['raw']['kG'],
                      theory_1diff_kP=th['1diff']['kP'])
    R['fine'] = out


def sec_large_signal(M, R, ref):
    log("\n[G] large signal (exact periodic, sim physics) on the fine grid")
    out = {}
    cfg = sim_cfg()
    for k in ('L1', 'L2', 'L3'):
        lp, mods = M[k]['loop'], M[k]['models']
        d = {}
        per = {}
        for v in ('raw', 'ac', '1diff', 'fx:exact'):
            w1, w5, wi = [], [], []
            for a in FINE:
                ls = large_signal_periodic(lp, a, (1.0, 5.0), cfg, v, mods)
                g1 = [ls[q]['g'][0] / ls[q]['g_open_loop'][0] if abs(ls[q]['g_open_loop'][0]) > 1e-9 else np.nan
                      for q in ls if not q.startswith('_')]
                g5 = [ls[q]['g'][1] / ls[q]['g_open_loop'][1] if abs(ls[q]['g_open_loop'][1]) > 1e-9 else np.nan
                      for q in ls if not q.startswith('_')]
                w1.append(np.nanmin(g1))
                w5.append(np.nanmin(g5))
                wi.append(kappa_inf_worst(ls))
            w1, w5, wi = np.array(w1), np.array(w5), np.array(wi)
            simls = ref['loops'][k]['LS'][v]
            d[v] = {'A=1ps': dict(periodic=int(np.sum(w1 < -1e-3)), sim=int(np.sum(np.array(simls['A=1ps'], float) < -1e-3))),
                    'A=5ps': dict(periodic=int(np.sum(w5 < -1e-3)), sim=int(np.sum(np.array(simls['A=5ps'], float) < -1e-3))),
                    'A=inf': dict(periodic=int(np.sum(wi < -1e-3)), worst=float(np.nanmin(wi)),
                                  intervals=intervals(FINE, (wi < -1e-3).tolist()))}
            per[v] = wi
            log(f"   {k} {v:8s}: A=1ps periodic/sim {d[v]['A=1ps']['periodic']}/{d[v]['A=1ps']['sim']}, A=5ps {d[v]['A=5ps']['periodic']}/{d[v]['A=5ps']['sim']},"
                f" A=inf {d[v]['A=inf']['periodic']} (worst {d[v]['A=inf']['worst']:+.3f})")
        if M[k]['ponly'] is not None:
            for v in ('raw', 'ac'):
                wi = np.array([kappa_inf_worst(large_signal_periodic(M[k]['ponly'], a, (), cfg, v)) for a in FINE])
                d[f'P-only|{v}'] = {'A=inf': dict(periodic=int(np.sum(wi < -1e-3)), worst=float(np.nanmin(wi)),
                                                  intervals=intervals(FINE, (wi < -1e-3).tolist()))}
                log(f"   {k} P-only {v}: A=inf inverted {d[f'P-only|{v}']['A=inf']['periodic']} worst {np.nanmin(wi):+.3f}")
        # L1 raw: which directions / where
        if k == 'L1':
            gos_only = []
            for a in FINE:
                ls = large_signal_periodic(lp, a, (), cfg, 'raw')
                bad = [q for q in ls if not q.startswith('_') and ls[q]['kappa_inf'] < -1e-3]
                if bad:
                    gos_only.append((a, bad))
            d['L1_raw_inf_dirs'] = dict(n=len(gos_only), all_gos=all(b == ['gos'] for _, b in gos_only),
                                        alphas=[a for a, _ in gos_only])
            log(f"   L1 raw A=inf inverted alphas: {len(gos_only)}, all GOS-only: {d['L1_raw_inf_dirs']['all_gos']}, "
                f"alphas {d['L1_raw_inf_dirs']['alphas'][:12]}...")
        d['kinf_raw_per_alpha'] = per['raw']
        out[k] = d
    R['large_signal'] = out


SEL = [0.002, 0.004, 0.006, 0.01, 0.016, 0.02, 0.021, 0.03, 0.031, 0.123, 0.137, 0.247, 0.253, 0.496]


def sec_pred_vs_sim(M, R, ref):
    log("\n[H] predicted vs simulated at selected alpha (replica of the sim protocol + theory)")
    out = {}
    cfg = sim_cfg()
    for k in ('L1', 'L2', 'L3'):
        lp, mods = M[k]['loop'], M[k]['models']
        sim = ref['loops'][k]
        rows = []
        for a in SEL:
            i = FINE.index(a)
            rep = replica_S(lp, a, ('raw',), cfg, models=mods)
            rk = replica_kappa(rep)
            t = theory_point(lp, a, 'raw', mods, cfg, side='auto')
            fr = Fraction(a).limit_denominator(1 << 16)
            ki = kappa_rational(lp, fr.numerator, fr.denominator)
            C, cov, mu = C_periodic(fr.numerator, fr.denominator, gamma_eff(lp), 'right', True)
            an = analyse_C(C, cov)
            lam = phos_lambda_harmonic(a, gamma_eff(lp))
            ls = large_signal_periodic(lp, a, (), cfg, 'raw', mods)
            row = dict(alpha=a, f_MHz=a * 4000, Q=t['Q'], side=t['side'],
                       kP_sim=sim['kP']['raw'][i], kP_sim_lin=sim['kP']['raw|lin'][i], kP_replica=rk['kP'],
                       kP_exact_simnorm=t['kP_simnorm'], kP_8lam_rational=8 * an['phos_min_re'],
                       kP_8lam_ergodic=float(8 * lam[1:].real.min()), kP_m1_ergodic=float(8 * lam[1].real),
                       kP_single_line=single_line_phos(a, gamma_eff(lp)),
                       kG_sim=sim['kG']['raw'][i], kG_replica=rk['kG'], kG_12C_ergodic=12 * gos_harmonic(a, gamma_eff(lp)),
                       LS_kinf_worst=kappa_inf_worst(ls))
            rows.append(row)
            log(f"   {k} a={a:<6} sim {row['kP_sim']:+.4f} rep {row['kP_replica']:+.4f} exact {row['kP_exact_simnorm']:+.4f}"
                f" 8lam-rat {row['kP_8lam_rational']:+.4f} erg {row['kP_8lam_ergodic']:+.4f} m1 {row['kP_m1_ergodic']:+.4f}"
                f" 1line {row['kP_single_line']:+.4f} | GOS sim {row['kG_sim']:+.4f} 12C {row['kG_12C_ergodic']:+.4f} | LS {row['LS_kinf_worst']:+.3f}")
        out[k] = rows
        mx = max(abs(r['kP_sim'] - r['kP_replica']) for r in rows)
        mxg = max(abs(r['kG_sim'] - r['kG_replica']) for r in rows)
        log(f"   {k}: max |sim - replica| kP {mx:.2e}, kG {mxg:.2e}")
    R['pred_vs_sim'] = out


LMS_CASES = [('L2', 0.02, 'raw', None), ('L2', 0.02, '1diff', None), ('L2', 0.02, 'fx:exact', None),
             ('L2', 0.02, 'raw', 'ponly'), ('L2', 0.02, 'ac', 'ponly'),
             ('L2', 0.002, 'raw', None), ('L2', 0.002, '1diff', None), ('L2', 0.002, 'fx:exact', None), ('L2', 0.002, 'raw', 'ponly'),
             ('L2', 0.496, 'raw', None), ('L2', 0.496, '1diff', None), ('L2', 0.496, 'fx:exact', None), ('L2', 0.496, 'raw', 'ponly'),
             ('L2', 0.253, 'raw', None), ('L2', 0.253, '1diff', None), ('L2', 0.253, 'fx:exact', None), ('L2', 0.253, 'raw', 'ponly'),
             ('L3', 0.016, 'raw', None), ('L3', 0.016, '1diff', None), ('L3', 0.016, 'raw', 'ponly'),
             ('L3', 0.002, 'raw', None), ('L3', 0.002, '1diff', None), ('L3', 0.002, 'raw', 'ponly'),
             ('L1', 0.02, 'raw', None), ('L1', 0.122, 'raw', None), ('L1', 0.122, 'ac', None),
             ('L2', 0.137, 'raw', None), ('L2', 0.137, '2diff', None), ('L2', 0.137, 'D:1', None)]


def sec_lms(M, R):
    log("\n[I] closed-loop sign-error LMS (real 1-bit comparator, sigma_v = 200 fs, N = 512, 6000 blocks, 2 lanes)")
    out = {}
    t0 = time.time()
    for (k, a, v, mode) in LMS_CASES:
        lp = M[k]['ponly'] if mode == 'ponly' else M[k]['loop']
        rec = run_sign_lms(lp, a, v, n_blocks=6000, lanes=2, models=M[k]['models'], seed=3)
        st = final_stats(rec)
        key = f"{k}|{a}|{v}" + ("|Ponly" if mode == 'ponly' else "")
        out[key] = dict(st, init_phos_rms_fs=float(np.median(rec['phos_rms_fs'][0])),
                        blocks=rec['block'][::10], phos_rms_med=[float(np.median(x)) for x in rec['phos_rms_fs'][::10]],
                        gos_med=[float(np.median(np.abs(x))) for x in rec['gos_err_fs'][::10]])
        log(f"   {key:24s} PHOS {out[key]['init_phos_rms_fs']:.0f} fs -> {st['phos_rms_fs']:10.1f} fs (max {st['phos_rms_max_fs']:9.1f}) | GOS {st['gos_fs']:9.1f} fs")
    log(f"   ({time.time() - t0:.0f} s)")
    R['lms'] = out


def sec_offset(M, R):
    log("\n[J] comparator DC offset (u_os) -- forcing term outside eig(C)")
    out = {}
    sig = 200.0   # fs
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        for (P, Q) in ((137, 1000), (123, 1000)):
            C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
            for u in (25.0, 100.0):
                b_raw = gos_offset_bias(C[0, 0], mu[0], u, sig)
                b_ac = gos_offset_bias(C[0, 0], mu[0] - 0.5, u, sig)
                out[f'{k}|{P}/{Q}|u={u:g}'] = dict(twelveC=12 * C[0, 0], rho_mean=float(mu[0]), Eq=Eq_offset(u, sig),
                                                   Kq_ratio=Kq_offset(u, sig) / Kq_offset(0, sig),
                                                   gos_bias_raw_fs=b_raw, gos_bias_ac_fs=b_ac)
                log(f"   {k} alpha={P}/{Q} u_os={u:g} fs: 12C {12 * C[0, 0]:.4f}, E[q] {Eq_offset(u, sig):.4f}, "
                    f"raw GOS bias {b_raw:+.1f} fs, ac {b_ac:+.2f} fs")
    # GOS bias over the j/4096 channels at u_os = 25 fs (raw vs ac)
    for k in ('L1', 'L2', 'L3'):
        lp = M[k]['loop']
        braw, bac = [], []
        for j in range(1, 2048):
            g = math.gcd(j, 4096)
            P, Q = j // g, 4096 // g
            C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
            if C[0, 0] > 1e-12:
                braw.append(abs(gos_offset_bias(C[0, 0], mu[0], 25.0, sig)))
                bac.append(abs(gos_offset_bias(C[0, 0], mu[0] - 0.5, 25.0, sig)))
        braw, bac = np.array(braw), np.array(bac)
        out[f'{k}|map_u25'] = dict(raw_median_fs=float(np.median(braw)), raw_frac_gt_1ps=float(np.mean(braw > 1000)),
                                   ac_median_fs=float(np.median(bac)))
        log(f"   {k} j/4096, u_os=25 fs: raw GOS bias median {np.median(braw):.1f} fs, >1 ps {100 * np.mean(braw > 1000):.1f}%,"
            f" ac median {np.median(bac):.2f} fs")
    # closed-loop LMS with u_os
    lms = {}
    for (k, a) in (('L2', 0.137), ('L2', 0.123)):
        for u in (0.0, 25.0, 100.0):
            for v in ('raw', 'zm', '1diff'):
                rec = run_sign_lms(M[k]['loop'], a, v, n_blocks=4000, lanes=2, seed=1, u_os=u / 1000.0)
                st = final_stats(rec)
                lms[f'{k}|{a}|u={u:g}|{v}'] = st
                log(f"   LMS {k} a={a} u_os={u:g} fs {v:5s}: GOS {st['gos_fs']:9.1f} fs, PHOS diff {st['phos_rms_fs']:8.1f} fs, PHOS CM {st['phos_cm_fs']:9.1f} fs")
    out['lms'] = lms
    # near-grid Type-II, u_os = 100 fs: does the zero-mean regressor suffice?  depends on the rational side
    ng = {}
    for seqm in ('right', 'left', 'acc32'):
        for v in ('zm', '1diff'):
            vals = []
            for sd in (1, 5, 9):
                rec = run_sign_lms(M['L2']['loop'], 0.123, v, n_blocks=4000, lanes=1, seed=sd, u_os=0.1, seq=seqm)
                vals.append(final_stats(rec)['gos_fs'])
            ng[f'{seqm}|{v}'] = vals
            log(f"   near-grid L2 a=0.123 u_os=100 fs seq={seqm:5s} {v:5s}: GOS final (3 seeds) {[round(x, 1) for x in vals]} fs")
    out['lms_neargrid_u100'] = ng
    # illustrative static offsets
    ill = {}
    for name, t in (('1 mV comparator offset, A = 0.4 V, f_vco 16 GHz', 1e-3 / (2 * np.pi * 16e9 * 0.4) * 1e15),
                    ('5 mV', 5e-3 / (2 * np.pi * 16e9 * 0.4) * 1e15),
                    ('CPPLL 5% UP/DN mismatch x 50 ps reset', 0.05 * 50e3),
                    ('Type-I SSPLL static phase error at 100 ppm', 100e-6 * 250e3 / M['L1']['loop'].params['K']),
                    ('Type-I SSPLL static phase error at 1000 ppm', 1000e-6 * 250e3 / M['L1']['loop'].params['K'])):
        ill[name] = dict(u_fs=t, Eq=Eq_offset(t, sig), Kq_ratio=Kq_offset(t, sig) / Kq_offset(0, sig))
        log(f"   illustrative: {name}: u = {t:.1f} fs, E[q] = {ill[name]['Eq']:.3f}, Kq/Kq0 = {ill[name]['Kq_ratio']:.3g}")
    out['illustrative'] = ill
    R['offset'] = out


def main():
    t0 = time.time()
    ref = json.load(open(os.path.join(ROOT, 'reference', 'sim_fine_reference.json')))
    M = build_models()
    R = {}
    only = sys.argv[1:]
    secs = [('loops', lambda: sec_loops(M, R)), ('gos', lambda: sec_gos(M, R)), ('phos', lambda: sec_phos(M, R)),
            ('joint', lambda: sec_joint(M, R)), ('remedies', lambda: sec_remedies(M, R)),
            ('fine', lambda: sec_fine(M, R, ref)), ('large_signal', lambda: sec_large_signal(M, R, ref)),
            ('pred_vs_sim', lambda: sec_pred_vs_sim(M, R, ref)), ('lms', lambda: sec_lms(M, R)),
            ('offset', lambda: sec_offset(M, R))]
    path = os.path.join(ROOT, 'results', 'doc_numbers.json')
    if only and os.path.exists(path):
        R.update(json.load(open(path)))
    for nm, fn in secs:
        if only and nm not in only:
            continue
        fn()
    R['_meta'] = dict(runtime_s=time.time() - t0, numpy=np.__version__)
    with open(path, 'w') as fh:
        json.dump(jsonable(R), fh, indent=1)
    with open(os.path.join(ROOT, 'results', 'doc_numbers.log' if not only else 'doc_numbers_partial.log'), 'w') as fh:
        fh.write("\n".join(LOG) + "\n")
    log(f"\nruntime {time.time() - t0:.0f} s")


if __name__ == '__main__':
    main()
