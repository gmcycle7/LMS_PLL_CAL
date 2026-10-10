#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sspll_polarity.py -- consolidated model of the GOS (DTC gain) / PHOS (8-phase PMUX
offset) sign-error-LMS polarity problem in a fractional-N PLL with
f_ref = 4 GHz and closed-loop -3 dB bandwidth (of T = L/(1+L)) = 320 MHz.

It merges, re-derives and cross-checks the three independent studies in
analysis/sspll/{loops, regressors, sim}:

  1. LOOP MODELS    L1 SSPLL Type-I, L2 SSPLL Type-II (P+I), L3 CPPLL (3rd-order
                    type-II, impulse / ZOH / half-cycle-delayed sampling), plus the
                    "P-only during calibration" remedy loop.  All rational in z^-1,
                    designed for |T| -3 dB = 320 MHz.
  2. REGRESSORS     exact first-order-accumulator sequences: the sim's 32-bit
                    accumulator, exact rational P/Q with right (floor) or left limit
                    at the bin boundaries, and float.
  3. PREDICTIONS    (a) ergodic / irrational-alpha harmonic sums (GOS scalar, PHOS
                    DFT-mode eigenvalues);  (b) exact periodic steady state for any
                    rational alpha (full 9x9, non-circulant when 8 does not divide Q);
                    (c) a deterministic finite-record replica of the time-domain
                    simulator's slope-matrix measurement ('lin' and 'erf'
                    estimators, same window, same physical injection model);
                    (d) the large-signal (sign-comparator) secant slope and its
                    A -> infinity limit (1-bit correlation).
  4. SIMULATOR      a small sign-error block-LMS simulator (real 1-bit comparator +
                    Gaussian noise) for spot checks.

Conventions (identical in all three source studies; verified in reconcile.py)
-----------------------------------------------------------------------------
  time unit T_ref; f is normalised to f_ref (cycles/sample), Omega = 2 pi f.
  H_PD = 1/(1+L), e_PD = h_PD * u, h_PD[0] = 1 (strictly proper L, >= 1 cycle latency).
  u[n] = injected timing error at the phase-comparison node (DTC on the reference side
  and PMUX on the feedback side both inject here), polarity chosen so that the
  calibration is correct when H_PD == 1.
  Regressor index 0 = GOS code (rho or c), 1..8 = PHOS one-hot 1{p = k}.
  GMAC regressor variant r_i = g * x_i (g = z^-D, 1-z^-1, (1-z^-1)^2, H_hat, ...).
  Linear (Bussgang) mean-GMAC matrix:
        C_ij = < r_i[n] (h_PD * d_j)[n] >  =  sum_lines conj(c^i) c^j  Gamma_eff(f),
        Gamma_eff(f) = H_PD(e^{j2pi f}) * conj(G(e^{j2pi f}))       (D-delay: e^{+j2pi f D})
  and the LMS mean dynamics  dtheta = -mu K_q C dtheta  converge iff Re eig(C) > 0 on
  the observable subspace.  K_q = sqrt(2/pi)/sigma_v.

Nothing in here depends on f_vco except the physical GOS-column coupling term
eps_p/Delta of the simulator's injection model (Delta = T_vco/8), which is a few % and
does not change any sign (checked in reconcile.py).
"""
from __future__ import annotations

import math
from fractions import Fraction
from typing import Callable, Dict, Optional, Sequence

import numpy as np
from scipy import optimize, signal, special

F_REF = 4e9
BW = 320e6
NPH = 8
TWO_PI = 2.0 * np.pi

# ======================================================================================
# 1. polynomial helpers (coefficient c[k] multiplies z^-k)
# ======================================================================================

def _padd(a, b):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    n = max(len(a), len(b))
    return np.pad(a, (0, n - len(a))) + np.pad(b, (0, n - len(b)))


def _peval(c, zinv):
    c = np.asarray(c, float)
    return np.polyval(c[::-1], zinv)


# ======================================================================================
# 2. Loop models
# ======================================================================================
class Loop:
    """Sampled-data loop gain L(z) = bL(z^-1)/aL(z^-1) (strictly proper: bL[0] = 0).
    H_PD = aL/(aL+bL), T = bL/(aL+bL)."""

    def __init__(self, name: str, bL, aL, ltype: int, params: Optional[dict] = None):
        self.name = name
        self.bL = np.asarray(bL, float)
        self.aL = np.asarray(aL, float)
        if abs(self.bL[0]) > 1e-14 * max(1.0, np.max(np.abs(self.bL))):
            raise ValueError("L must be strictly proper (>= 1 cycle latency)")
        den = _padd(self.aL, self.bL)
        self.bH = self.aL.copy()
        self.aH = den
        self.ltype = ltype
        self.params = dict(params or {})

    # ---- frequency responses, f normalised to f_ref ----
    def L(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return _peval(self.bL, zi) / _peval(self.aL, zi)

    def H(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return _peval(self.bH, zi) / _peval(self.aH, zi)

    def T(self, f):
        Lf = self.L(f)
        return Lf / (1.0 + Lf)

    # ---- time domain ----
    def impulse(self, n: int):
        x = np.zeros(n)
        x[0] = 1.0
        return signal.lfilter(self.bH, self.aH, x)

    def step(self, n: int):
        return np.cumsum(self.impulse(n))

    def filt(self, x, axis=0, zi=None):
        """e = h_PD * x (zero initial state unless zi given)."""
        if zi is None:
            return signal.lfilter(self.bH, self.aH, x, axis=axis)
        return signal.lfilter(self.bH, self.aH, x, axis=axis, zi=zi)

    def zi_zeros(self, lanes: int):
        n = max(len(self.bH), len(self.aH)) - 1
        return np.zeros((n, lanes))

    def poles(self):
        return np.roots(self.aH)

    def stable(self):
        return bool(np.all(np.abs(self.poles()) < 1 - 1e-12))

    # ---- figures of merit ----
    def f3db(self):
        f = np.linspace(1e-7, 0.5, 20001)
        Tm = np.abs(self.T(f))
        idx = np.nonzero(Tm < 1 / math.sqrt(2))[0]
        if not len(idx):
            return 0.5
        i = idx[0]
        if i == 0:
            return float(f[0])
        return optimize.brentq(lambda x: abs(self.T(x)) - 1 / math.sqrt(2), f[i - 1], f[i], xtol=1e-15)

    def margins(self):
        f = np.concatenate([np.geomspace(1e-8, 1e-3, 400, endpoint=False), np.linspace(1e-3, 0.5, 40001)])
        Lc = self.L(f)
        ic = np.nonzero(np.abs(Lc) < 1)[0]
        if not len(ic) or ic[0] == 0:
            return dict(fc=np.nan, PM_deg=np.nan)
        i = ic[0]
        fc = optimize.brentq(lambda x: abs(self.L(x)) - 1, f[i - 1], f[i], xtol=1e-15)
        ph = np.unwrap(np.angle(Lc[: i + 1]))
        ph += TWO_PI * round((-self.ltype * np.pi / 2 - ph[0]) / TWO_PI)
        phc = ph[-1] + np.angle(np.exp(1j * (np.angle(self.L(fc)) - ph[-1])))
        return dict(fc=float(fc), PM_deg=float(180 + math.degrees(phc)))

    def inversion_bands(self, n=200001):
        """Intervals (normalised f) where Re{H_PD} < 0  <=>  Re{L} < -1 (exact identity)."""
        f = np.concatenate([np.geomspace(1e-8, 1e-3, 400, endpoint=False), np.linspace(1e-3, 0.5, n)])
        g = self.L(f).real + 1.0
        neg = g < 0
        out = []
        i = 0
        N = len(f)
        while i < N:
            if neg[i]:
                j = i
                while j + 1 < N and neg[j + 1]:
                    j += 1
                lo = 0.0 if i == 0 else optimize.brentq(lambda x: self.L(x).real + 1, f[i - 1], f[i], xtol=1e-15)
                hi = 0.5 if j == N - 1 else optimize.brentq(lambda x: self.L(x).real + 1, f[j], f[j + 1], xtol=1e-15)
                Hs = self.H(f[i:j + 1]).real
                k = int(np.argmin(Hs))
                out.append(dict(f_lo=float(lo), f_hi=float(hi), min_ReH=float(Hs[k]), f_min=float(f[i + k])))
                i = j + 1
            else:
                i += 1
        return out

    def summary(self, f_ref=F_REF):
        m = self.margins()
        f = np.linspace(1e-7, 0.5, 100001)
        Tm = np.abs(self.T(f))
        h = self.impulse(60000)
        s = np.cumsum(h)
        return dict(name=self.name, type=self.ltype, params=self.params,
                    f3dB_MHz=self.f3db() * f_ref / 1e6, fc_MHz=m['fc'] * f_ref / 1e6, PM_deg=m['PM_deg'],
                    T_peak_dB=float(20 * np.log10(Tm.max())), stable=self.stable(),
                    max_pole_mag=float(np.max(np.abs(self.poles()))),
                    ReH_neg_bands_MHz=[[b['f_lo'] * f_ref / 1e6, b['f_hi'] * f_ref / 1e6, b['min_ReH'],
                                        b['f_min'] * f_ref / 1e6] for b in self.inversion_bands()],
                    h0=float(h[0]), S_inf=float(s.sum()), bL=self.bL.tolist(), aL=self.aL.tolist())


def _solve_gain(build: Callable[[float], Loop], bw_norm: float, lo=-12.0, hi=1.0, n=60):
    lg = np.linspace(lo, hi, n)
    prev = None
    for x in lg:
        lp = build(math.exp(x))
        v = (lp.f3db() if lp.stable() else 0.0) - bw_norm
        if prev is not None and prev[1] < 0 <= v:
            r = optimize.brentq(lambda y: build(math.exp(y)).f3db() - bw_norm, prev[0], x, xtol=1e-14)
            return math.exp(r)
        prev = (x, v)
    raise RuntimeError("bandwidth not bracketed")


def _latency_poly(lat: float):
    """z^-lat for lat >= 1: integer part as pure delay; fractional part as the ZOH-exact
    split (1-f) z^-i + f z^-(i+1) (excess loop delay of a held control)."""
    i = int(math.floor(lat + 1e-12))
    f = lat - i
    c = np.zeros(i + 2)
    c[i] += 1 - f
    c[i + 1] += f
    return np.trim_zeros(c, 'b')


def make_L1(K: Optional[float] = None, lat: float = 1.0, f_pole: Optional[float] = None,
            bw: float = BW, f_ref: float = F_REF, name: Optional[str] = None) -> Loop:
    """SSPLL Type-I: L = K z^-lat/(1-z^-1) [* (1-p)/(1-p z^-1), p = exp(-2 pi f_pole/f_ref)]
    (the discrete parasitic pole used by the sim and regressors folders)."""
    nl = _latency_poly(lat)
    if f_pole is None:
        bp, ap = np.array([1.0]), np.array([1.0])
    else:
        p = math.exp(-TWO_PI * f_pole / f_ref)
        bp, ap = np.array([1 - p]), np.array([1.0, -p])
    nm = name or ("L1" + ("" if lat == 1 else f"_lat{lat:g}") + ("" if f_pole is None else f"_pole{f_pole/1e6:g}M"))

    def build(k):
        return Loop(nm, k * np.convolve(nl, bp), np.convolve([1.0, -1.0], ap), 1,
                    dict(K=k, lat=lat, f_pole=f_pole))
    if K is None:
        if lat == 1 and f_pole is None:
            W3 = TWO_PI * bw / f_ref               # closed form (loops/README):
            c = 2 - math.cos(W3)                   # 1-K = (2-cos W3) - sqrt((2-cos W3)^2-1)
            K = 1 - (c - math.sqrt(c * c - 1))
        else:
            K = _solve_gain(build, bw / f_ref, lo=-8, hi=0.5)
    return build(K)


def make_L2(pm: float = 60.0, lat: float = 1.0, bw: float = BW, f_ref: float = F_REF,
            Kp: Optional[float] = None, Ki: Optional[float] = None, name: Optional[str] = None) -> Loop:
    """SSPLL Type-II: L = (Kp + Ki/(1-z^-1)) z^-lat/(1-z^-1).  Default: Ki = wn^2, Kp = 2 zeta wn,
    zeta solved for the sampled-data PM, wn for |T| -3 dB = bw."""
    nl = _latency_poly(lat)
    nm = name or (f"L2_pm{pm:g}" + ("" if lat == 1 else f"_lat{lat:g}"))

    def build2(kp, ki):
        num = _padd(kp * np.array([1.0, -1.0]), [ki])
        return Loop(nm, np.convolve(num, nl), np.convolve([1.0, -1.0], [1.0, -1.0]), 2,
                    dict(Kp=kp, Ki=ki, lat=lat, pm_target=pm))
    if Kp is not None and Ki is not None:
        return build2(Kp, Ki)
    bwn = bw / f_ref

    def wn_for(z):
        return _solve_gain(lambda w: build2(2 * z * w, w * w), bwn, lo=-8, hi=0.0)

    def pm_err(z):
        w = wn_for(z)
        return build2(2 * z * w, w * w).margins()['PM_deg'] - pm
    zs = np.linspace(0.2, 3.0, 15)
    vals = [pm_err(z) for z in zs]
    k = [i for i in range(1, len(zs)) if vals[i - 1] < 0 <= vals[i]][0]
    z = optimize.brentq(pm_err, zs[k - 1], zs[k], xtol=1e-12)
    w = wn_for(z)
    lp = build2(2 * z * w, w * w)
    lp.params.update(zeta_ct=z, wn=w)
    return lp


def make_L3(pm_ct: float = 60.0, mapping: str = 'impulse', bw: float = BW, f_ref: float = F_REF,
            b: Optional[float] = None, wc: Optional[float] = None, name: Optional[str] = None) -> Loop:
    """Conventional CPPLL: L(s) = K(1+s/wz)/(s^2(1+s/wp)), wz = wc/sqrt(b), wp = wc sqrt(b),
    K = wc^2/sqrt(b), b = ((1+sin PM)/cos PM)^2 (classical PM-optimal placement).
    Sampled with T_ref = 1:
      'impulse' : CP charge packet at nT, phase sampled at (n+1)T  -> sum_{n>=1} l(n) z^-n
      'halfT'   : packet at nT + T/2 (e^{-sT/2}-type extra delay)  -> sum_{n>=1} l(n-1/2) z^-n
      'zoh'     : PD output held for a full cycle (step invariant)
    l(t) = K t + B + C e^{-wp t},  C = K(1-wp/wz)/wp, B = -C.  wc scaled for |T| -3 dB = bw."""
    if b is None:
        ph = math.radians(pm_ct)
        b = ((1 + math.sin(ph)) / math.cos(ph)) ** 2
    nm = name or f"L3_{mapping}_pm{pm_ct:g}"

    def build(w):
        sb = math.sqrt(b)
        wz, wp = w / sb, w * sb
        K = w * w / sb
        if mapping in ('impulse', 'halfT'):
            tau = 0.0 if mapping == 'impulse' else 0.5
            Cc = K * (1 - wp / wz) / wp
            Bc = -Cc
            p = math.exp(-wp)
            d1 = np.array([1.0, -1.0])
            d2 = np.convolve(d1, d1)
            dp = np.array([1.0, -p])
            n1 = np.convolve([0.0, K], dp)
            n2 = np.convolve(np.convolve([0.0, Bc - K * tau], d1), dp)
            n3 = np.convolve([0.0, Cc * p * math.exp(wp * tau)], d2)
            num = _padd(_padd(n1, n2), n3)
            den = np.convolve(d2, dp)
        elif mapping == 'zoh':
            nd, dd, _ = signal.cont2discrete((K * np.array([1 / wz, 1.0]), np.array([1 / wp, 1.0, 0.0, 0.0])),
                                             dt=1.0, method='zoh')
            nd = np.asarray(nd, float).ravel()
            dd = np.asarray(dd, float).ravel()
            num, den = nd / dd[0], dd / dd[0]
            num[np.abs(num) < 1e-14 * np.max(np.abs(num))] = 0.0
        else:
            raise ValueError(mapping)
        return Loop(nm, num, den, 2, dict(mapping=mapping, pm_ct=pm_ct, b=b, wc=w, K=K, wz=wz, wp=wp,
                                          fz_MHz=wz * f_ref / TWO_PI / 1e6, fp_MHz=wp * f_ref / TWO_PI / 1e6,
                                          fc_ct_MHz=w * f_ref / TWO_PI / 1e6))
    if wc is None:
        wc = _solve_gain(build, bw / f_ref, lo=-6, hi=0.5)
    return build(wc)


def make_L3_P_only(loop3: Loop, name: Optional[str] = None) -> Loop:
    """Remedy for the CPPLL: hold the integrating capacitor (C1) voltage during calibration.
    Remaining path ~ (K/wz)/(s(1+s/wp)) (resistor + ripple pole; exact when C1 >> C2), sampled
    with the same impulse-invariant convention: L = (K/wz)[z^-1/(1-z^-1) - p z^-1/(1-p z^-1)]."""
    pr = loop3.params
    Kp = pr['K'] / pr['wz']
    p = math.exp(-pr['wp'])
    num = Kp * _padd(np.convolve([0.0, 1.0], [1.0, -p]), -p * np.convolve([0.0, 1.0], [1.0, -1.0]))
    den = np.convolve([1.0, -1.0], [1.0, -p])
    return Loop(name or (loop3.name + "_Ponly"), num, den, 1, dict(K=Kp, wp=pr['wp'], src=loop3.name))


def make_P_only(loop2: Loop, name: Optional[str] = None) -> Loop:
    """Remedy: hold (freeze) the integral path of a Type-II SSPLL during calibration.
    The remaining loop is Type-I, L = Kp z^-lat/(1-z^-1) (frequency offset held by the frozen
    integrator).  Re{H_PD} >= 0 for all f whenever Kp < 2 (lat = 1)."""
    Kp = loop2.params['Kp']
    return make_L1(K=Kp, lat=loop2.params.get('lat', 1.0), name=name or (loop2.name + "_Ponly"))


def nominal_loops(bw: float = BW) -> Dict[str, Loop]:
    """The three loops reconciled in this folder (identical to sim L1 / L2_pm60 / L3_imp_pm60,
    loops L1_typeI_D1 / L2_typeII_PM60_D1 / L3_cppll_impulse_PMct60_D1, regressors T1_lat1 /
    T2_pm60_lat1)."""
    return {'L1': make_L1(bw=bw), 'L2': make_L2(60.0, bw=bw), 'L3': make_L3(60.0, 'impulse', bw=bw)}


# ======================================================================================
# 3. Regressor sequences
# ======================================================================================
M29 = (1 << 29) - 1
M32 = (1 << 32) - 1


def seq_acc(alpha: float, n: np.ndarray, bits: int = 32):
    """Exactly the time-domain simulator's first-order accumulator ('acc1'):
    acc = n*round(alpha 2^bits) mod 2^bits, p = top 3 bits, c = remaining fraction (units Delta)."""
    ai = int(round(alpha * 2 ** bits))
    n = np.asarray(n, np.int64)
    acc = (n * ai) & ((1 << bits) - 1)
    p = acc >> (bits - 3)
    c = (acc & ((1 << (bits - 3)) - 1)) / 2.0 ** (bits - 3)
    return c, p.astype(np.int64)


def acc_side(alpha: float, bits: int = 32) -> str:
    """Which one-sided limit of the exact rational sequence the quantised accumulator realises
    over records << 2^bits samples: 'left' if alpha_q < alpha, else 'right' (floor convention)."""
    fr = Fraction(alpha).limit_denominator(1 << 20)
    aq = Fraction(int(round(alpha * 2 ** bits)), 2 ** bits)
    return 'left' if aq < fr else 'right'


def seq_rational(P: int, Q: int, n: np.ndarray, side: str = 'right'):
    """Exact sequence for alpha = P/Q.  side='right': floor convention (rho = 0 at the bin
    boundary); side='left': limit alpha -> P/Q from below (rho -> 1, previous phase)."""
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


def regressor_matrix(c, p):
    """X[..., 0] = GOS code, X[..., 1+k] = 1{p = k}."""
    c = np.asarray(c, float)
    p = np.asarray(p, np.int64)
    X = np.zeros(c.shape + (1 + NPH,))
    X[..., 0] = c
    np.put_along_axis(X[..., 1:], p[..., None], 1.0, axis=-1)
    return X


# ======================================================================================
# 4. Regressor variants (GMAC pre-filter G) and effective kernels
# ======================================================================================

def variant_G(variant: str, f, models: Optional[Dict[str, Loop]] = None):
    """Frequency response G(e^{j2pi f}) of the GMAC regressor pre-filter r = g * x."""
    f = np.asarray(f, float)
    zi = np.exp(-2j * np.pi * f)
    if variant in ('raw', 'ac'):
        return np.ones_like(zi)
    if variant.startswith('D:'):
        return zi ** int(variant[2:])
    if variant == '1diff':
        return 1 - zi
    if variant == '2diff':
        return (1 - zi) ** 2
    if variant.startswith('1diffD:'):
        return (1 - zi) * zi ** int(variant[7:])
    if variant.startswith('fx:'):
        return models[variant[3:]].H(f)
    raise ValueError(variant)


def gamma_eff(loop: Optional[Loop], variant: str = 'raw', models=None, open_loop=False):
    """Gamma_eff(f) = H_PD(f) conj(G(f)) ; open_loop -> H_PD == 1."""
    def G(f):
        g = np.conj(variant_G(variant, f, models))
        return g if open_loop else loop.H(f) * g
    return G


def apply_variant(variant: str, Xfun: Callable[[np.ndarray], np.ndarray], n: np.ndarray,
                  models=None, n_start: int = 0):
    """Time-domain GMAC regressors for sample indices n (contiguous, ascending).
    Xfun(n) -> raw regressors (len(n), 9).  'fx:*' filters from n_start with zero state
    (the simulator's convention)."""
    if variant == 'raw':
        return Xfun(n)
    if variant == 'ac':                      # GOS regressor with its nominal mean 1/2 removed (sim 'ac')
        Y = Xfun(n).copy()
        Y[..., 0] -= 0.5
        return Y
    if variant.startswith('D:'):
        return Xfun(n - int(variant[2:]))
    if variant == '1diff':
        return Xfun(n) - Xfun(n - 1)
    if variant == '2diff':
        return Xfun(n) - 2 * Xfun(n - 1) + Xfun(n - 2)
    if variant.startswith('1diffD:'):
        k = int(variant[7:])
        return Xfun(n - k) - Xfun(n - k - 1)
    if variant.startswith('fx:'):
        m = models[variant[3:]]
        nn = np.arange(n_start, n[-1] + 1)
        Y = m.filt(Xfun(nn), axis=0)
        return Y[n - n_start]
    raise ValueError(variant)


# ======================================================================================
# 5. Predictions
# ======================================================================================
# ---- 5a. ergodic (irrational alpha) harmonic sums --------------------------------------

def gos_harmonic(alpha: float, Geff: Callable, M: int = 8192) -> float:
    """C_GOS = sum_{m>=1} Re Gamma_eff(frac(m beta)) / (2 pi^2 m^2), beta = frac(8 alpha).
    (Exact for irrational alpha; tail beyond M uses the equidistributed mean of Re Gamma.)"""
    beta = (NPH * float(alpha)) % 1.0
    if beta == 0.0:
        return 0.0
    m = np.arange(1, M + 1)
    val = np.sum(np.real(Geff((m * beta) % 1.0)) / (2 * np.pi ** 2 * m ** 2))
    ff = (np.arange(4096) + 0.5) / 4096
    mean_re = float(np.mean(np.real(Geff(ff))))
    val += mean_re * special.polygamma(1, M + 1) / (2 * np.pi ** 2)
    return float(val)


def phos_lambda_harmonic(alpha: float, Geff: Callable, M: int = 8192) -> np.ndarray:
    """lambda_m = 8 sum_{l = m mod 8, l != 0} |c_l|^2 Gamma_eff(frac(l alpha)),
    |c_l|^2 = sin^2(pi l/8)/(pi l)^2;  lambda_0 = 0 (common mode, Gamma(0) = H(1) = 0)."""
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
    """Dominant-line approximation 8 Re lambda_1 ~ (64 sin^2(pi/8)/pi^2) Re Gamma_eff(alpha) (= 0.9496 x)."""
    return float(64 * math.sin(math.pi / 8) ** 2 / math.pi ** 2 * np.real(Geff(np.array([alpha % 1.0])))[0])


# ---- 5b. exact periodic steady state for rational alpha -------------------------------

def C_periodic(P: int, Q: int, Geff: Callable, side: str = 'right', return_cov: bool = False):
    """EXACT long-run 9x9 C_ij = <r_i (h * x_j)> for the Q-periodic sequence alpha = P/Q
    (side convention as in seq_rational), with ALL lines incl. the mean line l = 0
    (multiplied by Gamma_eff(0); = 0 for any type >= I loop).  Also returns the exact
    centered covariance and mean of the raw regressors if return_cov."""
    n = np.arange(Q)
    X = regressor_matrix(*seq_rational(P, Q, n, side)).T          # (9, Q)
    F = np.fft.fft(X, axis=1) / Q
    G = Geff(np.arange(Q) / Q)
    C = np.real((np.conj(F) * G) @ F.T)
    if not return_cov:
        return C
    mu = X.mean(axis=1)
    cov = X @ X.T / Q - np.outer(mu, mu)
    return C, cov, mu


def physical_mix(cfg: Optional[dict]) -> np.ndarray:
    """Column mixing of the simulator's injection model at the calibrated point:
    du/dtheta_g = -(1-a)(c + eps_p/Delta),  du/dtheta_k = -1{p=k}  (theta in ps).
    C_phys = C_ideal @ Mx.  cfg=None -> identity (ideal model e = (a-w_g) rho + (eps-w))."""
    Mx = np.eye(1 + NPH)
    if cfg is None:
        return Mx
    Mx[0, 0] = 1 - cfg['a']
    Mx[1:, 0] = (1 - cfg['a']) * np.asarray(cfg['eps']) / cfg['Delta']
    return Mx


# ---- 5c. eigen-analysis, simulator-compatible ----------------------------------------

def _obs_basis(cov, idx, tol=1e-7):
    Cs = cov[np.ix_(idx, idx)]
    w, V = np.linalg.eigh(Cs)
    keep = w > tol * max(np.trace(Cs), 1e-30)
    return V[:, keep]


def analyse_C(C: np.ndarray, cov: np.ndarray) -> dict:
    """Same reduction as sim.analyse_S with S_norm = -C:  GOS scalar C[0,0] (if observable),
    min Re eig of C restricted to the observable PHOS subspace (and the joint 9x9)."""
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
    out['joint_n_obs'] = int(Vj.shape[1])
    k = np.arange(NPH)
    mg = {}
    for m in range(1, 5):
        vals = []
        for v in (np.cos(2 * np.pi * m * k / NPH), np.sin(2 * np.pi * m * k / NPH)):
            if np.linalg.norm(v) < 1e-9:
                continue
            v = v / np.linalg.norm(v)
            if v @ cov[1:, 1:] @ v < 1e-9 * np.trace(cov[1:, 1:]):
                continue
            vals.append(float(v @ C[1:, 1:] @ v))
        mg['m%d' % m] = float(np.mean(vals)) if vals else float('nan')
    out['phos_dft_mode_gain'] = mg
    return out


def theory_point(loop: Loop, alpha: float, variant: str = 'raw', models=None, cfg: Optional[dict] = None,
                 side: Optional[str] = None, maxQ: int = 1 << 16) -> dict:
    """Exact periodic steady-state prediction for alpha (converted to the exact rational with
    denominator <= maxQ), side = 'right'/'left' ('auto' -> the 32-bit accumulator's side).
    Returns the closed-loop analysis and the open-loop (H == 1, raw regressor) reference."""
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
    return a


# ---- 5d. finite-record replica of the simulator's slope measurement -------------------

def sim_cfg(f_vco: float = 16e9, sigma_v: float = 0.200, a: float = 0.03, eps_seed: int = 7,
            eps_rms: float = 0.25) -> dict:
    """The time-domain simulator's configuration (sim/sim.py make_cfg), in ps."""
    rng = np.random.default_rng(eps_seed)
    eps = rng.normal(0.0, eps_rms, NPH)
    eps = eps - eps.mean()
    t_vco = 1e12 / f_vco
    return dict(f_vco=f_vco, T_vco=t_vco, Delta=t_vco / NPH, sigma=sigma_v, a=a, eps=eps,
                wg_star=a / (1.0 - a), delta_pert=0.03)


def replica_S(loop: Loop, alpha: float, variants: Sequence[str] = ('raw',), cfg: Optional[dict] = None,
              N_rec: int = 1 << 16, N_settle: int = 1 << 12, models=None, estimators=('lin', 'erf'),
              seq: str = 'acc32') -> dict:
    """Deterministic replica of sim.measure_S (+ task_fine/analyse_S) for one alpha:
    PLL from zero state at n = 0, perturbation +-delta of each theta_j at the calibrated point,
    record window [N_settle, N_settle+N_rec), 'lin' = Bussgang-linear, 'erf' = exact average over
    the comparator noise.  Returns {variant: {est: analysis}} and the open-loop reference."""
    cfg = cfg or sim_cfg()
    nt = N_settle + N_rec
    n = np.arange(nt)
    if seq == 'acc32':
        Xfun = lambda nn: regressor_matrix(*seq_acc(alpha, nn))
    else:
        fr = Fraction(alpha).limit_denominator(1 << 16)
        Xfun = lambda nn: regressor_matrix(*seq_rational(fr.numerator, fr.denominator, nn, seq))
    X = Xfun(n)
    Mx = physical_mix(cfg)
    Dd = X @ Mx                                      # d_j[n] = -du/dtheta_j (ps per ps)
    Y = loop.filt(Dd, axis=0)                        # y_j = h_PD * d_j
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


# ---- 5e. large-signal (1-bit comparator) secant slope --------------------------------

def phos_dirs() -> Dict[str, np.ndarray]:
    """Unit directions in theta = [w_g Delta, w_0..w_7] (ps): GOS and real DFT PHOS modes (sim)."""
    k = np.arange(NPH)
    d = {'gos': np.r_[1.0, np.zeros(NPH)]}
    for nm, v in (('phos_m1c', np.cos(2 * np.pi * k / 8)), ('phos_m1s', np.sin(2 * np.pi * k / 8)),
                  ('phos_m2c', np.cos(2 * np.pi * 2 * k / 8)), ('phos_m3c', np.cos(2 * np.pi * 3 * k / 8)),
                  ('phos_m4', np.cos(np.pi * k))):
        d[nm] = np.r_[0.0, v / np.linalg.norm(v)]
    return d


def large_signal_periodic(loop: Loop, alpha: float, amps: Sequence[float], cfg: Optional[dict] = None,
                          variant: str = 'raw', models=None, side: Optional[str] = None, maxQ: int = 1 << 16,
                          dirs: Optional[Dict[str, np.ndarray]] = None) -> dict:
    """Exact periodic-steady-state secant slope along each direction v:
         g_v(A) = <erf(A y_v/(sqrt2 sigma)) z_v> sigma/(A sqrt(2/pi)),  y_v = h_PD * d_v,
    z_v = v^T r (GMAC regressor of the variant), d_v = Mx v^T x (physical injection).
    A -> 0 gives the linear C_vv; A -> inf gives (sigma/A) <sign(y_v) z_v>/sqrt(2/pi).
    Also returns kappa_inf = <sign(y_v) z_v> / |<sign(d_v) x_v>| (open-loop normalised 1-bit
    correlation, the A >> sigma_v limit of the sim's normalised g)."""
    cfg = cfg or sim_cfg()
    dirs = dirs or phos_dirs()
    fr = Fraction(alpha).limit_denominator(maxQ)
    P, Q = fr.numerator, fr.denominator
    if side in (None, 'auto'):
        side = acc_side(alpha)
    n = np.arange(Q)
    X = regressor_matrix(*seq_rational(P, Q, n, side))        # (Q, 9)
    Mx = physical_mix(cfg)
    Hl = loop.H(n / Q)
    Gl = variant_G(variant, n / Q, models)
    FX = np.fft.fft(X, axis=0)
    Rv = np.real(np.fft.ifft(FX * Gl[:, None], axis=0))       # periodic GMAC regressors
    if variant == 'ac':          # the regressor DC matters for the 1-bit correlation (not for the linear C)
        Rv[:, 0] -= 0.5
    sig = cfg['sigma']
    kk = sig / math.sqrt(2 / math.pi)
    out = {}
    for nm, v in dirs.items():
        d = X @ (Mx @ v)
        y = np.real(np.fft.ifft(np.fft.fft(d) * Hl))
        z = Rv @ v
        zr = X @ v
        g, g0 = [], []
        for A in amps:
            g.append(float(np.mean(special.erf(A * y / (math.sqrt(2) * sig)) * z) * kk / A))
            g0.append(float(np.mean(special.erf(A * d / (math.sqrt(2) * sig)) * zr) * kk / A))
        s_cl = float(np.mean(np.sign(y) * z))
        s_ol = float(np.mean(np.sign(d) * zr))
        out[nm] = dict(g=g, g_open_loop=g0, lin=float(np.mean(y * z)), sign_corr=s_cl, sign_corr_ol=s_ol,
                       kappa_inf=(s_cl / abs(s_ol) if abs(s_ol) > 1e-12 else float('nan')))
    out['_meta'] = dict(P=P, Q=Q, side=side)
    return out


def replica_dir(loop: Loop, alpha: float, amps: Sequence[float], cfg: Optional[dict] = None,
                variants: Sequence[str] = ('raw',), models=None, N_rec: int = 1 << 15, N_settle: int = 1 << 12,
                dirs: Optional[Dict[str, np.ndarray]] = None) -> dict:
    """Deterministic finite-record replica of sim.measure_dir ('erf' estimator): same window,
    zero initial state at n = 0.  Returns g[variant][dir] (list over amps) and g_open_loop[dir]."""
    cfg = cfg or sim_cfg()
    dirs = dirs or phos_dirs()
    nt = N_settle + N_rec
    n = np.arange(nt)
    Xfun = lambda nn: regressor_matrix(*seq_acc(alpha, nn))
    X = Xfun(n)
    Mx = physical_mix(cfg)
    w = slice(N_settle, nt)
    sig = cfg['sigma']
    kk = sig / math.sqrt(2 / math.pi)
    Rv = {v: apply_variant(v, Xfun, n[w], models, n_start=0) for v in variants}
    out = {'g': {v: {} for v in variants}, 'g_open_loop': {}}
    for nm, vec in dirs.items():
        d = X @ (Mx @ vec)
        y = loop.filt(d)[w]
        dw = d[w]
        zr = X[w] @ vec
        out['g_open_loop'][nm] = [float(np.mean(special.erf(A * dw / (math.sqrt(2) * sig)) * zr) * kk / A)
                                  for A in amps]
        for v in variants:
            z = Rv[v] @ vec
            out['g'][v][nm] = [float(np.mean(special.erf(A * y / (math.sqrt(2) * sig)) * z) * kk / A)
                               for A in amps]
    return out


# ======================================================================================
# 6. Small sign-error block-LMS simulator (real 1-bit comparator)
# ======================================================================================

def run_sign_lms(loop: Loop, alpha: float, variant: str = 'raw', cfg: Optional[dict] = None,
                 n_blocks: int = 4000, N_blk: int = 512, tau_blocks: float = 25.0, seed: int = 3,
                 models=None, w0=None, rec_every: int = 20, N_settle: int = 4096, lanes: int = 1) -> dict:
    """Closed-loop sign-error LMS, same injection model and step-size normalisation as the
    simulator (H == 1 time constant tau_blocks; NLMS-style power normalisation of the variant):
       q = sign(e_PD + v),  w_g += mu_g mean(q r_g),  w_k += mu_p mean(q r_k).
    `lanes` independent noise realisations are run in parallel.  Returns PHOS rms error (fs,
    common mode removed) and GOS error (fs at code 1) vs block."""
    cfg = cfg or sim_cfg()
    rng = np.random.default_rng(seed)
    sig, Dl, a, eps = cfg['sigma'], cfg['Delta'], cfg['a'], np.asarray(cfg['eps'])
    ccmp = math.sqrt(2 / math.pi) / sig
    mu_p = 8.0 / (tau_blocks * ccmp)
    mu_g = 12.0 / (tau_blocks * ccmp * Dl)
    Xfun = lambda nn: regressor_matrix(*seq_acc(alpha, nn))
    npre = np.arange(1 << 15)
    Rp = apply_variant(variant, Xfun, npre, models)[1 << 12:]
    pg = Rp[:, 0].var()
    pp = (Rp[:, 1:] ** 2).mean()
    mu_g *= (1 / 12) / max(pg, 1e-12)
    mu_p *= (1 / 8) / max(pp, 1e-12)
    wg = np.zeros(lanes) if w0 is None else np.full(lanes, w0[0])
    W = np.zeros((lanes, NPH)) if w0 is None else np.tile(np.asarray(w0[1], float), (lanes, 1))
    zi = loop.zi_zeros(lanes)
    fx_zi = None
    if variant.startswith('fx:'):
        m = models[variant[3:]]
        fx_zi = np.zeros((max(len(m.bH), len(m.aH)) - 1, 1 + NPH))
    rec = dict(block=[], phos_rms_fs=[], gos_err_fs=[])

    def regs(n0, N):
        nn = np.arange(n0, n0 + N)
        if variant.startswith('fx:'):
            nonlocal fx_zi
            m = models[variant[3:]]
            Y, fx_zi = m.filt(Xfun(nn), axis=0, zi=fx_zi)
            return Xfun(nn), Y
        return Xfun(nn), apply_variant(variant, Xfun, nn, models)

    def inj(X):
        c, P1 = X[:, 0], X[:, 1:]
        epsp = P1 @ eps
        wp = P1 @ W.T                                   # (N, lanes)
        gain = (1 - a) * (1 + wg)
        return (c * Dl + epsp)[:, None] - gain[None, :] * (c[:, None] * Dl + wp)

    def record(b):
        gain = (1 - a) * (1 + wg)
        perr = gain[:, None] * W - eps[None, :]
        perr -= perr.mean(axis=1, keepdims=True)
        rec['block'].append(b)
        rec['phos_rms_fs'].append((np.sqrt((perr ** 2).mean(axis=1)) * 1000).tolist())
        rec['gos_err_fs'].append(((gain - 1) * Dl * 1000).tolist())

    n0 = 0
    while n0 < N_settle:
        X, _ = regs(n0, N_blk)
        _, zi = loop.filt(inj(X), axis=0, zi=zi)
        n0 += N_blk
    for b in range(n_blocks):
        X, R = regs(n0, N_blk)
        e, zi = loop.filt(inj(X), axis=0, zi=zi)
        n0 += N_blk
        if b % rec_every == 0:
            record(b)
        q = np.sign(e + rng.normal(0, sig, e.shape))
        G = q.T @ R / N_blk                              # (lanes, 9)
        wg += mu_g * G[:, 0]
        W += mu_p * G[:, 1:]
    record(n_blocks)
    rec['mu_g'], rec['mu_p'] = mu_g, mu_p
    return rec


# ======================================================================================
# 7. Closed-form band edges / conditions (see reconcile.py for their verification)
# ======================================================================================

def typeI_ReH(K: float, f):
    """Exact Re{H_PD} of L = K z^-1/(1-z^-1): (2-K)(1-cos W)/|1-(1-K)e^{-jW}|^2 >= 0 for 0<K<2."""
    W = TWO_PI * np.asarray(f, float)
    return (2 - K) * (1 - np.cos(W)) / np.abs(1 - (1 - K) * np.exp(-1j * W)) ** 2


def typeII_f_inv(Kp: float, Ki: float) -> float:
    """Exact upper edge (normalised f) of Re{H_PD} < 0 for L2 with one-cycle latency:
    f_inv = (1/pi) asin sqrt(Ki/(2(2-Kp)))  (the band is [0, f_inv])."""
    return math.asin(math.sqrt(Ki / (2 * (2 - Kp)))) / math.pi


def gos_small_beta(loop: Loop, beta: float, D: int = 0) -> float:
    """Small-beta (slow sawtooth) asymptote C_GOS ~ (beta/2)(S_inf - 2 S_D) [+ beta^2/Ki when
    S_inf - 2S_D = 0 for Type-II at D = 0], S_inf = sum of the step response of H_PD,
    S_D = sum_{n<D} s[n]."""
    s = loop.step(80000)
    S_inf = float(s.sum())
    S_D = float(s[:D].sum()) if D > 0 else 0.0
    lead = 0.5 * beta * (S_inf - 2 * S_D)
    if loop.ltype == 2 and D == 0:
        return beta ** 2 / loop.params.get('Ki', loop.params.get('K', np.nan))
    return lead


def kernel_min(loop: Loop, variant: str = 'raw', models=None, n: int = 200001) -> dict:
    """min_f Re Gamma_eff(f).  THEOREM (linearised, steady state): for real regressors the
    symmetric part of C is  sum_lines Re Gamma_eff(f_l) a_l a_l^H  (a_l = line coefficient vectors),
    so  Re Gamma_eff(f) >= 0 for all f  =>  every eigenvalue of the joint 9x9 GOS+PHOS matrix has
    Re >= 0 for EVERY alpha (rational or not, any Q).  A negative minimum is necessary for an
    inversion but not sufficient (the lines must land there with enough weight)."""
    f = np.concatenate([np.geomspace(1e-8, 1e-3, 2000, endpoint=False), np.linspace(1e-3, 0.5, n)])
    g = np.real(gamma_eff(loop, variant, models)(f))
    i = int(np.argmin(g))
    neg = g < -1e-15
    return dict(min=float(g[i]), f_at_min=float(f[i]), any_negative=bool(neg.any()),
                neg_f_max=float(f[neg].max()) if neg.any() else None)


def one_diff_margin(loop: Loop, n: int = 200001) -> dict:
    """First-difference regressor: Re{H(1-e^{jW})} >= 0  <=>  1 - cos W + Re{(1-e^{-jW}) L(e^{jW})} >= 0
    (uses h_PD[0] = 1).  Closed forms (one-cycle latency):
      Type-I  L = K z^-1/(1-z^-1)            : 1-(1-K) cos W >= 0      <=  0 < K <= 2
      Type-II L = (Kp+Ki/(1-z^-1))z^-1/(1-z^-1): 1-Ki/2-(1-Kp) cos W >= 0 <= Ki <= 2 Kp and Kp+Ki/2 <= 2."""
    f = np.concatenate([np.geomspace(1e-5, 1e-3, 2000, endpoint=False), np.linspace(1e-3, 0.5, n)])
    W = TWO_PI * f                       # (f >= 1e-5: avoids cancellation at the double DC pole)
    zi = np.exp(-1j * W)
    g = 1 - np.cos(W) + np.real((1 - zi) * loop.L(f))
    i = int(np.argmin(g))
    return dict(min=float(g[i]), f_at_min=float(f[i]))


def phos_m1_bounds(loop: Loop, alpha: float, variant: str = 'raw', models=None) -> tuple:
    """Rigorous bounds for the ergodic mode-1 gain:  8 Re lambda_1 = w1 Re G(alpha) + sum_{l!=1} w_l Re G(l alpha),
    w1 = 64 sin^2(pi/8)/pi^2 = 0.94964, sum w = 1  =>
       w1 ReG(a) + (1-w1) min ReG  <=  8 Re lambda_1  <=  w1 ReG(a) + (1-w1) max ReG."""
    G = gamma_eff(loop, variant, models)
    w1 = 64 * math.sin(math.pi / 8) ** 2 / math.pi ** 2
    f = np.linspace(0, 0.5, 100001)
    g = np.real(G(f))
    ga = float(np.real(G(np.array([alpha % 1.0])))[0])
    return w1 * ga + (1 - w1) * g.min(), w1 * ga + (1 - w1) * g.max()


if __name__ == '__main__':
    for k, lp in nominal_loops().items():
        s = lp.summary()
        print(k, {q: s[q] for q in ('f3dB_MHz', 'fc_MHz', 'PM_deg', 'T_peak_dB', 'ReH_neg_bands_MHz')}, lp.params)
