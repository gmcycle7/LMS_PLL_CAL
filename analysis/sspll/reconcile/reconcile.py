#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reconcile.py -- point-by-point reconciliation of the three independent studies
(analysis/sspll/loops, analysis/sspll/regressors, analysis/sspll/sim) using the
consolidated module sspll_polarity.py.  Read-only with respect to the other folders
(their code is used through unmodified copies in ./_ext, sha256 recorded).

Stages
  S0  model parity (designs / H_PD of all three folders vs sspll_polarity)
  S1  full-precision implementation check: copied sim.measure_S vs deterministic replica
  S2  replica vs stored sim results (fine grid, 500 alpha x 7 regressor variants x lin/erf)
  S3  decomposition sim -> theory (finite record, alpha quantisation side, physical model,
      rational periodicity, normalisation) + sign-classification agreement
  S4  cross-check against loops/lms_alpha_scan.npz and regressors/sign_maps.json
  S5  large-signal (1-bit comparator): replica vs sim, periodic theory, A->inf limit
  S6  remedies: kernel theorems + sign maps; S7 closed-loop sign-LMS spot checks
  S8  closed-form conditions and their numerical verification
  S9  outputs: reconcile_results.json, comparison_fine.csv, comparison_table.md,
      sign_maps_reconciled.json, figures
Run:  python3 reconcile.py            (about 3-6 min on 16 cores)
"""
import os
import sys

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_v, "1")
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SSPLL = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "_ext"))

import json
import math
import time
import hashlib
import multiprocessing as mp
import warnings
import numpy as np
from fractions import Fraction

import sspll_polarity as sp

warnings.filterwarnings("ignore")
F = sp.F_REF
FINE_ALPHAS = [round(0.001 * i, 6) for i in range(1, 501)]
FINE_VARIANTS = ['raw', '1diff', '2diff', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', 'D:1']
EXTRA_VARIANTS = ['D:-1', 'fx:typeI']
LS_VARIANTS = ['raw', 'ac', '1diff', 'fx:exact']
LS_AMPS = [1.0, 5.0]
SIM_KEY = {'L1': 'L1', 'L2': 'L2_pm60', 'L3': 'L3_imp_pm60'}
LOGL = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOGL.append(s)


def jsonable(o):
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return jsonable(o.tolist())
    if isinstance(o, (np.floating,)):
        o = float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, complex):
        return [o.real, o.imag]
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    return o


# --------------------------------------------------------------------------------------
# model set (built once per process)
# --------------------------------------------------------------------------------------
_MODELS = None


def models():
    global _MODELS
    if _MODELS is None:
        L = sp.nominal_loops()
        M = {}
        M['L1'] = dict(loop=L['L1'], models={'exact': L['L1'], 'bw0.8': sp.make_L1(bw=0.8 * sp.BW),
                                              'bw1.2': sp.make_L1(bw=1.2 * sp.BW), 'typeI': L['L1']},
                       ponly=None)
        M['L2'] = dict(loop=L['L2'], models={'exact': L['L2'], 'bw0.8': sp.make_L2(60, bw=0.8 * sp.BW),
                                              'bw1.2': sp.make_L2(60, bw=1.2 * sp.BW), 'typeI': L['L1']},
                       ponly=sp.make_P_only(L['L2']))
        M['L3'] = dict(loop=L['L3'], models={'exact': L['L3'], 'bw0.8': sp.make_L3(60, 'impulse', bw=0.8 * sp.BW),
                                              'bw1.2': sp.make_L3(60, 'impulse', bw=1.2 * sp.BW), 'typeI': L['L1']},
                       ponly=sp.make_L3_P_only(L['L3']))
        _MODELS = M
    return _MODELS


def _pk(a):
    """compact: gos, phos_min_re, joint_min_re, dft mode gains."""
    return dict(gos=a['gos'], phos=a['phos_min_re'], joint=a['joint_min_re'],
                m=[a['phos_dft_mode_gain'][f'm{k}'] for k in range(1, 5)])


# --------------------------------------------------------------------------------------
# S2/S3/S5 worker: everything for one (loop, alpha) of the fine grid
# --------------------------------------------------------------------------------------

def task_fine(args):
    key, alpha = args
    M = models()[key]
    loop, mods = M['loop'], M['models']
    cfg = sp.sim_cfg()
    out = dict(key=key, alpha=alpha)
    rep = sp.replica_S(loop, alpha, FINE_VARIANTS, cfg, N_rec=1 << 16, N_settle=1 << 12, models=mods)
    out['rep'] = {v: {e: _pk(rep[v][e]) for e in ('lin', 'erf')} for v in FINE_VARIANTS}
    out['rep_ol'] = {e: _pk(rep['open_loop'][e]) for e in ('lin', 'erf')}
    # exact periodic, simulator physics, same accumulator side
    th = {}
    for v in FINE_VARIANTS + EXTRA_VARIANTS:
        t = sp.theory_point(loop, alpha, v, mods, cfg, side='auto')
        th[v] = _pk(t)
    out['th_auto_phys'] = th
    out['th_auto_phys_ol'] = dict(gos=t['open_loop']['gos'], phos=t['open_loop']['phos_min_re'])
    out['PQ'] = [t['P'], t['Q'], t['side']]
    t = sp.theory_point(loop, alpha, 'raw', mods, cfg, side='right')
    out['th_right_phys'] = _pk(t)
    t = sp.theory_point(loop, alpha, 'raw', mods, None, side='right')
    out['th_right_ideal'] = _pk(t)
    out['th_right_ideal_ol'] = dict(gos=t['open_loop']['gos'], phos=t['open_loop']['phos_min_re'],
                                    var_c=t['var_c'], mean_c=t['mean_c'])
    if M['ponly'] is not None:
        out['th_ponly'] = _pk(sp.theory_point(M['ponly'], alpha, 'raw', mods, cfg, side='auto'))
    # ergodic / irrational-alpha harmonic theory (ideal model)
    G = sp.gamma_eff(loop, 'raw')
    lam = sp.phos_lambda_harmonic(alpha, G)
    out['harm'] = dict(gos=sp.gos_harmonic(alpha, G), lam_re=[float(x) for x in lam.real[1:5]],
                       phos_min=float(lam.real[1:].min()), single_line=sp.single_line_phos(alpha, G))
    # large signal: finite-record replica (sim's exact protocol) and periodic exact + A->inf
    rd = sp.replica_dir(loop, alpha, LS_AMPS, cfg, LS_VARIANTS, mods, N_rec=1 << 15, N_settle=1 << 12)
    out['ls_rep'] = rd
    per = {}
    for v in ['raw', 'ac', '1diff', 'fx:exact']:
        pp = sp.large_signal_periodic(loop, alpha, LS_AMPS, cfg, v, mods, side='auto')
        per[v] = {nm: dict(g=pp[nm]['g'], g0=pp[nm]['g_open_loop'], kinf=pp[nm]['kappa_inf'], lin=pp[nm]['lin'])
                  for nm in pp if nm != '_meta'}
    out['ls_per'] = per
    if M['ponly'] is not None:
        pp = sp.large_signal_periodic(M['ponly'], alpha, LS_AMPS, cfg, 'raw', mods, side='auto')
        out['ls_ponly'] = {nm: dict(kinf=pp[nm]['kappa_inf']) for nm in pp if nm != '_meta'}
        pp = sp.large_signal_periodic(M['ponly'], alpha, LS_AMPS, cfg, 'ac', mods, side='auto')
        out['ls_ponly_ac'] = {nm: dict(kinf=pp[nm]['kappa_inf']) for nm in pp if nm != '_meta'}
    return out


# --------------------------------------------------------------------------------------
# dense sign-map worker (ideal model, exact rational alpha = j/4096, floor convention)
# --------------------------------------------------------------------------------------
MAP_VARIANTS = ['raw', 'D:1', 'D:-1', '1diff', '2diff', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', 'fx:typeI']


def task_map(args):
    key, j = args
    M = models()[key]
    loop, mods = M['loop'], M['models']
    alpha = j / 4096
    out = dict(key=key, j=j)
    for v in MAP_VARIANTS:
        t = sp.theory_point(loop, alpha, v, mods, None, side='right')
        out[v] = dict(gos=t['gos'], phos=t['phos_min_re'], joint=t['joint_min_re'],
                      m=[t['phos_dft_mode_gain'][f'm{k}'] for k in range(1, 5)])
    out['ol'] = dict(gos=t['open_loop']['gos'], phos=t['open_loop']['phos_min_re'], var_c=t['var_c'],
                     n_obs=t['phos_n_obs'])
    if M['ponly'] is not None:
        t = sp.theory_point(M['ponly'], alpha, 'raw', mods, None, side='right')
        out['ponly'] = dict(gos=t['gos'], phos=t['phos_min_re'], joint=t['joint_min_re'])
    ls = {}
    for v in ['raw', 'ac', '1diff', 'fx:exact']:
        pp = sp.large_signal_periodic(loop, alpha, [5.0], sp.sim_cfg(), v, mods, side='right')
        ls[v] = {nm: pp[nm]['kappa_inf'] for nm in pp if nm != '_meta'}
    out['ls_kinf'] = ls
    if M['ponly'] is not None:
        pp = sp.large_signal_periodic(M['ponly'], alpha, [5.0], sp.sim_cfg(), 'raw', mods, side='right')
        out['ls_kinf_ponly'] = {nm: pp[nm]['kappa_inf'] for nm in pp if nm != '_meta'}
        pp = sp.large_signal_periodic(M['ponly'], alpha, [5.0], sp.sim_cfg(), 'ac', mods, side='right')
        out['ls_kinf_ponly_ac'] = {nm: pp[nm]['kappa_inf'] for nm in pp if nm != '_meta'}
    return out


# --------------------------------------------------------------------------------------
# LMS worker
# --------------------------------------------------------------------------------------

def task_lms(args):
    tag, key, alpha, variant, use_ponly, n_blocks, seed = args
    M = models()[key]
    loop = M['ponly'] if use_ponly else M['loop']
    t0 = time.time()
    r = sp.run_sign_lms(loop, alpha, variant, sp.sim_cfg(), n_blocks=n_blocks, N_blk=512, seed=seed,
                        models=M['models'], lanes=2, rec_every=20)
    ph = np.array(r['phos_rms_fs'])
    go = np.abs(np.array(r['gos_err_fs']))
    m = len(ph)
    tail = slice(int(0.9 * m), m)
    return dict(tag=tag, key=key, alpha=alpha, variant=variant, ponly=use_ponly, n_blocks=n_blocks,
                phos_init_fs=float(ph[0].mean()), phos_final_med_fs=float(np.median(ph[tail])),
                phos_max_fs=float(ph.max()), gos_final_med_fs=float(np.median(go[tail])),
                gos_max_fs=float(go.max()), time_s=time.time() - t0,
                trace_block=r['block'][::5], trace_phos_fs=ph[::5].mean(axis=1).tolist())


# ======================================================================================
# helpers
# ======================================================================================

def intervals(x, mask):
    out = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            out.append([x[i], x[j]])
            i = j + 1
        else:
            i += 1
    return out


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


# ======================================================================================
# S0 model parity
# ======================================================================================

def stage0():
    log("\n[S0] model parity")
    import loops_copy as LP
    import corr_copy as CR
    import sim_copy as SM
    M = models()
    res = {}
    f = np.linspace(1e-4, 0.5, 4001)
    fhz = f * F
    mine = {k: M[k]['loop'] for k in M}
    ref_loops = {'L1': LP.L1_typeI(), 'L2': LP.L2_typeII(pm_deg=60.0),
                 'L3': LP.L3_cppll(pm_deg=60.0, mapping='impulse', pm_domain='ct')}
    ref_corr = {'L1': CR.make_type1(lat=1.0), 'L2': CR.make_type2(lat=1.0, pm_target=60.0)}
    t0 = time.time()
    ref_sim = {'L1': SM.design_L1(1, None), 'L2': SM.design_L2(60, 1), 'L3': SM.design_L3(60, 'imp')}
    log("   sim designs re-run in %.1fs" % (time.time() - t0))
    for k in ('L1', 'L2', 'L3'):
        H = mine[k].H(f)
        d = {'params_mine': mine[k].params}
        d['loops_maxdiff_Hpd'] = float(np.max(np.abs(ref_loops[k].Hpd(fhz) - H)))
        d['loops_params'] = {q: v for q, v in ref_loops[k].params.items() if isinstance(v, (int, float))}
        if k in ref_corr:
            d['regressors_maxdiff_Hpd'] = float(np.max(np.abs(ref_corr[k].H(f) - H)))
        Ls = SM.L_resp(ref_sim[k], fhz)
        d['sim_maxdiff_Hpd'] = float(np.max(np.abs(1 / (1 + Ls) - H)))
        d['sim_meta'] = {q: (float(v) if isinstance(v, (float, np.floating)) else v) for q, v in ref_sim[k]['meta'].items()}
        s = mine[k].summary()
        d['summary'] = {q: s[q] for q in ('f3dB_MHz', 'fc_MHz', 'PM_deg', 'T_peak_dB', 'ReH_neg_bands_MHz',
                                          'max_pole_mag', 'S_inf')}
        res[k] = d
        log(f"   {k}: max|dH| vs loops {d['loops_maxdiff_Hpd']:.2e}, vs regressors "
            f"{d.get('regressors_maxdiff_Hpd', float('nan')):.2e}, vs sim {d['sim_maxdiff_Hpd']:.2e} | "
            f"f3dB {s['f3dB_MHz']:.6f} MHz PM {s['PM_deg']:.3f} band {np.round(s['ReH_neg_bands_MHz'], 4).tolist()}")
    # sim's 0.8x/1.2x models (stored, 6 significant digits)
    R = json.load(open(os.path.join(SSPLL, 'sim', 'results.json')))
    bwchk = {}
    for k in ('L1', 'L2', 'L3'):
        for tag, mk in (('model_bw0p8', 'bw0.8'), ('model_bw1p2', 'bw1.2')):
            meta = R['loops'][SIM_KEY[k]][tag]['meta']
            p = M[k]['models'][mk].params
            if k == 'L1':
                rel = abs(meta['K'] / p['K'] - 1)
            elif k == 'L2':
                rel = max(abs(meta['Kp'] / p['Kp'] - 1), abs(meta['Ki'] / p['Ki'] - 1))
            else:
                rel = abs(meta['wc_rad_per_Tref'] / p['wc'] - 1)
            bwchk[f'{k}_{mk}'] = rel
    res['sim_bw_models_max_rel_param_diff'] = bwchk
    log("   sim 0.8x/1.2x model params vs mine (rel, sim stored to 6 digits):",
        {k: f"{v:.1e}" for k, v in bwchk.items()})
    # the regressors' CPPLL (different design!): reproduce its band with my L3 builder
    cp = CR.make_cppll(pm_target=55.0, tau=0.0)
    b_mine = cp.params['b'] ** 2              # corr: wz = wc/b, wp = wc b   <->  mine: wz = wc/sqrt(b)
    myc = sp.make_L3(b=b_mine, mapping='impulse')
    d_cp = float(np.max(np.abs(cp.H(f) - myc.H(f))))
    res['regressors_CP_pm55'] = dict(b_corr=cp.params['b'], b_mine=b_mine, maxdiff_Hpd=d_cp,
                                     band_MHz=myc.summary()['ReH_neg_bands_MHz'],
                                     PM_deg=myc.summary()['PM_deg'])
    log(f"   regressors' CP_pm55 (a DIFFERENT CPPLL, b_mine={b_mine:.3f}, DT PM {myc.summary()['PM_deg']:.2f}) "
        f"rebuilt: max|dH| {d_cp:.1e}, band {np.round(myc.summary()['ReH_neg_bands_MHz'], 3).tolist()}")
    res['sha256_ext'] = {p: sha(os.path.join(HERE, '_ext', p)) for p in sorted(os.listdir(os.path.join(HERE, '_ext')))
                         if p.endswith('.py')}
    res['sha256_orig'] = {p: sha(os.path.join(SSPLL, p)) for p in ('loops/loops.py', 'regressors/corr.py', 'sim/sim.py')}
    return res


# ======================================================================================
# S1 full-precision implementation check against the copied simulator
# ======================================================================================

def stage1():
    log("\n[S1] full-precision: copied sim.measure_S vs deterministic replica")
    import sim_copy as SM
    cfg_s = SM.make_cfg()
    cfg = sp.sim_cfg()
    assert np.allclose(cfg_s['eps'], cfg['eps'], atol=0, rtol=0)
    M = models()
    alphas = [0.004, 0.01, 0.02, 0.122, 0.137, 0.253]
    variants = ['raw', '1diff', 'D:1', 'fx:exact']
    k = cfg['sigma'] / math.sqrt(2 / math.pi)
    out = {}
    for key, sk in SIM_KEY.items():
        des = {'L1': lambda: SM.design_L1(1, None), 'L2': lambda: SM.design_L2(60, 1),
               'L3': lambda: SM.design_L3(60, 'imp')}[key]()
        res = SM.measure_S(des, alphas, cfg_s, N_rec=1 << 16, N_settle=1 << 12, chunk=512, n_super=8,
                           variants=variants, estimators=('erf', 'lin'), models={'exact': des})
        md = 0.0
        rows = []
        for ai, a in enumerate(alphas):
            rep = sp.replica_S(M[key]['loop'], a, variants, cfg, N_rec=1 << 16, N_settle=1 << 12,
                               models={'exact': M[key]['loop']})
            for vi, v in enumerate(variants):
                for ei, e in enumerate(('erf', 'lin')):
                    Sm = res['S'][:, vi, ei, ai].mean(axis=0) * k
                    s = SM.analyse_S(Sm, res['cov'][ai])
                    r = rep[v][e]
                    dd = max(abs(s['mS_gg'] - r['gos']), abs(s['phos_min_re'] - r['phos_min_re']),
                             abs(s['joint_min_re'] - r['joint_min_re']))
                    md = max(md, dd)
                    rows.append([a, v, e, s['mS_gg'], r['gos'], s['phos_min_re'], r['phos_min_re']])
        out[key] = dict(max_abs_diff=md, rows=rows)
        log(f"   {key}: max |sim - replica| over {len(alphas)} alpha x {len(variants)} variants x 2 est = {md:.2e}")
    return out


# ======================================================================================
# S2 + S3 + S5 on the fine grid
# ======================================================================================

def stage_fine(pool):
    log("\n[S2/S3/S5] fine grid (500 alpha x 3 loops)")
    t0 = time.time()
    tasks = [(k, a) for k in ('L1', 'L2', 'L3') for a in FINE_ALPHAS]
    res = pool.map(task_fine, tasks, chunksize=4)
    log("   computed in %.0fs" % (time.time() - t0))
    out = {k: [r for r in res if r['key'] == k] for k in ('L1', 'L2', 'L3')}
    return out


def analyse_fine(FD):
    R = json.load(open(os.path.join(SSPLL, 'sim', 'results.json')))
    summ = {}
    rows_csv = []
    for key, rs in FD.items():
        fs = R['fine'][SIM_KEY[key]]
        lsf = R['large_signal_fine'][SIM_KEY[key]]
        al = np.array(fs['alpha'])
        assert np.allclose(al, FINE_ALPHAS)
        n = len(al)
        # ---------------- S2: replica vs stored sim ----------------
        md = {}
        for v in FINE_VARIANTS:
            for e in ('lin', 'erf'):
                sv = fs['variants'][v][e]
                for q, qs in (('gos', 'mS_gg'), ('phos', 'phos_min_re'), ('joint', 'joint_min_re')):
                    a = np.array([np.nan if x is None else x for x in sv[qs]], float)
                    b = np.array([r['rep'][v][e][q] for r in rs], float)
                    ok = np.isfinite(a) & np.isfinite(b)
                    rel = np.abs(a[ok] - b[ok]) / np.maximum(np.abs(a[ok]), 1e-4)
                    md[f'{v}|{e}|{q}'] = dict(max_abs=float(np.max(np.abs(a[ok] - b[ok]))) if ok.any() else None,
                                              max_rel=float(rel.max()) if ok.any() else None,
                                              nan_mismatch=int(np.sum(np.isfinite(a) != np.isfinite(b))))
        ol_g = np.array(fs['open_loop_H1']['mS_gg'], float)
        ol_p = np.array(fs['open_loop_H1']['phos_min_re'], float)
        rep_olg = np.array([r['rep_ol']['erf']['gos'] for r in rs])
        rep_olp = np.array([r['rep_ol']['erf']['phos'] for r in rs])
        md['open_loop'] = dict(gos=float(np.nanmax(np.abs(ol_g - rep_olg))), phos=float(np.nanmax(np.abs(ol_p - rep_olp))))
        worst = max(v['max_abs'] for k_, v in md.items() if k_ != 'open_loop' and v['max_abs'] is not None)
        log(f"   [S2] {key}: replica vs stored sim: max abs diff over all variants/estimators/quantities = {worst:.2e}; "
            f"open-loop {md['open_loop']}")
        # ---------------- S3: decomposition chain (raw, PHOS & GOS) ----------------
        sim_erf_p = np.array(fs['variants']['raw']['erf']['phos_min_re'], float)
        sim_lin_p = np.array(fs['variants']['raw']['lin']['phos_min_re'], float)
        sim_erf_g = np.array([np.nan if x is None else x for x in fs['variants']['raw']['erf']['mS_gg']], float)
        sim_lin_g = np.array([np.nan if x is None else x for x in fs['variants']['raw']['lin']['mS_gg']], float)
        rep_p = np.array([r['rep']['raw']['lin']['phos'] for r in rs])
        rep_g = np.array([r['rep']['raw']['lin']['gos'] for r in rs], float)
        ta_p = np.array([r['th_auto_phys']['raw']['phos'] for r in rs])
        ta_g = np.array([r['th_auto_phys']['raw']['gos'] for r in rs], float)
        tr_p = np.array([r['th_right_phys']['phos'] for r in rs])
        tr_g = np.array([r['th_right_phys']['gos'] for r in rs], float)
        ti_p = np.array([r['th_right_ideal']['phos'] for r in rs])
        ti_g = np.array([r['th_right_ideal']['gos'] for r in rs], float)
        h_p = np.array([r['harm']['phos_min'] for r in rs])
        h_m1 = np.array([r['harm']['lam_re'][0] for r in rs])
        h_g = np.array([r['harm']['gos'] for r in rs])
        sl = np.array([r['harm']['single_line'] for r in rs])
        ol_ta_p = np.array([r['th_auto_phys_ol']['phos'] for r in rs])
        ol_ta_g = np.array([r['th_auto_phys_ol']['gos'] for r in rs])
        varc = np.array([r['th_right_ideal_ol']['var_c'] for r in rs])
        Q = np.array([r['PQ'][1] for r in rs])
        side = [r['PQ'][2] for r in rs]
        circ = (Q % 8 == 0)

        def mx(x):
            x = np.asarray(x, float)
            return float(np.nanmax(np.abs(x))) if np.any(np.isfinite(x)) else None
        dec = dict(
            est_erf_minus_lin_phos=mx(sim_erf_p - sim_lin_p), est_erf_minus_lin_gos=mx(sim_erf_g - sim_lin_g),
            finite_record_phos=mx(rep_p - ta_p), finite_record_gos=mx(rep_g - ta_g),
            acc_side_phos=mx(ta_p - tr_p), acc_side_gos=mx(ta_g - tr_g),
            n_left_side=int(sum(s == 'left' for s in side)),
            physical_model_phos=mx(tr_p - ti_p), physical_model_gos=mx(tr_g - ti_g),
            physical_model_gos_rel=mx((tr_g - ti_g) / np.where(np.abs(ti_g) > 1e-6, ti_g, np.nan)),
            rational_vs_ergodic_phos_8divQ=mx((ti_p - h_p)[circ]), rational_vs_ergodic_phos_8notdivQ=mx((ti_p - h_p)[~circ]),
            rational_vs_ergodic_gos=mx(ti_g - h_g),
            n_8divQ=int(circ.sum()))
        log(f"   [S3] {key} decomposition (max abs, un-normalised):", {k_: (f"{v:.2e}" if isinstance(v, float) else v) for k_, v in dec.items()})
        # normalisations
        kap_sim_p = sim_erf_p / ol_p
        kap_sim_g = sim_erf_g / ol_g
        kap_th_p = 8 * h_p                      # theory convention (ideal ref 1/8)
        kap_th_g = 12 * h_g                     # theory convention (ref var rho = 1/12)
        kap_ta_p = ta_p / ol_ta_p               # sim convention, exact periodic
        kap_ta_g = ta_g / ol_ta_g
        ratio_g = kap_th_g / kap_sim_g
        dec['gos_norm_ratio_12C_over_kappa_sim'] = dict(median=float(np.nanmedian(ratio_g)),
                                                        p05=float(np.nanpercentile(ratio_g, 5)),
                                                        p95=float(np.nanpercentile(ratio_g, 95)))
        dec['phos_norm_ratio_8lam_over_kappa_sim_8divQ'] = float(np.nanmedian((kap_th_p / kap_sim_p)[circ & (np.abs(kap_sim_p) > 0.01)]))
        dec['open_loop_phos_ref_8notdivQ_min'] = float(np.nanmin(ol_p[~circ]))
        log(f"       GOS normalisation 12*C_GOS / kappa_GOS(sim): median {dec['gos_norm_ratio_12C_over_kappa_sim']['median']:.3f} "
            f"(theory: (1/3)/(1/12)/(1-a)... see text)")
        # sign classification agreement
        cls = {}
        for tau in (1e-3, 1e-2):
            def c3(x):
                return np.where(x < -tau, -1, np.where(x > tau, 1, 0))
            A = c3(kap_sim_p)
            B = c3(kap_th_p)
            Cc = c3(kap_ta_p)
            Bm = c3(8 * h_m1)
            cls[f'tau={tau:g}'] = dict(
                phos_sim_vs_ergodic_disagree=int(np.sum(A != B)), phos_sim_vs_exact_periodic_disagree=int(np.sum(A != Cc)),
                phos_sim_vs_ergodic_mode1only_disagree=int(np.sum(A != Bm)),
                phos_sim_inverted=intervals(FINE_ALPHAS, (A < 0).tolist()),
                phos_ergodic_inverted=intervals(FINE_ALPHAS, (B < 0).tolist()),
                phos_exact_periodic_inverted=intervals(FINE_ALPHAS, (Cc < 0).tolist()),
                phos_ergodic_mode1_inverted=intervals(FINE_ALPHAS, (Bm < 0).tolist()),
                gos_sim_inverted=int(np.sum(kap_sim_g < -tau)), gos_theory_inverted=int(np.sum(kap_th_g < -tau)),
                disagree_alphas=[FINE_ALPHAS[i] for i in np.nonzero(A != B)[0]])
        dec['classification'] = cls
        for tau in (1e-3, 1e-2):
            c = cls[f'tau={tau:g}']
            log(f"       tau={tau:g}: PHOS class disagreements sim-vs-ergodic {c['phos_sim_vs_ergodic_disagree']}, "
                f"sim-vs-exact-periodic {c['phos_sim_vs_exact_periodic_disagree']}; sim inverted {c['phos_sim_inverted']}; "
                f"ergodic {c['phos_ergodic_inverted']}; ergodic m1-only {c['phos_ergodic_mode1_inverted']}; "
                f"GOS inverted sim/theory {c['gos_sim_inverted']}/{c['gos_theory_inverted']}")
        i_ws = int(np.nanargmin(kap_sim_p))
        i_wt = int(np.nanargmin(kap_th_p))
        dec['worst'] = dict(sim=[FINE_ALPHAS[i_ws], float(kap_sim_p[i_ws])],
                            exact_periodic_simnorm=[FINE_ALPHAS[i_ws], float(kap_ta_p[i_ws])],
                            exact_ideal_8lam_at_sim_worst=float(8 * ti_p[i_ws]),
                            ergodic=[FINE_ALPHAS[i_wt], float(kap_th_p[i_wt])])
        log(f"       worst PHOS: sim {dec['worst']['sim']}, exact periodic (sim norm) {kap_ta_p[i_ws]:.5f}, "
            f"8*lam exact ideal {8 * ti_p[i_ws]:.5f}, ergodic worst {dec['worst']['ergodic']}")
        # ---------------- variants: sim vs theory counts ----------------
        var_cmp = {}
        for v in FINE_VARIANTS:
            sp_ = np.array(fs['variants'][v]['erf']['phos_min_re'], float) / ol_p
            sg_ = np.array([np.nan if x is None else x for x in fs['variants'][v]['erf']['mS_gg']], float) / ol_g
            sj_ = np.array(fs['variants'][v]['erf']['joint_min_re'], float)
            tp_ = np.array([r['th_auto_phys'][v]['phos'] for r in rs]) / ol_ta_p
            tg_ = np.array([r['th_auto_phys'][v]['gos'] for r in rs], float) / ol_ta_g
            tj_ = np.array([r['th_auto_phys'][v]['joint'] for r in rs])
            tolp = 1e-3 * np.nanmedian(np.abs(ol_p))
            tolg = 1e-3 * np.nanmedian(np.abs(ol_g))
            var_cmp[v] = dict(
                sim_phos_inv=int(np.sum(sp_ < -1e-3)), th_phos_inv=int(np.sum(tp_ < -1e-3)),
                sim_gos_inv=int(np.sum(sg_ < -1e-3)), th_gos_inv=int(np.sum(tg_ < -1e-3)),
                sim_joint_inv=int(np.sum(sj_ < -min(tolp, tolg))), th_joint_inv=int(np.sum(tj_ < -min(tolp, tolg))),
                sim_phos_min=float(np.nanmin(sp_)), th_phos_min=float(np.nanmin(tp_)),
                sim_gos_min=float(np.nanmin(sg_)), th_gos_min=float(np.nanmin(tg_)),
                max_abs_kappa_diff_phos=float(np.nanmax(np.abs(sp_ - tp_))))
        for v in EXTRA_VARIANTS:
            tp_ = np.array([r['th_auto_phys'][v]['phos'] for r in rs]) / ol_ta_p
            tg_ = np.array([r['th_auto_phys'][v]['gos'] for r in rs], float) / ol_ta_g
            var_cmp[v] = dict(th_phos_inv=int(np.sum(tp_ < -1e-3)), th_gos_inv=int(np.sum(tg_ < -1e-3)),
                              th_phos_min=float(np.nanmin(tp_)), th_gos_min=float(np.nanmin(tg_)))
        if 'th_ponly' in rs[0]:
            tp_ = np.array([r['th_ponly']['phos'] for r in rs]) / ol_ta_p
            tg_ = np.array([r['th_ponly']['gos'] for r in rs], float) / ol_ta_g
            var_cmp['P-only loop'] = dict(th_phos_inv=int(np.sum(tp_ < -1e-3)), th_gos_inv=int(np.sum(tg_ < -1e-3)),
                                          th_phos_min=float(np.nanmin(tp_)), th_gos_min=float(np.nanmin(tg_)))
        dec['variants'] = var_cmp
        log(f"   [S3] {key} variants (#alpha inverted /500, kappa<-1e-3; sim vs theory):")
        for v, d in var_cmp.items():
            log("       %-10s" % v, {k_: (round(x, 4) if isinstance(x, float) else x) for k_, x in d.items()})
        # ---------------- S5 large signal ----------------
        dirs = lsf['dirs']
        g_sim = {v: np.array(lsf['g'][v]['erf'], float) for v in LS_VARIANTS}
        go_sim = np.array(lsf['g_open_loop']['erf'], float)
        lsd = {}
        mdiff = 0.0
        for v in LS_VARIANTS:
            g_rep = np.array([[r['ls_rep']['g'][v][d] for d in dirs] for r in rs])
            mdiff = max(mdiff, float(np.nanmax(np.abs(g_rep - g_sim[v]))))
        go_rep = np.array([[r['ls_rep']['g_open_loop'][d] for d in dirs] for r in rs])
        mdiff = max(mdiff, float(np.nanmax(np.abs(go_rep - go_sim))))
        lsd['replica_vs_sim_max_abs'] = mdiff
        goa = np.abs(go_sim)
        for v in LS_VARIANTS:
            gn_sim = np.where(goa > 1e-6 * np.nanmax(goa), g_sim[v] / goa, np.nan)
            g_per = np.array([[r['ls_per'][v][d]['g'] for d in dirs] for r in rs])
            g0_per = np.abs(np.array([[r['ls_per'][v][d]['g0'] for d in dirs] for r in rs]))
            gn_per = np.where(g0_per > 1e-6 * np.nanmax(g0_per), g_per / g0_per, np.nan)
            kinf = np.array([[r['ls_per'][v][d]['kinf'] for d in dirs] for r in rs], float)
            dd = {}
            for ai_, A in enumerate(LS_AMPS):
                ws = np.nanmin(gn_sim[:, :, ai_], axis=1)
                wp = np.nanmin(gn_per[:, :, ai_], axis=1)
                dd[f'A={A:g}ps'] = dict(sim_inverted=int(np.sum(ws < -1e-3)), periodic_inverted=int(np.sum(wp < -1e-3)),
                                       disagree=int(np.sum((ws < -1e-3) != (wp < -1e-3))),
                                       sim_intervals=intervals(FINE_ALPHAS, (ws < -1e-3).tolist()),
                                       periodic_intervals=intervals(FINE_ALPHAS, (wp < -1e-3).tolist()),
                                       sim_worst=float(np.nanmin(ws)), periodic_worst=float(np.nanmin(wp)))
            wk = np.nanmin(kinf, axis=1)
            dd['A=inf'] = dict(inverted=int(np.sum(wk < -1e-3)), intervals=intervals(FINE_ALPHAS, (wk < -1e-3).tolist()),
                               worst=float(np.nanmin(wk)), worst_alpha=FINE_ALPHAS[int(np.nanargmin(wk))],
                               per_dir_inverted={d: int(np.sum(kinf[:, di] < -1e-3)) for di, d in enumerate(dirs)})
            lsd[v] = dd
        for tagp, kk_ in (('P-only loop', 'ls_ponly'), ('P-only loop + ac', 'ls_ponly_ac')):
            if kk_ not in rs[0]:
                continue
            kinf = np.array([[r[kk_][d]['kinf'] for d in dirs] for r in rs], float)
            wk = np.nanmin(kinf, axis=1)
            lsd[tagp] = {'A=inf': dict(inverted=int(np.sum(wk < -1e-3)), intervals=intervals(FINE_ALPHAS, (wk < -1e-3).tolist()),
                                       worst=float(np.nanmin(wk)),
                                       per_dir_inverted={d: int(np.sum(kinf[:, di] < -1e-3)) for di, d in enumerate(dirs)})}
        log(f"   [S5] {key} large signal: replica vs sim max abs {mdiff:.2e}")
        for v in LS_VARIANTS + [q for q in ('P-only loop', 'P-only loop + ac') if q in lsd]:
            log("       %-11s" % v, {A: {q: x for q, x in d.items() if q in ('sim_inverted', 'periodic_inverted', 'disagree', 'inverted', 'worst', 'sim_worst', 'periodic_worst')}
                                   for A, d in lsd[v].items()})
        dec['large_signal'] = lsd
        dec['replica_vs_sim'] = md
        summ[key] = dec
        # ---------------- csv rows ----------------
        for i, a in enumerate(FINE_ALPHAS):
            rows_csv.append([key, a, int(Q[i]), side[i], kap_sim_p[i], sim_lin_p[i] / ol_p[i], rs[i]['rep']['raw']['erf']['phos'] / rep_olp[i],
                             kap_ta_p[i], 8 * ti_p[i], 8 * h_p[i], 8 * h_m1[i], sl[i],
                             kap_sim_g[i], kap_ta_g[i], 12 * ti_g[i] / (12 * varc[i]) if varc[i] > 1e-12 else np.nan, 12 * h_g[i],
                             float(np.nanmin([rs[i]['ls_per']['raw'][d]['kinf'] for d in dirs]))])
    return summ, rows_csv


# ======================================================================================
# S4 cross-check against the other folders' own grids
# ======================================================================================

def stage4():
    log("\n[S4] cross-check against loops/lms_alpha_scan.npz and regressors/sign_maps.json")
    M = models()
    out = {}
    d = np.load(os.path.join(SSPLL, 'loops', 'lms_alpha_scan.npz'))
    jj = d['j']
    sel = jj[::8]
    for key in ('L1', 'L2', 'L3'):
        g_l = d[f'{key}_gos']
        p_l = d[f'{key}_phos']
        dg, dp = [], []
        for j in sel:
            t = sp.theory_point(M[key]['loop'], j / 4096, 'raw', None, None, side='right')
            if np.isfinite(g_l[j - 1]) and t['var_c'] > 1e-12:
                dg.append(abs(t['gos'] / t['var_c'] - g_l[j - 1]))
            if np.isfinite(p_l[j - 1]) and np.isfinite(t['phos_min_re']):
                dp.append(abs(t['phos_min_re'] - p_l[j - 1]))
        out[f'loops_{key}'] = dict(n=len(sel), max_abs_gos=float(max(dg)), max_abs_phos=float(max(dp)))
        log(f"   loops {key}: {len(sel)} alpha=j/4096: max|g_eff diff| {max(dg):.1e}, max|PHOS min eig diff| {max(dp):.1e}")
    S = json.load(open(os.path.join(SSPLL, 'regressors', 'sign_maps.json')))
    al = np.array(S['alpha'])
    idx = np.arange(0, len(al), 16)
    for mk, key, var in (('T1_lat1_D0', 'L1', 'raw'), ('T2_pm60_lat1_D0', 'L2', 'raw'),
                         ('T2_pm60_lat1_Dp1', 'L2', 'D:1'), ('T2_pm60_lat1_Dm1', 'L2', 'D:-1'), ('T1_lat1_Dp1', 'L1', 'D:1')):
        mp_ = S['maps'][mk]
        dg, dl = [], []
        for i in idx:
            a = al[i]
            fr = Fraction(int(round(a * 4096)), 4096)
            C, cov, mu = sp.C_periodic(fr.numerator, fr.denominator, sp.gamma_eff(M[key]['loop'], var), 'right', True)
            dg.append(abs(C[0, 0] - mp_['C_gos'][i]))
            modes = sp.analyse_C(C, cov)['phos_dft_mode_gain']
            for m in range(4):
                dl.append(abs(modes[f'm{m + 1}'] - mp_['re_lam'][m][i]))
        out[f'regressors_{mk}'] = dict(n=len(idx), max_abs_gos=float(max(dg)), max_abs_lam=float(max(dl)))
        log(f"   regressors {mk}: {len(idx)} alpha: max|C_gos diff| {max(dg):.1e}, max|Re lam_m diff| {max(dl):.1e} (their values rounded to 5 sig.)")
    return out


# ======================================================================================
# S6 dense sign maps (ideal model) + remedy kernels
# ======================================================================================

def stage_maps(pool):
    log("\n[S6] dense sign maps alpha = j/4096 (ideal model, floor convention)")
    t0 = time.time()
    tasks = [(k, j) for k in ('L1', 'L2', 'L3') for j in range(1, 2049)]
    res = pool.map(task_map, tasks, chunksize=8)
    log("   computed in %.0fs" % (time.time() - t0))
    M = models()
    maps = {}
    for key in ('L1', 'L2', 'L3'):
        rs = [r for r in res if r['key'] == key]
        al = np.array([r['j'] / 4096 for r in rs])
        fo = (np.minimum(al, 1 - al) * F / 1e6).tolist()
        ol_p = np.array([r['ol']['phos'] for r in rs], float)
        ol_g = np.array([r['ol']['gos'] for r in rs], float)
        varc = np.array([r['ol']['var_c'] for r in rs], float)
        d = dict(alpha=al.tolist(), alpha_fref_MHz=fo, Q=[4096 // math.gcd(4096, r['j']) for r in rs],
                 phos_ref_open_loop=ol_p.tolist(), var_rho=varc.tolist())
        lin = {}
        for v in MAP_VARIANTS:
            kp = np.array([r[v]['phos'] for r in rs], float) / ol_p
            kg = np.where(varc > 1e-12, np.array([r[v]['gos'] for r in rs], float) / np.where(varc > 1e-12, varc, 1), np.nan)
            kj = np.array([r[v]['joint'] for r in rs], float) / ol_p
            modes = np.array([r[v]['m'] for r in rs], float) / ol_p[:, None]
            ent = dict(kappa_phos=kp.tolist(), kappa_gos_acnorm=kg.tolist(), kappa_joint=kj.tolist(),
                       kappa_mode_m1_to_m4=modes.T.tolist())
            for tau in (1e-3, 1e-2):
                ent[f'inverted_tau{tau:g}'] = dict(
                    phos=intervals(fo, (kp < -tau).tolist()), gos=intervals(fo, (kg < -tau).tolist()),
                    joint=intervals(fo, (kj < -tau).tolist()), n_phos=int(np.sum(kp < -tau)), n_gos=int(np.sum(kg < -tau)),
                    n_joint=int(np.sum(kj < -tau)))
                ent[f'dead_tau{tau:g}'] = dict(phos=intervals(fo, (np.abs(kp) <= tau).tolist()),
                                               gos=intervals(fo, (np.abs(kg) <= tau).tolist()))
            ent['min_kappa_phos'] = float(np.nanmin(kp))
            ent['min_kappa_phos_at_MHz'] = fo[int(np.nanargmin(kp))]
            ent['min_kappa_gos_acnorm'] = float(np.nanmin(kg))
            lin[v] = ent
        if 'ponly' in rs[0]:
            kp = np.array([r['ponly']['phos'] for r in rs], float) / ol_p
            kg = np.array([r['ponly']['gos'] for r in rs], float) / np.where(varc > 1e-12, varc, np.nan)
            lin['P-only loop'] = dict(kappa_phos=kp.tolist(), kappa_gos_acnorm=kg.tolist(),
                                      n_phos_inv_tau1em3=int(np.sum(kp < -1e-3)), n_gos_inv_tau1em3=int(np.sum(kg < -1e-3)),
                                      min_kappa_phos=float(np.nanmin(kp)), min_kappa_gos_acnorm=float(np.nanmin(kg)))
        d['linear'] = lin
        ls = {}
        dirs = list(rs[0]['ls_kinf']['raw'].keys())
        for v in ['raw', 'ac', '1diff', 'fx:exact']:
            K = np.array([[r['ls_kinf'][v][dn] for dn in dirs] for r in rs], float)
            wk = np.nanmin(K, axis=1)
            ls[v] = dict(kappa_inf_worst=wk.tolist(), inverted=intervals(fo, (wk < -1e-3).tolist()), n_inverted=int(np.sum(wk < -1e-3)),
                         per_dir={dn: K[:, i].tolist() for i, dn in enumerate(dirs)},
                         per_dir_n_inverted={dn: int(np.sum(K[:, i] < -1e-3)) for i, dn in enumerate(dirs)})
        for tagp, kk_ in (('P-only loop', 'ls_kinf_ponly'), ('P-only loop + ac', 'ls_kinf_ponly_ac')):
            if kk_ not in rs[0]:
                continue
            K = np.array([[r[kk_][dn] for dn in dirs] for r in rs], float)
            wk = np.nanmin(K, axis=1)
            ls[tagp] = dict(kappa_inf_worst=wk.tolist(), inverted=intervals(fo, (wk < -1e-3).tolist()),
                            n_inverted=int(np.sum(wk < -1e-3)),
                            per_dir_n_inverted={dn: int(np.sum(K[:, i] < -1e-3)) for i, dn in enumerate(dirs)})
        d['large_signal_A_inf'] = ls
        lp = M[key]['loop']
        d['kernel_min_ReGamma'] = {v: sp.kernel_min(lp, v, M[key]['models']) for v in MAP_VARIANTS}
        if M[key]['ponly'] is not None:
            d['kernel_min_ReGamma']['P-only loop'] = sp.kernel_min(M[key]['ponly'], 'raw')
        d['one_diff_margin'] = sp.one_diff_margin(lp)
        maps[key] = d
        log(f"   {key}: raw PHOS inverted (tau 1e-3) {lin['raw']['inverted_tau0.001']['phos']} MHz; "
            f"(tau 1e-2) {lin['raw']['inverted_tau0.01']['phos']}; GOS inv {lin['raw']['inverted_tau0.001']['n_gos']}; "
            f"min kappa {lin['raw']['min_kappa_phos']:.4f} @ {lin['raw']['min_kappa_phos_at_MHz']:.1f} MHz")
        for v in MAP_VARIANTS[1:] + (['P-only loop'] if 'P-only loop' in lin else []):
            e = lin[v]
            if v == 'P-only loop':
                log(f"       {v:10s}: n_phos_inv {e['n_phos_inv_tau1em3']}, n_gos_inv {e['n_gos_inv_tau1em3']}, "
                    f"min kappa phos {e['min_kappa_phos']:.4f}, gos {e['min_kappa_gos_acnorm']:.4f}")
            else:
                log(f"       {v:10s}: n inverted phos/gos/joint (tau 1e-3) {e['inverted_tau0.001']['n_phos']}/"
                    f"{e['inverted_tau0.001']['n_gos']}/{e['inverted_tau0.001']['n_joint']}, min kappa phos {e['min_kappa_phos']:.4f}, "
                    f"min kappa gos {e['min_kappa_gos_acnorm']:.4f}, min ReGamma {d['kernel_min_ReGamma'][v]['min']:.4f}")
        log("       large-signal A->inf #inverted:", {v: ls[v]['n_inverted'] for v in ls})
    return maps


# ======================================================================================
# S7 LMS spot checks
# ======================================================================================

def stage_lms(pool):
    log("\n[S7] closed-loop sign-error LMS spot checks (real 1-bit comparator, sigma_v = 200 fs, "
        "N = 512, 6000 blocks, 2 noise lanes)")
    nb = 6000
    cases = []
    for a in (0.02, 0.002, 0.496, 0.253):
        for v in ('raw', '1diff', 'fx:exact'):
            cases.append((f'L2|{a}|{v}', 'L2', a, v, False, nb, 11))
        cases.append((f'L2|{a}|raw|Ponly', 'L2', a, 'raw', True, nb, 11))
        cases.append((f'L2|{a}|ac|Ponly', 'L2', a, 'ac', True, nb, 11))
    for a in (0.016, 0.002):
        for v in ('raw', '1diff'):
            cases.append((f'L3|{a}|{v}', 'L3', a, v, False, nb, 12))
        cases.append((f'L3|{a}|raw|Ponly', 'L3', a, 'raw', True, nb, 12))
    for a in (0.02, 0.122):
        cases.append((f'L1|{a}|raw', 'L1', a, 'raw', False, nb, 13))
        cases.append((f'L1|{a}|ac', 'L1', a, 'ac', False, nb, 13))
    cases.append(('L2|0.122|raw|Ponly', 'L2', 0.122, 'raw', True, nb, 13))
    cases.append(('L2|0.122|ac|Ponly', 'L2', 0.122, 'ac', True, nb, 13))
    cases.append(('L2|0.122|raw', 'L2', 0.122, 'raw', False, nb, 13))
    cases.append(('L2|0.137|2diff', 'L2', 0.137, '2diff', False, nb, 14))
    cases.append(('L2|0.137|raw', 'L2', 0.137, 'raw', False, nb, 14))
    cases.append(('L2|0.137|D:1', 'L2', 0.137, 'D:1', False, nb, 14))
    t0 = time.time()
    res = pool.map(task_lms, cases, chunksize=1)
    log("   %d runs in %.0fs" % (len(res), time.time() - t0))
    for r in res:
        log("   %-22s PHOS init %6.0f fs -> final median %9.1f fs (max %9.1f) | GOS final %8.1f fs" %
            (r['tag'], r['phos_init_fs'], r['phos_final_med_fs'], r['phos_max_fs'], r['gos_final_med_fs']))
    return res


# ======================================================================================
# S8 closed-form conditions
# ======================================================================================

def stage8():
    log("\n[S8] closed-form conditions")
    M = models()
    L1, L2, L3 = M['L1']['loop'], M['L2']['loop'], M['L3']['loop']
    f = np.concatenate([np.geomspace(1e-7, 1e-3, 3000, endpoint=False), np.linspace(1e-3, 0.5, 400001)])
    out = {}
    # (1) identity Re H < 0 <=> Re L < -1 <=> Re T > 1  (=> |T| > 1)
    mism = 0
    tviol = 0
    for lp in (L1, L2, L3, M['L2']['ponly'], M['L3']['ponly']):
        Lf = lp.L(f)
        H = 1 / (1 + Lf)
        T = Lf / (1 + Lf)
        a = H.real < 0
        b = Lf.real < -1
        c = T.real > 1
        mism += int(np.sum(a != b) + np.sum(a != c))
        tviol += int(np.sum(a & (np.abs(T) <= 1)))
    out['identity'] = dict(mismatches=mism, ReHneg_but_absT_le1=tviol)
    log(f"   (1) Re H<0 <=> Re L<-1 <=> Re T>1: mismatches {mism}; Re H<0 with |T|<=1: {tviol}")
    # (2) Type-I exact Re H
    K = L1.params['K']
    e2 = float(np.max(np.abs(sp.typeI_ReH(K, f) - L1.H(f).real)))
    out['typeI_ReH_formula_maxerr'] = e2
    out['typeI_min_ReH'] = float(L1.H(f).real.min())
    log(f"   (2) Type-I Re H closed form max err {e2:.1e}; min Re H {out['typeI_min_ReH']:.2e} (>= 0)")
    # (3) Type-II band edge
    fi = sp.typeII_f_inv(L2.params['Kp'], L2.params['Ki'])
    b2 = L2.inversion_bands()
    out['typeII_f_inv'] = dict(closed_form_MHz=fi * F / 1e6, numeric_MHz=b2[0]['f_hi'] * F / 1e6)
    log(f"   (3) Type-II f_inv closed form {fi * F / 1e6:.6f} MHz, numeric {b2[0]['f_hi'] * F / 1e6:.6f} MHz")
    # (4) CPPLL impulse-invariant Re L closed form (loops/README)
    p = L3.params
    Bc = p['K'] * (1 / p['wz'] - 1 / p['wp'])
    pp_ = math.exp(-p['wp'])
    f = f[f >= 1e-4]          # below 1e-4 the rational evaluation of L near its triple DC pole loses digits
    W = 2 * np.pi * f
    mReL = p['K'] / (4 * np.sin(W / 2) ** 2) + Bc * (1 - pp_ ** 2) / (2 * np.abs(1 - pp_ * np.exp(-1j * W)) ** 2)
    e4 = float(np.max(np.abs((mReL + L3.L(f).real) / np.maximum(1, mReL))))
    b3 = L3.inversion_bands()
    out['cppll_ReL_formula_maxrelerr'] = e4
    out['cppll_band_MHz'] = [b3[0]['f_lo'] * F / 1e6, b3[0]['f_hi'] * F / 1e6]
    log(f"   (4) CPPLL -Re L closed form max rel err {e4:.1e}; band {out['cppll_band_MHz']}")
    # (5) PHOS lambda: ergodic harmonic == exact circulant for 8|Q
    errs = []
    for j in range(1, 2048, 64):
        a = (2 * j + 1) / 8192
        fr = Fraction(2 * j + 1, 8192)
        C, cov, mu = sp.C_periodic(fr.numerator, fr.denominator, sp.gamma_eff(L2), 'right', True)
        modes = sp.analyse_C(C, cov)['phos_dft_mode_gain']
        lam = sp.phos_lambda_harmonic(a, sp.gamma_eff(L2), M=1 << 15)
        errs.append(max(abs(modes[f'm{m}'] - lam[m].real) for m in range(1, 5)))
        errs.append(abs(C[0, 0] - sp.gos_harmonic(a, sp.gamma_eff(L2), M=1 << 15)))
    out['harmonic_vs_exact_8divQ_maxerr'] = float(max(errs))
    log(f"   (5) ergodic harmonic sums vs exact periodic (Q = 8192): max err {max(errs):.1e}")
    # (6) mode-1 rigorous bounds -> guaranteed inversion / guaranteed restoring frequencies
    bnd = {}
    for key, lp in (('L2', L2), ('L3', L3)):
        G = sp.gamma_eff(lp)
        ff = np.linspace(1e-5, 0.5, 200001)
        g = np.real(G(ff))
        w1 = 64 * math.sin(math.pi / 8) ** 2 / math.pi ** 2
        up = w1 * g + (1 - w1) * g.max()
        lo = w1 * g + (1 - w1) * g.min()
        sure_inv = ff[up < 0]
        maybe = ff[lo < 0]
        bnd[key] = dict(w1=w1, ReG_max=float(g.max()), ReG_min=float(g.min()),
                        guaranteed_inversion_MHz=[float(sure_inv.min() * F / 1e6), float(sure_inv.max() * F / 1e6)] if len(sure_inv) else None,
                        possible_inversion_upto_MHz=float(maybe.max() * F / 1e6) if len(maybe) else None,
                        threshold_ReH_for_sure=float(-(1 - w1) * g.max() / w1), threshold_ReH_never=float(-(1 - w1) * g.min() / w1))
        log(f"   (6) {key}: mode-1 inversion GUARANTEED for alpha*f_ref in {bnd[key]['guaranteed_inversion_MHz']} MHz "
            f"(Re H < {bnd[key]['threshold_ReH_for_sure']:.4f}); impossible above {bnd[key]['possible_inversion_upto_MHz']:.2f} MHz")
    out['mode1_bounds'] = bnd
    # (7) GOS small-beta asymptotics
    gs = {}
    for key, lp in (('L1', L1), ('L2', L2), ('L3', L3)):
        rows = []
        for P in (64, 256, 1024):
            beta = 1 / P
            # alpha with frac(8 alpha) = beta: alpha = (1 + beta)/8  (just above 1/8)
            fr = Fraction(1, 8) + Fraction(1, 8 * P)
            C = sp.C_periodic(fr.numerator, fr.denominator, sp.gamma_eff(lp), 'right')
            rows.append([P, float(C[0, 0]), sp.gos_small_beta(lp, beta, 0)])
            # D = +1
            C1 = sp.C_periodic(fr.numerator, fr.denominator, sp.gamma_eff(lp, 'D:1'), 'right')
            rows[-1] += [float(C1[0, 0]), sp.gos_small_beta(lp, beta, 1)]
        gs[key] = rows
        log(f"   (7) {key} GOS slow sawtooth [P, C exact D0, asym D0, C exact D1, asym D1]:",
            [[r[0]] + [float('%.4g' % x) for x in r[1:]] for r in rows])
    out['gos_small_beta'] = gs
    # (8) remedy kernels
    kr = {}
    for key in ('L1', 'L2', 'L3'):
        lp = M[key]['loop']
        kr[key] = {v: sp.kernel_min(lp, v, M[key]['models']) for v in ('raw', '1diff', '2diff', 'D:1', 'D:-1', 'fx:exact',
                                                                       'fx:bw0.8', 'fx:bw1.2', 'fx:typeI')}
        if M[key]['ponly'] is not None:
            kr[key]['P-only loop'] = sp.kernel_min(M[key]['ponly'], 'raw')
        kr[key]['one_diff_margin'] = sp.one_diff_margin(lp)
        log(f"   (8) {key} min_f Re Gamma_eff:", {v: round(d['min'], 4) for v, d in kr[key].items() if 'min' in d})
    kr['typeII_1diff_closed_form'] = dict(Kp_minus_Ki_over_2=L2.params['Kp'] - L2.params['Ki'] / 2,
                                         two_minus_Kp_minus_Ki_over_2=2 - L2.params['Kp'] - L2.params['Ki'] / 2)
    out['remedy_kernels'] = kr
    # (9) f_vco independence of the GOS-column coupling
    fv = {}
    for fvco in (12e9, 16e9, 24e9):
        cfg = sp.sim_cfg(f_vco=fvco)
        t = sp.theory_point(L2, 0.021, 'raw', None, cfg, side='auto')
        fv[f'{fvco / 1e9:g}GHz'] = dict(gos=t['gos'], phos=t['phos_min_re'], joint=t['joint_min_re'])
    out['f_vco_check_L2_alpha0.021'] = fv
    log("   (9) f_vco check (L2, alpha=0.021):", {k: {q: round(v, 6) for q, v in d.items()} for k, d in fv.items()})
    return out


# ======================================================================================
# outputs
# ======================================================================================

def write_outputs(S, rows_csv, maps, FD):
    with open(os.path.join(HERE, 'comparison_fine.csv'), 'w') as fh:
        fh.write("# kappa_PHOS conventions: sim = min Re eig / open-loop(record) [sim normalisation]; 8lam = theory "
                 "normalisation (ideal 1/8). kappa_GOS: sim = mS_gg/open-loop (incl. regressor DC, 1/3); "
                 "acnorm = C_GOS/var(rho); 12C = ergodic theory.\n")
        fh.write("loop,alpha,Q,acc_side,kP_sim_erf,kP_sim_lin,kP_replica_erf,kP_exact_periodic_simnorm,"
                 "kP_8lam_exact_ideal,kP_8lam_ergodic,kP_8ReLam1_ergodic,kP_single_line,"
                 "kG_sim_erf,kG_exact_periodic_simnorm,kG_acnorm_exact_ideal,kG_12C_ergodic,LS_kappa_inf_worst\n")
        for r in rows_csv:
            fh.write(",".join(str(x) if isinstance(x, (str, int)) else ("%.6g" % x) for x in r) + "\n")
    with open(os.path.join(HERE, 'sign_maps_reconciled.json'), 'w') as fh:
        json.dump(jsonable(dict(
            description=("Reconciled sign maps for L1 (SSPLL Type-I), L2 (SSPLL Type-II PM60), L3 (CPPLL impulse PMct60), "
                         "f_ref 4 GHz, |T| -3 dB 320 MHz, 8-phase PMUX + input DTC, first-order accumulator, ideal "
                         "injection model e = (a-w_g) rho + sum (eps_k-w_k) 1{p=k}, alpha = j/4096 exact (floor convention). "
                         "kappa_phos = min Re eig(C_PHOS on observable subspace)/open-loop reference (=8 Re lambda for 8|Q); "
                         "kappa_gos_acnorm = C_GOS/var(rho) (=12 C_GOS for long periods); kappa_joint = joint 9x9 min Re eig / "
                         "PHOS reference.  'inverted' = kappa < -tau, 'dead' = |kappa| <= tau.  Intervals in MHz of "
                         "min(alpha,1-alpha)*f_ref.  large_signal_A_inf: kappa_inf = <sign(h*d_v) z_v>/|<sign(d_v) x_v>| "
                         "worst over directions {gos, PHOS DFT modes 1c,1s,2c,3c,4} (A >> sigma_v limit of the 1-bit comparator)."),
            loops={k: models()[k]['loop'].summary() for k in ('L1', 'L2', 'L3')},
            maps=maps)), fh)
    with open(os.path.join(HERE, 'reconcile_results.json'), 'w') as fh:
        json.dump(jsonable(S), fh, indent=1)
    with open(os.path.join(HERE, 'reconcile_log.txt'), 'w') as fh:
        fh.write("\n".join(LOGL) + "\n")


def make_table(S, FD):
    """Curated markdown comparison table (numbers only; generated)."""
    R = json.load(open(os.path.join(SSPLL, 'sim', 'results.json')))
    sel = [0.002, 0.004, 0.006, 0.01, 0.016, 0.02, 0.021, 0.03, 0.031, 0.123, 0.137, 0.247, 0.253, 0.3183, 0.496]
    L = []
    L.append("# Reconciliation table (generated by reconcile.py; every number from code)\n")
    L.append("kappa_PHOS columns: **sim** = stored time-domain result (erf estimator, 2^16 samples, normalised by the "
             "same-record open-loop reference); **replica** = deterministic re-computation of the sim protocol; "
             "**exact-per** = exact periodic steady state, sim physics, same accumulator side, sim normalisation; "
             "**8lam-rat** = exact rational alpha=i/1000 (floor), ideal model, 8 x min Re eig; **8lam-erg** = ergodic "
             "harmonic sum (irrational limit), min over modes; **m1-erg** = mode 1 only; **1-line** = 0.9496 Re H(alpha f_ref).\n")
    L.append("kappa_GOS columns: **sim** = mS_gg / open-loop (open-loop includes the regressor DC: ~(1-a)<c^2> = 0.97/3); "
             "**12C-erg** = ergodic theory normalised by var(rho)=1/12 (loops/regressors convention). 12C-erg / sim ~ 4.\n")
    L.append("LS kinf = large-signal (A >> sigma_v) 1-bit-correlation, worst direction.\n")
    for key in ('L1', 'L2', 'L3'):
        rs = {r['alpha']: r for r in FD[key]}
        fs = R['fine'][SIM_KEY[key]]
        L.append(f"\n## {key} ({models()[key]['loop'].name})\n")
        L.append("| alpha | alpha f_ref MHz | Q | side | sim | replica | exact-per | 8lam-rat | 8lam-erg | m1-erg | 1-line | GOS sim | GOS 12C-erg | LS kinf |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for a in sel:
            i = int(round(a * 1000)) - 1 if abs(a * 1000 - round(a * 1000)) < 1e-9 else None
            r = rs.get(a)
            if r is None:
                # off-grid alpha (e.g. 0.3183): theory only
                lp = models()[key]['loop']
                G = sp.gamma_eff(lp)
                lam = sp.phos_lambda_harmonic(a, G)
                tp = sp.theory_point(lp, a, 'raw', None, sp.sim_cfg(), side='auto')
                Rg = R['grid'][SIM_KEY[key]]['summary']
                gi = [round(d['alpha'], 4) for d in Rg].index(round(a, 4)) if round(a, 4) in [round(d['alpha'], 4) for d in Rg] else None
                simp = simg = float('nan')
                if gi is not None:
                    d = Rg[gi]
                    simp = d['variants']['raw']['erf']['phos_min_re'] / d['open_loop_H1']['erf']['phos_min_re']
                    simg = d['variants']['raw']['erf']['mS_gg'] / d['open_loop_H1']['erf']['mS_gg']
                L.append(f"| {a} | {min(a, 1 - a) * 4000:.1f} | {tp['Q']} | {tp['side']} | {simp:+.4f} (grid 2^19) | - | "
                         f"{tp['phos_min_re'] / tp['open_loop']['phos_min_re']:+.4f} | - | {8 * lam.real[1:].min():+.4f} | "
                         f"{8 * lam.real[1]:+.4f} | {sp.single_line_phos(a, G):+.4f} | {simg:+.4f} | "
                         f"{12 * sp.gos_harmonic(a, G):+.4f} | - |")
                continue
            olp = fs['open_loop_H1']['phos_min_re'][i]
            olg = fs['open_loop_H1']['mS_gg'][i]
            simp = fs['variants']['raw']['erf']['phos_min_re'][i] / olp
            simg = fs['variants']['raw']['erf']['mS_gg'][i]
            simg = simg / olg if simg is not None else float('nan')
            repp = r['rep']['raw']['erf']['phos'] / r['rep_ol']['erf']['phos']
            tap = r['th_auto_phys']['raw']['phos'] / r['th_auto_phys_ol']['phos']
            kinf = min(r['ls_per']['raw'][d]['kinf'] for d in r['ls_per']['raw'])
            L.append(f"| {a} | {a * 4000:.0f} | {r['PQ'][1]} | {r['PQ'][2]} | {simp:+.4f} | {repp:+.4f} | {tap:+.4f} | "
                     f"{8 * r['th_right_ideal']['phos']:+.4f} | {8 * r['harm']['phos_min']:+.4f} | {8 * r['harm']['lam_re'][0]:+.4f} | "
                     f"{r['harm']['single_line']:+.4f} | {simg:+.4f} | {12 * r['harm']['gos']:+.4f} | {kinf:+.3f} |")
    L.append("\n## Remedy / variant counts on the 500-point fine grid (#alpha with kappa < -1e-3; sim vs exact-periodic theory)\n")
    L.append("| loop | variant | PHOS sim | PHOS theory | GOS sim | GOS theory | joint sim | joint theory | min kPHOS sim | min kPHOS theory |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for key in ('L1', 'L2', 'L3'):
        for v, d in S['fine'][key]['variants'].items():
            L.append(f"| {key} | {v} | {d.get('sim_phos_inv', '-')} | {d['th_phos_inv']} | {d.get('sim_gos_inv', '-')} | "
                     f"{d['th_gos_inv']} | {d.get('sim_joint_inv', '-')} | {d.get('th_joint_inv', '-')} | "
                     f"{('%+.4f' % d['sim_phos_min']) if 'sim_phos_min' in d else '-'} | {d['th_phos_min']:+.4f} |")
    L.append("\n## Large signal (#alpha of 500 with worst normalised secant slope < -1e-3)\n")
    L.append("| loop | variant | A=1ps sim | A=1ps periodic | A=5ps sim | A=5ps periodic | A=inf (1-bit corr) |")
    L.append("|---|---|---|---|---|---|---|")
    for key in ('L1', 'L2', 'L3'):
        ls = S['fine'][key]['large_signal']
        for v in LS_VARIANTS:
            d = ls[v]
            L.append(f"| {key} | {v} | {d['A=1ps']['sim_inverted']} | {d['A=1ps']['periodic_inverted']} | "
                     f"{d['A=5ps']['sim_inverted']} | {d['A=5ps']['periodic_inverted']} | {d['A=inf']['inverted']} |")
        for q in ('P-only loop', 'P-only loop + ac'):
            if q in ls:
                L.append(f"| {key} | {q} | - | - | - | - | {ls[q]['A=inf']['inverted']} |")
    with open(os.path.join(HERE, 'comparison_table.md'), 'w') as fh:
        fh.write("\n".join(L) + "\n")


def make_figs(S, FD, maps, lmsres):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    R = json.load(open(os.path.join(SSPLL, 'sim', 'results.json')))
    al = np.array(FINE_ALPHAS)
    fig, axs = plt.subplots(3, 2, figsize=(13, 11))
    for row, key in enumerate(('L1', 'L2', 'L3')):
        fs = R['fine'][SIM_KEY[key]]
        rs = FD[key]
        olp = np.array(fs['open_loop_H1']['phos_min_re'])
        simp = np.array(fs['variants']['raw']['erf']['phos_min_re']) / olp
        tap = np.array([r['th_auto_phys']['raw']['phos'] / r['th_auto_phys_ol']['phos'] for r in rs])
        erg = np.array([8 * r['harm']['phos_min'] for r in rs])
        m1 = np.array([8 * r['harm']['lam_re'][0] for r in rs])
        ax = axs[row, 0]
        ax.plot(al, simp, 'o', ms=3, label='sim (erf, stored)', color='C0')
        ax.plot(al, tap, '-', lw=1.2, label='exact periodic (sim physics/norm.)', color='C1')
        ax.plot(al, erg, '--', lw=1, label='ergodic 8 min Re lambda', color='C2')
        ax.plot(al, m1, ':', lw=1, label='ergodic mode 1', color='C3')
        ax.axhline(0, color='k', lw=0.6)
        ax.set_xscale('log')
        ax.set_ylim(-0.4, 1.2)
        ax.set_title(f'{key}: PHOS kappa (small signal)')
        ax.set_xlabel('alpha')
        ax.legend(fontsize=7)
        ax = axs[row, 1]
        d = maps[key]
        fo = np.array(d['alpha_fref_MHz'])
        alj = np.array(d['alpha'])
        h = alj <= 0.5
        ax.plot(alj[h], np.array(d['linear']['raw']['kappa_phos'])[h], lw=1, label='raw (linear)')
        ax.plot(alj[h], np.array(d['large_signal_A_inf']['raw']['kappa_inf_worst'])[h], lw=0.8, label='raw large-signal A->inf')
        ax.plot(alj[h], np.array(d['linear']['1diff']['kappa_phos'])[h], lw=0.8, label='1st-diff (linear)')
        if 'P-only loop' in d['linear']:
            ax.plot(alj[h], np.array(d['linear']['P-only loop']['kappa_phos'])[h], lw=0.8, label='P-only loop (linear)')
        ax.axhline(0, color='k', lw=0.6)
        ax.set_xscale('log')
        ax.set_ylim(-1.05, 1.2)
        ax.set_title(f'{key}: worst-mode kappa, alpha = j/4096')
        ax.set_xlabel('alpha')
        ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, 'fig_reconcile_phos.png'), dpi=120)
    plt.close(fig)
    # LMS traces
    fig, ax = plt.subplots(1, 1, figsize=(9, 5))
    for r in lmsres:
        if r['key'] == 'L2' and r['alpha'] == 0.02:
            ax.semilogy(r['trace_block'], r['trace_phos_fs'], label=f"{r['variant']}{' P-only' if r['ponly'] else ''}")
    ax.set_xlabel('block (512 samples)')
    ax.set_ylabel('PHOS rms error (fs)')
    ax.set_title('L2 Type-II, alpha = 0.02 (80 MHz): sign-error LMS')
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, 'fig_lms_L2_alpha0p02.png'), dpi=120)
    plt.close(fig)


def main():
    t0 = time.time()
    S = {}
    S['meta'] = dict(f_ref=F, bw=sp.BW, sim_cfg={k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in sp.sim_cfg().items()},
                     fine_alphas='0.001..0.500 step 0.001', fine_variants=FINE_VARIANTS)
    S['S0_parity'] = stage0()
    S['S1_fullprecision'] = stage1()
    ctx = mp.get_context('spawn')
    with ctx.Pool(min(16, os.cpu_count() or 1)) as pool:
        FD = stage_fine(pool)
        S['fine'], rows = analyse_fine(FD)
        S['S4_crosscheck'] = stage4()
        maps = stage_maps(pool)
        lmsres = stage_lms(pool)
    S['lms'] = [{k: v for k, v in r.items() if not k.startswith('trace')} for r in lmsres]
    S['S8_closed_form'] = stage8()
    S['maps_summary'] = {k: {v: {q: maps[k]['linear'][v].get(q) for q in ('inverted_tau0.001', 'inverted_tau0.01', 'dead_tau0.01',
                                                                         'min_kappa_phos', 'min_kappa_phos_at_MHz', 'min_kappa_gos_acnorm',
                                                                         'n_phos_inv_tau1em3', 'n_gos_inv_tau1em3')}
                             for v in maps[k]['linear']} for k in maps}
    S['maps_large_signal_summary'] = {k: {v: {q: maps[k]['large_signal_A_inf'][v][q] for q in ('inverted', 'n_inverted', 'per_dir_n_inverted')}
                                          for v in maps[k]['large_signal_A_inf']} for k in maps}
    S['runtime_s'] = time.time() - t0
    write_outputs(S, rows, maps, FD)
    make_table(S, FD)
    make_figs(S, FD, maps, lmsres)
    log("\nruntime %.0fs" % (time.time() - t0))
    with open(os.path.join(HERE, 'reconcile_log.txt'), 'w') as fh:
        fh.write("\n".join(LOGL) + "\n")


if __name__ == '__main__':
    main()
