"""Exported website data (src/data/sspll/*.json): size limits, schema, and spot checks against the golden model."""
from __future__ import annotations

import json
from fractions import Fraction

import numpy as np
import pytest

from sspll_golden.predictions import kappa_rational

FILES = ['params.json', 'hpd_L1.json', 'hpd_L2.json', 'hpd_L3.json', 'signmap_L1.json', 'signmap_L2.json',
         'signmap_L3.json', 'pred_vs_sim.json']


def test_SSPLL_webdata_files_and_sizes(web_dir):
    for f in FILES:
        p = web_dir / f
        assert p.exists(), f
        assert p.stat().st_size < 400 * 1024, f
        json.load(open(p))
    assert sorted(x.name for x in web_dir.iterdir()) == sorted(FILES)


@pytest.mark.parametrize('name', ['L1', 'L2', 'L3'])
def test_SSPLL_webdata_hpd_matches_model(web_dir, loops, name):
    d = json.load(open(web_dir / f'hpd_{name}.json'))
    f = np.array(d['f_MHz'])
    assert len(f) <= 1500
    H = loops[name].H(f * 1e6 / 4e9)
    assert np.allclose(d['ReH'], H.real, rtol=2e-5, atol=2e-5)        # f and Re H stored to 6 significant digits
    assert d['f3dB_MHz'] == pytest.approx(320.0, abs=1e-5)


@pytest.mark.parametrize('name', ['L1', 'L2', 'L3'])
def test_SSPLL_webdata_signmap_matches_model(web_dir, loops, name):
    d = json.load(open(web_dir / f'signmap_{name}.json'))
    f = np.array(d['f_MHz'])
    assert len(f) <= 2000
    for i in (0, 82, 83, 499, 1000, 1985):
        fr = Fraction(2 * (i + 1) - 1, 8000)
        r = kappa_rational(loops[name], fr.numerator, fr.denominator)
        assert d['kP'][i] == pytest.approx(r['kP'], rel=1e-3, abs=1e-7)
        assert d['kG'][i] == pytest.approx(r['kG'], rel=1e-3, abs=1e-7)
        assert d['km1_re'][i] == pytest.approx(r['km'][0].real, rel=1e-3, abs=1e-7)
    if name == 'L2':
        assert d['summary']['phos_inverted_MHz_tau0.01'] == [[29.5, 123.5]]
        assert d['summary']['n_inverted_kP_1diff'] == 0 and d['summary']['n_inverted_kP_fx'] == 0
        assert d['summary']['n_inverted_kP_Ponly'] == 0
