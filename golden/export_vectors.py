"""輸出 golden test vectors：``golden/vectors/T01.json … T18.json`` 與延伸 vectors。

用法（專案根目錄）::

    python3 golden/export_vectors.py          # 寫入 golden/vectors/
    python3 golden/export_vectors.py --check  # 只比對磁碟上的 vectors 是否最新（不寫檔）

每個 JSON 的格式::

    {
      "id": "T05",
      "description_zh": "...",
      "spec_section": "§5",
      "inputs": {...},
      "expected": {...},                 # 只放確定性（封閉式 / 數值求根 / 精確 binomial）的值
      "tolerance": {"abs": 1e-12} | {"rel": 1e-9} | {"abs": ..., "rel": ...},
      "tolerance_overrides": {"key": {...}},   # 選用：個別 key 的容忍度
      "notes": "..."
    }

判定規則（與 numpy.isclose 相同）：``|actual − expected| ≤ abs + rel·|expected|``；陣列逐元素比較。
Monte Carlo 結果不放進 vectors（TypeScript 的 RNG 不同，應各自以 CI 驗證期望值）。
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from fractions import Fraction
from pathlib import Path
from typing import Any

import numpy as np

GOLDEN_DIR = Path(__file__).resolve().parent
if str(GOLDEN_DIR) not in sys.path:
    sys.path.insert(0, str(GOLDEN_DIR))

from lms_pll_golden import (  # noqa: E402
    __version__,
    bias,
    comparator,
    lms,
    mimo,
    noise,
    optimizer,
    polarity,
    quantization,
    stability,
)

VECTORS_DIR = GOLDEN_DIR / 'vectors'
SCHEMA_VERSION = 1


def _f(x: Any) -> Any:
    """轉成 JSON 友善型別；拒絕 NaN / inf。"""
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, Fraction):
        return _f(float(x))
    if isinstance(x, (float, np.floating)):
        v = float(x)
        if not math.isfinite(v):
            raise ValueError(f'non-finite value {v}')
        return v
    if isinstance(x, complex):
        return {'re': _f(x.real), 'im': _f(x.imag)}
    if isinstance(x, np.ndarray):
        return [_f(v) for v in x.tolist()]
    if isinstance(x, (list, tuple)):
        return [_f(v) for v in x]
    if isinstance(x, dict):
        return {str(k): _f(v) for k, v in x.items()}
    if isinstance(x, str) or x is None:
        return x
    raise TypeError(f'unsupported type {type(x)}')


def vector(
    vid: str,
    description_zh: str,
    spec_section: str,
    inputs: dict[str, Any],
    expected: dict[str, Any],
    tolerance: dict[str, float],
    notes: str,
    tolerance_overrides: dict[str, dict[str, float]] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        'id': vid,
        'description_zh': description_zh,
        'spec_section': spec_section,
        'inputs': _f(inputs),
        'expected': _f(expected),
        'tolerance': _f(tolerance),
    }
    if tolerance_overrides:
        out['tolerance_overrides'] = _f(tolerance_overrides)
    out['notes'] = notes
    return out


SIGMA_V = 100.0
KQ = comparator.kq(SIGMA_V)
OMEGA = math.pi / 6


def build_vectors() -> dict[str, dict[str, Any]]:
    v: dict[str, dict[str, Any]] = {}

    # ---------------- T01 ----------------
    tr = lms.lms_trace(3.0, 1.0, 2.0, 0.1, 5)
    v['T01'] = vector(
        'T01',
        '手算 LMS：a=3、w0=1、x=2、μ=0.1，前兩步 w1=1.8、w2=2.28',
        '§1.2',
        {'a': 3.0, 'w0': 1.0, 'x': 2.0, 'mu': 0.1, 'steps': 5},
        {'w1': tr.w[1], 'w2': tr.w[2], 'e0': tr.e[0], 'e1': tr.e[1], 'pole': lms.fixed_x_pole(0.1, 2.0), 'w_trace': tr.w, 'e_trace': tr.e},
        {'abs': 1e-12},
        '無雜訊、固定 x；e_n = a·x − w_n·x；w_{n+1} = w_n + μ e_n x。w_trace 長度 steps+1。精確值 w1 = 9/5、w2 = 57/25。',
    )

    # ---------------- T02 ----------------
    mus = [0.1, 0.25, 0.4, 0.49, 0.5, 0.51, -0.01]
    v['T02'] = vector(
        'T02',
        '固定 x=2 的 LMS 穩定區間 0 < μ < 0.5（Pole p = 1 − μx²）',
        '§3',
        {'x': 2.0, 'mu_list': mus},
        {
            'mu_min': 0.0,
            'mu_max': lms.fixed_x_mu_bound(2.0),
            'mu_one_step': 0.25,
            'pole_list': [lms.fixed_x_pole(m, 2.0) for m in mus],
            'converges_list': [1 if abs(lms.fixed_x_pole(m, 2.0)) < 1 else 0 for m in mus],
        },
        {'abs': 1e-12},
        'converges_list：1 = |p| < 1（漸近收斂），0 = 不收斂（μ=0.5 時 p = −1 為邊界：|δ| 不變、正負交替）。',
    )

    # ---------------- T03 ----------------
    mu_grid = [0.3, 0.6, 2.0 / 3.0, 0.7, 1.0, 1.9]
    v['T03'] = vector(
        'T03',
        'Gaussian regressor（E[x²]=1、E[x⁴]=3）：mean 上限 2、mean-square 上限 2/3',
        '§3.1',
        {'Ex2': 1.0, 'Ex4': 3.0, 'distribution': 'gaussian', 'mu_list': mu_grid},
        {
            'mu_mean_max': lms.mean_mu_bound(1.0),
            'mu_ms_max': lms.mean_square_mu_bound(1.0, 3.0),
            'ms_factor_list': [lms.mean_square_factor(m, 1.0, 3.0) for m in mu_grid],
            'mean_factor_list': [1.0 - m for m in mu_grid],
            'mu_ms_max_bpsk': lms.mean_square_mu_bound(*lms.REGRESSOR_MOMENTS['bpsk']),
            'mu_ms_max_uniform': lms.mean_square_mu_bound(*lms.REGRESSOR_MOMENTS['uniform']),
        },
        {'abs': 1e-12},
        'ms_factor = E[(1−μx²)²] = 1 − 2μE[x²] + μ²E[x⁴]（< 1 才均方收斂）；mean_factor = 1 − μE[x²]。'
        '假設 x_n iid 且與 δ_n 獨立、無外加量測雜訊。bpsk = ±1（E[x⁴]=1）、uniform = U(−√3, √3)（E[x⁴]=9/5）。',
    )

    # ---------------- T04 ----------------
    v['T04'] = vector(
        'T04',
        '1-bit Comparator：s=1 fs、σ_v=100 fs ⇒ P(q=+1) ≈ 0.503989、K_q ≈ 0.00797885/fs',
        '§5、§5.1',
        {'s_fs': 1.0, 'sigma_fs': SIGMA_V},
        {
            'p_plus': comparator.p_plus(1.0, SIGMA_V),
            'p_minus': 1.0 - comparator.p_plus(1.0, SIGMA_V),
            'mean_q': comparator.mean_q(1.0, SIGMA_V),
            'kq_per_fs': KQ,
            'kq_times_s': KQ * 1.0,
            'wrong_encoding_mean_update_at_w_eq_a': bias.sign_lms_mean_gmac(
                300.0, 300.0, np.array([-1.0, -0.5, 0.0, 0.5, 1.0, 1.5]), np.full(6, 1 / 6), SIGMA_V, encoding='unipolar'
            ),
            'wrong_encoding_fixed_point_shift_fs': bias.sign_lms_fixed_point(
                300.0, np.array([-1.0, -0.5, 0.0, 0.5, 1.0, 1.5]), np.full(6, 1 / 6), SIGMA_V, bracket=(-700.0, 1300.0), encoding='unipolar'
            )
            - 300.0,
        },
        {'abs': 1e-12},
        'E[q] = erf(s/(√2σ)) 與 K_q·s 相差約 (s/σ)²/6 的相對量。'
        'wrong_encoding_*：反面測試，把 0/1 位元直接當 q（應 q = 2b − 1），code 取 {−1,−0.5,0,0.5,1,1.5} 等機率、a = 300 fs，'
        '在 w = a 時 E[b·x] = E[x]/2 = 0.125 ≠ 0，Sign-LMS 固定點偏移約 +41.27 fs。',
        tolerance_overrides={'wrong_encoding_fixed_point_shift_fs': {'abs': 1e-6}},
    )

    # ---------------- T05 ----------------
    pp = comparator.p_plus(1.0, SIGMA_V)
    m = comparator.mean_q(1.0, SIGMA_V)
    n_list = [100, 1000, 10000, 42500, 85000]
    v['T05'] = vector(
        'T05',
        'Comparator 方向判斷：N ≈ 42500 時 P(G_N > 0) ≈ 95%（iid / CLT）；規格未定義平手，各種解讀分列',
        '§5',
        {'s_fs': 1.0, 'sigma_fs': SIGMA_V, 'N_list': n_list, 'targets': [0.95, 0.99]},
        {
            'm': m,
            'p_clt_list': [comparator.direction_prob_clt(m, n) for n in n_list],
            'p_exact_split_list': [comparator.direction_prob_exact(pp, n, 'split') for n in n_list],
            'p_exact_strict_list': [comparator.direction_prob_exact(pp, n, 'strict') for n in n_list],
            'p_exact_odd_Nplus1_list': [comparator.direction_prob_exact(pp, n + 1) for n in n_list],
            'N_clt_95': comparator.n_for_target_clt(m, 0.95),
            'N_clt_99': comparator.n_for_target_clt(m, 0.99),
            'N_exact_odd_95': comparator.n_for_target_exact(pp, 0.95, 'odd'),
            'N_exact_odd_99': comparator.n_for_target_exact(pp, 0.99, 'odd'),
            'N_exact_even_split_95': comparator.n_for_target_exact(pp, 0.95, 'even', 'split'),
            'N_exact_even_strict_95': comparator.n_for_target_exact(pp, 0.95, 'even', 'strict'),
        },
        {'abs': 1e-9},
        'G_N = Σq_i = 2K − N，K ~ Bin(N, P(+1))。CLT：Φ(m√N/√(1−m²))（規格表格所用，無連續性修正）。'
        'split：偶數 N 平手算 1/2（等於奇數 N−1 的值）；strict：只算 G_N > 0（N=100 時僅 49.2%，與表格不符）。'
        'N_* 為整數門檻（需完全相等）。',
        tolerance_overrides={
            'N_exact_odd_95': {'abs': 0},
            'N_exact_odd_99': {'abs': 0},
            'N_exact_even_split_95': {'abs': 0},
            'N_exact_even_strict_95': {'abs': 0},
            'N_clt_95': {'rel': 1e-9},
            'N_clt_99': {'rel': 1e-9},
        },
    )

    # ---------------- T06 ----------------
    h = polarity.hpd_second_order(0.3, 0.7)
    c6 = polarity.single_tone_corr(1.0, 1.0, math.radians(120.0))
    fir = polarity.fir_with_response(1.0, math.radians(120.0), OMEGA)
    v['T06'] = vector(
        'T06',
        '單頻 x = A cos Ωn、φ = 120°：C = (A²/2)|H|cos φ < 0 ⇒ 正步長平均發散',
        '§6、§6.1',
        {'A': 1.0, 'H_mag': 1.0, 'phi_deg': 120.0, 'Omega_rad': OMEGA, 'mu': 10.0, 'kq_per_fs': KQ, 'hpd_w_over_wn': 0.3, 'hpd_zeta': 0.7},
        {
            'C': c6,
            'C_sign': -1,
            'pole': polarity.cal_pole(10.0, KQ, c6),
            'C_at_phi_list_deg': [polarity.single_tone_corr(1.0, 1.0, math.radians(d)) for d in (0, 60, 90, 120, 180)],
            'fir_h': fir,
            'hpd_re': h.real,
            'hpd_im': h.imag,
            'hpd_phase_deg': math.degrees(math.atan2(h.imag, h.real)),
            'reversed_polarity_pole': polarity.cal_pole(10.0, KQ, -1.0),
        },
        {'abs': 1e-12},
        'C_at_phi_list_deg 對應 φ = 0, 60, 90, 120, 180°（A = |H| = 1）。fir_h 是在 Ω 有 |H|e^{j120°} 的 2-tap 因果 FIR（h0 + h1 z⁻¹），'
        '可用時域整數週期平均交叉驗證 C。hpd_* 為 §6.1 的 H_PD(s)=s²/(s²+2ζω_n s+ω_n²) 在 ω = 0.3ω_n。'
        'reversed_polarity_pole：反面測試，comparator 極性接反（C=1、μ=10 fs）時 p = 1 + μK_q > 1。',
    )

    # ---------------- T07 ----------------
    phi7 = math.radians(-120.0)
    v['T07'] = vector(
        'T07',
        'Delay Alignment：φ = −120°、Ω = π/6、D = 4 ⇒ 殘餘相位 0°、單頻相關性正最大',
        '§7、§8.1',
        {'A': 1.0, 'H_mag': 1.0, 'phi_deg': -120.0, 'Omega_rad': OMEGA, 'D': 4, 'D_list': list(range(12))},
        {
            'theta_deg': polarity.wrap180(math.degrees(phi7 + OMEGA * 4)),
            'C_D': polarity.single_tone_corr(1.0, 1.0, phi7, OMEGA, 4),
            'C_D_list': [polarity.single_tone_corr(1.0, 1.0, phi7, OMEGA, d) for d in range(12)],
            'best_D': polarity.best_delay(phi7, OMEGA, 11),
            'polarity_margin_deg': polarity.polarity_margin_deg(math.degrees(phi7 + OMEGA * 4)),
            'misaligned_C_D_list_phi0': [polarity.single_tone_corr(1.0, 1.0, 0.0, OMEGA, d) for d in range(12)],
        },
        {'abs': 1e-12},
        'C_D = (A²/2)|H|cos(φ + ΩD)，GMAC 使用 x[n−D]。misaligned_C_D_list_phi0：反面測試，H = 1（φ = 0）但 code 錯位 D，'
        'ΩD > 90°（D ≥ 4）時相關性變號。',
    )

    # ---------------- T08 ----------------
    g_tab = [0.2, 0.5, 1.0, 1.5, 1.8, 2.0]
    v['T08'] = vector(
        'T08',
        '一階 Calibration Loop L(z) = g/(z−1)：g = 1 ⇒ Pole 0、PM 60°',
        '§8.2',
        {'g': 1.0, 'g_list': g_tab},
        {
            'pole': stability.cal_pole(1.0),
            'pm_deg': stability.cal_pm_deg(1.0),
            'crossover_omega_rad': stability.cal_pm_numeric(1.0)[0],
            'pole_list': [stability.cal_pole(g) for g in g_tab],
            'pm_deg_list': [stability.cal_pm_deg(g) for g in g_tab],
        },
        {'abs': 1e-9},
        'PM = 90° − asin(g/2)（0 < g ≤ 2）；crossover ω_c = 2 asin(g/2) rad/block。已用數值 crossover 交叉驗證。',
    )

    # ---------------- T09 ----------------
    a9 = stability.dual_loop_matrix(0.8, 0.2, 1.0, 1.2)
    z9 = np.linalg.eigvals(a9)
    zpos = z9[np.argmax(z9.imag)]
    v['T09'] = vector(
        'T09',
        '雙迴路 r=0.8、b=0.2、c=1、μ=1.2：|z| ≈ 1.01980 > 1（簡化模型卻預測穩定）',
        '§8.4',
        {'r': 0.8, 'b': 0.2, 'c': 1.0, 'mu': 1.2},
        {
            'pole_re': zpos.real,
            'pole_im': zpos.imag,
            'pole_abs': abs(zpos),
            'char_poly': stability.dual_loop_char_poly(0.8, 0.2, 1.0, 1.2),
            'mu_max_full': stability.dual_loop_full_mu_range_closed(0.8, 0.2, 1.0)[1],
            'mu_min_full': stability.dual_loop_full_mu_range_closed(0.8, 0.2, 1.0)[0],
            'mu_max_simplified': stability.dual_loop_simplified_mu_max(0.8, 0.2, 1.0),
            'simplified_pole_at_mu': 1.0 - 1.2 * 1.0 * 0.2 / (1.0 - 0.8),
        },
        {'abs': 1e-12},
        '完整模型 A = [[r, b], [−μc, 1]]，特徵式 z² − (1+r)z + (r + μbc)；Jury ⇒ 0 < μ < (1−r)/(bc) = 1。'
        '時間尺度分離（s = bδ/(1−r) = δ）⇒ 0 < μ < 2(1−r)/(bc) = 2。char_poly 為降冪係數。',
    )

    # ---------------- T10 ----------------
    r10 = mimo.corr2(0.99)
    vals10, vecs10 = mimo.eig_sorted(r10)
    v['T10'] = vector(
        'T10',
        'R = [[1, .99], [.99, 1]]：eigenvalues 1.99、0.01；condition number 199',
        '§9',
        {'R': r10, 'rho_missing_pe': 1.0},
        {
            'eig_max': vals10[0],
            'eig_min': vals10[1],
            'cond': mimo.cond_number(r10),
            'eigvec_max': vecs10[:, 0],
            'eigvec_min': vecs10[:, 1],
            'missing_pe_eig_list': mimo.eig_sorted(mimo.corr2(1.0))[0],
        },
        {'abs': 1e-12},
        'eigenvector 正規化：單位長度、第一個非零分量為正。missing_pe_eig_list：反面測試 ρ = 1 ⇒ eigenvalues [2, 0]，'
        '[1, −1]/√2 方向不可辨識（cond = ∞；浮點 SVD 會給 ~1e17）。',
        tolerance_overrides={'cond': {'rel': 1e-10}},
    )

    # ---------------- T11 ----------------
    m11 = 0.5 * np.linalg.inv(r10)
    v['T11'] = vector(
        'T11',
        'μ = 0.5、λ_min = 0.01 ⇒ 慢 Pole 0.995、95% 衰減約 598 blocks',
        '§9、§10.1',
        {'mu': 0.5, 'lambda_min': 0.01, 'lambda_max': 1.99, 'decay_fraction': 0.05},
        {
            'slow_pole': 1.0 - 0.5 * 0.01,
            'fast_pole': 1.0 - 0.5 * 1.99,
            'blocks_95': mimo.steps_to_decay(0.995, 0.05),
            'blocks_95_real': mimo.steps_to_decay_real(0.995, 0.05),
            'preconditioned_pole': 0.5,
            'preconditioned_blocks_95': mimo.steps_to_decay(0.5, 0.05),
            'preconditioner_M': m11,
        },
        {'abs': 1e-9},
        'blocks_95 = ceil(log 0.05 / log 0.995)（整數，需完全相等）。preconditioner_M = 0.5·R⁻¹，元素約 ±25'
        '（規格「反矩陣元素約 ±25」指的是 M；R⁻¹ 本身約 ±50）。',
        tolerance_overrides={'blocks_95': {'abs': 0}, 'preconditioned_blocks_95': {'abs': 0}},
    )

    # ---------------- T12 ----------------
    x5 = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
    p5 = np.full(5, 0.2)
    v['T12'] = vector(
        'T12',
        '三階 DTC INL：x ∈ {−2,−1,0,1,2} 等機率、a = 1、c = 0.1 ⇒ 單係數 LMS 最佳線性 gain 1.34',
        '§11.2',
        {'x_values': x5, 'x_probs': p5, 'a': 1.0, 'c3': 0.1, 'sigma_list': [10.0, 100.0]},
        {
            'Ex2': bias.discrete_moment(x5, p5, 2),
            'Ex4': bias.discrete_moment(x5, p5, 4),
            'w_star': bias.wstar_cubic(1.0, 0.1, x5, p5),
            'sign_lms_w_star_list': [
                bias.sign_lms_fixed_point(1.0, x5, p5, s, d_fn=lambda x: 0.1 * x**3, bracket=(-10.0, 10.0)) for s in (10.0, 100.0)
            ],
        },
        {'abs': 1e-12},
        'e = (a − w)x + c x³；E[xe] = 0 ⇒ w* = a + cE[x⁴]/E[x²]。sign_lms_w_star_list：Sign-Error LMS 在 Gaussian 雜訊 σ 下的'
        '精確平均固定點（解 E[erf(e/(√2σ))·x] = 0），≈ 1.34 + 3.456e−4/σ²。',
        tolerance_overrides={'sign_lms_w_star_list': {'abs': 1e-10}},
    )

    # ---------------- T13 ----------------
    ex13 = noise.cal_noise_example(10.0, SIGMA_V, 1.0, 4096, 4e9)
    v['T13'] = vector(
        'T13',
        'σ_v = 100 fs、N = 4096、μ = 10 fs、C = 1 ⇒ p ≈ 0.92021、σ_w ≈ 0.399 fs',
        '§12.1',
        {'sigma_v_fs': SIGMA_V, 'N': 4096, 'mu_fs': 10.0, 'C': 1.0, 'sigma_eta2': 1.0 / 4096},
        {
            'K_per_fs': ex13.k,
            'g': ex13.g,
            'p': ex13.p,
            'sigma_w_fs': ex13.sigma_w,
            'sigma_w2_fs2': ex13.sigma_w**2,
            'g_sum_mode': 4096 * ex13.g,
            'pole_sum_mode': 1.0 - 4096 * ex13.g,
        },
        {'abs': 1e-12},
        'K = K_q·C、g = μK、p = 1 − g、σ_w = μ/√(N(1 − p²))（σ_η² ≈ 1/N；x = ±1 時精確值為 (1 − m²)/N）。'
        'g_sum_mode / pole_sum_mode：反面測試，GMAC 用總和卻沿用 average 的 μ ⇒ g 乘以 N。0.399 fs 是 gain-equivalent noise，不是 output jitter。',
        tolerance_overrides={'g_sum_mode': {'rel': 1e-12}, 'pole_sum_mode': {'rel': 1e-12}},
    )

    # ---------------- T14 ----------------
    p14 = ex13.p
    fu = 4e9 / 4096
    v['T14'] = vector(
        'T14',
        'f_s = 4 GHz、N = 4096 ⇒ f_u = 976.5625 kHz；Calibration Noise BW「約 12.9 kHz」（四種定義分列）',
        '§12',
        {'fs_hz': 4e9, 'N': 4096, 'p': p14},
        {
            'f_u_hz': fu,
            'bw_one_minus_p_hz': noise.bw_one_minus_p(p14, fu),
            'bw_neg_ln_p_hz': noise.bw_neg_ln_p(p14, fu),
            'bw_exact_3db_hz': noise.bw_exact_3db_closed(p14, fu),
            'enbw_one_sided_hz': noise.enbw_one_sided_closed(p14, fu),
        },
        {'rel': 1e-10},
        '規格的「約 12.9 kHz」只符合 −ln(p)/(2π)·f_u（12.924 kHz）與精確 discrete-time −3 dB（12.931 kHz）；'
        '(1−p)/(2π)·f_u = 12.401 kHz（≈ 12.4 kHz，不符），one-sided ENBW = f_u(1−p)/(2(1+p)) = 20.29 kHz（不符）。'
        '−3 dB：|μ/(e^{jΩ}−p)|² 降到 DC 的一半，cos Ω = (1 + p² − 2(1−p)²)/(2p)。',
    )

    # ---------------- T15 ----------------
    beta = noise.spur_beta(13e9, 0.5e-15)
    v['T15'] = vector(
        'T15',
        'f_out = 13 GHz、output timing tone 0.5 fs peak、|T| = 1 ⇒ 單邊 Spur ≈ −93.8 dBc',
        '§12.2、§12.4',
        {'f_out_hz': 13e9, 'At_peak_s': 0.5e-15, 'fx_hz': 1e5, 'fw_hz': 1e4, 'x_amp': 1.0, 'dw_amp_s': 1e-15},
        {
            'beta_rad': beta,
            'spur_dbc': noise.spur_dbc_small_angle(13e9, 0.5e-15),
            'spur_dbc_bessel': noise.spur_dbc_bessel(beta),
            'mixing_tone_freqs_hz': [9e4, 1.1e5],
            'mixing_tone_peak_s': [0.5e-15, 0.5e-15],
        },
        {'abs': 1e-9},
        'β = 2π f_out A_t；小角 PM 單邊 spur = 20 log10(β/2) = 20 log10(π f_out A_t)；精確 J1(β)/J0(β) 版本差 < 1e−8 dB。'
        'δt = x·δw：cos(2π·100k t) × 1 fs·cos(2π·10k t) ⇒ 90/110 kHz 各 0.5 fs peak。',
        tolerance_overrides={'beta_rad': {'rel': 1e-12}, 'mixing_tone_peak_s': {'abs': 1e-27}},
    )

    # ---------------- T16 ----------------
    pat = list(quantization.TOGGLE_PATTERN_5)
    mags = quantization.line_spectrum(pat)
    code, err = quantization.nearest_freeze(32.4)
    ef = quantization.ef_quantizer_first_order(Fraction(162, 5), 20)
    v['T16'] = vector(
        'T16',
        '目標 32.4 LSB、週期 5 toggle [32,32,33,32,33] ⇒ 平均 32.4、週期 5',
        '§13.1、§13.2、§13.4',
        {'target_lsb': 32.4, 'pattern': pat, 'bits': 6},
        {
            'mean': quantization.pattern_mean(pat),
            'period': quantization.find_period(pat * 4),
            'freeze_code': code,
            'freeze_error_lsb': err,
            'dft_mag_list': mags,
            'ef_period': quantization.find_period(ef.y),
            'ef_cycle': ef.y[:5],
        },
        {'abs': 1e-12},
        'dft_mag_list[k] = |DFT{pattern}[k]|/5：k=0 為平均，k=1、2 為 f_toggle/5、2f_toggle/5 的譜線（(√5∓1)/10）。'
        'ef_*：一階 error-feedback quantizer（round-half-up、r[−1] = 0）在常數 32.4 的輸出，週期 5，'
        '循環 [32,33,32,33,32] 是規格 pattern 的循環位移。詳見 quantizer_first_order.json。',
        tolerance_overrides={'period': {'abs': 0}, 'ef_period': {'abs': 0}, 'freeze_code': {'abs': 0}, 'ef_cycle': {'abs': 0}},
    )

    # ---------------- T17 ----------------
    m17, var17 = quantization.bernoulli_code_moments(32, 0.4)
    v['T17'] = vector(
        'T17',
        'Stochastic Rounding：32/33 隨機切換、P(33) = 0.4 ⇒ 平均 32.4、變異 0.24 LSB²',
        '§13.3',
        {'low_code': 32, 'high_code': 33, 'p_high': 0.4},
        {'mean': m17, 'variance': var17, 'rms': math.sqrt(var17)},
        {'abs': 1e-12},
        '每次獨立的 Bernoulli：E = 32 + p、Var = p(1−p)。TypeScript 端應以自己的 seed 做 MC，並用 CI（例如 ±4 SE）比對此期望值。',
    )

    # ---------------- T18 ----------------
    j18 = np.array([[-1.0, 2.0], [2.0, -1.0]])
    a18 = mimo.jacobian_loop_matrix(j18, 0.2 * np.eye(2))
    v['T18'] = vector(
        'T18',
        'J = [[−1, 2], [2, −1]]、M = 0.2I ⇒ eig(I + MJ) = 1.2、0.4（一起更新時發散）',
        '§10.2',
        {'J': j18, 'M': 0.2 * np.eye(2), 'reg_gamma': 0.5, 'reg_lambda': 0.1},
        {
            'A': a18,
            'eig_A_desc': np.sort(np.linalg.eigvals(a18).real)[::-1],
            'eig_J_desc': np.sort(np.linalg.eigvals(j18).real)[::-1],
            'single_loop_poles': 1.0 + 0.2 * np.diag(j18),
            'spectral_radius': stability.spectral_radius(a18),
            'reg_poles_desc': np.sort(mimo.regularized_poles_closed(j18, 0.5, 0.1))[::-1],
        },
        {'abs': 1e-12},
        'G(w) ≈ J(w − w*)、w_{k+1} = w_k + MG_k ⇒ A = I + MJ。每個 loop 單獨（1 + 0.2J_ii = 0.8）穩定，但 MIMO 一起更新發散。'
        'reg_poles_desc：M = −γ(JᵀJ + λI)⁻¹Jᵀ 時 p_i = 1 − γσ_i²/(σ_i² + λ)，σ(J) = {3, 1}。',
    )

    # ---------------- 延伸：delay bounds ----------------
    ds = list(range(7))
    v['delay_bounds'] = vector(
        'delay_bounds',
        '更新延遲 d 個 block：δ_{k+1} = δ_k − gδ_{k−d} 的臨界增益 g_crit = 2 sin(π/(4d+2))',
        '§8.3',
        {'d_list': ds},
        {
            'g_crit_list': [stability.delay_critical_gain_closed(d) for d in ds],
            'omega_crit_rad_list': [math.pi / (2 * d + 1) for d in ds],
        },
        {'abs': 1e-12},
        '特徵式 z^{d+1} − z^d + g = 0；臨界時 unit-circle 根的角度 ω = π/(2d+1)。已用掃描 + brentq（不使用封閉式）驗證 d = 0..6。'
        '只對此特定特徵方程有效。',
    )

    # ---------------- 延伸：comparator S-curve table ----------------
    ratios = [-3.0, -2.0, -1.5, -1.0, -0.5, -0.1, -0.01, 0.0, 0.01, 0.1, 0.5, 1.0, 1.5, 2.0, 3.0]
    v['comparator_table'] = vector(
        'comparator_table',
        'Gaussian Comparator S 曲線：s/σ 對 P(+1)、E[q] 與小訊號線性近似',
        '§5、§5.1',
        {'s_over_sigma_list': ratios},
        {
            'p_plus_list': [comparator.p_plus(r, 1.0) for r in ratios],
            'mean_q_list': [comparator.mean_q(r, 1.0) for r in ratios],
            'linear_approx_list': [math.sqrt(2 / math.pi) * r for r in ratios],
            'n_clt_95_s1_sigma100': comparator.n_for_target_clt(comparator.mean_q(1.0, 100.0), 0.95),
        },
        {'abs': 1e-12},
        'E[q] = erf(r/√2)、P(+1) = Φ(r)；linear_approx = √(2/π)·r 只在 |r| ≪ 1 有效（|r| 大時 E[q] 飽和到 ±1）。',
        tolerance_overrides={'n_clt_95_s1_sigma100': {'rel': 1e-9}},
    )

    # ---------------- 延伸：first-order EF quantizer ----------------
    ef40 = quantization.ef_quantizer_first_order(Fraction(162, 5), 40)
    eff = quantization.ef_quantizer_first_order(Fraction(162, 5), 10, rounding='floor')
    targets = [(0, 1), (1, 2), (1, 3), (1, 4), (2, 5), (3, 8), (7, 16)]
    periods = []
    for num, den in targets:
        res = quantization.ef_quantizer_first_order(32 + Fraction(num, den), 8 * den + 16)
        periods.append(quantization.find_period(res.y))
    v['quantizer_first_order'] = vector(
        'quantizer_first_order',
        '一階 Error-Feedback Quantizer 對常數 32.4 的輸出：週期 5 的決定性 limit cycle',
        '§13.4',
        {'target_lsb': 32.4, 'bits': 6, 'r_init': 0.0, 'rounding': 'nearest (round-half-up)', 'steps': 40, 'rational_targets': [32 + n / d for n, d in targets]},
        {
            'y': ef40.y,
            'r': ef40.r,
            'period': quantization.find_period(ef40.y),
            'cycle': ef40.y[:5],
            'cycle_mean': quantization.pattern_mean(ef40.y[:5]),
            'y_floor_rounding_first10': eff.y,
            'period_list': periods,
        },
        {'abs': 1e-12},
        'v[n] = w + r[n−1]、y[n] = Q(v[n])、r[n] = v[n] − y[n] ⇒ y = w + r[n−1] − r[n]。精確有理數運算（32.4 = 162/5）。'
        'r 序列為 [0.4, −0.2, 0.2, −0.4, 0] 循環。若改用 floor 量化，循環恰為規格的 [32,32,33,32,33]。'
        'period_list：常數 32 + num/den（最簡分數）時週期 = den。浮點實作時建議用整數/定點累加以免 tie 判斷受捨入誤差影響。',
        tolerance_overrides={'y': {'abs': 0}, 'period': {'abs': 0}, 'cycle': {'abs': 0}, 'y_floor_rounding_first10': {'abs': 0}, 'period_list': {'abs': 0}},
    )

    # ---------------- 延伸：preconditioned variance ----------------
    v['preconditioner_variance'] = vector(
        'preconditioner_variance',
        '完整 Preconditioning 的穩態變異 Var(δ_i) = γ/(K_q² N λ_i (2 − γ))',
        '§10.1',
        {'R': r10, 'kq_per_fs': KQ, 'N': 4096, 'gamma_list': [0.5, 1.0, 1.5]},
        {
            'var_lambda_max_list': [mimo.preconditioned_var_closed(g, KQ, 4096, 1.99) for g in (0.5, 1.0, 1.5)],
            'var_lambda_min_list': [mimo.preconditioned_var_closed(g, KQ, 4096, 0.01) for g in (0.5, 1.0, 1.5)],
        },
        {'rel': 1e-12},
        '模型：G = K_q R δ + η、η ~ N(0, R/N)、M = γ(K_q R)⁻¹（δ = a − w）。在此線性 Gaussian 模型下為精確式，pytest 以 MC 驗證。',
    )

    # ---------------- 延伸：§14 MSD ----------------
    bl = [0, 5, 10, 20, 40, 80]
    p14b = 1.0 - 10.0 * KQ
    v['msd_after_blocks'] = vector(
        'msd_after_blocks',
        '§14 E[δ_B²] = δ0² p^{2B} + μ²σ_η²(1 − p^{2B})/(1 − p²)',
        '§14、§14.1',
        {'delta0_fs': 20.0, 'mu_fs': 10.0, 'kq_per_fs': KQ, 'sigma_eta2': 1.0 / 4096, 'B_list': bl, 'corner': {'k_min': 0.004, 'k_max': 0.012, 'eps': 0.01, 'B': 100}},
        {
            'p': p14b,
            'msd_list': optimizer.msd_after_blocks(20.0, p14b, 10.0, 1.0 / 4096, np.array(bl)),
            'corner_mu_lo': optimizer.mu_interval_corner(0.004, 0.012, 0.01, 100)[0],
            'corner_mu_hi': optimizer.mu_interval_corner(0.004, 0.012, 0.01, 100)[1],
        },
        {'rel': 1e-11},
        '線性 Gaussian 模型下為精確式；實際 Block Sign-GMAC 為近似（MC 相對誤差 < 2%）。corner：(1 − ε^{1/B})/K_min ≤ μ ≤ 1/K_max。',
    )

    # ---------------- 反面測試彙整 ----------------
    v['negative_tests'] = vector(
        'negative_tests',
        '規格 §17 反面測試的關鍵數值（極性反轉、缺乏 PE、sum/average scaling、0/1 編碼、code 錯位、overflow）',
        '§17',
        {'mu_fs': 10.0, 'kq_per_fs': KQ, 'N': 4096, 'Omega_rad': OMEGA, 'gmac_input_bits': 6},
        {
            'reversed_polarity_pole': 1.0 + 10.0 * KQ,
            'missing_pe_eig_min': 0.0,
            'sum_mode_gain_multiplier': 4096,
            'wrong_encoding_update_at_truth_zero_mean_code': 0.0,
            'wrong_encoding_update_at_truth_dc_code': 0.125,
            'misaligned_C_D4_phi0': polarity.single_tone_corr(1.0, 1.0, 0.0, OMEGA, 4),
            'gmac_bits_required': quantization.accumulator_bits_required(6, 4096),
            'gmac_17bit_wrapped_sum': quantization.wrap_twos_complement(31 * 4096, 17),
        },
        {'abs': 1e-12},
        'wrong_encoding_*：把 0/1 當 q 時，在 w = a 的平均更新 = E[x]/2（零均值 code 為 0、DC code {−1..1.5} 為 0.125）。'
        'gmac_17bit_wrapped_sum：31×4096 在 17-bit two\'s complement 下 wrap 成 −4096（符號翻轉）。',
        tolerance_overrides={'sum_mode_gain_multiplier': {'abs': 0}, 'gmac_bits_required': {'abs': 0}, 'gmac_17bit_wrapped_sum': {'abs': 0}},
    )

    return v


def build_index(vectors: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        'schema_version': SCHEMA_VERSION,
        'golden_model_version': __version__,
        'generator': 'golden/export_vectors.py',
        'comparison_rule': '|actual − expected| ≤ abs + rel·|expected|（逐元素）；tolerance_overrides 覆寫個別 key',
        'vectors': [
            {'id': vec['id'], 'file': f'{name}.json', 'spec_section': vec['spec_section'], 'description_zh': vec['description_zh']}
            for name, vec in vectors.items()
        ],
    }


def _tol_of(vec: dict[str, Any], key: str) -> tuple[float, float]:
    tol = dict(vec.get('tolerance') or {})
    tol.update((vec.get('tolerance_overrides') or {}).get(key, {}))
    return float(tol.get('abs', 0.0)), float(tol.get('rel', 0.0))


def _close(a: Any, b: Any, abs_tol: float, rel_tol: float) -> bool:
    """逐元素比對（和 TS 測試的規則相同：|a − b| ≤ abs + rel·|b|）；非數值要完全相等。"""
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= abs_tol + rel_tol * abs(b)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y, abs_tol, rel_tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k], abs_tol, rel_tol) for k in a)
    return a == b


def vector_mismatch(on_disk: dict[str, Any], fresh: dict[str, Any]) -> str | None:
    """
    磁碟上的 vector 和剛算出來的是否「同一份」：中繼資料（id、說明、容忍度…）要完全相同，
    inputs 與 expected 的數值用這個 vector 自己的容忍度比對——不同平台／NumPy 版本的浮點最後幾位會不同，
    但只要在 TS 測試的容忍度內就不算過期。回傳第一個不一致的欄位說明；一致時回傳 None。
    """
    for meta in ('id', 'description_zh', 'spec_section', 'tolerance', 'tolerance_overrides', 'notes'):
        if on_disk.get(meta) != fresh.get(meta):
            return f'{meta} 不同'
    for section in ('inputs', 'expected'):
        a, b = on_disk.get(section, {}), fresh.get(section, {})
        if a.keys() != b.keys():
            return f'{section} 的 key 不同'
        for key in a:
            abs_tol, rel_tol = _tol_of(fresh, key)
            if not _close(a[key], b[key], abs_tol, rel_tol):
                return f'{section}.{key} 超出容忍度'
    return None


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + '\n'


def write_all(out_dir: Path = VECTORS_DIR) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    vectors = build_vectors()
    written = []
    for name, vec in vectors.items():
        path = out_dir / f'{name}.json'
        path.write_text(dumps(vec), encoding='utf-8')
        written.append(path)
    idx = out_dir / 'index.json'
    idx.write_text(dumps(build_index(vectors)), encoding='utf-8')
    written.append(idx)
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='輸出 LMS × PLL golden test vectors')
    ap.add_argument('--out', type=Path, default=VECTORS_DIR, help='輸出資料夾（預設 golden/vectors）')
    ap.add_argument('--check', action='store_true', help='只檢查磁碟上的 vectors 是否與目前模型一致')
    args = ap.parse_args(argv)
    if args.check:
        vectors = build_vectors()
        stale = []
        for name, vec in vectors.items():
            path = args.out / f'{name}.json'
            if not path.exists():
                stale.append(f'{name}（缺少）')
                continue
            why = vector_mismatch(json.loads(path.read_text(encoding='utf-8')), json.loads(dumps(vec)))
            if why:
                stale.append(f'{name}（{why}）')
        if stale:
            print('過期或缺少的 vectors：' + ', '.join(stale))
            return 1
        print(f'{len(vectors)} 個 vectors 皆為最新（數值以各 vector 自己的容忍度比對）')
        return 0
    paths = write_all(args.out)
    for p in paths:
        print(p.relative_to(GOLDEN_DIR.parent) if p.is_relative_to(GOLDEN_DIR.parent) else p)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
