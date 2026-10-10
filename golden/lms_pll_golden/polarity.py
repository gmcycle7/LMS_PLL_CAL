"""§6–§7：PLL Error Path 相位、Delay Alignment 與多頻相關性判據（T06、T07）。

GMAC 使用原始（或延遲）code ``x_D[n] = x[n−D]``，PD 端看到 ``u[n] = (h*x)[n]``。
單頻 ``x[n] = A cos(Ωn)``、``H(e^{jΩ}) = |H| e^{jφ}``：

    C_D = E[x_D·u] = (A²/2)|H| cos(φ + ΩD)

平均更新 Pole ``p = 1 − μ K_q C``；C < 0 時任何正 μ 都使 |p| > 1（平均發散）。
"""

from __future__ import annotations

import math

import numpy as np
from scipy import integrate, signal


def wrap180(deg: float) -> float:
    """把角度包到 (−180°, 180°]。"""
    w = math.fmod(deg + 180.0, 360.0)
    if w <= 0:
        w += 360.0
    return w - 180.0


def single_tone_corr(a_amp: float, h_mag: float, phi_rad: float, omega: float = 0.0, delay: int = 0) -> float:
    """``C_D = (A²/2)|H| cos(φ + ΩD)``。"""
    return 0.5 * a_amp * a_amp * h_mag * math.cos(phi_rad + omega * delay)


def polarity_margin_deg(theta_deg: float) -> float:
    """§8.1 自訂工程指標 ``M_polarity = 90° − |wrap180(θ)|``。"""
    return 90.0 - abs(wrap180(theta_deg))


def cal_pole(mu: float, k_q: float, c: float) -> float:
    """§6 等效更新 Pole ``p = 1 − μ K_q C``。"""
    return 1.0 - mu * k_q * c


def fir_with_response(h_mag: float, phi_rad: float, omega: float) -> np.ndarray:
    """構造 2-tap 實係數因果 FIR ``h = [h0, h1]`` 使 ``H(e^{jΩ}) = |H|e^{jφ}``。

    ``h0 + h1 e^{−jΩ} = |H|e^{jφ}`` ⇒ ``h1 = −|H| sinφ / sinΩ``、``h0 = |H|cosφ − h1 cosΩ``。
    （需 sinΩ ≠ 0。）用於以「真實濾波器 + 時域相關」驗證單頻公式。
    """
    s = math.sin(omega)
    if abs(s) < 1e-12:
        raise ValueError('Ω = 0 或 π 時 2-tap FIR 無法產生任意相位')
    h1 = -h_mag * math.sin(phi_rad) / s
    h0 = h_mag * math.cos(phi_rad) - h1 * math.cos(omega)
    return np.array([h0, h1])


def freq_response(b: np.ndarray, a: np.ndarray, omega: float) -> complex:
    """``H(e^{jΩ}) = B(e^{jΩ})/A(e^{jΩ})``（係數以 z^{-1} 升冪排列）。"""
    z1 = np.exp(-1j * omega * np.arange(len(b)))
    num = complex(np.dot(b, z1))
    z1a = np.exp(-1j * omega * np.arange(len(a)))
    den = complex(np.dot(a, z1a))
    return num / den


def tone_corr_time_domain(
    a_amp: float, h: np.ndarray, omega: float, delay: int, periods: int, period_samples: int
) -> float:
    """時域：``x = A cos(Ωn)`` 通過 FIR ``h``，與延遲 D 的 x 取整數週期平均相關。"""
    warm = len(h) + delay + period_samples
    n = np.arange(warm + periods * period_samples)
    x = a_amp * np.cos(omega * n)
    u = signal.lfilter(h, [1.0], x)
    seg = slice(warm, warm + periods * period_samples)
    xd = a_amp * np.cos(omega * (n - delay))
    return float(np.mean(xd[seg] * u[seg]))


def simulate_block_sign_lms_tone(
    rng: np.random.Generator,
    a: float,
    w0: float,
    mu: float,
    sigma: float,
    a_amp: float,
    h: np.ndarray,
    omega: float,
    n: int,
    blocks: int,
    delay: int = 0,
    polarity: float = 1.0,
) -> np.ndarray:
    """§15.2 逐樣本 Block Sign-LMS（單頻 code）。

    ``x[n] = A cos(Ωn)``；PD 看到 ``e[n] = (a − w)·(h*x)[n] + v[n]``，``v ~ N(0, σ²)``；
    ``q = polarity·sign(e)``；GMAC 用 ``x[n − D]``；``w ← w + μ·(1/N)Σ q x[n−D]``。
    濾波器狀態跨 block 連續（以解析式計算 x 的過去值）。回傳每個 block 後的 ``δ = a − w``。
    """
    idx = np.arange(blocks * n)
    u = np.zeros(idx.size)
    for k, hk in enumerate(h):
        u += hk * a_amp * np.cos(omega * (idx - k))
    xd = a_amp * np.cos(omega * (idx - delay))
    w = w0
    out = np.empty(blocks + 1)
    out[0] = a - w
    for k in range(blocks):
        sl = slice(k * n, (k + 1) * n)
        e = (a - w) * u[sl] + sigma * rng.standard_normal(n)
        q = polarity * np.where(e >= 0.0, 1.0, -1.0)
        w = w + mu * float(np.mean(q * xd[sl]))
        out[k + 1] = a - w
    return out


def best_delay(phi_rad: float, omega: float, d_max: int) -> int:
    """在 0..d_max 中選出使 cos(φ+ΩD) 最大的 D。"""
    vals = [math.cos(phi_rad + omega * d) for d in range(d_max + 1)]
    return int(np.argmax(vals))


# ---------------------------------------------------------------------------
# §6.1 二階 Type-II 風格的 Error Transfer
# ---------------------------------------------------------------------------


def hpd_second_order(w_over_wn: float, zeta: float) -> complex:
    """``H_PD(s) = s² / (s² + 2ζω_n s + ω_n²)``，在 ``s = jω`` 取值（以 ω/ω_n 正規化）。"""
    s = 1j * w_over_wn
    return s * s / (s * s + 2.0 * zeta * s + 1.0)


# ---------------------------------------------------------------------------
# §6.2 多頻判據：C = (1/2π)∫ S_xx Re{H} dΩ
# ---------------------------------------------------------------------------


def corr_from_psd(sxx, hfun, delay: int = 0) -> float:
    """數值積分 ``C_D = (1/2π)∫_{−π}^{π} S_xx(Ω) Re{H(Ω) e^{jΩD}} dΩ``。"""

    def integrand(om: float) -> float:
        return float(sxx(om) * (hfun(om) * np.exp(1j * om * delay)).real)

    val, _err = integrate.quad(integrand, -math.pi, math.pi, limit=400, epsabs=1e-13, epsrel=1e-12)
    return val / (2.0 * math.pi)


def ar1_psd(a1: float, sigma_w2: float):
    """AR(1) ``x[n] = a1 x[n−1] + w[n]``：``S_xx = σ_w² / |1 − a1 e^{−jΩ}|²``。"""

    def sxx(om: float) -> float:
        return sigma_w2 / abs(1.0 - a1 * np.exp(-1j * om)) ** 2

    return sxx


def ar1_autocorr(a1: float, sigma_w2: float, lag: int) -> float:
    """AR(1) 自相關 ``R_x[ℓ] = σ_w² a1^{|ℓ|} / (1 − a1²)``。"""
    return sigma_w2 * a1 ** abs(lag) / (1.0 - a1 * a1)


def corr_fir_ar1_closed(h: np.ndarray, a1: float, sigma_w2: float, delay: int = 0) -> float:
    """``C_D = E[x[n−D]·(h*x)[n]] = Σ_k h[k] R_x[k − D]``（封閉式，用來交叉驗證積分）。"""
    return float(sum(hk * ar1_autocorr(a1, sigma_w2, k - delay) for k, hk in enumerate(h)))
