#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
simulator.py -- time-domain models.

1. replica_S       deterministic replica of the slope-matrix measurement of analysis/sspll/sim
                   (LMS frozen, +-delta perturbation of each weight, 'lin' = Bussgang-linear,
                   'erf' = exact average over the Gaussian comparator noise).
2. run_sign_lms    closed-loop sign-error block LMS with a REAL 1-bit comparator
                   q = sign(e_PD + v + u_os), v ~ N(0, sigma_v^2).

Physical injection model (ps):   theta = [w_g, w_0..w_7]
    u[n] = c[n] Delta + eps_{p[n]} - (1-a)(1+w_g)(c[n] Delta + w_{p[n]})
    e_PD = h_PD * u,   H_PD = 1/(1+L)
At the calibrated point (1-a)(1+w_g) = 1 and (1-a)(1+w_g) w_k = eps_k.
Polarity: chosen so that the update w += mu q r is correct when H_PD == 1.
"""
from __future__ import annotations

import math
from typing import Dict, Optional, Sequence

import numpy as np
from scipy import special

from .loops import Loop
from .predictions import analyse_C, physical_mix, sim_cfg
from .regressors import NPH, apply_variant, regressor_matrix, seq_acc, seq_rational
from fractions import Fraction


# ======================================================================================
# 1. replica of the simulator's slope measurement
# ======================================================================================
def replica_S(loop: Loop, alpha: float, variants: Sequence[str] = ('raw',), cfg: Optional[dict] = None,
              N_rec: int = 1 << 16, N_settle: int = 1 << 12, models=None, estimators=('lin', 'erf'),
              seq: str = 'acc32') -> dict:
    """PLL from zero state at n = 0, perturbation of each theta_j at the calibrated point, record window
    [N_settle, N_settle + N_rec).  Returns {variant: {estimator: analysis}} + open-loop reference.
    kappa (sim normalisation) = closed-loop / open-loop of the same record."""
    cfg = cfg if cfg is not None else sim_cfg()
    nt = N_settle + N_rec
    n = np.arange(nt)
    if seq == 'acc32':
        def Xfun(nn):
            return regressor_matrix(*seq_acc(alpha, nn))
    else:
        fr = Fraction(alpha).limit_denominator(1 << 16)

        def Xfun(nn):
            return regressor_matrix(*seq_rational(fr.numerator, fr.denominator, nn, seq))
    X = Xfun(n)
    Mx = physical_mix(cfg)
    Dd = X @ Mx                                     # d_j[n] = -du/dtheta_j
    Y = loop.filt(Dd, axis=0)                       # y_j = h_PD * d_j
    w = slice(N_settle, nt)
    Xr = X[w]
    mu = Xr.mean(axis=0)
    cov = Xr.T @ Xr / N_rec - np.outer(mu, mu)
    sig, dl = cfg['sigma'], cfg['delta_pert']
    kk = sig / math.sqrt(2 / math.pi)
    out = {}
    for v in variants:
        R = apply_variant(v, Xfun, n[w], models, n_start=0)
        out[v] = {}
        for est in estimators:
            if est == 'lin':
                C = R.T @ Y[w] / N_rec
            elif est == 'erf':
                C = kk * (R.T @ special.erf(dl * Y[w] / (math.sqrt(2) * sig))) / N_rec / dl
            else:
                raise ValueError(est)
            out[v][est] = analyse_C(C, cov)
    ol = {}
    for est in estimators:
        if est == 'lin':
            C0 = Xr.T @ Dd[w] / N_rec
        else:
            C0 = kk * (Xr.T @ special.erf(dl * Dd[w] / (math.sqrt(2) * sig))) / N_rec / dl
        ol[est] = analyse_C(C0, cov)
    out['open_loop'] = ol
    out['var_c'] = float(cov[0, 0])
    return out


def replica_kappa(rep: dict, variant: str = 'raw', est: str = 'erf') -> dict:
    a, a0 = rep[variant][est], rep['open_loop'][est]
    return dict(kP=a['phos_min_re'] / a0['phos_min_re'],
                kG=a['gos'] / a0['gos'] if a['gos_observable'] else float('nan'))


# ======================================================================================
# 2. closed-loop sign-error block LMS
# ======================================================================================
# #region core:sign_lms_block
def run_sign_lms(loop: Loop, alpha: float, variant: str = 'raw', cfg: Optional[dict] = None,
                 n_blocks: int = 4000, N_blk: int = 512, tau_blocks: float = 25.0, seed: int = 3,
                 models=None, w0=None, rec_every: int = 20, N_settle: int = 4096, lanes: int = 1,
                 u_os: float = 0.0, seq: str = 'acc32') -> dict:
    """Sign-error block LMS (one GMAC block = N_blk comparator samples):
         q[n] = sign(e_PD[n] + v[n] + u_os)
         w_g += mu_g mean(q r_g),   w_k += mu_p mean(q r_k)        (r = GMAC regressor of `variant`)
    Step sizes: open-loop (H == 1) time constant tau_blocks, NLMS-style power normalisation of the
    variant (as in analysis/sspll/sim).  Returns PHOS rms error (fs, common mode removed), PHOS common
    mode (fs), GOS error (fs at code 1) vs block, per lane.
    u_os: static offset at the comparator input (ps).  seq: 'acc32' (the simulator's 32-bit accumulator)
    or 'right' / 'left' (exact rational alpha, floor convention / limit from below)."""
    cfg = cfg if cfg is not None else sim_cfg()
    rng = np.random.default_rng(seed)
    sig, Dl, a, eps = cfg['sigma'], cfg['Delta'], cfg['a'], np.asarray(cfg['eps'])
    ccmp = math.sqrt(2 / math.pi) / sig
    mu_p = 8.0 / (tau_blocks * ccmp)
    mu_g = 12.0 / (tau_blocks * ccmp * Dl)

    if seq == 'acc32':
        def Xfun(nn):
            return regressor_matrix(*seq_acc(alpha, nn))
    else:                                               # exact rational alpha, 'right' or 'left' limit
        fr = Fraction(alpha).limit_denominator(1 << 16)

        def Xfun(nn):
            return regressor_matrix(*seq_rational(fr.numerator, fr.denominator, nn, seq))
    npre = np.arange(1 << 15)
    Rp = apply_variant(variant, Xfun, npre, models)[1 << 12:]
    mu_g *= (1 / 12) / max(Rp[:, 0].var(), 1e-12)
    mu_p *= (1 / 8) / max((Rp[:, 1:] ** 2).mean(), 1e-12)
    wg = np.zeros(lanes) if w0 is None else np.full(lanes, float(w0[0]))
    W = np.zeros((lanes, NPH)) if w0 is None else np.tile(np.asarray(w0[1], float), (lanes, 1))
    zi = loop.zi_zeros(lanes)
    fx_zi = None
    if variant.startswith('fx:'):
        m = models[variant[3:]]
        fx_zi = np.zeros((max(len(m.bH), len(m.aH)) - 1, 1 + NPH))
    rec = dict(block=[], phos_rms_fs=[], phos_cm_fs=[], gos_err_fs=[])

    def regs(n0, N):
        nonlocal fx_zi
        nn = np.arange(n0, n0 + N)
        if variant.startswith('fx:'):
            m = models[variant[3:]]
            Y, fx_zi = m.filt(Xfun(nn), axis=0, zi=fx_zi)
            return Xfun(nn), Y
        return Xfun(nn), apply_variant(variant, Xfun, nn, models)

    def inj(X):                                         # injected timing error u[n] (ps), (N, lanes)
        c, P1 = X[:, 0], X[:, 1:]
        gain = (1 - a) * (1 + wg)
        return (c * Dl + P1 @ eps)[:, None] - gain[None, :] * (c[:, None] * Dl + P1 @ W.T)

    def record(b):
        gain = (1 - a) * (1 + wg)
        perr = gain[:, None] * W - eps[None, :]
        cm = perr.mean(axis=1, keepdims=True)
        rec['block'].append(b)
        rec['phos_rms_fs'].append((np.sqrt(((perr - cm) ** 2).mean(axis=1)) * 1000).tolist())
        rec['phos_cm_fs'].append((cm[:, 0] * 1000).tolist())
        rec['gos_err_fs'].append(((gain - 1) * Dl * 1000).tolist())

    n0 = 0
    while n0 < N_settle:                                # settle the PLL with the LMS frozen
        X, _ = regs(n0, N_blk)
        _, zi = loop.filt(inj(X), axis=0, zi=zi)
        n0 += N_blk
    for b in range(n_blocks):
        X, R = regs(n0, N_blk)
        e, zi = loop.filt(inj(X), axis=0, zi=zi)        # e_PD = h_PD * u
        n0 += N_blk
        if b % rec_every == 0:
            record(b)
        q = np.sign(e + rng.normal(0, sig, e.shape) + u_os)   # 1-bit comparator
        G = q.T @ R / N_blk                             # GMAC: (lanes, 9)
        wg += mu_g * G[:, 0]                            # GOS update
        W += mu_p * G[:, 1:]                            # PHOS updates
    record(n_blocks)
    rec['mu_g'], rec['mu_p'] = mu_g, mu_p
    return rec
# #endregion core:sign_lms_block


def final_stats(rec: dict, last: int = 1) -> dict:
    """Median over lanes of the last recorded |errors| (fs)."""
    return dict(phos_rms_fs=float(np.median(rec['phos_rms_fs'][-last])),
                phos_rms_max_fs=float(np.max(np.array(rec['phos_rms_fs']))),
                phos_cm_fs=float(np.median(np.abs(rec['phos_cm_fs'][-last]))),
                gos_fs=float(np.median(np.abs(rec['gos_err_fs'][-last]))))
