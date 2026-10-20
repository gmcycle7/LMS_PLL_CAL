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


# ---------------------------------------------------------------------------
# §5b 非理想 comparator：hysteresis（門檻 ±h 帶記憶）與 metastability（決策窗 ε）
#   與 src/simulation/models/comparator.ts 檔尾的模型相同：有效門檻 θ_a = θ − q_prev·h，
#   |e − θ_a| < ε 的 sample 解不出來（drop：不進 GMAC、latch 狀態不變）。
#   latch 狀態 σ ∈ {±1} 是兩狀態 Markov chain：t₊ = P(−1 → +1)、t₋ = P(+1 → −1)、ν = 1 − t₊ − t₋。
# ---------------------------------------------------------------------------


def nonideal_transitions(s: float, sigma: float, h: float, eps: float, q_prev: int, theta: float = 0.0) -> tuple[float, float, float]:
    """``(P(+1), P(−1), P(metastable))`` 給定上一個輸出 ``q_prev ∈ {+1, −1}``。

    ``d = s − θ + q_prev·h``；``P(+1) = Φ((d − ε)/σ)``、``P(−1) = Φ((−d − ε)/σ)``。σ = 0 為 hard limiter。
    """
    d = s - theta + q_prev * h
    if sigma == 0.0:
        if abs(d) < eps:
            return 0.0, 0.0, 1.0
        return (1.0, 0.0, 0.0) if d >= 0.0 else (0.0, 1.0, 0.0)
    plus = float(special.ndtr((d - eps) / sigma))
    minus = float(special.ndtr((-d - eps) / sigma))
    meta = max(0.0, 1.0 - plus - minus) if eps > 0.0 else 0.0
    return plus, minus, meta


def nonideal_chain(s: float, sigma: float, h: float, eps: float, theta: float = 0.0) -> dict[str, float]:
    """latch 狀態 chain 的平穩統計（drop 政策）。

    回傳 dict：``t_up``、``t_down``、``nu``、``pi_plus``、``mean_state``、``mean_out``（E[y]，metastable 算 0）、
    ``p_plus_out``、``p_minus_out``、``p_meta``、``var_out``、``beta``、``cov1``、``var_inf``（lim Var(S_N)/N）。
    """
    fp = nonideal_transitions(s, sigma, h, eps, +1, theta)
    fm = nonideal_transitions(s, sigma, h, eps, -1, theta)
    t_down, t_up = fp[1], fm[0]
    tot = t_up + t_down
    if not tot > 0.0:
        raise ValueError('latch 永遠不翻轉（t₊ = t₋ = 0）：沒有平穩分布')
    pi_plus = t_up / tot
    pi_minus = 1.0 - pi_plus
    nu = 1.0 - tot
    g_plus = fp[0] - fp[1]
    g_minus = fm[0] - fm[1]
    mean_state = 2.0 * pi_plus - 1.0
    mean_out = pi_plus * g_plus + pi_minus * g_minus
    p_meta = pi_plus * fp[2] + pi_minus * fm[2]
    var_out = 1.0 - p_meta - mean_out * mean_out
    beta = 0.5 * (g_plus - g_minus)
    cov1 = 1.0 - p_meta - mean_out * mean_state
    var_inf = var_out + 2.0 * beta * cov1 / (1.0 - nu)
    return {
        't_up': t_up, 't_down': t_down, 'nu': nu, 'pi_plus': pi_plus, 'mean_state': mean_state, 'mean_out': mean_out,
        'p_plus_out': pi_plus * fp[0] + pi_minus * fm[0], 'p_minus_out': pi_plus * fp[1] + pi_minus * fm[1], 'p_meta': p_meta,
        'var_out': var_out, 'beta': beta, 'cov1': cov1, 'var_inf': var_inf,
        'fp': fp, 'fm': fm,
    }


def kq_hysteresis(sigma: float, h: float) -> float:
    """純遲滯（ε = 0）在 s = θ 的平穩斜率 ``K_q(h) = φ(η)/(σ Φ(−η))``，η = h/σ（h = 0 回到 √(2/π)/σ）。"""
    eta = h / sigma
    return float(stats.norm.pdf(eta) / (sigma * special.ndtr(-eta)))


def nu_hysteresis(sigma: float, h: float) -> float:
    """純遲滯在 s = θ 的記憶因子 ``ν = 1 − 2Φ(−h/σ)``。"""
    return float(1.0 - 2.0 * special.ndtr(-h / sigma))


def meta_prob(s: float, sigma: float, eps: float, theta: float = 0.0) -> float:
    """``P_meta = Φ((ε − d)/σ) − Φ((−ε − d)/σ)``，d = s − θ；d = 0 時 2Φ(ε/σ) − 1 ≈ K_q·ε。"""
    if not eps > 0.0:
        return 0.0
    d = s - theta
    if sigma == 0.0:
        return 1.0 if abs(d) < eps else 0.0
    return float(special.ndtr((eps - d) / sigma) - special.ndtr((-eps - d) / sigma))


def kq_meta_drop(sigma: float, eps: float) -> float:
    """drop 政策（h = 0）在 s = θ 的斜率 ``K_q·exp(−ε²/(2σ²))``。"""
    return kq(sigma) * math.exp(-eps * eps / (2.0 * sigma * sigma))


def chain_slope(sigma: float, h: float, eps: float, theta: float = 0.0) -> float:
    """一般情形（h 與 ε 同時存在）在 s = θ 的平穩斜率：對 mean_out 做 5 點中央差分（步長 10⁻³σ）。"""
    d = 1e-3 * sigma

    def f(x: float) -> float:
        return nonideal_chain(x, sigma, h, eps, theta)['mean_out']

    return (-f(theta + 2 * d) + 8 * f(theta + d) - 8 * f(theta - d) + f(theta - 2 * d)) / (12 * d)


def nonideal_summary(sigma: float, h: float, eps: float, theta: float = 0.0) -> dict[str, float]:
    """§5b 的設計量：``slope_ratio``（對 K_q）、``noise_factor``（lim Var(S_N)/N）、``kq_eff_ratio``、``info_ratio``、``n_ratio``、``nu``、``p_meta``。"""
    ch = nonideal_chain(theta, sigma, h, eps, theta)
    k0 = kq(sigma)
    slope = chain_slope(sigma, h, eps, theta)
    kq_eff = slope / math.sqrt(ch['var_inf'])
    info = (kq_eff / k0) ** 2
    return {
        'slope': slope, 'slope_ratio': slope / k0, 'noise_factor': ch['var_inf'], 'kq_eff': kq_eff, 'kq_eff_ratio': kq_eff / k0,
        'info_ratio': info, 'n_ratio': 1.0 / info, 'nu': ch['nu'], 'p_meta': ch['p_meta'],
    }


def chain_sum_variance(n: int, ch: dict[str, float]) -> float:
    """有限 N：``Var(S_N) = N·c₀ + 2β·c₁·[N/(1−ν) − (1−ν^N)/(1−ν)²]``。"""
    nu = ch['nu']
    geo = (n - 1.0) if nu == 0.0 else n / (1.0 - nu) - (1.0 - nu**n) / (1.0 - nu) ** 2
    return n * ch['var_out'] + 2.0 * ch['beta'] * ch['cov1'] * geo


def chain_sum_pmf(ch: dict[str, float], n: int) -> np.ndarray:
    """S_N 的精確分布（DP；index − N = S）。完整的 2N+1 格（不截窗），N ≤ 數千即可。"""
    fp, fm = ch['fp'], ch['fm']
    size = 2 * n + 1
    a = np.zeros(size)
    b = np.zeros(size)
    a[n] = ch['pi_plus']
    b[n] = 1.0 - ch['pi_plus']
    for _ in range(n):
        up = a * fp[0] + b * fm[0]
        down = a * fp[1] + b * fm[1]
        a2 = a * fp[2]
        b2 = b * fm[2]
        a2[1:] += up[:-1]
        b2[:-1] += down[1:]
        a, b = a2, b2
    pmf = a + b
    return pmf / pmf.sum()


def direction_exact_chain(ch: dict[str, float], n: int) -> tuple[float, float, float]:
    """``(P(S_N > 0), P(S_N = 0), P(S_N < 0))`` 由精確 pmf。"""
    pmf = chain_sum_pmf(ch, n)
    return float(pmf[n + 1:].sum()), float(pmf[n]), float(pmf[:n].sum())


def direction_clt_chain(ch: dict[str, float], n: int) -> tuple[float, float, float]:
    """CLT（Markov 變異數）：drop 時格點間距 1（切在 ±½），否則間距 2（偶數 N 切在 ±1）。"""
    mean = n * ch['mean_out']
    sd = math.sqrt(chain_sum_variance(n, ch))
    c = 0.5 if ch['p_meta'] > 0.0 else (1.0 if n % 2 == 0 else 0.0)
    pos = float(special.ndtr((mean - c) / sd))
    neg = float(special.ndtr((-mean - c) / sd))
    return pos, max(0.0, 1.0 - pos - neg), neg


def mc_nonideal_sums(rng: np.random.Generator, s: float, sigma: float, h: float, eps: float, n: int, trials: int, theta: float = 0.0, burn_in: int = 256) -> np.ndarray:
    """逐 sample 跑帶 latch 狀態的 comparator（drop），回傳每個 trial 的 S_N（trials 個）。純 Python 迴圈，適合 N·trials ≲ 10⁶。"""
    ch = nonideal_chain(s, sigma, h, eps, theta)
    q = 1 if rng.uniform() < ch['pi_plus'] else -1
    noise = rng.standard_normal(burn_in + n * trials) * sigma + s - theta
    k = 0
    for _ in range(burn_in):
        d = noise[k] + q * h
        k += 1
        if abs(d) >= eps:
            q = 1 if d >= 0.0 else -1
    out = np.zeros(trials, dtype=np.int64)
    for j in range(trials):
        acc = 0
        for _ in range(n):
            d = noise[k] + q * h
            k += 1
            if abs(d) < eps:
                continue
            q = 1 if d >= 0.0 else -1
            acc += q
        out[j] = acc
    return out


def sign_lms_nonideal(rng: np.random.Generator, a: float, w0: float, mu: float, sigma: float, h: float, eps: float, n: int, blocks: int, theta: float = 0.0) -> np.ndarray:
    """小的 block Sign-LMS 模擬（x ≡ 1、average 模式、drop 政策）：w_{k+1} = w_k + μ·S_N/N，comparator 帶 hysteresis／metastability。

    回傳 w_0 … w_blocks。用來驗證 §5b 的線性化：pole ≈ 1 − μ·slope(h, ε)、σ_w² ≈ μ²·Var(S_N)/N²/(1 − pole²)。
    """
    w = np.zeros(blocks + 1)
    w[0] = w0
    q = 1
    noise = rng.standard_normal(n * blocks) * sigma
    k = 0
    for b in range(blocks):
        acc = 0
        s = a - w[b]
        for _ in range(n):
            d = s + noise[k] - theta + q * h
            k += 1
            if abs(d) < eps:
                continue
            q = 1 if d >= 0.0 else -1
            acc += q
        w[b + 1] = w[b] + mu * acc / n
    return w
