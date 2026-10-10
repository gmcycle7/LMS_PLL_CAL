#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loops.py -- sampled-data loop models for the SSPLL / CPPLL GOS-PHOS polarity study.

Conventions (identical to analysis/sspll/{loops,regressors,sim,reconcile}):
  * time unit = one reference period T_ref (f_ref = 4 GHz, T_ref = 250 ps);
  * frequency f is normalised to f_ref (cycles / sample), Omega = 2 pi f, z^-1 = e^{-j Omega};
  * L(z) = bL(z^-1)/aL(z^-1) is the open-loop gain, STRICTLY proper (>= 1 cycle latency),
    so h_PD[0] = 1;
  * H_PD = 1/(1+L)   (error injected at the phase-comparison node -> PD residual),
    T    = L/(1+L)   (closed-loop transfer whose |T| -3 dB is the 320 MHz design target).

Loops
  L1  SSPLL Type-I            L = K z^-1/(1-z^-1)
  L2  SSPLL Type-II (P + I)   L = (Kp + Ki/(1-z^-1)) z^-1/(1-z^-1)
  L3  CPPLL 3rd-order type-II L(s) = K(1+s/wz)/(s^2(1+s/wp)), sampled (impulse / halfT / zoh)
  P-only remedies: integral path held during calibration (L2 -> Type-I with K = Kp;
  L3 -> R(+C2) path only, two variants: C1 >> C2 approximation and exact R || C2).
"""
from __future__ import annotations

import math
from typing import Callable, Dict, Optional

import numpy as np
from scipy import optimize, signal

F_REF = 4e9          # Hz
BW = 320e6           # Hz, closed-loop |T| -3 dB target
NPH = 8              # PMUX phases
TWO_PI = 2.0 * np.pi


# --------------------------------------------------------------------------------------
# polynomial helpers: coefficient c[k] multiplies z^-k
# --------------------------------------------------------------------------------------
def padd(a, b) -> np.ndarray:
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    n = max(len(a), len(b))
    return np.pad(a, (0, n - len(a))) + np.pad(b, (0, n - len(b)))


def peval(c, zinv):
    return np.polyval(np.asarray(c, float)[::-1], zinv)


class Loop:
    """Sampled-data loop gain L(z) = bL(z^-1)/aL(z^-1).  H_PD = aL/(aL+bL), T = bL/(aL+bL)."""

    def __init__(self, name: str, bL, aL, ltype: int, params: Optional[dict] = None):
        self.name = name
        self.bL = np.asarray(bL, float)
        self.aL = np.asarray(aL, float)
        if abs(self.bL[0]) > 1e-14 * max(1.0, float(np.max(np.abs(self.bL)))):
            raise ValueError("L must be strictly proper (>= 1 cycle latency)")
        self.bH = self.aL.copy()
        self.aH = padd(self.aL, self.bL)
        self.ltype = ltype
        self.params = dict(params or {})

    # ---- frequency responses (f normalised to f_ref) ----
    def L(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return peval(self.bL, zi) / peval(self.aL, zi)

    def H(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return peval(self.bH, zi) / peval(self.aH, zi)

    def T(self, f):
        Lf = self.L(f)
        return Lf / (1.0 + Lf)

    # ---- time domain ----
    def impulse(self, n: int) -> np.ndarray:
        x = np.zeros(n)
        x[0] = 1.0
        return signal.lfilter(self.bH, self.aH, x)

    def step(self, n: int) -> np.ndarray:
        return np.cumsum(self.impulse(n))

    def filt(self, x, axis=0, zi=None):
        """e = h_PD * x (zero initial state unless zi is given)."""
        if zi is None:
            return signal.lfilter(self.bH, self.aH, x, axis=axis)
        return signal.lfilter(self.bH, self.aH, x, axis=axis, zi=zi)

    def zi_zeros(self, lanes: int) -> np.ndarray:
        return np.zeros((max(len(self.bH), len(self.aH)) - 1, lanes))

    def poles(self) -> np.ndarray:
        return np.roots(self.aH)

    def stable(self) -> bool:
        return bool(np.all(np.abs(self.poles()) < 1 - 1e-12))

    # ---- figures of merit ----
    def f3db(self) -> float:
        """First frequency (normalised) where |T| falls to 1/sqrt(2)."""
        f = np.linspace(1e-7, 0.5, 20001)
        Tm = np.abs(self.T(f))
        idx = np.nonzero(Tm < 1 / math.sqrt(2))[0]
        if not len(idx):
            return 0.5
        i = idx[0]
        if i == 0:
            return float(f[0])
        return optimize.brentq(lambda x: abs(self.T(x)) - 1 / math.sqrt(2), f[i - 1], f[i], xtol=1e-15)

    def margins(self) -> dict:
        """Unity-gain crossover fc (normalised) and phase margin (deg, phase unwrapped from DC)."""
        f = np.concatenate([np.geomspace(1e-8, 1e-3, 400, endpoint=False), np.linspace(1e-3, 0.5, 40001)])
        Lc = self.L(f)
        ic = np.nonzero(np.abs(Lc) < 1)[0]
        if not len(ic) or ic[0] == 0:
            return dict(fc=float('nan'), PM_deg=float('nan'))
        i = ic[0]
        fc = optimize.brentq(lambda x: abs(self.L(x)) - 1, f[i - 1], f[i], xtol=1e-15)
        ph = np.unwrap(np.angle(Lc[: i + 1]))
        ph += TWO_PI * round((-self.ltype * np.pi / 2 - ph[0]) / TWO_PI)
        phc = ph[-1] + np.angle(np.exp(1j * (np.angle(self.L(fc)) - ph[-1])))
        return dict(fc=float(fc), PM_deg=float(180 + math.degrees(phc)))

    def inversion_bands(self, n: int = 200001) -> list:
        """Intervals (normalised f) where Re H_PD < 0  <=>  Re L < -1 (exact identity)."""
        f = np.concatenate([np.geomspace(1e-8, 1e-3, 400, endpoint=False), np.linspace(1e-3, 0.5, n)])
        g = self.L(f).real + 1.0
        neg = g < 0
        out = []
        i, N = 0, len(f)
        while i < N:
            if neg[i]:
                j = i
                while j + 1 < N and neg[j + 1]:
                    j += 1
                lo = 0.0 if i == 0 else optimize.brentq(lambda x: self.L(x).real + 1, f[i - 1], f[i], xtol=1e-15)
                hi = 0.5 if j == N - 1 else optimize.brentq(lambda x: self.L(x).real + 1, f[j], f[j + 1], xtol=1e-15)
                Hs = self.H(f[i:j + 1]).real
                k = int(np.argmin(Hs))
                if Hs[k] < -1e-9 and hi - lo > 1e-9:      # drop round-off artefacts near DC (|L| ~ 1/f)
                    out.append(dict(f_lo=float(lo), f_hi=float(hi), min_ReH=float(Hs[k]), f_min=float(f[i + k])))
                i = j + 1
            else:
                i += 1
        return out

    def summary(self, f_ref: float = F_REF) -> dict:
        m = self.margins()
        f = np.linspace(1e-7, 0.5, 100001)
        Tm = np.abs(self.T(f))
        ReH = self.H(f).real
        return dict(name=self.name, type=self.ltype, params=self.params,
                    f3dB_MHz=self.f3db() * f_ref / 1e6, fc_MHz=m['fc'] * f_ref / 1e6, PM_deg=m['PM_deg'],
                    T_peak_dB=float(20 * np.log10(Tm.max())), stable=self.stable(),
                    max_pole_mag=float(np.max(np.abs(self.poles()))),
                    max_ReH=float(ReH.max()),
                    ReH_neg_bands_MHz=[[b['f_lo'] * f_ref / 1e6, b['f_hi'] * f_ref / 1e6, b['min_ReH'],
                                        b['f_min'] * f_ref / 1e6] for b in self.inversion_bands()],
                    h0=float(self.impulse(1)[0]), bL=self.bL.tolist(), aL=self.aL.tolist())


# --------------------------------------------------------------------------------------
# design helpers
# --------------------------------------------------------------------------------------
def _solve_gain(build: Callable[[float], Loop], bw_norm: float, lo=-12.0, hi=1.0, n=60) -> float:
    """Find the gain g (searched on a log grid) such that |T| -3 dB = bw_norm (first bracket)."""
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


def latency_poly(lat: float) -> np.ndarray:
    """z^-lat for lat >= 1: integer part as a pure delay; a fractional part f is modelled as the
    held-control split (1-f) z^-i + f z^-(i+1).  (Fractional latency is model dependent; the
    document only quotes integer-latency numbers.)"""
    i = int(math.floor(lat + 1e-12))
    fr = lat - i
    c = np.zeros(i + 2)
    c[i] += 1 - fr
    c[i + 1] += fr
    return np.trim_zeros(c, 'b')


def typeI_K_closed_form(bw: float = BW, f_ref: float = F_REF) -> float:
    """L1 with one-cycle latency: |T|^2 = 1/2 at W3 gives 1-K = c - sqrt(c^2-1), c = 2 - cos W3."""
    W3 = TWO_PI * bw / f_ref
    c = 2 - math.cos(W3)
    return 1 - (c - math.sqrt(c * c - 1))


def make_L1(K: Optional[float] = None, lat: float = 1.0, f_pole: Optional[float] = None,
            bw: float = BW, f_ref: float = F_REF, name: Optional[str] = None) -> Loop:
    """SSPLL Type-I: L = K z^-lat/(1-z^-1) [x (1-p)/(1-p z^-1), p = exp(-2 pi f_pole/f_ref)]."""
    nl = latency_poly(lat)
    if f_pole is None:
        bp, ap = np.array([1.0]), np.array([1.0])
    else:
        p = math.exp(-TWO_PI * f_pole / f_ref)
        bp, ap = np.array([1 - p]), np.array([1.0, -p])
    nm = name or ("L1" + ("" if lat == 1 else f"_lat{lat:g}") + ("" if f_pole is None else f"_pole{f_pole / 1e6:g}M"))

    def build(k):
        return Loop(nm, k * np.convolve(nl, bp), np.convolve([1.0, -1.0], ap), 1,
                    dict(K=k, lat=lat, f_pole=f_pole))
    if K is None:
        if lat == 1 and f_pole is None:
            K = typeI_K_closed_form(bw, f_ref)
        else:
            K = _solve_gain(build, bw / f_ref, lo=-8, hi=0.5)
    return build(K)


def make_L2(pm: float = 60.0, lat: float = 1.0, bw: float = BW, f_ref: float = F_REF,
            Kp: Optional[float] = None, Ki: Optional[float] = None, gain_scale: float = 1.0,
            name: Optional[str] = None) -> Loop:
    """SSPLL Type-II: L = (Kp + Ki/(1-z^-1)) z^-lat/(1-z^-1).
    Design: Ki = wn^2, Kp = 2 zeta wn; zeta solved for the sampled-data PM, wn for |T| -3 dB = bw.
    gain_scale multiplies (Kp, Ki) AFTER the design (PVT loop-gain variation, not re-designed)."""
    nl = latency_poly(lat)
    nm = name or (f"L2_pm{pm:g}" + ("" if lat == 1 else f"_lat{lat:g}") + ("" if gain_scale == 1 else f"_g{gain_scale:g}"))

    def build2(kp, ki):
        num = padd(kp * np.array([1.0, -1.0]), [ki])
        return Loop(nm, np.convolve(num, nl), np.convolve([1.0, -1.0], [1.0, -1.0]), 2,
                    dict(Kp=kp, Ki=ki, lat=lat, pm_target=pm))
    if Kp is not None and Ki is not None:
        return build2(Kp * gain_scale, Ki * gain_scale)
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
    lp = build2(2 * z * w * gain_scale, w * w * gain_scale)
    lp.params.update(zeta_ct=z, wn=w)
    return lp


def make_L3(pm_ct: float = 60.0, mapping: str = 'impulse', bw: float = BW, f_ref: float = F_REF,
            b: Optional[float] = None, wc: Optional[float] = None, gain_scale: float = 1.0,
            name: Optional[str] = None) -> Loop:
    """Conventional CPPLL: L(s) = K(1+s/wz)/(s^2(1+s/wp)), wz = wc/sqrt(b), wp = wc sqrt(b),
    K = wc^2/sqrt(b), b = ((1+sin PM)/cos PM)^2 = 1 + C1/C2 (classical PM-optimal placement).
    Sampled with T_ref = 1:
      'impulse' : CP charge packet at nT, phase compared at (n+1)T -> L(z) = sum_{n>=1} l(n) z^-n
      'halfT'   : packet centred at nT + T/2 (e^{-sT/2}-type delay) -> sum_{n>=1} l(n-1/2) z^-n
      'zoh'     : PD output held over a full cycle (step-invariant)
    with l(t) = K t + B + C e^{-wp t},  C = K(1-wp/wz)/wp,  B = -C  (partial fractions).
    wc is scaled for |T| -3 dB = bw; gain_scale multiplies K afterwards (PVT, not re-designed)."""
    if b is None:
        ph = math.radians(pm_ct)
        b = ((1 + math.sin(ph)) / math.cos(ph)) ** 2
    nm = name or (f"L3_{mapping}_pm{pm_ct:g}" + ("" if gain_scale == 1 else f"_g{gain_scale:g}"))

    def build(w, gs=1.0):
        sb = math.sqrt(b)
        wz, wp = w / sb, w * sb
        K = w * w / sb * gs
        Cc = K * (1 - wp / wz) / wp
        Bc = -Cc
        p = math.exp(-wp)
        if mapping in ('impulse', 'halfT'):
            tau = 0.0 if mapping == 'impulse' else 0.5
            d1 = np.array([1.0, -1.0])
            d2 = np.convolve(d1, d1)
            dp = np.array([1.0, -p])
            n1 = np.convolve([0.0, K], dp)
            n2 = np.convolve(np.convolve([0.0, Bc - K * tau], d1), dp)
            n3 = np.convolve([0.0, Cc * p * math.exp(wp * tau)], d2)
            num = padd(padd(n1, n2), n3)
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
                                          B=Bc, p=p,
                                          fz_MHz=wz * f_ref / TWO_PI / 1e6, fp_MHz=wp * f_ref / TWO_PI / 1e6,
                                          fc_ct_MHz=w * f_ref / TWO_PI / 1e6))
    if wc is None:
        wc = _solve_gain(build, bw / f_ref, lo=-6, hi=0.5)
    return build(wc, gain_scale)


def make_P_only_L2(loop2: Loop, name: Optional[str] = None) -> Loop:
    """Remedy: hold (freeze) the integral path of the Type-II SSPLL during calibration.
    Remaining loop: Type-I, L = Kp z^-lat/(1-z^-1).  Re H_PD >= 0 for all f iff Kp(lat-1/2) <= 1."""
    return make_L1(K=loop2.params['Kp'], lat=loop2.params.get('lat', 1.0), name=name or (loop2.name + "_Ponly"))


def make_P_only_L3(loop3: Loop, exact_hold: bool = False, name: Optional[str] = None) -> Loop:
    """Remedy for the CPPLL: hold the integrating capacitor C1 during calibration.
    exact_hold=False : remaining path ~ (K/wz)/(s(1+s/wp))  (C1 >> C2 approximation).
    exact_hold=True  : exact R || C2: gain x b/(b-1), pole wp (b-1)/b   (b - 1 = C1/C2).
    Impulse-invariant: L = A [z^-1/(1-z^-1) - p z^-1/(1-p z^-1)],  p = exp(-wp')."""
    pr = loop3.params
    A = pr['K'] / pr['wz']
    wp = pr['wp']
    if exact_hold:
        A *= pr['b'] / (pr['b'] - 1)
        wp *= (pr['b'] - 1) / pr['b']
    p = math.exp(-wp)
    num = A * padd(np.convolve([0.0, 1.0], [1.0, -p]), -p * np.convolve([0.0, 1.0], [1.0, -1.0]))
    den = np.convolve([1.0, -1.0], [1.0, -p])
    return Loop(name or (loop3.name + ("_Ponly_exactRC2" if exact_hold else "_Ponly")), num, den, 1,
                dict(A=A, wp=wp, p=p, exact_hold=exact_hold, src=loop3.name))


def nominal_loops(bw: float = BW) -> Dict[str, Loop]:
    """The three reconciled loops: L1 (Type-I SSPLL), L2 (Type-II SSPLL, PM 60 deg), L3 (CPPLL,
    impulse-invariant, continuous-time PM 60 deg placement)."""
    return {'L1': make_L1(bw=bw), 'L2': make_L2(60.0, bw=bw), 'L3': make_L3(60.0, 'impulse', bw=bw)}


# --------------------------------------------------------------------------------------
# closed forms (exact within the stated model)
# --------------------------------------------------------------------------------------
def typeI_ReH(K: float, f):
    """Exact Re H_PD of L = K z^-1/(1-z^-1):  (2-K)(1-cos W)/|1-(1-K) e^{-jW}|^2  (>= 0 for 0<K<2)."""
    W = TWO_PI * np.asarray(f, float)
    return (2 - K) * (1 - np.cos(W)) / np.abs(1 - (1 - K) * np.exp(-1j * W)) ** 2


def typeII_ReL(Kp: float, Ki: float, f):
    """Exact Re L of the one-cycle-latency Type-II SSPLL:  -Kp/2 - Ki/(4 sin^2(W/2))."""
    W = TWO_PI * np.asarray(f, float)
    return -Kp / 2 - Ki / (4 * np.sin(W / 2) ** 2)


def typeII_f_inv(Kp: float, Ki: float) -> float:
    """Upper edge (normalised f) of the band Re H_PD < 0 of L2:  (1/pi) asin sqrt(Ki/(2(2-Kp)))."""
    return math.asin(math.sqrt(Ki / (2 * (2 - Kp)))) / math.pi


def cppll_minus_ReL(loop3: Loop, f):
    """Exact -Re L of the impulse-invariant CPPLL:  K/(4 sin^2(W/2)) + B(1-p^2)/(2|1-p e^{-jW}|^2),
    B = K(wp/wz - 1)/wp > 0, p = exp(-wp)."""
    pr = loop3.params
    W = TWO_PI * np.asarray(f, float)
    p = math.exp(-pr['wp'])
    B = pr['K'] * (pr['wp'] / pr['wz'] - 1) / pr['wp']
    return pr['K'] / (4 * np.sin(W / 2) ** 2) + B * (1 - p * p) / (2 * np.abs(1 - p * np.exp(-1j * W)) ** 2)


def typeI_latency_criterion(K: float, d: int) -> float:
    """L = K z^-d/(1-z^-1): Re L = -K sin((d-1/2)W)/(2 sin(W/2)) >= -K(d-1/2).
    An inversion band exists iff K(d - 1/2) > 1 (integer d)."""
    return K * (d - 0.5)


def typeI_pole_criterion(K: float, p: float) -> float:
    """L = K(1-p) z^-1/((1-z^-1)(1-p z^-1)): Re L >= -K(1/2 + p/(1-p)) (approached at DC).
    An inversion band exists iff K(1/2 + p/(1-p)) > 1.  Same form for the P-only CPPLL with K -> A."""
    return K * (0.5 + p / (1 - p))


def low_freq_ReH_coeff(loop: Loop) -> float:
    """Return k such that Re H_PD ~ -k Omega^2 near DC for a type-II loop (k = 1/Ki for L2,
    1/K_d with K_d = (wc T)^2/sqrt(b) = K for the impulse CPPLL)."""
    if loop.ltype != 2:
        raise ValueError("type-II loops only")
    pr = loop.params
    return 1.0 / (pr['Ki'] if 'Ki' in pr else pr['K'])
