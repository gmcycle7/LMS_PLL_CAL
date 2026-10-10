"""§13：6-bit 校正係數的 Freeze / Toggle / Stochastic Rounding / 1st-order ΔΣ（T16、T17）。

一階 Error-Feedback Quantizer（§13.4）：

    v[n] = w_H[n] + r[n−1]
    y[n] = Q_6(v[n])
    r[n] = v[n] − y[n]          ⇒  y[n] = w_H[n] + r[n−1] − r[n]

以 ``fractions.Fraction`` 做精確有理數運算，避免 32.4 的二進位表示誤差干擾週期判定。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction

import numpy as np

TOGGLE_PATTERN_5 = (32, 32, 33, 32, 33)


def nearest_freeze(target: float, bits: int = 6) -> tuple[int, float]:
    """方法 A：Freeze 在最近 code；回傳 (code, static error = code − target)。"""
    code = int(min(max(math.floor(target + 0.5), 0), 2**bits - 1))
    return code, code - target


def pattern_mean(pattern: tuple[int, ...] | list[int]) -> Fraction:
    return Fraction(sum(pattern), len(pattern))


def find_period(seq: list, start: int = 0) -> int:
    """回傳 seq[start:] 的最小週期 P（需完整重複至少兩次才承認）；找不到回傳 0。"""
    tail = seq[start:]
    n = len(tail)
    for p in range(1, n // 2 + 1):
        if all(tail[i] == tail[i + p] for i in range(n - p)):
            return p
    return 0


def quantize_nearest(v: Fraction, bits: int = 6, saturate: bool = True) -> int:
    """``Q_6``：round-half-up 到整數，飽和到 [0, 2^bits − 1]。"""
    y = math.floor(v + Fraction(1, 2))
    if saturate:
        y = min(max(y, 0), 2**bits - 1)
    return int(y)


def quantize_floor(v: Fraction, bits: int = 6, saturate: bool = True) -> int:
    """Truncation（floor）版本，用來比較 rounding 規則的影響。"""
    y = math.floor(v)
    if saturate:
        y = min(max(y, 0), 2**bits - 1)
    return int(y)


@dataclass(frozen=True)
class EfResult:
    y: list[int]
    r: list[Fraction]
    v: list[Fraction]


def ef_quantizer_first_order(
    w_h: Fraction | list[Fraction], steps: int, bits: int = 6, r_init: Fraction = Fraction(0), rounding: str = 'nearest'
) -> EfResult:
    """一階 error-feedback quantizer（精確有理數）。``w_h`` 可為常數或序列。"""
    q = quantize_nearest if rounding == 'nearest' else quantize_floor
    r_prev = Fraction(r_init)
    ys: list[int] = []
    rs: list[Fraction] = []
    vs: list[Fraction] = []
    for n in range(steps):
        wn = w_h[n] if isinstance(w_h, list) else w_h
        v = Fraction(wn) + r_prev
        y = q(v, bits)
        r = v - y
        ys.append(y)
        rs.append(r)
        vs.append(v)
        r_prev = r
    return EfResult(y=ys, r=rs, v=vs)


def ef_quantizer_float(w_h: float, steps: int, bits: int = 6, r_init: float = 0.0) -> np.ndarray:
    """同上的浮點版本（示範浮點誤差下仍得相同 code 序列，或可能因 tie 而不同）。"""
    r_prev = r_init
    y = np.empty(steps)
    for n in range(steps):
        v = w_h + r_prev
        yn = min(max(math.floor(v + 0.5), 0), 2**bits - 1)
        y[n] = yn
        r_prev = v - yn
    return y


def line_spectrum(pattern: list[int] | tuple[int, ...]) -> np.ndarray:
    """週期序列一個週期的 DFT 係數大小 ``|X[k]|/P``（k = 0..P−1）。k=0 為平均值。"""
    x = np.asarray(pattern, dtype=float)
    return np.abs(np.fft.fft(x)) / x.size


def stochastic_rounding(rng: np.random.Generator, target: float, n: int) -> np.ndarray:
    """方法 C：以 ``frac(target)`` 機率輸出 ceil，否則 floor（每次獨立）。"""
    lo = math.floor(target)
    frac = target - lo
    return lo + (rng.random(n) < frac).astype(float)


def bernoulli_code_moments(lo: int, p_hi: float) -> tuple[float, float]:
    """``E[w_Q] = lo + p``、``Var = p(1−p)``。"""
    return lo + p_hi, p_hi * (1.0 - p_hi)


# ---------------------------------------------------------------------------
# §16.1 定點：GMAC accumulator 位元數與 two's-complement wrap
# ---------------------------------------------------------------------------


def accumulator_bits_required(input_bits: int, n: int) -> int:
    """有號 ``B_x``-bit 輸入累加 N 筆、最壞情況不溢位所需的有號位元數 ``B_x + ceil(log2 N)``。"""
    return input_bits + math.ceil(math.log2(n))


def wrap_twos_complement(value: int, bits: int) -> int:
    """把整數包到 ``bits``-bit two's complement 範圍 [−2^{bits−1}, 2^{bits−1} − 1]（溢位 wrap）。"""
    m = 1 << bits
    v = value % m
    return v - m if v >= (m >> 1) else v


def gmac_accumulate(samples: list[int], bits: int, mode: str = 'wrap') -> int:
    """逐筆累加：``mode='wrap'`` 模擬未保護的暫存器，``'saturate'`` 為飽和。"""
    lo, hi = -(1 << (bits - 1)), (1 << (bits - 1)) - 1
    acc = 0
    for s in samples:
        acc += s
        if mode == 'wrap':
            acc = wrap_twos_complement(acc, bits)
        elif mode == 'saturate':
            acc = min(max(acc, lo), hi)
        else:
            raise ValueError(f'unknown mode {mode!r}')
    return acc
