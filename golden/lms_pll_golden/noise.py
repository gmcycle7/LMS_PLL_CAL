"""§12：Comparator Noise → 係數雜訊 → PLL Output（T13、T14、T15）。

近最佳點 ``δw_k = w_k − w*``：``G_k ≈ −Kδw_k + η_k`` ⇒ ``δw_{k+1} = p δw_k + μη_k``，``p = 1 − μK``。
``H_{η→w}(z) = μ/(z − p)``；白色 η 時 ``σ_w² = μ²σ_η²/(1 − p²)``。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import integrate, optimize, special

from .comparator import kq


@dataclass(frozen=True)
class CalNoiseExample:
    k: float  # fs^-1（K = K_q·C）
    g: float  # μK，無因次
    p: float  # 1 − g
    sigma_w: float  # fs
    f_u: float  # Hz


def cal_noise_example(mu: float, sigma_v: float, c: float, n: int, fs: float, sigma_eta2: float | None = None) -> CalNoiseExample:
    """§12.1 示例：``K = K_q C``、``p = 1 − μK``、``σ_w = μ√(σ_η²/(1−p²))``（預設 σ_η² = 1/N）。"""
    k = kq(sigma_v) * c
    g = mu * k
    p = 1.0 - g
    s2 = 1.0 / n if sigma_eta2 is None else sigma_eta2
    sigma_w = math.sqrt(sigma_w2_closed(mu, s2, p))
    return CalNoiseExample(k=k, g=g, p=p, sigma_w=sigma_w, f_u=fs / n)


def sigma_w2_closed(mu: float, sigma_eta2: float, p: float) -> float:
    """``σ_w² = μ² σ_η² / (1 − p²)``，需 |p| < 1。"""
    if abs(p) >= 1:
        raise ValueError('|p| ≥ 1：不存在穩態變異')
    return mu * mu * sigma_eta2 / (1.0 - p * p)


# ---------------------------------------------------------------------------
# §12 Calibration 頻寬的四種定義（T14）
# ---------------------------------------------------------------------------


def coef_noise_tf(mu: float, p: float, omega: float | np.ndarray) -> np.ndarray:
    """``H(e^{jΩ}) = μ/(e^{jΩ} − p)``。"""
    return mu / (np.exp(1j * np.asarray(omega)) - p)


def coef_noise_psd(mu: float, p: float, omega: float | np.ndarray, s_eta: float | np.ndarray) -> np.ndarray:
    """``S_w(e^{jΩ}) = μ² S_η / |1 − p e^{−jΩ}|²``（two-sided DTFT 形式：σ² = (1/2π)∫S dΩ，即每 cycle/block；Ω 為 rad/block）。"""
    om = np.asarray(omega)
    return mu * mu * np.asarray(s_eta) / np.abs(1.0 - p * np.exp(-1j * om)) ** 2


def bw_one_minus_p(p: float, f_u: float) -> float:
    """近似 ``(1 − p)/(2π)·f_u``。"""
    return (1.0 - p) / (2.0 * math.pi) * f_u


def bw_neg_ln_p(p: float, f_u: float) -> float:
    """近似 ``−ln(p)/(2π)·f_u``（連續時間等效 Pole ``s = f_u ln p``）。"""
    return -math.log(p) / (2.0 * math.pi) * f_u


def bw_exact_3db_closed(p: float, f_u: float) -> float:
    """``|H(e^{jΩ})|² = |H(1)|²/2`` 的精確解：``cos Ω = (1 + p² − 2(1−p)²)/(2p)``。"""
    cos_om = (1.0 + p * p - 2.0 * (1.0 - p) ** 2) / (2.0 * p)
    if not -1.0 <= cos_om <= 1.0:
        raise ValueError('此 p 在 Nyquist 內沒有 −3 dB 點')
    return math.acos(cos_om) / (2.0 * math.pi) * f_u


def bw_exact_3db_numeric(p: float, f_u: float) -> float:
    """以 brentq 數值求 −3 dB 頻率（不用封閉式）。"""
    h0 = abs(coef_noise_tf(1.0, p, 0.0)) ** 2

    def f(freq: float) -> float:
        return float(abs(coef_noise_tf(1.0, p, 2.0 * math.pi * freq / f_u)) ** 2 / h0 - 0.5)

    return optimize.brentq(f, 1e-9 * f_u, 0.5 * f_u, xtol=1e-9, rtol=1e-15, maxiter=500)


def enbw_one_sided_closed(p: float, f_u: float) -> float:
    """One-sided equivalent noise bandwidth ``(1/|H(0)|²)∫_0^{f_u/2}|H|² df = f_u(1−p)/(2(1+p))``。"""
    return f_u * (1.0 - p) / (2.0 * (1.0 + p))


def enbw_one_sided_numeric(p: float, f_u: float) -> float:
    h0 = abs(coef_noise_tf(1.0, p, 0.0)) ** 2

    def f(freq: float) -> float:
        return float(abs(coef_noise_tf(1.0, p, 2.0 * math.pi * freq / f_u)) ** 2 / h0)

    val, _ = integrate.quad(f, 0.0, 0.5 * f_u, limit=500, epsabs=0.0, epsrel=1e-13, points=[bw_exact_3db_closed(p, f_u)])
    return val


# ---------------------------------------------------------------------------
# Monte Carlo：Block Sign-GMAC（x = ±1 iid、Gaussian comparator noise）
# ---------------------------------------------------------------------------


def simulate_block_sign_lms_bpsk(
    rng: np.random.Generator,
    dw0: float | np.ndarray,
    mu: float,
    sigma: float,
    n: int,
    blocks: int,
    chains: int,
    polarity: float = 1.0,
    record: bool = False,
) -> np.ndarray:
    """Block Sign-LMS（§15.2）在 ``x[n] = ±1`` iid、``v ~ N(0, σ²)``、識別路徑 H = 1 時的精確快速模擬。

    因 ``q·x = sign((a−w)x + v)·x = sign((a−w) + v·x)``，而 ``v·x ~ N(0, σ²)`` 且彼此獨立，
    所以 ``Σ q·x = 2K − N``，``K ~ Bin(N, Φ((a−w)/σ))`` —— 與逐樣本模擬同分布（測試中另有交叉驗證）。

    追蹤 ``dw = w − a``；``polarity = −1`` 模擬 comparator 極性接反（q → −q）。
    回傳 shape (chains,) 的最終 dw，或 ``record=True`` 時 (blocks+1, chains) 的軌跡。
    """
    dw = np.broadcast_to(np.asarray(dw0, dtype=float), (chains,)).copy()
    traj = np.empty((blocks + 1, chains)) if record else None
    if traj is not None:
        traj[0] = dw
    for k in range(blocks):
        p_plus = special.ndtr(-dw / sigma)
        kk = rng.binomial(n, p_plus)
        g = polarity * (2.0 * kk - n) / n
        dw = dw + mu * g
        if traj is not None:
            traj[k + 1] = dw
    return traj if traj is not None else dw


def simulate_block_sign_lms_raw(
    rng: np.random.Generator, dw0: float, mu: float, sigma: float, n: int, blocks: int
) -> np.ndarray:
    """逐樣本版本（真的產生 x、v、q），用來驗證上面的 Binomial 化簡。回傳每個 block 後的 dw。"""
    dw = dw0
    out = np.empty(blocks + 1)
    out[0] = dw
    for k in range(blocks):
        x = rng.choice(np.array([-1.0, 1.0]), size=n)
        e = (-dw) * x + sigma * rng.standard_normal(n)
        q = np.where(e >= 0.0, 1.0, -1.0)
        dw = dw + mu * float(np.mean(q * x))
        out[k + 1] = dw
    return out


def var_ci_chi2(samples: np.ndarray, z: float) -> tuple[float, float, float]:
    """樣本變異與近似 ±z·SE 區間（SE 用樣本四階矩：Var(s²) ≈ (m4 − s⁴)/n）。"""
    x = samples - samples.mean()
    n = x.size
    s2 = float(np.mean(x**2) * n / (n - 1))
    m4 = float(np.mean(x**4))
    se = math.sqrt(max(m4 - s2 * s2, 0.0) / n)
    return s2, s2 - z * se, s2 + z * se


# ---------------------------------------------------------------------------
# §12.2 Code × Gain Noise Mixing 與 §12.4 Spur（T15）
# ---------------------------------------------------------------------------


def spur_beta(f_out: float, a_t_peak: float) -> float:
    """``β = 2π f_out A_t``（A_t 為 output timing tone 的 peak 值，單位 s）。"""
    return 2.0 * math.pi * f_out * a_t_peak


def spur_dbc_small_angle(f_out: float, a_t_peak: float) -> float:
    """單邊 Spur ≈ ``20 log10(β/2) = 20 log10(π f_out A_t)``（小角 PM、|T| = 1）。"""
    return 20.0 * math.log10(spur_beta(f_out, a_t_peak) / 2.0)


def spur_dbc_bessel(beta: float) -> float:
    """單一正弦 PM 的精確 sideband/carrier：``20 log10(J1(β)/J0(β))``。"""
    return 20.0 * math.log10(float(special.jv(1, beta) / special.jv(0, beta)))


def coherent_tone_amplitudes(x: np.ndarray, fs: float, freqs: list[float]) -> list[float]:
    """Coherent sampling 下以 rFFT 讀取各 tone 的 peak 振幅（頻率需落在整數 bin）。"""
    n = x.size
    spec = np.fft.rfft(x)
    out = []
    for f in freqs:
        kbin = f * n / fs
        if abs(kbin - round(kbin)) > 1e-9:
            raise ValueError(f'{f} Hz 不在整數 bin 上（非 coherent）')
        out.append(float(2.0 * abs(spec[int(round(kbin))]) / n))
    return out


def pm_sideband_dbc_fft(phi: np.ndarray, fs: float, f_offset: float) -> float:
    """對 ``exp(jφ(t))`` 做 FFT，回傳 +f_offset 處 sideband 相對 carrier（DC）的 dBc。"""
    n = phi.size
    spec = np.fft.fft(np.exp(1j * phi))
    kbin = int(round(f_offset * n / fs))
    return 20.0 * math.log10(abs(spec[kbin]) / abs(spec[0]))
