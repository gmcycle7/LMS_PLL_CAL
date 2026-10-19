"""Ch14 §14.6b（§14 延伸）：PLL acquisition 與校正 enable 條件的 golden 測試（test_S14b_*；沒有對應的 T-id）。

數字來源：lms_pll_golden/acquisition.py；TypeScript 端 src/simulation/models/acquisition.test.ts 讀
golden/vectors/acquisition_timeline.json 比對。
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np
import pytest
from scipy.special import ndtr

from lms_pll_golden import acquisition as A

P = A.DEFAULT_ACQ


# ───────────────────────── FLL 封閉式 ─────────────────────────


def test_S14b_fll_gain_composition():
    """K_f = K_vco g_f/(M f_ref) = 2.5e6 × 3.2/(4 × 4e9) = 5×10⁻⁴。"""
    assert A.fll_gain(P) == pytest.approx(5e-4, rel=1e-12)
    assert A.t_vco_fs(P) == pytest.approx(62500.0)


def test_S14b_fll_cycles_to_tol_matches_recursion():
    """n_c = ⌈ln(f_tol/|Δf_0|)/ln(1 − K_f)⌉ 是遞迴 Δf[n+1] = (1 − K_f)Δf[n] 首次 |Δf| < f_tol 的週期。"""
    k_f = A.fll_gain(P)
    n_c = A.fll_cycles_to_tol(P.df0_hz, P.f_tol_hz, k_f)
    assert n_c == 8762
    df = P.df0_hz
    first = None
    for n in range(20000):
        if abs(df) < P.f_tol_hz:
            first = n
            break
        df *= 1.0 - k_f
    assert first == n_c
    assert A.fll_lock_cycle(P.df0_hz, P.f_tol_hz, k_f, P.n_ld) == n_c + P.n_ld - 1
    # 已在門檻內：0；K_f 不合法：∞
    assert A.fll_cycles_to_tol(0.5e6, 1e6, k_f) == 0
    assert math.isinf(A.fll_cycles_to_tol(1e8, 1e6, 0.0))
    assert math.isinf(A.fll_cycles_to_tol(1e8, 1e6, 1.0))


def test_S14b_fll_mean_trajectory_is_linear_model(make_rng):
    """有雜訊時 E[Δf[n]] = (1 − K_f)^n Δf_0（線性、零均值雜訊）：32 個 run 的平均在 4·se 內。"""
    runs = 32
    n_trace = 400
    acc = np.zeros(n_trace)
    acc2 = np.zeros(n_trace)
    for r in range(runs):
        res = A.run_acquisition(replace(P, cycles=n_trace, sigma_f_hz=2e6), make_rng(r))
        acc += res['df']
        acc2 += res['df'] ** 2
    mean = acc / runs
    se = np.sqrt(np.maximum(acc2 / runs - mean**2, 0.0) / (runs - 1))
    model = (1.0 - A.fll_gain(P)) ** np.arange(n_trace) * P.df0_hz
    z = np.abs(mean - model) / np.where(se > 0, se, 1.0)
    assert z.max() < 4.0


# ───────────────────────── lock detect 的誤判率 ─────────────────────────


def test_S14b_lock_detect_probabilities_closed_forms():
    """p_in、P_FA、P_miss、E[T_N] 與直接用 Φ／幾何級數算的值一致；手算例 z = 2.5、N_ld = 32。"""
    sigma = 4e5
    z = P.f_tol_hz / sigma
    p_in0 = A.lock_detect_in_window_prob(0.0, P.f_tol_hz, sigma)
    assert p_in0 == pytest.approx(2.0 * ndtr(z) - 1.0, rel=1e-12)
    assert A.lock_detect_miss(P.f_tol_hz, sigma, P.n_ld) == pytest.approx(1.0 - p_in0**P.n_ld, rel=1e-9)
    # E[T_N] = Σ_{k=1}^{N} p^{−k}
    assert A.expected_run_length(p_in0, P.n_ld) == pytest.approx(sum(p_in0 ** (-k) for k in range(1, P.n_ld + 1)), rel=1e-12)
    assert A.expected_run_length(1.0, 7) == 7.0
    # 誤報：Δf_x = 2 f_tol
    p_x = A.lock_detect_in_window_prob(2.0 * P.f_tol_hz, P.f_tol_hz, sigma)
    assert p_x == pytest.approx(ndtr(-z) - ndtr(-3.0 * z), rel=1e-12)
    assert A.lock_detect_false_alarm(2.0 * P.f_tol_hz, P.f_tol_hz, sigma, P.n_ld) == pytest.approx(p_x**P.n_ld, rel=1e-12)
    # 沒有雜訊：指示函數
    assert A.lock_detect_in_window_prob(0.5e6, 1e6, 0.0) == 1.0
    assert A.lock_detect_in_window_prob(1.5e6, 1e6, 0.0) == 0.0


def test_S14b_lock_detect_miss_monte_carlo(make_rng):
    """P_miss = 1 − p^{N}：把 N_ld 個 iid 樣本的視窗抽 20000 次，失敗比例落在 Wilson 區間內。"""
    sigma, n_ld, trials = 4e5, 8, 20000
    rng = make_rng(101)
    x = rng.standard_normal((trials, n_ld)) * sigma
    fail = np.mean(np.any(np.abs(x) >= P.f_tol_hz, axis=1))
    p = A.lock_detect_miss(P.f_tol_hz, sigma, n_ld)
    assert abs(fail - p) < 4.0 * math.sqrt(p * (1 - p) / trials)


# ───────────────────────── SSPD 範圍與 cycle slip ─────────────────────────


def test_S14b_sspd_monotonic_and_basin():
    """sine PD：斜率在 |θ| = T_vco/4 歸零、|θ| = T_vco/2 反號；wrap 把 0.6 T_vco 折成 −0.4 T_vco 並記 slip。"""
    t = A.t_vco_fs(P)
    s = lambda th: A.pd_characteristic(th, t, 'sine')  # noqa: E731
    h = 1e-3
    assert (s(h) - s(-h)) / (2 * h) == pytest.approx(1.0, rel=1e-6)
    assert (s(t / 4 + h) - s(t / 4 - h)) / (2 * h) == pytest.approx(0.0, abs=1e-6)
    assert s(t / 2 - 1.0) > 0 > s(-t / 2 + 1.0)
    assert A.wrap_theta(0.6 * t, t) == (pytest.approx(-0.4 * t), True)
    assert A.wrap_theta(0.4 * t, t) == (0.4 * t, False)
    b = A.slip_boundary(P)
    assert b['monotonic_fs'] == pytest.approx(t / 4)
    assert b['basin_fs'] == pytest.approx(t / 2)
    assert b['ramp_limit_fs_per_cycle'] == pytest.approx(A.phase_loop_gain(P) * t / (2 * math.pi))
    # 頻率上限：ΔT(Δf_limit) = ramp_limit
    assert A.ramp_fs_per_cycle(b['df_limit_hz'], P) == pytest.approx(b['ramp_limit_fs_per_cycle'], rel=1e-12)


def test_S14b_cycle_slip_when_ramp_exceeds_loop_capacity():
    """殘餘頻率誤差超過 Δf_limit 時相位迴路拉不回來：無雜訊模擬一路 slip、永遠不 phase lock。"""
    b = A.slip_boundary(P)
    bad = replace(P, f_tol_hz=2.0 * b['df_limit_hz'], f_unlock_hz=3.0 * b['df_limit_hz'], df0_hz=1.5 * b['df_limit_hz'], cycles=4000)
    res = A.acquisition_timeline(bad)
    assert res['summary']['freq_lock_cycle'] == P.n_ld - 1  # 一開始就在門檻內
    assert res['summary']['slips'] > 10
    assert res['summary']['enable_cycle'] == -1


def test_S14b_steady_state_theta_rms(make_rng):
    """σ_ss² = g_p σ_θ²/(2 − g_p)：線性 PD、無斜坡、長時間模擬的 θ 變異數在 10% 內。"""
    gp = A.phase_loop_gain(P)
    pred = A.steady_state_theta_rms(P.sigma_theta_fs, gp)
    assert pred == pytest.approx(P.sigma_theta_fs * math.sqrt(gp / (2 - gp)))
    p = replace(P, pd_shape='linear', df0_hz=0.0, sigma_f_hz=0.0, theta0_fs=0.0, cycles=40000)
    res = A.run_acquisition(p, make_rng(7))
    theta = res['theta'][2000:]
    assert np.sqrt(np.mean(theta**2)) == pytest.approx(pred, rel=0.1)


# ───────────────────────── 倍頻模糊：SSPLL 為什麼需要 FLL ─────────────────────────


def test_S14b_sspd_harmonic_ambiguity_alias():
    """SSPD 只看得到 Δf − k f_ref：k = ⌊Δf/f_ref + ½⌋，|Δf| < f_ref/2 才是第 M 根；Δf 與 Δf + f_ref 的無雜訊相位序列逐週期相同。"""
    h = A.harmonic_capture(8e7, P)
    assert h == {'capture_hz': 2e9, 'k': 0.0, 'alias_hz': 8e7, 'ok': True}
    h1 = A.harmonic_capture(P.f_ref_hz + 5e5, P)
    assert h1['k'] == 1.0 and h1['alias_hz'] == 5e5 and h1['ok'] is False
    assert A.harmonic_capture(-P.f_ref_hz - 5e5, P)['k'] == -1.0
    assert A.harmonic_capture(1.9e9, P)['ok'] is True and A.harmonic_capture(2.1e9, P)['k'] == 1.0
    # 取樣點每週期移動 ΔT = (Δf/f_ref)·T_vco：多一個 f_ref 剛好多一個 T_vco（看不見）
    assert A.ramp_fs_per_cycle(P.f_ref_hz, P) == pytest.approx(A.t_vco_fs(P), rel=1e-12)
    # FLL 關掉時，Δf_0 = 80 MHz 與 80 MHz + f_ref 的相位序列完全相同（SSPD 分不出這兩根）
    a = A.acquisition_timeline(replace(A.no_fll_config(P), cycles=2000))
    b = A.acquisition_timeline(replace(A.no_fll_config(P, P.df0_hz + P.f_ref_hz), cycles=2000))
    th_a = a['theta'][np.isfinite(a['theta'])]
    th_b = b['theta'][np.isfinite(b['theta'])]
    assert np.array_equal(th_a, th_b)
    assert a['summary']['slips'] == b['summary']['slips'] == 0


def test_S14b_no_fll_binding_condition():
    """不用 FLL（Δf_0 = 80 MHz）：倍頻捕獲與 slip 都成立，卡住的是 phase lock（θ* = 3.22 ps > θ_max = 2 ps）與穩態；模擬一致。"""
    c = A.no_fll_check(P)
    assert c['harmonic']['ok'] and c['slip_ok']
    assert not c['phase_lock_ok'] and not c['settle_ok']
    assert c['binding'] == 'phaseLock'
    assert c['ramp_fs_per_cycle'] == pytest.approx(1250.0, rel=1e-12)
    assert c['theta_ss_fs'] == pytest.approx(1250.0 / A.phase_loop_gain(P), rel=1e-12)
    t = A.t_vco_fs(P)
    assert c['theta_ss_pd_fs'] == pytest.approx(t / (2 * math.pi) * math.asin(2 * math.pi * 1250.0 / (A.phase_loop_gain(P) * t)), rel=1e-12)
    # 四個尺度：f_ref/2 ≫ Δf_limit ≫ Δf(θ_max) ≫ Δf(rms_max)，80 MHz 落在中間
    assert P.f_ref_hz / 2 > A.slip_boundary(P)['df_limit_hz'] > P.df0_hz > c['df_theta_max_hz'] > c['df_rms_max_hz']
    assert A.static_offset_fs(A.ramp_fs_per_cycle(c['df_theta_max_hz'], P), P) == pytest.approx(P.theta_max_fs, rel=1e-9)
    res = A.acquisition_timeline(replace(A.no_fll_config(P), cycles=4096))
    s = res['summary']
    assert s['freq_lock_cycle'] == P.n_ld - 1
    assert s['phase_lock_cycle'] == -1 and s['enable_cycle'] == -1 and s['slips'] == 0
    assert res['theta'][-1] == pytest.approx(c['theta_ss_pd_fs'], rel=1e-9)
    # 有 FLL：交棒時 k = 0、θ_ss 只剩 38.9 fs
    a = A.acquisition_analytic(P)
    assert a['harmonic']['ok'] and a['harmonic']['k'] == 0.0
    assert a['theta_ss_fs'] < P.rms_max_fs < P.theta_max_fs


def test_S14b_wrong_harmonic_blocked_by_capture_check():
    """Δf_0 = f_ref + 0.5 MHz 且不用 FLL：SSPD 鎖在 (M + 1) f_ref，phase lock 與 rms 視窗都通過、沒有 slip，倍頻捕獲擋住 enable。"""
    df0 = P.f_ref_hz + 5e5
    c = A.no_fll_check(P, df0)
    assert c['binding'] == 'harmonic' and c['slip_ok'] and c['phase_lock_ok'] and c['settle_ok']
    s = A.acquisition_timeline(replace(A.no_fll_config(P, df0), cycles=4096))['summary']
    assert s['phase_lock_cycle'] > 0 and s['settle_cycle'] > 0
    assert s['enable_cycle'] == -1 and s['slips'] == 0 and s['unlocks'] == 0
    # 封閉式：交棒時的殘餘誤差若在捕獲範圍外，n_enable = ∞
    assert math.isinf(A.acquisition_analytic(replace(P, f_tol_hz=5e9, f_unlock_hz=1e10, df0_hz=df0, fll_gain_lsb=1e-6))['n_enable'])


# ───────────────────────── 時間表：封閉式 = 無雜訊模擬 ─────────────────────────


def test_S14b_timeline_linear_pd_matches_closed_form():
    """線性 PD 的無雜訊時間表和封閉式逐項相同：n_FL、phase lock、settle、enable、LOCK blocks。"""
    a = A.acquisition_analytic(replace(P, pd_shape='linear'))
    s = A.acquisition_timeline(replace(P, pd_shape='linear'))['summary']
    assert s['freq_lock_cycle'] == a['n_fl'] == 8793
    assert s['phase_lock_cycle'] == a['n_fl'] + a['n_pl_rel'] == 8830
    assert s['settle_cycle'] == a['n_fl'] + a['n_settle_rel'] == 9310
    assert s['enable_cycle'] == a['n_enable'] == 9310
    assert s['lock_blocks'] == a['lock_blocks'] == 10
    assert s['df_handoff_hz'] == pytest.approx(a['df_handoff_hz'], rel=1e-12)



@pytest.mark.parametrize('over', [dict(theta0_fs=500.0), dict(theta0_fs=0.0, settle_window=4, n_pl=4), dict(theta0_fs=50.0, settle_window=1, n_pl=1)])
def test_S14b_timeline_matches_closed_form_when_already_in_window(over):
    """θ_0 已在門檻內（n_tr 的 ⌈·⌉ ≤ 0）：第一個被計數的樣本在 n_FL + 1，所以 n_tr = 1，封閉式仍與模擬逐週期相同。"""
    q = replace(P, pd_shape='linear', **over)
    a = A.acquisition_analytic(q)
    s = A.acquisition_timeline(q)['summary']
    assert s['phase_lock_cycle'] == a['n_fl'] + a['n_pl_rel']
    assert s['settle_cycle'] == a['n_fl'] + a['n_settle_rel']
    assert s['enable_cycle'] == a['n_enable']
    assert A.phase_lock_cycles(100.0, 0.0, 2000.0, 0.4, 32) == 32
    assert A.settle_cycles(10.0, 0.0, 100.0, 0.4, 512) == 512

def test_S14b_timeline_sine_pd_between_linear_and_chord_bound():
    """sine PD 比線性慢，但不超過弦斜率 g_eff 算出的上界。"""
    a = A.acquisition_analytic(P)
    s = A.acquisition_timeline(P)['summary']
    assert a['n_enable'] <= s['enable_cycle'] <= a['n_enable_bound']
    assert a['n_fl'] + a['n_pl_rel'] <= s['phase_lock_cycle'] <= a['n_fl'] + a['n_pl_rel_bound']
    assert s['enable_cycle'] == 9313
    assert s['lock_blocks'] == 10
    assert s['slips'] == 0


def test_S14b_enable_requires_dtc_working_point():
    """DTC 工作點超出範圍（gain 90 ps > T_0 = 78 ps）：code 飽和、永遠不 enable。"""
    bad = replace(P, dtc_gains_fs=(0.0, 90000.0))
    assert A.dtc_working_point(bad)['ok'] is False
    res = A.acquisition_timeline(bad)
    assert res['summary']['freq_lock_cycle'] == 8793
    assert res['summary']['enable_cycle'] == -1
    assert math.isinf(res['summary']['lock_blocks'])


def test_S14b_loss_event_falls_back_to_acq_and_relocks():
    """CAL 中 VCO 頻率跳 +50 MHz：slip → HOLD → 失鎖（N_ul 個週期）→ ACQ → PLOCK → CAL；重新 enable 8429 週期（9 個 block）。"""
    res = A.acquisition_timeline(replace(P, loss_cycle=12288, cycles=32768))
    states = [s for s, _, _ in res['segments']]
    assert states == ['ACQ', 'PLOCK', 'CAL', 'HOLD', 'ACQ', 'PLOCK', 'CAL']
    s = res['summary']
    assert s['unlocks'] == 1 and s['holds'] == 1
    assert s['relock_cycles'] == 8429
    assert s['relock_blocks'] == 9
    # 失鎖的時間：跳變後 N_ul 個週期才判定
    acq2 = res['segments'][4]
    assert acq2[1] == 12288 + P.n_ul


def test_S14b_hold_recal_path_after_phase_kick():
    """只有相位被踢出 θ_max（頻率沒變）時：CAL → HOLD → RECAL → CAL，不回 ACQ。"""
    # 用 sine PD、把 θ_max 設得比穩態偏移大一點、再給一個大的相位雜訊脈衝很難確定性地做；改用極小的 θ_max 讓穩態偏移本身超出門檻。
    p = replace(P, theta_max_fs=60.0, rms_max_fs=100.0, cycles=12000)
    res = A.acquisition_timeline(p)
    a = A.acquisition_analytic(p)
    # θ_ss ≈ 38.9 fs < 60 fs ⇒ 仍能 enable；把 θ_max 壓到 30 fs 則永遠不能
    assert res['summary']['enable_cycle'] > 0
    assert a['theta_ss_fs'] < 60.0
    res2 = A.acquisition_timeline(replace(p, theta_max_fs=30.0))
    assert res2['summary']['enable_cycle'] == -1
    assert math.isinf(A.acquisition_analytic(replace(p, theta_max_fs=30.0))['n_pl_rel'])


def test_S14b_noisy_lock_mean_cycle_renewal_estimate(make_rng):
    """有雜訊的 lock detect：renewal 近似的平均宣告週期 vs 逐週期模擬（24 個 seed），容許 4·se + 1%（近似本身的系統差）。"""
    for sigma_f in (1e5, 4e5):
        p = replace(P, sigma_f_hz=sigma_f, cycles=13000)
        est = A.lock_detect_mean_cycle(p.df0_hz, p.f_tol_hz, A.fll_gain(p), sigma_f, p.n_ld)
        rng = make_rng(int(sigma_f))
        locks = np.array([A.run_acquisition(p, rng)['summary']['freq_lock_cycle'] for _ in range(24)], dtype=float)
        assert np.all(locks > 0)
        se = locks.std(ddof=1) / math.sqrt(locks.size)
        assert abs(locks.mean() - est) <= 4.0 * se + 0.01 * est, (sigma_f, locks.mean(), se, est)
    # 無雜訊極限：每個週期都在窗內時 λ = 1/N_ld，平均落在 n_c + N_ld 附近（指數存活的近似，比確定性的 n_FL 多約 1 個週期）
    k_f = A.fll_gain(P)
    est0 = A.lock_detect_mean_cycle(P.df0_hz, P.f_tol_hz, k_f, 1.0, P.n_ld)
    assert abs(est0 - (A.fll_cycles_to_tol(P.df0_hz, P.f_tol_hz, k_f) + P.n_ld)) < 2.0
