"""LMS × Fractional-N PLL Calibration Lab —— Python golden model。

依規格書章節組織的小型參考實作（只依賴 NumPy / SciPy）：

- ``lms``           §1–§3   純量 LMS、Sign-Error LMS、Mean / Mean-Square 穩定界限（T01–T03）
- ``comparator``    §5      1-bit Comparator 統計、方向判斷機率（T04–T05）
- ``polarity``      §6–§7   PLL Error Path 相位、Delay Alignment、Filtered-x（T06–T07）
- ``stability``     §8      Calibration PM、更新延遲界限、雙迴路耦合（T08–T09）
- ``mimo``          §9–§10  PE、Eigen/SVD、Preconditioner、Jacobian（T10–T11、T18）
- ``bias``          §11     Offset / INL 造成的固定點偏差（T12）
- ``noise``         §12     係數雜訊、Calibration BW、Spur（T13–T15）
- ``quantization``  §13     6-bit Freeze / Toggle / Stochastic Rounding / 1st-order ΔΣ（T16–T17）
- ``optimizer``     §14     Learning Rate / Accumulation Length 最佳化

所有函式皆為純函式；隨機模擬一律接受 ``numpy.random.Generator``（固定 seed 可重現）。
"""

from . import bias, comparator, lms, mimo, noise, optimizer, polarity, quantization, stability

__all__ = [
    'bias',
    'comparator',
    'lms',
    'mimo',
    'noise',
    'optimizer',
    'polarity',
    'quantization',
    'stability',
]

__version__ = '1.0.0'
