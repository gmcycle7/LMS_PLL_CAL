"""Ch11b（§11 延伸）：DTC INL 校正與噪聲折返的 golden 測試（test_S11b_*；沒有對應的 T-id）。

數字來源：lms_pll_golden/dtc_inl.py（NumPy 獨立實作）；TypeScript 端 src/simulation/models/dtcInl.test.ts 讀
golden/vectors/dtc_inl_*.json 比對。
"""

from __future__ import annotations

import math
from fractions import Fraction

import numpy as np
import pytest
from scipy import signal

from lms_pll_golden import dtc_inl as D

D2, D3 = 20.0, 10.0
NU_B = 0.01


# ───────────────────────── 噪聲折返 ─────────────────────────


def test_S11b_mash_autocorr_fractions():
    """R_r = (1/12)[6, −4, 1]（係數 [1, −2, 1] 的自相關 × 1/12）；正規化 x = r/2 ⇒ R_x = R_r/4。"""
    h = np.array([1.0, -2.0, 1.0])
    acf = np.correlate(h, h, 'full')[2:]  # lag 0, 1, 2
    np.testing.assert_allclose(acf / 12.0, D.MASH_RESIDUE_AUTOCORR, atol=1e-15)
    np.testing.assert_allclose(D.MASH_CODE_AUTOCORR, D.MASH_RESIDUE_AUTOCORR / 4.0, atol=1e-16)
    # 變異數：residue 1/2、正規化 1/8
    assert D.MASH_RESIDUE_AUTOCORR[0] == pytest.approx(0.5)
    assert D.MASH_CODE_AUTOCORR[0] == pytest.approx(0.125)


def test_S11b_gaussian_folding_exact_fractions():
    """S_2(0) = 2ΣR² = 35/576、S_3(0) = 6ΣR³ = 5/1024（正規化 MASH code，單位係數）。"""
    R = [Fraction(6, 48), Fraction(-4, 48), Fraction(1, 48)]
    s2 = 2 * (R[0] ** 2 + 2 * R[1] ** 2 + 2 * R[2] ** 2)
    s3 = 6 * (R[0] ** 3 + 2 * R[1] ** 3 + 2 * R[2] ** 3)
    assert s2 == Fraction(35, 576)
    assert s3 == Fraction(5, 1024)
    assert D.folded_psd_dc(D.MASH_CODE_AUTOCORR, 2) == pytest.approx(float(s2), abs=1e-15)
    assert D.folded_psd_dc(D.MASH_CODE_AUTOCORR, 3) == pytest.approx(float(s3), abs=1e-15)


def test_S11b_folding_dc_level_equals_psd_integral():
    """Σ_m R[m]² = ∫ S_x(ν)² dν（Parseval）：用 16 sin⁴(πν)/12 的 residue 理論 PSD 數值積分核對。"""
    nu = np.linspace(-0.5, 0.5, 200_001)
    s = (16.0 * np.sin(math.pi * nu) ** 4 / 12.0) / 4.0  # 正規化 x = r/2
    integral = np.trapezoid(s * s, nu)
    assert 2.0 * integral == pytest.approx(D.folded_psd_dc(D.MASH_CODE_AUTOCORR, 2), rel=1e-6)
    # x 本身的在 DC 的 PSD 是 0（40 dB/dec 整形），但 x² 的不是：這就是折返
    assert s[len(s) // 2] == 0.0


def test_S11b_uniform_kappa4_and_exact_linear_process():
    """uniform(0,1) 的 κ_4 = −1/120；MASH 精確式 S_2(0) = 35/576 − (1/120)(3/2)² = 121/2880。"""
    assert Fraction(1, 80) - Fraction(3, 144) == Fraction(-1, 120)
    assert D.UNIFORM_KAPPA4 == pytest.approx(-1.0 / 120.0, abs=1e-16)
    exact = Fraction(35, 576) - Fraction(1, 120) * Fraction(9, 4)
    assert exact == Fraction(121, 2880)
    assert D.folded_psd_dc_linear_process(D.MASH_CODE_AUTOCORR, D.MASH_CODE_FIR, D.UNIFORM_KAPPA4) == pytest.approx(float(exact), abs=1e-15)


def test_S11b_linear_process_formula_against_monte_carlo(make_rng):
    """h = [−½, 1, −½] 作用在 iid uniform 上：直接量 x² 的自相關加總，與精確式一致（Gaussian 式則高估約 45%）。"""
    rng = make_rng(1101)
    n = 2_000_000
    u = rng.uniform(0.0, 1.0, n + 2)
    x = -0.5 * u[2:] + 1.0 * u[1:-1] - 0.5 * u[:-2]
    y = x * x
    Ry = D.autocovariance(y, 6)
    s_dc = Ry[0] + 2.0 * Ry[1:].sum()
    exact = D.folded_psd_dc_linear_process(D.MASH_CODE_AUTOCORR, D.MASH_CODE_FIR, D.UNIFORM_KAPPA4)
    gauss = D.folded_psd_dc(D.MASH_CODE_AUTOCORR, 2)
    assert s_dc == pytest.approx(exact, rel=0.03)
    assert gauss / exact == pytest.approx(1.446, abs=0.01)
    # 峰度 ≈ 2.4（sub-Gaussian）
    kurt = np.mean(x**4) / np.mean(x**2) ** 2
    assert kurt == pytest.approx(2.4, abs=0.05)


def test_S11b_iid_uniform_var_x2():
    """iid uniform(−1, 1)：Var(x²) = 1/5 − 1/9 = 4/45；Gaussian 式 2σ⁴ = 2/9 高估 2.5 倍。"""
    assert Fraction(1, 5) - Fraction(1, 9) == Fraction(4, 45)
    assert D.iid_squared_psd_dc(1.0 / 5.0, 1.0 / 3.0) == pytest.approx(4.0 / 45.0, abs=1e-15)
    assert D.folded_psd_dc(D.UNIFORM_CODE_AUTOCORR, 2) == pytest.approx(2.0 / 9.0, abs=1e-15)


def test_S11b_folding_prediction_numbers():
    """d_2 = 20、ν_B = 0.01：P_in(Gauss) = 400·(35/576)·0.02 = 0.48611，rms 0.697；精確式 0.33611。"""
    pred = D.folding_prediction(D.MASH_CODE_AUTOCORR, D2, 0.0, NU_B)
    assert pred['Pin'] == pytest.approx(400.0 * 35.0 / 576.0 * 0.02, rel=1e-12)
    assert pred['residual_power'] == pytest.approx(2.0 * 400.0 * 0.125**2, rel=1e-12)
    assert pred['inband_fraction'] == pytest.approx(pred['Pin'] / 12.5, rel=1e-12)
    exact = D.inband_power(D2**2 * D.folded_psd_dc_linear_process(D.MASH_CODE_AUTOCORR, D.MASH_CODE_FIR, D.UNIFORM_KAPPA4), NU_B)
    assert exact == pytest.approx(400.0 * 121.0 / 2880.0 * 0.02, rel=1e-12)
    # 三次：gain 校正吸收 3d_3σ² = 3·10·0.125 = 3.75
    pred3 = D.folding_prediction(D.MASH_CODE_AUTOCORR, 0.0, D3, NU_B)
    assert pred3['gain_absorbed'] == pytest.approx(3.75)
    assert pred3['Pin'] == pytest.approx(100.0 * 5.0 / 1024.0 * 0.02, rel=1e-12)


def test_S11b_mash_residue_welch_inband_matches_exact_formula():
    """真的跑 MASH 1-1-1（20 bit、frac 0.618）：自相關 ≈ 理論、Welch 帶內折返功率 ≈ 精確式（Gaussian 式高估）。"""
    r = D.mash111_residue(0.618, 20, 1 << 16)
    x = r / 2.0
    assert np.max(np.abs(r)) < 2.0
    R = D.autocovariance(x, 3)
    np.testing.assert_allclose(R[:3], D.MASH_CODE_AUTOCORR, atol=4e-3)
    assert abs(R[3]) < 2e-3
    d = D2 * x * x
    y = d - d.mean()
    y -= (np.dot(x - x.mean(), y) / np.dot(x - x.mean(), x - x.mean())) * (x - x.mean())
    fs = 100e6
    f, psd = signal.welch(y, fs=fs, window='hann', nperseg=4096)
    fb = NU_B * fs
    mask = f <= fb
    pin = np.trapezoid(psd[mask], f[mask])
    exact = D.inband_power(D2**2 * D.folded_psd_dc_linear_process(D.MASH_CODE_AUTOCORR, D.MASH_CODE_FIR, D.UNIFORM_KAPPA4), NU_B)
    gauss = D.folding_prediction(D.MASH_CODE_AUTOCORR, D2, 0.0, NU_B)['Pin']
    assert pin == pytest.approx(exact, rel=0.08)
    assert gauss > 1.3 * pin


# ───────────────────────── 分段／LUT ─────────────────────────


def test_S11b_segment_lambdas_sum_to_Ex2():
    """K 段的 λ_k 加起來 = E[x²] = 1/3；最外段與最內段差 37 倍（K = 8）。"""
    for K in (1, 2, 4, 8, 16):
        assert sum(D.segment_lambda_uniform(k, K) for k in range(K)) == pytest.approx(1.0 / 3.0, abs=1e-15)
    outer = D.segment_lambda_uniform(7, 8)
    inner = D.segment_lambda_uniform(4, 8)
    assert outer == pytest.approx((1.0 - 0.75**3) / 6.0)
    assert inner == pytest.approx(0.25**3 / 6.0)
    assert outer / inner == pytest.approx(37.0, abs=1e-12)


def test_S11b_segment_and_lut_closed_forms():
    """μ = 2、σ_v = 10、N = 64：K_q = 0.0797885；最外段 g = 0.01536、k95 = 194；LUT 64 格 g = 0.002493、τ = 401。"""
    seg = D.segment_closed_form(7, 8, 2.0, 10.0, 64)
    assert seg['Kq'] == pytest.approx(0.0797884560802865, abs=1e-15)
    assert seg['g'] == pytest.approx(2.0 * seg['Kq'] * (1.0 - 0.75**3) / 6.0, rel=1e-12)
    assert seg['k95'] == math.ceil(math.log(0.05) / math.log(1.0 - seg['g']))
    assert seg['var_w'] == pytest.approx(4.0 * seg['lambda'] / (64.0 * (1.0 - seg['pole'] ** 2)), rel=1e-12)
    # 小 g 時 Var ≈ μ/(2K_qN)，與 λ 無關
    assert seg['var_w'] == pytest.approx(2.0 / (2.0 * seg['Kq'] * 64.0), rel=0.01)
    lut = D.lut_closed_form(64, 2.0, 10.0, 64)
    assert lut['g'] == pytest.approx(2.0 * lut['Kq'] / 64.0, rel=1e-12)
    assert lut['tau'] == pytest.approx(64.0 / (2.0 * lut['Kq']), rel=1e-12)
    assert lut['samples_per_bin_per_tau'] == pytest.approx(64.0 / (2.0 * lut['Kq']), rel=1e-12)
    assert lut['effective_samples'] == pytest.approx(2.0 * lut['samples_per_bin_per_tau'])
    assert lut['var_theta'] == pytest.approx(2.0 / (2.0 * lut['Kq'] * 64.0), rel=0.005)


def test_S11b_lut_approx_rms_closed_form_vs_numeric():
    """每格一個常數的近似誤差：封閉式 Δ√(E[d′²]/12) 與直接算（200k 格點）相差 < 1%（J = 64）。"""
    for d2, d3 in ((20.0, 0.0), (0.0, 10.0), (20.0, 10.0)):
        closed = D.lut_approx_rms(d2, d3, 64)
        numeric = D.lut_residual_numeric(lambda x, d2=d2, d3=d3: D.inl_value(x, d2, d3), 64)
        assert numeric == pytest.approx(closed, rel=0.01)
    assert D.lut_approx_rms(20.0, 0.0, 64) == pytest.approx((2.0 / 64.0) * math.sqrt((4.0 * 400.0 / 3.0) / 12.0), rel=1e-12)


def test_S11b_lut_sign_lms_converges_to_floor(make_rng):
    """LUT 16 格、d_2 = 20、σ_v = 10、μ = 2、N = 64：Sign-LMS 把殘餘 INL 從 ≈ 8.9 降到近似誤差下限附近（含 misadjustment）。"""
    rng = make_rng(1102)
    trace = D.simulate_lut_sign_lms(rng, lambda x: D.inl_value(x, 20.0), 16, 2.0, 10.0, 64, 2000)
    floor = D.lut_approx_rms(20.0, 0.0, 16)
    lut = D.lut_closed_form(16, 2.0, 10.0, 64)
    predicted = math.sqrt(floor**2 + 16 * (1.0 / 16.0) * lut['var_theta'])  # Σ λ_j Var(θ_j)
    tail = trace[-200:].mean()
    assert trace[0] == pytest.approx(math.sqrt(400.0 * (1.0 / 5.0 - 1.0 / 9.0) + (400.0 / 9.0)), rel=0.05)
    assert tail == pytest.approx(predicted, rel=0.25)
    assert tail < 0.25 * trace[0]


# ───────────────────────── 多項式基底 ─────────────────────────


def test_S11b_hankel_and_legendre_matrices():
    """monomial：R_mn = 1/(m+n+1)（m+n 偶）；Legendre diag 1/(2m+1)；normalized Legendre = I。"""
    R = D.uniform_moment_matrix('monomial', 3)
    np.testing.assert_allclose(R, D.hankel_from_moments(1.0 / 3.0, 1.0 / 5.0, 1.0 / 7.0), atol=1e-15)
    np.testing.assert_allclose(D.uniform_moment_matrix('legendre', 3), np.diag([1.0, 1.0 / 3.0, 1.0 / 5.0, 1.0 / 7.0]), atol=1e-15)
    np.testing.assert_allclose(D.uniform_moment_matrix('legendre_norm', 3), np.eye(4), atol=1e-14)
    assert D.cond_number(D.uniform_moment_matrix('legendre', 3)) == pytest.approx(7.0, rel=1e-12)
    assert D.cond_number(D.uniform_moment_matrix('legendre_norm', 3)) == pytest.approx(1.0, rel=1e-12)


def test_S11b_hankel_eigenvalues_by_hand():
    """偶／奇分塊的 2×2 特徵值（手算公式）= 4×4 的特徵值；條件數 67.5。"""
    R = D.uniform_moment_matrix('monomial', 3)
    lam = D.eig_desc(R)
    e_hi, e_lo = D.eig2(1.0, 1.0 / 3.0, 1.0 / 5.0)
    o_hi, o_lo = D.eig2(1.0 / 3.0, 1.0 / 5.0, 1.0 / 7.0)
    np.testing.assert_allclose(lam, sorted([e_hi, e_lo, o_hi, o_lo], reverse=True), rtol=1e-12)
    assert D.cond_number(R) == pytest.approx(e_hi / o_lo, rel=1e-10)
    assert 60.0 < D.cond_number(R) < 70.0


def test_S11b_chebyshev_not_orthogonal_under_uniform():
    """Chebyshev 在 uniform 權重下不正交（條件數約 5.9，介於 monomial 與 Legendre 之間）。"""
    R = D.uniform_moment_matrix('chebyshev', 3)
    assert R[0, 2] == pytest.approx(-1.0 / 3.0, rel=1e-12)  # E[T_0 T_2] = E[2x² − 1] = −1/3
    c = D.cond_number(R)
    assert 5.0 < c < 7.0


def test_S11b_mean_field_k95_monomial_vs_legendre():
    """同一個 INL（d_2 = 20、d_3 = 10）、同樣 μK_qλ_max = 0.1：Legendre 的 k95 比 monomial 快得多，normalized Legendre 最快。"""
    k_q = D.kq(10.0)
    results = {}
    for kind in ('monomial', 'legendre', 'legendre_norm', 'chebyshev'):
        R = D.uniform_moment_matrix(kind, 3)
        p = D.uniform_projection(kind, 3, D2, D3)
        theta = D.ls_theta(R, p)
        lam_max = D.eig_desc(R)[0]
        mu = 0.1 / (k_q * lam_max)
        results[kind] = D.mean_field_k95(R, -theta, k_q, mu)
    assert results['monomial'] > 3 * results['legendre']  # 560 vs 131（×4.3）
    assert results['legendre'] > results['legendre_norm']
    assert results['legendre_norm'] == math.ceil(math.log(0.05) / math.log(0.9))  # 所有 pole 都是 0.9
    # 同一個 d 在不同基底下的 LS 最佳解是同一條曲線（都是 d 本身：d ∈ span）
    for kind in ('monomial', 'legendre'):
        R = D.uniform_moment_matrix(kind, 3)
        theta = D.ls_theta(R, D.uniform_projection(kind, 3, D2, D3))
        poly = np.zeros(4)
        for m in range(4):
            c = D.basis_poly_coeffs(kind, m)
            poly[: c.size] += theta[m] * c
        np.testing.assert_allclose(poly, [0.0, 0.0, D2, D3], atol=1e-10)
