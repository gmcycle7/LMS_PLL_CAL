#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_web_data.py -- JSON data for the website (src/data/sspll/).

Writes (each file < 400 KB):
  params.json        parameters / assumptions / conventions / loop summaries / closed forms
  hpd_L1.json ...    H_PD grid per loop (1500 points) + Re Gamma_eff of the remedies
  signmap_L1.json .. sign maps over alpha (2000 points, alpha f_ref = 0.5, 1.5, ..., 1999.5 MHz;
                     every alpha has 8 | Q, so the PHOS block is exactly circulant)
  pred_vs_sim.json   predicted vs simulated (selected alpha, full fine grid, counts, LMS)

Requires results/doc_numbers.json (python3 tools/make_results.py) and reference/sim_fine_reference.json.
Run from analysis/sspll/golden:  python3 tools/export_web_data.py      (~3 min)
"""
from __future__ import annotations

import datetime
import json
import math
import os
import sys
from fractions import Fraction

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(ROOT, '..', '..', '..'))
OUT = os.path.join(REPO, 'src', 'data', 'sspll')
sys.path.insert(0, ROOT)

import sspll_golden  # noqa: E402
from sspll_golden.loops import F_REF, make_L1, make_L2, make_L3, make_P_only_L2, make_P_only_L3, nominal_loops  # noqa: E402
from sspll_golden.predictions import (gamma_eff, intervals, kappa_inf_worst, kappa_rational,  # noqa: E402
                                      large_signal_periodic, sim_cfg)
from sspll_golden.regressors import W1  # noqa: E402

MAX_BYTES = 400 * 1024


def r(x, sig=5):
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        return None
    if x == 0.0:
        return 0.0
    return float(f'{x:.{sig}g}')


def rl(a, sig=5):
    return [r(v, sig) for v in np.asarray(a, float)]


def dump(name, obj):
    path = os.path.join(OUT, name)
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w') as fh:
        fh.write(s)
    n = os.path.getsize(path)
    print(f'   {name}: {n / 1024:.1f} KB')
    if n >= MAX_BYTES:
        raise RuntimeError(f'{name} too large ({n} bytes)')


def models():
    L = nominal_loops()
    M = dict(L1=dict(loop=L['L1'], fx={'exact': L['L1']}, ponly=None),
             L2=dict(loop=L['L2'], fx={'exact': L['L2']}, ponly=make_P_only_L2(L['L2'])),
             L3=dict(loop=L['L3'], fx={'exact': L['L3']}, ponly=make_P_only_L3(L['L3'])))
    return M


DESC = {'L1': 'SSPLL Type-I: L = K z^-1/(1-z^-1)',
        'L2': 'SSPLL Type-II (P+I, PM 60 deg): L = (Kp + Ki/(1-z^-1)) z^-1/(1-z^-1)',
        'L3': 'CPPLL 3rd-order type-II (R + C1 || C2, CT PM 60 deg placement), impulse-invariant sampling'}


def export_hpd(M):
    f_MHz = np.concatenate([np.geomspace(0.1, 100.0, 500, endpoint=False), np.linspace(100.0, 2000.0, 1000)])
    f = f_MHz * 1e6 / F_REF
    for k, d in M.items():
        lp = d['loop']
        H = lp.H(f)
        Lf = lp.L(f)
        T = Lf / (1 + Lf)
        zi = np.exp(-2j * np.pi * f)
        cols = dict(ReH=H.real, ImH=H.imag, absH=np.abs(H), absT=np.abs(T), ReL=Lf.real,
                    ReGamma_1diff=np.real(H * np.conj(1 - zi)),
                    ReGamma_2diff=np.real(H * np.conj((1 - zi) ** 2)),
                    ReGamma_D1=np.real(H / zi),
                    ReGamma_fx_exact=np.abs(H) ** 2)
        if d['ponly'] is not None:
            cols['ReH_Ponly'] = d['ponly'].H(f).real
        s = lp.summary()
        obj = dict(loop=k, description=DESC[k], params=lp.params,
                   f3dB_MHz=r(s['f3dB_MHz'], 9), PM_deg=r(s['PM_deg'], 6), fc_MHz=r(s['fc_MHz'], 6),
                   T_peak_dB=r(s['T_peak_dB'], 5), max_ReH=r(s['max_ReH'], 6),
                   ReH_neg_bands_MHz=[[r(x, 7) for x in b] for b in s['ReH_neg_bands_MHz']],
                   grid_note='f_MHz: 500 log points 0.1-100 MHz + 1000 linear points 100-2000 MHz (= f_ref/2)',
                   columns_note=('ReGamma_* = Re{H_PD conj(G)} of the GMAC regressor pre-filter G: 1diff = 1-z^-1, '
                                 '2diff = (1-z^-1)^2, D1 = z^-1 (one-cycle correlator misalignment), fx_exact = H_PD '
                                 '(filtered-x with an exact model -> |H|^2).  ReH_Ponly = Re H_PD of the P-only loop.'),
                   f_MHz=rl(f_MHz, 6), **{c: rl(v, 6) for c, v in cols.items()})
        dump(f'hpd_{k}.json', obj)


def export_signmaps(M):
    cfg = sim_cfg()
    js = np.arange(1, 2001)
    PQ = []
    for j in js:
        fr = Fraction(2 * int(j) - 1, 8000)
        PQ.append((fr.numerator, fr.denominator))
    assert all(Q % 8 == 0 for _, Q in PQ)
    summary = {}
    for k, d in M.items():
        lp = d['loop']
        cols = {c: [] for c in ('kG', 'kP', 'km1_re', 'km1_im', 'km2_re', 'km2_im', 'km3_re', 'km3_im', 'km4_re',
                                'LSinf', 'LSinf_ac', 'kP_1diff', 'kG_1diff', 'kP_fx', 'kG_fx', 'kP_D1', 'kG_D1',
                                'kP_2diff', 'kP_Ponly', 'kG_Ponly', 'LSinf_Ponly_ac')}
        for (P, Q) in PQ:
            a = kappa_rational(lp, P, Q)
            cols['kG'].append(a['kG'])
            cols['kP'].append(a['kP'])
            for m in range(4):
                cols[f'km{m + 1}_re'].append(a['km'][m].real)
                if m < 3:
                    cols[f'km{m + 1}_im'].append(a['km'][m].imag)
            ls = large_signal_periodic(lp, P / Q, (), cfg, 'raw', PQ=(P, Q), side='right')
            cols['LSinf'].append(kappa_inf_worst(ls))
            ls = large_signal_periodic(lp, P / Q, (), cfg, 'ac', PQ=(P, Q), side='right')
            cols['LSinf_ac'].append(kappa_inf_worst(ls))
            for v, tag in (('1diff', '1diff'), ('fx:exact', 'fx'), ('D:1', 'D1'), ('2diff', '2diff')):
                b = kappa_rational(lp, P, Q, v, d['fx'])
                cols[f'kP_{tag}'].append(b['kP'])
                if f'kG_{tag}' in cols:
                    cols[f'kG_{tag}'].append(b['kG'])
            if d['ponly'] is not None:
                b = kappa_rational(d['ponly'], P, Q)
                cols['kP_Ponly'].append(b['kP'])
                cols['kG_Ponly'].append(b['kG'])
                ls = large_signal_periodic(d['ponly'], P / Q, (), cfg, 'ac', PQ=(P, Q), side='right')
                cols['LSinf_Ponly_ac'].append(kappa_inf_worst(ls))
            else:
                cols['kP_Ponly'].append(np.nan)
                cols['kG_Ponly'].append(np.nan)
                cols['LSinf_Ponly_ac'].append(np.nan)
        f_MHz = (js - 0.5).astype(float)
        arr = {c: np.asarray(v, float) for c, v in cols.items()}
        sm = {}
        for tau in (1e-3, 1e-2):
            sm[f'phos_inverted_MHz_tau{tau:g}'] = intervals(f_MHz.tolist(), (arr['kP'] < -tau).tolist())
            sm[f'gos_inverted_MHz_tau{tau:g}'] = intervals(f_MHz.tolist(), (arr['kG'] < -tau).tolist())
            sm[f'm1_inverted_MHz_tau{tau:g}'] = intervals(f_MHz.tolist(), (arr['km1_re'] < -tau).tolist())
            sm[f'm4_inverted_MHz_tau{tau:g}'] = intervals(f_MHz.tolist(), (arr['km4_re'] < -tau).tolist())
            sm[f'm2_inverted_MHz_tau{tau:g}'] = intervals(f_MHz.tolist(), (arr['km2_re'] < -tau).tolist())
            sm[f'm3_inverted_MHz_tau{tau:g}'] = intervals(f_MHz.tolist(), (arr['km3_re'] < -tau).tolist())
        sm['large_signal_inverted_MHz'] = intervals(f_MHz.tolist(), (arr['LSinf'] < -1e-3).tolist())
        sm['n_large_signal_inverted'] = int(np.sum(arr['LSinf'] < -1e-3))
        sm['n_large_signal_inverted_ac'] = int(np.sum(arr['LSinf_ac'] < -1e-3))
        sm['n_large_signal_inverted_Ponly_ac'] = int(np.nansum(arr['LSinf_Ponly_ac'] < -1e-3)) if d['ponly'] else None
        sm['worst_kP'] = r(np.nanmin(arr['kP']), 5)
        sm['worst_kP_at_MHz'] = float(f_MHz[np.nanargmin(arr['kP'])])
        sm['min_kG'] = r(np.nanmin(arr['kG']), 5)
        sm['min_kG_at_MHz'] = float(f_MHz[np.nanargmin(arr['kG'])])
        for c in ('kP_1diff', 'kG_1diff', 'kP_fx', 'kP_D1', 'kG_D1', 'kP_2diff', 'kP_Ponly', 'kG_Ponly'):
            sm[f'n_inverted_{c}'] = int(np.nansum(arr[c] < -1e-3))
            sm[f'min_{c}'] = r(np.nanmin(arr[c]), 5) if np.isfinite(arr[c]).any() else None
        summary[k] = sm
        print(f'   {k}: worst kP {sm["worst_kP"]} @ {sm["worst_kP_at_MHz"]} MHz; tau1e-2 {sm["phos_inverted_MHz_tau0.01"]}; '
              f'tau1e-3 {sm["phos_inverted_MHz_tau0.001"]}; LS-inf {sm["n_large_signal_inverted"]} (ac {sm["n_large_signal_inverted_ac"]}, '
              f'P-only+ac {sm["n_large_signal_inverted_Ponly_ac"]}); min kG {sm["min_kG"]} @ {sm["min_kG_at_MHz"]}')
        print('       counts:', {q: v for q, v in sm.items() if q.startswith('n_inverted') or q.startswith('min_kP') or q.startswith('min_kG_')})
        obj = dict(loop=k, description=DESC[k],
                   grid=('alpha_j = (2j-1)/8000, j = 1..2000 -> alpha*f_ref = j - 0.5 MHz; exact rational P/Q with 8 | Q '
                         '(uniform PMUX occupancy, circulant PHOS block, GOS-PHOS exactly decoupled); floor convention.  '
                         'Values for 1-alpha are identical (mirror).'),
                   columns=dict(
                       kG='GOS: C_GOS / var(rho) (= 12 C_GOS), raw regressor, D = 0; > 0 restoring',
                       kP='PHOS: min Re eig of C_PHOS on the observable subspace / open-loop reference (= 8 min_m Re lambda_m)',
                       km1_re='mode m: 8 Re lambda_m (DFT mode of the circulant 8x8 PHOS block), m = 1..4',
                       km1_im='8 Im lambda_m (needed for the finite-step criterion Re k > |k|^2/(2 tau))',
                       LSinf=('large signal (A >> sigma_v, 1-bit comparator): worst over {GOS, PHOS m1c, m1s, m2c, m3c, m4} of '
                              '<sgn(h_PD*d_v) z_v>/|<sgn(d_v) x_v>|; simulator physics (a = 0.03, eps seed 7, f_vco 16 GHz illustrative)'),
                       LSinf_ac='same with the GOS regressor mean (1/2) removed',
                       kP_1diff='remedy x[n]-x[n-1]', kP_fx='filtered-x with the exact H_PD model', kP_D1='harmful: correlator one cycle late',
                       kP_2diff='harmful: second difference', kP_Ponly='remedy: integral path held (L2: Type-I K = Kp; L3: C1 >> C2 model)',
                       LSinf_Ponly_ac='large signal for P-only loop + mean-removed GOS regressor'),
                   threshold_note='inverted: kappa < -tau; dead zone: |kappa| <= tau (tau = 1e-3 or 1e-2)',
                   f_MHz=f_MHz.tolist(), **{c: rl(v, 4) for c, v in arr.items()}, summary=sm)
        if d['ponly'] is None:
            for c in ('kP_Ponly', 'kG_Ponly', 'LSinf_Ponly_ac'):
                obj[c] = None
        dump(f'signmap_{k}.json', obj)
    return summary


def export_pred_vs_sim(DN, ref):
    fine_alpha = ref['loops']['L1']['alpha']
    obj = dict(
        description=('Predicted (golden: exact periodic steady state with the simulator physics and 32-bit accumulator side, '
                     'Bussgang-linear) vs simulated (analysis/sspll/sim: time-domain PLL, 2^16-sample records, erf estimator).  '
                     'kP = PHOS min Re eig / same-record open-loop reference; kG = GOS slope / open-loop reference (sim '
                     'normalisation keeps the regressor DC, so 12 C_GOS ~ 4 kG).'),
        selected={k: [{q: (r(v, 6) if isinstance(v, float) else v) for q, v in row.items()} for row in DN['pred_vs_sim'][k]]
                  for k in ('L1', 'L2', 'L3')},
        selected_columns=dict(kP_sim='time-domain sim (erf)', kP_sim_lin='sim, linear estimator', kP_replica='golden replica of the sim protocol',
                              kP_exact_simnorm='exact periodic, sim physics + normalisation', kP_8lam_rational='8 x min Re eig, exact rational, ideal model',
                              kP_8lam_ergodic='ergodic harmonic sum (irrational limit), min over modes', kP_m1_ergodic='mode 1 only',
                              kP_single_line='0.9496 Re H(alpha f_ref)', kG_sim='GOS sim', kG_replica='GOS replica',
                              kG_12C_ergodic='12 C_GOS ergodic (theory normalisation)', LS_kinf_worst='large signal A -> inf'),
        fine=dict(alpha=fine_alpha,
                  **{k: dict(kP_sim=rl(ref['loops'][k]['kP']['raw'], 5), kP_sim_lin=rl(ref['loops'][k]['kP']['raw|lin'], 5),
                             kP_theory=rl(DN['fine'][k]['theory_raw_kP'], 5),
                             kG_sim=rl(ref['loops'][k]['kG']['raw'], 5), kG_theory=rl(DN['fine'][k]['theory_raw_kG'], 5),
                             kP_sim_1diff=rl(ref['loops'][k]['kP']['1diff'], 5), kP_theory_1diff=rl(DN['fine'][k]['theory_1diff_kP'], 5),
                             LSinf_theory=rl(DN['large_signal'][k]['kinf_raw_per_alpha'], 4),
                             LS_sim_A1ps=rl(ref['loops'][k]['LS']['raw']['A=1ps'], 4), LS_sim_A5ps=rl(ref['loops'][k]['LS']['raw']['A=5ps'], 4))
                     for k in ('L1', 'L2', 'L3')}),
        counts={k: {v: {q: x for q, x in s.items() if not q.endswith('intervals_tau0.001')}
                    for v, s in DN['fine'][k]['summary'].items()} for k in ('L1', 'L2', 'L3')},
        large_signal_counts={k: {v: s for v, s in DN['large_signal'][k].items() if v != 'kinf_raw_per_alpha'}
                             for k in ('L1', 'L2', 'L3')},
        lms={key: dict(init_phos_rms_fs=r(v['init_phos_rms_fs'], 4), final_phos_rms_fs=r(v['phos_rms_fs'], 4),
                       max_phos_rms_fs=r(v['phos_rms_max_fs'], 4), final_gos_fs=r(v['gos_fs'], 4),
                       blocks=v['blocks'], phos_rms_med_fs=rl(v['phos_rms_med'], 4), gos_med_fs=rl(v['gos_med'], 4))
             for key, v in DN['lms'].items()},
        lms_note=('closed-loop sign-error block LMS, real 1-bit comparator, sigma_v = 200 fs (illustrative), N = 512, '
                  '6000 blocks, 2 noise lanes, open-loop time constant 25 blocks; values in fs are of the unbounded linear '
                  'model: anything above ~T_vco/8 = 7.8 ps (16 GHz illustrative) means DTC saturation / lock loss in hardware'),
        offset_lms={key: {q: r(x, 4) for q, x in v.items()} for key, v in DN['offset']['lms'].items()},
        offset_neargrid_u100={key: rl(v, 4) for key, v in DN['offset']['lms_neargrid_u100'].items()},
    )
    dump('pred_vs_sim.json', obj)


def export_params(M, DN, smap):
    L = {k: d['loop'] for k, d in M.items()}
    loops = {}
    for k, lp in L.items():
        s = DN['loops'][k]
        loops[k] = dict(description=DESC[k], params=lp.params, f3dB_MHz=s['f3dB_MHz'], PM_deg=s['PM_deg'], fc_MHz=s['fc_MHz'],
                        T_peak_dB=s['T_peak_dB'], max_ReH=s['max_ReH'], ReH_neg_bands_MHz=s['ReH_neg_bands_MHz'],
                        bL=lp.bL.tolist(), aL=lp.aL.tolist())
    obj = dict(
        title='DTC GOS / PMUX PHOS sign-error LMS polarity in SSPLL / CPPLL',
        generated=dict(by='analysis/sspll/golden/tools/export_web_data.py', golden_version=sspll_golden.__version__,
                       date=datetime.date.today().isoformat(), numpy=np.__version__),
        doc='docs/analysis/sspll-gos-phos-polarity.md',
        files=dict(hpd=['hpd_L1.json', 'hpd_L2.json', 'hpd_L3.json'],
                   signmap=['signmap_L1.json', 'signmap_L2.json', 'signmap_L3.json'], pred_vs_sim='pred_vs_sim.json'),
        assumptions=dict(
            f_ref_Hz=4e9, T_ref_ps=250.0, closed_loop_3dB_Hz=320e6, latency='one reference cycle (L strictly proper, h_PD[0] = 1)',
            correlator_delay_D=0, fractional_architecture='8-phase PMUX in the feedback path + input (reference-side) DTC',
            accumulator='first-order, FCW = N_int + alpha, phi[n] = frac(n alpha), p = floor(8 phi), rho = 8 phi - p',
            gos_regressor='rho[n] in [0,1) (non-zero mean 1/2)', phos_regressors='1{p[n] = k}, k = 0..7',
            comparator='q = sign(e_PD + v), v ~ N(0, sigma_v^2), sigma_v = 200 fs (illustrative)',
            lms='sign-error block LMS (GMAC over N = 512 samples)',
            f_vco_Hz_illustrative=16e9, Delta_ps_illustrative=7.8125,
            polarity='update w += mu q r is correct when H_PD == 1 (defines the sign of both injections)',
            linearisation='Bussgang: E[q | e] ~ K_q e, K_q = sqrt(2/pi)/sigma_v, valid for |e| << sigma_v; large signal handled separately',
            sim_physics=dict(a_gos=0.03, eps_ps=sim_cfg()['eps'].tolist(), eps_seed=7, note='used only for pred-vs-sim and large-signal columns'),
            not_modelled=['comparator DC offset (except where stated)', 'DTC INL', 'PVT drift of PMUX offsets', 'LMS word length',
                          'SSPD / DTC range limits', 'FLL interaction', 'PMUX switching glitches', 'MASH / random PMUX rotation theory']),
        conventions=dict(
            H_PD='1/(1+L)', T='L/(1+L)', f_norm='f / f_ref (cycles per sample)', Omega='2 pi f / f_ref',
            Gamma_eff='H_PD(f) conj(G(f)), G = GMAC regressor pre-filter',
            C='C_ij = <r_i (h_PD * x_j)> = sum_lines conj(c_i) c_j Gamma_eff(f_line)',
            convergence='Re eig(C) > 0 on the observable subspace (small mu); finite block step: |1 - kappa/tau| < 1',
            kappa_PHOS='8 min Re lambda (normalised by the open-loop reference 1/8)', kappa_GOS='C_GOS / var(rho) = 12 C_GOS',
            frequency_of_alpha='min(alpha, 1-alpha) f_ref (PMUX rotation frequency)', claim_labels={
                'exact': '精確｜指定模型', 'approx': '近似｜需驗證', 'research': '研究假說'}),
        loops=loops,
        closed_forms=dict(DN['loops']['closed_forms'],
                          L2_f_inv_formula='f_ref/pi * asin(sqrt(Ki/(2(2-Kp))))',
                          L1_ReH_formula='(2-K)(1-cos W)/|1-(1-K)e^{-jW}|^2',
                          L3_minusReL_formula='K/(4 sin^2(W/2)) + B(1-p^2)/(2|1-p e^{-jW}|^2)',
                          W1=W1),
        P_only=DN['loops']['P_only'], typeI_criteria=DN['loops']['typeI_criteria'],
        sensitivity={k: dict(f3dB_MHz=v['f3dB_MHz'], PM_deg=v['PM_deg'], bands=v['bands']) for k, v in DN['loops']['sensitivity'].items()},
        mode1_sure=DN['phos']['mode1_sure'], map_j4096={k: {q: v for q, v in d.items() if q != 'selected'} for k, d in DN['phos']['map_j4096'].items()},
        signmap_summary=smap, remedy_kernels=DN['remedies'],
        gos_small_beta=DN['gos']['small_beta'], gos_rational_scan=DN['gos']['rational_scan'],
        offset=dict(points={k: v for k, v in DN['offset'].items() if '|' in k}, illustrative=DN['offset']['illustrative']))
    dump('params.json', obj)


def main():
    os.makedirs(OUT, exist_ok=True)
    DN = json.load(open(os.path.join(ROOT, 'results', 'doc_numbers.json')))
    ref = json.load(open(os.path.join(ROOT, 'reference', 'sim_fine_reference.json')))
    M = models()
    print('H_PD grids')
    export_hpd(M)
    print('sign maps')
    smap = export_signmaps(M)
    print('pred vs sim')
    export_pred_vs_sim(DN, ref)
    print('params')
    export_params(M, DN, smap)
    with open(os.path.join(ROOT, 'results', 'signmap_summary.json'), 'w') as fh:
        json.dump(smap, fh, indent=1)


if __name__ == '__main__':
    main()
