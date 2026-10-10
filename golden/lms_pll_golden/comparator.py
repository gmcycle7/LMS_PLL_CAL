"""§5：1-bit Comparator 在 Gaussian 雜訊下的統計（T04、T05）。

模型：``e = s + v``，``v ~ N(0, σ_v²)``，``q = sign(e) ∈ {+1, −1}``。
硬體若輸出 0/1 位元 b，必須先映射 ``q = 2b − 1``。
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special, stats

SQRT2 = math.sqrt(2.0)


def p_plus(s: float, sigma: float) -> float:
    """``P(q = +1) = Φ(s/σ_v)``。"""
    return float(special.ndtr(s / sigma))


def mean_q(s: float, sigma: float) -> float:
    """``E[q] = 2Φ(s/σ_v) − 1 = erf(s/(√2 σ_v))``。"""
    return math.erf(s / (SQRT2 * sigma))


def kq(sigma: float) -> float:
    """小訊號統計增益 ``K_q = √(2/π)/σ_v``（|s| ≪ σ_v）。單位為 σ 單位的倒數。"""
    return math.sqrt(2.0 / math.pi) / sigma


def bit_to_bipolar(b: np.ndarray) -> np.ndarray:
    """硬體 0/1 → ±1：``q = 2b − 1``。"""
    return 2.0 * np.asarray(b, dtype=float) - 1.0


# ---------------------------------------------------------------------------
# 方向判斷機率：G_N = Σ q_i > 0 ?
# ---------------------------------------------------------------------------


def direction_prob_clt(m: float, n: int | float) -> float:
    """CLT 近似 ``P(G_N > 0) ≈ Φ(m√N / √(1−m²))``（規格 §5 的表格所用）。"""
    return float(special.ndtr(m * math.sqrt(n) / math.sqrt(1.0 - m * m)))


def direction_prob_exact(p: float, n: int, rule: str = 'split') -> float:
    """以 Binomial 精確計算 ``G_N = 2K − N > 0``，``K ~ Bin(N, p)``。

    - 奇數 N：不會平手，三種規則結果相同。
    - 偶數 N 會有 ``G_N = 0``（K = N/2）的平手：
      ``rule='strict'`` 只算嚴格 > 0；``rule='split'`` 平手算一半（等同隨機打破平手）。
    """
    if n <= 0:
        raise ValueError('N 必須為正整數')
    strict = float(stats.binom.sf(n // 2, n, p))  # P(K > floor(N/2)) = P(K ≥ floor(N/2)+1)
    if n % 2 == 1 or rule == 'strict':
        return strict
    if rule == 'split':
        return strict + 0.5 * float(stats.binom.pmf(n // 2, n, p))
    raise ValueError(f'unknown tie rule {rule!r}')


def n_for_target_clt(m: float, target: float) -> float:
    """CLT 反解：``N = (Φ⁻¹(target)·√(1−m²)/m)²``（連續值）。"""
    z = float(special.ndtri(target))
    return (z * math.sqrt(1.0 - m * m) / m) ** 2


def n_for_target_exact(p: float, target: float, parity: str = 'odd', rule: str = 'split') -> int:
    """最小的 N（指定奇偶）使 ``direction_prob_exact(p, N, rule) ≥ target``。

    以 CLT 解為起點做二分搜尋；呼叫端應另外檢查單調性（測試中已驗證鄰近點）。
    """
    if parity not in ('odd', 'even'):
        raise ValueError(f'unknown parity {parity!r}')
    m = 2.0 * p - 1.0
    guess_n = max(1, int(n_for_target_clt(m, target)))

    def to_n(k: int) -> int:
        return 2 * k + 1 if parity == 'odd' else 2 * k + 2

    def ok(k: int) -> bool:
        return direction_prob_exact(p, to_n(k), rule) >= target

    hi = max(0, guess_n // 2)
    while not ok(hi):
        hi = 2 * hi + 1
    lo = -1  # 哨兵：視為「未達標」
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if ok(mid):
            hi = mid
        else:
            lo = mid
    return to_n(hi)


# ---------------------------------------------------------------------------
# Monte Carlo
# ---------------------------------------------------------------------------


def mc_direction_raw(
    rng: np.random.Generator, s: float, sigma: float, n: int, trials: int, chunk_elems: int = 20_000_000
) -> tuple[int, int]:
    """直接產生 Gaussian 雜訊、取 sign、累加 N 筆；回傳 (#G_N>0, #G_N=0)。"""
    pos = 0
    ties = 0
    rows = max(1, chunk_elems // n)
    done = 0
    while done < trials:
        r = min(rows, trials - done)
        v = rng.standard_normal((r, n))
        q = np.where(s + sigma * v >= 0.0, 1, -1).astype(np.int64)
        g = q.sum(axis=1)
        pos += int(np.count_nonzero(g > 0))
        ties += int(np.count_nonzero(g == 0))
        done += r
    return pos, ties


def block_sum_samples(rng: np.random.Generator, n: int, p: float | np.ndarray, size: int | None = None) -> np.ndarray:
    """``G_N = Σ q_i = 2K − N``，``K ~ Bin(N, p)``：iid ±1 樣本加總的精確分布抽樣。"""
    k = rng.binomial(n, p, size=size)
    return 2 * np.asarray(k, dtype=np.int64) - n


def wilson_interval(k: int, n: int, z: float) -> tuple[float, float]:
    """Binomial 比例的 Wilson score interval。"""
    phat = k / n
    denom = 1.0 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    half = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)) / denom
    return center - half, center + half
