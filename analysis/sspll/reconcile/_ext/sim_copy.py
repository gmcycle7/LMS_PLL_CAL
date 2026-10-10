#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Independent time-domain behavioural simulation of GOS / PHOS sign-LMS calibration
in a fractional-N PLL (8-phase PMUX in the feedback + input DTC on the reference).

Everything that decides a SIGN in this file is measured in the time domain:
  * the PLL is simulated sample-by-sample (one step per reference cycle) as an explicit
    state-space recursion of the loop (no lfilter, no frequency-domain correlation formula);
  * the GMAC slope matrix S = dE[G]/dw is measured by freezing the LMS, perturbing each
    weight by +/-delta around the calibrated point, letting the PLL settle and averaging
    the GMAC over long records (common random numbers for the comparator noise);
  * the closed-loop sign-error LMS is run block by block.
Frequency responses are used ONLY to *design* the loops (find K / Kp,Ki / wc for a
320 MHz closed-loop -3 dB point and a phase-margin target); the -3 dB point and the
sign of Re{H_PD} are then *re-measured* in the time domain by sinusoidal injection.

Units inside the simulation: time in ps.  f_ref = 4 GHz -> T_ref = 250 ps.
f_vco = 16 GHz is ILLUSTRATIVE (only Delta = T_vco/8 and the optional SSPD sine
non-linearity depend on it; a check with 12/24 GHz is included).

Usage:  python3 sim.py all            (everything, ~15-30 min on 18 cores)
        python3 sim.py quick          (smoke test)
"""
import os
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import sys
import json
import time
import math
import multiprocessing as mp
import warnings
import numpy as np
from scipy import signal, linalg, optimize, special, stats

HERE = os.path.dirname(os.path.abspath(__file__))
warnings.filterwarnings('ignore', category=signal.BadCoefficients)

# ----------------------------------------------------------------------------------------
# Global configuration
# ----------------------------------------------------------------------------------------
F_REF = 4e9                 # reference / SSPD sampling rate [Hz]
T_REF_PS = 1e12 / F_REF     # 250 ps
F3DB_TARGET = 320e6         # closed-loop -3 dB of T = L/(1+L)
F_VCO_DEFAULT = 16e9        # ILLUSTRATIVE VCO frequency
SIGMA_V_PS = 0.200          # comparator-referred Gaussian noise sigma_v (illustrative) [ps]
A_GOS = 0.03                # DTC gain deficit: actual DTC gain = (1 - a) * nominal
EPS_SEED = 7                # seed of the PMUX per-phase offsets
EPS_RMS_PS = 0.25           # rms of PMUX phase offsets (illustrative) [ps]
DELTA_PERT_PS = 0.03        # +/- perturbation used to measure S [ps]
ACC_BITS = 32               # fractional accumulator word length
M29 = (1 << 29) - 1
M32 = (1 << 32) - 1


def make_cfg(f_vco=F_VCO_DEFAULT, sigma_v=SIGMA_V_PS, a=A_GOS):
    rng = np.random.default_rng(EPS_SEED)
    eps = rng.normal(0.0, EPS_RMS_PS, 8)
    eps = eps - eps.mean()           # common mode is unobservable anyway
    t_vco = 1e12 / f_vco
    return dict(f_vco=f_vco, T_vco=t_vco, Delta=t_vco / 8.0, sigma=sigma_v, a=a,
                eps=eps, wg_star=a / (1.0 - a))


# ----------------------------------------------------------------------------------------
# Loop models (discrete state space at f_ref:  x_v = C s ,  s+ = A s + B e ,  L(z)=C(zI-A)^-1 B)
# ----------------------------------------------------------------------------------------
def ss_from_tf_zinv(num, den):
    """num/den are polynomials in z^-1 (num[0] must be 0: strictly proper)."""
    L = max(len(num), len(den))
    num = np.r_[np.asarray(num, float), np.zeros(L - len(num))]
    den = np.r_[np.asarray(den, float), np.zeros(L - len(den))]
    A, B, C, D = signal.tf2ss(num, den)
    assert abs(D[0, 0]) < 1e-12, "loop must be strictly proper"
    return A, B[:, 0].copy(), C[0].copy()


def L_resp(loop, f):
    """Open-loop frequency response L(e^{jw}) -- used for DESIGN only."""
    f = np.atleast_1d(np.asarray(f, float))
    w = 2 * np.pi * f / F_REF
    z = np.exp(1j * w)
    A, B, C = loop['A'], loop['B'], loop['C']
    n = A.shape[0]
    M = z[:, None, None] * np.eye(n)[None] - A[None]
    rhs = np.broadcast_to(B.astype(complex)[None, :, None], (len(f), n, 1))
    x = np.linalg.solve(M, rhs)[:, :, 0]
    return x @ C


def f3db_of(loop):
    f = np.logspace(5, np.log10(1.999e9), 4000)
    L = L_resp(loop, f)
    T = np.abs(L / (1 + L))
    below = np.nonzero(T < 1 / np.sqrt(2))[0]
    if len(below) == 0:
        return np.nan
    i = below[0]
    if i == 0:
        return np.nan
    g = lambda x: abs((lambda l: l / (1 + l))(L_resp(loop, x)[0])) - 1 / np.sqrt(2)
    return optimize.brentq(g, f[i - 1], f[i], xtol=1e-3)


def pm_of(loop):
    f = np.logspace(5, np.log10(1.999e9), 4000)
    L = L_resp(loop, f)
    m = np.abs(L)
    below = np.nonzero(m < 1)[0]
    if len(below) == 0 or below[0] == 0:
        return np.nan, np.nan
    i = below[0]
    g = lambda x: np.log(abs(L_resp(loop, x)[0]))
    fc = optimize.brentq(g, f[i - 1], f[i], xtol=1e-3)
    ang = np.angle(L_resp(loop, fc)[0], deg=True)
    pm = 180.0 + ang
    pm = (pm + 180) % 360 - 180
    return pm, fc


def peaking_db(loop):
    f = np.logspace(5, np.log10(1.999e9), 4000)
    L = L_resp(loop, f)
    return 20 * np.log10(np.max(np.abs(L / (1 + L))))


def cl_stable(loop):
    F = loop['A'] - np.outer(loop['B'], loop['C'])
    return float(np.max(np.abs(np.linalg.eigvals(F))))


def make_L1(K, lat=1, pole_f=None, name=None):
    num = [0.0] * lat + [K]
    den = [1.0, -1.0]
    meta = dict(kind='L1', K=K, lat=lat, pole_f=pole_f)
    if pole_f is not None:
        beta = math.exp(-2 * math.pi * pole_f / F_REF)
        num = np.convolve(num, [1 - beta])
        den = np.convolve(den, [1.0, -beta])
        meta['beta'] = beta
    A, B, C = ss_from_tf_zinv(num, den)
    return dict(name=name or 'L1', A=A, B=B, C=C, meta=meta)


def make_L2(Kp, Ki, lat=1, name=None):
    # L(z) = (Kp + Ki/(1-z^-1)) z^-lat/(1-z^-1)
    num = [0.0] * lat + [Kp + Ki, -Kp]
    den = [1.0, -2.0, 1.0]
    A, B, C = ss_from_tf_zinv(num, den)
    return dict(name=name or 'L2', A=A, B=B, C=C,
                meta=dict(kind='L2', Kp=Kp, Ki=Ki, lat=lat))


def make_L3(wc, pm_ct, mapping='imp', name=None):
    """CPPLL: continuous L(s) = K (1+s/wz) / (s^2 (1+s/wp)), wz=wc/sqrt(b), wp=wc*sqrt(b),
    K = wc^2/sqrt(b) (|L(j wc)|=1), b from the continuous phase margin.
    time unit = T_ref (wc in rad per T_ref).  Sampled-data mappings:
      'imp'  : CP charge = impulse of area T*e[n] at t=nT, VCO phase sampled at (n+1)T
               (impulse invariance with the natural one-cycle latency; Hein-Scott model)
      'zoh'  : PD output held over [nT,(n+1)T) (ZOH equivalent; SSPLL-S&H-like)
      'halfT': impulse at t = nT + T/2 (an e^{-sT/2}-type extra delay)"""
    phi = math.radians(pm_ct)
    b = ((1 + math.sin(phi)) / math.cos(phi)) ** 2
    wz = wc / math.sqrt(b)
    wp = wc * math.sqrt(b)
    K = wc ** 2 / math.sqrt(b)
    num_s = [K * wp / wz, K * wp]            # K wp/wz (s + wz)
    den_s = [1.0, wp, 0.0, 0.0]              # s^2 (s + wp)
    Ac, Bc, Cc, Dc = signal.tf2ss(num_s, den_s)
    Bc = Bc[:, 0]
    Cc = Cc[0]
    n = Ac.shape[0]
    Phi = linalg.expm(Ac)
    if mapping == 'imp':
        G = Phi @ Bc
    elif mapping == 'halfT':
        G = linalg.expm(0.5 * Ac) @ Bc
    elif mapping == 'zoh':
        Maug = np.zeros((n + 1, n + 1))
        Maug[:n, :n] = Ac
        Maug[:n, n] = Bc
        E = linalg.expm(Maug)
        G = E[:n, n]
    else:
        raise ValueError(mapping)
    return dict(name=name or 'L3', A=Phi, B=G, C=Cc.copy(),
                meta=dict(kind='L3', wc_rad_per_Tref=wc, fc_ct_Hz=wc * F_REF / (2 * np.pi),
                          pm_ct=pm_ct, b=b, mapping=mapping,
                          fz_Hz=wz * F_REF / (2 * np.pi), fp_Hz=wp * F_REF / (2 * np.pi), K=K))


def design_L1(lat=1, pole_f=None, f3=F3DB_TARGET, name=None):
    g = lambda K: f3db_of(make_L1(K, lat, pole_f)) - f3
    Ks = np.linspace(0.02, 1.5, 300)
    vals = np.array([g(K) for K in Ks])
    ok = np.nonzero(np.isfinite(vals[:-1]) & np.isfinite(vals[1:]) & (np.sign(vals[:-1]) != np.sign(vals[1:])))[0]
    if len(ok) == 0:
        return None
    i = ok[0]
    K = optimize.brentq(g, Ks[i], Ks[i + 1], xtol=1e-10)
    return make_L1(K, lat, pole_f, name)


def design_L2(pm_target, lat=1, f3=F3DB_TARGET, name=None):
    def kp_for(r):
        g = lambda kp: f3db_of(make_L2(kp, r * kp, lat)) - f3
        kps = np.geomspace(1e-3, 1.5, 120)
        vals = np.array([g(k) for k in kps])
        ok = np.nonzero(np.isfinite(vals[:-1]) & np.isfinite(vals[1:]) & (np.sign(vals[:-1]) != np.sign(vals[1:])))[0]
        if len(ok) == 0:
            return np.nan
        i = ok[0]
        return optimize.brentq(g, kps[i], kps[i + 1], xtol=1e-10)

    def pm_err(lr):
        r = 10 ** lr
        kp = kp_for(r)
        if not np.isfinite(kp):
            return np.nan
        return pm_of(make_L2(kp, r * kp, lat))[0] - pm_target

    lrs = np.linspace(-4, 0.3, 44)
    vals = np.array([pm_err(x) for x in lrs])
    ok = np.nonzero(np.isfinite(vals[:-1]) & np.isfinite(vals[1:]) & (np.sign(vals[:-1]) != np.sign(vals[1:])))[0]
    if len(ok) == 0:
        return None
    i = ok[0]
    lr = optimize.brentq(pm_err, lrs[i], lrs[i + 1], xtol=1e-9)
    r = 10 ** lr
    kp = kp_for(r)
    return make_L2(kp, r * kp, lat, name)


def design_L3(pm_ct, mapping='imp', f3=F3DB_TARGET, name=None):
    g = lambda wc: f3db_of(make_L3(wc, pm_ct, mapping)) - f3
    wcs = np.geomspace(0.05, 1.2, 120)
    vals = np.array([g(w) for w in wcs])
    ok = np.nonzero(np.isfinite(vals[:-1]) & np.isfinite(vals[1:]) & (np.sign(vals[:-1]) != np.sign(vals[1:])))[0]
    if len(ok) == 0:
        return None
    i = ok[0]
    wc = optimize.brentq(g, wcs[i], wcs[i + 1], xtol=1e-10)
    return make_L3(wc, pm_ct, mapping, name)


def loop_summary(loop):
    pm, fc = pm_of(loop)
    return dict(name=loop['name'], meta={k: (float(v) if isinstance(v, (float, np.floating)) else v)
                                         for k, v in loop['meta'].items()},
                f3db_design_Hz=float(f3db_of(loop)), pm_deg=float(pm), fc_Hz=float(fc),
                peaking_dB=float(peaking_db(loop)), cl_spectral_radius=cl_stable(loop),
                n_states=int(loop['A'].shape[0]))


def build_loops(scale=1.0, which=None):
    """All loop variants (closed-loop -3 dB = scale*320 MHz)."""
    f3 = F3DB_TARGET * scale
    sfx = '' if scale == 1.0 else '@%.0fM' % (f3 / 1e6)
    specs = [
        ('L1', lambda: design_L1(1, None, f3, 'L1' + sfx)),
        ('L1_lat2', lambda: design_L1(2, None, f3, 'L1_lat2' + sfx)),
        ('L1_pole2G', lambda: design_L1(1, 2e9, f3, 'L1_pole2G' + sfx)),
        ('L1_pole1G', lambda: design_L1(1, 1e9, f3, 'L1_pole1G' + sfx)),
        ('L1_pole640M', lambda: design_L1(1, 640e6, f3, 'L1_pole640M' + sfx)),
        ('L1_pole400M', lambda: design_L1(1, 400e6, f3, 'L1_pole400M' + sfx)),
        ('L2_pm60', lambda: design_L2(60, 1, f3, 'L2_pm60' + sfx)),
        ('L2_pm45', lambda: design_L2(45, 1, f3, 'L2_pm45' + sfx)),
        ('L2_pm75', lambda: design_L2(75, 1, f3, 'L2_pm75' + sfx)),
        ('L2_pm60_lat2', lambda: design_L2(60, 2, f3, 'L2_pm60_lat2' + sfx)),
        ('L3_imp_pm60', lambda: design_L3(60, 'imp', f3, 'L3_imp_pm60' + sfx)),
        ('L3_imp_pm55', lambda: design_L3(55, 'imp', f3, 'L3_imp_pm55' + sfx)),
        ('L3_zoh_pm60', lambda: design_L3(60, 'zoh', f3, 'L3_zoh_pm60' + sfx)),
        ('L3_halfT_pm60', lambda: design_L3(60, 'halfT', f3, 'L3_halfT_pm60' + sfx)),
    ]
    out = {}
    for key, fn in specs:
        if which is not None and key not in which:
            continue
        lp = fn()
        if lp is not None:
            out[key] = lp
    return out


# ----------------------------------------------------------------------------------------
# Explicit per-sample loop recursion  (this IS the PLL simulation)
# ----------------------------------------------------------------------------------------
def recursion(loop, u, s, nonlin_T=None):
    """u: (N, lanes) injected timing error at the phase-comparison node [ps]
         (= required reference delay - actual reference delay, i.e. t_fb - t_ref
          before the VCO correction);
       s: (ns, lanes) loop state.
       Per reference cycle n:
         x_v[n] = C s[n]                 (VCO excess phase as an edge advance, ps)
         e_PD[n] = u[n] - x_v[n]         (PD residual)
         s[n+1] = A s[n] + B g(e_PD[n])  (loop filter + VCO integrator, one-cycle latency)
       g = identity (linear PD) or the SSPD sine characteristic."""
    A, B, C = loop['A'], loop['B'], loop['C']
    N = u.shape[0]
    e = np.empty_like(u)
    Bc = B[:, None]
    if nonlin_T is None:
        F = A - np.outer(B, C)
        for n in range(N):
            un = u[n]
            e[n] = un - C @ s
            s = F @ s + Bc * un
    else:
        k = 2 * np.pi / nonlin_T
        for n in range(N):
            en = u[n] - C @ s
            e[n] = en
            s = A @ s + Bc * (np.sin(k * en) / k)
    return e, s


# ----------------------------------------------------------------------------------------
# Fractional sequence generators  ->  DTC code c[n] (units of Delta = T_vco/8), PMUX index p[n]
# ----------------------------------------------------------------------------------------
class SeqSource:
    """mode:
       'acc1' : first-order accumulator, phi[n]=frac(n alpha), p=floor(8 phi), c=rho=8 phi-p in [0,1)
       'mash' : MASH-1-1-1 on the 1/8-VCO-period grid; residue in (-2,2) -> c=r+2 in (0,4)
       'dq'   : dithered quantiser P=floor(8 n alpha + u), u~U[0,1) iid; c=r+1 in (0,2)
       'lsb'  : W-bit accumulator with +/-1 LSB random dither on its input (alpha quantised to W bits)
       'rot'  : PMUX random rotation: P' = P + m[n], m iid U{0..M-1}, DTC adds m*Delta; c in (0,M)
    """

    def __init__(self, alphas, mode='acc1', n_start=-64, n_end=None, seed=12345, W=16, M=8):
        self.mode = mode
        self.alpha_int = np.array([int(round(a * 2 ** 32)) for a in alphas], dtype=np.int64)
        self.alphas_q = self.alpha_int / 2.0 ** 32
        self.n_a = len(alphas)
        self.n_start = n_start
        self.extra = None
        if mode == 'acc1':
            return
        assert n_end is not None
        n = np.arange(n_start, n_end, dtype=np.int64)
        self.n = n
        ai = self.alpha_int[None, :]
        rng = np.random.default_rng(seed)
        if mode == 'mash':
            I8 = ai >> 29
            F = ai & M29
            Mo = 1 << 29
            k = (n - n_start)[:, None]                # local time index 0..
            S1 = (k + 1) * F                          # unwrapped stage-1 sum
            acc1 = S1 & M29
            C1 = S1 >> 29
            S2 = np.cumsum(acc1, axis=0)
            acc2 = S2 & M29
            C2 = S2 >> 29
            S3 = np.cumsum(acc2, axis=0)
            acc3 = S3 & M29
            C3 = S3 >> 29
            zero = np.zeros((1, self.n_a), np.int64)
            C2m1 = np.vstack([zero, C2[:-1]])
            C3m1 = np.vstack([zero, C3[:-1]])
            C3m2 = np.vstack([zero, zero, C3[:-2]])
            sum_y = C1 + (C2 - C2m1) + (C3 - 2 * C3m1 + C3m2)   # cumulative MASH output
            P = (k + 1) * I8 + sum_y
            # residue r = Phi - P = (1 - z^-1)^2 acc3 / 2^29  (exact)
            a3 = acc3.astype(np.float64) / Mo
            a3m1 = np.vstack([np.zeros((1, self.n_a)), a3[:-1]])
            a3m2 = np.vstack([np.zeros((2, self.n_a)), a3[:-2]])
            r = a3 - 2 * a3m1 + a3m2
            # integer check of the identity Phi - P == r
            Phi_num = (k + 1) * ai - P * Mo           # in units of 2^-29 Delta (exact int)
            assert np.allclose(Phi_num / Mo, r, atol=1e-9)
            self.p = (P & 7).astype(np.int64)
            self.c = r + 2.0
        elif mode == 'dq':
            u = rng.integers(0, 1 << 29, size=(len(n), self.n_a), dtype=np.int64)
            Phi = n[:, None] * ai                     # units 2^-29 Delta
            P = (Phi + u) >> 29
            r = (Phi - P * (1 << 29)) / 2.0 ** 29
            self.p = (P & 7).astype(np.int64)
            self.c = r + 1.0
        elif mode == 'lsb':
            aW = np.round(self.alphas_q * 2 ** W).astype(np.int64)[None, :]
            self.alphas_q = aW[0] / 2.0 ** W
            b = rng.choice(np.array([-1, 1], np.int64), size=(len(n), self.n_a))
            b[0] = 0
            acc = n[:, None] * aW + np.cumsum(b, axis=0)   # unwrapped, units 2^-W cycles
            Phi8 = acc * 8                                 # units 2^-W Delta
            P = Phi8 >> W
            r = (Phi8 - (P << W)) / 2.0 ** W
            self.p = (P & 7).astype(np.int64)
            self.c = r
            # the PLL must follow the dithered phase: deviation from n*alpha (in Delta units)
            dev = 8.0 * np.cumsum(b, axis=0) / 2.0 ** W
            self.extra = dev                               # x Delta -> extra injection
        elif mode == 'rot':
            Phi = n[:, None] * ai
            P = Phi >> 29
            r = (Phi - P * (1 << 29)) / 2.0 ** 29
            m = rng.integers(0, M, size=(len(n), self.n_a), dtype=np.int64)
            self.p = ((P + m) & 7).astype(np.int64)
            self.c = r - m + (M - 1)
        else:
            raise ValueError(mode)

    def get(self, n0, N):
        if self.mode == 'acc1':
            n = np.arange(n0, n0 + N, dtype=np.int64)
            acc = (n[:, None] * self.alpha_int[None, :]) & M32
            p = acc >> 29
            c = (acc & M29) / 2.0 ** 29
            return c, p
        i0 = n0 - self.n_start
        assert i0 >= 0 and i0 + N <= self.c.shape[0], (n0, N)
        return self.c[i0:i0 + N], self.p[i0:i0 + N]

    def get_extra(self, n0, N):
        if self.extra is None:
            return None
        i0 = n0 - self.n_start
        return self.extra[i0:i0 + N]


def regressors(c, p):
    """X[..., 0] = DTC code (GOS), X[..., 1+k] = 1{p = k} (PHOS)."""
    X = np.zeros(c.shape + (9,))
    X[..., 0] = c
    np.put_along_axis(X[..., 1:], p[..., None], 1.0, axis=-1)
    return X


def e_inj(c, p, wg, W, cfg, extra=None):
    """Injected timing error at the comparison node (ps), shape (N, n_a, nl).
       c,p: (N, n_a); wg: (n_a, nl); W: (n_a, nl, 8).
       Physical model:
         required reference delay = c*Delta + eps_p        (PMUX phase p is late by eps_p)
         actual DTC delay        = (1-a)(1+w_g)(c*Delta + w_p)
       -> fixed point w_g* = a/(1-a), w_p* = eps_p; for w=0: u = a c Delta + eps_p
          (the user's convention e = (a-w_g) rho + (eps_k - w_k) to first order)."""
    D = cfg['Delta']
    a = cfg['a']
    eps = cfg['eps']
    n_a = c.shape[1]
    cD = c * D
    eps_p = eps[p]
    w_p = W[np.arange(n_a)[None, :], :, p]           # (N, n_a, nl)
    gain = (1.0 - a) * (1.0 + wg)                     # (n_a, nl)
    u = (cD + eps_p)[..., None] - gain[None] * (cD[..., None] + w_p)
    if extra is not None:
        u = u + (extra * D)[..., None]
    return u


# ----------------------------------------------------------------------------------------
# Regressor variants for the GMAC (remedies a-c)
# ----------------------------------------------------------------------------------------
class RegressorBank:
    """Produces GMAC regressors for several variants:
       'raw', 'D:k' (correlate with x[n-k]), '2diff' (x[n]-2x[n-1]+x[n-2]), '1diff',
       'ac' (GOS code minus its long-run mean), 'fx:<name>' (filtered-x with a model loop)."""

    def __init__(self, seq, variants, models, n_a, c_mean):
        self.seq = seq
        self.variants = list(variants)
        self.models = models
        self.n_a = n_a
        self.c_mean = c_mean
        self.fx_state = {}
        for v in self.variants:
            if v.startswith('fx:'):
                m = models[v[3:]]
                self.fx_state[v] = np.zeros((m['A'].shape[0], n_a * 9))

    def get(self, n0, N):
        out = {}
        need_hist = any(v in ('2diff', '1diff') for v in self.variants)
        if need_hist:
            c2, p2 = self.seq.get(n0 - 2, N + 2)
            X2 = regressors(c2, p2)
            X = X2[2:]
        else:
            c, p = self.seq.get(n0, N)
            X = regressors(c, p)
        for v in self.variants:
            if v == 'raw':
                out[v] = X
            elif v == 'ac':
                Y = X.copy()
                Y[..., 0] -= self.c_mean[None, :]
                out[v] = Y
            elif v.startswith('D:'):
                k = int(v[2:])
                cs, ps = self.seq.get(n0 - k, N)
                out[v] = regressors(cs, ps)
            elif v.startswith('1diffD:'):          # first difference with a correlator code delay
                k = int(v[7:])
                cs, ps = self.seq.get(n0 - k - 1, N + 1)
                Xk = regressors(cs, ps)
                out[v] = Xk[1:] - Xk[:-1]
            elif v == '2diff':
                out[v] = X2[2:] - 2 * X2[1:-1] + X2[:-2]
            elif v == '1diff':
                out[v] = X2[2:] - X2[1:-1]
            elif v.startswith('fx:'):
                m = self.models[v[3:]]
                y, self.fx_state[v] = recursion(m, X.reshape(N, -1), self.fx_state[v])
                out[v] = y.reshape(N, self.n_a, 9)
            else:
                raise ValueError(v)
        return out


# ----------------------------------------------------------------------------------------
# Slope-matrix measurement  S = dE[G]/dw  (LMS frozen, +/- perturbation, settle, average)
# ----------------------------------------------------------------------------------------
def measure_S(loop, alphas, cfg, seq_mode='acc1', seq_kw=None, N_rec=2 ** 17, N_settle=2 ** 13,
              chunk=1024, n_super=16, variants=('raw',), estimators=('mc', 'erf', 'lin'),
              delta=DELTA_PERT_PS, seed=1, nonlin=False, models=None, open_loop=True):
    """Returns dict with per-super-batch S (n_super, n_var, n_est, n_a, 9, 9) in units 1/ps,
       parameter vector theta = [w_g*Delta (ps), w_0..w_7 (ps)].
       Estimators:  'mc'  : q = sign(e + v), v ~ N(0, sigma^2), same v for all lanes (CRN)
                    'erf' : E_v[sign(e+v)] = erf(e/(sqrt2 sigma))   (exact noise average)
                    'lin' : sqrt(2/pi) e/sigma                      (small-signal / linear)
       Open-loop reference (H_PD == 1) computed from the injected error itself."""
    seq_kw = seq_kw or {}
    models = models or {}
    alphas = list(alphas)
    n_a = len(alphas)
    nl = 18
    N_tot = N_settle + N_rec
    n_chunks = N_rec // chunk
    assert N_rec % chunk == 0 and N_settle % chunk == 0 and n_chunks % n_super == 0
    seq = SeqSource(alphas, seq_mode, n_start=-64, n_end=N_tot + 64, **seq_kw)
    sig = cfg['sigma']
    D = cfg['Delta']
    # lane parameters
    wg = np.full((n_a, nl), cfg['wg_star'])
    W = np.tile(cfg['eps'][None, None, :], (n_a, nl, 1)).astype(float)
    for j in range(9):
        for sgn_i, sgn in enumerate((+1, -1)):
            l = 2 * j + sgn_i
            if j == 0:
                wg[:, l] += sgn * delta / D
            else:
                W[:, l, j - 1] += sgn * delta
    # long-run mean of the code (for 'ac')
    cm = np.array([0.5] * n_a)
    if seq_mode != 'acc1':
        cm = seq.c.mean(axis=0)
    bank = RegressorBank(seq, variants, models, n_a, cm)
    rng = np.random.default_rng(seed)
    s = np.zeros((loop['A'].shape[0], n_a * nl))
    n_var = len(variants)
    n_est = len(estimators)
    G = np.zeros((n_super, n_var, n_est, n_a, nl, 9))
    G_ol = np.zeros((n_super, n_est, n_a, nl, 9))
    sx = np.zeros((n_a, 9))
    sxx = np.zeros((n_a, 9, 9))
    pvar = np.zeros((n_var, n_a, 9))          # mean square of each GMAC regressor variant
    nl_T = cfg['T_vco'] if nonlin else None
    per_super = n_chunks // n_super
    for ci, n0 in enumerate(range(0, N_tot, chunk)):
        c, p = seq.get(n0, chunk)
        u = e_inj(c, p, wg, W, cfg, seq.get_extra(n0, chunk))
        e, s = recursion(loop, u.reshape(chunk, -1), s, nl_T)
        e = e.reshape(chunk, n_a, nl)
        Xs = bank.get(n0, chunk)
        if n0 < N_settle:
            continue
        sb = (n0 - N_settle) // chunk // per_super
        v = rng.normal(0.0, sig, size=(chunk, 1, 1))
        Qs = []
        Qo = []
        for est in estimators:
            if est == 'mc':
                Qs.append(np.sign(e + v))
                if open_loop:
                    Qo.append(np.sign(u + v))
            elif est == 'erf':
                Qs.append(special.erf(e / (math.sqrt(2) * sig)))
                if open_loop:
                    Qo.append(special.erf(u / (math.sqrt(2) * sig)))
            elif est == 'lin':
                Qs.append(math.sqrt(2 / math.pi) * e / sig)
                if open_loop:
                    Qo.append(math.sqrt(2 / math.pi) * u / sig)
        for vi, vname in enumerate(variants):
            pvar[vi] += (Xs[vname] ** 2).sum(axis=0)
            Xt = np.ascontiguousarray(Xs[vname].transpose(1, 0, 2))      # (n_a, N, 9)
            for ei in range(n_est):
                Qt = np.ascontiguousarray(Qs[ei].transpose(1, 2, 0))      # (n_a, nl, N)
                G[sb, vi, ei] += np.matmul(Qt, Xt) / (chunk * per_super)
        if open_loop:
            Xt = np.ascontiguousarray(Xs[variants[0]].transpose(1, 0, 2)) if variants[0] == 'raw' else \
                np.ascontiguousarray(regressors(c, p).transpose(1, 0, 2))
            for ei in range(n_est):
                Qt = np.ascontiguousarray(Qo[ei].transpose(1, 2, 0))
                G_ol[sb, ei] += np.matmul(Qt, Xt) / (chunk * per_super)
        Xr = regressors(c, p)
        sx += Xr.sum(axis=0)
        sxx += np.einsum('nai,naj->aij', Xr, Xr)
    # S[i, j] = (G_i(+d_j) - G_i(-d_j)) / (2 d_j)
    S = (G[..., 0::2, :] - G[..., 1::2, :]) / (2 * delta)       # (..., n_a, j, i)
    S = np.swapaxes(S, -1, -2)                                  # (..., n_a, i, j)
    S_ol = np.swapaxes((G_ol[..., 0::2, :] - G_ol[..., 1::2, :]) / (2 * delta), -1, -2)
    Nm = N_rec
    mean = sx / Nm
    cov = sxx / Nm - mean[:, :, None] * mean[:, None, :]
    return dict(S=S, S_ol=S_ol, cov=cov, mean=mean, alphas_q=seq.alphas_q.copy(),
                variants=list(variants), estimators=list(estimators), sigma=sig,
                regressor_power=pvar / Nm)


def phos_dirs():
    """Unit directions in theta = [w_g*Delta, w_0..w_7] (ps): GOS and real DFT modes of the PHOS."""
    k = np.arange(8)
    d = {'gos': np.r_[1.0, np.zeros(8)]}
    for name, v in (('phos_m1c', np.cos(2 * np.pi * k / 8)), ('phos_m1s', np.sin(2 * np.pi * k / 8)),
                    ('phos_m2c', np.cos(2 * np.pi * 2 * k / 8)), ('phos_m3c', np.cos(2 * np.pi * 3 * k / 8)),
                    ('phos_m4', np.cos(np.pi * k))):
        d[name] = np.r_[0.0, v / np.linalg.norm(v)]
    return d


def measure_dir(loop, alphas, cfg, dirs, amps, N_rec=2 ** 18, N_settle=2 ** 13, chunk=1024, n_super=16,
                seed=1, estimators=('mc', 'erf', 'lin'), seq_mode='acc1', seq_kw=None,
                variants=('raw',), models=None):
    """LARGE-SIGNAL check: secant slope of the averaged GMAC along a direction v,
         g(A) = -v^T [G(theta* + A v) - G(theta* - A v)] / (2A)   (normalised by sigma/sqrt(2/pi)),
       for amplitudes A from << sigma_v to >> sigma_v.  g(A) > 0 : restoring at that amplitude.
       Because sign(.) is scale invariant, g(A) for A >> sigma_v is the slope seen by an LMS that
       starts far from (or has drifted away from) the fixed point.  Several GMAC regressor
       variants can be evaluated on the same PD record."""
    seq_kw = seq_kw or {}
    models = models or {}
    alphas = list(alphas)
    n_a = len(alphas)
    names = list(dirs)
    combos = [(di, ai_, s) for di in range(len(names)) for ai_ in range(len(amps)) for s in (+1, -1)]
    nl = len(combos)
    N_tot = N_settle + N_rec
    n_chunks = N_rec // chunk
    per_super = n_chunks // n_super
    seq = SeqSource(alphas, seq_mode, n_start=-64, n_end=N_tot + 64, **seq_kw)
    cm = np.array([0.5] * n_a) if seq_mode == 'acc1' else seq.c.mean(axis=0)
    bank = RegressorBank(seq, list(variants), models, n_a, cm)
    sig = cfg['sigma']
    D = cfg['Delta']
    wg = np.full((n_a, nl), cfg['wg_star'])
    W = np.tile(cfg['eps'][None, None, :], (n_a, nl, 1)).astype(float)
    for l, (di, ai_, s) in enumerate(combos):
        v = dirs[names[di]]
        A = amps[ai_]
        wg[:, l] += s * A * v[0] / D
        W[:, l, :] += s * A * v[1:]
    rng = np.random.default_rng(seed)
    st = np.zeros((loop['A'].shape[0], n_a * nl))
    n_est = len(estimators)
    n_var = len(variants)
    G = np.zeros((n_super, n_var, n_est, n_a, nl, 9))
    Go = np.zeros((n_super, n_est, n_a, nl, 9))
    for n0 in range(0, N_tot, chunk):
        c, p = seq.get(n0, chunk)
        u = e_inj(c, p, wg, W, cfg, seq.get_extra(n0, chunk))
        e, st = recursion(loop, u.reshape(chunk, -1), st)
        e = e.reshape(chunk, n_a, nl)
        Xs = bank.get(n0, chunk)
        if n0 < N_settle:
            continue
        sb = (n0 - N_settle) // chunk // per_super
        Xr = np.ascontiguousarray(regressors(c, p).transpose(1, 0, 2))
        Xv = [np.ascontiguousarray(Xs[vn].transpose(1, 0, 2)) for vn in variants]
        vv = rng.normal(0.0, sig, size=(chunk, 1, 1))
        for ei, est in enumerate(estimators):
            for which, arr_ in (('cl', e), ('ol', u)):
                if est == 'mc':
                    Q = np.sign(arr_ + vv)
                elif est == 'erf':
                    Q = special.erf(arr_ / (math.sqrt(2) * sig))
                else:
                    Q = math.sqrt(2 / math.pi) * arr_ / sig
                Qt = np.ascontiguousarray(Q.transpose(1, 2, 0))
                if which == 'cl':
                    for vi in range(n_var):
                        G[sb, vi, ei] += np.matmul(Qt, Xv[vi]) / (chunk * per_super)
                else:
                    Go[sb, ei] += np.matmul(Qt, Xr) / (chunk * per_super)
    kk = sig / math.sqrt(2 / math.pi)
    out = dict(alphas=seq.alphas_q.tolist(), dirs=names, amps_ps=list(amps), estimators=list(estimators),
               variants=list(variants), g={}, g_ci95={}, g_open_loop={})
    B = n_super
    tq = stats.t.ppf(0.975, B - 1)
    for vi, vn in enumerate(variants):
        out['g'][vn] = {}
        out['g_ci95'][vn] = {}
        for ei, est in enumerate(estimators):
            gm = np.zeros((n_a, len(names), len(amps)))
            gci = np.zeros((n_a, len(names), len(amps), 2))
            for di, nm in enumerate(names):
                v = dirs[nm]
                for ai_, A in enumerate(amps):
                    lp = combos.index((di, ai_, +1))
                    lm = combos.index((di, ai_, -1))
                    gb = -(G[:, vi, ei, :, lp, :] - G[:, vi, ei, :, lm, :]) @ v / (2 * A) * kk   # (B, n_a)
                    m = gb.mean(axis=0)
                    loo = (m[None] * B - gb) / (B - 1)
                    se = np.sqrt((B - 1) / B * ((loo - loo.mean(axis=0)) ** 2).sum(axis=0))
                    gm[:, di, ai_] = m
                    gci[:, di, ai_, 0] = m - tq * se
                    gci[:, di, ai_, 1] = m + tq * se
            out['g'][vn][est] = gm.tolist()
            out['g_ci95'][vn][est] = gci.tolist()
    for ei, est in enumerate(estimators):
        go = np.zeros((n_a, len(names), len(amps)))
        for di, nm in enumerate(names):
            v = dirs[nm]
            for ai_, A in enumerate(amps):
                lp = combos.index((di, ai_, +1))
                lm = combos.index((di, ai_, -1))
                go[:, di, ai_] = (-(Go[:, ei, :, lp, :] - Go[:, ei, :, lm, :]) @ v / (2 * A) * kk).mean(axis=0)
        out['g_open_loop'][est] = go.tolist()
    return out


def task_dir(args):
    key, loop, models, cfg, alphas, amps, N_rec, variants, estimators, n_super, chunk = args
    t = time.time()
    r = measure_dir(loop, alphas, cfg, phos_dirs(), amps, N_rec=N_rec, variants=variants, models=models,
                    estimators=estimators, n_super=n_super, chunk=chunk,
                    N_settle=2 ** 12 if N_rec <= 2 ** 15 else 2 ** 13)
    r['time_s'] = time.time() - t
    return key, r


def summarise_dir_fine(r, tol=1e-3):
    """keep-out statistics of the large-signal directional slopes over the alpha sweep."""
    a = np.array(r['alphas'])
    go = np.array([[[np.nan if x is None else x for x in r2] for r2 in r1] for r1 in r['g_open_loop']['erf']])
    out = {}
    for vn in r['variants']:
        g = np.array([[[np.nan if x is None else x for x in r2] for r2 in r1] for r1 in r['g'][vn]['erf']])
        goa = np.abs(np.array(go, float))
        with np.errstate(divide='ignore', invalid='ignore'):
            gn = np.where(goa > 1e-6 * np.nanmax(goa), g / goa, np.nan)   # mask unobservable directions
        d = {}
        for ai_, A in enumerate(r['amps_ps']):
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', RuntimeWarning)
                worst = np.nanmin(gn[:, :, ai_], axis=1)        # worst observable direction per alpha
            inv = worst < -tol
            d['A=%gps' % A] = dict(n_inverted=int(inv.sum()), worst=float(np.nanmin(worst)),
                                   worst_alpha=float(a[np.nanargmin(worst)]),
                                   inverted_intervals=_intervals(a.tolist(), inv.tolist()),
                                   per_dir_n_inverted={nm: int(np.sum(gn[:, di, ai_] < -tol))
                                                       for di, nm in enumerate(r['dirs'])})
        out[vn] = d
    return out


# ----------------------------------------------------------------------------------------
# Eigen analysis of S
# ----------------------------------------------------------------------------------------
def obs_basis(cov, idx, tol=1e-7):
    """Orthonormal basis of the observable (non-constant) subspace of the regressors idx."""
    Cs = cov[np.ix_(idx, idx)]
    w, V = np.linalg.eigh(Cs)
    keep = w > tol * max(np.trace(Cs), 1e-30)
    return V[:, keep], w[keep]


def analyse_S(Sn, cov):
    """Sn: normalised S (S*sigma/sqrt(2/pi)), 9x9.  Returns sign indicators.
       Restoring  <=>  all eigenvalues of -S on the observable subspace have Re > 0."""
    out = {}
    var_c = cov[0, 0]
    out['gos_observable'] = bool(var_c > 1e-9)
    out['mS_gg'] = float(-Sn[0, 0])
    Vp, _ = obs_basis(cov, list(range(1, 9)))
    out['phos_n_obs_modes'] = int(Vp.shape[1])
    if Vp.shape[1] > 0:
        M = -Vp.T @ Sn[1:, 1:] @ Vp
        ev = np.linalg.eigvals(M)
        out['phos_eig_re'] = sorted([float(x) for x in ev.real])
        out['phos_eig_im_maxabs'] = float(np.max(np.abs(ev.imag)))
        out['phos_min_re'] = float(ev.real.min())
    else:
        out['phos_min_re'] = float('nan')
    Vj, _ = obs_basis(cov, list(range(9)))
    out['joint_n_obs_modes'] = int(Vj.shape[1])
    if Vj.shape[1] > 0:
        M = -Vj.T @ Sn @ Vj
        ev = np.linalg.eigvals(M)
        out['joint_eig_re'] = sorted([float(x) for x in ev.real])
        out['joint_min_re'] = float(ev.real.min())
    else:
        out['joint_min_re'] = float('nan')
    # Rayleigh quotients of -S_pp along the real DFT modes of the 8 phases (m = 1..4):
    # tells WHICH spatial pattern of phase offsets is (not) restored.
    k = np.arange(8)
    mg = {}
    for m in range(1, 5):
        vals = []
        for v in (np.cos(2 * np.pi * m * k / 8), np.sin(2 * np.pi * m * k / 8)):
            nv = np.linalg.norm(v)
            if nv < 1e-9:
                continue
            v = v / nv
            if v @ cov[1:, 1:] @ v < 1e-9 * np.trace(cov[1:, 1:]):
                continue                     # unobservable pattern
            vals.append(float(-(v @ Sn[1:, 1:] @ v)))
        mg['m%d' % m] = float(np.mean(vals)) if vals else float('nan')
    out['phos_dft_mode_gain'] = mg
    return out


def ci_t(x, axis=0):
    x = np.asarray(x)
    m = x.mean(axis=axis)
    sd = x.std(axis=axis, ddof=1)
    n = x.shape[axis]
    h = stats.t.ppf(0.975, n - 1) * sd / math.sqrt(n)
    return m, h


def summarise_S(res, cfg, vi=0, ei=0, ai=0, use_ol=False):
    """Full analysis for one (variant, estimator, alpha).  95% CIs by the delete-one jackknife
       over the n_super super-batches (applied to the eigen-analysis of the MEAN matrix, which
       avoids the downward bias of min-eigenvalues of noisy per-batch matrices)."""
    k = cfg['sigma'] / math.sqrt(2 / math.pi)
    if use_ol:
        Sb = res['S_ol'][:, ei, ai] * k
    else:
        Sb = res['S'][:, vi, ei, ai] * k              # (n_super, 9, 9)
    cov = res['cov'][ai]
    B = Sb.shape[0]
    Sm = Sb.mean(axis=0)
    a = analyse_S(Sm, cov)
    loo = [analyse_S((Sm * B - Sb[b]) / (B - 1), cov) for b in range(B)]
    tq = stats.t.ppf(0.975, B - 1)
    for key in ('mS_gg', 'phos_min_re', 'joint_min_re'):
        vals = np.array([p[key] for p in loo])
        if np.all(np.isfinite(vals)) and math.isfinite(a[key]):
            se = math.sqrt((B - 1) / B * np.sum((vals - vals.mean()) ** 2))
            a[key + '_ci95'] = [float(a[key] - tq * se), float(a[key] + tq * se)]
    return a


def classify(x, ci, ref, tol_rel=1e-3):
    """'restoring' / 'inverted' / 'neutral' (|x| < tol_rel*ref, or CI straddles 0)."""
    if not np.isfinite(x):
        return 'unobservable'
    if abs(x) < tol_rel * abs(ref):
        return 'neutral'
    if ci is not None and ci[0] < 0 < ci[1]:
        return 'undetermined'
    return 'restoring' if x > 0 else 'inverted'


# ----------------------------------------------------------------------------------------
# Time-domain verification of the closed-loop response (sinusoidal injection + lock-in)
# ----------------------------------------------------------------------------------------
def td_freq_response(loop, freqs, N_settle=2 ** 14, N_meas=2 ** 16, amp=1.0):
    freqs = np.asarray(freqs, float)
    L = len(freqs)
    s = np.zeros((loop['A'].shape[0], L))
    n = np.arange(N_settle + N_meas)
    w = 2 * np.pi * freqs / F_REF
    u = amp * np.sin(np.outer(n, w))
    e, _ = recursion(loop, u, s)
    xv = u - e
    nn = n[N_settle:]
    T = np.zeros(L, complex)
    H = np.zeros(L, complex)
    for i in range(L):
        Mx = np.c_[np.sin(w[i] * nn), np.cos(w[i] * nn), np.ones_like(nn, dtype=float)]
        cu, *_ = np.linalg.lstsq(Mx, u[N_settle:, i], rcond=None)
        cx, *_ = np.linalg.lstsq(Mx, xv[N_settle:, i], rcond=None)
        ce, *_ = np.linalg.lstsq(Mx, e[N_settle:, i], rcond=None)
        zu = cu[0] + 1j * cu[1]
        T[i] = (cx[0] + 1j * cx[1]) / zu
        H[i] = (ce[0] + 1j * ce[1]) / zu
    return T, H


def verify_loop(loop):
    T3, H3 = td_freq_response(loop, [F3DB_TARGET])
    f = np.geomspace(2e6, 1.95e9, 90)
    T, H = td_freq_response(loop, f)
    reH = H.real
    neg = f[reH < 0]
    # bands where Re{H_PD} < 0 (measured)
    bands = []
    inband = False
    for i in range(len(f)):
        if reH[i] < 0 and not inband:
            start = f[i]
            inband = True
        if reH[i] >= 0 and inband:
            bands.append([float(start), float(f[i - 1])])
            inband = False
    if inband:
        bands.append([float(start), float(f[-1])])
    return dict(T_mag_at_320M_td=float(abs(T3[0])), T_dB_at_320M_td=float(20 * np.log10(abs(T3[0]))),
                peaking_dB_td=float(20 * np.log10(np.max(np.abs(T)))),
                ReH_negative_bands_Hz_td=bands,
                ReH_min_td=float(reH.min()), f_ReH_min_Hz=float(f[np.argmin(reH)]),
                freq_Hz=f.tolist(), ReH_td=reH.tolist(), absH_td=np.abs(H).tolist(),
                absT_td=np.abs(T).tolist())


# ----------------------------------------------------------------------------------------
# Closed-loop sign-error LMS
# ----------------------------------------------------------------------------------------
def run_lms(loop, alphas, variants, cfg, seq_mode='acc1', seq_kw=None, N_blk=512, n_blocks=4000,
            mu_g=None, mu_p=None, tau_blocks=25.0, seed=3, rec_every=10, models=None,
            w0=None, frozen=False, nonlin=False, N_settle=4096):
    """lanes = alphas x variants; each lane has independent comparator noise.
       Update every block of N_blk samples:
         G_g = mean(q x_g),  G_k = mean(q x_k);  w_g += mu_g G_g,  w_k += mu_p G_k."""
    seq_kw = seq_kw or {}
    models = models or {}
    n_a = len(alphas)
    nl = len(variants)
    sig = cfg['sigma']
    D = cfg['Delta']
    a = cfg['a']
    ccmp = math.sqrt(2 / math.pi) / sig
    if mu_p is None:       # H==1 time constant tau_blocks for PHOS (E[1{p=k}^2]=1/8)
        mu_p = 8.0 / (tau_blocks * ccmp)
    if mu_g is None:       # H==1 time constant tau_blocks for GOS AC part (var(rho)=1/12)
        mu_g = 12.0 / (tau_blocks * ccmp * D)
    N_tot = N_settle + N_blk * n_blocks
    seq = SeqSource(alphas, seq_mode, n_start=-64, n_end=N_tot + 64, **seq_kw)
    cm = np.array([0.5] * n_a) if seq_mode == 'acc1' else seq.c.mean(axis=0)
    bank = RegressorBank(seq, sorted(set(variants)), models, n_a, cm)
    # NLMS-style power normalisation of the step sizes per lane, so that every regressor
    # variant has the same nominal (H==1-equivalent) adaptation speed:  GOS uses the variance of
    # the variant regressor (raw first-order code: 1/12), PHOS the mean square (raw: 1/8).
    pre = RegressorBank(SeqSource(alphas, seq_mode, n_start=-64, n_end=2 ** 15 + 64, **seq_kw),
                        sorted(set(variants)), models, n_a, cm).get(0, 2 ** 15)
    mu_g_l = np.zeros((n_a, nl))
    mu_p_l = np.zeros((n_a, nl))
    for li, vname in enumerate(variants):
        X = pre[vname][2 ** 12:]
        pg = X[..., 0].var(axis=0)
        pp = (X[..., 1:] ** 2).mean(axis=(0, 2))
        mu_g_l[:, li] = mu_g * (1.0 / 12.0) / np.maximum(pg, 1e-12)
        mu_p_l[:, li] = mu_p * (1.0 / 8.0) / np.maximum(pp, 1e-12)
    rng = np.random.default_rng(seed)
    if w0 is None:
        wg = np.zeros((n_a, nl))
        W = np.zeros((n_a, nl, 8))
    else:
        wg = np.full((n_a, nl), w0[0])
        W = np.tile(np.asarray(w0[1])[None, None, :], (n_a, nl, 1)).astype(float)
    s = np.zeros((loop['A'].shape[0], n_a * nl))
    nl_T = cfg['T_vco'] if nonlin else None
    rec = dict(block=[], gos_err_fs=[], phos_err_rms_fs=[], ePD_rms_fs=[], wg=[], W=[])
    n0 = 0
    # settle the PLL with the initial weights (no update)
    while n0 < N_settle:
        c, p = seq.get(n0, N_blk)
        u = e_inj(c, p, wg, W, cfg, seq.get_extra(n0, N_blk))
        e, s = recursion(loop, u.reshape(N_blk, -1), s, nl_T)
        bank.get(n0, N_blk)
        n0 += N_blk
    eps = cfg['eps']

    def record(b, e):
        gain = (1 - a) * (1 + wg)
        gerr = (gain - 1.0) * D * 1000.0                         # fs at code 1
        perr = gain[..., None] * W - eps[None, None, :]
        perr = perr - perr.mean(axis=-1, keepdims=True)
        rec['block'].append(b)
        rec['gos_err_fs'].append(gerr.copy())
        rec['phos_err_rms_fs'].append(np.sqrt((perr ** 2).mean(axis=-1)) * 1000.0)
        rec['ePD_rms_fs'].append(np.sqrt((e ** 2).mean(axis=0)) * 1000.0)
        rec['wg'].append(wg.copy())
        rec['W'].append(W.copy())

    for b in range(n_blocks):
        c, p = seq.get(n0, N_blk)
        u = e_inj(c, p, wg, W, cfg, seq.get_extra(n0, N_blk))
        e, s = recursion(loop, u.reshape(N_blk, -1), s, nl_T)
        e = e.reshape(N_blk, n_a, nl)
        Xs = bank.get(n0, N_blk)
        n0 += N_blk
        if b % rec_every == 0:
            record(b, e)
        if frozen:
            continue
        v = rng.normal(0.0, sig, size=e.shape)
        q = np.sign(e + v)
        for li, vname in enumerate(variants):
            X = Xs[vname]                                         # (N, n_a, 9)
            Gv = np.einsum('na,nai->ai', q[:, :, li], X) / N_blk  # (n_a, 9)
            wg[:, li] += mu_g_l[:, li] * Gv[:, 0]
            W[:, li, :] += mu_p_l[:, li][:, None] * Gv[:, 1:]
    record(n_blocks, e)
    out = {k: np.array(v) for k, v in rec.items()}
    out['mu_g'] = mu_g
    out['mu_p'] = mu_p
    out['mu_g_lane'] = mu_g_l
    out['mu_p_lane'] = mu_p_l
    out['alphas_q'] = seq.alphas_q
    out['variants'] = list(variants)
    return out


# ----------------------------------------------------------------------------------------
# Experiment drivers
# ----------------------------------------------------------------------------------------
ALPHA_GRID = [0.002, 0.01, 0.03,
              0.123, 0.127, 0.247, 0.253, 0.496, 0.504,
              0.137, 0.3183, 0.4142, 0.618]
ALPHA_GROUP = {0.002: 'near-integer', 0.01: 'near-integer', 0.03: 'near-integer',
               0.123: 'near-grid', 0.127: 'near-grid', 0.247: 'near-grid', 0.253: 'near-grid',
               0.496: 'near-grid', 0.504: 'near-grid',
               0.137: 'generic', 0.3183: 'generic', 0.4142: 'generic', 0.618: 'generic'}
D_LIST = [-2, -1, 1, 2, 3, 4, 6, 8, 12, 16]


def to_py(o):
    if isinstance(o, dict):
        return {str(k): to_py(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [to_py(v) for v in o]
    if isinstance(o, np.ndarray):
        return to_py(o.tolist())
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def rnd(x, sig=6):
    """round floats recursively to `sig` significant digits (keeps results.json compact)."""
    if isinstance(x, dict):
        return {k: rnd(v, sig) for k, v in x.items()}
    if isinstance(x, list):
        return [rnd(v, sig) for v in x]
    if isinstance(x, float):
        if not math.isfinite(x) or x == 0.0:
            return x if math.isfinite(x) else None
        return float('%.*g' % (sig, x))
    return x


# ---------------------------- worker tasks ---------------------------------------------
def task_design(scale):
    return scale, build_loops(scale)


def task_verify(args):
    key, loop = args
    t = time.time()
    v = verify_loop(loop)
    v['loop_summary'] = loop_summary(loop)
    v['time_s'] = time.time() - t
    return key, v


def _compact(s, full):
    keys = ['mS_gg', 'mS_gg_ci95', 'phos_min_re', 'phos_min_re_ci95', 'joint_min_re', 'joint_min_re_ci95',
            'phos_n_obs_modes', 'joint_n_obs_modes', 'gos_observable']
    if full:
        keys += ['phos_eig_re', 'joint_eig_re', 'phos_eig_im_maxabs', 'phos_dft_mode_gain']
    return {k: s[k] for k in keys if k in s}


def summarise_run(res, cfg, full_variants=('raw',), with_ol=True):
    """Per alpha: for each variant x estimator the GOS scalar and PHOS/joint eigen summary,
       plus the open-loop (H_PD==1) reference and the regressor statistics."""
    out = []
    for ai, a in enumerate(res['alphas_q']):
        d = dict(alpha=float(a), var_c=float(res['cov'][ai][0, 0]), mean_c=float(res['mean'][ai][0]),
                 phases_visited=int(np.sum(res['mean'][ai][1:] > 0)), variants={},
                 regressor_power={v: dict(gos=float(res['regressor_power'][vi, ai, 0]),
                                          phos_mean=float(res['regressor_power'][vi, ai, 1:].mean()))
                                  for vi, v in enumerate(res['variants'])})
        for vi, vname in enumerate(res['variants']):
            d['variants'][vname] = {}
            for ei, est in enumerate(res['estimators']):
                s = summarise_S(res, cfg, vi, ei, ai)
                d['variants'][vname][est] = _compact(s, vname in full_variants)
        if with_ol:
            d['open_loop_H1'] = {}
            for ei, est in enumerate(res['estimators']):
                s = summarise_S(res, cfg, 0, ei, ai, use_ol=True)
                d['open_loop_H1'][est] = _compact(s, False)
        out.append(d)
    return out


def classify_entry(d, variant='raw', est='erf', tol_rel=1e-3):
    """classification of GOS (scalar), PHOS (non-common modes) and joint system."""
    s = d['variants'][variant][est]
    ref = d['open_loop_H1'][est] if 'open_loop_H1' in d else None
    out = {}
    for key, rkey in (('mS_gg', 'gos'), ('phos_min_re', 'phos'), ('joint_min_re', 'joint')):
        x = s.get(key, float('nan'))
        r = ref[key] if ref is not None and ref.get(key) is not None else 0.1
        if rkey == 'gos' and not s.get('gos_observable', True):
            out[rkey] = 'unobservable'
            continue
        out[rkey] = classify(x if x is not None else float('nan'), s.get(key + '_ci95'), r, tol_rel)
    return out


def task_grid(args):
    key, loop, models, cfg, alphas, variants, estimators, N_rec, seq_mode, seq_kw, nonlin = args
    t = time.time()
    res = measure_S(loop, alphas, cfg, seq_mode=seq_mode, seq_kw=seq_kw, N_rec=N_rec, N_settle=2 ** 13,
                    chunk=1024, n_super=16, variants=variants, estimators=estimators, models=models,
                    nonlin=nonlin)
    summ = summarise_run(res, cfg)
    for d in summ:
        d['class'] = {v: classify_entry(d, v, 'erf') for v in variants}
        if 'mc' in estimators:
            d['class_mc'] = classify_entry(d, 'raw', 'mc')
    return key, dict(summary=summ, time_s=time.time() - t, N_rec=N_rec, seq_mode=seq_mode,
                     seq_kw=seq_kw, nonlin=nonlin, f_vco=cfg['f_vco'])


def task_fine(args):
    key, loop, models, cfg, alphas, variants, N_rec, seq_mode, seq_kw = args
    t = time.time()
    res = measure_S(loop, alphas, cfg, seq_mode=seq_mode, seq_kw=seq_kw, N_rec=N_rec, N_settle=2 ** 12,
                    chunk=512, n_super=8, variants=variants, estimators=('erf', 'lin'), models=models)
    k = cfg['sigma'] / math.sqrt(2 / math.pi)
    out = dict(alpha=res['alphas_q'].tolist(), variants={}, time_s=None, N_rec=N_rec,
               seq_mode=seq_mode)
    ol_ref = None
    for vi, vname in enumerate(variants):
        dv = {}
        for ei, est in enumerate(('erf', 'lin')):
            g, p, j, pn = [], [], [], []
            for ai in range(len(alphas)):
                Sm = res['S'][:, vi, ei, ai].mean(axis=0) * k
                a = analyse_S(Sm, res['cov'][ai])
                g.append(a['mS_gg'] if a['gos_observable'] else float('nan'))
                p.append(a['phos_min_re'])
                j.append(a['joint_min_re'])
                pn.append(a['phos_n_obs_modes'])
            dv[est] = dict(mS_gg=g, phos_min_re=p, joint_min_re=j)
            if vi == 0 and ei == 0:
                out['phos_n_obs_modes'] = pn
        out['variants'][vname] = dv
    # open-loop references (H == 1) for normalisation
    gl, pl = [], []
    for ai in range(len(alphas)):
        Sm = res['S_ol'][:, 0, ai].mean(axis=0) * k
        a = analyse_S(Sm, res['cov'][ai])
        gl.append(a['mS_gg'])
        pl.append(a['phos_min_re'])
    out['open_loop_H1'] = dict(mS_gg=gl, phos_min_re=pl)
    out['var_c'] = [float(res['cov'][ai][0, 0]) for ai in range(len(alphas))]
    out['time_s'] = time.time() - t
    return key, out


def task_lms(args):
    (tag, loop, models, cfg, alphas, variants, seq_mode, seq_kw, n_blocks, N_blk, tau, seed,
     w0, frozen, rec_every) = args
    t = time.time()
    r = run_lms(loop, alphas, variants, cfg, seq_mode=seq_mode, seq_kw=seq_kw, N_blk=N_blk,
                n_blocks=n_blocks, tau_blocks=tau, seed=seed, rec_every=rec_every, models=models,
                w0=w0, frozen=frozen)
    out = dict(block=r['block'].tolist(), alphas=r['alphas_q'].tolist(), variants=r['variants'],
               mu_g=r['mu_g'], mu_p_ps=r['mu_p'], N_blk=N_blk, n_blocks=n_blocks, tau_H1_blocks=tau,
               seq_mode=seq_mode, frozen=frozen, lanes={})
    gerr = r['gos_err_fs']            # (n_rec, n_a, nl)
    perr = r['phos_err_rms_fs']
    erms = r['ePD_rms_fs']
    for ai, a in enumerate(r['alphas_q']):
        for li, v in enumerate(variants):
            g = gerr[:, ai, li]
            p = perr[:, ai, li]
            m = len(g)
            tail = slice(int(0.9 * m), m)
            out['lanes']['%.6g|%s' % (a, v)] = dict(
                gos_err_fs=g.tolist(), phos_err_rms_fs=p.tolist(), ePD_rms_fs=erms[:, ai, li].tolist(),
                gos_err_initial_fs=float(g[0]), gos_err_final_med_fs=float(np.median(np.abs(g[tail]))),
                phos_err_initial_fs=float(p[0]), phos_err_final_med_fs=float(np.median(p[tail])),
                phos_err_max_fs=float(p.max()), gos_err_max_fs=float(np.abs(g).max()),
                final_wg=float(r['wg'][-1, ai, li]), final_W_ps=r['W'][-1, ai, li].tolist(),
                mu_g=float(r['mu_g_lane'][ai, li]), mu_p_ps=float(r['mu_p_lane'][ai, li]))
    out['time_s'] = time.time() - t
    return tag, out


def _intervals(alpha, mask):
    out = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            out.append([alpha[i], alpha[j]])
            i = j + 1
        else:
            i += 1
    return out


def postprocess_fine(R, tol_rel=1e-3):
    """Keep-out maps from the fine alpha sweep (erf estimator = exact comparator-noise average)."""
    out = {}
    for src_key in ('fine', 'dither_fine'):
        for key, f in R.get(src_key, {}).items():
            a = np.array(f['alpha'])
            gl = np.abs(np.array(f['open_loop_H1']['mS_gg'], float))
            pl = np.abs(np.array(f['open_loop_H1']['phos_min_re'], float))
            d = {}
            for vname, dv in f['variants'].items():
                e = dv['erf']
                g = np.array([np.nan if x is None else x for x in e['mS_gg']], float)
                p = np.array([np.nan if x is None else x for x in e['phos_min_re']], float)
                j = np.array([np.nan if x is None else x for x in e['joint_min_re']], float)
                tg = tol_rel * np.nanmedian(gl)
                tp = tol_rel * np.nanmedian(pl)
                inv_g = g < -tg
                inv_p = p < -tp
                neu_p = np.abs(p) <= tp
                inv_j = j < -min(tg, tp)
                d[vname] = dict(
                    n_alpha=int(len(a)),
                    gos_inverted=int(np.sum(inv_g)), gos_unobservable=int(np.sum(~np.isfinite(g))),
                    phos_inverted=int(np.sum(inv_p)), phos_neutral=int(np.sum(neu_p)),
                    joint_inverted=int(np.sum(inv_j)),
                    gos_min=float(np.nanmin(g)), gos_argmin=float(a[np.nanargmin(g)]),
                    phos_min=float(np.nanmin(p)), phos_argmin=float(a[np.nanargmin(p)]),
                    phos_inverted_intervals=_intervals(a.tolist(), inv_p.tolist()),
                    gos_inverted_intervals=_intervals(a.tolist(), inv_g.tolist()),
                    phos_neutral_intervals=_intervals(a.tolist(), neu_p.tolist()))
            out['%s|%s' % (src_key, key)] = d
    return out


def pool_map(fn, tasks, procs):
    if procs <= 1:
        return [fn(t) for t in tasks]
    ctx = mp.get_context('spawn')
    with ctx.Pool(procs) as pool:
        return pool.map(fn, tasks, chunksize=1)


# ---------------------------- main experiment ----------------------------------------
def main(mode='all'):
    t0 = time.time()
    quick = (mode == 'quick')
    procs = 1 if quick else min(16, os.cpu_count() or 1)
    cfg = make_cfg()
    R = dict(config=dict(
        f_ref_Hz=F_REF, T_ref_ps=T_REF_PS, f3dB_target_Hz=F3DB_TARGET,
        f_vco_Hz_illustrative=cfg['f_vco'], T_vco_ps=cfg['T_vco'], Delta_ps=cfg['Delta'],
        sigma_v_ps=cfg['sigma'], a_gos=cfg['a'], w_g_star=cfg['wg_star'], eps_ps=cfg['eps'].tolist(),
        delta_perturbation_ps=DELTA_PERT_PS, accumulator_bits=ACC_BITS,
        seeds=dict(eps=EPS_SEED, comparator_S=1, lms=3, dither=12345),
        alpha_grid=ALPHA_GRID, alpha_group=ALPHA_GROUP, D_list=D_LIST,
        conventions=dict(
            e_inj='u[n] = c[n]*Delta + eps_{p[n]} - (1-a)(1+w_g)(c[n]*Delta + w_{p[n]})  [ps]',
            e_PD='e_PD[n] = u[n] - x_v[n],  x_v = L(z) g(e_PD)  =>  e_PD = H_PD u, H_PD = 1/(1+L)',
            comparator='q[n] = sign(e_PD[n] + v[n]), v ~ N(0, sigma_v^2)',
            lms='w_g += mu_g mean(q c[n-D]);  w_k += mu_p mean(q 1{p[n-D]=k})',
            S='S_ij = dE[G_i]/dtheta_j, theta = [w_g*Delta, w_0..w_7] (ps); reported normalised '
              'S_norm = S*sigma_v/sqrt(2/pi) (dimensionless); restoring <=> eig(-S_norm) on the '
              'observable subspace has Re>0; mS_gg = -S_norm[g,g]'),
    ))
    # ---- 1. loop designs at 320 MHz and at 0.8x / 1.2x (models for filtered-x) ----
    print('[1] designing loops ...', flush=True)
    which = ['L1', 'L2_pm60', 'L3_imp_pm60'] if quick else None
    if quick:
        des = [(s, build_loops(s, which)) for s in (1.0, 0.8, 1.2)]
    else:
        des = pool_map(task_design, [1.0, 0.8, 1.2], 3)
    D_ = {s: l for s, l in des}
    loops, lo, hi = D_[1.0], D_[0.8], D_[1.2]
    models = {k: {'exact': loops[k], **({'bw0.8': lo[k]} if k in lo else {}),
                  **({'bw1.2': hi[k]} if k in hi else {})} for k in loops}
    print('    designed', list(loops), '%.0fs' % (time.time() - t0), flush=True)
    R['loops'] = {}
    for k in loops:
        R['loops'][k] = dict(design=loop_summary(loops[k]),
                             model_bw0p8=loop_summary(lo[k]) if k in lo else None,
                             model_bw1p2=loop_summary(hi[k]) if k in hi else None,
                             A=loops[k]['A'].tolist(), B=loops[k]['B'].tolist(), C=loops[k]['C'].tolist())
    # ---- 2. time-domain verification of -3 dB and Re{H_PD} sign ----
    print('[2] time-domain verification ...', flush=True)
    for k, v in pool_map(task_verify, [(k, loops[k]) for k in loops], procs):
        R['loops'][k]['td_verify'] = v
    print('    %.0fs' % (time.time() - t0), flush=True)
    # ---- 3. grid S (raw + remedies a,b,c) ----
    print('[3] grid S ...', flush=True)
    N_grid = 2 ** 15 if quick else 2 ** 19
    grid_variants = (['raw', 'ac', '1diff', '2diff'] + ['D:%d' % d for d in D_LIST] +
                     ['fx:exact', 'fx:bw0.8', 'fx:bw1.2'])
    tasks = []
    for k in loops:
        vv = [v for v in grid_variants if not v.startswith('fx:') or v[3:] in models[k]]
        tasks.append((k, loops[k], models[k], cfg, ALPHA_GRID, vv, ('mc', 'erf', 'lin'), N_grid,
                      'acc1', None, False))
    R['grid'] = {k: v for k, v in pool_map(task_grid, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    # ---- 4. fine alpha sweep (keep-out map) ----
    print('[4] fine alpha sweep ...', flush=True)
    fine_alphas = [round(0.001 * i, 6) for i in range(1, 501)]
    if quick:
        fine_alphas = fine_alphas[::10]
    N_fine = 2 ** 13 if quick else 2 ** 16
    fine_variants = ['raw', '1diff', '2diff', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', 'D:1']
    tasks = []
    for k in loops:
        vv = [v for v in fine_variants if not v.startswith('fx:') or v[3:] in models[k]]
        tasks.append((k, loops[k], models[k], cfg, fine_alphas, vv, N_fine, 'acc1', None))
    R['fine'] = {k: v for k, v in pool_map(task_fine, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    # ---- 5. randomisation / dither (remedy d) ----
    print('[5] dither / randomisation ...', flush=True)
    base3 = ['L1', 'L2_pm60', 'L3_imp_pm60']
    dmodes = [('mash', {}), ('dq', {}), ('lsb', {'W': 16}), ('rot', {'M': 8}), ('rot', {'M': 4})]
    tasks = []
    for k in loops:
        for m, kw in dmodes:
            if k not in base3 and m in ('lsb', 'dq'):
                continue
            tasks.append(('%s|%s%s' % (k, m, kw.get('M', '')), loops[k], models[k], cfg, ALPHA_GRID,
                          ['raw'], ('mc', 'erf', 'lin'), N_grid, m, kw, False))
    R['dither_grid'] = {k: v for k, v in pool_map(task_grid, tasks, procs)}
    dither_fine_alphas = [round(0.005 * i, 6) for i in range(1, 101)]
    if quick:
        dither_fine_alphas = dither_fine_alphas[::10]
    tasks = []
    for k in loops:
        for m, kw in [('mash', {}), ('rot', {'M': 8})]:
            tasks.append(('%s|%s%s' % (k, m, kw.get('M', '')), loops[k], models[k], cfg,
                          dither_fine_alphas, ['raw'], N_fine, m, kw))
    R['dither_fine'] = {k: v for k, v in pool_map(task_fine, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    # ---- 6. robustness checks: f_vco and SSPD sine non-linearity ----
    print('[6] f_vco / nonlinearity checks ...', flush=True)
    tasks = []
    for fv in (12e9, 24e9):
        c2 = make_cfg(f_vco=fv)
        for k in base3:
            tasks.append(('%s|fvco%.0fG' % (k, fv / 1e9), loops[k], models[k], c2, ALPHA_GRID, ['raw'],
                          ('erf', 'lin'), N_grid, 'acc1', None, False))
    for k in ['L1', 'L2_pm60', 'L2_pm45']:
        if k in loops:
            tasks.append(('%s|sspd_sine' % k, loops[k], models[k], cfg, ALPHA_GRID, ['raw'],
                          ('mc', 'erf', 'lin'), N_grid, 'acc1', None, True))
    for k in base3:     # long-record Monte-Carlo (real sign comparator) confirmation
        tasks.append(('%s|mc_long' % k, loops[k], models[k], cfg, ALPHA_GRID, ['raw'],
                      ('mc', 'erf', 'lin'), 2 ** 15 if quick else 2 ** 21, 'acc1', None, False))
    for sv in (0.1, 0.4):
        c3 = make_cfg(sigma_v=sv)
        for k in base3:
            tasks.append(('%s|sigma%.0ffs' % (k, sv * 1000), loops[k], models[k], c3, ALPHA_GRID, ['raw'],
                          ('mc', 'erf', 'lin'), N_grid, 'acc1', None, False))
    R['checks'] = {k: v for k, v in pool_map(task_grid, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    # ---- 7. closed-loop LMS ----
    print('[7] closed-loop LMS ...', flush=True)
    nb = 400 if quick else 8000
    lms_alphas = [0.01, 0.03, 0.002, 0.253, 0.496, 0.137, 0.3183]
    lms_variants = ['raw', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', '2diff', '1diff']
    lms_keys = base3 + (['L2_pm45', 'L3_zoh_pm60', 'L1_pole400M'] if not quick else [])
    tasks = []
    for k in lms_keys:
        vv = [v for v in lms_variants if not v.startswith('fx:') or v[3:] in models[k]]
        tasks.append(('%s|acc1' % k, loops[k], models[k], cfg, lms_alphas, vv, 'acc1', None, nb, 512,
                      25.0, 3, None, False, 20))
        for m, kw in [('mash', {}), ('rot', {'M': 8})]:
            tasks.append(('%s|%s%s' % (k, m, kw.get('M', '')), loops[k], models[k], cfg, lms_alphas,
                          ['raw'], m, kw, nb, 512, 25.0, 4, None, False, 20))
    R['lms'] = {k: v for k, v in pool_map(task_lms, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    # ---- 8. freeze (keep-out) demonstration ----
    print('[8] freeze demo ...', flush=True)
    R['freeze'] = {}
    tasks = []
    for k in base3:
        tasks.append(('%s|phase1' % k, loops[k], models[k], cfg, [0.137], ['raw'], 'acc1', None,
                      nb // 2, 512, 25.0, 5, None, False, 20))
    ph1 = {k: v for k, v in pool_map(task_lms, tasks, procs)}
    tasks = []
    for k in base3:
        lane = ph1['%s|phase1' % k]['lanes']['0.137|raw']
        w0 = (lane['final_wg'], lane['final_W_ps'])
        for fz in (False, True):
            tasks.append(('%s|phase2|%s' % (k, 'frozen' if fz else 'lms_on'), loops[k], models[k], cfg,
                          [0.01, 0.03], ['raw'], 'acc1', None, nb, 512, 25.0, 6, w0, fz, 20))
    ph2 = {k: v for k, v in pool_map(task_lms, tasks, procs)}
    R['freeze'] = dict(phase1=ph1, phase2=ph2)
    extra_stages(R, loops, models, cfg, quick, procs, t0)
    R['fine_summary'] = postprocess_fine(R)
    R['runtime_s'] = time.time() - t0
    fn = os.path.join(HERE, 'results_quick.json' if quick else 'results.json')
    with open(fn, 'w') as f:
        json.dump(rnd(to_py(R)), f, separators=(',', ':'))
    print('wrote', fn, '%.0fs' % (time.time() - t0), flush=True)
    return R


LS_ALPHAS = [0.002, 0.01, 0.021, 0.03, 0.137, 0.253, 0.496]
LS_AMPS = [0.01, 0.03, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 20.0]


def extra_stages(R, loops, models, cfg, quick, procs, t0):
    """[9] large-signal secant slopes (grid + fine alpha sweep);
       [10] LMS started at the calibrated point (local test) and with mean-removed GOS regressor."""
    print('[9] large-signal secant slopes ...', flush=True)
    keys = ['L1', 'L2_pm60', 'L3_imp_pm60'] + ([] if quick else ['L2_pm45', 'L1_pole400M', 'L3_zoh_pm60'])
    N = 2 ** 14 if quick else 2 ** 18
    ls_var = ['raw', 'ac', '1diff', 'fx:exact']
    tasks = [(k, loops[k], models[k], cfg, LS_ALPHAS, LS_AMPS, N, ls_var, ('mc', 'erf', 'lin'), 16, 1024)
             for k in keys]
    R['large_signal'] = {k: v for k, v in pool_map(task_dir, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    fine_alphas = [round(0.001 * i, 6) for i in range(1, 501)]
    if quick:
        fine_alphas = fine_alphas[::10]
    keys_f = list(loops) if not quick else ['L1', 'L2_pm60', 'L3_imp_pm60']
    tasks = [(k, loops[k], models[k], cfg, fine_alphas, [1.0, 5.0], 2 ** 13 if quick else 2 ** 15, ls_var,
              ('erf',), 8, 512) for k in keys_f]
    R['large_signal_fine'] = {}
    for k, v in pool_map(task_dir, tasks, min(procs, 8)):
        v['summary'] = summarise_dir_fine(v)
        R['large_signal_fine'][k] = v
    print('    %.0fs' % (time.time() - t0), flush=True)
    print('[10] LMS started at the calibrated point ...', flush=True)
    nb = 400 if quick else 8000
    tasks = []
    base3 = ['L1', 'L2_pm60', 'L3_imp_pm60']
    for k in base3 + ([] if quick else ['L2_pm45']):
        if k in base3:
            lane = R['freeze']['phase1']['%s|phase1' % k]['lanes']['0.137|raw']
            w0 = (lane['final_wg'], lane['final_W_ps'])
        else:
            w0 = (cfg['wg_star'], cfg['eps'].tolist())
        tasks.append(('%s|from_cal' % k, loops[k], models[k], cfg, [0.002, 0.021, 0.253, 0.496],
                      ['raw', 'ac', '1diff', 'fx:exact'], 'acc1', None, nb, 512, 25.0, 7, w0, False, 20))
        tasks.append(('%s|from_zero_ac' % k, loops[k], models[k], cfg, [0.002, 0.01, 0.03, 0.253, 0.496, 0.137],
                      ['ac'], 'acc1', None, nb, 512, 25.0, 8, None, False, 20))
    R['lms_extra'] = {k: v for k, v in pool_map(task_lms, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)
    print('[11] first-difference regressor under correlator misalignment ...', flush=True)
    vv = ['1diff', '1diffD:-1', '1diffD:1', '1diffD:2']
    tasks = [(k, loops[k], {}, cfg, ALPHA_GRID, vv, ('erf', 'lin'), 2 ** 15 if quick else 2 ** 18, 'acc1', None,
              False) for k in base3]
    R['check_1diff_delay'] = {k: v for k, v in pool_map(task_grid, tasks, procs)}
    print('    %.0fs' % (time.time() - t0), flush=True)


def main_extra(mode):
    """Re-run only the extra stages on top of an existing results.json (same seeds)."""
    t0 = time.time()
    quick = (mode == 'extra_quick')
    procs = 1 if quick else min(16, os.cpu_count() or 1)
    fn = os.path.join(HERE, 'results_quick.json' if quick else 'results.json')
    R = json.load(open(fn))
    cfg = make_cfg()
    which = ['L1', 'L2_pm60', 'L3_imp_pm60'] if quick else None
    if quick:
        des = [(s, build_loops(s, which)) for s in (1.0, 0.8, 1.2)]
    else:
        des = pool_map(task_design, [1.0, 0.8, 1.2], 3)
    D_ = {s: l for s, l in des}
    loops, lo, hi = D_[1.0], D_[0.8], D_[1.2]
    models = {k: {'exact': loops[k], **({'bw0.8': lo[k]} if k in lo else {}),
                  **({'bw1.2': hi[k]} if k in hi else {})} for k in loops}
    extra_stages(R, loops, models, cfg, quick, procs, t0)
    R['fine_summary'] = postprocess_fine(R)
    R['runtime_extra_s'] = time.time() - t0
    with open(fn, 'w') as f:
        json.dump(rnd(to_py(R)), f, separators=(',', ':'))
    print('updated', fn, '%.0fs' % (time.time() - t0), flush=True)


if __name__ == '__main__':
    _mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if _mode.startswith('extra'):
        main_extra(_mode)
    elif _mode == 'check1d':       # first-difference regressor under correlator misalignment
        _fn = os.path.join(HERE, 'results.json')
        _R = json.load(open(_fn))
        _cfg = make_cfg()
        _loops = build_loops(1.0, ['L1', 'L2_pm60', 'L3_imp_pm60'])
        _vv = ['1diff', '1diffD:-1', '1diffD:1', '1diffD:2']
        _tasks = [(k, _loops[k], {}, _cfg, ALPHA_GRID, _vv, ('erf', 'lin'), 2 ** 18, 'acc1', None, False)
                  for k in _loops]
        _R['check_1diff_delay'] = {k: v for k, v in pool_map(task_grid, _tasks, 3)}
        with open(_fn, 'w') as _f:
            json.dump(rnd(to_py(_R)), _f, separators=(',', ':'))
        print('check1d done')
    elif _mode == 'post':          # recompute summaries from the stored arrays (no simulation)
        _fn = os.path.join(HERE, 'results.json')
        _R = json.load(open(_fn))
        for _k, _v in _R.get('large_signal_fine', {}).items():
            _v['summary'] = summarise_dir_fine(_v)
        _R['fine_summary'] = postprocess_fine(_R)
        with open(_fn, 'w') as _f:
            json.dump(rnd(to_py(_R)), _f, separators=(',', ':'))
        print('post-processed', _fn)
    else:
        main(_mode)
