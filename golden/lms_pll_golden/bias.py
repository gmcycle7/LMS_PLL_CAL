"""§11：GMAC 歸零不代表 DTC Error 為零（T12）。

總誤差模型 ``e[n] = (a − w)x[n] + b + d(x[n]) + u[n] + v[n]``。
小誤差、Gaussian 主導時 Sign-LMS 固定點近似：

    w* = a + (b E[x] + E[x d(x)] + E[x u]) / E[x²]
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from scipy import optimize, special

SQRT2 = math.sqrt(2.0)


def discrete_moment(values: np.ndarray, probs: np.ndarray, k: int) -> float:
    """離散分布 ``E[x^k]``。"""
    return float(np.sum(probs * values**k))


def wstar_linearized(
    a: float,
    values: np.ndarray,
    probs: np.ndarray,
    b: float = 0.0,
    d_fn: Callable[[np.ndarray], np.ndarray] | None = None,
    u_corr: float = 0.0,
) -> float:
    """``w* = a + (bE[x] + E[x d(x)] + E[xu]) / E[x²]``（``u_corr`` 直接給 E[xu]）。"""
    ex = discrete_moment(values, probs, 1)
    ex2 = discrete_moment(values, probs, 2)
    exd = float(np.sum(probs * values * d_fn(values))) if d_fn is not None else 0.0
    return a + (b * ex + exd + u_corr) / ex2


def wstar_cubic(a: float, c: float, values: np.ndarray, probs: np.ndarray) -> float:
    """§11.2 ``e = (a−w)x + cx³`` ⇒ ``w* = a + c E[x⁴]/E[x²]``。"""
    return a + c * discrete_moment(values, probs, 4) / discrete_moment(values, probs, 2)


def least_squares_gain(x: np.ndarray, y: np.ndarray, weights: np.ndarray | None = None) -> float:
    """過原點最小平方 ``argmin_w Σ p (y − w x)²`` = ``Σ p x y / Σ p x²``（獨立於上式的數值路徑）。"""
    wts = np.ones_like(x) if weights is None else weights
    sw = np.sqrt(wts)
    sol, *_ = np.linalg.lstsq((sw * x)[:, None], sw * y, rcond=None)
    return float(sol[0])


def sign_lms_mean_gmac(
    w: float,
    a: float,
    values: np.ndarray,
    probs: np.ndarray,
    sigma: float,
    d_fn: Callable[[np.ndarray], np.ndarray] | None = None,
    b: float = 0.0,
    encoding: str = 'bipolar',
) -> float:
    """精確平均 GMAC ``E[q·x]``，``q = sign(e + v)``、``v ~ N(0, σ²)``：``E[q|x] = erf(e/(√2σ))``。

    ``encoding='unipolar'`` 模擬錯誤地把硬體位元 ``b ∈ {0,1}`` 直接當 q：``E[b|x] = Φ(e/σ)``。
    """
    e = (a - w) * values + b + (d_fn(values) if d_fn is not None else 0.0)
    if encoding == 'bipolar':
        eq = special.erf(e / (SQRT2 * sigma))
    elif encoding == 'unipolar':
        eq = special.ndtr(e / sigma)
    else:
        raise ValueError(f'unknown encoding {encoding!r}')
    return float(np.sum(probs * values * eq))


def sign_lms_fixed_point(
    a: float,
    values: np.ndarray,
    probs: np.ndarray,
    sigma: float,
    d_fn: Callable[[np.ndarray], np.ndarray] | None = None,
    b: float = 0.0,
    bracket: tuple[float, float] = (-1e3, 1e3),
    encoding: str = 'bipolar',
) -> float:
    """解 ``E[sign(e+v)·x] = 0``（Sign-Error LMS 的確切平均固定點，有限 σ）。"""
    f = lambda w: sign_lms_mean_gmac(w, a, values, probs, sigma, d_fn, b, encoding)  # noqa: E731
    return optimize.brentq(f, bracket[0], bracket[1], xtol=1e-14, rtol=1e-14, maxiter=500)


def offset_gain_bias(b: float, ex: float, ex2: float) -> float:
    """§11.1 Comparator offset 造成的假 Gain Bias ``w* − a = b E[x]/E[x²]``。"""
    return b * ex / ex2


def simulate_block_sign_lms_discrete(
    rng: np.random.Generator,
    a: float,
    values: np.ndarray,
    probs: np.ndarray,
    sigma: float,
    mu: float,
    n: int,
    blocks: int,
    w0: float,
    d_fn: Callable[[np.ndarray], np.ndarray] | None = None,
    encoding: str = 'bipolar',
) -> np.ndarray:
    """逐樣本 Block Sign-LMS（§15.2 偽程式），x 從離散分布抽樣；回傳每個 block 後的 w。"""
    w = w0
    out = np.empty(blocks + 1)
    out[0] = w
    for k in range(blocks):
        x = rng.choice(values, size=n, p=probs)
        e = (a - w) * x + (d_fn(x) if d_fn is not None else 0.0) + sigma * rng.standard_normal(n)
        bit = (e >= 0.0).astype(float)
        q = 2.0 * bit - 1.0 if encoding == 'bipolar' else bit
        w = w + mu * float(np.mean(q * x))
        out[k + 1] = w
    return out
