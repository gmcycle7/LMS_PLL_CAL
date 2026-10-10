"""pytest setup for the SSPLL GOS/PHOS golden model: sys.path + session-scoped loop fixtures."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

GOLDEN_DIR = Path(__file__).resolve().parent
if str(GOLDEN_DIR) not in sys.path:
    sys.path.insert(0, str(GOLDEN_DIR))

from sspll_golden.loops import (make_L1, make_L2, make_L3, make_P_only_L2, make_P_only_L3,  # noqa: E402
                                nominal_loops)

REPO = GOLDEN_DIR.parents[2]


@pytest.fixture(scope='session')
def loops():
    """The three nominal loops designed for |T| -3 dB = 320 MHz at f_ref = 4 GHz."""
    return nominal_loops()


@pytest.fixture(scope='session')
def models(loops):
    """Per-loop filtered-x models (exact, BW -20 %, BW +20 %, Type-I) and P-only loops."""
    L = loops
    return dict(L1=dict(loop=L['L1'], models={'exact': L['L1'], 'bw0.8': make_L1(bw=0.8 * 320e6),
                                              'bw1.2': make_L1(bw=1.2 * 320e6), 'typeI': L['L1']}, ponly=None),
                L2=dict(loop=L['L2'], models={'exact': L['L2'], 'bw0.8': make_L2(60, bw=0.8 * 320e6),
                                              'bw1.2': make_L2(60, bw=1.2 * 320e6), 'typeI': L['L1']},
                        ponly=make_P_only_L2(L['L2'])),
                L3=dict(loop=L['L3'], models={'exact': L['L3'], 'bw0.8': make_L3(60, 'impulse', bw=0.8 * 320e6),
                                              'bw1.2': make_L3(60, 'impulse', bw=1.2 * 320e6), 'typeI': L['L1']},
                        ponly=make_P_only_L3(L['L3'])))


@pytest.fixture(scope='session')
def sim_ref():
    """Stored time-domain simulator results (extracted by tools/extract_sim_reference.py)."""
    path = GOLDEN_DIR / 'reference' / 'sim_fine_reference.json'
    if not path.exists():
        pytest.skip('reference/sim_fine_reference.json missing (run tools/extract_sim_reference.py)')
    return json.load(open(path))


@pytest.fixture(scope='session')
def web_dir():
    d = REPO / 'src' / 'data' / 'sspll'
    if not d.exists():
        pytest.skip('src/data/sspll not exported yet (run tools/export_web_data.py)')
    return d
