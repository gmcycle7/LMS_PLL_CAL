"""Ch05 §5b 非理想 comparator（hysteresis ±h、metastability 決策窗 ε）的 golden 驗證。

命名 ``test_S5b_*``（§5 的延伸，無 T-id；``scripts/verify.mjs`` 會列為「未對應」）。
解析式（chain、閉式斜率、Var(S_N)、DP）互相交叉比對，再以固定 seed 的 Monte Carlo 驗證（±4 SE）。
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from lms_pll_golden import comparator

SIGMA_V = 100.0
KQ = comparator.kq(SIGMA_V)


def test_S5b_h0_eps0_reduces_to_iid_comparator():
    """h = ε = 0：chain 的 t₊ = Φ(s/σ)、ν = 0、E[y] = erf、Var(S_N) = N(1 − m²)、DP = Binomial。"""
    ch = comparator.nonideal_chain(1.0, SIGMA_V, 0.0, 0.0)
    assert ch['t_up'] == pytest.approx(comparator.p_plus(1.0, SIGMA_V), rel=1e-14)
    assert ch['nu'] == pytest.approx(0.0, abs=1e-15)
    assert ch['mean_out'] == pytest.approx(comparator.mean_q(1.0, SIGMA_V), rel=1e-12)
    m = comparator.mean_q(1.0, SIGMA_V)
    assert comparator.chain_sum_variance(100, ch) == pytest.approx(100 * (1 - m * m), rel=1e-12)
    pos, tie, neg = comparator.direction_exact_chain(ch, 100)
    p = comparator.p_plus(1.0, SIGMA_V)
    assert pos == pytest.approx(comparator.direction_prob_exact(p, 100, 'strict'), rel=1e-12)
    assert tie == pytest.approx(2 * (comparator.direction_prob_exact(p, 100, 'split') - pos), rel=1e-9)
    assert pos + tie + neg == pytest.approx(1.0, abs=1e-12)
    assert comparator.nonideal_summary(SIGMA_V, 0.0, 0.0)['slope_ratio'] == pytest.approx(1.0, rel=1e-9)


@pytest.mark.parametrize('eta', [0.1, 0.3, 0.5, 1.0, 2.0])
def test_S5b_hysteresis_slope_closed_form_matches_numeric_derivative(eta: float):
    """F-05.22：K_q(h) = φ(η)/(σΦ(−η)) 等於對平穩 E[q] 做數值微分；ν = 1 − 2Φ(−η)；斜率隨 h 變大但資訊變少。"""
    h = eta * SIGMA_V
    s = comparator.nonideal_summary(SIGMA_V, h, 0.0)
    assert s['slope'] == pytest.approx(comparator.kq_hysteresis(SIGMA_V, h), rel=1e-9)
    assert s['nu'] == pytest.approx(comparator.nu_hysteresis(SIGMA_V, h), rel=1e-12)
    assert s['noise_factor'] == pytest.approx((1 + s['nu']) / (1 - s['nu']), rel=1e-12)
    assert s['slope_ratio'] > 1.0
    assert s['kq_eff_ratio'] < 1.0
    assert s['n_ratio'] == pytest.approx(1.0 / s['info_ratio'], rel=1e-12)
    # 小 η 的級數：斜率比 ≈ 1 + 2φ(0)η、ν ≈ 2φ(0)η，資訊損失是二階小量
    if eta <= 0.3:
        phi0 = 1 / math.sqrt(2 * math.pi)
        assert s['slope_ratio'] == pytest.approx(1 + 2 * phi0 * eta, abs=0.4 * eta * eta)
        assert 1 - s['info_ratio'] < 3 * eta * eta


def test_S5b_hand_calc_numbers_h03_eps005():
    """手算題的數字（σ_v = 100 fs）：h = 0.3σ_v ⇒ 斜率比 1.2510、ν = 0.2358、K_eff 比 0.9837、N 多 3.3%；
    ε = 0.05σ_v ⇒ P_meta = 0.03988、每 block 4096 個漏掉 163.3 個、斜率只少 0.125%。"""
    s = comparator.nonideal_summary(SIGMA_V, 30.0, 0.0)
    assert round(s['slope_ratio'], 4) == 1.2510
    assert round(s['nu'], 4) == 0.2358
    assert round(s['kq_eff_ratio'], 4) == 0.9837
    assert round(s['n_ratio'], 3) == 1.033
    pm = comparator.meta_prob(0.0, SIGMA_V, 5.0)
    assert round(pm, 5) == 0.03988
    assert round(4096 * pm, 1) == 163.3
    assert pm == pytest.approx(2 * comparator.p_plus(5.0, SIGMA_V) - 1, rel=1e-12)
    assert pm == pytest.approx(KQ * 5.0, rel=5e-4)  # P_meta ≈ K_q·ε（ε ≪ σ_v；相對差 (ε/σ_v)²/6 ≈ 4.2e-4）
    assert comparator.kq_meta_drop(SIGMA_V, 5.0) / KQ == pytest.approx(math.exp(-0.00125), rel=1e-12)


@pytest.mark.parametrize('ratio', [0.01, 0.05, 0.1, 0.3])
def test_S5b_meta_drop_slope_closed_form_and_noise(ratio: float):
    """F-05.25：drop 的斜率 K_q·e^{−ε²/2σ²} 等於數值微分；Var(y) = 1 − P_meta；每 sample 資訊反而略增（漏掉的是幾乎不帶資訊的樣本）。"""
    eps = ratio * SIGMA_V
    s = comparator.nonideal_summary(SIGMA_V, 0.0, eps)
    assert s['slope'] == pytest.approx(comparator.kq_meta_drop(SIGMA_V, eps), rel=1e-9)
    assert s['noise_factor'] == pytest.approx(1 - comparator.meta_prob(0.0, SIGMA_V, eps), rel=1e-12)
    assert s['info_ratio'] > 1.0
    assert s['info_ratio'] == pytest.approx(math.exp(-(ratio**2)) / (1 - s['p_meta']), rel=1e-9)


def test_S5b_chain_variance_and_direction_vs_monte_carlo(make_rng):
    """h = 30 fs、ε = 5 fs、s = 1 fs：MC 的 Var(S_N)、E[S_N]、P(S_N > 0)、P_meta 與 chain／DP 在 4 SE 內。"""
    rng = make_rng(5)
    n, trials = 200, 20000
    ch = comparator.nonideal_chain(1.0, SIGMA_V, 30.0, 5.0)
    sums = comparator.mc_nonideal_sums(rng, 1.0, SIGMA_V, 30.0, 5.0, n, trials)
    var_pred = comparator.chain_sum_variance(n, ch)
    mean_pred = n * ch['mean_out']
    assert abs(sums.mean() - mean_pred) <= 4 * math.sqrt(var_pred / trials)
    se_var = var_pred * math.sqrt(2.0 / trials) * 1.3  # ±1 的和不是 Gaussian：留 30% 給四階矩
    assert abs(sums.var(ddof=1) - var_pred) <= 4 * se_var
    pos, tie, neg = comparator.direction_exact_chain(ch, n)
    phat = np.mean(sums > 0)
    assert abs(phat - pos) <= 4 * math.sqrt(pos * (1 - pos) / trials)
    that = np.mean(sums == 0)
    assert abs(that - tie) <= 4 * math.sqrt(tie * (1 - tie) / trials) + 1e-9
    # CLT（Markov 變異數）與精確 DP 相差 < 2e-3（N = 200）
    clt = comparator.direction_clt_chain(ch, n)
    assert abs(clt[0] - pos) < 2e-3


def test_S5b_lag1_correlation_is_nu_for_pure_hysteresis(make_rng):
    """純遲滯（h = σ_v）在 s = θ：相鄰輸出的相關 = ν = 1 − 2Φ(−1) = 0.6827（MC ±0.01）。"""
    rng = make_rng(6)
    h = SIGMA_V
    nu = comparator.nu_hysteresis(SIGMA_V, h)
    samples = 400000
    noise = rng.standard_normal(samples) * SIGMA_V
    q = np.empty(samples)
    state = 1
    for i in range(samples):
        d = noise[i] + state * h
        state = 1 if d >= 0.0 else -1
        q[i] = state
    q = q[1000:]
    lag1 = np.mean(q[1:] * q[:-1]) - np.mean(q) ** 2
    assert abs(lag1 - nu) < 0.01
    assert round(nu, 4) == 0.6827


def test_S5b_sign_lms_with_hysteresis_pole_and_coefficient_noise(make_rng):
    """block Sign-LMS（x ≡ 1、N = 256、μ = 2 fs、h = σ_v）：平均 w → a；σ_w ≈ μ√(Var(S_N))/N/√(1 − p²)，p = 1 − μ·slope(h)
    （線性化；MC 與預測相差 < 15%）。同 μ 下 pole 比理想 comparator 快，但 σ_w 更大。"""
    rng = make_rng(7)
    a, mu, n, blocks, h = 3.0, 2.0, 256, 6000, SIGMA_V
    w = comparator.sign_lms_nonideal(rng, a, 0.0, mu, SIGMA_V, h, 0.0, n, blocks)
    tail = w[blocks // 2:]
    s = comparator.nonideal_summary(SIGMA_V, h, 0.0)
    pole = 1 - mu * s['slope']
    pole_ideal = 1 - mu * KQ
    assert 0 < pole < pole_ideal < 1
    ch0 = comparator.nonideal_chain(0.0, SIGMA_V, h, 0.0)
    sigma_eta = math.sqrt(comparator.chain_sum_variance(n, ch0)) / n
    sigma_w_pred = mu * sigma_eta / math.sqrt(1 - pole * pole)
    sigma_w_ideal = mu / math.sqrt(n * (1 - pole_ideal**2))
    assert sigma_w_pred > sigma_w_ideal
    assert abs(tail.mean() - a) < 4 * sigma_w_pred / math.sqrt(blocks / 2 * (1 - pole) / (1 + pole))
    assert abs(tail.std(ddof=1) / sigma_w_pred - 1) < 0.15
