"""§11 延伸（Ch11b）：DTC INL 校正——分段／LUT／多項式基底的多參數 LMS，以及 INL 的噪聲折返。

與 ``src/simulation/models/dtcInl.ts`` 同一個模型（正規化 code x ∈ [−1, 1]）：

    e[n] = (a − w)·x[n] + b + d(x[n]) − c(x[n]) + v[n],   c(x) = Σ_i θ_i φ_i(x)

- 噪聲折返（Gaussian–Isserlis）：零均值 Gaussian x 的 Hermite 分量 He_p 的自相關是 p!·R_x[m]^p，
  所以 x² − σ² 在 DC 的 PSD 為 2ΣR², x³ − 3σ²x 為 6ΣR³；帶內功率 = S(0)·2ν_B。
- 線性過程（iid u 經 FIR h）的精確式：S_2(0) = 2ΣR² + κ_4(Σh²)²（κ_4 = u 的四階累積量）。
  MASH 1-1-1 的 residue r = −(1 − z⁻¹)²·s_3/M，s_3/M 視為 iid uniform(0, 1)：R_r = (1/12)[6, −4, 1]；
  正規化 x = r/2 ⇒ h = [−½, 1, −½]、R_x = (1/48)[6, −4, 1]、κ_4 = −1/120。
- 多參數 block Sign-LMS 的小訊號 mean-field：pole_i = 1 − μK_qλ_i、k95_i = ⌈ln 0.05/ln|p_i|⌉、
  Var(ξ_i) = μ²λ_i/(N(1 − p_i²))（λ_i 是 R = E[ψψᵀ] 的特徵值）。
- uniform x 的封閉式：分段 λ_k = (x_{k+1}³ − x_k³)/6；LUT λ_j = 1/J；monomial Hankel R_mn = 1/(m+n+1)（m+n 偶）；
  Legendre diag 1/(2m+1)；normalized Legendre I；Chebyshev 以多項式精確積分。
- LUT 每格一個常數的近似誤差：rms² = E[d′(x)²]Δ²/12，Δ = 2/J。
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from numpy.polynomial import chebyshev as C
from numpy.polynomial import legendre as Lg
from numpy.polynomial import polynomial as Poly

SQRT_2_OVER_PI = math.sqrt(2.0 / math.pi)
DECAY_95 = 0.05

MASH_RESIDUE_AUTOCORR = np.array([6.0, -4.0, 1.0]) / 12.0
MASH_CODE_AUTOCORR = MASH_RESIDUE_AUTOCORR / 4.0
MASH_CODE_FIR = np.array([-0.5, 1.0, -0.5])
UNIFORM_KAPPA4 = 1.0 / 80.0 - 3.0 / 144.0
UNIFORM_CODE_AUTOCORR = np.array([1.0 / 3.0])


# ───────────────────────── INL 形狀 ─────────────────────────


def inl_value(x: np.ndarray, d2: float = 0.0, d3: float = 0.0, saw_amp: float = 0.0, saw_segments: int = 8) -> np.ndarray:
    """d(x) = d_2x² + d_3x³ + A_s·saw_K(x)（每段從 −A_s 線性升到 +A_s；x = 1 歸到最後一段的頂）。"""
    x = np.asarray(x, dtype=float)
    d = d2 * x**2 + d3 * x**3
    if saw_amp != 0.0 and saw_segments >= 1:
        u = (x + 1.0) / 2.0 * saw_segments
        frac = u - np.floor(u)
        frac = np.where(x >= 1.0, 1.0, frac)
        d = d + saw_amp * (2.0 * frac - 1.0)
    return d


# ───────────────────────── 噪聲折返 ─────────────────────────


def kq(sigma_v: float) -> float:
    return SQRT_2_OVER_PI / sigma_v


def folded_psd_dc(R: np.ndarray, p: int) -> float:
    """Gaussian：He_p 分量在 DC 的 PSD = p!·Σ_m R[m]^p（R 給 0..L，對稱）。"""
    R = np.asarray(R, dtype=float)
    s = R[0] ** p + 2.0 * np.sum(R[1:] ** p)
    return float(math.factorial(p) * s)


def folded_psd_dc_linear_process(R: np.ndarray, h: np.ndarray, kappa4: float) -> float:
    """線性過程 x = Σ h_k u[n−k]（u iid，四階累積量 κ_4）：S_2(0) = 2ΣR² + κ_4(Σh²)²。"""
    h2 = float(np.sum(np.asarray(h, dtype=float) ** 2))
    return folded_psd_dc(R, 2) + kappa4 * h2 * h2


def iid_squared_psd_dc(ex4: float, sigma2: float) -> float:
    """iid x：x² − σ² 的 PSD 平坦，位準 = Var(x²) = E[x⁴] − σ⁴。"""
    return ex4 - sigma2 * sigma2


def inband_power(s0: float, nu_b: float) -> float:
    return s0 * 2.0 * nu_b


def folding_prediction(R: np.ndarray, d2: float, d3: float, nu_b: float) -> dict[str, float]:
    sigma2 = float(R[0])
    s2 = d2 * d2 * folded_psd_dc(R, 2)
    s3 = d3 * d3 * folded_psd_dc(R, 3)
    residual_power = 2.0 * d2**2 * sigma2**2 + 6.0 * d3**2 * sigma2**3
    pin = inband_power(s2 + s3, nu_b)
    return {
        'sigma2': sigma2,
        'gain_absorbed': 3.0 * d3 * sigma2,
        'residual_power': residual_power,
        'S2': s2,
        'S3': s3,
        'Pin': pin,
        'rms_in': math.sqrt(pin),
        'inband_fraction': pin / residual_power if residual_power > 0 else 0.0,
    }


def mash111_residue(frac: float, bits: int, length: int) -> np.ndarray:
    """理想 MASH 1-1-1（與 dsm.ts 相同：零初值、無 dither）的 phase residue [T_vco]：Σ(y − K/M)。"""
    M = 1 << bits
    K = int(round(frac * M))
    s1 = s2 = s3 = 0
    c2p = c3p = c3pp = 0
    r_int = 0
    out = np.empty(length)
    for n in range(length):
        t = s1 + K
        c1 = 1 if t >= M else 0
        s1 = t - M * c1
        t2 = s2 + s1
        c2 = 1 if t2 >= M else 0
        s2 = t2 - M * c2
        t3 = s3 + s2
        c3 = 1 if t3 >= M else 0
        s3 = t3 - M * c3
        y = c1 + (c2 - c2p) + (c3 - 2 * c3p + c3pp)
        c2p, c3pp, c3p = c2, c3p, c3
        r_int += M * y - K
        out[n] = r_int / M
    return out


def autocovariance(x: np.ndarray, max_lag: int) -> np.ndarray:
    """去平均、除以 n 的樣本自相關 R̂[0..max_lag]。"""
    x = np.asarray(x, dtype=float)
    xc = x - x.mean()
    n = xc.size
    return np.array([float(np.dot(xc[lag:], xc[: n - lag])) / n for lag in range(max_lag + 1)])


# ───────────────────────── 分段／LUT 的封閉式（uniform x） ─────────────────────────


def segment_bounds(k: int, K: int) -> tuple[float, float]:
    return -1.0 + 2.0 * k / K, -1.0 + 2.0 * (k + 1) / K


def segment_lambda_uniform(k: int, K: int) -> float:
    lo, hi = segment_bounds(k, K)
    return (hi**3 - lo**3) / 6.0


def pole_k95(pole: float) -> float:
    return math.ceil(math.log(DECAY_95) / math.log(abs(pole))) if 0 < abs(pole) < 1 else math.inf


def segment_closed_form(k: int, K: int, mu: float, sigma_v: float, N: int) -> dict[str, float]:
    lam = segment_lambda_uniform(k, K)
    k_q = kq(sigma_v)
    g = mu * k_q * lam
    pole = 1.0 - g
    var_w = mu * mu * lam / (N * (1.0 - pole * pole)) if abs(pole) < 1 else math.nan
    return {'lambda': lam, 'Kq': k_q, 'g': g, 'pole': pole, 'tau': 1.0 / g if g > 0 else math.inf, 'k95': pole_k95(pole), 'var_w': var_w, 'std_w': math.sqrt(var_w)}


def lut_closed_form(J: int, mu: float, sigma_v: float, N: int) -> dict[str, float]:
    pj = 1.0 / J
    k_q = kq(sigma_v)
    g = mu * k_q * pj
    pole = 1.0 - g
    var_t = mu * mu * pj / (N * (1.0 - pole * pole)) if abs(pole) < 1 else math.nan
    return {
        'pj': pj,
        'Kq': k_q,
        'g': g,
        'pole': pole,
        'tau': 1.0 / g if g > 0 else math.inf,
        'k95': pole_k95(pole),
        'samples_per_bin_per_tau': N / (mu * k_q),
        'effective_samples': 2.0 * N / (mu * k_q),
        'var_theta': var_t,
        'std_theta': math.sqrt(var_t),
    }


def lut_approx_rms(d2: float, d3: float, J: int) -> float:
    """每格一個常數：rms² = E[d′²]Δ²/12，E[d′²] = 4d_2²/3 + 9d_3²/5（uniform x）。"""
    delta = 2.0 / J
    ed2 = 4.0 * d2**2 / 3.0 + 9.0 * d3**2 / 5.0
    return delta * math.sqrt(ed2 / 12.0)


def lut_residual_numeric(d_fn: Callable[[np.ndarray], np.ndarray], J: int, n: int = 200_000) -> float:
    """直接算：每格存格內平均，殘差 rms（uniform x 的細格點）。"""
    x = -1.0 + (np.arange(n) + 0.5) * (2.0 / n)
    d = d_fn(x)
    idx = np.minimum((((x + 1.0) / 2.0) * J).astype(int), J - 1)
    means = np.bincount(idx, weights=d, minlength=J) / np.bincount(idx, minlength=J)
    return float(np.sqrt(np.mean((d - means[idx]) ** 2)))


# ───────────────────────── 多項式基底（uniform x） ─────────────────────────


def basis_poly_coeffs(kind: str, m: int) -> np.ndarray:
    """第 m 階基底函數的一般多項式係數（升冪）。"""
    if kind == 'monomial':
        c = np.zeros(m + 1)
        c[m] = 1.0
        return c
    e = np.zeros(m + 1)
    e[m] = 1.0
    if kind == 'legendre':
        return Lg.leg2poly(e)
    if kind == 'legendre_norm':
        return math.sqrt(2 * m + 1) * Lg.leg2poly(e)
    if kind == 'chebyshev':
        return C.cheb2poly(e)
    raise ValueError(kind)


def uniform_inner(p: np.ndarray, q: np.ndarray) -> float:
    """E[p(x)q(x)]，x ~ U(−1, 1)：多項式乘積精確積分 ÷ 2。"""
    prod = Poly.polymul(p, q)
    integ = Poly.polyint(prod)
    return float((Poly.polyval(1.0, integ) - Poly.polyval(-1.0, integ)) / 2.0)


def uniform_moment_matrix(kind: str, M: int) -> np.ndarray:
    coeffs = [basis_poly_coeffs(kind, m) for m in range(M + 1)]
    R = np.empty((M + 1, M + 1))
    for i in range(M + 1):
        for j in range(M + 1):
            R[i, j] = uniform_inner(coeffs[i], coeffs[j])
    return R


def hankel_from_moments(m2: float, m4: float, m6: float) -> np.ndarray:
    return np.array([[1.0, 0.0, m2, 0.0], [0.0, m2, 0.0, m4], [m2, 0.0, m4, 0.0], [0.0, m4, 0.0, m6]])


def eig2(a: float, b: float, d: float) -> tuple[float, float]:
    tr = a + d
    det = a * d - b * b
    disc = math.sqrt(max(0.0, tr * tr - 4.0 * det))
    return (tr + disc) / 2.0, (tr - disc) / 2.0


def eig_desc(R: np.ndarray) -> np.ndarray:
    return np.sort(np.linalg.eigvalsh(R))[::-1]


def cond_number(R: np.ndarray) -> float:
    s = np.linalg.svd(R, compute_uv=False)
    return float(s[0] / s[-1]) if s[-1] > 0 else math.inf


def uniform_projection(kind: str, M: int, d2: float, d3: float) -> np.ndarray:
    """p_m = E[φ_m(x) d(x)]（d = d_2x² + d_3x³，精確多項式積分）。"""
    d = np.array([0.0, 0.0, d2, d3])
    return np.array([uniform_inner(basis_poly_coeffs(kind, m), d) for m in range(M + 1)])


def ls_theta(R: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.linalg.solve(R, p)


def mode_analysis(R: np.ndarray, k_q: float, mu: float, N: int) -> dict[str, np.ndarray | float]:
    lam = eig_desc(R)
    poles = 1.0 - mu * k_q * lam
    k95 = np.array([pole_k95(p) for p in poles])
    var = mu * mu * lam / (N * (1.0 - poles**2))
    return {'lambdas': lam, 'poles': poles, 'k95': k95, 'mode_var': var, 'cond': float(lam[0] / lam[-1]) if lam[-1] > 0 else math.inf}


def mean_field_k95(R: np.ndarray, delta0: np.ndarray, k_q: float, mu: float, max_blocks: int = 100_000) -> int:
    """δ_{b+1} = (I − μK_qR)δ_b；δᵀRδ 降到初值的 0.05² 的 block。"""
    A = np.eye(R.shape[0]) - mu * k_q * R
    d = np.asarray(delta0, dtype=float)
    q0 = float(d @ R @ d)
    for b in range(max_blocks + 1):
        if float(d @ R @ d) <= DECAY_95**2 * q0:
            return b
        d = A @ d
    return -1


def simulate_lut_sign_lms(rng: np.random.Generator, d_fn: Callable[[np.ndarray], np.ndarray], J: int, mu: float, sigma_v: float, N: int, blocks: int) -> np.ndarray:
    """LUT（J 格、uniform iid x）的 block Sign-LMS：θ_j ← θ_j + μ·(1/N)Σ q·1_j。回傳每個 block 之後的殘餘 INL rms（uniform 格點）。"""
    theta = np.zeros(J)
    grid = -1.0 + (np.arange(2000) + 0.5) / 1000.0
    gidx = np.minimum((((grid + 1.0) / 2.0) * J).astype(int), J - 1)
    dg = d_fn(grid)
    out = np.empty(blocks + 1)
    out[0] = float(np.sqrt(np.mean((dg - theta[gidx]) ** 2)))
    for b in range(blocks):
        x = rng.uniform(-1.0, 1.0, N)
        idx = np.minimum((((x + 1.0) / 2.0) * J).astype(int), J - 1)
        e = d_fn(x) - theta[idx] + sigma_v * rng.standard_normal(N)
        q = np.where(e >= 0, 1.0, -1.0)
        theta += mu * np.bincount(idx, weights=q, minlength=J) / N
        out[b + 1] = float(np.sqrt(np.mean((dg - theta[gidx]) ** 2)))
    return out
