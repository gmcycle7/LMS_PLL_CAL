"""Remedies: 1st-difference regressor, filtered-x, P-only hold; harmful variants (D != 0, 2nd difference);
finite-step mean stability."""
from __future__ import annotations

import math

import numpy as np
import pytest

from sspll_golden.loops import make_L1, make_L2
from sspll_golden.predictions import (C_periodic, block_mean_stable, disc_constant, gamma_eff, kappa_rational,
                                      kernel_min, one_diff_margin)


@pytest.mark.parametrize('name,margin', [('L1', 0.3888), ('L2', 0.2686), ('L3', 0.2698)])
def test_SSPLL_one_diff_kernel_nonnegative(models, name, margin):
    """Gamma_1d = H(1-e^{jW}): Re >= 0 <=> 1 - cos W + Re{(1-e^{-jW}) L} >= 0; margins 0.389 / 0.2686 / 0.2698."""
    lp = models[name]['loop']
    assert one_diff_margin(lp)['min'] == pytest.approx(margin, abs=2e-4)
    assert kernel_min(lp, '1diff')['min'] >= -1e-15


def test_SSPLL_one_diff_typeII_closed_form(loops):
    """Type-II (one-cycle latency): g(W) = 1 - Ki/2 - (1-Kp) cos W  ->  safe iff Ki <= 2 Kp and Kp + Ki/2 <= 2;
    min g = Kp - Ki/2 = 0.26859 for L2."""
    L2 = loops['L2']
    Kp, Ki = L2.params['Kp'], L2.params['Ki']
    f = np.linspace(1e-4, 0.5, 20001)
    W = 2 * np.pi * f
    g = 1 - np.cos(W) + np.real((1 - np.exp(-1j * W)) * L2.L(f))
    assert np.max(np.abs(g - (1 - Ki / 2 - (1 - Kp) * np.cos(W)))) < 1e-9
    assert Kp - Ki / 2 == pytest.approx(0.26859, abs=1e-5)
    bad = make_L2(Kp=0.1, Ki=0.3)          # Ki > 2 Kp violates the condition
    assert kernel_min(bad, '1diff')['min'] < 0


def test_SSPLL_one_diff_disc_constant(models):
    """c = min Re Gamma/|Gamma|^2 = 0.403 / 0.423 / 0.459: finite-step mean stability for mu K_q lambda_max(R) < 2c."""
    for name, c in (('L1', 0.4028), ('L2', 0.4233), ('L3', 0.4591)):
        assert disc_constant(models[name]['loop']) == pytest.approx(c, abs=2e-4)


def test_SSPLL_filtered_x_robust(models):
    """filtered-x with exact / BW -20 % / BW +20 % / Type-I models: Re{H conj(H_hat)} >= 0 everywhere."""
    for name in ('L1', 'L2', 'L3'):
        d = models[name]
        for m in ('exact', 'bw0.8', 'bw1.2', 'typeI'):
            assert kernel_min(d['loop'], 'fx:' + m, d['models'])['min'] >= -1e-15


def test_SSPLL_filtered_x_typeI_model_critical_gain(loops):
    """A Type-I model has zero phase margin at DC against a Type-II loop: Re{H conj(H_hat)} ~ W^4 [1/2 + Kp/Ki - 1/K_hat],
    so K_hat must exceed 1/(Kp/Ki + 1/2) = 0.1247 (K_hat = 0.13 safe, 0.12 negative up to 27 MHz)."""
    L2 = loops['L2']
    Kc = 1 / (L2.params['Kp'] / L2.params['Ki'] + 0.5)
    assert Kc == pytest.approx(0.12467, abs=1e-5)
    ff = np.geomspace(1e-7, 0.5, 200001)
    g13 = np.real(L2.H(ff) * np.conj(make_L1(K=0.13).H(ff)))
    g12 = np.real(L2.H(ff) * np.conj(make_L1(K=0.12).H(ff)))
    assert g13.min() >= -1e-18
    assert g12.min() < 0 and ff[g12 < 0].max() * 4e3 == pytest.approx(27.0, abs=0.1)


def test_SSPLL_p_only_kernel(models):
    """P-only loops (L2 -> Type-I K = Kp; L3 C1 >> C2) have Re H >= 0 everywhere."""
    for name in ('L2', 'L3'):
        assert kernel_min(models[name]['ponly'])['min'] >= -1e-13


def test_SSPLL_harmful_variants(models):
    """Correlator delay D = 1: min Re Gamma = -H(1/2) = -1/(1-(Kp+Ki/2)/2) = -1.1812 (L2); -1.0853 (L3).
    Second difference: -0.2776 (L2), -0.4143 (L3).  Both invert generic alpha (e.g. L2 alpha = 0.137)."""
    L2, L3 = models['L2']['loop'], models['L3']['loop']
    Kp, Ki = L2.params['Kp'], L2.params['Ki']
    assert kernel_min(L2, 'D:1')['min'] == pytest.approx(-1 / (1 - (Kp + Ki / 2) / 2), abs=1e-4)
    assert kernel_min(L2, 'D:1')['min'] == pytest.approx(-1.1812, abs=1e-4)
    assert kernel_min(L3, 'D:1')['min'] == pytest.approx(-1.0853, abs=1e-4)
    assert kernel_min(L2, '2diff')['min'] == pytest.approx(-0.2776, abs=1e-4)
    assert kernel_min(L3, '2diff')['min'] == pytest.approx(-0.4143, abs=1e-4)
    assert kappa_rational(L2, 137, 1000, 'D:1')['kP'] < -0.5
    assert kappa_rational(L2, 137, 1000, '2diff')['kP'] < -0.1


def test_SSPLL_remedies_fix_inverted_points(models):
    """Inside the raw inversion band (L2 alpha = 21/1000, 83/4096; L3 alpha = 69/4096) every remedy restores Re eig > 0."""
    for name, (P, Q) in (('L2', (21, 1000)), ('L2', (85, 4096)), ('L3', (69, 4096))):
        d = models[name]
        assert kappa_rational(d['loop'], P, Q)['kP'] < -0.05
        for v in ('1diff', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', 'fx:typeI'):
            r = kappa_rational(d['loop'], P, Q, v, d['models'])
            assert r['kP'] > 0 and r['kG'] > 0
        r = kappa_rational(d['ponly'], P, Q)
        assert r['kP'] > 0 and r['kG'] > 0


def test_SSPLL_finite_step_mean_stability(loops):
    """Small-mu criterion Re kappa > 0 is not enough at finite block step: |1 - kappa/tau| < 1 <=> Re k > |k|^2/(2 tau).
    On alpha = j/4096 with tau = 25 blocks: L2 has 2 extra unstable alpha (127.0, 1959.0 MHz), L3 has 1 (106.4 MHz)."""
    for name, n_exp in (('L2', 2), ('L3', 1)):
        lp = loops[name]
        n = 0
        for j in range(1, 2049):
            g = math.gcd(j, 4096)
            P, Q = j // g, 4096 // g
            C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
            w, V = np.linalg.eigh(cov[1:, 1:])
            V = V[:, w > 1e-9]
            ev = 8 * np.linalg.eigvals(V.T @ C[1:, 1:] @ V)
            if np.all(ev.real > 1e-6) and not block_mean_stable(ev, 25.0):
                n += 1
        assert n == n_exp
    k = complex(0.0059, 0.6546)
    assert not block_mean_stable([k], 25.0) and block_mean_stable([k], 100.0)
