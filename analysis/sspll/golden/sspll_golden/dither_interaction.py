#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dither_interaction.py -- DSM dither / MASH-1-1-1 / PMUX random rotation  x  sign-error LMS
(case page /case/sspll section 10b; derivation in docs/analysis/sspll-dither-interaction.md).

Code sources (the same constructions as analysis/sspll/sim/sim.py `SeqSource`, on the 2^29 grid of
one PMUX step Delta = T_vco/8; alpha is quantised to 32 bits exactly as the simulator does):
    acc1 : first-order accumulator, Phi[n] = 8 n alpha, P = floor(Phi), c = rho = Phi - P in [0, 1)
    dq   : dithered quantiser  P = floor(Phi + u), u ~ U[0, 1) iid          -> c = rho + 1 - b, b = 1{rho + u >= 1}, c in (0, 2)
    mash : MASH 1-1-1 on the Delta grid, P = Phi - r, r = (1 - z^-1)^2 e3   -> c = r + 2 in (0, 4)   (e3 = third-stage residue)
    rotM : PMUX random rotation P' = P + m, m ~ U{0..M-1} iid              -> c = rho - m + (M - 1) in (0, M)
In every case P[n] (integer, PMUX pointer) and the DTC code c[n] satisfy  P[n] + c[n] = Phi[n] + const,
so the *total* compensation is unchanged and only the split between PMUX and DTC is randomised.

Theory (linear small signal, frozen weights, D = 0 -- same model as section 8):
    mode-m PHOS regressor  z_m[n] = exp(j 2 pi m P[n]/8) = exp(j 2 pi m alpha n) * exp(-j theta_m c~[n]),  theta_m = pi m/4,
    c~ = the random part of the code (c minus its deterministic sawtooth / offset).  Hence
        Re kappa_m = sum_{lines l = m (mod 8)} w_l^(s) Re H_PD(frac(l alpha))                       (carrier + staircase lines)
                   + sum_{k >= 0} h_PD[k] cos(2 pi m alpha k) R~_m^(s)[k]                            (spread part, short memory)
    with source-dependent line weights w^(s) and residual autocorrelation R~^(s) (closed forms below):
        acc1 : w_l = 64 sin^2(pi l/8)/(pi l)^2,                                R~ = 0
        dq   : w_l = |v_k|^2, v_k = Fourier coefficient of e^{-j theta rho}((1-rho) + rho e^{j theta}),   R~ = [(1 - cos theta)/3]  (white)
        rotM : w_l = |D_M(theta)|^2 * w_l^(acc1), D_M = (1/M) sum_{r<M} e^{j theta r},                 R~ = [1 - |D_M|^2]            (white)
        mash : single carrier line at l = m with weight |phi|^2, phi = sinc(theta/2)^2 sinc(theta)  (e3 iid uniform),
               R~[k] = R[k] - |phi|^2,  R[1] = sinc(theta/2)^2 sinc(3 theta/2)^2,  R[2] = sinc(theta/2)^2 sinc(theta)^2,  R[k>=3] = |phi|^2
    GOS (regressor = c):  C_GOS = sum_{k>=0} h_PD[k] R~_c[k]:
        acc1 : sawtooth harmonic sum (section 7);  dq : white, R~_c = [1/6];  rotM : sawtooth + white (M^2 - 1)/12;
        mash : R~_c = [6, -4, 1]/12  (so C = (6 - 4 h[1] + h[2])/12, independent of alpha).
    The mash / dq / rot closed forms assume the random part is iid (mash: e3 iid uniform); the actual sequences are only
    approximately so (near-rational alpha has tones), which is what `kappa_numeric` (exact for the given record) measures.
    Verdict: kappa_min = min_m Re kappa_m;  < -tau inverted (diverges), > +tau restoring, |.| <= tau dead zone -- NOT decided.
    The 1-bit large-signal slope (`large_signal_code`, section 10.4) was tried as a second stage for the dead zone and is
    contradicted by the stored MC (8 of the 18 dead-zone cases go the other way; `two_stage_verdict`, scored in
    tools/dither_sweep.py); it is only shown as a research-hypothesis hint.  `efold_verdict` is the linear mean model read over the
    MC window (a window-dependent tau), also scored there.

Numbers consumed by the web page come from tools/dither_sweep.py -> results/dither_interaction.json; the TypeScript port
(src/simulation/models/sspll.ts, "code sources" block) is compared against that file in sspll.test.ts.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy import signal, special

from .loops import Loop
from .predictions import gamma_eff, gos_harmonic, phos_lambda_harmonic, sim_cfg
from . import gos_certificate as gc
from .regressors import NPH, apply_variant, regressor_matrix

M29 = (1 << 29) - 1
M32 = (1 << 32) - 1
CODE_SOURCES = ('acc1', 'dq', 'mash', 'rot4', 'rot8')
# DTC range of each source in units of Delta (by construction)
CODE_RANGE = {'acc1': 1, 'dq': 2, 'mash': 4, 'rot4': 4, 'rot8': 8}


def _sinc(x: float) -> float:
    return 1.0 if abs(x) < 1e-15 else math.sin(x) / x


def mode_fold(m: int) -> int:
    """Fold a mode index to [-4, 4]: z_{8-m} = conj(z_m) exactly (P is an integer), so the iid closed forms must use the
    principal angle -- with theta = 7 pi/4 the 'carrier' of mode 7 would wrongly be assigned ~0 weight."""
    return ((m + 4) % 8) - 4


def theta_mode(m: int) -> float:
    """theta_m = 2 pi m / 8 = pi m / 4 (m folded to [-4, 4]): the phase step of mode m per Delta of code."""
    return math.pi * mode_fold(m) / 4


# --------------------------------------------------------------------------------------
# sequences (vectorised; same recurrences as sim.py SeqSource)
# --------------------------------------------------------------------------------------
def alpha_word(alpha: float) -> int:
    return int(round(alpha * 2 ** 32)) & M32


# #region core:code_sequence
def code_sequence(alpha: float, source: str, n, seed: int = 12345):
    """DTC code c[n] (units Delta, including the source's fixed offset) and PMUX index p[n] for contiguous
    ascending sample indices n (the MASH state starts at zero at n[0], like the simulator's n_start)."""
    n = np.asarray(n, np.int64)
    ai = alpha_word(alpha)
    acc = (n * ai) & M32                                   # Phi[n] on the 2^29 grid, modulo 8 Delta
    p0 = acc >> 29
    rho = (acc & M29) / 2.0 ** 29
    if source == 'acc1':
        return rho, p0.astype(np.int64)
    rng = np.random.default_rng(seed)
    if source == 'dq':
        u = rng.integers(0, 1 << 29, size=n.shape, dtype=np.int64)
        P = ((acc + u) & M32) >> 29                        # ← 差異：floor(Phi + u)
        b = ((acc & M29) + u) >> 29                        # carry: rho + u >= 1
        return rho + 1.0 - b, P.astype(np.int64)
    if source.startswith('rot'):
        M = int(source[3:])
        m = rng.integers(0, M, size=n.shape, dtype=np.int64)
        return rho - m + (M - 1.0), ((p0 + m) & 7).astype(np.int64)   # ← 差異：PMUX pointer + m, DTC adds m Delta
    if source == 'mash':
        I8 = ai >> 29
        F = ai & M29
        k = n - n[0]
        S1 = (k + 1) * F                                   # unwrapped stage-1 sum (exact int64 for records < 2^34)
        acc1 = S1 & M29
        C1 = S1 >> 29
        S2 = np.cumsum(acc1)
        acc2 = S2 & M29
        C2 = S2 >> 29
        S3 = np.cumsum(acc2)
        acc3 = S3 & M29
        C3 = S3 >> 29
        C2m1 = np.concatenate([[0], C2[:-1]])
        C3m1 = np.concatenate([[0], C3[:-1]])
        C3m2 = np.concatenate([[0, 0], C3[:-2]])
        sum_y = C1 + (C2 - C2m1) + (C3 - 2 * C3m1 + C3m2)  # ← 差異：cumulative MASH output (1 - z^-1)^3 shaped
        P = (k + 1) * I8 + sum_y
        a3 = acc3 / 2.0 ** 29
        a3m1 = np.concatenate([[0.0], a3[:-1]])
        a3m2 = np.concatenate([[0.0, 0.0], a3[:-2]])
        r = a3 - 2 * a3m1 + a3m2                           # residue Phi - P = (1 - z^-1)^2 e3, in (-2, 2)
        return r + 2.0, (P & 7).astype(np.int64)
    raise ValueError(source)
# #endregion core:code_sequence


# --------------------------------------------------------------------------------------
# closed-form spectral factors
# --------------------------------------------------------------------------------------
# #region core:code_factors
def mash_factors(m: int) -> dict:
    """MASH 1-1-1 with iid uniform e3: carrier retention |phi|^2 and the residual autocorrelation R~[0..2]
    of u = exp(-j theta c) (c = (1 - z^-1)^2 e3; the characteristic function of a sum of iid uniforms is a product of sincs)."""
    th = theta_mode(m)
    phi = _sinc(th / 2) ** 2 * _sinc(th)                   # E[e^{-j theta (e - 2e' + e'')}]
    phi2 = phi * phi
    R1 = _sinc(th / 2) ** 2 * _sinc(1.5 * th) ** 2         # c[n] - c[n-1] = e - 3e' + 3e'' - e'''
    R2 = _sinc(th / 2) ** 2 * _sinc(th) ** 2               # c[n] - c[n-2] = e - 2e' + 2e''' - e''''
    return dict(phi2=phi2, rtilde=[1.0 - phi2, R1 - phi2, R2 - phi2])


def dq_line_weight(m: int, k: int) -> float:
    """|v_k|^2: Fourier coefficient (line l = m + 8k) of v(rho) = e^{-j theta rho}((1 - rho) + rho e^{j theta}),
    the conditional mean of the dithered-quantiser mode-m regressor given the sawtooth rho."""
    th = theta_mode(m)
    w = th + 2 * math.pi * k
    A = (1 - np.exp(-1j * th)) / (1j * w)                  # int_0^1 e^{-j w rho} d rho
    B = (A - np.exp(-1j * th)) / (1j * w)                  # int_0^1 rho e^{-j w rho} d rho
    v = A - (1 - np.exp(1j * th)) * B
    return float(abs(v) ** 2)


def dq_white(m: int) -> float:
    """Power moved into white noise by the dithered quantiser: E[2 rho(1 - rho)](1 - cos theta) = (1 - cos theta)/3."""
    return (1 - math.cos(theta_mode(m))) / 3


def rot_factor(M: int, m: int) -> float:
    """|D_M(theta)|^2, D_M = (1/M) sum_{r<M} e^{j theta r}: the fraction of every staircase line that survives random rotation."""
    th = theta_mode(m)
    D = sum(np.exp(1j * th * r) for r in range(M)) / M
    return float(abs(D) ** 2)


def acc1_line_weight(ell: int) -> float:
    """w_l = 64 sin^2(pi l/8)/(pi l)^2 (section 8: sum over l = m mod 8 is 1)."""
    return 64 * math.sin(math.pi * ell / NPH) ** 2 / (math.pi * ell) ** 2
# #endregion core:code_factors


def code_spectral_model(source: str, m: int, kmax: int = 1024) -> dict:
    """Lines {l: weight} (l = m mod 8, |k| <= kmax), their total (Parseval) and R~[0..K] for mode m."""
    mm = mode_fold(m)                                      # lines l = mm + 8k (the same set as l = m mod 8)
    if source == 'acc1':
        lines = {mm + 8 * k: acc1_line_weight(mm + 8 * k) for k in range(-kmax, kmax + 1)}
        return dict(lines=lines, total=1.0, rtilde=[0.0])
    if source == 'dq':
        lines = {mm + 8 * k: dq_line_weight(m, k) for k in range(-kmax, kmax + 1)}
        wh = dq_white(m)
        return dict(lines=lines, total=1.0 - wh, rtilde=[wh])
    if source.startswith('rot'):
        D2 = rot_factor(int(source[3:]), m)
        lines = {mm + 8 * k: D2 * acc1_line_weight(mm + 8 * k) for k in range(-kmax, kmax + 1)}
        return dict(lines=lines, total=D2, rtilde=[1.0 - D2])
    if source == 'mash':
        f = mash_factors(m)
        return dict(lines={mm: f['phi2']}, total=f['phi2'], rtilde=f['rtilde'])
    raise ValueError(source)


# #region core:kappa_code
def kappa_mode_closed(loop: Loop, alpha: float, source: str, m: int, kmax: int = 1024) -> float:
    """Re kappa_m of code source `source` (closed form): lines x Re H_PD + short-memory correction with h_PD[k]."""
    sm = code_spectral_model(source, m, kmax)
    ells = np.array(list(sm['lines'].keys()), float)
    w = np.array(list(sm['lines'].values()))
    val = float(np.sum(w * np.real(loop.H((ells * alpha) % 1.0))))
    if source != 'mash':                                   # tail of the staircase lines: equidistributed mean of Re H
        ff = (np.arange(4096) + 0.5) / 4096
        val += (sm['total'] - float(np.sum(w))) * float(np.mean(np.real(loop.H(ff))))
    h = loop.impulse(len(sm['rtilde']))
    mm = mode_fold(m)
    for k, rt in enumerate(sm['rtilde']):
        val += h[k] * math.cos(2 * math.pi * mm * alpha * k) * rt   # ← 差異：spread part (white: only k = 0)
    return val


def kappa_phos_closed(loop: Loop, alpha: float, source: str, kmax: int = 1024) -> dict:
    """kappa_m (m = 1..7), the minimum and the worst mode."""
    km = [kappa_mode_closed(loop, alpha, source, m, kmax) for m in range(1, NPH)]
    i = int(np.argmin(km))
    return dict(kappa_m=km, kappa_min=km[i], worst_mode=i + 1)


def gos_closed(loop: Loop, alpha: float, source: str, M: int = 8192) -> dict:
    """GOS self-slope C_GOS = sum_k h[k] R~_c[k] for regressor c, with var(c) and E[c^2] (the simulator's reference)."""
    h = loop.impulse(4)
    beta = (NPH * alpha) % 1.0
    saw = gos_harmonic(alpha, gamma_eff(loop), M)          # sawtooth part (sections 7): sum_m w_m Re H(frac(m beta))
    var_saw = 1.0 / 12 if beta != 0 else 0.0
    if source == 'acc1':
        C, var, mean = saw, var_saw, 0.5
    elif source == 'dq':
        C, var, mean = h[0] / 6, 1.0 / 6, 1.0            # E[c | rho] = 1: the sawtooth cancels, only white 1/6 remains
    elif source.startswith('rot'):
        Mr = int(source[3:])
        C, var, mean = saw + h[0] * (Mr * Mr - 1) / 12, var_saw + (Mr * Mr - 1) / 12, 0.5 + (Mr - 1) / 2
    elif source == 'mash':
        C, var, mean = (6 * h[0] - 4 * h[1] + h[2]) / 12, 0.5, 2.0
    else:
        raise ValueError(source)
    return dict(C=float(C), var=float(var), mean=float(mean), kappa=float(C / var) if var > 0 else float('nan'),
                kappa_e2=float(C / (var + mean * mean)))
# #endregion core:kappa_code


def verdict_closed(loop: Loop, alpha: float, source: str, tau: float = 0.05) -> dict:
    """Closed-form verdict: 'inverted' (kappa_min < -tau), 'restoring' (> tau) or 'dead' (|kappa_min| <= tau)."""
    kp = kappa_phos_closed(loop, alpha, source)
    k = kp['kappa_min']
    v = 'inverted' if k < -tau else 'restoring' if k > tau else 'dead'
    return dict(kappa_min=k, worst_mode=kp['worst_mode'], kappa_m=kp['kappa_m'], verdict=v, tau=tau)


# --------------------------------------------------------------------------------------
# numerical checks on the actual sequence (exact for that record; linear small signal)
# --------------------------------------------------------------------------------------
def kappa_numeric(loop: Loop, alpha: float, source: str, N: int = 1 << 17, seed: int = 12345, n_pre: int = 1 << 12) -> dict:
    """Time-domain linear correlation of the actual sequence: kappa_m = <conj(z_m) (h_PD * z_m)> / <|z_m|^2>, z_m = e^{j 2 pi m p/8};
    C_GOS = <c~ (h_PD * c~)>, c~ = c - mean(c).  The first n_pre samples (filter transient) are discarded."""
    n = np.arange(-64, N + n_pre)
    c, p = code_sequence(alpha, source, n, seed)
    km = []
    for m in range(1, NPH):
        z = np.exp(2j * np.pi * m * p / NPH)
        y = signal.lfilter(loop.bH, loop.aH, z)
        km.append(float(np.real(np.mean(np.conj(z[n_pre:]) * y[n_pre:]))))
    cc = c - c.mean()
    yc = signal.lfilter(loop.bH, loop.aH, cc)
    i = int(np.argmin(km))
    return dict(kappa_m=km, kappa_min=km[i], worst_mode=i + 1, gos_C=float(np.mean(cc[n_pre:] * yc[n_pre:])),
                gos_var=float(cc[n_pre:].var()), code_mean=float(c.mean()), N=N)


def large_signal_code(loop: Loop, alpha: float, source: str, m: int = 1, amps: Sequence[float] = (1.0, 5.0),
                      cfg: Optional[dict] = None, N: int = 1 << 16, seed: int = 12345, n_pre: int = 1 << 12) -> dict:
    """1-bit (sign) correlation along the real mode-m direction d_k = cos(2 pi m k/8), on the actual sequence (section 10.4):
    kappa_inf = <sgn(y) z> / |<sgn(d) z>|, y = h_PD * d, d[n] = d_{p[n]}, z[n] = d_{p[n]};
    g(A) = <erf(A y/(sqrt2 sigma)) z> sigma/(A sqrt(2/pi)) normalised the same way (finite amplitude A in ps)."""
    cfg = cfg if cfg is not None else sim_cfg()
    sig = cfg['sigma']
    n = np.arange(-64, N + n_pre)
    _, p = code_sequence(alpha, source, n, seed)
    pat = np.cos(2 * np.pi * m * np.arange(NPH) / NPH)
    d = pat[p]
    y = signal.lfilter(loop.bH, loop.aH, d)[n_pre:]
    d = d[n_pre:]
    z = d
    s_cl = float(np.mean(np.sign(y) * z))
    s_ol = float(np.mean(np.sign(d) * z))
    kk = sig / math.sqrt(2 / math.pi)
    g = [float(np.mean(special.erf(A * y / (math.sqrt(2) * sig)) * z) * kk / A) for A in amps]
    g0 = [float(np.mean(special.erf(A * d / (math.sqrt(2) * sig)) * z) * kk / A) for A in amps]
    return dict(mode=m, amps=list(amps), kappa_inf=s_cl / abs(s_ol), g=[a / b for a, b in zip(g, g0)],
                lin=float(np.mean(y * z) / np.mean(d * z)), N=N)


# --------------------------------------------------------------------------------------
# closed-loop sign-error block LMS with a code source (the simulator.run_sign_lms core with c, p from code_sequence)
# --------------------------------------------------------------------------------------
def run_sign_lms_code(loop: Loop, alpha: float, source: str, cfg: Optional[dict] = None, n_blocks: int = 1500,
                      N_blk: int = 512, tau_blocks: float = 25.0, seed: int = 3, code_seed: Optional[int] = None,
                      rec_every: int = 20, N_settle: int = 4096, lanes: int = 1, u_os: float = 0.0,
                      variant: str = 'raw', models=None) -> dict:
    """Same algorithm as simulator.run_sign_lms (true 1-bit comparator, NLMS-style normalised steps), with the fractional
    sequence taken from `code_sequence` (code_seed defaults to seed).  Regressor index 0 is the DTC code c (with its offset)."""
    cfg = cfg if cfg is not None else sim_cfg()
    rng = np.random.default_rng(seed)
    sig, Dl, a, eps = cfg['sigma'], cfg['Delta'], cfg['a'], np.asarray(cfg['eps'])
    ccmp = math.sqrt(2 / math.pi) / sig
    mu_p = 8.0 / (tau_blocks * ccmp)
    mu_g = 12.0 / (tau_blocks * ccmp * Dl)
    n_total = N_settle + n_blocks * N_blk
    n_all = np.arange(-64, n_total)
    c_all, p_all = code_sequence(alpha, source, n_all, seed if code_seed is None else code_seed)

    def Xfun(nn):
        i = np.asarray(nn, np.int64) + 64
        return regressor_matrix(c_all[i], p_all[i])
    npre = np.arange(1 << 15)
    Rp = apply_variant(variant, Xfun, npre, models)[1 << 12:]
    mu_g *= (1 / 12) / max(Rp[:, 0].var(), 1e-12)
    mu_p *= (1 / 8) / max((Rp[:, 1:] ** 2).mean(), 1e-12)
    wg = np.zeros(lanes)
    W = np.zeros((lanes, NPH))
    zi = loop.zi_zeros(lanes)
    rec = dict(block=[], phos_rms_fs=[], phos_cm_fs=[], gos_err_fs=[])

    def inj(X):
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
    while n0 < N_settle:
        nn = np.arange(n0, n0 + N_blk)
        _, zi = loop.filt(inj(Xfun(nn)), axis=0, zi=zi)
        n0 += N_blk
    for b in range(n_blocks):
        nn = np.arange(n0, n0 + N_blk)
        X = Xfun(nn)
        R = apply_variant(variant, Xfun, nn, models)
        e, zi = loop.filt(inj(X), axis=0, zi=zi)
        n0 += N_blk
        if b % rec_every == 0:
            record(b)
        q = np.sign(e + rng.normal(0, sig, e.shape) + u_os)
        G = q.T @ R / N_blk
        wg += mu_g * G[:, 0]
        W += mu_p * G[:, 1:]
    record(n_blocks)
    rec['mu_g'], rec['mu_p'] = mu_g, mu_p
    return rec


def wilson_ci(k: int, n: int, z: float = 1.959963984540054) -> List[float]:
    """95 % Wilson score interval for a proportion k/n."""
    if n == 0:
        return [0.0, 1.0]
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, centre - half), min(1.0, centre + half)]


# #region core:divergence_mc
def divergence_mc(loop: Loop, alpha: float, source: str, seeds: Sequence[int] = tuple(range(8)), cfg: Optional[dict] = None,
                  n_blocks: int = 1500, N_blk: int = 512, tau_blocks: float = 25.0, grow: float = 2.0, shrink: float = 0.25) -> dict:
    """Multi-seed closed-loop verdict.  A seed 'diverged' if the final PHOS rms (common mode removed) exceeds grow x the initial
    value, 'converged' if it is below shrink x the initial value, otherwise 'undecided'.  Returns counts, fractions and 95 % CIs."""
    init = None
    finals, divs, convs = [], [], []
    for s in seeds:
        rec = run_sign_lms_code(loop, alpha, source, cfg, n_blocks=n_blocks, N_blk=N_blk, tau_blocks=tau_blocks, seed=s,
                                code_seed=1000 + s, rec_every=max(1, n_blocks // 50))
        f0 = float(rec['phos_rms_fs'][0][0])
        f1 = float(rec['phos_rms_fs'][-1][0])
        init = f0 if init is None else init
        finals.append(f1)
        divs.append(bool(f1 > grow * f0))
        convs.append(bool(f1 < shrink * f0))
    n = len(seeds)
    nd, nc = int(sum(divs)), int(sum(convs))
    return dict(seeds=list(seeds), init_fs=init, final_fs=finals, diverged=divs, converged=convs, n=n, n_div=nd, n_conv=nc,
                frac_div=nd / n, ci_div=wilson_ci(nd, n), frac_conv=nc / n, ci_conv=wilson_ci(nc, n),
                n_blocks=n_blocks, N_blk=N_blk, tau_blocks=tau_blocks, grow=grow, shrink=shrink)
# #endregion core:divergence_mc


# --------------------------------------------------------------------------------------
# candidate rules for the dead zone (case page section 10b.7).  F-CS.28 itself only has the linear stage: |kappa_min| <= tau
# is 'dead' and NOT scored.  The rules below are scored against the multi-seed MC so the page can show how well each one does;
# none of them is part of the verdict.
#   two_stage    : dead zone -> sign of the 1-bit large-signal slope kappa_inf along the closed form's worst mode (same tau)
#   two_stage_m1 : the same with kappa_inf along mode 1
#   efold        : the linear mean model over the MC window -- the slowest mode grows by G = exp(-kappa_min B / N_tau) in B blocks;
#                  G > grow  -> 'inverted' within the window,  G < shrink -> 'restoring' (every mode decays at least by G),
#                  otherwise undecided.  Equivalent to a window-dependent tau: kappa_div = N_tau ln(grow)/B, kappa_conv = N_tau ln(1/shrink)/B.
# --------------------------------------------------------------------------------------
def hint_verdict(kappa_inf: float, tau: float = 0.05) -> str:
    """Sign class of kappa_inf with the same tau (the two-stage rule's second stage)."""
    return 'inverted' if kappa_inf < -tau else 'restoring' if kappa_inf > tau else 'dead'


def two_stage_verdict(kappa_min: float, kappa_inf: float, tau: float = 0.05) -> str:
    """Linear stage first; in the dead zone the sign of kappa_inf decides (the REJECTED candidate rule: scored, not used)."""
    v = 'inverted' if kappa_min < -tau else 'restoring' if kappa_min > tau else 'dead'
    return hint_verdict(kappa_inf, tau) if v == 'dead' else v


def efold_window(n_blocks: int, tau_blocks: float, grow: float = 2.0, shrink: float = 0.25) -> dict:
    """Thresholds of the window rule: kappa_min < -kappa_div grows by more than `grow`, kappa_min > kappa_conv shrinks below `shrink`."""
    return dict(kappa_div=tau_blocks * math.log(grow) / n_blocks, kappa_conv=tau_blocks * math.log(1.0 / shrink) / n_blocks)


def efold_verdict(kappa_min: float, n_blocks: int, tau_blocks: float, grow: float = 2.0, shrink: float = 0.25) -> dict:
    """Window rule: growth factor of the slowest mode G = exp(-kappa_min n_blocks / tau_blocks) of the linear mean model (F-CS.2)."""
    G = math.exp(-kappa_min * n_blocks / tau_blocks)
    v = 'inverted' if G > grow else 'restoring' if G < shrink else 'dead'
    return dict(verdict=v, growth=G, **efold_window(n_blocks, tau_blocks, grow, shrink))


def crosscheck(verdict: str, mc: dict) -> dict:
    """Analytic verdict vs Monte Carlo: 'ok' when the MC majority (CI excluding 1/2) agrees with the verdict,
    'mismatch' when it disagrees, 'n/a' when the verdict is 'dead' (undecided) or the MC is undecided.  Used for F-CS.28 (linear
    stage) and, with the same rules, for the candidate dead-zone rules (two_stage, two_stage_m1, efold)."""
    lo_d, hi_d = mc['ci_div']
    lo_c, hi_c = mc['ci_conv']
    if verdict == 'dead':
        return dict(status='n/a', why='closed form in the dead zone: the linear model has no restoring force and makes no prediction')
    if verdict == 'inverted':
        if lo_d > 0.5:
            return dict(status='ok', why='MC majority diverged (CI lower bound > 1/2)')
        if hi_d < 0.5:
            return dict(status='mismatch', why='closed form predicts inversion but the MC majority did not diverge')
        return dict(status='n/a', why='MC CI contains 1/2: more seeds or blocks needed')
    if lo_c > 0.5:
        return dict(status='ok', why='MC majority converged (CI lower bound > 1/2)')
    if hi_d > 0 and lo_d > 0.5:
        return dict(status='mismatch', why='closed form predicts restoring but the MC majority diverged')
    return dict(status='n/a', why='MC CI contains 1/2 (slow convergence or undecided): more blocks needed')


# --------------------------------------------------------------------------------------
# alpha-uniform certificate (case page section 10b.7, F-CS.29): extends the section-7b certificate tools
# (gos_certificate.lipschitz / kernel_min give a certified lower bound g_min of Re H_PD over ALL frequencies)
# --------------------------------------------------------------------------------------
CERT_NF = 20001          # grid of kernel_min (slack L_g h/2 = L_g/(4 (nf - 1)), about 6e-4 for L2)
PM_SWEEP = (40.0, 45.0, 50.0, 55.0, 60.0, 65.0, 70.0)


# #region core:code_certificate
def code_mode_lower_bound(source: str, m: int, g_min: float, h: Sequence[float]) -> float:
    """Lower bound of Re kappa_m(alpha) over ALL alpha (F-CS.29).  Every line sits at some frequency where Re H_PD >= g_min,
    so the line part is >= (total line weight) g_min; the spread part is h[0] R~[0] plus terms with |cos| <= 1:
        LB_m = W_m g_min + R~_m[0] - sum_{k>=1} |h[k]| |R~_m[k]|,   W_m = total line weight (acc1 1, dq 1 - R~[0], rotM |D_M|^2, mash |phi_m|^2)."""
    sm = code_spectral_model(source, m, kmax=0)          # only the totals and R~ are used
    rt = sm['rtilde']
    lb = sm['total'] * g_min + h[0] * rt[0]
    for k in range(1, len(rt)):
        lb -= abs(h[k]) * abs(rt[k])                       # ← 差異：cos(2 pi m alpha k) replaced by its worst case
    return float(lb)


def code_certificate(loop: Loop, source: str, tau: float = 0.05, nf: int = CERT_NF, lip: Optional[dict] = None) -> dict:
    """alpha-uniform verdict from the certified g_min: lb_min > tau  => restoring for EVERY channel alpha;
    lb_min >= -tau => no channel is inverted (a dead zone is still possible); otherwise the certificate says nothing
    (scan kappa_min over alpha, F-CS.28).  Exact within the model of F-CS.27 (the lower bound itself has no approximation)."""
    lip = lip if lip is not None else gc.lipschitz(loop)
    km = gc.kernel_min(loop, lip['Lg'], nf)
    h = loop.impulse(3)
    lbs = [code_mode_lower_bound(source, m, km['g_min'], h) for m in range(1, NPH)]
    i = int(np.argmin(lbs))
    lb = lbs[i]
    status = 'restoring-all' if lb > tau else 'never-inverted' if lb >= -tau else 'inconclusive'
    return dict(source=source, lb_modes=lbs, lb_min=lb, worst_mode=i + 1, g_min=km['g_min'], grid_min=km['grid_min'],
                f_at_min=km['f_at_min'], Lg=lip['Lg'], h=[float(x) for x in h], status=status, tau=tau, nf=nf)
# #endregion core:code_certificate


def mash_kappa_min_scan(loop: Loop, n_alpha: int = 2000, f_ref: float = 4e9) -> dict:
    """Closed-form MASH kappa_min on the 1 MHz grid alpha_j = j * 1e6 / f_ref, j = 1..n_alpha (single carrier line per mode,
    so the scan is cheap): its minimum, where, and the dead-zone / inverted ranges for tau = 0.05."""
    a = np.arange(1, n_alpha + 1) * 1e6 / f_ref
    h = loop.impulse(3)
    km = np.full(a.shape, np.inf)
    for m in range(1, NPH):
        f = mash_factors(m)
        mm = mode_fold(m)
        k = f['phi2'] * np.real(loop.H((mm * a) % 1.0))
        for kk, rt in enumerate(f['rtilde']):
            k = k + h[kk] * np.cos(2 * np.pi * mm * a * kk) * rt
        km = np.minimum(km, k)
    j = int(np.argmin(km))
    fz = np.arange(1, n_alpha + 1).astype(float)          # alpha_j f_ref = j MHz exactly (no rounding)
    dead = fz[np.abs(km) <= 0.05]
    inv = fz[km < -0.05]
    return dict(min=float(km[j]), f_MHz_at_min=float(fz[j]), dead_MHz=[float(dead.min()), float(dead.max())] if len(dead) else None,
                inverted_MHz=[float(inv.min()), float(inv.max())] if len(inv) else None, n_alpha=n_alpha)
