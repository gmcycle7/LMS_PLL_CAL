"""§8：Calibration Phase Margin、更新延遲與雙迴路耦合（T08、T09）。

Block-rate 一階模型：``G_k = K(a − w_k)``、``w_{k+1} = w_k + μG_k``，
``L_cal(z) = g/(z − 1)``，``g = μK``，閉迴路 Pole ``1 − g``。
"""

from __future__ import annotations

import math

import numpy as np
from scipy import optimize


# ---------------------------------------------------------------------------
# §8.2 一階 LMS 的 Phase Margin（T08）
# ---------------------------------------------------------------------------


def cal_pole(g: float) -> float:
    """閉迴路 Pole ``1 − g``。"""
    return 1.0 - g


def cal_pm_deg(g: float) -> float:
    """封閉式 ``PM_cal = 90° − asin(g/2)``，``0 < g ≤ 2``。"""
    if not 0.0 < g <= 2.0:
        raise ValueError('封閉式只對 0 < g ≤ 2 成立')
    return 90.0 - math.degrees(math.asin(g / 2.0))


def loop_gain(g: float, omega: float) -> complex:
    """``L_cal(e^{jω}) = g/(e^{jω} − 1)``。"""
    return g / (np.exp(1j * omega) - 1.0)


def cal_pm_numeric(g: float) -> tuple[float, float]:
    """數值求 unity-gain crossover ``|L(e^{jω_c})| = 1``，PM = 180° + ∠L(e^{jω_c})。

    回傳 ``(ω_c [rad/block], PM [deg])``。不使用封閉式，用來交叉驗證 ``cal_pm_deg``。
    """
    f = lambda w: abs(loop_gain(g, w)) - 1.0  # noqa: E731
    wc = optimize.brentq(f, 1e-12, math.pi, xtol=1e-15, rtol=1e-15, maxiter=500)
    pm = 180.0 + math.degrees(float(np.angle(loop_gain(g, wc))))
    return wc, pm


# ---------------------------------------------------------------------------
# §8.3 純延遲：δ_{k+1} = δ_k − g δ_{k−d}
# ---------------------------------------------------------------------------


def delay_char_poly(g: float, d: int) -> np.ndarray:
    """特徵多項式 ``z^{d+1} − z^d + g``（降冪係數）。"""
    p = np.zeros(d + 2)
    p[0] = 1.0
    p[1] = -1.0
    p[-1] += g
    return p


def delay_companion(g: float, d: int) -> np.ndarray:
    """狀態 ``[δ_k, δ_{k−1}, …, δ_{k−d}]`` 的 companion 矩陣。"""
    n = d + 1
    a = np.zeros((n, n))
    a[0, 0] = 1.0
    a[0, d] -= g
    for i in range(1, n):
        a[i, i - 1] = 1.0
    return a


def delay_spectral_radius(g: float, d: int) -> float:
    return float(np.max(np.abs(np.roots(delay_char_poly(g, d)))))


def delay_critical_gain_closed(d: int) -> float:
    """``g_crit = 2 sin(π/(4d+2))``（只對此特定特徵方程成立）。"""
    return 2.0 * math.sin(math.pi / (4 * d + 2))


def delay_critical_gain_numeric(d: int, g_max: float = 2.5, grid: int = 5000) -> float:
    """以掃描 + brentq 求最小的 g > 0 使 spectral radius = 1（不使用封閉式）。"""
    gs = np.linspace(g_max / grid, g_max, grid)
    rho = np.array([delay_spectral_radius(g, d) for g in gs])
    idx = int(np.argmax(rho >= 1.0))
    if rho[idx] < 1.0:
        raise RuntimeError('在掃描範圍內找不到臨界增益')
    lo = gs[idx - 1] if idx > 0 else gs[0] / 2
    return optimize.brentq(lambda g: delay_spectral_radius(g, d) - 1.0, lo, gs[idx], xtol=1e-14, rtol=1e-14)


def simulate_delay_recursion(g: float, d: int, steps: int, delta0: float = 1.0) -> np.ndarray:
    """時域執行 ``δ_{k+1} = δ_k − g δ_{k−d}``；k<0 時 δ = δ0（常數歷史）。"""
    hist = [delta0] * (d + 1)
    out = np.empty(steps + 1)
    out[0] = delta0
    for k in range(steps):
        nxt = hist[-1] - g * hist[-1 - d]
        hist.append(nxt)
        out[k + 1] = nxt
    return out


# ---------------------------------------------------------------------------
# §8.4 雙迴路耦合（T09）
# ---------------------------------------------------------------------------


def dual_loop_matrix(r: float, b: float, c: float, mu: float) -> np.ndarray:
    """``[s; δ]_{k+1} = [[r, b], [−μc, 1]]·[s; δ]_k``。"""
    return np.array([[r, b], [-mu * c, 1.0]])


def dual_loop_char_poly(r: float, b: float, c: float, mu: float) -> np.ndarray:
    """``z² − (1+r)z + (r + μbc)``。"""
    return np.array([1.0, -(1.0 + r), r + mu * b * c])


def spectral_radius(a: np.ndarray) -> float:
    return float(np.max(np.abs(np.linalg.eigvals(a))))


def dual_loop_simplified_mu_max(r: float, b: float, c: float) -> float:
    """時間尺度分離（假設 s 已穩態 ``s = bδ/(1−r)``）⇒ ``δ_{k+1} = (1 − μcb/(1−r))δ_k``，上限 ``2(1−r)/(bc)``。"""
    return 2.0 * (1.0 - r) / (b * c)


def dual_loop_full_mu_range_closed(r: float, b: float, c: float) -> tuple[float, float]:
    """完整 2×2 模型的 Jury 條件（bc > 0、|r| < 1）：

    ``P(1) = μbc > 0``、``P(−1) = 2 + 2r + μbc > 0``、``|r + μbc| < 1`` ⇒
    ``max(0, −(1+r)/(bc)) < μ < (1−r)/(bc)``。
    """
    if b * c <= 0:
        raise ValueError('此封閉式假設 bc > 0')
    lo = max(0.0, -(1.0 + r) / (b * c))
    hi = (1.0 - r) / (b * c)
    return lo, hi


def stable_interval_numeric(rho_fn, mu_lo: float, mu_hi: float, grid: int = 4001) -> tuple[float, float]:
    """在 [mu_lo, mu_hi] 掃描找 ρ(μ) < 1 的連續區間，並以 brentq 精修兩端。"""
    mus = np.linspace(mu_lo, mu_hi, grid)
    rho = np.array([rho_fn(m) for m in mus])
    stable = rho < 1.0
    if not stable.any():
        raise RuntimeError('掃描範圍內沒有穩定點')
    i0 = int(np.argmax(stable))
    i1 = i0
    while i1 + 1 < grid and stable[i1 + 1]:
        i1 += 1

    def refine(a: float, b: float) -> float:
        return optimize.brentq(lambda m: rho_fn(m) - 1.0, a, b, xtol=1e-13, rtol=1e-13)

    left = refine(mus[i0 - 1], mus[i0]) if i0 > 0 else mus[0]
    right = refine(mus[i1], mus[i1 + 1]) if i1 + 1 < grid else mus[-1]
    return left, right


def combined_matrix(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: float, mu: float) -> np.ndarray:
    """一般化 ``A_combined = [[A, B], [−μC, 1 − μD]]``。"""
    a = np.atleast_2d(a)
    n = a.shape[0]
    top = np.hstack([a, np.reshape(b, (n, 1))])
    bot = np.hstack([-mu * np.reshape(c, (1, n)), np.array([[1.0 - mu * d]])])
    return np.vstack([top, bot])
