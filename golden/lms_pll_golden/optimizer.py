"""§14：Learning Rate、Accumulation Length 與 Corner-Based 可行區間。

單參數、近鎖定、Block noise iid：``δ_{k+1} = p δ_k + μ η_k``、``p = 1 − g``、``g = μK``：

    E[δ_B²] = δ0² p^{2B} + μ² σ_η² (1 − p^{2B}) / (1 − p²)

（δ0 為確定初值時，對線性 Gaussian 模型是精確式。）
"""

from __future__ import annotations

import math

import numpy as np
from scipy import optimize


def msd_after_blocks(delta0: float, p: float, mu: float, sigma_eta2: float, blocks: int | np.ndarray) -> np.ndarray:
    """§14 ``E[δ_B²]``。"""
    b = np.asarray(blocks, dtype=float)
    p2b = p ** (2.0 * b)
    return delta0 * delta0 * p2b + mu * mu * sigma_eta2 * (1.0 - p2b) / (1.0 - p * p)


def simulate_linear_msd(
    rng: np.random.Generator, delta0: float, p: float, mu: float, sigma_eta2: float, blocks: int, chains: int
) -> np.ndarray:
    """MC：``δ_{k+1} = pδ_k + μη_k``、``η ~ N(0, σ_η²)``；回傳 shape (blocks+1, chains) 的 δ。"""
    out = np.empty((blocks + 1, chains))
    out[0] = delta0
    s = math.sqrt(sigma_eta2)
    for k in range(blocks):
        out[k + 1] = p * out[k] + mu * s * rng.standard_normal(chains)
    return out


def mu_interval_corner(k_min: float, k_max: float, eps: float, blocks: int) -> tuple[float, float]:
    """§14.1 ``(1 − ε^{1/B})/K_min ≤ μ ≤ 1/K_max``；lo > hi 代表沒有交集。"""
    lo = (1.0 - eps ** (1.0 / blocks)) / k_min
    hi = 1.0 / k_max
    return lo, hi


def optimal_mu_final_rms(delta0: float, k: float, sigma_eta2: float, blocks: int) -> tuple[float, float]:
    """在 0 < μK < 1（無振盪、PM ≥ 60°）內最小化 ``E[δ_B²]``；回傳 (μ_opt, E[δ_B²]_min)。"""

    def f(mu: float) -> float:
        return float(msd_after_blocks(delta0, 1.0 - mu * k, mu, sigma_eta2, blocks))

    res = optimize.minimize_scalar(f, bounds=(1e-12 / k, 1.0 / k), method='bounded', options={'xatol': 1e-12 / k})
    return float(res.x), float(res.fun)


def optimal_budget_split(
    delta0: float, k_per_unit_mu: float, total_samples: int, n_choices: list[int]
) -> list[dict[str, float]]:
    """固定總樣本 ``NB``：對每個 N（σ_η² = 1/N、B = NB/N）求最佳 μ 與最終 MSD。

    ``k_per_unit_mu`` 即 K（g = μK）。回傳每個 N 的 {N, B, mu_opt, msd}。
    """
    rows = []
    for n in n_choices:
        b = total_samples // n
        mu, msd = optimal_mu_final_rms(delta0, k_per_unit_mu, 1.0 / n, b)
        rows.append({'N': float(n), 'B': float(b), 'mu_opt': mu, 'msd': msd})
    return rows
