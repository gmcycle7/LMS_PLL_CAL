"""規格 §17 Acceptance Reference Values：T01–T18（含對應的反面測試）。

命名規則：每個函式名稱都含 T-id（``test_T05_...``），``scripts/verify.mjs`` 依此彙整。
規格有歧義時，每一種解讀各自一個測試並寫明名稱（例如 T05、T14）。

容忍度原則：
- 封閉式：雙精度等級（abs 1e-12 或 rel 1e-12）。
- 規格中「≈」的數字：依規格列出的位數四捨五入比對。
- Monte Carlo：固定 seed；以 ±Z_MC 個標準誤（或 Wilson / 四階矩 CI）作為容忍度。
"""

from __future__ import annotations

import math
from fractions import Fraction

import numpy as np
import pytest
from scipy import special

from lms_pll_golden import bias, comparator, lms, mimo, noise, polarity, quantization, stability

Z_MC = 4.0  # Monte Carlo 斷言用的標準誤倍數（雙尾 ≈ 6e-5 誤報率；seed 固定所以結果可重現）

SIGMA_V = 100.0  # fs
KQ = math.sqrt(2.0 / math.pi) / SIGMA_V


def assert_mc(estimate: float, se: float, expected: float, z: float = Z_MC) -> None:
    assert abs(estimate - expected) <= z * se, f'MC {estimate} ± {se} 與期望 {expected} 相差 {abs(estimate - expected) / se:.2f} SE'


# =============================================================================
# T01 §1.2 手算例子
# =============================================================================


def test_T01_hand_example_two_steps():
    tr = lms.lms_trace(a=3.0, w0=1.0, x=2.0, mu=0.1, steps=2)
    assert tr.e[0] == pytest.approx(4.0, abs=1e-15)
    assert tr.w[1] == pytest.approx(1.8, abs=1e-15)
    assert tr.e[1] == pytest.approx(2.4, abs=1e-15)
    assert tr.w[2] == pytest.approx(2.28, abs=1e-15)


def test_T01_exact_rational_arithmetic():
    """以 Fraction 精確計算，確認 1.8、2.28 不是浮點巧合。"""
    a, w, x, mu = Fraction(3), Fraction(1), Fraction(2), Fraction(1, 10)
    ws = [w]
    for _ in range(2):
        e = a * x - w * x
        w = w + mu * e * x
        ws.append(w)
    assert ws[1] == Fraction(9, 5)
    assert ws[2] == Fraction(57, 25)


def test_T01_closed_form_and_convergence_to_a():
    tr = lms.lms_trace(3.0, 1.0, 2.0, 0.1, 60)
    for n in range(61):
        assert tr.w[n] == pytest.approx(lms.lms_closed_form(3.0, 1.0, 2.0, 0.1, n), abs=1e-12)
    assert abs(tr.w[-1] - 3.0) < 1e-12  # p = 0.6，0.6^60·2 ≈ 1e-13


# =============================================================================
# T02 §3 固定 x = 2 的穩定區間 0 < μ < 0.5
# =============================================================================


def test_T02_bound_closed_form():
    assert lms.fixed_x_mu_bound(2.0) == 0.5
    assert lms.fixed_x_pole(0.25, 2.0) == 0.0  # 一步到答案


def test_T02_bound_by_root_finding():
    """不使用封閉式：以 brentq 解 |1 − μx²| = 1（μ > 0 那一端）。"""
    from scipy import optimize

    mu_hi = optimize.brentq(lambda m: abs(lms.fixed_x_pole(m, 2.0)) - 1.0, 0.3, 1.0, xtol=1e-15)
    assert mu_hi == pytest.approx(0.5, abs=1e-14)


@pytest.mark.parametrize(
    ('mu', 'kind'),
    [
        (0.1, 'monotone'),
        (0.25, 'one-step'),
        (0.4, 'oscillatory'),
        (0.49, 'oscillatory'),
        (0.5, 'marginal'),
        (0.51, 'divergent'),
        (-0.01, 'divergent'),
    ],
)
def test_T02_time_domain_behaviour(mu, kind):
    p = lms.fixed_x_pole(mu, 2.0)
    assert lms.classify_pole(p, tol=1e-12) == kind
    tr = lms.lms_trace(3.0, 1.0, 2.0, mu, 400)
    err = np.abs(tr.w - 3.0)
    if kind in ('monotone', 'oscillatory'):
        assert err[-1] < 1e-6 * err[0]
    elif kind == 'one-step':
        assert err[1] == pytest.approx(0.0, abs=1e-15)
    elif kind == 'marginal':
        np.testing.assert_allclose(err, err[0], rtol=1e-12)  # |δ| 不變、正負交替
    else:
        assert err[-1] > 10 * err[0]


# =============================================================================
# T03 §3.1 Gaussian：mean 上限 2、mean-square 上限 2/3
# =============================================================================


def test_T03_closed_form_bounds():
    ex2, ex4 = lms.gaussian_moments(1.0)
    assert (ex2, ex4) == (1.0, 3.0)
    assert lms.mean_mu_bound(ex2) == 2.0
    assert lms.mean_square_mu_bound(ex2, ex4) == pytest.approx(2.0 / 3.0, abs=1e-15)
    # 在 μ = 2/3 時 E[(1−μx²)²] 恰為 1
    assert lms.mean_square_factor(2.0 / 3.0, ex2, ex4) == pytest.approx(1.0, abs=1e-15)


@pytest.mark.parametrize('sampler', ['gaussian', 'bpsk', 'uniform'])
def test_T03_mean_square_bound_monte_carlo_moments(make_rng, sampler):
    """以 MC 估 E[x²]、E[x⁴]，再算 2E[x²]/E[x⁴]，與封閉式比對（delta method 標準誤）。"""
    rng = make_rng(301 + ['gaussian', 'bpsk', 'uniform'].index(sampler))
    x = lms.draw_regressor(rng, 4_000_000, sampler)
    ex2_true, ex4_true = lms.REGRESSOR_MOMENTS[sampler]
    x2 = x * x
    x4 = x2 * x2
    m2, m4 = x2.mean(), x4.mean()
    bound_mc = 2.0 * m2 / m4
    # delta method：b = 2 m2/m4，∇b = (2/m4, −2m2/m4²)
    cov = np.cov(np.vstack([x2, x4])) / x.size
    grad = np.array([2.0 / m4, -2.0 * m2 / m4**2])
    se = math.sqrt(max(float(grad @ cov @ grad), 1e-30))
    expected = lms.mean_square_mu_bound(ex2_true, ex4_true)
    assert abs(bound_mc - expected) <= Z_MC * se + 1e-12


def test_T03_mean_square_factor_monte_carlo_straddles_bound(make_rng):
    """μ = 0.9·(2/3) 時 E[(1−μx²)²] < 1；μ = 1.1·(2/3) 時 > 1（MC 信賴區間不跨 1）。"""
    rng = make_rng(310)
    bound = 2.0 / 3.0
    for scale, below in [(0.9, True), (1.1, False)]:
        mu = scale * bound
        f, se = lms.mc_mean_square_factor(rng, mu, 4_000_000, 'gaussian')
        assert_mc(f, se, lms.mean_square_factor(mu, 1.0, 3.0))
        if below:
            assert f + Z_MC * se < 1.0
        else:
            assert f - Z_MC * se > 1.0


def test_T03_mean_converges_while_mean_square_diverges(make_rng):
    """μ = 1（介於 2/3 與 2 之間）：E[δ₁] = 0·δ₀，但 E[δ₁²] = 2δ₀²（單步精確）。"""
    rng = make_rng(311)
    mu = 1.0
    x = rng.standard_normal(4_000_000)
    d1 = 1.0 - mu * x * x  # δ0 = 1
    m, se_m = d1.mean(), d1.std(ddof=1) / math.sqrt(d1.size)
    m2, se_m2 = (d1**2).mean(), (d1**2).std(ddof=1) / math.sqrt(d1.size)
    assert_mc(m, se_m, 1.0 - mu * 1.0)  # 平均 Pole = 0
    assert_mc(m2, se_m2, lms.mean_square_factor(mu, 1.0, 3.0))  # = 2
    assert m2 - Z_MC * se_m2 > 1.0


# =============================================================================
# T04 §5 Comparator：P(+1) ≈ 0.503989；K_q ≈ 0.00797885/fs
# =============================================================================


def test_T04_closed_form_values():
    p = comparator.p_plus(1.0, SIGMA_V)
    assert p == pytest.approx(0.5039893563146316, abs=1e-13)
    assert round(p, 6) == 0.503989  # 規格列出的 6 位
    assert round(100 * p, 4) == 50.3989
    assert round(100 * (1 - p), 4) == 49.6011
    m = comparator.mean_q(1.0, SIGMA_V)
    assert m == pytest.approx(2 * p - 1, abs=1e-15)
    assert m == pytest.approx(0.007978712629263208, abs=1e-15)
    assert round(m, 7) == 0.0079787
    kq = comparator.kq(SIGMA_V)
    assert kq == pytest.approx(0.007978845608028654, abs=1e-16)
    assert round(kq, 8) == 0.00797885


def test_T04_kq_is_derivative_of_mean_q_at_zero():
    h = 1e-3
    deriv = (comparator.mean_q(h, SIGMA_V) - comparator.mean_q(-h, SIGMA_V)) / (2 * h)
    assert deriv == pytest.approx(comparator.kq(SIGMA_V), rel=1e-9)
    # 小訊號近似誤差 ≈ (s/σ)²/6
    rel = (comparator.kq(SIGMA_V) * 1.0 - comparator.mean_q(1.0, SIGMA_V)) / comparator.mean_q(1.0, SIGMA_V)
    assert rel == pytest.approx((1.0 / SIGMA_V) ** 2 / 6.0, rel=1e-3)


def test_T04_monte_carlo_p_plus(make_rng):
    rng = make_rng(401)
    n = 20_000_000
    pos = 0
    for _ in range(4):
        v = rng.standard_normal(n // 4)
        pos += int(np.count_nonzero(1.0 + SIGMA_V * v >= 0.0))
    phat = pos / n
    se = math.sqrt(phat * (1 - phat) / n)
    assert_mc(phat, se, comparator.p_plus(1.0, SIGMA_V))
    assert phat - Z_MC * se > 0.5  # 1 fs 的資訊確實存在


def test_T04_negative_wrong_01_encoding_biased_update(make_rng):
    """反面：把硬體位元 b ∈ {0,1} 直接當 q（應為 q = 2b − 1）。

    在 w = a（零誤差）時正確編碼 E[qx] = 0；錯誤編碼 E[bx] = E[x]/2 ≠ 0 ⇒ 更新被持續推離。
    以帶 DC 的 code 分布示範固定點偏差（約 +41 fs），並以逐樣本 Block Sign-LMS 驗證。
    """
    vals = np.array([-1.0, -0.5, 0.0, 0.5, 1.0, 1.5])
    probs = np.full(6, 1 / 6)
    a = 300.0
    assert bias.sign_lms_mean_gmac(a, a, vals, probs, SIGMA_V, encoding='bipolar') == pytest.approx(0.0, abs=1e-15)
    wrong = bias.sign_lms_mean_gmac(a, a, vals, probs, SIGMA_V, encoding='unipolar')
    assert wrong == pytest.approx(vals.mean() / 2, abs=1e-15)
    w_wrong = bias.sign_lms_fixed_point(a, vals, probs, SIGMA_V, bracket=(a - 1000, a + 1000), encoding='unipolar')
    assert w_wrong - a == pytest.approx(41.26986535003289, rel=1e-8)
    # 零均值 code：錯誤編碼不偏，但增益減半（E[bx] = E[qx]/2）
    zm = np.array([-1.0, 1.0])
    pz = np.array([0.5, 0.5])
    for w in (295.0, 305.0):
        assert bias.sign_lms_mean_gmac(w, a, zm, pz, SIGMA_V, encoding='unipolar') == pytest.approx(
            0.5 * bias.sign_lms_mean_gmac(w, a, zm, pz, SIGMA_V, encoding='bipolar'), abs=1e-15
        )
    # MC：30 條獨立 chain 的終值平均
    ends_wrong, ends_ok = [], []
    for s in range(30):
        tr = bias.simulate_block_sign_lms_discrete(make_rng(4100 + s), a, vals, probs, SIGMA_V, 10.0, 4096, 300, a, encoding='unipolar')
        ends_wrong.append(tr[-1])
        tr2 = bias.simulate_block_sign_lms_discrete(make_rng(4200 + s), a, vals, probs, SIGMA_V, 10.0, 4096, 300, a, encoding='bipolar')
        ends_ok.append(tr2[-1])
    ew, eo = np.array(ends_wrong), np.array(ends_ok)
    assert_mc(ew.mean(), ew.std(ddof=1) / math.sqrt(ew.size), w_wrong)
    assert_mc(eo.mean(), eo.std(ddof=1) / math.sqrt(eo.size), a)
    assert ew.mean() - a > 40.0


# =============================================================================
# T05 §5 N ≈ 42500 時方向判斷成功率 ≈ 95%（規格未定義 G_N = 0 的平手，分別測）
# =============================================================================

S_FS = 1.0
P_PLUS = comparator.p_plus(S_FS, SIGMA_V)
M_Q = comparator.mean_q(S_FS, SIGMA_V)

SPEC_TABLE = [(100, 0.532), (1000, 0.600), (10000, 0.788)]


def test_T05_clt_approximation_table():
    """CLT 式 Φ(m√N/√(1−m²))：規格表格 53.2% / 60.0% / 78.8% / 95% / 99%。"""
    for n, pct in SPEC_TABLE:
        assert round(comparator.direction_prob_clt(M_Q, n), 3) == pct
    assert comparator.direction_prob_clt(M_Q, 42500) == pytest.approx(0.95, abs=5e-5)
    assert comparator.direction_prob_clt(M_Q, 85000) == pytest.approx(0.99, abs=5e-5)
    assert comparator.n_for_target_clt(M_Q, 0.95) == pytest.approx(42497.28828672246, rel=1e-10)
    assert comparator.n_for_target_clt(M_Q, 0.99) == pytest.approx(85007.2607282224, rel=1e-10)
    assert round(comparator.n_for_target_clt(M_Q, 0.95), -2) == 42500
    assert round(comparator.n_for_target_clt(M_Q, 0.99), -3) == 85000


def test_T05_exact_binomial_odd_N_no_ties():
    """奇數 N 不會平手：P(K ≥ (N+1)/2)。N = 42499 是達到 95% 的最小奇數 N。"""
    assert comparator.direction_prob_exact(P_PLUS, 42501) == pytest.approx(0.9500057057433076, abs=1e-10)
    n95 = comparator.n_for_target_exact(P_PLUS, 0.95, parity='odd')
    assert n95 == 42499
    assert comparator.direction_prob_exact(P_PLUS, n95) >= 0.95 > comparator.direction_prob_exact(P_PLUS, n95 - 2)
    n99 = comparator.n_for_target_exact(P_PLUS, 0.99, parity='odd')
    assert n99 == 85011
    assert comparator.direction_prob_exact(P_PLUS, n99) >= 0.99 > comparator.direction_prob_exact(P_PLUS, n99 - 2)
    for n, pct in SPEC_TABLE:
        assert round(comparator.direction_prob_exact(P_PLUS, n + 1), 3) == pct


def test_T05_exact_binomial_even_N_ties_split_half():
    """偶數 N、平手各算一半（= 隨機打破平手）：與奇數 N−1 完全相同，也與 CLT 表格一致。"""
    for n in (100, 1000, 10000, 42500, 85000):
        split = comparator.direction_prob_exact(P_PLUS, n, rule='split')
        assert split == pytest.approx(comparator.direction_prob_exact(P_PLUS, n - 1), abs=1e-12)
    assert comparator.direction_prob_exact(P_PLUS, 42500, rule='split') == pytest.approx(0.9500017143383671, abs=1e-10)
    for n, pct in SPEC_TABLE:
        assert round(comparator.direction_prob_exact(P_PLUS, n, rule='split'), 3) == pct
    assert comparator.n_for_target_exact(P_PLUS, 0.95, parity='even', rule='split') == 42500


def test_T05_exact_binomial_even_N_strict_greater():
    """偶數 N、只算嚴格 G_N > 0：小 N 時與規格表格明顯不同（N=100 只有 49.2%），N=42500 仍 ≈ 95%。"""
    strict100 = comparator.direction_prob_exact(P_PLUS, 100, rule='strict')
    assert strict100 == pytest.approx(0.49204984888948383, abs=1e-12)
    assert round(strict100, 3) != 0.532  # 這種解讀與表格不符
    s42500 = comparator.direction_prob_exact(P_PLUS, 42500, rule='strict')
    assert s42500 == pytest.approx(0.9495014575811476, abs=1e-10)
    assert abs(s42500 - 0.95) < 1e-3  # 「約 95%」仍成立
    n95 = comparator.n_for_target_exact(P_PLUS, 0.95, parity='even', rule='strict')
    assert n95 == 42750
    assert comparator.direction_prob_exact(P_PLUS, n95, 'strict') >= 0.95 > comparator.direction_prob_exact(P_PLUS, n95 - 2, 'strict')


def test_T05_monte_carlo_raw_gaussian_noise(make_rng):
    """直接產生 Gaussian 雜訊 + sign + 累加（N = 42501 奇數，無平手）。"""
    rng = make_rng(501)
    trials = 4000
    pos, ties = comparator.mc_direction_raw(rng, S_FS, SIGMA_V, 42501, trials)
    assert ties == 0
    lo, hi = comparator.wilson_interval(pos, trials, Z_MC)
    assert lo <= comparator.direction_prob_exact(P_PLUS, 42501) <= hi


def test_T05_monte_carlo_binomial_sampling(make_rng):
    """iid ±1 加總的精確分布（Binomial）抽樣，1e6 次：與 exact / CLT 都在 CI 內。"""
    rng = make_rng(502)
    trials = 1_000_000
    g = comparator.block_sum_samples(rng, 42500, P_PLUS, size=trials)
    strict = int(np.count_nonzero(g > 0))
    ties = int(np.count_nonzero(g == 0))
    lo, hi = comparator.wilson_interval(strict, trials, Z_MC)
    assert lo <= comparator.direction_prob_exact(P_PLUS, 42500, 'strict') <= hi
    split_hat = (strict + 0.5 * ties) / trials
    se = math.sqrt(0.95 * 0.05 / trials)
    assert_mc(split_hat, se, comparator.direction_prob_exact(P_PLUS, 42500, 'split'))
    assert_mc(split_hat, se, comparator.direction_prob_clt(M_Q, 42500))


# =============================================================================
# T06 §6 φ = 120°：C < 0 ⇒ 正步長平均發散
# =============================================================================

OMEGA = math.pi / 6  # 30°/sample，週期 12


def test_T06_single_tone_correlation_negative():
    c = polarity.single_tone_corr(1.0, 1.0, math.radians(120.0))
    assert c == pytest.approx(-0.25, abs=1e-15)
    # 60° 減半、90° 為零
    assert polarity.single_tone_corr(1.0, 1.0, math.radians(60.0)) == pytest.approx(0.25, abs=1e-15)
    assert polarity.single_tone_corr(1.0, 1.0, math.radians(90.0)) == pytest.approx(0.0, abs=1e-15)
    # 任何 μ > 0 都使平均 Pole > 1（只減小 μ 不會改變符號）
    for mu in (1e-6, 1e-3, 0.1, 1.0, 10.0):
        assert polarity.cal_pole(mu, KQ, c) > 1.0


def test_T06_time_domain_fir_correlation_matches_formula():
    """用真實 2-tap FIR（在 Ω 有 |H|e^{j120°}）+ 時域整數週期平均，獨立驗證 C。"""
    for phi_deg in (0.0, 60.0, 90.0, 120.0, 155.2, -120.0):
        h = polarity.fir_with_response(0.7, math.radians(phi_deg), OMEGA)
        hz = polarity.freq_response(h, np.array([1.0]), OMEGA)
        assert abs(hz) == pytest.approx(0.7, abs=1e-14)
        assert math.degrees(np.angle(hz)) == pytest.approx(phi_deg, abs=1e-12)
        c_td = polarity.tone_corr_time_domain(1.3, h, OMEGA, 0, periods=50, period_samples=12)
        assert c_td == pytest.approx(polarity.single_tone_corr(1.3, 0.7, math.radians(phi_deg)), abs=1e-13)


def test_T06_second_order_hpd_example():
    """§6.1：ζ = 0.7、ω = 0.3ω_n ⇒ H ≈ −0.0815 + j0.0376，相位 ≈ 155.2°，實部為負。"""
    h = polarity.hpd_second_order(0.3, 0.7)
    assert h.real == pytest.approx(-0.08153310104529617, abs=1e-12)
    assert h.imag == pytest.approx(0.037630662020905925, abs=1e-12)
    assert round(h.real, 4) == -0.0815
    assert round(h.imag, 4) == 0.0376
    assert round(math.degrees(np.angle(h)), 1) == 155.2
    assert h.real < 0


def test_T06_sign_lms_simulation_diverges(make_rng):
    """逐樣本 Block Sign-LMS：φ = 120° 時 |δ| 爆增；φ = 0° 時收斂（相同 seed 的 paired 模擬）。"""
    common = dict(a=0.0, w0=-0.05, mu=1.0, sigma=1.0, a_amp=1.0, omega=OMEGA, n=1200, blocks=60)
    bad = polarity.simulate_block_sign_lms_tone(make_rng(601), h=polarity.fir_with_response(1.0, math.radians(120.0), OMEGA), **common)
    good = polarity.simulate_block_sign_lms_tone(make_rng(601), h=polarity.fir_with_response(1.0, 0.0, OMEGA), **common)
    assert abs(bad[-1]) > 100 * abs(bad[0])
    assert abs(good[-1]) < 0.2


def test_T06_linear_regime_growth_rate_matches_pole(make_rng):
    """線性區（|δ| ≪ σ）的 ensemble 平均：E[δ_5] = p⁵ δ_0，p = 1 − μK_qC = 1 + 0.25·√(2/π)。"""
    p_expected = polarity.cal_pole(1.0, math.sqrt(2 / math.pi) / 1.0, -0.25)
    assert p_expected == pytest.approx(1.199471140200716, abs=1e-12)
    h = polarity.fir_with_response(1.0, math.radians(120.0), OMEGA)
    rng = make_rng(603)
    ends = np.array(
        [polarity.simulate_block_sign_lms_tone(rng, 0.0, -0.05, 1.0, 1.0, 1.0, h, OMEGA, 1200, 5)[-1] for _ in range(400)]
    )
    se = float(ends.std(ddof=1)) / math.sqrt(ends.size)
    expected = 0.05 * p_expected**5
    assert abs(float(ends.mean()) - expected) <= Z_MC * se + 0.01 * expected  # 1%：erf 三次項的模型誤差上限


def test_T06_negative_reversed_comparator_polarity_diverges(make_rng):
    """反面：comparator 極性接反（q → −q）等同 C 變號：平均 Pole = 1 + μK > 1。"""
    mu, n = 10.0, 4096
    k = KQ * 1.0
    assert polarity.cal_pole(mu, k, -1.0) == pytest.approx(1.0 + mu * k, abs=1e-15)
    rng = make_rng(602)
    ok = noise.simulate_block_sign_lms_bpsk(rng, 5.0, mu, SIGMA_V, n, 200, 2000, polarity=+1.0)
    rng = make_rng(602)
    rev = noise.simulate_block_sign_lms_bpsk(rng, 5.0, mu, SIGMA_V, n, 200, 2000, polarity=-1.0)
    assert np.sqrt(np.mean(ok**2)) < 1.0  # 收斂到 σ_w ≈ 0.4 fs
    assert np.min(np.abs(rev)) > 100.0  # 每條 chain 都被推離


# =============================================================================
# T07 §7 φ = −120°、Ω = π/6、D = 4 ⇒ 殘餘相位 0°、單頻相關性正最大
# =============================================================================


def test_T07_delay_alignment_zero_residual_phase():
    phi = math.radians(-120.0)
    theta = math.degrees(phi + OMEGA * 4)
    assert polarity.wrap180(theta) == pytest.approx(0.0, abs=1e-12)
    assert polarity.polarity_margin_deg(theta) == pytest.approx(90.0, abs=1e-12)
    c4 = polarity.single_tone_corr(1.0, 1.0, phi, OMEGA, 4)
    assert c4 == pytest.approx(0.5, abs=1e-15)  # = A²|H|/2：最大值
    cs = [polarity.single_tone_corr(1.0, 1.0, phi, OMEGA, d) for d in range(12)]
    assert int(np.argmax(cs)) == 4
    assert polarity.best_delay(phi, OMEGA, 11) == 4
    assert polarity.single_tone_corr(1.0, 1.0, phi, OMEGA, 0) == pytest.approx(-0.25, abs=1e-15)


def test_T07_time_domain_delay_sweep():
    phi = math.radians(-120.0)
    h = polarity.fir_with_response(1.0, phi, OMEGA)
    for d in range(12):
        c_td = polarity.tone_corr_time_domain(1.0, h, OMEGA, d, periods=40, period_samples=12)
        assert c_td == pytest.approx(polarity.single_tone_corr(1.0, 1.0, phi, OMEGA, d), abs=1e-13)


def test_T07_negative_code_misalignment_flips_sign(make_rng):
    """反面：H = 1（φ = 0），但 GMAC 的 code 錯位 D 個 sample：C_D = (A²/2)cos(ΩD)。

    ΩD > 90°（D = 4 ⇒ 120°）時相關性變號 ⇒ 正步長發散；D = 3 ⇒ 90° ⇒ C = 0（無恢復力）。
    """
    h = np.array([1.0])
    expect = {0: 0.5, 2: 0.25, 3: 0.0, 4: -0.25, 6: -0.5}
    for d, c in expect.items():
        assert polarity.tone_corr_time_domain(1.0, h, OMEGA, d, periods=40, period_samples=12) == pytest.approx(c, abs=1e-13)
    assert math.degrees(OMEGA * 4) > 90.0
    common = dict(a=0.0, w0=-0.05, mu=1.0, sigma=1.0, a_amp=1.0, h=h, omega=OMEGA, n=1200, blocks=60)
    aligned = polarity.simulate_block_sign_lms_tone(make_rng(701), delay=0, **common)
    misaligned = polarity.simulate_block_sign_lms_tone(make_rng(701), delay=4, **common)
    assert abs(aligned[-1]) < 0.2
    assert abs(misaligned[-1]) > 100 * abs(misaligned[0])


# =============================================================================
# T08 §8.2 g = 1：Pole 0、PM 60°
# =============================================================================

PM_TABLE = [(0.2, 0.8, 84.3), (0.5, 0.5, 75.5), (1.0, 0.0, 60.0), (1.5, -0.5, 41.4), (1.8, -0.8, 25.8), (2.0, -1.0, 0.0)]


def test_T08_pole_and_pm_closed_form():
    assert stability.cal_pole(1.0) == 0.0
    assert stability.cal_pm_deg(1.0) == pytest.approx(60.0, abs=1e-12)


def test_T08_pm_by_numeric_crossover():
    """不用封閉式：數值解 |L(e^{jω})| = 1，PM = 180° + ∠L。"""
    wc, pm = stability.cal_pm_numeric(1.0)
    assert wc == pytest.approx(math.pi / 3, abs=1e-12)
    assert pm == pytest.approx(60.0, abs=1e-9)
    for g, pole, pm_spec in PM_TABLE:
        assert stability.cal_pole(g) == pytest.approx(pole, abs=1e-15)
        _wc, pm_num = stability.cal_pm_numeric(g)
        assert pm_num == pytest.approx(stability.cal_pm_deg(g), abs=1e-8)
        assert round(stability.cal_pm_deg(g), 1) == pm_spec


def test_T08_deadbeat_time_domain():
    """g = 1：理想模型一步歸零（δ_{k+1} = (1 − g)δ_k）。"""
    d = stability.simulate_delay_recursion(1.0, 0, 3, delta0=2.5)
    np.testing.assert_allclose(d, [2.5, 0.0, 0.0, 0.0], atol=0)


# =============================================================================
# T09 §8.4 雙迴路 r=.8, b=.2, c=1, μ=1.2 ⇒ |z| ≈ 1.01980 > 1
# =============================================================================


def test_T09_dual_loop_poles():
    a = stability.dual_loop_matrix(0.8, 0.2, 1.0, 1.2)
    z = np.linalg.eigvals(a)
    z = z[np.argsort(z.imag)]
    assert z[1].real == pytest.approx(0.9, abs=1e-14)
    assert z[1].imag == pytest.approx(math.sqrt(1.04 - 0.81), abs=1e-14)
    assert np.abs(z) == pytest.approx([math.sqrt(1.04)] * 2, abs=1e-14)
    assert round(float(np.abs(z[0])), 5) == 1.01980
    np.testing.assert_allclose(stability.dual_loop_char_poly(0.8, 0.2, 1.0, 1.2), [1.0, -1.8, 1.04], atol=1e-15)
    np.testing.assert_allclose(np.sort_complex(np.roots([1.0, -1.8, 1.04])), np.sort_complex(z), atol=1e-14)


def test_T09_dual_loop_simplified_vs_full_ranges():
    """時間尺度分離：0 < μ < 2；完整 2×2：0 < μ < 1（Jury 封閉式 + 掃描/brentq 兩種求法）。"""
    r, b, c = 0.8, 0.2, 1.0
    assert stability.dual_loop_simplified_mu_max(r, b, c) == pytest.approx(2.0, abs=1e-14)
    lo, hi = stability.dual_loop_full_mu_range_closed(r, b, c)
    assert lo == 0.0
    assert hi == pytest.approx(1.0, abs=1e-14)
    lo_n, hi_n = stability.stable_interval_numeric(lambda m: stability.spectral_radius(stability.dual_loop_matrix(r, b, c, m)), -1.0, 3.0)
    assert lo_n == pytest.approx(0.0, abs=1e-10)
    assert hi_n == pytest.approx(1.0, abs=1e-10)
    # 簡化模型的數值範圍
    simp = lambda m: abs(1.0 - m * c * b / (1.0 - r))  # noqa: E731
    lo_s, hi_s = stability.stable_interval_numeric(simp, -1.0, 3.0)
    assert lo_s == pytest.approx(0.0, abs=1e-10)
    assert hi_s == pytest.approx(2.0, abs=1e-10)
    # μ = 1.2：簡化預測穩定、完整模型發散
    assert simp(1.2) < 1.0
    assert stability.spectral_radius(stability.dual_loop_matrix(r, b, c, 1.2)) > 1.0
    # 一般化 A_combined 與 2×2 相同
    np.testing.assert_allclose(
        stability.combined_matrix(np.array([[r]]), np.array([b]), np.array([c]), 0.0, 1.2), stability.dual_loop_matrix(r, b, c, 1.2), atol=0
    )


def test_T09_time_domain_growth():
    """時域：‖x_k‖ 的對數成長斜率 = ln|z|（複數 Pole 對使 ‖x_k‖ 有界振盪，故用長區間最小平方斜率）。"""
    a = stability.dual_loop_matrix(0.8, 0.2, 1.0, 1.2)
    x = np.array([0.0, 1.0])
    log_norms = []
    for _ in range(3000):
        x = a @ x
        log_norms.append(math.log(float(np.linalg.norm(x))))
    slope = np.polyfit(np.arange(1, 3001), log_norms, 1)[0]
    assert math.exp(slope) == pytest.approx(math.sqrt(1.04), rel=1e-5)


# =============================================================================
# T10 §9 R = [[1,.99],[.99,1]]：eigenvalues 1.99、0.01；cond 199
# =============================================================================


def test_T10_eigenvalues_and_condition_number():
    r = mimo.corr2(0.99)
    vals, vecs = mimo.eig_sorted(r)
    np.testing.assert_allclose(vals, [1.99, 0.01], atol=1e-14)
    assert mimo.cond_number(r) == pytest.approx(199.0, rel=1e-12)
    s = 1 / math.sqrt(2)
    np.testing.assert_allclose(vecs[:, 0], [s, s], atol=1e-14)
    np.testing.assert_allclose(vecs[:, 1], [s, -s], atol=1e-14)


def test_T10_windowed_pe_estimate(make_rng):
    """§9.1 有限窗口：以 ρ = 0.99 的 Gaussian regressor 估 R_k、λ_min、κ（CI 由多窗口散佈估計）。"""
    rng = make_rng(1001)
    r = mimo.corr2(0.99)
    chol = np.linalg.cholesky(r)
    n0 = 20000
    lmins = []
    for k in range(40):
        u = rng.standard_normal((n0, 2)) @ chol.T
        lmins.append(mimo.eig_sorted(mimo.windowed_pe(u, n0, 0))[0][1])
    lm = np.array(lmins)
    assert_mc(lm.mean(), lm.std(ddof=1) / math.sqrt(lm.size), 0.01, z=5.0)


def test_T10_negative_missing_pe_rho_one():
    """反面：ρ = 1 ⇒ λ_min = 0；δ 沿 [1, −1]/√2 方向永遠不變（不可辨識），且兩組參數輸出相同。"""
    r = mimo.corr2(1.0)
    vals, vecs = mimo.eig_sorted(r)
    np.testing.assert_allclose(vals, [2.0, 0.0], atol=1e-15)
    assert mimo.cond_number(r) > 1e15  # 數值上奇異（σ_min 只剩捨入誤差）
    null = vecs[:, 1]
    traj = mimo.simulate_mean_lms(r, 0.5, np.array([1.0, -0.2]), 500)
    proj = traj @ null
    np.testing.assert_allclose(proj, proj[0], atol=1e-14)  # 該方向沒有任何恢復力
    assert abs(proj[0]) > 0.5
    # 相同 regressor u = [x, x]：參數 (a1, a2) 與 (a1 + c, a2 − c) 輸出完全相同
    x = np.linspace(-1, 1, 11)
    u = np.column_stack([x, x])
    np.testing.assert_allclose(u @ np.array([1.0, 2.0]), u @ np.array([1.7, 1.3]), atol=1e-15)
    # §9.2 one-hot + global offset：零空間 ∝ [1, −1, −1, −1, −1]
    ns = mimo.null_space(mimo.onehot_with_global_regressors(4))
    assert ns.shape[1] == 1
    v = ns[:, 0] / ns[0, 0]
    np.testing.assert_allclose(v, [1, -1, -1, -1, -1], atol=1e-12)


# =============================================================================
# T11 §9 μ = .5、λ_min = .01 ⇒ 慢 Pole .995、95% 衰減約 598 blocks
# =============================================================================


def test_T11_slow_pole_and_decay_count():
    poles = mimo.mean_lms_poles(mimo.corr2(0.99), 0.5)
    np.testing.assert_allclose(poles, [0.005, 0.995], atol=1e-14)
    assert mimo.steps_to_decay(0.995, 0.05) == 598
    assert mimo.steps_to_decay_real(0.995, 0.05) == pytest.approx(597.6473372217686, rel=1e-12)


def test_T11_time_domain_decay():
    r = mimo.corr2(0.99)
    s = 1 / math.sqrt(2)
    slow = np.array([s, -s])
    traj = mimo.simulate_mean_lms(r, 0.5, slow, 600)
    mag = np.abs(traj @ slow)
    assert mag[598] <= 0.05 < mag[597]


def test_T11_preconditioner_example():
    """§10.1：M = 0.5R⁻¹ ⇒ 所有 Pole 0.5（5 次下降 95%）；M 的元素約 ±25（R⁻¹ 本身約 ±50）。"""
    r = mimo.corr2(0.99)
    m = 0.5 * np.linalg.inv(r)
    a = np.eye(2) - m @ r
    np.testing.assert_allclose(np.linalg.eigvals(a), [0.5, 0.5], atol=1e-12)
    assert mimo.steps_to_decay(0.5, 0.05) == 5
    np.testing.assert_allclose(m, [[25.125628140703515, -24.874371859296481], [-24.874371859296481, 25.125628140703515]], rtol=1e-12)
    np.testing.assert_allclose(np.linalg.inv(r), 2 * m, rtol=1e-14)


# =============================================================================
# T12 §11.2 五值 x、c = 0.1、a = 1 ⇒ 最佳線性 gain 1.34
# =============================================================================

X5 = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
P5 = np.full(5, 0.2)


def test_T12_closed_form():
    assert bias.discrete_moment(X5, P5, 2) == pytest.approx(2.0, abs=1e-15)
    assert bias.discrete_moment(X5, P5, 4) == pytest.approx(6.8, abs=1e-14)
    assert bias.wstar_cubic(1.0, 0.1, X5, P5) == pytest.approx(1.34, abs=1e-14)
    assert bias.wstar_linearized(1.0, X5, P5, d_fn=lambda x: 0.1 * x**3) == pytest.approx(1.34, abs=1e-14)
    # 精確有理數
    ex2 = sum(Fraction(int(x)) ** 2 for x in X5) / 5
    ex4 = sum(Fraction(int(x)) ** 4 for x in X5) / 5
    assert 1 + Fraction(1, 10) * ex4 / ex2 == Fraction(67, 50)


def test_T12_least_squares_and_gmac_zero():
    y = 1.0 * X5 + 0.1 * X5**3
    w = bias.least_squares_gain(X5, y, P5)
    assert w == pytest.approx(1.34, abs=1e-14)
    e = (1.0 - w) * X5 + 0.1 * X5**3
    assert float(np.sum(P5 * X5 * e)) == pytest.approx(0.0, abs=1e-14)  # E[xe] = 0
    assert np.max(np.abs(e)) > 0.1  # 但 e ≠ 0


def test_T12_noise_free_sign_changes_sign_at_the_median():
    """技術審查 R05（勘誤 E01）：無雜訊（σ_v = 0）時，Sign-LMS 的固定點是 E[x·sign(e)] 的變號點，不是零點。

    全程用有理數（Fraction），浮點捨入不會把 e = 0 的 tie 翻成正負。
    e(x; w) = (1 − w)x + x³/10，x ∈ {−2, …, 2} 等機率：E[x·sign(e)] 是階梯函數——
    w < 11/10 為 +6/5，11/10 < w < 7/5 為 +2/5，w > 7/5 為 −6/5；w = 7/5 那一點是 −2/5
    （x = ±2 兩個 tie 的貢獻互相抵銷，所以與 sign(0) 的慣例無關）。階梯由正跳到負，沒有經過 0。
    7/5 是 MAE E|e| 的最小點（|x| 加權中位數）；MSE 的最小點是 67/50 = 1.34，兩者不同。
    """
    xs = [Fraction(k) for k in range(-2, 3)]
    p = Fraction(1, 5)
    c3 = Fraction(1, 10)

    def err(w: Fraction) -> list[Fraction]:
        return [(1 - w) * x + c3 * x**3 for x in xs]  # a = 1

    def sgn(v: Fraction, s0: int) -> int:
        return 1 if v > 0 else -1 if v < 0 else s0

    def mean_gmac(w: Fraction, s0: int = 0) -> Fraction:
        return sum((p * x * sgn(e, s0) for x, e in zip(xs, err(w))), Fraction(0))  # E[x·sign(e)]

    def mae(w: Fraction) -> Fraction:
        return sum((p * abs(e) for e in err(w)), Fraction(0))  # E|e|

    def mse(w: Fraction) -> Fraction:
        return sum((p * e * e for e in err(w)), Fraction(0))  # E[e²]

    w_med = Fraction(7, 5)
    w_mse = Fraction(67, 50)
    eps = Fraction(1, 10**9)

    # w = 7/5：x = ±2 與 x = 0 三個 code 的殘差剛好是 0（tie），x = ±1 的殘差是 ±3/10
    assert err(w_med) == [0, Fraction(3, 10), 0, Fraction(-3, 10), 0]
    for s0 in (0, 1, -1):
        assert mean_gmac(w_med, s0) == Fraction(-2, 5)  # 不是 0，三種 sign(0) 慣例都一樣
    assert mean_gmac(w_med - eps) == Fraction(2, 5)
    assert mean_gmac(w_med + eps) == Fraction(-6, 5)
    # 階梯的每一段（另一個 tie 點 11/10：x = ±1 的殘差是 0，那一點的值是 +4/5，同樣與 sign(0) 無關）
    assert mean_gmac(Fraction(1)) == Fraction(6, 5)
    assert mean_gmac(Fraction(5, 4)) == Fraction(2, 5)
    assert mean_gmac(Fraction(3, 2)) == Fraction(-6, 5)
    for s0 in (0, 1, -1):
        assert mean_gmac(Fraction(11, 10), s0) == Fraction(4, 5)

    # 0.9 ≤ w ≤ 1.7（步距 0.001，含 11/10 與 7/5 兩個 tie 點）：沒有任何 w 讓 E[x·sign(e)] = 0，而且恰好在 7/5 由正變負
    for k in range(900, 1701):
        w = Fraction(k, 1000)
        for s0 in (0, 1, -1):
            g = mean_gmac(w, s0)
            assert g != 0
            assert (g > 0) == (w < w_med)

    # 7/5 是 E|e| 的最小點：左右斜率 −2/5 與 +6/5（0 落在次梯度裡），不是「斜率 = 0」
    assert mae(w_med) == Fraction(3, 25)
    assert (mae(w_med) - mae(w_med - eps)) / eps == Fraction(-2, 5)
    assert (mae(w_med + eps) - mae(w_med)) / eps == Fraction(6, 5)
    assert mae(w_mse) == Fraction(18, 125)  # 0.144 > 0.12：1.34 不是 MAE 的最小點

    # MSE 的最小點才是 67/50：E[x·e] = 0，而且 E[e²] 比 7/5 小
    ex2 = sum((p * x**2 for x in xs), Fraction(0))
    ex4 = sum((p * x**4 for x in xs), Fraction(0))
    assert 1 + c3 * ex4 / ex2 == w_mse
    assert sum((p * x * e for x, e in zip(xs, err(w_mse))), Fraction(0)) == 0
    assert mse(w_mse) == Fraction(18, 625)  # 0.0288
    assert mse(w_med) == Fraction(9, 250)  # 0.036
    assert mean_gmac(w_mse) == Fraction(2, 5)  # 在 1.34，無雜訊的平均更新仍是正的（w 會繼續往 7/5 走）


def test_T12_sign_lms_fixed_point_approaches_1p34():
    """Sign-Error LMS 的精確平均固定點（有限 σ）→ 1.34。

    erf 展開到三次：E[xe] − E[xe³]/(6σ²) = 0 ⇒ w* ≈ 1.34 − E[x e₀³]/(6σ² E[x²])，
    e₀ = −0.34x + 0.1x³ ⇒ E[x e₀³] = −0.0041472 ⇒ 修正量 = +3.456e−4/σ²。
    """
    d_fn = lambda x: 0.1 * x**3  # noqa: E731
    e0 = -0.34 * X5 + 0.1 * X5**3
    ex_e03 = float(np.sum(P5 * X5 * e0**3))
    assert ex_e03 == pytest.approx(-0.0041472, abs=1e-15)
    coef = -ex_e03 / (6.0 * 2.0)
    assert coef == pytest.approx(3.456e-4, abs=1e-16)
    for sigma in (10.0, 30.0, 100.0):
        w = bias.sign_lms_fixed_point(1.0, X5, P5, sigma, d_fn=d_fn, bracket=(-10, 10))
        assert (w - 1.34) * sigma**2 == pytest.approx(coef, rel=2e-3)


def test_T12_monte_carlo_block_sign_lms(make_rng):
    ends = []
    for s in range(20):
        tr = bias.simulate_block_sign_lms_discrete(make_rng(1200 + s), 1.0, X5, P5, 1.0, 0.05, 4096, 300, 1.0, d_fn=lambda x: 0.1 * x**3)
        ends.append(tr[-1])
    e = np.array(ends)
    w_exact = bias.sign_lms_fixed_point(1.0, X5, P5, 1.0, d_fn=lambda x: 0.1 * x**3, bracket=(-10, 10))
    assert_mc(e.mean(), e.std(ddof=1) / math.sqrt(e.size), w_exact)
    assert abs(e.mean() - 1.34) < 0.01


# =============================================================================
# T13 §12.1 σ_v = 100 fs、N = 4096、μ = 10 fs ⇒ p ≈ .92021、σ_w ≈ .399 fs
# =============================================================================


def test_T13_closed_form():
    ex = noise.cal_noise_example(mu=10.0, sigma_v=SIGMA_V, c=1.0, n=4096, fs=4e9)
    assert ex.k == pytest.approx(0.007978845608028654, abs=1e-16)
    assert ex.p == pytest.approx(0.9202115439197135, abs=1e-14)
    assert round(ex.p, 5) == 0.92021
    assert ex.sigma_w == pytest.approx(0.3991861429909288, abs=1e-13)
    assert round(ex.sigma_w, 3) == 0.399
    assert ex.sigma_w == pytest.approx(10.0 / math.sqrt(4096 * (1 - ex.p**2)), abs=1e-15)


def test_T13_binomial_reduction_matches_raw_samples(make_rng):
    """Binomial 化簡與逐樣本模擬（真的產生 x = ±1、v、q）的一步轉移分布一致（均值、變異）。"""
    dw0, mu = 30.0, 10.0
    rng = make_rng(1301)
    nxt_raw = np.array([noise.simulate_block_sign_lms_raw(rng, dw0, mu, SIGMA_V, 4096, 1)[1] for _ in range(3000)])
    nxt_bin = noise.simulate_block_sign_lms_bpsk(make_rng(1302), dw0, mu, SIGMA_V, 4096, 1, 200000)
    m_q = comparator.mean_q(-dw0, SIGMA_V)
    mean_exact = dw0 + mu * m_q
    var_exact = mu * mu * (1 - m_q**2) / 4096  # σ_η² = (1 − m²)/N；規格近似為 1/N
    for x in (nxt_raw, nxt_bin):
        assert_mc(float(x.mean()), float(x.std(ddof=1)) / math.sqrt(x.size), mean_exact)
        _s2, lo, hi = noise.var_ci_chi2(x, Z_MC)
        assert lo <= var_exact <= hi


def test_T13_monte_carlo_sigma_w(make_rng):
    """20000 條獨立 chain、各跑 200 blocks（p^400 ≈ 4e-15，已達穩態）：σ_w 與 0.399 fs 一致。"""
    rng = make_rng(1303)
    dw = noise.simulate_block_sign_lms_bpsk(rng, 0.0, 10.0, SIGMA_V, 4096, 200, 20000)
    s2, lo, hi = noise.var_ci_chi2(dw, Z_MC)
    target = noise.cal_noise_example(10.0, SIGMA_V, 1.0, 4096, 4e9).sigma_w ** 2
    assert lo <= target <= hi
    assert math.sqrt(s2) == pytest.approx(0.399, abs=0.01)


def test_T13_negative_gmac_sum_vs_average_scaling(make_rng):
    """反面：RTL 用 Σ（sum）卻沿用為 average 設計的 μ ⇒ 有效 g 乘以 N。

    average：g = μK 與 N 無關；sum：g = N·μK。μ = 10 fs、N = 4096 ⇒ g ≈ 326.8，|1 − g| ≫ 1。
    若只在 N0 = 4096 時以 μ/N0 補償，改成 N = 32·N0 卻不重算 ⇒ g = 32·0.0798 = 2.55 > 2，發散。
    """
    mu, k = 10.0, KQ
    g_avg = mu * k
    for n in (256, 4096, 16384):
        g_sum = n * g_avg
        assert g_sum / g_avg == pytest.approx(n, rel=1e-15)
    assert abs(1 - 4096 * g_avg) > 1.0
    n0 = 4096
    for n, stable in [(4096, True), (2 * 4096, True), (32 * 4096, False)]:
        g = (mu / n0) * k * n
        assert (abs(1 - g) < 1) is stable
    # MC：sum 模式（G 乘 N）在數個 block 內就爆開；average 模式收斂
    rng = make_rng(1304)
    dw = np.full(500, 2.0)
    traj = [dw]
    for _ in range(6):
        kk = rng.binomial(4096, special.ndtr(-dw / SIGMA_V))
        dw = dw + mu * (2.0 * kk - 4096)  # 未除以 N
        traj.append(dw)
    tr = np.array(traj)
    # 第一個 block 的 ensemble 平均：E[dw_1] = dw_0 + μN·erf(−dw_0/(√2σ)) ≈ (1 − N·g_avg)·dw_0 ≈ −652 fs
    mean_field = 2.0 + mu * 4096 * comparator.mean_q(-2.0, SIGMA_V)
    assert mean_field == pytest.approx(-651.5, abs=0.5)
    assert_mc(float(tr[1].mean()), float(tr[1].std(ddof=1)) / math.sqrt(tr.shape[1]), mean_field)
    assert np.min(np.max(np.abs(tr[1:]), axis=0)) > 1000.0  # 每條 chain 都在 ±μN 量級間大幅擺盪，不會收斂
    ok = noise.simulate_block_sign_lms_bpsk(make_rng(1305), 2.0, mu, SIGMA_V, 4096, 200, 500)
    assert np.sqrt(np.mean(ok**2)) < 1.0


# =============================================================================
# T14 §12 f_s = 4 GHz ⇒ f_u = 976.5625 kHz、Noise BW「約 12.9 kHz」
# =============================================================================

P13 = 1.0 - 10.0 * KQ
FU = 4e9 / 4096


def test_T14_update_rate():
    assert FU == 976562.5


def test_T14_bw_definition_neg_ln_p_matches_spec():
    """−ln(p)/(2π)·f_u = 12.924 kHz ⇒ 四捨五入 12.9 kHz ✓。"""
    bw = noise.bw_neg_ln_p(P13, FU)
    assert bw == pytest.approx(12923.831540085783, rel=1e-12)
    assert round(bw / 1e3, 1) == 12.9


def test_T14_bw_definition_exact_minus3db_matches_spec():
    """精確 discrete-time −3 dB（|μ/(z−p)|² 降到 DC 的一半）= 12.931 kHz ⇒ 12.9 kHz ✓。"""
    closed = noise.bw_exact_3db_closed(P13, FU)
    numeric = noise.bw_exact_3db_numeric(P13, FU)
    assert closed == pytest.approx(12931.284485590351, rel=1e-12)
    assert numeric == pytest.approx(closed, rel=1e-10)
    assert round(closed / 1e3, 1) == 12.9


def test_T14_bw_definition_one_minus_p_does_not_match_spec():
    """(1−p)/(2π)·f_u = 12.401 kHz ⇒ 12.4 kHz，與規格「約 12.9 kHz」不符（規格寫兩式 ≈，實際差 4%）。"""
    bw = noise.bw_one_minus_p(P13, FU)
    assert bw == pytest.approx(12401.100768406435, rel=1e-12)
    assert round(bw / 1e3, 1) == 12.4
    assert round(bw / 1e3, 1) != 12.9


def test_T14_bw_definition_enbw_does_not_match_spec():
    """One-sided ENBW = f_u(1−p)/(2(1+p)) = 20.29 kHz ≈ (π/2)·f_3dB，不是 12.9 kHz。"""
    closed = noise.enbw_one_sided_closed(P13, FU)
    numeric = noise.enbw_one_sided_numeric(P13, FU)
    assert closed == pytest.approx(20289.018256251733, rel=1e-12)
    assert numeric == pytest.approx(closed, rel=1e-9)
    assert round(closed / 1e3, 1) == 20.3
    assert closed / noise.bw_exact_3db_closed(P13, FU) == pytest.approx(math.pi / 2, rel=2e-3)


def test_T14_psd_total_power_parseval():
    """(1/2π)∫S_w dΩ = μ²σ_η²/(1−p²)（PSD 總功率核對）。"""
    from scipy import integrate

    s_eta = 1.0 / 4096
    val, _ = integrate.quad(lambda om: float(noise.coef_noise_psd(10.0, P13, om, s_eta)), -math.pi, math.pi, limit=400, epsrel=1e-13)
    assert val / (2 * math.pi) == pytest.approx(noise.sigma_w2_closed(10.0, s_eta, P13), rel=1e-11)


def test_T14_psd_density_is_per_cycle_not_per_rad():
    """技術審查 C03：DTFT 形式的 S_w 是「每 cycle/block」的密度——對 Ω/2π 積分才是 σ_w²，直接對 Ω 積分會多 2π。

    noise.py 會整份顯示在第 12 章，所以連 docstring 的單位寫法一起固定（不可寫成 per rad）。
    """
    import inspect

    from scipy import integrate

    s_eta = 1.0 / 4096
    val, _ = integrate.quad(lambda om: float(noise.coef_noise_psd(10.0, P13, om, s_eta)), -math.pi, math.pi, limit=400, epsrel=1e-13)
    sw2 = noise.sigma_w2_closed(10.0, s_eta, P13)
    assert val / sw2 == pytest.approx(2 * math.pi, rel=1e-11)  # ∫S_w dΩ = 2πσ_w²：S_w 不是每 rad/block 的密度
    # DC 值的封閉式：S_w(1) = μ²S_η/(1 − p)²；除以 2π 才是每 rad/block 的密度
    assert float(noise.coef_noise_psd(10.0, P13, 0.0, s_eta)) == pytest.approx(100.0 * s_eta / (1.0 - P13) ** 2, rel=1e-13)
    doc = noise.coef_noise_psd.__doc__ or ''
    assert 'cycle/block' in doc
    assert 'per rad' not in inspect.getsource(noise)


def test_T14_monte_carlo_lag1_autocorrelation(make_rng):
    """MC 係數序列的 lag-1 自相關 ≈ p（low-pass 頻寬由 p 決定）。"""
    rng = make_rng(1401)
    tr = noise.simulate_block_sign_lms_bpsk(rng, 0.0, 10.0, SIGMA_V, 4096, 400, 4000, record=True)[100:]
    x0, x1 = tr[:-1].ravel(), tr[1:].ravel()
    rho1 = float(np.mean(x0 * x1) / np.mean(x0 * x0))
    # 粗略 SE：effective samples ≈ chains·(T/τ)，τ ≈ (1+p)/(1−p)
    eff = 4000 * 300 / ((1 + P13) / (1 - P13))
    se = (1 - P13**2) / math.sqrt(eff)
    assert_mc(rho1, se, P13)


# =============================================================================
# T15 §12.4 f_out = 13 GHz、0.5 fs peak ⇒ Spur ≈ −93.8 dBc
# =============================================================================


def test_T15_closed_form_spur():
    beta = noise.spur_beta(13e9, 0.5e-15)
    assert beta == pytest.approx(4.084070449666732e-05, rel=1e-13)
    assert round(beta * 1e5, 2) == 4.08
    dbc = noise.spur_dbc_small_angle(13e9, 0.5e-15)
    assert dbc == pytest.approx(-93.7987354132602, abs=1e-10)
    assert round(dbc, 1) == -93.8
    assert noise.spur_dbc_bessel(beta) == pytest.approx(dbc, abs=1e-6)  # 小角近似誤差 ~β²/8


def test_T15_time_domain_mixing_and_fft_spur():
    """δt = x·δw（100 kHz × 1 fs·cos 10 kHz）⇒ 90/110 kHz 各 0.5 fs；φ = 2πf_out δt 的 FFT sideband ≈ −93.8 dBc。"""
    fs = 2e6
    n = 2000  # 1 kHz bin：coherent
    t = np.arange(n) / fs
    x = np.cos(2 * np.pi * 1e5 * t)
    dwv = 1e-15 * np.cos(2 * np.pi * 1e4 * t)
    dt = x * dwv
    amps = noise.coherent_tone_amplitudes(dt, fs, [9e4, 1.1e5, 1e5, 1e4])
    assert amps[0] == pytest.approx(0.5e-15, rel=1e-10)
    assert amps[1] == pytest.approx(0.5e-15, rel=1e-10)
    assert amps[2] < 1e-27 and amps[3] < 1e-27
    phi = 2 * np.pi * 13e9 * dt  # |T| = 1；注入極性的負號不影響 spur 大小
    for f_off in (9e4, 1.1e5):
        assert noise.pm_sideband_dbc_fft(phi, fs, f_off) == pytest.approx(-93.7987354132602, abs=1e-3)


# =============================================================================
# T16 §13.2 週期 5 toggle 32,32,33,32,33 ⇒ mean 32.4、period 5
# =============================================================================


def test_T16_toggle_pattern_mean_and_period():
    pat = list(quantization.TOGGLE_PATTERN_5)
    assert quantization.pattern_mean(pat) == Fraction(162, 5)  # = 32.4 精確
    seq = pat * 20
    assert quantization.find_period(seq) == 5
    code, err = quantization.nearest_freeze(32.4)
    assert code == 32
    assert err == pytest.approx(-0.4, abs=1e-14)


def test_T16_toggle_line_spectrum():
    """週期 5 序列在 f_toggle/5 與 2f_toggle/5 有離散譜線（平均正確 ≠ 頻譜理想）。"""
    mags = quantization.line_spectrum(quantization.TOGGLE_PATTERN_5)
    assert mags[0] == pytest.approx(32.4, abs=1e-12)
    assert mags[1] == pytest.approx(0.12360679774997896, abs=1e-12)  # = (√5 − 1)/10
    assert mags[2] == pytest.approx(0.32360679774997896, abs=1e-12)  # = (√5 + 1)/10
    assert mags[1] == pytest.approx((math.sqrt(5) - 1) / 10, abs=1e-14)
    assert mags[2] == pytest.approx((math.sqrt(5) + 1) / 10, abs=1e-14)


def test_T16_first_order_ef_quantizer_on_constant_32p4():
    """§13.4 一階 error-feedback（round-to-nearest、r[−1] = 0）：輸出週期 5，循環 [32,33,32,33,32]。

    這是規格 pattern [32,32,33,32,33] 的循環位移；若改用 floor 量化則恰好得到規格 pattern。
    """
    res = quantization.ef_quantizer_first_order(Fraction(162, 5), 100)
    assert quantization.find_period(res.y) == 5
    assert res.y[:5] == [32, 33, 32, 33, 32]
    assert res.r[:5] == [Fraction(2, 5), Fraction(-1, 5), Fraction(1, 5), Fraction(-2, 5), Fraction(0)]
    assert quantization.pattern_mean(res.y[:5]) == Fraction(162, 5)
    # 是規格 pattern 的循環位移
    spec = list(quantization.TOGGLE_PATTERN_5)
    assert any(res.y[:5] == spec[i:] + spec[:i] for i in range(5))
    # y[n] = w + r[n−1] − r[n]（精確恆等式）、|r| ≤ 1/2
    r_prev = Fraction(0)
    for y, r in zip(res.y, res.r):
        assert y == Fraction(162, 5) + r_prev - r
        assert abs(r) <= Fraction(1, 2)
        r_prev = r
    # 累積平均誤差 ≤ 0.5/M（一階 noise shaping 的 telescoping）
    csum = Fraction(0)
    for m, y in enumerate(res.y, start=1):
        csum += y
        assert abs(csum / m - Fraction(162, 5)) <= Fraction(1, 2) / m
    # 浮點版本得到相同的 code 序列
    assert list(quantization.ef_quantizer_float(32.4, 100).astype(int)) == res.y
    # floor 量化：週期仍為 5，且循環正好是規格 pattern
    res_f = quantization.ef_quantizer_first_order(Fraction(162, 5), 50, rounding='floor')
    assert res_f.y[:5] == spec
    assert quantization.find_period(res_f.y) == 5


@pytest.mark.parametrize(('num', 'den'), [(0, 1), (1, 2), (1, 3), (1, 4), (2, 5), (3, 8), (7, 16)])
def test_T16_ef_quantizer_period_equals_denominator(num, den):
    """常數有理輸入 32 + num/den（最簡分數）⇒ 一階 EF 輸出週期 = den（決定性 limit cycle）。"""
    target = 32 + Fraction(num, den)
    res = quantization.ef_quantizer_first_order(target, 8 * den + 16)
    assert quantization.find_period(res.y) == den
    assert quantization.pattern_mean(res.y[:den]) == target


# =============================================================================
# T17 §13.3 隨機 32/33、P(33) = .4 ⇒ mean 32.4、variance 0.24 LSB²
# =============================================================================


def test_T17_closed_form():
    m, v = quantization.bernoulli_code_moments(32, 0.4)
    assert m == pytest.approx(32.4, abs=1e-14)
    assert v == pytest.approx(0.24, abs=1e-15)
    assert round(math.sqrt(v), 3) == 0.490


def test_T17_monte_carlo(make_rng):
    rng = make_rng(1701)
    n = 4_000_000
    y = quantization.stochastic_rounding(rng, 32.4, n)
    assert set(np.unique(y)) == {32.0, 33.0}
    se_mean = math.sqrt(0.24 / n)
    assert_mc(float(y.mean()), se_mean, 32.4)
    s2, lo, hi = noise.var_ci_chi2(y, Z_MC)
    assert lo <= 0.24 <= hi
    # 獨立 ⇒ 白：lag-1 自相關 ≈ 0
    c = y - y.mean()
    rho1 = float(np.mean(c[:-1] * c[1:]) / np.mean(c * c))
    assert abs(rho1) <= Z_MC / math.sqrt(n)


# =============================================================================
# T18 §10.2 J = [[-1,2],[2,-1]]、M = .2I ⇒ eig(I+MJ) = 1.2、0.4（發散）
# =============================================================================

J18 = np.array([[-1.0, 2.0], [2.0, -1.0]])


def test_T18_eigenvalues():
    a = mimo.jacobian_loop_matrix(J18, 0.2 * np.eye(2))
    np.testing.assert_allclose(a, [[0.8, 0.4], [0.4, 0.8]], atol=1e-15)
    np.testing.assert_allclose(np.sort(np.linalg.eigvals(a).real)[::-1], [1.2, 0.4], atol=1e-14)
    np.testing.assert_allclose(np.sort(np.linalg.eigvals(J18).real)[::-1], [1.0, -3.0], atol=1e-14)
    # 每個 loop 單獨：1 + 0.2·J_ii = 0.8 穩定
    np.testing.assert_allclose(1.0 + 0.2 * np.diag(J18), [0.8, 0.8], atol=1e-15)


def test_T18_time_domain_divergence():
    traj = mimo.simulate_jacobian_loop(J18, 0.2 * np.eye(2), np.zeros(2), np.array([0.01, 0.0]), 120)
    norms = np.linalg.norm(traj, axis=1)
    assert norms[-1] > 1e8 * norms[0]  # 1.2^120 ≈ 3.2e9（初值在發散方向上的分量為 1/√2）
    assert norms[-1] / norms[-2] == pytest.approx(1.2, rel=1e-9)
    s = 1 / math.sqrt(2)
    direction = traj[-1] / norms[-1]
    assert abs(direction @ np.array([s, s])) == pytest.approx(1.0, abs=1e-9)


def test_T18_regularized_pseudoinverse_fixes_divergence():
    """M = −γ(JᵀJ + λI)⁻¹Jᵀ ⇒ Pole 1 − γσ²/(σ² + λ)；σ(J) = {3, 1}。"""
    gamma, lam = 0.5, 0.1
    m = mimo.regularized_update_matrix(J18, gamma, lam)
    a = mimo.jacobian_loop_matrix(J18, m)
    poles = np.sort(np.linalg.eigvals(a).real)
    closed = np.sort(mimo.regularized_poles_closed(J18, gamma, lam))
    np.testing.assert_allclose(poles, closed, atol=1e-13)
    np.testing.assert_allclose(closed, np.sort([1 - 0.5 * 9 / 9.1, 1 - 0.5 / 1.1]), atol=1e-15)
    assert np.max(np.abs(poles)) < 1


def test_T18_finite_difference_jacobian_recovers_j():
    w_star = np.array([0.3, -0.7])
    g_fn = lambda w: J18 @ (w - w_star)  # noqa: E731
    j_hat = mimo.finite_difference_jacobian(g_fn, np.array([1.0, 2.0]), np.array([1e-3, 1e-3]))
    np.testing.assert_allclose(j_hat, J18, atol=1e-10)
