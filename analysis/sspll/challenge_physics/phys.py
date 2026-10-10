#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
phys.py -- independent re-implementation used by the "physics" adversarial review.

Written from scratch (does NOT import reconcile/, loops/, regressors/ or sim/ code) so that
agreement with the consolidated numbers is an independent check.

Conventions
-----------
time unit T_ref (= 250 ps at f_ref = 4 GHz); f normalised to f_ref; z^-1 = one ref cycle.
u[n]   : injected timing error at the phase-comparison node (DTC on ref side, PMUX on fb side)
         with the polarity chosen so that the LMS update is correct when H_PD == 1.
SSPD   : s[n] = u[n] - phi[n]   (phi = VCO/feedback phase correction produced by the loop)
loop   : phi = L0 * (P * s)      P = optional sampler memory (charge sharing), default 1
cmp    : q[n] = sign(c[n] + v[n] + u_os), c = P*s (comparator on the hold node) or c = s
LMS    : w_i += mu * mean(q[n] r_i[n]),  r_i = G * x_i (G = regressor pre-filter)
Linear (Bussgang) mean matrix C_ij = < r_i  (cmp response to unit error direction j) >.
"""
from __future__ import annotations

import math
from fractions import Fraction

import numpy as np
from scipy import optimize, signal

F_REF = 4e9
BW = 320e6
NPH = 8
TWO_PI = 2 * np.pi


def padd(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    n = max(len(a), len(b))
    return np.pad(a, (0, n - len(a))) + np.pad(b, (0, n - len(b)))


def peval(c, zi):
    return np.polyval(np.asarray(c, float)[::-1], zi)


class TF:
    """rational function of z^-1: num/den, coefficient k multiplies z^-k"""
    def __init__(self, num, den):
        self.num = np.asarray(num, float); self.den = np.asarray(den, float)

    def __call__(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return peval(self.num, zi) / peval(self.den, zi)

    def __mul__(self, o):
        return TF(np.convolve(self.num, o.num), np.convolve(self.den, o.den))


class Loop:
    """closed loop built from open-loop gain L = Ln/Ld (strictly proper) and an optional
    sampler-memory filter P seen by the comparator.  H = 1/(1+L)."""
    def __init__(self, Ln, Ld, name='', ltype=1, params=None, P=None):
        self.Ln = np.asarray(Ln, float); self.Ld = np.asarray(Ld, float)
        assert abs(self.Ln[0]) < 1e-14, 'L must be strictly proper'
        self.name, self.ltype, self.params = name, ltype, dict(params or {})
        self.P = P

    def L(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return peval(self.Ln, zi) / peval(self.Ld, zi)

    def H(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        d = peval(self.Ld, zi)
        return d / (d + peval(self.Ln, zi))

    def T(self, f):
        l = self.L(f); return l / (1 + l)

    def poles(self):
        return np.roots(padd(self.Ld, self.Ln))

    def stable(self):
        return bool(np.all(np.abs(self.poles()) < 1 - 1e-12))

    def f3db(self):
        f = np.linspace(1e-7, 0.5, 40001)
        Tm = np.abs(self.T(f))
        idx = np.nonzero(Tm < 1 / math.sqrt(2))[0]
        if not len(idx):
            return 0.5
        i = idx[0]
        return optimize.brentq(lambda x: abs(self.T(x)) - 1 / math.sqrt(2), f[i - 1], f[i], xtol=1e-15)

    def pm(self):
        f = np.linspace(1e-6, 0.5, 200001)
        Lm = np.abs(self.L(f))
        i = np.nonzero(Lm < 1)[0][0]
        fc = optimize.brentq(lambda x: abs(self.L(x)) - 1, f[i - 1], f[i], xtol=1e-15)
        ph = np.unwrap(np.angle(self.L(np.linspace(1e-6, fc, 20001))))
        ph0 = -self.ltype * np.pi / 2
        ph += TWO_PI * round((ph0 - ph[0]) / TWO_PI)
        return fc, 180 + math.degrees(ph[-1])

    def reH_bands(self, n=400001):
        f = np.concatenate([np.geomspace(1e-9, 1e-3, 2000, endpoint=False), np.linspace(1e-3, 0.5, n)])
        g = self.L(f).real + 1
        neg = g < 0
        out = []
        i = 0
        while i < len(f):
            if neg[i]:
                j = i
                while j + 1 < len(f) and neg[j + 1]:
                    j += 1
                lo = 0.0 if i == 0 else optimize.brentq(lambda x: self.L(x).real + 1, f[i - 1], f[i])
                hi = 0.5 if j == len(f) - 1 else optimize.brentq(lambda x: self.L(x).real + 1, f[j], f[j + 1])
                hr = self.H(f[i:j + 1]).real
                out.append((lo, hi, float(hr.min()), float(f[i + np.argmin(hr)])))
                i = j + 1
            else:
                i += 1
        return out


def latency_poly(lat):
    """z^-lat, integer part pure delay, fractional part as held-control split (ZOH-exact for an
    integrator): (1-f) z^-i + f z^-(i+1)"""
    i = int(math.floor(lat + 1e-12)); fr = lat - i
    c = np.zeros(i + 2); c[i] += 1 - fr; c[i + 1] += fr
    return np.trim_zeros(c, 'b')


def solve_bw(build, lo=-10.0, hi=1.0, bw=BW / F_REF):
    xs = np.linspace(lo, hi, 80)
    prev = None
    for x in xs:
        lp = build(math.exp(x))
        v = (lp.f3db() if lp.stable() else 0.0) - bw
        if prev is not None and prev[1] < 0 <= v:
            r = optimize.brentq(lambda y: build(math.exp(y)).f3db() - bw, prev[0], x, xtol=1e-13)
            return math.exp(r)
        prev = (x, v)
    raise RuntimeError('bw not bracketed')


# ---------------- loop builders (all my own) ----------------
def L1(K=None, lat=1.0, f_pole=None, P=None):
    nl = latency_poly(lat)
    bp, ap = np.array([1.0]), np.array([1.0])
    if f_pole is not None:
        p = math.exp(-TWO_PI * f_pole / F_REF)
        bp, ap = np.array([1 - p]), np.array([1.0, -p])
    Pn, Pd = (np.array([1.0]), np.array([1.0])) if P is None else (P.num, P.den)

    def b(k):
        return Loop(k * np.convolve(np.convolve(nl, bp), Pn), np.convolve(np.convolve([1, -1.0], ap), Pd),
                    'L1', 1, dict(K=k, lat=lat, f_pole=f_pole), P=P)
    if K is None:
        K = solve_bw(b)
    return b(K)


def L2(pm=60.0, lat=1.0, Kp=None, Ki=None, P=None, gain_scale=1.0):
    nl = latency_poly(lat)
    Pn, Pd = (np.array([1.0]), np.array([1.0])) if P is None else (P.num, P.den)

    def b2(kp, ki):
        num = padd(kp * np.array([1.0, -1.0]), [ki])
        return Loop(np.convolve(np.convolve(num, nl), Pn), np.convolve([1, -2.0, 1], Pd), 'L2', 2,
                    dict(Kp=kp, Ki=ki, lat=lat), P=P)
    if Kp is not None:
        return b2(Kp * gain_scale, Ki * gain_scale)

    def wn_for(z):
        return solve_bw(lambda w: b2(2 * z * w, w * w), lo=-8, hi=0.0)

    def err(z):
        w = wn_for(z); return b2(2 * z * w, w * w).pm()[1] - pm
    zs = np.linspace(0.25, 3.0, 12)
    v = [err(z) for z in zs]
    k = [i for i in range(1, len(zs)) if v[i - 1] < 0 <= v[i]][0]
    z = optimize.brentq(err, zs[k - 1], zs[k], xtol=1e-10)
    w = wn_for(z)
    return b2(2 * z * w * gain_scale, w * w * gain_scale)


def L3(pm_ct=60.0, mapping='impulse', wc=None, gain_scale=1.0, P=None):
    """L(s) = K(1+s/wz)/(s^2(1+s/wp)); wz = wc/sqrt b, wp = wc sqrt b, K = wc^2/sqrt b.
    impulse: CP charge packet at nT -> phase at (n+k)T = l(kT); l(t) = K t + B + C e^{-wp t}"""
    ph = math.radians(pm_ct)
    b = ((1 + math.sin(ph)) / math.cos(ph)) ** 2
    Pn, Pd = (np.array([1.0]), np.array([1.0])) if P is None else (P.num, P.den)

    def build(w):
        sb = math.sqrt(b); wz, wp, K = w / sb, w * sb, w * w / sb * gain_scale
        if mapping == 'impulse':
            C = K * (1 - wp / wz) / wp; B = -C; p = math.exp(-wp)
            # sum_{k>=1} (K k + B + C p^k) z^-k
            d1 = np.array([1.0, -1.0]); d2 = np.convolve(d1, d1); dp = np.array([1.0, -p])
            n1 = np.convolve([0.0, K], dp)
            n2 = np.convolve(np.convolve([0.0, B], d1), dp)
            n3 = np.convolve([0.0, C * p], d2)
            num = padd(padd(n1, n2), n3); den = np.convolve(d2, dp)
        elif mapping == 'zoh':
            nd, dd, _ = signal.cont2discrete((K * np.array([1 / wz, 1.0]), np.array([1 / wp, 1.0, 0.0, 0.0])),
                                             dt=1.0, method='zoh')
            nd = np.asarray(nd, float).ravel(); dd = np.asarray(dd, float).ravel()
            num, den = nd / dd[0], dd / dd[0]
            num[np.abs(num) < 1e-13 * np.abs(num).max()] = 0.0
        return Loop(np.convolve(num, Pn), np.convolve(den, Pd), 'L3_' + mapping, 2,
                    dict(b=b, wc=w, K=K, wz=wz, wp=wp), P=P)
    if wc is None:
        wc = solve_bw(build, lo=-6, hi=0.5)
    return build(wc)


# ---------------- regressors ----------------
def seq(P, Q, n):
    n = np.asarray(n, np.int64)
    s = np.mod(n * P, Q)
    t = NPH * s
    p = t // Q
    rho = (t % Q) / Q
    return rho, p


def X_of(P, Q, n):
    rho, p = seq(P, Q, n)
    X = np.zeros((len(n), 1 + NPH))
    X[:, 0] = rho
    X[np.arange(len(n)), 1 + p] = 1.0
    return X


def C_periodic(loop: Loop, P, Q, G=None, cmp_on_hold=True):
    """exact LTI periodic steady state (Q-periodic regressors), Bussgang-linear mean matrix
    C_ij = (1/Q) sum_n r_i[n] c_j[n], c_j = comparator input for unit error direction x_j.
    G: TF pre-filter for the regressor (None = raw).  Returns C (9x9), occupancy, rho mean."""
    n = np.arange(Q)
    X = X_of(P, Q, n)
    k = np.arange(Q) / Q
    Hk = loop.H(k)
    if loop.P is not None and cmp_on_hold:
        Hk = Hk * loop.P(k)
    Xf = np.fft.fft(X, axis=0)
    E = np.real(np.fft.ifft(Xf * Hk[:, None], axis=0))      # comparator response to each direction
    if G is None:
        R = X
    else:
        R = np.real(np.fft.ifft(Xf * G(k)[:, None], axis=0))
    C = R.T @ E / Q
    return C, X[:, 1:].mean(0), X[:, 0].mean()


def obs_eigs(C, occ_uniform=True):
    """eigenvalues on the observable subspace: remove PHOS common mode (and GOS if rho==0).
    Project with an orthonormal basis of the 8-dim complement of [0,1,...,1]."""
    v = np.zeros(9); v[1:] = 1 / math.sqrt(8)
    Bm = np.linalg.svd(np.eye(9) - np.outer(v, v))[0][:, :8]
    Cr = Bm.T @ C @ Bm
    return np.linalg.eigvals(Cr)


def phos_eigs(C):
    v = np.ones(8) / math.sqrt(8)
    Bm = np.linalg.svd(np.eye(8) - np.outer(v, v))[0][:, :7]
    return np.linalg.eigvals(Bm.T @ C[1:, 1:] @ Bm)
