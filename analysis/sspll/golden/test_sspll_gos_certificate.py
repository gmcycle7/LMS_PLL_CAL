# -*- coding: utf-8 -*-
"""GOS 'no inversion at D = 0' theorem (section 7b): L1 one-line proof, the L2/L3 computer-assisted certificate, the
single-point certificate used by HC-CS.10, and the consistency of the certificate's building blocks with the exact
rational formula.  Numbers are also written by tools/gos_certificate.py -> results/gos_certificate.json."""
from __future__ import annotations

import math
from fractions import Fraction

import numpy as np
import pytest

from sspll_golden.gos_certificate import (certificate, harmonic_number, harmonic_tail_weight, harmonic_weight, kernel_min,
                                          lipschitz, partial_sum, point_certificate, typeI_positive)
from sspll_golden.loops import make_L1, make_L2, make_L3
from sspll_golden.predictions import C_periodic, gamma_eff, gos_harmonic

TWO_PI2 = 2 * math.pi ** 2


def test_SSPLL_gos_theorem_typeI_one_line(loops):
    """L1: Re H_PD >= 0 everywhere (closed form, 0 < K < 2) => every harmonic term >= 0 => C(beta) > 0 for beta not integer."""
    K = float(loops['L1'].params['K'])
    f = np.linspace(0, 0.5, 20001)
    assert np.all(loops['L1'].H(f).real >= -1e-15)
    for b in (0.016, 0.123, 0.25, 0.5, 0.9):
        r = typeI_positive(K, b)
        assert r['ok'] and r['first_term'] > 0 and r['partial'] > r['first_term'] * 0.999
        assert r['partial'] == pytest.approx(gos_harmonic(b / 8, gamma_eff(loops['L1'])), rel=5e-3)   # M = 1000 vs 8192 + tail
    assert not typeI_positive(K, 0.0)['ok']          # beta = 0: rho == 0, GOS unobservable
    assert not typeI_positive(2.5, 0.3)['ok']        # K >= 2: closed form no longer >= 0


def test_SSPLL_gos_theorem_lipschitz_is_a_bound(loops):
    """|g'(f)| <= L_g = 2 pi sum n|h[n]|: check against the numerical derivative of Re H_PD on a fine grid; the residue
    expansion reproduces h[n] and the tail bound is negligible for N = 4096."""
    for lp in loops.values():
        lip = lipschitz(lp)
        assert lip['tail_bounded'] and lip['residual_err'] < 1e-10 and lip['tail'] < 1e-30
        f = np.linspace(0, 0.5, 400001)
        g = lp.H(f).real
        slope = np.max(np.abs(np.diff(g))) / (f[1] - f[0])
        assert slope <= lip['Lg']
        assert slope >= 0.3 * lip['Lg']             # the bound is not absurdly loose
    assert lipschitz(loops['L2'])['Lg'] == pytest.approx(49.0885, rel=1e-4)
    assert lipschitz(loops['L3'])['Lg'] == pytest.approx(50.9714, rel=1e-4)


def test_SSPLL_gos_theorem_weights_and_tail():
    """w_m sum to 1/12; H_M and T_M are what they claim; partial sums + tail weight = 1/12."""
    m = np.arange(1, 2_000_001)
    assert np.sum(harmonic_weight(m)) == pytest.approx(1 / 12, rel=1e-6)
    assert harmonic_number(4) == pytest.approx(25 / 12, rel=1e-14)
    for M in (4, 100, 1000):
        assert np.sum(harmonic_weight(np.arange(1, M + 1))) + harmonic_tail_weight(M) == pytest.approx(1 / 12, rel=1e-12)


def test_SSPLL_gos_theorem_certificate_nominal_loops(loops):
    """The certificate passes for L1/L2/L3 on beta in [0.016, 1/2] with M = 1000 (worst lower bound ~ beta_0^2/Ki for Type-II)."""
    exp = dict(L1=(0.019160, 39), L2=(0.006628, 126), L3=(0.010233, 122))
    for nm, lp in loops.items():
        r = certificate(lp)
        assert r['ok'], (nm, r.get('reason'))
        assert r['worst_at'] == pytest.approx(0.016)
        assert r['worst_lower'] == pytest.approx(exp[nm][0], rel=2e-3)
        assert abs(r['steps'] - exp[nm][1]) <= 2
        assert r['g_min'] <= 0 and r['tail_lower'] <= 0
    r2 = certificate(loops['L2'])
    assert r2['g_min'] == pytest.approx(-0.2053, abs=2e-4)
    assert r2['LamM'] == pytest.approx(49.0885 * harmonic_number(1000) / TWO_PI2, rel=1e-4)


def test_SSPLL_gos_theorem_certificate_dense_scan_loops():
    """Every loop of the dense scan (gos_dense_scan.py), including the Type-I loops that DO have a Re H < 0 band, passes."""
    for lp in (make_L2(45), make_L2(75), make_L2(60, lat=2), make_L3(45), make_L3(55), make_L3(60, 'halfT'), make_L1(lat=5),
               make_L1(f_pole=200e6)):
        r = certificate(lp)
        assert r['ok'], (lp.name, r.get('reason'))


def test_SSPLL_gos_theorem_certificate_extends_to_small_beta(loops):
    """Larger M pushes beta_0 down: L2 with M = 16000 passes from beta = 2^-10 (worst LB ~ beta_0^2/Ki = 2.5e-5)."""
    r = certificate(loops['L2'], beta_min=2 ** -10, beta_max=0.016, M=16000)
    assert r['ok'] and r['worst_at'] == pytest.approx(2 ** -10)
    assert r['worst_lower'] == pytest.approx((2 ** -10) ** 2 / loops['L2'].params['Ki'], rel=0.2)   # LB = C_M + g_min T_M sits below the exact value


def test_SSPLL_gos_theorem_certificate_fails_honestly_for_D1(loops):
    """Negative test: with the correlator one tap late (D = 1) C_GOS really is negative near-grid (exact rational formula);
    the pointwise lower bound of the same machinery applied to Re Gamma_eff(D:1) is negative at beta_0, and the walking
    certificate reports failure instead of 'ok'."""
    lp = loops['L2']
    fr = Fraction(1, 8) + Fraction(1, 8 * 64)
    assert C_periodic(fr.numerator, fr.denominator, gamma_eff(lp, 'D:1'))[0, 0] < 0

    class Shifted:                              # same loop, kernel Re Gamma_eff for D = 1 (= Re[H e^{+j2 pi f}])
        bH, aH = lp.bH, lp.aH
        name = 'L2_D1'

        def H(self, f):
            return gamma_eff(lp, 'D:1')(np.asarray(f, float))

        def impulse(self, n):
            return lp.impulse(n + 1)[1:]        # kernel shifted by one tap (residues no longer those of H: tail bound refused)

    sh = Shifted()
    Lg = lipschitz(lp)['Lg'] + 2 * math.pi   # a valid Lipschitz constant for the shifted kernel (extra h[0] cos 2 pi f term)
    gm = kernel_min(sh, Lg)['g_min']
    assert partial_sum(sh, 0.016, 1000) + gm * harmonic_tail_weight(1000) < 0
    r = certificate(sh)
    assert not r['ok'] and r['steps'] == 0


def test_SSPLL_gos_theorem_point_certificate_matches_exact(loops):
    """Single-point certificate (M = 4): the lower bound is below the exact harmonic sum, and the Lipschitz radius delta
    is consistent with the walking certificate; beta = 0.25 gives the HC-CS.10 numbers."""
    lp = loops['L2']
    for b in (0.25, 0.3, 0.123, 0.05):
        p = point_certificate(lp, b, 4)
        exact = gos_harmonic(b / 8, gamma_eff(lp), M=200000)
        assert p['lower'] <= exact + 1e-12
        assert p['CM'] == pytest.approx(partial_sum(lp, b, 4), rel=1e-14)
        assert p['delta'] == pytest.approx(p['lower'] / p['LamM'], rel=1e-14)
    p = point_certificate(lp, 0.25, 4)
    assert p['tail_weight'] == pytest.approx((math.pi ** 2 / 6 - (1 + 1 / 4 + 1 / 9 + 1 / 16)) / TWO_PI2, rel=1e-12)
    assert p['lower'] > 0 and p['delta'] > 0.01


def test_SSPLL_gos_theorem_small_beta_asymptote_ratio(loops):
    """beta < beta_0 is covered by the slow-sawtooth asymptote (approximate): C/(beta^2/Ki) stays within 1 % for beta <= 1/64."""
    lp = loops['L2']
    Ki = float(lp.params['Ki'])
    for b in (64, 128, 256, 512, 1000):
        beta = 1.0 / b
        C = gos_harmonic(beta / 8, gamma_eff(lp), M=200000)
        assert C / (beta ** 2 / Ki) == pytest.approx(1.0, abs=0.01)
    km = kernel_min(lp, lipschitz(lp)['Lg'])
    assert km['grid_min'] == pytest.approx(-0.20529, abs=2e-5) and km['f_at_min'] * 4000 == pytest.approx(83.8, abs=0.1)
