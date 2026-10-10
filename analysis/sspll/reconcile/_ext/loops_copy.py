"""
loops.py -- PD-residual transfer H_PD = 1/(1+L) and output transfer T = L/(1+L)
for three PLL loop models that share the same fractional architecture
(8-phase PMUX in the feedback path + input DTC), all designed for a
closed-loop |T| -3 dB bandwidth of 320 MHz at f_ref = 4 GHz.

    L1  SSPLL Type-I   : ZOH-equivalent of K/s  (optionally K/(s(1+s/wp)) parasitic pole)
                         L0(z) = K z^-1/(1-z^-1)
    L2  SSPLL Type-II  : narrow-pulse (impulse-invariant) P + I path
                         L0(z) = (Kp + Ki/(1-z^-1)) z^-1/(1-z^-1)
    L3  CPPLL          : CT 3rd-order type-II  L(s) = K(1+s/wz)/(s^2 (1+s/wp)),
                         mapped to the f_ref sampled-data domain by
                         'impulse' (CP pulses << T_ref, physical default),
                         'zoh' (CP current held a full cycle), or the CT
                         approximations 'ct' (no delay) and 'ct_delay' (e^{-sT/2}).

Normalisation (used everywhere inside this module)
    time unit = T_ref = 1/f_ref ;  Omega = 2*pi*f/f_ref  [rad/sample]
    every loop constant (K, Kp, Ki, wz, wp, wc) is in these normalised units
    (multiply an angular frequency by f_ref to get rad/s).

Polarity convention
    e_PD[n] = (h_PD * e_inj)[n],  H_PD -> 1 when the loop is opened (L -> 0).
    e_inj is the DTC-gain (GOS) / PMUX-phase (PHOS) timing error referred to the
    phase-comparison summing node, with its sign already chosen so that the
    calibration is correct when H_PD == 1.

Latency
    D = total sample delay of the loop, L(z) = L0(z) * z^-(D-1); D = 1 is the
    baseline (error sampled at n first affects the PD sample at n+1).
    latency_mode='fd'   : exact fractional delay e^{-j Omega (D-1)} (frequency
                          response only for non-integer D; D < 1 is a non-causal
                          'optimistic' reference: D = 0.5 makes the Type-I loop
                          K/(2j sin(Omega/2)), the aliased ideal integrator).
    latency_mode='modz' : physical modified-z transform (pulse delayed by the
                          fractional part), rational, only for D >= 1.
    For integer D both modes coincide and (b, a) are returned.

Key exact identity (holds for ANY L):
    Re{H_PD} < 0   <=>   Re{L} < -1   <=>   Re{T} > 1   (=>  |T| > 1)
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
import numpy as np
from scipy import optimize, signal

F_REF = 4e9
BW = 320e6
TWO_PI = 2.0 * np.pi

__all__ = [
    "F_REF", "BW", "Loop",
    "L1_typeI", "L2_typeII", "L3_cppll",
    "f3db_w", "margins", "inversion_bands", "peaking", "pole_info",
    "summarize", "T_gt_1_bands", "ct_g_zeta", "ct_pm_from_zeta", "nominal_models",
    "lms_effective_gain", "lms_effective_matrix",
]


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
def _u(W):
    """u = 1 - e^{-jW} computed without cancellation: 2j sin(W/2) e^{-jW/2}."""
    W = np.asarray(W, dtype=float)
    return 2j * np.sin(W / 2.0) * np.exp(-0.5j * W)


def _zinv(W):
    return np.exp(-1j * np.asarray(W, dtype=float))


def _padd(p, q):
    n = max(len(p), len(q))
    P = np.zeros(n, dtype=float)
    Q = np.zeros(n, dtype=float)
    P[: len(p)] = p
    Q[: len(q)] = q
    return P + Q


def _delay(b, m):
    return np.concatenate([np.zeros(int(m)), np.asarray(b, float)])


def _roots_zinv(c):
    """Roots in z of c0 + c1 z^-1 + ... + cn z^-n (trailing zeros trimmed)."""
    c = np.trim_zeros(np.asarray(c, float), "b")
    if len(c) <= 1:
        return np.array([], dtype=complex)
    return np.roots(c)


def _freqz_zinv(c, W):
    W = np.asarray(W, float)
    k = np.arange(len(c))
    return np.exp(-1j * np.outer(W, k)) @ np.asarray(c, float)


def _split_latency(D):
    """D-1 = m + delta, m integer >= 0, delta in [0,1)."""
    x = D - 1.0
    m = int(math.floor(x + 1e-12))
    delta = x - m
    if abs(delta) < 1e-12 or abs(delta - 1) < 1e-12:
        m = int(round(x))
        delta = 0.0
    return m, delta


# ----------------------------------------------------------------------------
# Loop container
# ----------------------------------------------------------------------------
@dataclass
class Loop:
    """A designed loop.  Lw(Omega) is the (vectorised) loop-gain frequency
    response; (b, a) give L(z) = B(z^-1)/A(z^-1) when the model is rational."""

    name: str
    f_ref: float
    Lw: callable
    ltype: int
    b: np.ndarray | None = None
    a: np.ndarray | None = None
    params: dict = field(default_factory=dict)
    ct_charpoly: np.ndarray | None = None   # CT characteristic polynomial (s, normalised), if CT

    # --- frequency responses (f in Hz) ---
    def W(self, f):
        return TWO_PI * np.asarray(f, float) / self.f_ref

    def L(self, f):
        return self.Lw(self.W(f))

    def Hpd(self, f):
        return 1.0 / (1.0 + self.L(f))

    def T(self, f):
        L = self.L(f)
        return L / (1.0 + L)

    def Hpd_w(self, W):
        return 1.0 / (1.0 + self.Lw(W))

    def T_w(self, W):
        L = self.Lw(W)
        return L / (1.0 + L)

    # --- rational forms ---
    @property
    def rational(self):
        return self.b is not None and self.a is not None

    def _BA(self):
        if not self.rational:
            raise ValueError(f"{self.name}: no rational (b,a) for this model/latency")
        n = max(len(self.b), len(self.a))
        B = np.zeros(n)
        A = np.zeros(n)
        B[: len(self.b)] = self.b
        A[: len(self.a)] = self.a
        return B, A

    def hpd_ba(self):
        """H_PD(z) = A/(A+B) as (num, den) in z^-1 (use with scipy.signal.lfilter)."""
        B, A = self._BA()
        return A.copy(), A + B

    def t_ba(self):
        """T(z) = B/(A+B)."""
        B, A = self._BA()
        return B.copy(), A + B

    def filter_hpd(self, x):
        """e_PD = h_PD * x  (time-domain, zero initial state)."""
        num, den = self.hpd_ba()
        return signal.lfilter(num, den, x)

    def cl_poles(self):
        """Closed-loop poles: z-plane for rational models, normalised s-plane
        (rad/sample) for the 'ct' model; None otherwise."""
        if self.rational:
            _, den = self.hpd_ba()
            return _roots_zinv(den)
        if self.ct_charpoly is not None:
            return np.roots(self.ct_charpoly)
        return None


# ----------------------------------------------------------------------------
# analysis primitives (all on Omega in rad/sample)
# ----------------------------------------------------------------------------
def f3db_w(Lw, n=6000, w_lo=1e-5):
    """First downward crossing of |T|^2 = 1/2 on (0, pi].  Returns (W3, ok)
    where ok=False if |T| re-crosses -3 dB above W3 (ill-defined BW)."""
    W = np.linspace(w_lo, np.pi, n)
    L = Lw(W)
    T2 = np.abs(L / (1 + L)) ** 2 - 0.5
    below = np.nonzero(T2 < 0)[0]
    if len(below) == 0:
        return np.pi, False
    i = below[0]
    if i == 0:
        return W[0], True

    def g(w):
        l = Lw(np.array([w]))[0]
        return abs(l / (1 + l)) ** 2 - 0.5

    W3 = optimize.brentq(g, W[i - 1], W[i], xtol=1e-14)
    ok = bool(np.all(T2[i:] < 0))
    return W3, ok


def _solve_scale(make_Lw, W_target, lg_lo=-14.0, lg_hi=4.0, n=90):
    """Find scale s (via log s) so that f3db(make_Lw(s)) == W_target."""
    lgs = np.linspace(lg_lo, lg_hi, n)
    prev = None
    for lg in lgs:
        val = f3db_w(make_Lw(math.exp(lg)))[0] - W_target
        if prev is not None and prev[1] < 0 <= val:
            r = optimize.brentq(lambda x: f3db_w(make_Lw(math.exp(x)))[0] - W_target,
                                prev[0], lg, xtol=1e-13)
            return math.exp(r)
        prev = (lg, val)
    raise RuntimeError("bandwidth target not bracketed")


def _dense_grid(n_lin=200000):
    return np.concatenate([np.geomspace(1e-7, 1e-3, 600, endpoint=False),
                           np.linspace(1e-3, np.pi, n_lin)])


def margins(loop: Loop, n_lin=200000):
    """Gain crossover, PM, phase-crossover(s), GM, delay margin, modulus margin."""
    Lw = loop.Lw
    W = _dense_grid(n_lin)
    L = Lw(W)
    mag = np.abs(L)
    ph = np.unwrap(np.angle(L))
    ph += TWO_PI * np.round((-0.5 * np.pi * loop.ltype - ph[0]) / TWO_PI)
    out = {}
    idx = np.nonzero(mag < 1)[0]
    if len(idx) == 0 or idx[0] == 0:
        out.update(Wc=np.nan, fc_Hz=np.nan, PM_deg=np.nan)
        Wc = 0.0
    else:
        i = idx[0]
        Wc = optimize.brentq(lambda w: abs(Lw(np.array([w]))[0]) - 1, W[i - 1], W[i], xtol=1e-14)
        phc = np.interp(Wc, W, ph)
        out.update(Wc=Wc, fc_Hz=Wc * loop.f_ref / TWO_PI, PM_deg=180 + np.degrees(phc))
        out["delay_margin_cycles"] = np.radians(out["PM_deg"]) / Wc
    # phase crossovers: negative-real-axis crossings above Wc, plus Nyquist endpoint
    im = L.imag
    re = L.real
    gm_list = []
    sel = np.nonzero((np.sign(im[:-1]) != np.sign(im[1:])) & (W[1:] > Wc))[0]
    for i in sel:
        if re[i] < 0 and re[i + 1] < 0 and i + 1 < len(W) - 1:
            try:
                w180 = optimize.brentq(lambda w: Lw(np.array([w]))[0].imag, W[i], W[i + 1], xtol=1e-14)
            except ValueError:
                continue
            l = Lw(np.array([w180]))[0]
            if l.real < 0:
                gm_list.append((w180, -20 * np.log10(abs(l))))
    lpi = Lw(np.array([np.pi]))[0]
    if abs(lpi.imag) <= 1e-9 * max(abs(lpi), 1e-30) and lpi.real < 0:
        gm_list.append((np.pi, -20 * np.log10(abs(lpi))))
    if gm_list:
        w180, gm = min(gm_list, key=lambda t: t[1])
        out.update(W180=w180, f180_Hz=w180 * loop.f_ref / TWO_PI, GM_dB=gm)
    else:
        out.update(W180=np.nan, f180_Hz=np.nan, GM_dB=np.inf)
    H = 1 / (1 + L)
    out["modulus_margin"] = 1 / np.max(np.abs(H))   # min |1+L|
    return out


def peaking(loop: Loop, n=200000):
    W = np.linspace(1e-6, np.pi, n)
    L = loop.Lw(W)
    T = np.abs(L / (1 + L))
    H = np.abs(1 / (1 + L))
    iT = int(np.argmax(T))
    iH = int(np.argmax(H))
    return {
        "T_peak_dB": 20 * np.log10(T[iT]), "T_peak_f_Hz": W[iT] * loop.f_ref / TWO_PI,
        "Hpd_peak_dB": 20 * np.log10(H[iH]), "Hpd_peak_f_Hz": W[iH] * loop.f_ref / TWO_PI,
        "Hpd_at_nyq_dB": 20 * np.log10(abs(1 / (1 + loop.Lw(np.array([np.pi]))[0]))),
    }


def inversion_bands(loop: Loop, n=200000):
    """Intervals of f (Hz) where Re{H_PD} < 0, i.e. Re{L} < -1 (exact identity).
    Each band: dict(f_lo, f_hi, min_ReH, f_at_min, phase range of H_PD)."""
    Lw = loop.Lw
    W = np.concatenate([np.geomspace(1e-7, 1e-3, 600, endpoint=False), np.linspace(1e-3, np.pi, n)])
    g = Lw(W).real + 1.0                     # < 0  <=>  Re{H_PD} < 0
    neg = g < 0
    bands = []
    i = 0
    N = len(W)

    def edge(i0, i1):
        return optimize.brentq(lambda w: Lw(np.array([w]))[0].real + 1.0, W[i0], W[i1], xtol=1e-15)

    while i < N:
        if neg[i]:
            j = i
            while j + 1 < N and neg[j + 1]:
                j += 1
            lo = 0.0 if i == 0 else edge(i - 1, i)
            hi = np.pi if j == N - 1 else edge(j, j + 1)
            seg = slice(i, j + 1)
            H = 1 / (1 + Lw(W[seg]))
            k = int(np.argmin(H.real))
            phd = np.degrees(np.angle(H))
            bands.append({
                "f_lo_Hz": lo * loop.f_ref / TWO_PI, "f_hi_Hz": hi * loop.f_ref / TWO_PI,
                "W_lo": lo, "W_hi": hi,
                "min_ReH": float(H.real[k]), "f_at_min_Hz": float(W[seg][k] * loop.f_ref / TWO_PI),
                "phase_min_deg": float(np.min(np.abs(phd))), "phase_max_deg": float(np.max(np.abs(phd))),
                "touches_dc": bool(i == 0),
            })
            i = j + 1
        else:
            i += 1
    return bands


def T_gt_1_bands(loop: Loop, n=200000):
    """Intervals (Hz) where |T| > 1 (0 dB), i.e. Re{L} < -1/2.  The inversion band
    {Re L < -1} is always a subset of these intervals."""
    W = np.concatenate([np.geomspace(1e-7, 1e-3, 600, endpoint=False), np.linspace(1e-3, np.pi, n)])
    g = loop.Lw(W).real + 0.5
    neg = g < 0
    out = []
    i = 0
    N = len(W)
    while i < N:
        if neg[i]:
            j = i
            while j + 1 < N and neg[j + 1]:
                j += 1
            lo = 0.0 if i == 0 else optimize.brentq(lambda w: loop.Lw(np.array([w]))[0].real + 0.5, W[i - 1], W[i])
            hi = np.pi if j == N - 1 else optimize.brentq(lambda w: loop.Lw(np.array([w]))[0].real + 0.5, W[j], W[j + 1])
            out.append([lo * loop.f_ref / TWO_PI, hi * loop.f_ref / TWO_PI])
            i = j + 1
        else:
            i += 1
    return out


def pole_info(loop: Loop):
    """Closed-loop poles with equivalent s = f_ref*ln(z), f_n, zeta."""
    p = loop.cl_poles()
    if p is None:
        return None
    out = []
    for z in p:
        if loop.rational:
            if abs(z) < 1e-12:
                out.append({"z": [0.0, 0.0], "abs_z": 0.0, "fn_Hz": np.inf, "zeta": 1.0})
                continue
            s = np.log(complex(z))         # rad/sample
            zr = [float(np.real(z)), float(np.imag(z))]
        else:
            s = complex(z)
            zr = None
        wn = abs(s)
        out.append({"z": zr, "abs_z": (float(abs(z)) if loop.rational else None),
                    "s_norm": [float(s.real), float(s.imag)],
                    "fn_Hz": float(wn * loop.f_ref / TWO_PI),
                    "zeta": float(-s.real / wn) if wn > 0 else 1.0})
    return out


def summarize(loop: Loop):
    W3, ok = f3db_w(loop.Lw, n=20000)
    d = {"name": loop.name, "type": loop.ltype, "params": loop.params,
         "f3dB_Hz": W3 * loop.f_ref / TWO_PI, "f3dB_unique": ok}
    d.update(margins(loop))
    d.update(peaking(loop))
    d["inversion_bands"] = inversion_bands(loop)
    d["T_gt_1_bands"] = T_gt_1_bands(loop)
    d["poles"] = pole_info(loop)
    if loop.rational:
        d["stable"] = bool(np.all(np.abs(loop.cl_poles()) < 1))
        d["b"] = list(map(float, loop.b))
        d["a"] = list(map(float, loop.a))
    elif loop.ct_charpoly is not None:
        d["stable"] = bool(np.all(np.real(loop.cl_poles()) < 0))
    else:
        d["stable"] = None   # non-rational: judge from margins (Nyquist)
    return d


# ----------------------------------------------------------------------------
# continuous-time 2nd-order reference formulas
# ----------------------------------------------------------------------------
def ct_g_zeta(zeta):
    """CT type-II 2nd order, T = (2 z wn s + wn^2)/(s^2+2 z wn s+wn^2):
    w_3dB / w_n."""
    a = 1 + 2 * zeta ** 2
    return math.sqrt(a + math.sqrt(a * a + 1))


def ct_pm_from_zeta(zeta):
    """PM (deg) of L = (2 z wn s + wn^2)/s^2 (no delay)."""
    x = math.sqrt(math.sqrt(1 + 4 * zeta ** 4) - 2 * zeta ** 2)
    return math.degrees(math.atan2(2 * zeta, x))


# ----------------------------------------------------------------------------
# L1 : SSPLL Type-I
# ----------------------------------------------------------------------------
def _L1_parts(K, D, f_pole_norm, latency_mode):
    """Return (Lw, b, a). f_pole_norm = wp in rad/sample or None."""
    m, delta = _split_latency(D)
    if f_pole_norm is None:
        base_b = np.array([0.0, K])
        base_a = np.array([1.0, -1.0])

        def L0(W):
            return K * _zinv(W) / _u(W)
    else:
        wp = f_pole_norm
        p = math.exp(-wp)
        c = (1 - p) / wp
        base_b = K * np.array([0.0, 1 - c, c - p])
        base_a = np.convolve([1.0, -1.0], [1.0, -p])

        def L0(W):
            zi = _zinv(W)
            return K * zi * (1 / _u(W) - c / (1 - p * zi))
    if delta == 0.0 and D >= 1:
        b = _delay(base_b, m)
        a = base_a

        def Lw(W):
            return L0(W) * _zinv(W) ** m
        return Lw, b, a
    if latency_mode == "modz":
        if D < 1:
            raise ValueError("modz needs D >= 1")
        if f_pole_norm is not None:
            raise NotImplementedError("modz with parasitic pole: use 'fd'")
        # full-cycle ZOH pulse delayed by delta: ((1-delta) z^-1 + delta z^-2)/(1-z^-1)
        b = _delay(K * np.array([0.0, 1 - delta, delta]), m)
        a = base_a

        def Lw(W):
            zi = _zinv(W)
            return K * zi * ((1 - delta) + delta * zi) / _u(W) * zi ** m
        return Lw, b, a

    def Lw(W):
        return L0(W) * np.exp(-1j * np.asarray(W, float) * (D - 1))
    return Lw, None, None


def L1_typeI(f_ref=F_REF, bw=BW, latency=1.0, f_pole=None, latency_mode="fd", K=None):
    """SSPLL Type-I.  f_pole [Hz] = optional parasitic loop-filter pole (ZOH-exact).
    K (rad/sample) is solved so that the closed-loop -3 dB point is `bw`
    unless given explicitly."""
    wp = None if f_pole is None else TWO_PI * f_pole / f_ref
    Wt = TWO_PI * bw / f_ref
    if K is None:
        K = _solve_scale(lambda k: _L1_parts(k, latency, wp, latency_mode)[0], Wt, -10, 1.5)
    Lw, b, a = _L1_parts(K, latency, wp, latency_mode)
    name = f"L1_typeI_D{latency:g}" + ("" if f_pole is None else f"_fp{f_pole/1e9:g}GHz")
    params = {"K": K, "K_rad_per_s": K * f_ref, "latency_D": latency, "latency_mode": latency_mode,
              "f_pole_Hz": f_pole, "tau_eq_cycles": latency - 0.5,
              "K_tau_eq": K * (latency - 0.5)}
    return Loop(name, f_ref, Lw, 1, b, a, params)


# ----------------------------------------------------------------------------
# L2 : SSPLL Type-II  (narrow pulse / impulse-invariant P + I)
# ----------------------------------------------------------------------------
def _L2_parts(Kp, Ki, D, latency_mode):
    m, delta = _split_latency(D)
    if D >= 1 and (delta == 0.0 or latency_mode == "modz"):
        Kpe = Kp - delta * Ki          # narrow pulse delayed by delta < 1 cycle
        b = _delay(np.array([0.0, Kpe + Ki, -Kpe]), m)
        a = np.array([1.0, -2.0, 1.0])

        def Lw(W):
            u = _u(W)
            return (Kpe * u + Ki) * _zinv(W) / u ** 2 * _zinv(W) ** m
        return Lw, b, a

    def Lw(W):
        u = _u(W)
        return (Kp * u + Ki) * _zinv(W) / u ** 2 * np.exp(-1j * np.asarray(W, float) * (D - 1))
    return Lw, None, None


def _L2_design(zeta, Wt, D, latency_mode):
    def mk(wn):
        return _L2_parts(2 * zeta * wn, wn * wn, D, latency_mode)[0]
    wn = _solve_scale(mk, Wt, -10, 1.0)
    return wn


def L2_typeII(f_ref=F_REF, bw=BW, pm_deg=60.0, latency=1.0, latency_mode="fd",
              zeta=None, Kp=None, Ki=None):
    """SSPLL Type-II, L0(z) = (Kp + Ki/(1-z^-1)) z^-1/(1-z^-1).
    Parameterised as Ki = wn^2, Kp = 2*zeta*wn (CT-equivalent, rad/sample).
    Default: zeta solved so that the sampled-data PM equals pm_deg AND wn solved
    so that |T| -3 dB = bw.  Give zeta to skip the PM solve; give Kp, Ki to
    skip everything."""
    Wt = TWO_PI * bw / f_ref
    if Kp is None or Ki is None:
        if zeta is None:
            def pm_err(z):
                wn = _L2_design(z, Wt, latency, latency_mode)
                lp = Loop("tmp", f_ref, _L2_parts(2 * z * wn, wn * wn, latency, latency_mode)[0], 2)
                return margins(lp, n_lin=40000)["PM_deg"] - pm_deg
            zs = np.linspace(0.15, 4.0, 18)
            vals = [pm_err(z) for z in zs]
            ks = [i for i in range(1, len(zs)) if vals[i - 1] < 0 <= vals[i]]
            if not ks:
                raise ValueError(f"L2: PM={pm_deg} deg not reachable at BW={bw/1e6:g} MHz, D={latency:g} "
                                 f"(max PM over zeta<=4 is {max(vals) + pm_deg:.1f} deg)")
            k = ks[0]
            zeta = optimize.brentq(pm_err, zs[k - 1], zs[k], xtol=1e-10)
        wn = _L2_design(zeta, Wt, latency, latency_mode)
        Kp, Ki = 2 * zeta * wn, wn * wn
    else:
        wn = math.sqrt(Ki)
        zeta = Kp / (2 * wn)
    Lw, b, a = _L2_parts(Kp, Ki, latency, latency_mode)
    name = f"L2_typeII_PM{pm_deg:g}_D{latency:g}"
    params = {"Kp": Kp, "Ki": Ki, "zeta_ct_equiv": zeta, "wn_norm": wn,
              "fn_ct_equiv_Hz": wn * f_ref / TWO_PI,
              "f_zero_Hz": (Ki / Kp) * f_ref / TWO_PI,
              "pm_target_deg": pm_deg, "latency_D": latency, "latency_mode": latency_mode}
    return Loop(name, f_ref, Lw, 2, b, a, params)


# ----------------------------------------------------------------------------
# L3 : conventional CPPLL (CT 3rd-order type-II) mapped to f_ref domain
# ----------------------------------------------------------------------------
def _cppll_ct_coeffs(wc, bratio):
    """PM-optimal 3rd-order: wz = wc/sqrt(b), wp = wc*sqrt(b), |L(j wc)| = 1."""
    sb = math.sqrt(bratio)
    wz = wc / sb
    wp = wc * sb
    K = wc * wc / sb
    return K, wz, wp


def _cppll_parts(wc, bratio, mapping, D, latency_mode):
    K, wz, wp = _cppll_ct_coeffs(wc, bratio)
    m, delta = _split_latency(D)
    ct_cp = None
    if mapping in ("ct", "ct_delay"):
        tau0 = 0.0 if mapping == "ct" else 0.5

        def Lw(W):
            W = np.asarray(W, float)
            s = 1j * W
            return K * (1 + s / wz) / (s * s * (1 + s / wp)) * np.exp(-s * (tau0 + (D - 1)))
        if mapping == "ct" and D == 1:
            ct_cp = np.array([1 / wp, 1.0, K / wz, K])
        return Lw, None, None, ct_cp
    if mapping == "impulse":
        p = math.exp(-wp)
        Bc = K * (1 / wz - 1 / wp)
        Cc = -Bc
        use_rat = D >= 1 and (delta == 0.0 or latency_mode == "modz")
        dl = delta if use_rat else 0.0
        # L = K[z^-1/(1-z^-1)^2 - dl z^-1/(1-z^-1)] + Bc z^-1/(1-z^-1) + Cc p^(1-dl) z^-1/(1-p z^-1)
        cp = Cc * p ** (1 - dl)
        one = np.array([1.0])
        d1 = np.array([1.0, -1.0])
        dp = np.array([1.0, -p])
        z1 = np.array([0.0, 1.0])
        num = K * np.convolve(z1, dp)                                   # K z^-1 (1-pz^-1)
        num = _padd(num, (-K * dl + Bc) * np.convolve(z1, np.convolve(d1, dp)))
        num = _padd(num, cp * np.convolve(z1, np.convolve(d1, d1)))
        den = np.convolve(np.convolve(d1, d1), dp)

        def L0(W):
            u = _u(W)
            zi = _zinv(W)
            return K * (zi / u ** 2 - dl * zi / u) + Bc * zi / u + cp * zi / (1 - p * zi)
        if use_rat:
            b = _delay(num, m)

            def Lw(W):
                return L0(W) * _zinv(W) ** m
            return Lw, b, den, None

        def Lw(W):
            return L0(W) * np.exp(-1j * np.asarray(W, float) * (D - 1))
        return Lw, None, None, None
    if mapping == "zoh":
        num_s = K * np.array([1 / wz, 1.0])
        den_s = np.array([1 / wp, 1.0, 0.0, 0.0])
        nd, dd, _ = signal.cont2discrete((num_s, den_s), dt=1.0, method="zoh")
        nd = np.asarray(nd, float).ravel()
        dd = np.asarray(dd, float).ravel()
        nd = nd / dd[0]
        dd = dd / dd[0]
        nd[np.abs(nd) < 1e-15 * np.max(np.abs(nd))] = 0.0

        def L0(W):
            return _freqz_zinv(nd, W) / _freqz_zinv(dd, W)
        if D >= 1 and delta == 0.0:
            b = _delay(nd, m)

            def Lw(W):
                return L0(W) * _zinv(W) ** m
            return Lw, b, dd, None

        def Lw(W):
            return L0(W) * np.exp(-1j * np.asarray(W, float) * (D - 1))
        return Lw, None, None, None
    raise ValueError(mapping)


def L3_cppll(f_ref=F_REF, bw=BW, pm_deg=60.0, latency=1.0, mapping="impulse",
             pm_domain="ct", latency_mode="fd", bratio=None):
    """Conventional CPPLL, L(s) = K(1+s/wz)/(s^2(1+s/wp)), PM-optimal placement
    wz = wc/sqrt(b), wp = wc*sqrt(b), K = wc^2/sqrt(b).
    pm_domain='ct': b from the CT formula PM = atan((b-1)/(2 sqrt b)) (classical design);
    pm_domain='dt': b solved so that the PM of the *mapped* model equals pm_deg.
    wc is then scaled so that the mapped model's |T| -3 dB = bw."""
    Wt = TWO_PI * bw / f_ref

    def b_from_pm_ct(pm):
        t = math.tan(math.radians(pm))
        sb = t + math.sqrt(t * t + 1)
        return sb * sb

    def wc_for(bb):
        return _solve_scale(lambda w: _cppll_parts(w, bb, mapping, latency, latency_mode)[0], Wt, -10, 1.0)

    if bratio is None:
        if pm_domain == "ct":
            bratio = b_from_pm_ct(pm_deg)
        else:
            def err(lb):
                bb = math.exp(lb)
                wc = wc_for(bb)
                lp = Loop("tmp", f_ref, _cppll_parts(wc, bb, mapping, latency, latency_mode)[0], 2)
                return margins(lp, n_lin=40000)["PM_deg"] - pm_deg
            lbs = np.linspace(math.log(1.2), math.log(3000), 18)
            vals = [err(x) for x in lbs]
            ks = [i for i in range(1, len(lbs)) if vals[i - 1] < 0 <= vals[i]]
            if not ks:
                raise ValueError(f"L3: dt PM={pm_deg} deg not reachable (max {max(vals) + pm_deg:.1f} deg)")
            k = ks[0]
            bratio = math.exp(optimize.brentq(err, lbs[k - 1], lbs[k], xtol=1e-10))
    wc = wc_for(bratio)
    K, wz, wp = _cppll_ct_coeffs(wc, bratio)
    Lw, b, a, ctcp = _cppll_parts(wc, bratio, mapping, latency, latency_mode)
    pm_ct = math.degrees(math.atan((bratio - 1) / (2 * math.sqrt(bratio))))
    name = f"L3_cppll_{mapping}_PM{pm_domain}{pm_deg:g}_D{latency:g}"
    params = {"mapping": mapping, "pm_domain": pm_domain, "pm_target_deg": pm_deg,
              "b_ratio": bratio, "PM_ct_formula_deg": pm_ct,
              "K_norm": K, "wz_norm": wz, "wp_norm": wp, "wc_norm": wc,
              "f_c_design_Hz": wc * f_ref / TWO_PI, "f_z_Hz": wz * f_ref / TWO_PI,
              "f_p_Hz": wp * f_ref / TWO_PI,
              "Ki_equiv": K, "Kp_equiv": K * (1 / wz - 1 / wp),
              "latency_D": latency, "latency_mode": latency_mode}
    return Loop(name, f_ref, Lw, 2, b, a, params, ct_charpoly=ctcp)


# ----------------------------------------------------------------------------
# convenience: the nominal set used in the report
# ----------------------------------------------------------------------------
def nominal_models(f_ref=F_REF, bw=BW):
    return {
        "L1": L1_typeI(f_ref, bw, latency=1.0),
        "L2": L2_typeII(f_ref, bw, pm_deg=60.0, latency=1.0),
        "L3": L3_cppll(f_ref, bw, pm_deg=60.0, latency=1.0, mapping="impulse", pm_domain="ct"),
    }


# ----------------------------------------------------------------------------
# LMS-facing helper: effective correlation gain of H_PD for a periodic regressor
# ----------------------------------------------------------------------------
def lms_effective_gain(loop: Loop, x):
    """For a regressor x[n] that is periodic over len(x) samples, the steady-state
    correlation  <(h_PD * x)[n] x[n]>  divided by  <x_ac^2>  equals
        sum_{k!=0} |X_k|^2 Re{H_PD(2 pi k/N)} / sum_{k!=0} |X_k|^2.
    Negative  =>  a (linearised) LMS on this regressor is driven the wrong way."""
    x = np.asarray(x, float)
    N = len(x)
    X = np.fft.rfft(x)
    k = np.arange(len(X))
    Wk = TWO_PI * k / N
    w = np.abs(X) ** 2
    w[0] = 0.0
    if np.sum(w) <= 1e-20 * max(np.sum(np.abs(x) ** 2), 1e-300):
        return float("nan")          # regressor has no AC content
    if N % 2 == 0:
        w[-1] *= 0.5            # Nyquist bin counted once
    H = np.zeros(len(X), dtype=complex)
    H[1:] = loop.Hpd_w(Wk[1:])
    return float(np.sum(w * H.real) / np.sum(w))


def lms_effective_matrix(loop: Loop, Xmat):
    """Columns of Xmat (N x M) are periodic regressors x_k. Returns the M x M matrix
    R[k, j] = <x_k[n] (h_PD * x_j)[n]>  (exact steady state via FFT), so that the
    mean LMS update is  dw = mu R (eps - w).  The LMS mean dynamics
    converge iff all eigenvalues of R (restricted to the observable subspace)
    have positive real part (small-mu limit)."""
    Xmat = np.asarray(Xmat, float)
    N = Xmat.shape[0]
    F = np.fft.fft(Xmat, axis=0)
    Wk = TWO_PI * np.arange(N) / N
    H = np.zeros(N, dtype=complex)
    H[1:] = loop.Hpd_w(np.where(Wk[1:] <= np.pi, Wk[1:], Wk[1:] - TWO_PI))
    # real-coefficient system: H(-W) = conj H(W)
    neg = Wk > np.pi
    H[neg] = np.conj(loop.Hpd_w(TWO_PI - Wk[neg]))
    Y = F * H[:, None]
    R = (np.conj(F).T @ Y).real / N / N
    return R


if __name__ == "__main__":
    for k, lp in nominal_models().items():
        s = summarize(lp)
        print(k, lp.name, "f3dB=%.3f MHz" % (s["f3dB_Hz"] / 1e6), "PM=%.2f" % s["PM_deg"],
              "bands:", [(round(b_["f_lo_Hz"] / 1e6, 3), round(b_["f_hi_Hz"] / 1e6, 3)) for b_ in s["inversion_bands"]])
