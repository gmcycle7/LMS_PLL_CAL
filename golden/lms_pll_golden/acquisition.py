"""§14 延伸（Ch14 §14.6b）：PLL acquisition 與校正 enable 條件的 golden model。

TypeScript 對應：``src/simulation/models/acquisition.ts``（同一套公式、同一個確定性模擬）；
vector ``golden/vectors/acquisition_timeline.json``。所有數字都是 illustrative（4 GHz reference、M = 4、320 MHz 迴路頻寬）。

模型（時間單位：reference 週期 n；頻率 Hz；相位誤差以時間 fs 表示）：

- FLL：``Δf[n+1] = (1 − K_f) Δf[n] − K_f e_f[n]``、``K_f = K_vco g_f/(M f_ref)``；
  lock detect：``|Δf̂| < f_tol`` 連續 ``N_ld`` 個週期（``Δf̂ = Δf + e_f``）。
- SSPD 的倍頻模糊（SSPLL 需要 FLL 的第一個理由）：取樣點每週期移動 ``ΔT = (Δf/f_ref)·T_vco``，整數個 ``T_vco`` 看不見，
  所以 SSPD 只看得到 ``Δf − k f_ref``（``k = round(Δf/f_ref)``），``|Δf| < f_ref/2`` 才鎖在對的第 ``M`` 根。
- SSPD 的相位層級：``S(θ) = (T_vco/2π) sin(2π θ/T_vco)``（單調 ``|θ| < T_vco/4``、不 cycle slip ``|θ| < T_vco/2``）；
  相位迴路 ``θ[n+1] = θ[n] − g_p S(θ[n] + v[n]) + ΔT``、``g_p = 1 − exp(−2π f_BW/f_ref)``、``ΔT = Δf_alias/(M f_ref²)``。
- 校正 enable = 頻率鎖定 ∧ 倍頻捕獲（``|Δf̂| < f_ref/2``）∧ phase lock（``|θ| < θ_max`` 連續 ``N_pl``）∧ 穩態（``W`` 週期 rms < ``rms_max``）
  ∧ DTC 工作點在範圍內。
- 狀態機 ACQ → PLOCK → CAL → HOLD／RECAL，失鎖（``|Δf̂| > f_unlock`` 連續 ``N_ul``）回 ACQ。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np
from scipy.special import erfc, ndtr

ACQ_STATES = ('ACQ', 'PLOCK', 'CAL', 'HOLD', 'RECAL')


@dataclass(frozen=True)
class AcqParams:
    seed: int = 20261034
    f_ref_hz: float = 4e9
    div_ratio: float = 4.0
    k_vco_hz_per_lsb: float = 2.5e6
    fll_gain_lsb: float = 3.2
    df0_hz: float = 8e7
    sigma_f_hz: float = 1e5
    f_tol_hz: float = 1e6
    n_ld: int = 32
    f_unlock_hz: float = 4e6
    n_ul: int = 16
    f_bw_hz: float = 3.2e8
    pd_shape: str = 'sine'
    sigma_theta_fs: float = 100.0
    theta0_fs: float = 25000.0
    theta_max_fs: float = 2000.0
    n_pl: int = 32
    settle_window: int = 512
    rms_max_fs: float = 100.0
    dtc_bits: int = 10
    dtc_cal_range_frac: float = 0.2
    dtc_inl_peak_fs: float = 0.0
    dtc_gains_fs: tuple[float, ...] = (0.0, 100.0)
    dtc_x_range: tuple[float, float] = (-1.0, 1.0)
    cycles: int = 16384
    loss_cycle: int = -1
    loss_df_hz: float = 5e7
    block_n: int = 1024


DEFAULT_ACQ = AcqParams()


# ───────────────────────────── 基本量 ─────────────────────────────


def fll_gain(p: AcqParams) -> float:
    """``K_f = K_vco g_f/(M f_ref)``。"""
    return p.k_vco_hz_per_lsb * p.fll_gain_lsb / (p.div_ratio * p.f_ref_hz)


def t_vco_fs(p: AcqParams) -> float:
    return 1e15 / (p.div_ratio * p.f_ref_hz)


def phase_loop_gain(p: AcqParams) -> float:
    """``g_p = 1 − exp(−2π f_BW/f_ref)``。"""
    return 1.0 - math.exp(-2.0 * math.pi * p.f_bw_hz / p.f_ref_hz)


def ramp_fs_per_cycle(df_hz: float, p: AcqParams) -> float:
    """殘餘頻率誤差造成的每週期相位斜坡 ``ΔT = Δf/(M f_ref²)`` [fs]。"""
    return df_hz / (p.div_ratio * p.f_ref_hz * p.f_ref_hz) * 1e15


def harmonic_capture(df_hz: float, p: AcqParams) -> dict[str, Any]:
    """SSPD 的倍頻模糊：``k = round(Δf/f_ref)``（.5 往上取，和 TS 的 Math.floor(x + 0.5) 相同）、混疊後 ``Δf − k f_ref``、``|Δf| < f_ref/2``。"""
    x = df_hz / p.f_ref_hz
    k = float(math.floor(x + 0.5)) if math.isfinite(x) else math.nan
    return {'capture_hz': p.f_ref_hz / 2.0, 'k': k, 'alias_hz': df_hz - k * p.f_ref_hz, 'ok': abs(df_hz) < p.f_ref_hz / 2.0}


def pd_characteristic(theta_fs: float, t_vco: float, shape: str) -> float:
    if shape == 'linear':
        return theta_fs
    return t_vco / (2.0 * math.pi) * math.sin(2.0 * math.pi * theta_fs / t_vco)


def wrap_theta(theta_fs: float, t_vco: float) -> tuple[float, bool]:
    """折回 (−T_vco/2, T_vco/2]；超出就是 cycle slip。"""
    if theta_fs > t_vco / 2.0 or theta_fs <= -t_vco / 2.0:
        k = round(theta_fs / t_vco)
        return theta_fs - k * t_vco, True
    return theta_fs, False


# ───────────────────────────── 封閉式 ─────────────────────────────


def fll_cycles_to_tol(df0_hz: float, f_tol_hz: float, k_f: float) -> float:
    """``n_c = ⌈ln(f_tol/|Δf_0|)/ln(1 − K_f)⌉``（已在門檻內為 0）。"""
    if not (0.0 < k_f < 1.0) or not f_tol_hz > 0.0:
        return math.inf
    if abs(df0_hz) < f_tol_hz:
        return 0
    return math.ceil(math.log(f_tol_hz / abs(df0_hz)) / math.log(1.0 - k_f) - 1e-9)


def fll_lock_cycle(df0_hz: float, f_tol_hz: float, k_f: float, n_ld: int) -> float:
    nc = fll_cycles_to_tol(df0_hz, f_tol_hz, k_f)
    return nc + max(1, n_ld) - 1 if math.isfinite(nc) else math.inf


def lock_detect_in_window_prob(df_hz: float, f_tol_hz: float, sigma_f_hz: float) -> float:
    """``Φ((f_tol − Δf)/σ_f) − Φ((−f_tol − Δf)/σ_f)``。"""
    if not sigma_f_hz > 0.0:
        return 1.0 if abs(df_hz) < f_tol_hz else 0.0
    return float(ndtr((f_tol_hz - df_hz) / sigma_f_hz) - ndtr((-f_tol_hz - df_hz) / sigma_f_hz))


def lock_detect_false_alarm(df_x_hz: float, f_tol_hz: float, sigma_f_hz: float, n_ld: int) -> float:
    return lock_detect_in_window_prob(df_x_hz, f_tol_hz, sigma_f_hz) ** n_ld


def lock_detect_miss(f_tol_hz: float, sigma_f_hz: float, n_ld: int) -> float:
    """``1 − p_in(0)^{N_ld}``，以 erfc／log1p 避免相消。"""
    if not sigma_f_hz > 0.0:
        return 0.0
    q = float(erfc(f_tol_hz / sigma_f_hz / math.sqrt(2.0)))
    return -math.expm1(n_ld * math.log1p(-q))


def expected_run_length(p: float, n: int) -> float:
    """第一次出現連續 n 個成功所需的期望樣本數 ``(1 − p^n)/((1 − p) p^n)``。"""
    if not p > 0.0:
        return math.inf
    if p >= 1.0:
        return float(n)
    pn = p**n
    if pn == 0.0:  # p^n 下溢：期望延遲是 ∞（和 TS 的 IEEE 除以 0 相同）
        return math.inf
    return (1.0 - pn) / ((1.0 - p) * pn)


def lock_detect_mean_cycle(df0_hz: float, f_tol_hz: float, k_f: float, sigma_f_hz: float, n_ld: int, max_cycles: int = 1 << 24) -> float:
    """有雜訊時宣告頻率鎖定的平均週期（quasi-static renewal 近似）。

    ``λ(n) = 1/E[T_N](p_n)``、``p_n = p_in((1 − K_f)^n |Δf_0|)``；``S(n) = exp(−Σ_{m≤n} λ(m))``；``E[n_FL] ≈ Σ_n S(n)``。
    """
    if not (0.0 < k_f < 1.0) or not f_tol_hz > 0.0:
        return math.inf
    df = abs(df0_hz)
    hazard = 0.0
    mean = 0.0
    for _ in range(max_cycles):
        p = lock_detect_in_window_prob(df, f_tol_hz, sigma_f_hz)
        lam = 1.0 / expected_run_length(p, n_ld) if p > 0.0 else 0.0
        hazard += lam
        surv = math.exp(-hazard)
        mean += surv
        if surv < 1e-12:
            return mean
        df *= 1.0 - k_f
    return math.inf


def slip_boundary(p: AcqParams) -> dict[str, float]:
    t = t_vco_fs(p)
    gp = phase_loop_gain(p)
    ramp_limit = gp * t / (2.0 * math.pi) if p.pd_shape == 'sine' else gp * t / 2.0
    return {
        'monotonic_fs': t / 4.0 if p.pd_shape == 'sine' else math.inf,
        'basin_fs': t / 2.0,
        'ramp_limit_fs_per_cycle': ramp_limit,
        'df_limit_hz': ramp_limit / 1e15 * p.div_ratio * p.f_ref_hz * p.f_ref_hz,
    }


def slip_prob_per_cycle(theta_ss_fs: float, sigma_ss_fs: float, t_vco: float) -> float:
    if not sigma_ss_fs > 0.0:
        return 1.0 if abs(theta_ss_fs) >= t_vco / 2.0 else 0.0
    return float(ndtr(-(t_vco / 2.0 - abs(theta_ss_fs)) / sigma_ss_fs) + ndtr(-(t_vco / 2.0 + abs(theta_ss_fs)) / sigma_ss_fs))


def static_offset_fs(ramp_fs: float, p: AcqParams) -> float:
    """一階相位迴路在斜坡 ΔT 下的平衡點 ``g_p S(θ*) = ΔT``（linear：ΔT/g_p；sine：(T/2π) arcsin(2π ΔT/(g_p T))；不存在時 NaN）。"""
    t = t_vco_fs(p)
    gp = phase_loop_gain(p)
    if p.pd_shape == 'linear':
        return ramp_fs / gp if abs(ramp_fs / gp) < t / 2.0 else math.nan
    s = 2.0 * math.pi * ramp_fs / (gp * t)
    return t / (2.0 * math.pi) * math.asin(s) if abs(s) < 1.0 else math.nan


def df_for_static_offset_hz(theta_fs: float, p: AcqParams) -> float:
    """靜態偏移剛好等於 θ 的殘餘頻率誤差：``Δf = g_p S(θ) M f_ref²``（θ 超出單調範圍時取邊界）。"""
    t = t_vco_fs(p)
    edge = t / 4.0 if p.pd_shape == 'sine' else t / 2.0
    ramp = phase_loop_gain(p) * pd_characteristic(min(abs(theta_fs), edge), t, p.pd_shape)
    return ramp / 1e15 * p.div_ratio * p.f_ref_hz * p.f_ref_hz


def no_fll_check(p: AcqParams, df0_hz: float | None = None) -> dict[str, Any]:
    """不用 FLL、直接在 Δf_0 閉 SSPD：倍頻 → slip → phase lock → 穩態，依序檢查（TS 的 noFllCheck）。"""
    df0 = p.df0_hz if df0_hz is None else df0_hz
    h = harmonic_capture(df0, p)
    ramp = ramp_fs_per_cycle(h['alias_hz'], p)
    slip_ok = abs(ramp) < slip_boundary(p)['ramp_limit_fs_per_cycle']
    th_pd = static_offset_fs(ramp, p) if slip_ok else math.nan
    pl_ok = slip_ok and abs(th_pd) < p.theta_max_fs
    st_ok = slip_ok and abs(th_pd) < p.rms_max_fs
    binding = 'harmonic' if not h['ok'] else 'slip' if not slip_ok else 'phaseLock' if not pl_ok else 'settle' if not st_ok else 'none'
    return {
        'harmonic': h,
        'ramp_fs_per_cycle': ramp,
        'slip_ok': slip_ok,
        'theta_ss_fs': ramp / phase_loop_gain(p),
        'theta_ss_pd_fs': th_pd,
        'phase_lock_ok': pl_ok,
        'settle_ok': st_ok,
        'df_theta_max_hz': df_for_static_offset_hz(p.theta_max_fs, p),
        'df_rms_max_hz': df_for_static_offset_hz(p.rms_max_fs, p),
        'binding': binding,
    }


def no_fll_config(p: AcqParams, df0_hz: float | None = None) -> AcqParams:
    """「FLL 關掉」的模擬設定（TS 的 noFllConfig）：K_f = 0、f_tol = 2|Δf_0| + f_ref、f_unlock = 2 f_tol。"""
    df0 = p.df0_hz if df0_hz is None else df0_hz
    f_tol = 2.0 * abs(df0) + p.f_ref_hz
    return replace(p, df0_hz=df0, fll_gain_lsb=0.0, f_tol_hz=f_tol, f_unlock_hz=2.0 * f_tol)


def effective_phase_gain(theta0_fs: float, gp: float, shape: str, t_vco: float) -> float:
    if shape == 'linear' or theta0_fs == 0.0:
        return gp
    x = 2.0 * math.pi * abs(theta0_fs) / t_vco
    return gp * math.sin(x) / x


def steady_state_theta_rms(sigma_theta_fs: float, gp: float) -> float:
    return sigma_theta_fs * math.sqrt(gp / (2.0 - gp))


def phase_lock_cycles(theta0_fs: float, theta_ss_fs: float, theta_max_fs: float, gp: float, n_pl: int) -> float:
    margin = theta_max_fs - abs(theta_ss_fs)
    if not margin > 0.0 or not (0.0 < gp < 2.0):
        return math.inf
    dev = abs(theta0_fs - theta_ss_fs)
    # 第一個被計數的相位樣本是 n_FL + 1（θ_0 本身不計），所以 n_tr ≥ 1
    n_tr = 1 if dev < margin else max(1, math.ceil(math.log(margin / dev) / math.log(abs(1.0 - gp)) - 1e-9))
    return n_tr + max(1, n_pl) - 1


def settle_cycles(theta0_fs: float, theta_ss_fs: float, rms_max_fs: float, gp: float, w: int) -> float:
    budget = (rms_max_fs * rms_max_fs - theta_ss_fs * theta_ss_fs) * w
    if not budget > 0.0 or not (0.0 < gp < 2.0):
        return math.inf
    dev2 = (theta0_fs - theta_ss_fs) ** 2
    r2 = (1.0 - gp) ** 2
    energy0 = dev2 / (1.0 - r2)
    # 視窗的第一個樣本是 n_FL + 1（θ_0 不進視窗），所以 n_tr ≥ 1
    n_tr = 1 if energy0 < budget else max(1, math.ceil(math.log(budget / energy0) / math.log(r2) - 1e-9))
    return w + n_tr - 1


# ───────────────────────────── DTC 工作點（Ch04 §5b 的 dtcRangeBudget／dtcCompensation） ─────────────────────────────


def dtc_range_budget(t_vco: float, cal_range_frac: float, inl_peak_fs: float, bits: int, headroom_frac: float = 0.05) -> dict[str, float]:
    head = headroom_frac * t_vco
    max_comp = t_vco * (1.0 + cal_range_frac)
    range_fs = max_comp + inl_peak_fs + 2.0 * head
    t0 = head + inl_peak_fs + max_comp
    lsb = range_fs / (2**bits - 1)
    return {'max_comp_fs': max_comp, 'range_fs': range_fs, 't0_fs': t0, 'lsb_fs': lsb}


def _round_half_up(x: float) -> int:
    """和 TS 的 roundCode（Math.floor(x + 0.5)）相同的取整。"""
    return int(math.floor(x + 0.5))


def dtc_compensation(w: float, x: float, t0_fs: float, lsb_fs: float, bits: int) -> tuple[int, bool]:
    """``τ = T_0 − w·x`` 取整到 Δ 的格點、夾在 [0, 2^B − 1]；回傳 (code, saturated)。"""
    want_code = (t0_fs - w * x) / lsb_fs
    code = _round_half_up(want_code)
    lo, hi = 0, 2**bits - 1
    if code < lo:
        return lo, True
    if code > hi:
        return hi, True
    return code, False


def dtc_working_point(p: AcqParams) -> dict[str, Any]:
    b = dtc_range_budget(t_vco_fs(p), p.dtc_cal_range_frac, p.dtc_inl_peak_fs, p.dtc_bits)
    rows = []
    ok = True
    for w in p.dtc_gains_fs:
        c_lo = dtc_compensation(w, p.dtc_x_range[0], b['t0_fs'], b['lsb_fs'], p.dtc_bits)
        c_hi = dtc_compensation(w, p.dtc_x_range[1], b['t0_fs'], b['lsb_fs'], p.dtc_bits)
        rows.append({'gain_fs': w, 'code_xmin': c_lo[0], 'sat_xmin': c_lo[1], 'code_xmax': c_hi[0], 'sat_xmax': c_hi[1]})
        ok = ok and not (c_lo[1] or c_hi[1])
    return {'ok': ok, 't0_fs': b['t0_fs'], 'range_fs': b['range_fs'], 'lsb_fs': b['lsb_fs'], 'rows': rows}


# ───────────────────────────── 封閉式時間表 ─────────────────────────────


def acquisition_analytic(p: AcqParams) -> dict[str, Any]:
    k_f = fll_gain(p)
    t = t_vco_fs(p)
    gp = phase_loop_gain(p)
    n_c = fll_cycles_to_tol(p.df0_hz, p.f_tol_hz, k_f)
    n_fl = fll_lock_cycle(p.df0_hz, p.f_tol_hz, k_f, p.n_ld)
    df_h = (1.0 - k_f) ** (n_fl + 1) * p.df0_hz if math.isfinite(n_fl) else math.nan  # 宣告鎖定那個週期 FLL 還更新了一次
    ramp = ramp_fs_per_cycle(df_h, p) if math.isfinite(df_h) else math.nan
    theta_ss = ramp / gp
    sigma_ss = steady_state_theta_rms(p.sigma_theta_fs, gp)
    n_pl_rel = phase_lock_cycles(p.theta0_fs, theta_ss, p.theta_max_fs, gp, p.n_pl)
    n_settle_rel = settle_cycles(p.theta0_fs, theta_ss, p.rms_max_fs, gp, p.settle_window)
    g_eff = effective_phase_gain(p.theta0_fs, gp, p.pd_shape, t)
    n_pl_bound = phase_lock_cycles(p.theta0_fs, theta_ss, p.theta_max_fs, g_eff, p.n_pl)
    n_settle_bound = settle_cycles(p.theta0_fs, theta_ss, p.rms_max_fs, g_eff, p.settle_window)
    dtc = dtc_working_point(p)
    harmonic = harmonic_capture(df_h, p)  # 交棒時的倍頻捕獲：|Δf_h| < f_ref/2 才 enable
    gate = dtc['ok'] and harmonic['ok'] and math.isfinite(n_fl)
    n_enable = n_fl + max(n_pl_rel, n_settle_rel) if gate else math.inf
    n_enable_bound = n_fl + max(n_pl_bound, n_settle_bound) if gate else math.inf
    p_in0 = lock_detect_in_window_prob(0.0, p.f_tol_hz, p.sigma_f_hz)
    df_x = p.f_tol_hz + p.sigma_f_hz
    return {
        'k_f': k_f,
        't_vco_fs': t,
        'g_p': gp,
        'n_c': n_c,
        'n_fl': n_fl,
        'df_handoff_hz': df_h,
        'ramp_fs_per_cycle': ramp,
        'theta_ss_fs': theta_ss,
        'sigma_ss_fs': sigma_ss,
        'n_pl_rel': n_pl_rel,
        'n_settle_rel': n_settle_rel,
        'n_enable': n_enable,
        'lock_blocks': math.ceil((n_enable + 1) / p.block_n) if math.isfinite(n_enable) else math.inf,
        'g_eff': g_eff,
        'n_pl_rel_bound': n_pl_bound,
        'n_settle_rel_bound': n_settle_bound,
        'n_enable_bound': n_enable_bound,
        'p_in0': p_in0,
        'p_miss': lock_detect_miss(p.f_tol_hz, p.sigma_f_hz, p.n_ld),
        'expected_detect_cycles': expected_run_length(p_in0, p.n_ld),
        'df_false_alarm_hz': df_x,
        'p_false_alarm': lock_detect_false_alarm(df_x, p.f_tol_hz, p.sigma_f_hz, p.n_ld),
        'noisy_lock_mean_cycle': lock_detect_mean_cycle(p.df0_hz, p.f_tol_hz, k_f, p.sigma_f_hz, p.n_ld),
        'slip': slip_boundary(p),
        'slip_prob_per_cycle': slip_prob_per_cycle(theta_ss, sigma_ss, t),
        'dtc': dtc,
        'harmonic': harmonic,
        'no_fll': no_fll_check(p),
    }


# ───────────────────────────── 逐週期模擬（狀態機） ─────────────────────────────


@dataclass
class _Ctx:
    state: str = 'ACQ'
    df: float = 0.0
    theta: float = math.nan
    ld_count: int = 0
    ul_count: int = 0
    pl_count: int = 0
    win: np.ndarray = field(default_factory=lambda: np.zeros(1))
    win_sum: float = 0.0
    win_count: int = 0
    win_pos: int = 0


def run_acquisition(p: AcqParams, rng: np.random.Generator | None = None) -> dict[str, Any]:
    """單一 run 的 acquisition 模擬；``rng`` 為 None 或 σ 皆為 0 時是確定性的時間表（和 TS 的 acquisitionTimeline 相同）。"""
    cycles = max(1, int(p.cycles))
    k_f = fll_gain(p)
    t_vco = t_vco_fs(p)
    gp = phase_loop_gain(p)
    dtc = dtc_working_point(p)
    noisy = rng is not None and (p.sigma_f_hz > 0.0 or p.sigma_theta_fs > 0.0)
    df = np.empty(cycles)
    theta = np.empty(cycles)
    state = np.empty(cycles, dtype=np.int8)
    summary: dict[str, Any] = {
        'freq_lock_cycle': -1,
        'phase_lock_cycle': -1,
        'settle_cycle': -1,
        'enable_cycle': -1,
        'lock_blocks': math.inf,
        'slips': 0,
        'unlocks': 0,
        'holds': 0,
        'dtc_ok': dtc['ok'],
        'relock_cycles': -1,
        'relock_blocks': -1,
        'df_handoff_hz': math.nan,
    }
    ctx = _Ctx(df=p.df0_hz, win=np.zeros(max(1, p.settle_window)))
    segments: list[tuple[str, int, int]] = []
    seg_start, seg_state = 0, 'ACQ'
    loss_seen = False
    w_len = p.settle_window
    for n in range(cycles):
        if p.loss_cycle >= 0 and n == p.loss_cycle:
            ctx.df += p.loss_df_hz
            loss_seen = True
        df[n] = ctx.df
        ef = p.sigma_f_hz * rng.standard_normal() if noisy else 0.0
        ev = p.sigma_theta_fs * rng.standard_normal() if noisy else 0.0
        acted = ctx.state
        # ① 頻率估計與計數
        df_hat = ctx.df + ef
        ctx.ld_count = ctx.ld_count + 1 if abs(df_hat) < p.f_tol_hz else 0
        ctx.ul_count = ctx.ul_count + 1 if abs(df_hat) > p.f_unlock_hz else 0
        harmonic_ok = abs(df_hat) < p.f_ref_hz / 2.0  # 倍頻捕獲：頻率偵測的讀值在 ±f_ref/2 內
        nxt: str | None = None
        if ctx.state == 'ACQ':
            ctx.df -= k_f * df_hat
            ctx.theta = math.nan
            if ctx.ld_count >= p.n_ld:
                nxt = 'PLOCK'
                ctx.theta = p.theta0_fs
                ctx.pl_count = 0
                ctx.win_sum = 0.0
                ctx.win_count = 0
                ctx.win_pos = 0
                if summary['freq_lock_cycle'] < 0:
                    summary['freq_lock_cycle'] = n
                    summary['df_handoff_hz'] = ctx.df
        else:
            ramp = ramp_fs_per_cycle(harmonic_capture(ctx.df, p)['alias_hz'], p)  # SSPD 只看得到混疊後的頻率誤差
            raw = ctx.theta - gp * pd_characteristic(ctx.theta + ev, t_vco, p.pd_shape) + ramp
            ctx.theta, slipped = wrap_theta(raw, t_vco)
            ctx.pl_count = ctx.pl_count + 1 if abs(ctx.theta) < p.theta_max_fs else 0
            sq = ctx.theta * ctx.theta
            if ctx.win_count < w_len:
                ctx.win_count += 1
            else:
                ctx.win_sum -= ctx.win[ctx.win_pos]
            ctx.win[ctx.win_pos] = sq
            ctx.win_sum += sq
            ctx.win_pos = (ctx.win_pos + 1) % w_len
            settled = ctx.win_count >= w_len and ctx.win_sum / w_len < p.rms_max_fs * p.rms_max_fs
            if ctx.ul_count >= p.n_ul:
                nxt = 'ACQ'
                summary['unlocks'] += 1
            elif slipped:
                summary['slips'] += 1
                if ctx.state in ('CAL', 'RECAL'):
                    nxt = 'HOLD'
            elif ctx.state == 'PLOCK':
                if ctx.pl_count >= p.n_pl and settled and dtc['ok'] and harmonic_ok:
                    nxt = 'CAL'
                    if summary['enable_cycle'] < 0:
                        summary['enable_cycle'] = n
                    elif loss_seen and summary['relock_cycles'] < 0:
                        summary['relock_cycles'] = n - p.loss_cycle
            elif ctx.state == 'CAL':
                if ctx.pl_count == 0:
                    nxt = 'HOLD'
                    summary['holds'] += 1
            elif ctx.state == 'HOLD':
                if ctx.pl_count >= p.n_pl and settled and harmonic_ok:
                    nxt = 'RECAL'
            elif ctx.state == 'RECAL':
                nxt = 'CAL'
            if acted in ('PLOCK', 'HOLD'):
                if summary['phase_lock_cycle'] < 0 and ctx.pl_count >= p.n_pl:
                    summary['phase_lock_cycle'] = n
                if summary['settle_cycle'] < 0 and settled:
                    summary['settle_cycle'] = n
        if nxt is not None and nxt != ctx.state:
            ctx.state = nxt
        state[n] = ACQ_STATES.index(acted)
        theta[n] = ctx.theta
        if ctx.state != seg_state:
            segments.append((seg_state, seg_start, n + 1))
            seg_start, seg_state = n + 1, ctx.state
    segments.append((seg_state, seg_start, cycles))
    en = summary['enable_cycle']
    summary['lock_blocks'] = math.ceil((en + 1) / p.block_n) if en >= 0 else math.inf
    summary['relock_blocks'] = math.ceil(summary['relock_cycles'] / p.block_n) if summary['relock_cycles'] >= 0 else -1
    return {'df': df, 'theta': theta, 'state': state, 'segments': segments, 'summary': summary}


def acquisition_timeline(p: AcqParams) -> dict[str, Any]:
    """無雜訊版本（σ_f = σ_θ = 0）：確定性時間表。"""
    return run_acquisition(replace(p, sigma_f_hz=0.0, sigma_theta_fs=0.0), None)
