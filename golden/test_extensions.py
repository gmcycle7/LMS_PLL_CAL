"""規格中「非 T01–T18 表格」但已推導的結論，以及額外的反面測試。

命名：``test_S<章節>_...``（延伸驗證）與 ``test_NEG_...``（反面測試）。名稱中刻意不含 T-id，
``scripts/verify.mjs`` 會把它們列為「未對應 T-id 的測試」並另外回報。
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy import signal

from lms_pll_golden import bias, comparator, lms, mimo, noise, optimizer, polarity, quantization, stability

Z_MC = 4.0
SIGMA_V = 100.0
KQ = math.sqrt(2.0 / math.pi) / SIGMA_V


def assert_mc(estimate: float, se: float, expected: float, z: float = Z_MC) -> None:
    assert abs(estimate - expected) <= z * se, f'MC {estimate} ± {se} 與期望 {expected} 相差 {abs(estimate - expected) / se:.2f} SE'


# =============================================================================
# §2 MSE vs MAE：y = [0, 0, 0, 10]
# =============================================================================


def test_S2_l2_mean_vs_l1_median():
    y = np.array([0.0, 0.0, 0.0, 10.0])
    assert lms.l2_constant_fit(y) == 2.5
    assert lms.l1_constant_fit(y) == 0.0
    # 直接掃描成本函數驗證最小點（不依賴 mean/median 公式）
    grid = np.linspace(-5, 15, 200001)
    j2 = ((y[None, :] - grid[:, None]) ** 2).sum(axis=1)
    j1 = np.abs(y[None, :] - grid[:, None]).sum(axis=1)
    assert grid[np.argmin(j2)] == pytest.approx(2.5, abs=1e-4)
    assert grid[np.argmin(j1)] == pytest.approx(0.0, abs=1e-4)


def test_S2_sign_error_lms_limit_cycle_around_optimum():
    """固定步長 Sign-Error LMS 在最佳值附近以 ±μx² 跳動（不會精確停在 a）。"""
    w = lms.sign_error_lms_trace(a=3.0, w0=1.05, x=2.0, mu=0.1, steps=200)
    tail = w[-20:]
    assert np.max(np.abs(tail - 3.0)) <= 0.1 * 4 + 1e-12
    assert np.min(np.abs(tail - 3.0)) > 0.0


# =============================================================================
# §6.2 多頻判據：C = (1/2π)∫S_xx Re{H} dΩ
# =============================================================================


def test_S6_2_multifrequency_correlation_integral_vs_closed_vs_mc(make_rng):
    h = np.array([0.3, -0.8, 0.5])
    a1, s2 = 0.6, 1.0
    sxx = polarity.ar1_psd(a1, s2)
    hfun = lambda om: polarity.freq_response(h, np.array([1.0]), om)  # noqa: E731
    for d in (0, 1, 2, 3):
        integ = polarity.corr_from_psd(sxx, hfun, delay=d)
        closed = polarity.corr_fir_ar1_closed(h, a1, s2, delay=d)
        assert integ == pytest.approx(closed, abs=1e-11)
    # 時域 MC（batch means 標準誤）
    rng = make_rng(6201)
    n = 2_000_000
    w = rng.standard_normal(n)
    x = signal.lfilter([1.0], [1.0, -a1], w)[1000:]
    u = signal.lfilter(h, [1.0], x)
    prod = x[10:] * u[10:]
    batches = prod[: (prod.size // 1000) * 1000].reshape(-1, 1000).mean(axis=1)
    se = float(batches.std(ddof=1)) / math.sqrt(batches.size)
    assert_mc(float(prod.mean()), se, polarity.corr_fir_ar1_closed(h, a1, s2, 0))


# =============================================================================
# §8.3 一般純延遲：g_crit = 2 sin(π/(4d+2))
# =============================================================================


@pytest.mark.parametrize('d', range(7))
def test_S8_3_delay_bound_root_finding(d):
    closed = stability.delay_critical_gain_closed(d)
    numeric = stability.delay_critical_gain_numeric(d)
    assert numeric == pytest.approx(closed, abs=1e-11)
    # 臨界時的 unit-circle 根角度 = π/(2d+1)
    roots = np.roots(stability.delay_char_poly(closed, d))
    crit = roots[np.argmax(np.abs(roots))]
    assert abs(crit) == pytest.approx(1.0, abs=1e-12)
    assert abs(np.angle(crit)) == pytest.approx(math.pi / (2 * d + 1), abs=1e-9)
    # companion 矩陣與多項式一致
    ev = np.linalg.eigvals(stability.delay_companion(closed, d))
    assert np.max(np.abs(ev)) == pytest.approx(1.0, abs=1e-9)


def test_S8_3_delay_bound_spec_table():
    assert stability.delay_critical_gain_closed(0) == pytest.approx(2.0, abs=1e-15)
    assert stability.delay_critical_gain_closed(1) == pytest.approx(1.0, abs=1e-15)
    assert stability.delay_critical_gain_closed(2) == pytest.approx(0.6180339887498948, abs=1e-15)
    assert round(stability.delay_critical_gain_closed(2), 3) == 0.618


@pytest.mark.parametrize('d', [0, 1, 2, 4, 6])
def test_S8_3_delay_bound_time_domain(d):
    gc = stability.delay_critical_gain_closed(d)
    below = stability.simulate_delay_recursion(0.98 * gc, d, 5000)
    above = stability.simulate_delay_recursion(1.02 * gc, d, 5000)
    assert abs(below[-1]) < 1e-3
    assert np.max(np.abs(above[-200:])) > 1e3


# =============================================================================
# §10.1 完整 Preconditioning 的穩態變異 γ/(K_q² N λ_i (2−γ))
# =============================================================================


@pytest.mark.parametrize('gamma', [0.5, 1.0, 1.5])
def test_S10_1_preconditioned_steady_state_variance_monte_carlo(make_rng, gamma):
    r = mimo.corr2(0.99)
    n = 4096
    rng = make_rng(10100 + int(10 * gamma))
    blocks = 80 if gamma != 1.0 else 5  # Pole 1 − γ；γ = 1 時一步即達穩態
    d = mimo.simulate_preconditioned_lms(rng, r, KQ, n, gamma, chains=40000, blocks=blocks)
    vals, vecs = mimo.eig_sorted(r)
    proj = d @ vecs
    for i, lam in enumerate(vals):
        _s2, lo, hi = noise.var_ci_chi2(proj[:, i], Z_MC)
        closed = mimo.preconditioned_var_closed(gamma, KQ, n, lam)
        assert lo <= closed <= hi
    # 兩模式的變異比 = λ_max/λ_min = 199（弱資訊方向的雜訊被放大）
    assert mimo.preconditioned_var_closed(gamma, KQ, n, 0.01) / mimo.preconditioned_var_closed(gamma, KQ, n, 1.99) == pytest.approx(199.0, rel=1e-12)


def test_S10_1_preconditioned_variance_reference_numbers():
    assert mimo.preconditioned_var_closed(0.5, KQ, 4096, 1.99) == pytest.approx(0.642370514189967, rel=1e-12)
    assert mimo.preconditioned_var_closed(0.5, KQ, 4096, 0.01) == pytest.approx(127.83173232380344, rel=1e-12)


def test_S10_ideal_preconditioner_poles():
    r = np.array([[2.0, 0.5, 0.1], [0.5, 1.0, 0.3], [0.1, 0.3, 0.5]])
    m = mimo.preconditioner_ideal(r, KQ, 0.3)
    a = np.eye(3) - m @ (KQ * r)
    np.testing.assert_allclose(np.linalg.eigvals(a).real, [0.7, 0.7, 0.7], atol=1e-12)


# =============================================================================
# §11 Bias
# =============================================================================


def test_S11_1_comparator_offset_gain_bias():
    """w* − a = b E[x]/E[x²]；與 Sign-LMS 精確固定點（大 σ）比對。"""
    vals = np.array([0.5, 1.0, 1.5])
    probs = np.full(3, 1 / 3)
    b, a = 2.0, 10.0
    ex = bias.discrete_moment(vals, probs, 1)
    ex2 = bias.discrete_moment(vals, probs, 2)
    lin = a + bias.offset_gain_bias(b, ex, ex2)
    assert lin - a == pytest.approx(2.0 / (3.5 / 3.0), abs=1e-14)
    exact = bias.sign_lms_fixed_point(a, vals, probs, SIGMA_V, b=b, bracket=(a - 100, a + 100))
    assert exact == pytest.approx(lin, rel=1e-4)
    # 零均值 code（中心化）時 offset 不再造成 gain bias
    zm = np.array([-1.0, 1.0])
    pz = np.array([0.5, 0.5])
    assert bias.sign_lms_fixed_point(a, zm, pz, SIGMA_V, b=b, bracket=(a - 100, a + 100)) == pytest.approx(a, abs=1e-9)


def test_S11_3_code_correlated_jitter_shifts_gain():
    vals = np.array([-2.0, -1.0, 1.0, 2.0])
    probs = np.full(4, 0.25)
    c = 0.07
    ex2 = bias.discrete_moment(vals, probs, 2)
    assert bias.wstar_linearized(1.0, vals, probs, u_corr=c * ex2) == pytest.approx(1.0 + c, abs=1e-15)


# =============================================================================
# §12 σ_w² 公式（線性模型 MC）
# =============================================================================


def test_S12_1_white_noise_coefficient_variance_linear_model(make_rng):
    p, mu, s2 = 0.92, 10.0, 1.0 / 4096
    tr = optimizer.simulate_linear_msd(make_rng(12100), 0.0, p, mu, s2, 300, 40000)
    _v, lo, hi = noise.var_ci_chi2(tr[-1], Z_MC)
    assert lo <= noise.sigma_w2_closed(mu, s2, p) <= hi


# =============================================================================
# §14 E[δ_B²] 與 μ 設計
# =============================================================================

MU14, N14, SIG14 = 10.0, 4096, 100.0
P14 = 1.0 - MU14 * KQ


@pytest.mark.parametrize('blocks', [0, 5, 10, 20, 40, 80])
def test_S14_msd_formula_linear_model_monte_carlo(make_rng, blocks):
    """線性 Gaussian 模型 δ_{k+1} = pδ_k + μη_k：公式為精確式。"""
    tr = optimizer.simulate_linear_msd(make_rng(14000 + blocks), 20.0, P14, MU14, 1.0 / N14, max(blocks, 1), 40000)
    x2 = tr[blocks] ** 2
    expected = float(optimizer.msd_after_blocks(20.0, P14, MU14, 1.0 / N14, blocks))
    if blocks == 0:
        assert np.all(x2 == 400.0) and expected == 400.0
        return
    assert_mc(float(x2.mean()), float(x2.std(ddof=1)) / math.sqrt(x2.size), expected)


def test_S14_msd_formula_vs_sign_gmac_monte_carlo(make_rng):
    """實際 Block Sign-GMAC（x = ±1、Gaussian comparator）：公式為近似（erf 壓縮使初期收斂略慢），相對誤差 < 2%。"""
    traj = noise.simulate_block_sign_lms_bpsk(make_rng(14100), 20.0, MU14, SIG14, N14, 80, 40000, record=True)
    for b in (5, 10, 20, 40, 80):
        x2 = traj[b] ** 2
        est = float(x2.mean())
        se = float(x2.std(ddof=1)) / math.sqrt(x2.size)
        expected = float(optimizer.msd_after_blocks(20.0, P14, MU14, 1.0 / N14, b))
        assert abs(est - expected) <= 0.02 * expected + Z_MC * se
    # B → ∞ 的極限 = σ_w²
    assert float(optimizer.msd_after_blocks(20.0, P14, MU14, 1.0 / N14, 10_000)) == pytest.approx(
        noise.sigma_w2_closed(MU14, 1.0 / N14, P14), rel=1e-12
    )


def test_S14_1_corner_based_mu_interval():
    lo, hi = optimizer.mu_interval_corner(k_min=0.004, k_max=0.012, eps=0.01, blocks=100)
    assert (1.0 - lo * 0.004) ** 100 == pytest.approx(0.01, rel=1e-12)  # 最慢 corner 剛好降到 ε
    assert hi * 0.012 == pytest.approx(1.0, abs=1e-15)  # 最快 corner 的 g = 1（PM = 60°）
    assert stability.cal_pm_deg(hi * 0.012) == pytest.approx(60.0, abs=1e-12)
    assert lo < hi
    lo10, hi10 = optimizer.mu_interval_corner(0.004, 0.012, 0.01, 10)
    assert lo10 > hi10  # 沒有交集：不是「找個更好的 μ」能解決


def test_S14_optimal_mu_matches_grid_search():
    k = KQ
    mu_opt, msd_opt = optimizer.optimal_mu_final_rms(delta0=50.0, k=k, sigma_eta2=1.0 / 4096, blocks=60)
    grid = np.linspace(1e-6, 1.0 / k, 200001)
    vals = optimizer.msd_after_blocks(50.0, 1.0 - grid * k, grid, 1.0 / 4096, 60)
    assert msd_opt == pytest.approx(float(vals.min()), rel=1e-6)
    assert mu_opt == pytest.approx(float(grid[np.argmin(vals)]), rel=2e-3)
    rows = optimizer.optimal_budget_split(50.0, k, 4096 * 64, [1024, 4096, 16384])
    assert [r['B'] for r in rows] == [256.0, 64.0, 16.0]


# =============================================================================
# 反面測試（規格 §17 末段的其餘項目）
# =============================================================================


def test_NEG_fixed_point_gmac_overflow_flips_sign():
    """6-bit 有號輸入、N = 4096：需 6 + 12 = 18 bit；17-bit 暫存器 wrap 後符號翻轉。"""
    assert quantization.accumulator_bits_required(6, 4096) == 18
    samples = [31] * 4096  # 最壞情況正值
    assert quantization.gmac_accumulate(samples, 18) == 31 * 4096
    wrapped = quantization.gmac_accumulate(samples, 17)
    assert wrapped == 31 * 4096 - 2**17
    assert wrapped < 0  # 正相關被讀成負 ⇒ 更新方向錯誤
    assert quantization.gmac_accumulate(samples, 17, mode='saturate') == 2**16 - 1  # 飽和至少不翻號
    assert quantization.gmac_accumulate([-32] * 4096, 18) == -(2**17)


def test_NEG_aliasing_low_sample_rate():
    """0.6 f_s 的 tone 以 f_s 取樣後出現在 0.4 f_s；Nyquist 以上的 GMAC 相關性會被誤判。"""
    n = 1000
    k = np.arange(n)
    x = np.cos(2 * np.pi * 0.6 * k)
    spec = np.abs(np.fft.rfft(x))
    assert int(np.argmax(spec)) == 400
    np.testing.assert_allclose(x, np.cos(2 * np.pi * 0.4 * k), atol=1e-9)


def test_NEG_pd_path_vs_output_path_confusion():
    """H_PD = 1/(1+L) 與 T = L/(1+L)：低頻 PD residual 很小，但輸出路徑 |T| ≈ 1（PD Error 小 ≠ Output Noise 小）。"""
    zeta = 0.7
    for w in (0.01, 0.1, 0.3, 1.0, 3.0):
        hpd = polarity.hpd_second_order(w, zeta)
        s = 1j * w
        t = (2 * zeta * s + 1) / (s * s + 2 * zeta * s + 1)
        assert hpd + t == pytest.approx(1.0 + 0j, abs=1e-14)
    hpd = polarity.hpd_second_order(0.1, zeta)
    t = 1 - hpd
    assert abs(hpd) < 0.011
    assert abs(t) > 1.0


def test_NEG_wrong_formula_is_detected_by_cross_check(make_rng):
    """「模型公式有錯，UI 卻顯示成功」：交叉比對必須能抓到被竄改的公式。"""
    g = 1.0
    _wc, pm_numeric = stability.cal_pm_numeric(g)
    wrong_pm = 90.0 - math.degrees(math.asin(min(g, 1.0)))  # 漏掉 /2
    assert abs(wrong_pm - pm_numeric) > 1.0
    assert abs(stability.cal_pm_deg(g) - pm_numeric) < 1e-8
    # σ_w：漏掉平方根內的 (1 − p²) → 用 (1 − p) 會被 MC 抓到
    dw = noise.simulate_block_sign_lms_bpsk(make_rng(99001), 0.0, 10.0, SIGMA_V, 4096, 200, 20000)
    _s2, lo, hi = noise.var_ci_chi2(dw, Z_MC)
    p = 1.0 - 10.0 * KQ
    right = 100.0 / (4096 * (1 - p * p))
    wrong = 100.0 / (4096 * (1 - p))
    assert lo <= right <= hi
    assert not (lo <= wrong <= hi)


def test_NEG_gauge_freedom_onehot_global_offset():
    """§9.2：b' = b + c、a_i' = a_i − c 對所有 one-hot 輸入輸出相同 ⇒ 不可同時辨識。"""
    regs = mimo.onehot_with_global_regressors(4)
    theta = np.array([0.3, 1.0, -0.5, 0.2, 0.7])
    theta2 = theta + 0.9 * np.array([1, -1, -1, -1, -1])
    np.testing.assert_allclose(regs @ theta, regs @ theta2, atol=1e-15)
    r = regs.T @ regs / regs.shape[0]
    vals, _ = mimo.eig_sorted(r)
    assert vals[-1] == pytest.approx(0.0, abs=1e-15)
    # 固定一個 phase 當 reference（移除 a_0 欄）後可辨識
    r_ref = np.delete(np.delete(r, 1, axis=0), 1, axis=1)
    assert mimo.eig_sorted(r_ref)[0][-1] > 0.05


def test_NEG_comparator_large_offset_saturates_kq():
    """K_q 只是小訊號增益：|s| ≫ σ 時 E[q] 飽和到 ±1，線性化失效。"""
    assert comparator.mean_q(500.0, SIGMA_V) == pytest.approx(1.0, abs=1e-6)
    assert KQ * 500.0 > 3.9  # 線性外插會給出 > 1 的不可能值
