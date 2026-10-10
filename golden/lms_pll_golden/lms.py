"""§1–§3：純量 LMS、Sign-Error LMS 與 Mean / Mean-Square 穩定界限。

符號約定（規格 §0）：``y = a·x``，``e = y − w·x``，LMS 更新 ``w ← w + μ·e·x``。
§3 使用 ``δ_n = w_n − a``（與 §0 的 ``δ = a − w`` 極性相反）；兩者 Pole 相同。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


# ---------------------------------------------------------------------------
# §1.2 手算例子（T01）
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LmsTrace:
    """無雜訊、固定 x 的 LMS 軌跡。``w`` 長度 steps+1，``e`` 長度 steps。"""

    w: np.ndarray
    e: np.ndarray


def lms_trace(a: float, w0: float, x: float, mu: float, steps: int) -> LmsTrace:
    """逐步執行 ``w_{n+1} = w_n + μ e_n x``，``e_n = a·x − w_n·x``（無雜訊、固定 x）。"""
    w = np.empty(steps + 1)
    e = np.empty(steps)
    w[0] = w0
    for n in range(steps):
        e[n] = a * x - w[n] * x
        w[n + 1] = w[n] + mu * e[n] * x
    return LmsTrace(w=w, e=e)


def lms_closed_form(a: float, w0: float, x: float, mu: float, n: int) -> float:
    """封閉解 ``w_n = a + (w0 − a)·p^n``，``p = 1 − μx²``。"""
    p = fixed_x_pole(mu, x)
    return a + (w0 - a) * p**n


def sign_error_lms_trace(a: float, w0: float, x: float, mu: float, steps: int) -> np.ndarray:
    """Sign-Error LMS：``w_{n+1} = w_n + μ·sign(e_n)·x``（§2.2）。sign(0) 取 0（次梯度）。"""
    w = np.empty(steps + 1)
    w[0] = w0
    for n in range(steps):
        e = a * x - w[n] * x
        w[n + 1] = w[n] + mu * float(np.sign(e)) * x
    return w


# ---------------------------------------------------------------------------
# §2 MSE vs MAE：常數估計
# ---------------------------------------------------------------------------


def l2_constant_fit(y: np.ndarray) -> float:
    """最小平方常數擬合 = 平均值。"""
    return float(np.mean(y))


def l1_constant_fit(y: np.ndarray) -> float:
    """最小絕對值常數擬合 = 中位數（偶數筆時取中間兩筆的平均；若兩者相同則唯一）。"""
    return float(np.median(y))


# ---------------------------------------------------------------------------
# §3 固定 x 的確切穩定界限（T02）
# ---------------------------------------------------------------------------


def fixed_x_pole(mu: float, x: float) -> float:
    """離散 Pole ``p = 1 − μx²``。"""
    return 1.0 - mu * x * x


def fixed_x_mu_bound(x: float) -> float:
    """``|p| < 1 ⇔ 0 < μ < 2/x²``；回傳上限 2/x²。"""
    if x == 0:
        raise ValueError('x = 0：沒有激勵，任何 μ 都不會改變 w（不可辨識）')
    return 2.0 / (x * x)


def classify_pole(p: float, tol: float = 0.0) -> str:
    """依 §3 分類：monotone / oscillatory / one-step / marginal / divergent。"""
    if abs(p) > 1 + tol:
        return 'divergent'
    if abs(abs(p) - 1) <= tol:
        return 'marginal'
    if abs(p) <= tol:
        return 'one-step'
    return 'monotone' if p > 0 else 'oscillatory'


# ---------------------------------------------------------------------------
# §3.1 隨機輸入：Mean 與 Mean-Square（T03）
# ---------------------------------------------------------------------------


def mean_mu_bound(ex2: float) -> float:
    """平均收斂：``0 < μ < 2/E[x²]``（iid、獨立性假設）。"""
    return 2.0 / ex2


def mean_square_mu_bound(ex2: float, ex4: float) -> float:
    """均方收斂（無量測雜訊）：``0 < μ < 2E[x²]/E[x⁴]``。"""
    return 2.0 * ex2 / ex4


def mean_square_factor(mu: float, ex2: float, ex4: float) -> float:
    """``E[(1 − μx²)²] = 1 − 2μE[x²] + μ²E[x⁴]``；< 1 才是均方收斂。"""
    return 1.0 - 2.0 * mu * ex2 + mu * mu * ex4


def gaussian_moments(sigma: float = 1.0) -> tuple[float, float]:
    """``x ~ N(0, σ²)``：E[x²] = σ²，E[x⁴] = 3σ⁴。"""
    return sigma**2, 3.0 * sigma**4


def mc_moments(samples: np.ndarray) -> dict[str, float]:
    """Monte Carlo 估計 E[x²]、E[x⁴] 及其標準誤（以樣本 iid 計算）。"""
    x2 = samples**2
    x4 = x2**2
    n = samples.size
    return {
        'ex2': float(x2.mean()),
        'ex4': float(x4.mean()),
        'se_ex2': float(x2.std(ddof=1) / math.sqrt(n)),
        'se_ex4': float(x4.std(ddof=1) / math.sqrt(n)),
    }


def mc_mean_square_factor(rng: np.random.Generator, mu: float, n: int, sampler: str = 'gaussian') -> tuple[float, float]:
    """以 MC 估 ``E[(1−μx²)²]``，回傳 (估計值, 標準誤)。

    單步遞迴 ``E[δ²_{n+1}] = E[(1−μx²)²]·E[δ²_n]`` 在 x_n 與 δ_n 獨立時精確成立，
    因此只需估計這個比例因子；直接追蹤 δ² 的樣本平均會被稀有大值主導，不適合當測試。
    """
    x = draw_regressor(rng, n, sampler)
    f = (1.0 - mu * x * x) ** 2
    return float(f.mean()), float(f.std(ddof=1) / math.sqrt(n))


def draw_regressor(rng: np.random.Generator, n: int, sampler: str) -> np.ndarray:
    """產生單位功率（E[x²]=1）的 regressor：gaussian / bpsk(±1) / uniform。"""
    if sampler == 'gaussian':
        return rng.standard_normal(n)
    if sampler == 'bpsk':
        return rng.choice(np.array([-1.0, 1.0]), size=n)
    if sampler == 'uniform':
        return rng.uniform(-math.sqrt(3.0), math.sqrt(3.0), size=n)
    raise ValueError(f'unknown sampler {sampler!r}')


REGRESSOR_MOMENTS: dict[str, tuple[float, float]] = {
    # (E[x²], E[x⁴])，皆為單位功率
    'gaussian': (1.0, 3.0),
    'bpsk': (1.0, 1.0),
    'uniform': (1.0, 9.0 / 5.0),
}
