"""
corr.py -- regressor / correlation theory that decides the sign of the
GOS (DTC gain) and PHOS (8-phase PMUX offset) sign-error LMS loops in a
fractional-N sub-sampling PLL.

Model (all times in units of T_vco/8 unless stated; f normalised to f_ref):
    alpha      : fractional FCW, alpha in [0,1)
    phi[n]     = frac(n*alpha)                      (fractional phase, VCO periods)
    p[n]       = floor(8*phi[n])                    (PMUX index 0..7)
    rho[n]     = 8*phi[n] - p[n] = frac(8 n alpha)  (DTC residue in 1/8 bin)
    x_k[n]     = 1{p[n] = k}                        (PHOS regressors)
    e_inj[n]   = (a-w_g) rho[n] + sum_k (eps_k - w_k) x_k[n]
    e_PD       = h_PD * e_inj,  H_PD(z) = 1/(1+L(z))
    q[n]       = sign(e_PD[n] + v[n]),  v ~ N(0, sigma_v^2)
    G_i        = mean_n q[n] x_i[n-D]
    E[G_i]    ~= K_q sum_j C_ij (a_j - w_j),  K_q = sqrt(2/pi)/sigma_v

    C_ij = < x_i[n-D] (h*x_j)[n] >  =  sum_k h[k] R_{x_i x_j}[k-D]
         = (1/2pi) int S_{x_j x_i}(W) H(e^{jW}) e^{jWD} dW
    with R_{xy}[m] = <x[n+m] y[n]>, S_xy = DTFT{R_xy}.

Regressor ordering used everywhere: index 0 = rho (GOS), 1..8 = x_0..x_7.

Every public function is documented; nothing here depends on f_vco.
"""
from __future__ import annotations

import math
from fractions import Fraction
from typing import Callable, Optional, Sequence

import numpy as np
from scipy import optimize, signal, special

F_REF = 4e9          # SSPD / reference sampling rate [Hz]
F_BW = 320e6         # closed-loop -3 dB bandwidth of T = L/(1+L) [Hz]
NPH = 8              # number of PMUX phases


# =====================================================================
# 1.  Loop models  (polynomials in z^{-1}:  b = [b0, b1, ...] -> b0 + b1 z^-1 + ...)
# =====================================================================
def _padd(a, b):
    n = max(len(a), len(b))
    return np.pad(np.asarray(a, float), (0, n - len(a))) + np.pad(np.asarray(b, float), (0, n - len(b)))


def _peval(c, zinv):
    """Evaluate polynomial in z^{-1} (coefficients c[k] of z^{-k}) at zinv."""
    c = np.asarray(c, float)
    return np.polyval(c[::-1], zinv)


def latency_poly(lat: float) -> np.ndarray:
    """Numerator for the sampled ZOH+VCO-integrator path with total latency `lat` (>=1)
    reference cycles:  z^{-lat} realised as (1-f) z^{-i} + f z^{-(i+1)},  i=floor(lat), f=lat-i.
    lat = 1 : control from sample n is integrated over [nT, (n+1)T) -> full effect at sample n+1
              (the task's baseline  K z^{-1}/(1-z^{-1})).
    lat = 1+tau : the hold starts tau*T late (excess loop delay); the integral splits
              between samples n+1 and n+2 -> (1-tau) z^{-1} + tau z^{-2}.  Exact for a ZOH."""
    if lat < 1:
        raise ValueError("latency must be >= 1 cycle (strictly causal loop)")
    i = int(math.floor(lat + 1e-12))
    f = lat - i
    c = np.zeros(i + 2)
    c[i] += 1 - f
    c[i + 1] += f
    return np.trim_zeros(c, 'b')


def pole_poly(f_pole: Optional[float], f_ref: float = F_REF):
    """Unity-DC-gain real pole (1-p)/(1-p z^-1), p = exp(-2 pi f_pole/f_ref). None -> 1."""
    if f_pole is None:
        return np.array([1.0]), np.array([1.0])
    p = math.exp(-2 * math.pi * f_pole / f_ref)
    return np.array([1 - p]), np.array([1.0, -p])


class Loop:
    """Sampled-data loop L(z) = bL(z)/aL(z) with derived H_PD = 1/(1+L), T = L/(1+L)."""

    def __init__(self, name, bL, aL, params):
        self.name = name
        self.bL = np.asarray(bL, float)
        self.aL = np.asarray(aL, float)
        den = _padd(self.aL, self.bL)
        self.bH, self.aH = self.aL.copy(), den            # H_PD = aL/(aL+bL)
        self.bT, self.aT = self.bL.copy(), den            # T    = bL/(aL+bL)
        self.params = dict(params)

    # --- frequency responses (f normalised to f_ref, cycles/sample) ---
    def L(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return _peval(self.bL, zi) / _peval(self.aL, zi)

    def H(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return _peval(self.bH, zi) / _peval(self.aH, zi)

    def T(self, f):
        zi = np.exp(-2j * np.pi * np.asarray(f, float))
        return _peval(self.bT, zi) / _peval(self.aT, zi)

    def Gamma(self, f, D=0):
        """Gamma(f) = H_PD(e^{j2pi f}) e^{j 2 pi f D}  (D = correlator code delay)."""
        f = np.asarray(f, float)
        return self.H(f) * np.exp(2j * np.pi * f * D)

    def impulse(self, n):
        x = np.zeros(n)
        x[0] = 1.0
        return signal.lfilter(self.bH, self.aH, x)

    def poles(self):
        # roots of aH(z^{-1}) as polynomial in z:  aH0 z^M + aH1 z^{M-1} + ...
        return np.roots(self.aH)

    def is_stable(self):
        return bool(np.all(np.abs(self.poles()) < 1 - 1e-12))

    # --- light-weight figures of merit used inside the solvers ---
    def f3db(self, ngrid=4001):
        """First frequency (norm.) where |T| drops below 1/sqrt2."""
        f = np.linspace(1e-6, 0.5, ngrid)
        Tm = np.abs(self.T(f))
        idx = np.nonzero(Tm < 1 / math.sqrt(2))[0]
        if not len(idx):
            return 0.5
        i = idx[0]
        if i == 0:
            return float(f[0])
        return optimize.brentq(lambda ff: abs(self.T(ff)) - 1 / math.sqrt(2), f[i - 1], f[i], xtol=1e-12)

    def phase_margin(self, ngrid=8001):
        """(fc, PM_deg): first |L| = 1 crossing, PM = 180 + unwrapped angle(L) (deg)."""
        f = np.linspace(1e-6, 0.5, ngrid)
        Lc = self.L(f)
        ic = np.nonzero(np.abs(Lc) < 1)[0]
        if not len(ic):
            return None, None
        i = ic[0]
        fc = optimize.brentq(lambda ff: abs(self.L(ff)) - 1, f[i - 1], f[i], xtol=1e-12)
        ph = np.unwrap(np.angle(Lc[: i + 1]))
        typ = self.params.get('type', 1)
        ph += 2 * np.pi * round((-typ * np.pi / 2 - ph[0]) / (2 * np.pi))
        phc = ph[-1] + np.angle(np.exp(1j * (np.angle(self.L(fc)) - ph[-1])))
        return float(fc), float(180 + math.degrees(phc))

    def stats(self, f_ref=F_REF):
        """f_3dB, peaking, phase margin, crossover, stability, negative-Re{H_PD} bands and the
        DC constants (h[0], S_inf = sum of the step response of H_PD = lim H/(1-z^-1))."""
        f = np.linspace(1e-6, 0.5, 200001)
        Tm = np.abs(self.T(f))
        f3 = self.f3db()
        fc, pm = self.phase_margin()
        Hr = np.real(self.H(f))
        neg = Hr < 0
        bands = []
        if neg.any():
            d = np.diff(np.concatenate([[0], neg.astype(int), [0]]))
            st, en = np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1
            bands = [(float(f[s]), float(f[e])) for s, e in zip(st, en)]
        h = self.impulse(40000)
        s1 = np.cumsum(h)
        return dict(
            f3dB_norm=f3, f3dB_Hz=f3 * f_ref,
            peaking_dB=float(20 * np.log10(Tm.max())),
            fc_norm=fc, fc_Hz=None if fc is None else fc * f_ref, PM_deg=pm,
            stable=self.is_stable(), max_pole_mag=float(np.max(np.abs(self.poles()))),
            ReH_negative_bands_norm=bands,
            ReH_negative_bands_MHz=[(a * f_ref / 1e6, b * f_ref / 1e6) for a, b in bands],
            ReH_min=float(Hr.min()), ReH_min_at_norm=float(f[np.argmin(Hr)]),
            ReH_min_at_MHz=float(f[np.argmin(Hr)] * f_ref / 1e6),
            h0=float(h[0]), S_inf=float(s1.sum()),
        )


def make_type1(f_bw=F_BW, f_ref=F_REF, lat=1.0, f_pole=None, name=None):
    """SSPLL Type-I:  L(z) = K z^{-lat} / (1 - z^{-1}) * (1-p)/(1-p z^{-1})  with K solved
    so that the closed-loop -3 dB of T = L/(1+L) equals f_bw."""
    nl = latency_poly(lat)
    bp, ap = pole_poly(f_pole, f_ref)
    nm = name or (f"T1_lat{lat:g}" + ("" if f_pole is None else f"_pole{f_pole/1e6:g}M"))

    def build(K):
        bL = K * np.convolve(nl, bp)
        aL = np.convolve([1.0, -1.0], ap)
        return Loop(nm, bL, aL, dict(type=1, K=K, lat=lat, f_pole=f_pole))

    target = f_bw / f_ref
    lK = optimize.brentq(lambda lk: build(math.exp(lk)).f3db() - target, math.log(1e-3), math.log(1.2),
                         xtol=1e-12)
    lp = build(math.exp(lK))
    lp.params.update(lp.stats(f_ref))
    lp.params['K_v'] = lp.params['K']       # lim_{z->1} (1-z^-1) L(z)
    return lp


def make_type2(f_bw=F_BW, f_ref=F_REF, lat=1.0, pm_target=60.0, f_pole=None, name=None):
    """SSPLL Type-II:  L(z) = (Kp + Ki/(1-z^{-1})) z^{-lat}/(1-z^{-1}) * pole.
    Ki/Kp = r is solved for phase margin = pm_target, and the overall gain for f_3dB = f_bw."""
    nl = latency_poly(lat)
    bp, ap = pole_poly(f_pole, f_ref)
    target = f_bw / f_ref
    nm = name or (f"T2_pm{pm_target:g}_lat{lat:g}" + ("" if f_pole is None else f"_pole{f_pole/1e6:g}M"))

    def build(Kp, r):
        Ki = r * Kp
        num = _padd(Kp * np.array([1.0, -1.0]), [Ki])          # Kp(1-z^-1) + Ki
        bL = np.convolve(np.convolve(num, nl), bp)
        aL = np.convolve(np.convolve([1.0, -1.0], [1.0, -1.0]), ap)
        return Loop(nm, bL, aL, dict(type=2, Kp=Kp, Ki=Ki, r=r, lat=lat, f_pole=f_pole, pm_target=pm_target))

    def solve_K(r):
        return math.exp(optimize.brentq(lambda lk: build(math.exp(lk), r).f3db() - target,
                                        math.log(1e-4), math.log(1.2), xtol=1e-12))

    def pm_of(lr):
        r = math.exp(lr)
        lp = build(solve_K(r), r)
        return lp.phase_margin()[1] if lp.is_stable() else -90.0

    grid = np.linspace(math.log(1e-4), math.log(0.5), 25)
    pms = np.array([pm_of(g) for g in grid])
    ok = np.nonzero((pms[:-1] - pm_target) * (pms[1:] - pm_target) <= 0)[0]
    if not len(ok):
        raise ValueError(f"PM {pm_target} not reachable (range {pms.min():.1f}..{pms.max():.1f})")
    i = ok[0]
    lr = optimize.brentq(lambda g: pm_of(g) - pm_target, grid[i], grid[i + 1], xtol=1e-9)
    r = math.exp(lr)
    lp = build(solve_K(r), r)
    lp.params.update(lp.stats(f_ref))
    lp.params['K_a'] = lp.params['Ki']      # lim_{z->1} (1-z^-1)^2 L(z)
    return lp


def make_cppll(f_bw=F_BW, f_ref=F_REF, pm_target=55.0, tau=0.0, name=None):
    """Conventional CPPLL (3rd-order type-II, R + C1||C2):  L(s) = K (1 + s/wz) / (s^2 (1 + s/wp)),
    wz = wc/b, wp = wc*b.  Mapped to the f_ref sampled-data domain by IMPULSE INVARIANCE
    (the CP delivers a charge packet proportional to the sampled phase error once per cycle):
        L(z) = T * sum_{n>=1} l(nT - tau) z^{-n},  l(t) = A t + B + C e^{-wp t}  (partial fractions),
    tau = optional extra delay (tau = T/2 models the e^{-sT/2} 'ZOH-like' variant).
    b is solved for discrete PM = pm_target, K for closed-loop -3 dB = f_bw."""
    T = 1.0 / f_ref
    target = f_bw / f_ref
    nm = name or f"CP_pm{pm_target:g}" + ("" if tau == 0 else f"_tau{tau*f_ref:g}T")

    def build(K, wc, b):
        wz, wp = wc / b, wc * b
        # K(1+s/wz)/(s^2(1+s/wp)) = A/s^2 + Bc/s + C/(s+wp)
        # residues of F(s) = K wp (1 + s/wz) / (s^2 (s + wp)):  A = K,  C = K (1 - wp/wz)/wp,  Bc = -C
        A = K
        C = K * (1 - wp / wz) / wp
        Bc = -C
        p = math.exp(-wp * T)
        cpt = C * math.exp(-wp * (T - tau))          # C e^{-wp(T - tau)}  (sample n=1 of the decaying term)
        # T*[ A T z^-1/(1-z^-1)^2 + (Bc - A tau) z^-1/(1-z^-1) + C e^{-wp(T-tau)} z^-1/(1-p z^-1) ]
        d1 = np.array([1.0, -1.0])
        d2 = np.convolve(d1, d1)
        dp = np.array([1.0, -p])
        den = np.convolve(d2, dp)
        n1 = np.convolve([0.0, A * T], dp)                               # over d2*dp
        n2 = np.convolve(np.convolve([0.0, Bc - A * tau], d1), dp)       # over d1 -> times d1*dp
        n3 = np.convolve([0.0, cpt], d2)                                 # over dp -> times d2
        num = T * _padd(_padd(n1, n2), n3)
        return Loop(nm, num, den, dict(type=2, K=K, wc=wc, b=b, wz=wz, wp=wp, tau=tau, pm_target=pm_target))

    def solve_K(b, wc_guess):
        # keep wc as the geometric centre; scale K so that |L(j wc)| ~ 1 in CT, then fine-tune on f3dB
        def f3(lk):
            K = math.exp(lk)
            wc = math.sqrt(K * b)      # CT crossover with wz = wc/b, wp = wc b  (|L(jwc)| = 1 at geometric mean)
            return build(K, wc, b).f3db() - target
        lk = optimize.brentq(f3, math.log(1e12), math.log(1e22), xtol=1e-12)
        K = math.exp(lk)
        return build(K, math.sqrt(K * b), b)

    def pm_of(lb):
        lp = solve_K(math.exp(lb), None)
        return lp.phase_margin()[1] if lp.is_stable() else -90.0

    grid = np.linspace(math.log(1.2), math.log(30.0), 25)
    pms = np.array([pm_of(g) for g in grid])
    ok = np.nonzero((pms[:-1] - pm_target) * (pms[1:] - pm_target) <= 0)[0]
    if not len(ok):
        raise ValueError(f"PM {pm_target} not reachable ({pms.min():.1f}..{pms.max():.1f})")
    i = ok[0]
    lb = optimize.brentq(lambda g: pm_of(g) - pm_target, grid[i], grid[i + 1], xtol=1e-9)
    lp = solve_K(math.exp(lb), None)
    lp.params.update(lp.stats(f_ref))
    lp.params['K_a'] = lp.params['K'] * f_ref ** -2      # lim (1-z^-1)^2 L(z) = A T^2
    return lp


# =====================================================================
# 2.  Regressors
# =====================================================================
def _as_fraction(alpha) -> Optional[Fraction]:
    if isinstance(alpha, Fraction):
        return alpha
    if isinstance(alpha, tuple) and len(alpha) == 2:
        return Fraction(int(alpha[0]), int(alpha[1]))
    return None


def regressors(alpha, n: np.ndarray) -> np.ndarray:
    """Return R (9, len(n)): R[0] = rho[n] in [0,1), R[1+k] = 1{p[n]=k}.
    alpha may be a Fraction / (P,Q) tuple (exact integer arithmetic) or a float."""
    n = np.asarray(n, dtype=np.int64)
    fr = _as_fraction(alpha)
    if fr is not None:
        P, Q = fr.numerator, fr.denominator
        s = (n % Q) * (P % Q) % Q                    # exact; Q < 2^31 assumed
        p = (NPH * s) // Q
        rho = ((NPH * s) % Q) / Q
    else:
        phi = np.mod(n * float(alpha), 1.0)
        y = NPH * phi
        p = np.floor(y).astype(np.int64)
        p = np.clip(p, 0, NPH - 1)
        rho = y - p
    R = np.zeros((1 + NPH, len(n)))
    R[0] = rho
    R[1 + p, np.arange(len(n))] = 1.0
    return R


# =====================================================================
# 3.  Correlation matrices
# =====================================================================
def _gamma_callable(loop: Optional[Loop] = None, H: Optional[Callable] = None,
                    h: Optional[np.ndarray] = None, D: int = 0):
    """Return Gamma(f) = H(e^{j2pi f}) e^{j2pi f D} from a Loop, a callable H(Omega) (rad/sample)
    or an impulse response h (FIR)."""
    if loop is not None:
        return lambda f: loop.Gamma(f, D)
    if H is not None:
        return lambda f: H(2 * np.pi * np.asarray(f, float)) * np.exp(2j * np.pi * np.asarray(f, float) * D)
    if h is not None:
        hh = np.asarray(h, float)
        return lambda f: _peval(hh, np.exp(-2j * np.pi * np.asarray(f, float))) * np.exp(2j * np.pi * np.asarray(f, float) * D)
    raise ValueError("need loop, H or h")


def C_exact(alpha, D: int = 0, loop: Optional[Loop] = None, H=None, h=None,
            return_complex=False) -> np.ndarray:
    """EXACT steady-state long-run time average C (9x9) for rational alpha = P/Q:
        C_ij = sum_{l=0}^{Q-1} conj(c^i_l) c^j_l Gamma(l/Q),   c^i_l = DFT_Q{x_i}[l]/Q
    (one period of the periodic regressors; the steady-state response of the stable LTI
    path to a Q-periodic input is Q-periodic with lines multiplied by H(e^{j2pi l/Q})).
    Includes the l=0 (mean) line, which is multiplied by H(1) (=0 for type>=1)."""
    fr = _as_fraction(alpha)
    if fr is None:
        raise ValueError("C_exact needs a rational alpha (Fraction or (P,Q)); use C_time for floats")
    Q = fr.denominator
    R = regressors(fr, np.arange(Q))
    X = np.fft.fft(R, axis=1) / Q
    G = _gamma_callable(loop, H, h, D)(np.arange(Q) / Q)
    C = (np.conj(X) * G) @ X.T
    return C if return_complex else C.real


def C_time(alpha, D: int = 0, N: int = 1 << 18, burn: int = 20000, loop: Optional[Loop] = None,
           h: Optional[np.ndarray] = None, n0: int = 0, H: Optional[Callable] = None,
           nfir: int = 1 << 14) -> np.ndarray:
    """Brute-force time-domain estimate: build the RAW regressors (non-zero mean included),
    filter each through H_PD (IIR from `loop`, FIR `h`, or a callable H(Omega) converted to an
    nfir-tap FIR by inverse FFT), then average x_i[n-D] y_j[n] over N samples after `burn`."""
    if loop is None and h is None and H is not None:
        W = 2 * np.pi * np.arange(nfir) / nfir
        h = np.real(np.fft.ifft(H(W)))
    Dm = abs(D)
    n = np.arange(n0, n0 + burn + N + Dm + 1)
    R = regressors(alpha, n)
    if loop is not None:
        Y = signal.lfilter(loop.bH, loop.aH, R, axis=1)
    else:
        Y = signal.lfilter(np.asarray(h, float), [1.0], R, axis=1)
    idx = np.arange(burn + Dm, burn + Dm + N)
    Xi = R[:, idx - D]
    Yj = Y[:, idx]
    return Xi @ Yj.T / N


# ---------- analytic harmonic-sum ("line spectrum") predictions ----------
def _mean_gamma(loop=None, H=None, h=None, D=0):
    """Average of Re Gamma(f) over f in [0,1) = h[-D] (0 if -D<0)."""
    if -D < 0:
        return 0.0
    if loop is not None:
        hh = loop.impulse(-D + 1)
    elif h is not None:
        hh = np.asarray(h, float)
        if -D >= len(hh):
            return 0.0
    else:
        ff = (np.arange(1 << 16) + 0.5) / (1 << 16)
        return float(np.mean(np.real(_gamma_callable(None, H, None, D)(ff))))
    return float(hh[-D])


def gos_harmonic(alpha: float, D=0, loop=None, H=None, h=None, M=4096, tail=True) -> float:
    """C_GOS = sum_{m>=1} Re Gamma(frac(m beta)) / (2 pi^2 m^2),  beta = frac(8 alpha).
    EXACT for every alpha (rational or not) when H(1)=0 (see README sec. 3); truncated at M
    harmonics with the tail replaced by its equidistributed mean (h[-D]) x trigamma weight."""
    beta = (8.0 * float(alpha)) % 1.0
    G = _gamma_callable(loop, H, h, D)
    m = np.arange(1, M + 1)
    val = np.sum(np.real(G((m * beta) % 1.0)) / (2 * np.pi ** 2 * m ** 2))
    if tail and beta != 0.0:
        val += _mean_gamma(loop, H, h, D) * special.polygamma(1, M + 1) / (2 * np.pi ** 2)
    return float(val)


def gos_rational_closed_form(beta: Fraction, D=0, loop=None, H=None, h=None) -> float:
    """Exact finite sum for rational beta' = frac(8 alpha) = P/Q in lowest terms:
       C_GOS = sum_{r=1}^{Q-1} Re Gamma(frac(rP/Q)) / (4 Q^2 sin^2(pi r/Q))."""
    beta = Fraction(beta) % 1
    P, Q = beta.numerator, beta.denominator
    if Q == 1:
        return 0.0
    r = np.arange(1, Q)
    G = _gamma_callable(loop, H, h, D)(((r * P) % Q) / Q)
    return float(np.sum(np.real(G) / (4 * Q ** 2 * np.sin(np.pi * r / Q) ** 2)))


def phos_weights(ell):
    """|c_l|^2 = sin^2(pi l/8)/(pi l)^2  (Fourier power of the duty-1/8 pulse), l != 0."""
    ell = np.asarray(ell, float)
    return np.sin(np.pi * ell / NPH) ** 2 / (np.pi ** 2 * ell ** 2)


def phos_eigs_harmonic(alpha: float, D=0, loop=None, H=None, h=None, M=4096, tail=True):
    """Eigenvalues of the (asymptotically circulant) 8x8 PHOS matrix:
        lambda_m = 8 * sum_{l = m mod 8, l != 0} |c_l|^2 Gamma(frac(l alpha)),  m = 0..7.
    lambda_0 = H(1)/8 = 0.  lambda_{8-m} = conj(lambda_m).  Returns complex array (8,)."""
    G = _gamma_callable(loop, H, h, D)
    lam = np.zeros(NPH, complex)
    mg = _mean_gamma(loop, H, h, D) if tail else 0.0
    for m in range(1, NPH):
        kmax = M // NPH + 1
        ell = np.concatenate([m + NPH * np.arange(0, kmax), m - NPH * np.arange(1, kmax + 1)])
        lam[m] = NPH * np.sum(phos_weights(ell) * G((ell * float(alpha)) % 1.0))
        if tail:
            # sum over |l| beyond the included ones:  l = m + 8k (k >= kmax) and l = m - 8k (k > kmax)
            s2 = np.sin(np.pi * m / NPH) ** 2 / np.pi ** 2
            t = (special.zeta(2, kmax + m / NPH) + special.zeta(2, kmax + 1 - m / NPH)) / NPH ** 2
            lam[m] += NPH * s2 * t * mg
    lam[0] = 0.0
    return lam


def phos_modes_rational(alpha, D=0, loop=None, H=None, h=None):
    """EXACT DFT-mode diagonal  lam_m = v_m^H C v_m  for rational alpha = P/Q (any Q):
        lam_m = (8 sin^2(pi m/8) / L^2) * sum_{k = m mod 8, 0<=k<L} Gamma(frac(kP/Q)) / sin^2(pi k/L),
    L = lcm(8, Q).  (Folded harmonic sum, using sum_i 1/(k+iL)^2 = pi^2/(L^2 sin^2(pi k/L)).)
    For 8 | Q (or irrational alpha) C_PHOS is circulant and these are its eigenvalues.
    Returns complex array (8,), lam_0 = 0 (k = 0 line carries Gamma(0) = H(1) = 0)."""
    fr = _as_fraction(alpha)
    if fr is None:
        fr = Fraction(alpha)
    P, Q = fr.numerator, fr.denominator
    Lc = NPH * Q // math.gcd(NPH, Q)
    G = _gamma_callable(loop, H, h, D)
    lam = np.zeros(NPH, complex)
    for m in range(1, NPH):
        k = np.arange(m, Lc, NPH)
        f = ((k * (P % Q)) % Q) / Q
        lam[m] = NPH * math.sin(math.pi * m / NPH) ** 2 / Lc ** 2 * np.sum(G(f) / np.sin(np.pi * k / Lc) ** 2)
    return lam


def phos_matrix_harmonic(alpha, D=0, loop=None, H=None, h=None, M=4096):
    """8x8 circulant C built from the harmonic eigenvalues (C = F^H diag(lambda) F / 8 ...)."""
    lam = phos_eigs_harmonic(alpha, D, loop, H, h, M)
    # C_ij = c(i-j),  c(d) = (1/8) sum_m lambda_m e^{j 2 pi m d / 8}
    d = np.arange(NPH)
    c = np.array([np.sum(lam * np.exp(2j * np.pi * np.arange(NPH) * dd / NPH)) / NPH for dd in d])
    C = np.array([[c[(i - j) % NPH] for j in range(NPH)] for i in range(NPH)])
    return C.real, lam


def joint_harmonic(alpha, D=0, loop=None, H=None, h=None, M=4096):
    """9x9 joint matrix in the ergodic (irrational / 8|Q) limit: block-diag(C_GOS, C_PHOS)
    because the line sets {8r alpha} (rho) and {l alpha, 8 does not divide l} (x_k) are disjoint."""
    cg = gos_harmonic(alpha, D, loop, H, h, M)
    Cp, lam = phos_matrix_harmonic(alpha, D, loop, H, h, M)
    C = np.zeros((9, 9))
    C[0, 0] = cg
    C[1:, 1:] = Cp
    return C, cg, lam


# =====================================================================
# 4.  Helpers: mode decomposition, eigen-analysis
# =====================================================================
def phos_modes_from_C(Cp: np.ndarray):
    """Project an 8x8 PHOS matrix on the DFT modes: lambda_m = v_m^H C v_m, v_m[i]=e^{j2pi m i/8}/sqrt8.
    For an exactly circulant C these are the eigenvalues."""
    i = np.arange(NPH)
    V = np.exp(2j * np.pi * np.outer(i, np.arange(NPH)) / NPH) / np.sqrt(NPH)
    return np.diag(V.conj().T @ Cp @ V)


def circulant_defect(Cp):
    """max |C_ij - c(i-j)| relative to max|C| (0 for an exactly circulant matrix)."""
    c = np.array([np.mean([Cp[(j + d) % NPH, j] for j in range(NPH)]) for d in range(NPH)])
    Cc = np.array([[c[(i - j) % NPH] for j in range(NPH)] for i in range(NPH)])
    return float(np.max(np.abs(Cp - Cc)) / max(np.max(np.abs(Cp)), 1e-300))


def mean_dynamics_ok(C, tol=1e-12):
    """Small-mu mean stability: all eigenvalues except structural zeros have Re > 0.
    Returns (ok, eigenvalues sorted by real part)."""
    ev = np.linalg.eigvals(C)
    ev = ev[np.argsort(ev.real)]
    scale = max(np.max(np.abs(ev)), 1e-300)
    nz = ev[np.abs(ev) > tol * scale]
    return bool(np.all(nz.real > 0)), ev


def K_q(sigma_v):
    """Comparator gain: E[sign(e+v)] = erf(e/(sqrt2 sigma)) ~ sqrt(2/pi) e / sigma."""
    return math.sqrt(2 / math.pi) / sigma_v


# =====================================================================
# 5.  Standard model set used for the sign maps
# =====================================================================
def standard_models(f_bw=F_BW, f_ref=F_REF, with_cppll=True):
    """Generic Type-I / Type-II H_PD built here (not imported from other folders)."""
    models = {}
    models['T1_lat1'] = make_type1(f_bw, f_ref, lat=1.0)
    models['T1_lat1.5'] = make_type1(f_bw, f_ref, lat=1.5)
    models['T1_lat2'] = make_type1(f_bw, f_ref, lat=2.0)
    models['T1_lat1_pole1G'] = make_type1(f_bw, f_ref, lat=1.0, f_pole=1e9)
    models['T1_lat1_pole500M'] = make_type1(f_bw, f_ref, lat=1.0, f_pole=500e6)
    for pm in (45.0, 60.0, 75.0):
        models[f'T2_pm{pm:g}_lat1'] = make_type2(f_bw, f_ref, lat=1.0, pm_target=pm)
    models['T2_pm60_lat1.5'] = make_type2(f_bw, f_ref, lat=1.5, pm_target=60.0)
    models['T2_pm60_lat2'] = make_type2(f_bw, f_ref, lat=2.0, pm_target=60.0)
    models['T2_pm60_lat1_pole1G'] = make_type2(f_bw, f_ref, lat=1.0, pm_target=60.0, f_pole=1e9)
    if with_cppll:
        models['CP_pm55'] = make_cppll(f_bw, f_ref, pm_target=55.0, tau=0.0)
        models['CP_pm55_tauHalf'] = make_cppll(f_bw, f_ref, pm_target=55.0, tau=0.5 / f_ref)
    return models
