# -*- coding: utf-8 -*-
"""GOS 'no inversion at D = 0': from conjecture to theorem (page section 7b; docs/analysis/sspll-gos-d0-theorem.md).

Model (same as section 7): linearised PLL, D = 0, raw regressor, frozen weights.  C(beta) = sum_m w_m g(frac(m beta)),
w_m = 1/(2 pi^2 m^2), g(f) = Re H_PD(f) (1-periodic, even).

  L1: Re H_PD >= 0 everywhere (closed form) -> every term >= 0 -> one line (typeI_positive).
  L2 / L3: computer-assisted certificate (certificate):
    (1) Lipschitz constant of g: L_g = 2 pi sum_n n |h[n]| (term-wise derivative of g(f) = sum h[n] cos 2 pi f n);
        the tail n > N is bounded through the residue expansion h[n] = sum_i c_i lambda_i^n;
    (2) C_M(beta) = sum_{m<=M} w_m g(frac(m beta)) is Lipschitz in beta with Lambda_M = L_g H_M / (2 pi^2);
    (3) tail sum_{m>M} w_m g >= g_min T_M, T_M = sum_{m>M} w_m = psi'(M+1)/(2 pi^2), g_min = grid min - L_g h/2;
    (4) at beta_i: LB_i = C_M(beta_i) + g_min T_M > 0  =>  C > 0 on [beta_i, beta_i + LB_i/Lambda_M];
    (5) walk from beta_0 to 1/2 with beta_{i+1} = beta_i + LB_i/Lambda_M (every point is recomputed); C(beta) = C(1-beta).
  A passing certificate is a proof inside the model (floating point ~1e-13 << smallest LB ~1e-3); a failing one is not a counter-example.
The TypeScript port is src/pages/case-sspll/gosTheorem.ts (gosTheorem.test.ts compares against results/gos_certificate.json).
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
from scipy import special

from .loops import Loop, typeI_ReH

TWO_PI2 = 2 * math.pi ** 2


def harmonic_weight(m):
    """w_m = 1/(2 pi^2 m^2)."""
    m = np.asarray(m, float)
    return 1.0 / (TWO_PI2 * m * m)


def harmonic_number(M: int) -> float:
    return float(np.sum(1.0 / np.arange(1, M + 1)))


def harmonic_tail_weight(M: int) -> float:
    """T_M = sum_{m>M} w_m = psi'(M+1)/(2 pi^2)."""
    return float(special.polygamma(1, M + 1)) / TWO_PI2


# #region core:typeI_positive
def typeI_positive(K: float, beta: float, M: int = 1000) -> dict:
    """L1 one-line proof: Re H_PD = (2-K)(1-cos W)/|1-(1-K)e^{-jW}|^2 >= 0 for 0 < K < 2, zero only at integer f.
    Every harmonic weight is > 0, so C(beta) >= 0; the m = 1 term is strictly positive when beta is not an integer."""
    if not (0 < K < 2):
        return dict(ok=False, first_term=float('nan'), partial=float('nan'))
    b = beta % 1.0
    first = float(harmonic_weight(1) * typeI_ReH(K, b))
    m = np.arange(1, M + 1)
    partial = float(np.sum(harmonic_weight(m) * typeI_ReH(K, (m * b) % 1.0)))
    return dict(ok=bool(b != 0.0 and first > 0), first_term=first, partial=partial)
# #endregion core:typeI_positive


def _residues(lp: Loop):
    """H(z) = B(z)/A(z) as polynomials in z (descending): poles lambda_i, residues c_i with h[n] = c0 d[n] + sum c_i lambda_i^n."""
    p = max(len(lp.bH), len(lp.aH)) - 1
    B = np.zeros(p + 1)
    A = np.zeros(p + 1)
    B[:len(lp.bH)] = lp.bH
    A[:len(lp.aH)] = lp.aH
    lam = np.roots(A)
    dA = np.polyder(A)
    scale = max(1.0, float(np.max(np.abs(A))))
    valid = abs(A[p]) > 1e-12 * scale
    coef = np.zeros(len(lam), complex)
    for i, l in enumerate(lam):
        den = l * np.polyval(dA, l)
        if abs(l) < 1e-9 or abs(den) < 1e-12 * scale:
            valid = False
            break
        coef[i] = np.polyval(B, l) / den
    return lam, coef, valid


# #region core:lipschitz
def lipschitz(lp: Loop, N: int = 4096) -> dict:
    """L_g = 2 pi (sum_{n<=N} n|h[n]| + tail bound); tail from the residue expansion, verified against h[n] for 1 <= n < 60."""
    h = lp.impulse(N + 1)
    n = np.arange(N + 1)
    sumN = float(np.sum(n[1:] * np.abs(h[1:])))
    hmax = float(np.max(np.abs(h[1:])))
    lam, coef, valid = _residues(lp)
    err = float('nan')
    if valid:
        k = np.arange(1, min(60, N + 1))
        rec = np.real(np.sum(coef[:, None] * lam[:, None] ** k[None, :], axis=0))
        err = float(np.max(np.abs(rec - h[1:len(k) + 1])))
    rho = np.abs(lam)
    rho_max = float(rho.max()) if len(rho) else 0.0
    bounded = bool(valid and rho_max < 1 and err <= 1e-9 * max(1.0, hmax))
    tail = float('nan')
    if bounded:
        tail = float(np.sum(np.abs(coef) * rho ** (N + 1) * ((N + 1) * (1 - rho) + rho) / (1 - rho) ** 2))
    return dict(Lg=2 * math.pi * (sumN + (tail if bounded else 0.0)), sumN=sumN, tail=tail, N=N, rho_max=rho_max,
                residual_err=err, tail_bounded=bounded)
# #endregion core:lipschitz


def kernel_min(lp: Loop, Lg: float, nf: int = 200001) -> dict:
    """Lower bound of g = Re H_PD: grid minimum on f_j = j/(2(nf-1)) minus L_g h/2 (clipped at 0: only the negative part is needed)."""
    f = np.linspace(0.0, 0.5, nf)
    g = lp.H(f).real
    j = int(np.argmin(g))
    h = 0.5 / (nf - 1)
    return dict(g_min=min(0.0, float(g[j]) - Lg * h / 2), grid_min=float(g[j]), f_at_min=float(f[j]))


def partial_sum(lp: Loop, beta: float, M: int) -> float:
    """C_M(beta) = sum_{m<=M} w_m g(frac(m beta))."""
    m = np.arange(1, M + 1)
    return float(np.sum(harmonic_weight(m) * lp.H((m * beta) % 1.0).real))


# #region core:certificate
def certificate(lp: Loop, beta_min: float = 0.016, beta_max: float = 0.5, M: int = 1000, nf: int = 200001,
                N: int = 4096, max_steps: int = 200000) -> dict:
    """Walk beta_0 -> beta_max: LB_i = C_M(beta_i) + g_min T_M; LB_i > 0 => C > 0 on [beta_i, beta_i + LB_i/Lambda_M] (Lipschitz);
    the next grid point is beta_i + LB_i/Lambda_M (recomputed).  Reaching beta_max proves C > 0 on [beta_0, beta_max]."""
    lip = lipschitz(lp, N)
    LamM = lip['Lg'] * harmonic_number(M) / TWO_PI2
    km = kernel_min(lp, lip['Lg'], nf)
    TM = harmonic_tail_weight(M)
    tail_lower = km['g_min'] * TM
    out = dict(beta_min=beta_min, beta_max=beta_max, M=M, Lg=lip['Lg'], LamM=LamM, g_min=km['g_min'], tail_weight=TM,
               tail_lower=tail_lower, lipschitz=lip)
    if not lip['tail_bounded']:
        return dict(out, ok=False, reason='tail not bounded', steps=0, worst_lower=float('nan'), worst_at=float('nan'),
                    min_step=float('nan'))
    beta = beta_min
    steps = 0
    worst = (math.inf, beta_min)
    min_step = math.inf
    while beta < beta_max:
        lb = partial_sum(lp, beta, M) + tail_lower
        if not lb > 0:
            return dict(out, ok=False, reason=f'LB <= 0 at beta = {beta}', steps=steps, worst_lower=worst[0],
                        worst_at=worst[1], min_step=min_step, fail_at=beta)
        if lb < worst[0]:
            worst = (lb, beta)
        step = lb / LamM
        min_step = min(min_step, step)
        beta = min(beta_max, beta + step)
        steps += 1
        if steps > max_steps:
            return dict(out, ok=False, reason='too many steps', steps=steps, worst_lower=worst[0], worst_at=worst[1],
                        min_step=min_step, fail_at=beta)
    lb_end = partial_sum(lp, beta_max, M) + tail_lower
    if not lb_end > 0:
        return dict(out, ok=False, reason='LB <= 0 at beta_max', steps=steps, worst_lower=worst[0], worst_at=worst[1],
                    min_step=min_step, fail_at=beta_max)
    if lb_end < worst[0]:
        worst = (lb_end, beta_max)
    return dict(out, ok=True, steps=steps, worst_lower=worst[0], worst_at=worst[1], min_step=min_step)
# #endregion core:certificate


def point_certificate(lp: Loop, beta: float, M: int = 4, lip: Optional[dict] = None, g_min: Optional[float] = None) -> dict:
    """Single-point certificate (hand calculation HC-CS.10): the first M terms listed, the tail bounded by g_min."""
    l = lip or lipschitz(lp)
    gm = kernel_min(lp, l['Lg'])['g_min'] if g_min is None else g_min
    m = np.arange(1, M + 1)
    f = (m * beta) % 1.0
    g = lp.H(f).real
    w = harmonic_weight(m)
    CM = float(np.sum(w * g))
    TM = harmonic_tail_weight(M)
    lower = CM + gm * TM
    LamM = l['Lg'] * harmonic_number(M) / TWO_PI2
    return dict(beta=beta, M=M, terms=[dict(m=int(mm), f=float(ff), g=float(gg), w=float(ww), contrib=float(ww * gg))
                                       for mm, ff, gg, ww in zip(m, f, g, w)],
                CM=CM, g_min=gm, tail_weight=TM, tail_lower=gm * TM, lower=lower, Lg=l['Lg'], LamM=LamM, delta=lower / LamM)
