#!/usr/bin/env python3
"""Independent loop builders for the math-lens challenge (do NOT import reconcile code).
All frequencies normalised to f_ref (=4 GHz).  x = z^-1 = exp(-j 2 pi f).
Each loop is returned as (num, den) of L(x) in ascending powers of x, plus params."""
import math
import numpy as np
from scipy import optimize

FREF = 4e9
BWN = 320e6 / FREF
TP = 2 * np.pi


def pev(c, x):
    c = np.asarray(c, float)
    return np.polyval(c[::-1], x)


def conv(*a):
    out = np.array([1.0])
    for b in a:
        out = np.convolve(out, np.asarray(b, float))
    return out


def padd(a, b):
    n = max(len(a), len(b))
    return np.pad(np.asarray(a, float), (0, n - len(a))) + np.pad(np.asarray(b, float), (0, n - len(b)))


class LP:
    def __init__(self, num, den, name='', **kw):
        self.num = np.asarray(num, float)
        self.den = np.asarray(den, float)
        self.name = name
        self.p = kw

    def L(self, f):
        x = np.exp(-1j * TP * np.asarray(f, float))
        return pev(self.num, x) / pev(self.den, x)

    def H(self, f):
        return 1.0 / (1.0 + self.L(f))

    def T(self, f):
        l = self.L(f)
        return l / (1 + l)

    def char(self):
        return padd(self.den, self.num)

    def stable(self):
        r = np.roots(self.char()[::-1])  # roots in z^-1 ... convert: char poly in x; poles z = 1/x_root
        # poles in z: polynomial in z of char(x=1/z) * z^n
        c = self.char()
        zp = np.roots(c)  # c[0] z^n + c[1] z^{n-1} ... = z^n * sum c_k z^-k
        return bool(np.all(np.abs(zp) < 1)), zp

    def f3db(self):
        f = np.linspace(1e-6, 0.5, 50001)
        t = np.abs(self.T(f))
        ii = np.nonzero(t < 2 ** -0.5)[0]
        if len(ii) == 0:
            return 0.5
        i = ii[0]
        return optimize.brentq(lambda q: abs(self.T(q)) - 2 ** -0.5, f[i - 1], f[i], xtol=1e-15)

    def pm(self):
        f = np.linspace(1e-6, 0.5, 200001)
        a = np.abs(self.L(f))
        i = np.nonzero(a < 1)[0][0]
        fc = optimize.brentq(lambda q: abs(self.L(q)) - 1, f[i - 1], f[i], xtol=1e-15)
        return fc, 180 + math.degrees(np.angle(self.L(fc)))  # principal value; fine when phase in (-180,0)

    def impulse_H(self, n):
        # H = den/(den+num) in x
        from scipy.signal import lfilter
        d = np.zeros(n); d[0] = 1
        return lfilter(self.den, self.char(), d)


def tune(builder, lo, hi):
    return optimize.brentq(lambda k: builder(k).f3db() - BWN, lo, hi, xtol=1e-15)


def L1(K=None, lat=1, fpole=None):
    def b(k):
        num = np.zeros(lat + 1); num[lat] = k
        den = [1.0, -1.0]
        if fpole is not None:
            p = math.exp(-TP * fpole / FREF)
            num = conv(num, [1 - p]); den = conv(den, [1, -p])
        return LP(num, den, 'L1', K=k, lat=lat, fpole=fpole)
    if K is None:
        # find bracket
        ks = np.geomspace(1e-3, 1.9, 400)
        v = []
        for k in ks:
            lp = b(k)
            st, _ = lp.stable()
            v.append(lp.f3db() - BWN if st else np.nan)
        v = np.array(v)
        i = np.nonzero((v[:-1] < 0) & (v[1:] >= 0))[0][0]
        K = tune(b, ks[i], ks[i + 1])
    return b(K)


def L2(pm=60.0, lat=1, Kp=None, Ki=None):
    def b2(kp, ki):
        num = conv(padd(kp * np.array([1.0, -1.0]), [ki]), np.r_[np.zeros(lat), 1.0])
        den = conv([1, -1], [1, -1])
        return LP(num, den, 'L2', Kp=kp, Ki=ki, lat=lat)
    if Kp is not None:
        return b2(Kp, Ki)

    def wn_for(z):
        ws = np.geomspace(1e-3, 1.0, 200)
        v = []
        for w in ws:
            lp = b2(2 * z * w, w * w)
            st, _ = lp.stable()
            v.append(lp.f3db() - BWN if st else np.nan)
        v = np.array(v)
        i = np.nonzero((v[:-1] < 0) & (v[1:] >= 0))[0][0]
        return optimize.brentq(lambda w: b2(2 * z * w, w * w).f3db() - BWN, ws[i], ws[i + 1], xtol=1e-15)

    def err(z):
        w = wn_for(z)
        return b2(2 * z * w, w * w).pm()[1] - pm
    z = optimize.brentq(err, 0.3, 2.5, xtol=1e-12)
    w = wn_for(z)
    lp = b2(2 * z * w, w * w)
    lp.p.update(zeta=z, wn=w)
    return lp


def L3(pm_ct=60.0, mapping='impulse', wc=None, b=None):
    """CPPLL L(s)=K(1+s/wz)/(s^2(1+s/wp)), wz=wc/sqrt b, wp=wc sqrt b, K=wc^2/sqrt b.
    impulse-invariant: L(z)=sum_{n>=0} l(nT) z^-n with l(t)=K t + B(1-e^{-wp t}), (l(0)=0)
    computed independently via partial fractions: L(s)=K/s^2 + B/s - B/(s+wp)."""
    if b is None:
        ph = math.radians(pm_ct)
        b = ((1 + math.sin(ph)) / math.cos(ph)) ** 2

    def bld(w):
        sb = math.sqrt(b)
        wz, wp = w / sb, w * sb
        K = w * w / sb
        # partial fractions of K(1+s/wz)/(s^2 (1+s/wp)) = K wp (1+s/wz)/(s^2 (s+wp))
        # = A2/s^2 + A1/s + A0/(s+wp)
        A2 = K
        A0 = K * wp * (1 - wp / wz) / wp ** 2  # residue at s=-wp: K wp(1 - wp/wz)/wp^2
        A1 = -A0
        p = math.exp(-wp)
        tau = {'impulse': 0.0, 'halfT': 0.5}[mapping]
        # l(t) = A2 t + A1 + A0 e^{-wp t}; sampled at t = n - tau, n >= 1 (l(0)=0 for tau=0)
        # sum_{n>=1} (A2 (n - tau) + A1 + A0 e^{wp tau} p^n) x^n
        # = A2 x/(1-x)^2 + (A1 - A2 tau) x/(1-x) + A0 e^{wp tau} p x/(1-p x)
        d1 = np.array([1.0, -1.0]); dp = np.array([1.0, -p])
        den = conv(d1, d1, dp)
        n1 = conv([0, A2], dp)
        n2 = conv([0, A1 - A2 * tau], d1, dp)
        n3 = conv([0, A0 * math.exp(wp * tau) * p], d1, d1)
        num = padd(padd(n1, n2), n3)
        return LP(num, den, 'L3' + mapping, b=b, wc=w, K=K, wz=wz, wp=wp, A1=A1, A0=A0, p=p)
    if wc is None:
        ws = np.geomspace(1e-2, 2.0, 300)
        v = []
        for w in ws:
            lp = bld(w)
            st, _ = lp.stable()
            v.append(lp.f3db() - BWN if st else np.nan)
        v = np.array(v)
        i = np.nonzero((v[:-1] < 0) & (v[1:] >= 0))[0][0]
        wc = optimize.brentq(lambda w: bld(w).f3db() - BWN, ws[i], ws[i + 1], xtol=1e-15)
    return bld(wc)


def neg_band(lp, n=400001):
    f = np.concatenate([np.geomspace(1e-9, 1e-3, 3000, endpoint=False), np.linspace(1e-3, 0.5, n)])
    g = lp.L(f).real + 1
    neg = g < 0
    out = []
    i = 0
    while i < len(f):
        if neg[i]:
            j = i
            while j + 1 < len(f) and neg[j + 1]:
                j += 1
            lo = 0.0 if i == 0 else optimize.brentq(lambda q: lp.L(q).real + 1, f[i - 1], f[i], xtol=1e-16)
            hi = 0.5 if j == len(f) - 1 else optimize.brentq(lambda q: lp.L(q).real + 1, f[j], f[j + 1], xtol=1e-16)
            h = lp.H(f[i:j + 1]).real
            k = int(np.argmin(h))
            out.append((lo, hi, h[k], f[i + k]))
            i = j + 1
        else:
            i += 1
    return out
