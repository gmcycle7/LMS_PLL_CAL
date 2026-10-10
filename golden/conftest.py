"""pytest 共用設定：把 golden/ 放進 sys.path，並提供固定 seed 的 RNG 工廠。"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

GOLDEN_DIR = Path(__file__).resolve().parent
if str(GOLDEN_DIR) not in sys.path:
    sys.path.insert(0, str(GOLDEN_DIR))

BASE_SEED = 20261010


@pytest.fixture
def make_rng():
    """``make_rng(offset)`` → ``np.random.default_rng(BASE_SEED + offset)``（PCG64，可重現）。"""

    def _make(offset: int) -> np.random.Generator:
        return np.random.default_rng(BASE_SEED + offset)

    return _make
