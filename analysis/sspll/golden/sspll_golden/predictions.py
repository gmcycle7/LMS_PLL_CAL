#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
predictions.py -- mean-GMAC (Bussgang-linear) theory for the GOS / PHOS sign-error LMS.

Core identity (steady state, real regressors, LTI loop):
    C_ij = < r_i[n] (h_PD * x_j)[n] >  =  sum_lines conj(c^i_nu) c^j_nu Gamma_eff(f_nu),
    Gamma_eff(f) = H_PD(e^{j2pi f}) conj(G(e^{j2pi f}))      (G = GMAC pre-filter, raw: G = 1)
Mean LMS dynamics (sign-error, Bussgang gain K_q = sqrt(2/pi)/sigma_v):
    d theta = -mu K_q C theta    -> converges iff Re eig(C) > 0 on the observable subspace
    (small-mu limit; finite block step: |1 - kappa/tau| < 1, see block_mean_stable).
Normalisations used throughout:
    kappa_PHOS = min Re eig(C_PHOS, observable) / open-loop reference   (= 8 Re lambda for 8 | Q)
    kappa_m    = 8 lambda_m  (DFT mode m of the circulant PHOS block; complex)
    kappa_GOS  = C_GOS / var(rho)                                          (= 12 C_GOS, long periods)
"""
from __future__ import annotations

import math
from fractions import Fraction
from typing import Callable, Dict, Optional, Sequence

import numpy as np
from scipy import special

from .loops import Loop, TWO_PI, F_REF
from .regressors import (NPH, W1, X_rational, acc_side, regressor_matrix, seq_rational, variant_G)


# ======================================================================================
# effective kernel
# ======================================================================================
# #region core:gamma_eff
def gamma_eff(loop: Optional[Loop], variant: str = 'raw', models: Optional[Dict] = None,
              open_loop: bool = False) -> Callable:
    """Gamma_eff(f) = H_PD(f) conj(G(f));  open_loop=True -> H_PD == 1."""
    def G(f):
        g = np.conj(variant_G(variant, f, models))
        return g if open_loop else loop.H(f) * g
    return G
# #endregion core:gamma_eff


# ======================================================================================
# exact periodic steady state (rational alpha)
# ======================================================================================
# #region core:C_periodic
def C_periodic(P: int, Q: int, Geff: Callable, side: str = 'right', return_cov: bool = False):
    """EXACT long-run 9x9 C_ij for the Q-periodic regressors of alpha = P/Q (all lines,
    including l = 0 multiplied by Gamma_eff(0), which is 0 for any loop of type >= 1)."""
    X = X_rational(P, Q, np.arange(Q), side).T                    # (9, Q)
    F = np.fft.fft(X, axis=1) / Q
    G = Geff(np.arange(Q) / Q)
    C = np.real((np.conj(F) * G) @ F.T)
    if not return_cov:
        return C
    mu = X.mean(axis=1)
    cov = X @ X.T / Q - np.outer(mu, mu)
    return C, cov, mu
# #endregion core:C_periodic


def _obs_basis(cov: np.ndarray, idx, tol: float = 1e-7) -> np.ndarray:
    Cs = cov[np.ix_(idx, idx)]
    w, V = np.linalg.eigh(Cs)
    keep = w > tol * max(np.trace(Cs), 1e-30)
    return V[:, keep]


def dft_mode_eigs(Cpp: np.ndarray) -> np.ndarray:
    """lambda_m = v_m^H C v_m / 8, v_m[k] = e^{j 2 pi m k/8}, m = 0..7 (exact eigenvalues when
    C is circulant, i.e. 8 | Q or irrational alpha; Rayleigh quotients otherwise)."""
    k = np.arange(NPH)
    out = np.zeros(NPH, complex)
    for m in range(NPH):
        v = np.exp(2j * np.pi * m * k / NPH)
        out[m] = np.conj(v) @ Cpp @ v / NPH
    return out


def analyse_C(C: np.ndarray, cov: np.ndarray) -> dict:
    """GOS scalar C[0,0] (if observable), min Re eig of C restricted to the observable PHOS
    subspace (common mode removed automatically) and of the joint 9x9."""
    out = {'gos_observable': bool(cov[0, 0] > 1e-9)}
    out['gos'] = float(C[0, 0]) if out['gos_observable'] else float('nan')
    Vp = _obs_basis(cov, list(range(1, 1 + NPH)))
    if Vp.shape[1]:
        ev = np.linalg.eigvals(Vp.T @ C[1:, 1:] @ Vp)
        out['phos_min_re'] = float(ev.real.min())
        out['phos_eigs'] = sorted(ev.tolist(), key=lambda z: z.real)
    else:
        out['phos_min_re'] = float('nan')
        out['phos_eigs'] = []
    out['phos_n_obs'] = int(Vp.shape[1])
    Vj = _obs_basis(cov, list(range(1 + NPH)))
    ev = np.linalg.eigvals(Vj.T @ C @ Vj) if Vj.shape[1] else np.array([np.nan])
    out['joint_min_re'] = float(np.real(ev).min())
    out['joint_eigs'] = sorted(np.asarray(ev).tolist(), key=lambda z: z.real)
    out['joint_n_obs'] = int(Vj.shape[1])
    out['dft_lambda'] = dft_mode_eigs(C[1:, 1:]).tolist()
    return out


def kappa_rational(loop: Loop, P: int, Q: int, variant: str = 'raw', models: Optional[Dict] = None,
                   side: str = 'right', Mx: Optional[np.ndarray] = None) -> dict:
    """Normalised exact-periodic kappas for alpha = P/Q (ideal injection model unless Mx given):
    kP = min Re eig(PHOS obs) / open-loop min eig, kG = C_GOS/var(rho), kJ = joint / PHOS ref,
    km = 8 lambda_m (m = 1..4, complex)."""
    C, cov, mu = C_periodic(P, Q, gamma_eff(loop, variant, models), side, True)
    C0 = C_periodic(P, Q, gamma_eff(None, 'raw', None, open_loop=True), side)
    if Mx is not None:
        C = C @ Mx
        C0 = C0 @ Mx
    a = analyse_C(C, cov)
    a0 = analyse_C(C0, cov)
    ref_p = a0['phos_min_re']
    out = dict(P=P, Q=Q, side=side,
               kP=a['phos_min_re'] / ref_p if np.isfinite(ref_p) and ref_p > 0 else float('nan'),
               kG=a['gos'] / cov[0, 0] if a['gos_observable'] else float('nan'),
               kJ=a['joint_min_re'] / ref_p if np.isfinite(ref_p) and ref_p > 0 else float('nan'),
               km=[NPH * complex(a['dft_lambda'][m]) for m in range(1, 5)],
               phos_n_obs=a['phos_n_obs'], var_rho=float(cov[0, 0]), mean_rho=float(mu[0]),
               occupancy=mu[1:].tolist(), C=C)
    return out


# ======================================================================================
# ergodic (irrational alpha) harmonic sums
# ======================================================================================
def gos_harmonic(alpha: float, Geff: Callable, M: int = 8192) -> float:
    """C_GOS = sum_{m>=1} Re Gamma_eff(frac(m beta)) / (2 pi^2 m^2),  beta = frac(8 alpha).
    (Irrational alpha; the tail beyond M uses the equidistributed mean of Re Gamma.)"""
    beta = (NPH * float(alpha)) % 1.0
    if beta == 0.0:
        return 0.0
    m = np.arange(1, M + 1)
    val = np.sum(np.real(Geff((m * beta) % 1.0)) / (2 * np.pi ** 2 * m ** 2))
    ff = (np.arange(4096) + 0.5) / 4096
    val += float(np.mean(np.real(Geff(ff)))) * special.polygamma(1, M + 1) / (2 * np.pi ** 2)
    return float(val)


def phos_lambda_harmonic(alpha: float, Geff: Callable, M: int = 8192) -> np.ndarray:
    """lambda_m = 8 sum_{l = m mod 8, l != 0} |c_l|^2 Gamma_eff(frac(l alpha)), l over positive AND
    negative integers, |c_l|^2 = sin^2(pi l/8)/(pi l)^2;  lambda_0 = 0 (common mode)."""
    lam = np.zeros(NPH, complex)
    kmax = M // NPH + 1
    ff = (np.arange(4096) + 0.5) / 4096
    mean_g = complex(np.mean(Geff(ff)))
    for m in range(1, NPH):
        ell = np.concatenate([m + NPH * np.arange(0, kmax), m - NPH * np.arange(1, kmax + 1)]).astype(float)
        w = np.sin(np.pi * ell / NPH) ** 2 / (np.pi ** 2 * ell ** 2)
        lam[m] = NPH * np.sum(w * Geff((ell * float(alpha)) % 1.0))
        s2 = math.sin(math.pi * m / NPH) ** 2 / math.pi ** 2
        t = (special.zeta(2, kmax + m / NPH) + special.zeta(2, kmax + 1 - m / NPH)) / NPH ** 2
        lam[m] += NPH * s2 * t * mean_g.real
    return lam


def single_line_phos(alpha: float, Geff: Callable) -> float:
    """Dominant-line approximation  8 Re lambda_1 ~ W1 Re Gamma_eff(alpha),  W1 = 0.94964."""
    return float(W1 * np.real(Geff(np.array([alpha % 1.0])))[0])


def phos_m1_bounds(loop: Loop, alpha: float, variant: str = 'raw', models=None, n: int = 500001) -> tuple:
    """Rigorous bounds (ergodic or 8 | Q):  W1 ReG(a) + (1-W1) min ReG <= 8 Re lambda_1 <= W1 ReG(a) + (1-W1) max ReG."""
    G = gamma_eff(loop, variant, models)
    f = np.linspace(1e-7, 0.5, n)
    g = np.real(G(f))
    ga = float(np.real(G(np.array([alpha % 1.0])))[0])
    return W1 * ga + (1 - W1) * g.min(), W1 * ga + (1 - W1) * g.max()


def mode1_sure_band(loop: Loop, n: int = 500001, f_ref: float = F_REF) -> dict:
    """Frequencies alpha*f_ref where mode-1 inversion is GUARANTEED (Re H < -(1-W1) max Re H / W1) and
    the frequency above which a mode-1 inversion is impossible (W1 Re H + (1-W1) min Re H >= 0)."""
    f = np.linspace(1e-6, 0.5, n)
    h = loop.H(f).real
    thr = -(1 - W1) * h.max() / W1
    sure = f[h < thr]
    poss = f[(W1 * h + (1 - W1) * h.min()) < 0]
    return dict(threshold_ReH=float(thr), max_ReH=float(h.max()), min_ReH=float(h.min()),
                sure_MHz=[float(sure.min() * f_ref / 1e6), float(sure.max() * f_ref / 1e6)] if len(sure) else None,
                impossible_above_MHz=float(poss.max() * f_ref / 1e6) if len(poss) else 0.0)


# ======================================================================================
# kernels of the remedies, PSD theorem, disc constant
# ======================================================================================
def _fgrid(n: int = 200001, lo: float = 1e-8):
    return np.concatenate([np.geomspace(lo, 1e-3, 2000, endpoint=False), np.linspace(1e-3, 0.5, n)])


def kernel_min(loop: Loop, variant: str = 'raw', models=None, n: int = 200001) -> dict:
    """min_f Re Gamma_eff(f).  THEOREM: Re Gamma_eff >= 0 for all f  =>  Re eig(C) >= 0 of the joint
    9x9 for EVERY alpha (field of values: lambda = sum_nu |a_nu^T v|^2 Gamma_nu for a unit eigenvector v)."""
    f = _fgrid(n)
    g = np.real(gamma_eff(loop, variant, models)(f))
    i = int(np.argmin(g))
    neg = g < -1e-15
    return dict(min=float(g[i]), f_at_min=float(f[i]), any_negative=bool(neg.any()),
                neg_f_max=float(f[neg].max()) if neg.any() else None)


def one_diff_margin(loop: Loop, n: int = 200001) -> dict:
    """1st-difference regressor: Re{H(1-e^{jW})} >= 0  <=>  g(W) = 1 - cos W + Re{(1-e^{-jW}) L} >= 0
    (uses h_PD[0] = 1).  Type-II closed form: g = 1 - Ki/2 - (1-Kp) cos W, min = Kp - Ki/2 (Kp < 1)."""
    f = np.concatenate([np.geomspace(1e-5, 1e-3, 2000, endpoint=False), np.linspace(1e-3, 0.5, n)])
    W = TWO_PI * f
    g = 1 - np.cos(W) + np.real((1 - np.exp(-1j * W)) * loop.L(f))
    i = int(np.argmin(g))
    return dict(min=float(g[i]), f_at_min=float(f[i]))


def disc_constant(loop: Loop, variant: str = '1diff', models=None, n: int = 200001) -> float:
    """c = min_f Re Gamma / |Gamma|^2.  If c > 0:  Re lambda >= c |lambda|^2 / (v^H R v)  (Cauchy-Schwarz),
    so the block update is mean-stable for mu K_q lambda_max(R) < 2c, independent of alpha."""
    f = np.concatenate([np.geomspace(1e-7, 1e-3, 4000, endpoint=False), np.linspace(1e-3, 0.5, n)])
    G = gamma_eff(loop, variant, models)(f)
    return float(np.min(G.real / np.abs(G) ** 2))


def block_mean_stable(kappas, tau: float) -> bool:
    """Finite-step block LMS (sim normalisation: tau blocks = open-loop time constant, kappa = 8 lambda):
    theta_{k+1} = (1 - kappa/tau) theta_k  is stable iff |1 - kappa/tau| < 1  <=>  Re kappa > |kappa|^2/(2 tau)."""
    k = np.asarray(kappas, complex)
    return bool(np.all(np.abs(1 - k / tau) < 1))


def gos_small_beta(loop: Loop, beta: float, D: int = 0, nstep: int = 80000) -> float:
    """Slow-sawtooth asymptote: C_GOS ~ (beta/2)(S_inf - 2 S_D) - beta^2 sum_m m s[m];
    Type-II (S_inf = 0) at D = 0 gives beta^2/Ki;  Type-I gives ~ beta/(2K); Type-II at D = 1 ~ -beta."""
    s = loop.step(nstep)
    S_inf = float(s.sum())
    S_D = float(s[:D].sum()) if D > 0 else 0.0
    lead = 0.5 * beta * (S_inf - 2 * S_D)
    if loop.ltype == 2 and D == 0:
        return beta ** 2 / loop.params.get('Ki', loop.params.get('K', np.nan))
    return lead


# ======================================================================================
# physical injection model of the time-domain simulator (illustrative f_vco, a, eps)
# ======================================================================================
def sim_cfg(f_vco: float = 16e9, sigma_v: float = 0.200, a: float = 0.03, eps_seed: int = 7,
            eps_rms: float = 0.25) -> dict:
    """Configuration of analysis/sspll/sim (ps units): DTC gain error a, PMUX offsets eps (seed 7)."""
    rng = np.random.default_rng(eps_seed)
    eps = rng.normal(0.0, eps_rms, NPH)
    eps = eps - eps.mean()
    t_vco = 1e12 / f_vco
    return dict(f_vco=f_vco, T_vco=t_vco, Delta=t_vco / NPH, sigma=sigma_v, a=a, eps=eps,
                wg_star=a / (1.0 - a), delta_pert=0.03)


def physical_mix(cfg: Optional[dict]) -> np.ndarray:
    """Column mixing of the simulator's injection model at the calibrated point:
    du/dtheta_g = -(1-a)(rho + eps_p/Delta),  du/dtheta_k = -1{p=k}.  C_phys = C_ideal @ Mx."""
    Mx = np.eye(1 + NPH)
    if cfg is None:
        return Mx
    Mx[0, 0] = 1 - cfg['a']
    Mx[1:, 0] = (1 - cfg['a']) * np.asarray(cfg['eps']) / cfg['Delta']
    return Mx


def theory_point(loop: Loop, alpha: float, variant: str = 'raw', models=None, cfg: Optional[dict] = None,
                 side: Optional[str] = None, maxQ: int = 1 << 16) -> dict:
    """Exact periodic steady state at the exact rational of alpha (denominator <= maxQ); side 'auto'
    = the 32-bit accumulator's side.  Returns closed-loop analysis + open-loop (H == 1) reference
    with the simulator's normalisation (the open-loop reference keeps the regressor DC)."""
    fr = Fraction(alpha).limit_denominator(maxQ)
    P, Q = fr.numerator, fr.denominator
    if side in (None, 'auto'):
        side = acc_side(alpha)
    Mx = physical_mix(cfg)
    C, cov, mu = C_periodic(P, Q, gamma_eff(loop, variant, models), side, True)
    C0 = C_periodic(P, Q, gamma_eff(None, 'raw', None, open_loop=True), side)
    a = analyse_C(C @ Mx, cov)
    a0 = analyse_C(C0 @ Mx, cov)
    a.update(P=P, Q=Q, side=side, open_loop=dict(gos=a0['gos'], phos_min_re=a0['phos_min_re']),
             var_c=float(cov[0, 0]), mean_c=float(mu[0]))
    a['kP_simnorm'] = a['phos_min_re'] / a0['phos_min_re']
    a['kG_simnorm'] = a['gos'] / a0['gos'] if a['gos_observable'] else float('nan')
    return a


# ======================================================================================
# large signal (1-bit comparator, A >> sigma_v)
# ======================================================================================
def phos_dirs() -> Dict[str, np.ndarray]:
    """Unit directions in theta = [w_g Delta, w_0..w_7] (ps): GOS and real DFT PHOS modes."""
    k = np.arange(NPH)
    d = {'gos': np.r_[1.0, np.zeros(NPH)]}
    for nm, v in (('phos_m1c', np.cos(2 * np.pi * k / 8)), ('phos_m1s', np.sin(2 * np.pi * k / 8)),
                  ('phos_m2c', np.cos(2 * np.pi * 2 * k / 8)), ('phos_m3c', np.cos(2 * np.pi * 3 * k / 8)),
                  ('phos_m4', np.cos(np.pi * k))):
        d[nm] = np.r_[0.0, v / np.linalg.norm(v)]
    return d


def large_signal_periodic(loop: Loop, alpha: float, amps: Sequence[float] = (), cfg: Optional[dict] = None,
                          variant: str = 'raw', models=None, side: Optional[str] = None, maxQ: int = 1 << 16,
                          dirs: Optional[Dict[str, np.ndarray]] = None, PQ: Optional[tuple] = None) -> dict:
    """Exact periodic secant slope along each direction v:
         g_v(A) = <erf(A y_v/(sqrt2 sigma)) z_v> sigma/(A sqrt(2/pi)),  y_v = h_PD * d_v,
    A -> 0 gives C_vv; A -> inf gives (sigma/A sqrt(2/pi)) <sgn(y_v) z_v>.
    kappa_inf = <sgn(y_v) z_v> / |<sgn(d_v) x_v>|  (open-loop-normalised 1-bit correlation)."""
    cfg = cfg if cfg is not None else sim_cfg()
    dirs = dirs or phos_dirs()
    if PQ is None:
        fr = Fraction(alpha).limit_denominator(maxQ)
        P, Q = fr.numerator, fr.denominator
    else:
        P, Q = PQ
    if side in (None, 'auto'):
        side = acc_side(alpha)
    n = np.arange(Q)
    X = regressor_matrix(*seq_rational(P, Q, n, side))
    Mx = physical_mix(cfg)
    Hl = loop.H(n / Q)
    Gl = variant_G(variant if variant not in ('ac', 'zm') else 'raw', n / Q, models)
    FX = np.fft.fft(X, axis=0)
    Rv = np.real(np.fft.ifft(FX * Gl[:, None], axis=0))
    if variant in ('ac', 'zm'):          # the regressor DC matters for the 1-bit correlation
        Rv[:, 0] -= 0.5
        if variant == 'zm':
            Rv[:, 1:] -= 1.0 / NPH
    sig = cfg['sigma']
    kk = sig / math.sqrt(2 / math.pi)
    out = {}
    for nm, v in dirs.items():
        d = X @ (Mx @ v)
        y = np.real(np.fft.ifft(np.fft.fft(d) * Hl))
        z = Rv @ v
        zr = X @ v
        g = [float(np.mean(special.erf(A * y / (math.sqrt(2) * sig)) * z) * kk / A) for A in amps]
        g0 = [float(np.mean(special.erf(A * d / (math.sqrt(2) * sig)) * zr) * kk / A) for A in amps]
        s_cl = float(np.mean(np.sign(y) * z))
        s_ol = float(np.mean(np.sign(d) * zr))
        out[nm] = dict(g=g, g_open_loop=g0, lin=float(np.mean(y * z)), sign_corr=s_cl, sign_corr_ol=s_ol,
                       kappa_inf=(s_cl / abs(s_ol) if abs(s_ol) > 1e-12 else float('nan')))
    out['_meta'] = dict(P=P, Q=Q, side=side)
    return out


def kappa_inf_worst(ls: dict) -> float:
    vals = [v['kappa_inf'] for k, v in ls.items() if not k.startswith('_')]
    return float(np.nanmin(vals))


# ======================================================================================
# comparator DC offset (forcing term; not visible in eig(C))
# ======================================================================================
def Eq_offset(u_os: float, sigma: float) -> float:
    """E[q] for q = sign(e + v + u_os) at e = 0, v ~ N(0, sigma^2)."""
    return float(special.erf(u_os / (math.sqrt(2) * sigma)))


def Kq_offset(u_os: float, sigma: float) -> float:
    """Bussgang gain about the offset operating point: sqrt(2/pi)/sigma exp(-u^2/(2 sigma^2))."""
    return math.sqrt(2 / math.pi) / sigma * math.exp(-u_os ** 2 / (2 * sigma ** 2))


def gos_offset_bias(C_gos: float, rho_mean: float, u_os: float, sigma: float) -> float:
    """Stationary GOS error (same unit as u_os) of the RAW (non-zero-mean) regressor:
    Delta (a - w) = -E[q] <rho> / (K_q(u) C_GOS)   (p-p of the residual sawtooth)."""
    return -Eq_offset(u_os, sigma) * rho_mean / (Kq_offset(u_os, sigma) * C_gos)


# ======================================================================================
# sign maps and interval helpers
# ======================================================================================
def intervals(xs, mask) -> list:
    """Contiguous runs of True in mask -> [[x_first, x_last], ...]."""
    out = []
    i = 0
    xs = list(xs)
    mask = list(mask)
    while i < len(xs):
        if mask[i]:
            j = i
            while j + 1 < len(xs) and mask[j + 1]:
                j += 1
            out.append([xs[i], xs[j]])
            i = j + 1
        else:
            i += 1
    return out


def sign_map_j4096(loop: Loop, variant: str = 'raw', models=None, jmax: int = 2048) -> dict:
    """kappa_PHOS (normalised by the open-loop min eig), kappa_GOS and 8 Re lambda_1..4 on alpha = j/4096
    (exact, floor convention, ideal injection model)."""
    js = np.arange(1, jmax + 1)
    kP = np.zeros(len(js))
    kG = np.zeros(len(js))
    km = np.zeros((len(js), 4), complex)
    for i, j in enumerate(js):
        g = math.gcd(int(j), 4096)
        r = kappa_rational(loop, int(j) // g, 4096 // g, variant, models)
        kP[i], kG[i] = r['kP'], r['kG']
        km[i] = r['km']
    return dict(j=js, f_MHz=js * F_REF / 4096 / 1e6, kP=kP, kG=kG, km=km)
