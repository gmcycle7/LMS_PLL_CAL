#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
regressors.py -- fractional-phase sequences, GOS / PHOS regressors and GMAC pre-filters.

Fractional-N model (first-order accumulator, no DSM randomisation):
    FCW = N_int + alpha,  phi[n] = frac(n alpha)            (VCO periods)
    p[n]   = floor(8 phi[n])                              PMUX phase index (0..7)
    rho[n] = 8 phi[n] - p[n]  in [0, 1)                   DTC fine residue (units Delta = T_vco/8)
Regressors (index 0 = GOS, 1..8 = PHOS one-hot):
    x_0[n] = rho[n],   x_{1+k}[n] = 1{p[n] = k}
GMAC pre-filter variants r = g * x:
    raw (g = 1), ac (GOS mean 1/2 removed), zm (GOS -1/2 and PHOS -1/8: zero-mean),
    D:k (r[n] = x[n-k]), 1diff (x[n]-x[n-1]), 2diff, 1diffD:k, fx:<model> (filtered-x by H_hat).
"""
from __future__ import annotations

import math
from fractions import Fraction
from typing import Callable, Dict, Optional

import numpy as np

NPH = 8


# --------------------------------------------------------------------------------------
# sequences
# --------------------------------------------------------------------------------------
def seq_rational(P: int, Q: int, n, side: str = 'right'):
    """Exact sequence for alpha = P/Q.
    side='right': floor convention (rho = 0 exactly at a bin boundary);
    side='left' : the limit alpha -> P/Q from below (rho -> 1, previous phase)."""
    n = np.asarray(n, np.int64)
    s = np.mod(n * (P % Q), Q)
    t = NPH * s
    p = t // Q
    r = t % Q
    c = r / Q
    if side == 'left':
        z = r == 0
        p = np.where(z, (p - 1) % NPH, p)
        c = np.where(z, 1.0, c)
    return c.astype(float), p.astype(np.int64)


def seq_acc(alpha: float, n, bits: int = 32):
    """The time-domain simulator's 32-bit first-order accumulator:
    acc = n round(alpha 2^bits) mod 2^bits, p = top 3 bits, rho = remaining fraction."""
    ai = int(round(alpha * 2 ** bits))
    n = np.asarray(n, np.int64)
    acc = (n * ai) & ((1 << bits) - 1)
    p = acc >> (bits - 3)
    c = (acc & ((1 << (bits - 3)) - 1)) / 2.0 ** (bits - 3)
    return c, p.astype(np.int64)


def acc_side(alpha: float, bits: int = 32) -> str:
    """Which one-sided limit of the exact rational sequence the quantised accumulator realises
    over records << 2^bits samples: 'left' if alpha_q < alpha, else 'right'."""
    fr = Fraction(alpha).limit_denominator(1 << 20)
    aq = Fraction(int(round(alpha * 2 ** bits)), 2 ** bits)
    return 'left' if aq < fr else 'right'


def regressor_matrix(c, p) -> np.ndarray:
    """X[..., 0] = GOS code rho, X[..., 1+k] = 1{p = k}."""
    c = np.asarray(c, float)
    p = np.asarray(p, np.int64)
    X = np.zeros(c.shape + (1 + NPH,))
    X[..., 0] = c
    np.put_along_axis(X[..., 1:], p[..., None], 1.0, axis=-1)
    return X


def X_rational(P: int, Q: int, n=None, side: str = 'right') -> np.ndarray:
    if n is None:
        n = np.arange(Q)
    return regressor_matrix(*seq_rational(P, Q, n, side))


# --------------------------------------------------------------------------------------
# Fourier facts used by the theory
# --------------------------------------------------------------------------------------
def sawtooth_line_power(m) -> np.ndarray:
    """rho[n] = 1/2 - sum_{m>=1} sin(2 pi m n beta)/(pi m): each harmonic m >= 1 contributes
    a pair of lines +-m beta with |c|^2 = 1/(4 pi^2 m^2); summed over +-: 1/(2 pi^2 m^2).
    sum_m 1/(2 pi^2 m^2) = 1/12 = var(rho)."""
    m = np.asarray(m, float)
    return 1.0 / (2 * np.pi ** 2 * m ** 2)


def indicator_line_weight(ell) -> np.ndarray:
    """One-hot 1{p = k} for irrational alpha: line at ell*alpha with
    |c_ell|^2 = sin^2(pi ell/8)/(pi ell)^2; mode-m weights w_ell = 64 sin^2(pi ell/8)/(pi ell)^2
    (ell = m mod 8) sum to 1 for every m != 0."""
    ell = np.asarray(ell, float)
    return np.sin(np.pi * ell / NPH) ** 2 / (np.pi ** 2 * ell ** 2)


W1 = 64 * math.sin(math.pi / 8) ** 2 / math.pi ** 2      # = 0.949641..., weight of the fundamental of mode 1
W_SQUARE = 8 / math.pi ** 2                              # = 0.810569..., fundamental weight of mode 4 near 1/4


# --------------------------------------------------------------------------------------
# GMAC pre-filter variants
# --------------------------------------------------------------------------------------
# #region core:variant_G
def variant_G(variant: str, f, models: Optional[Dict] = None):
    """Frequency response G(e^{j2pi f}) of the regressor pre-filter r = g * x."""
    f = np.asarray(f, float)
    zi = np.exp(-2j * np.pi * f)                         # z^-1 on the unit circle
    if variant in ('raw', 'ac', 'zm'):
        return np.ones_like(zi)                          # G = 1 (the mean line l = 0 meets H(1) = 0 anyway)
    if variant.startswith('D:'):
        return zi ** int(variant[2:])                    # ← 差異：G = z^-D
    if variant == '1diff':
        return 1 - zi                                    # ← 差異：G = 1 - z^-1
    if variant == '2diff':
        return (1 - zi) ** 2                             # ← 差異：G = (1 - z^-1)^2
    if variant.startswith('1diffD:'):
        return (1 - zi) * zi ** int(variant[7:])
    if variant.startswith('fx:'):
        return models[variant[3:]].H(f)                 # ← 差異：G = H_hat_PD（模型）
    raise ValueError(variant)
# #endregion core:variant_G


# #region core:gmac_variants
def apply_variant(variant: str, Xfun: Callable[[np.ndarray], np.ndarray], n: np.ndarray,
                  models: Optional[Dict] = None, n_start: int = 0) -> np.ndarray:
    """Time-domain GMAC regressors for contiguous ascending sample indices n.
    Xfun(n) -> raw regressors (len(n), 9).  'fx:*' filters from n_start with zero state."""
    if variant == 'raw':
        return Xfun(n)                                   # r[n] = x[n]
    if variant == 'ac':
        Y = Xfun(n).copy()
        Y[..., 0] -= 0.5                                 # ← 差異：GOS 去掉標稱平均 1/2
        return Y
    if variant == 'zm':
        Y = Xfun(n).copy()
        Y[..., 0] -= 0.5                                 # ← 差異：GOS 去平均
        Y[..., 1:] -= 1.0 / NPH                          # ← 差異：PHOS 也去平均 1/8（zero-mean）
        return Y
    if variant.startswith('D:'):
        return Xfun(n - int(variant[2:]))                # ← 差異：r[n] = x[n-D]（相關器延遲）
    if variant == '1diff':
        return Xfun(n) - Xfun(n - 1)                     # ← 差異：r[n] = x[n] - x[n-1]
    if variant == '2diff':
        return Xfun(n) - 2 * Xfun(n - 1) + Xfun(n - 2)   # ← 差異：二階差分
    if variant.startswith('1diffD:'):
        k = int(variant[7:])
        return Xfun(n - k) - Xfun(n - k - 1)             # ← 差異：一階差分但錯位 k 拍
    if variant.startswith('fx:'):
        m = models[variant[3:]]
        nn = np.arange(n_start, n[-1] + 1)
        Y = m.filt(Xfun(nn), axis=0)                     # ← 差異：r = H_hat_PD * x（filtered-x）
        return Y[n - n_start]
    raise ValueError(variant)
# #endregion core:gmac_variants
