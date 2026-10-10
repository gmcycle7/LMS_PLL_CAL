"""GOS (sawtooth) / PHOS (circulant) mean-GMAC theory, joint 9x9 coupling and the PSD theorem."""
from __future__ import annotations

import math
from fractions import Fraction

import numpy as np
import pytest

from sspll_golden.predictions import (C_periodic, analyse_C, gamma_eff, gos_harmonic, gos_small_beta, intervals,
                                      kappa_rational, mode1_sure_band, phos_lambda_harmonic, physical_mix,
                                      sign_map_j4096, sim_cfg, single_line_phos)
from sspll_golden.regressors import NPH, W1, W_SQUARE, X_rational, sawtooth_line_power, seq_rational


# ----------------------------------------------------------------------------------- regressors
def test_SSPLL_regressor_sequences_and_fourier_weights():
    """rho in [0,1) with var 1/12 (irrational limit); sawtooth line powers sum to 1/12; mode-1 weights sum to 1,
    fundamental W1 = 64 sin^2(pi/8)/pi^2 = 0.94964; square-wave fundamental 8/pi^2 = 0.81057."""
    c, p = seq_rational(1013, 8192, np.arange(8192))
    assert c.min() >= 0 and c.max() < 1 and set(np.unique(p)) == set(range(8))
    assert np.var(c) == pytest.approx(1 / 12, rel=1e-5)
    assert np.sum(sawtooth_line_power(np.arange(1, 2_000_001))) == pytest.approx(1 / 12, rel=1e-6)
    ell = np.concatenate([1 + 8 * np.arange(0, 400000), 1 - 8 * np.arange(1, 400001)]).astype(float)
    assert np.sum(64 * np.sin(np.pi * ell / 8) ** 2 / (np.pi * ell) ** 2) == pytest.approx(1, abs=1e-6)
    assert W1 == pytest.approx(0.9496412, abs=1e-7)
    assert W_SQUARE == pytest.approx(0.8105695, abs=1e-7)


def test_SSPLL_pe_failure_at_quarter_and_half():
    """alpha = 1/4 and 1/2 visit only 4 and 2 PMUX phases (PE failure); alpha = k/8 makes GOS unobservable (rho == 0)."""
    for (P, Q, nph) in ((1, 4, 4), (1, 2, 2), (1, 8, 8), (3, 8, 8)):
        X = X_rational(P, Q)
        assert int((X[:, 1:].sum(0) > 0).sum()) == nph
        assert X[:, 0].var() == 0.0


# ----------------------------------------------------------------------------------- GOS
def test_SSPLL_gos_harmonic_matches_exact_periodic(loops):
    """C_GOS = sum_m Re Gamma(m beta)/(2 pi^2 m^2) equals the exact periodic value for 8 | Q (max err < 1e-8)."""
    for lp in loops.values():
        for P, Q in ((85, 4096), (171, 8192), (1013, 8192)):
            assert C_periodic(P, Q, gamma_eff(lp))[0, 0] == pytest.approx(gos_harmonic(P / Q, gamma_eff(lp)), abs=1e-8)


def test_SSPLL_gos_small_beta_asymptotes(loops):
    """Near-grid (beta -> 0): Type-II D=0: C ~ beta^2/Ki (dead zone, NOT inverted); D=1: C ~ -beta (inverted);
    Type-I: C ~ beta/(2K).  Checked at beta = 1/1024 (alpha = (1+beta)/8)."""
    P = 1024
    fr = Fraction(1, 8) + Fraction(1, 8 * P)
    beta = 1 / P
    L2 = loops['L2']
    C0 = C_periodic(fr.numerator, fr.denominator, gamma_eff(L2))[0, 0]
    C1 = C_periodic(fr.numerator, fr.denominator, gamma_eff(L2, 'D:1'))[0, 0]
    assert C0 == pytest.approx(2.493e-5, rel=2e-3)
    assert C0 == pytest.approx(beta ** 2 / L2.params['Ki'], rel=2e-3)
    assert C1 < 0 and C1 == pytest.approx(gos_small_beta(L2, beta, 1), rel=0.05)
    L1 = loops['L1']
    C0 = C_periodic(fr.numerator, fr.denominator, gamma_eff(L1))[0, 0]
    assert C0 == pytest.approx(gos_small_beta(L1, beta, 0), rel=0.01)
    # 12 C at beta = 1/1000 equals 12 beta^2/Ki = 3.137e-4 (L2)
    fr = Fraction(1, 8) + Fraction(1, 8000)
    assert 12 * C_periodic(fr.numerator, fr.denominator, gamma_eff(L2))[0, 0] == pytest.approx(3.137e-4, rel=2e-3)


def test_SSPLL_gos_nonnegative_rational_scan(loops):
    """Numerical support for the CONJECTURE 'GOS never inverts at D = 0' (no proof: Re H < 0 in a band):
    every reduced beta = a/b, b <= 300, gives C_GOS > 0 for L1, L2, L3; the minimum sits at the smallest beta."""
    for name, lp in loops.items():
        worst = np.inf
        for bb in range(2, 301):
            k = np.arange(1, bb)
            w = 1 / (4 * bb ** 2 * np.sin(np.pi * k / bb) ** 2)
            Rb = np.r_[0.0, lp.H(k / bb).real]
            a = np.array([x for x in range(1, bb // 2 + 1) if math.gcd(x, bb) == 1])
            Ca = (Rb[np.outer(a, k) % bb] * w).sum(1)
            assert np.all(Ca > 0), name
            worst = min(worst, Ca.min())
        if name == 'L2':
            assert 12 * worst == pytest.approx(12 / 300 ** 2 / lp.params['Ki'], rel=5e-3)


# ----------------------------------------------------------------------------------- PHOS
def test_SSPLL_phos_circulant_ergodic_and_common_mode(loops):
    """For 8 | Q the PHOS block is circulant, its DFT eigenvalues equal the ergodic harmonic sum, and lambda_0 = 0."""
    for name in ('L2', 'L3'):
        lp = loops[name]
        for P, Q in ((85, 4096), (1013, 8192)):
            C = C_periodic(P, Q, gamma_eff(lp))
            Cp = C[1:, 1:]
            assert np.max(np.abs(Cp - np.roll(np.roll(Cp, 1, 0), 1, 1))) < 1e-13
            r = kappa_rational(lp, P, Q)
            lam = phos_lambda_harmonic(P / Q, gamma_eff(lp))
            assert np.max(np.abs(np.array(r['km']) / 8 - lam[1:5])) < 1e-6
            assert abs(np.ones(8) @ Cp @ np.ones(8)) < 1e-14


def test_SSPLL_phos_point_values_alpha_1_over_50(loops):
    """alpha = 1/50 (Q = 50, 8 does not divide Q): 8 lambda_min = +0.1285 (L1), -0.1385 (L2), -0.0847 (L3);
    occupancy-normalised kappa -0.1443 (L2) -- the sim's -0.1447 is this normalisation; 12 C_GOS(L2) = 1.1086."""
    exp = {'L1': (0.1285, 0.1339), 'L2': (-0.1385, -0.1443), 'L3': (-0.0847, -0.0882)}
    for name, (e8, eocc) in exp.items():
        lp = loops[name]
        C, cov, mu = C_periodic(1, 50, gamma_eff(lp), 'right', True)
        a = analyse_C(C, cov)
        assert 8 * a['phos_min_re'] == pytest.approx(e8, abs=6e-5)
        assert kappa_rational(lp, 1, 50)['kP'] == pytest.approx(eocc, abs=6e-5)
    assert 12 * C_periodic(1, 50, gamma_eff(loops['L2']))[0, 0] == pytest.approx(1.1086, abs=1e-4)
    # alpha = 21/1000 (8 | Q): exact periodic = ergodic = -0.1395 (L2)
    lam = phos_lambda_harmonic(0.021, gamma_eff(loops['L2']))
    assert 8 * lam[1:].real.min() == pytest.approx(-0.1395, abs=1e-4)
    assert single_line_phos(0.021, gamma_eff(loops['L2'])) == pytest.approx(-0.1950, abs=1e-4)


def test_SSPLL_mode1_sure_inversion_band(loops):
    """Rigorous mode-1 bound (ergodic / 8 | Q): inversion guaranteed for alpha f_ref in L2 [32.68, 125.33] MHz,
    L3 [27.72, 105.09] MHz (Re H < -0.0626 / -0.0636); impossible above 136.38 / 118.78 MHz."""
    s2 = mode1_sure_band(loops['L2'])
    s3 = mode1_sure_band(loops['L3'])
    assert s2['threshold_ReH'] == pytest.approx(-0.06264, abs=1e-5)
    assert s3['threshold_ReH'] == pytest.approx(-0.06359, abs=1e-5)
    assert s2['sure_MHz'] == pytest.approx([32.680, 125.328], abs=2e-3)
    assert s3['sure_MHz'] == pytest.approx([27.724, 105.092], abs=2e-3)
    assert s2['impossible_above_MHz'] == pytest.approx(136.38, abs=0.01)
    assert s3['impossible_above_MHz'] == pytest.approx(118.78, abs=0.01)
    # every reduced rational with Q <= 120 inside the sure band is inverted (8 | Q or not)
    for name, (lo, hi) in (('L2', s2['sure_MHz']), ('L3', s3['sure_MHz'])):
        lp = loops[name]
        n = 0
        for Q in range(2, 121):
            for P in range(math.ceil(lo / 4000 * Q), math.floor(hi / 4000 * Q) + 1):
                if math.gcd(P, Q) != 1 or not (lo <= P / Q * 4000 <= hi):
                    continue
                C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
                assert analyse_C(C, cov)['phos_min_re'] < 0
                n += 1
        assert n > 20


def test_SSPLL_phos_sign_map_j4096(loops):
    """Exact sign map alpha = j/4096: L1 never inverted; L2 tau=1e-2 band 29.3-124.0 MHz, worst -0.1397 @ 83.0 MHz;
    L3 23.4-103.5 MHz, worst -0.0957 @ 67.4 MHz; alias dead zones near 1/4 and 1/2 only at tau = 1e-3; GOS never < 0."""
    m1 = sign_map_j4096(loops['L1'])
    assert m1['kP'].min() > 0 and np.nanmin(m1['kG']) > 0      # kG = NaN at alpha = k/8 (rho == 0)
    m2 = sign_map_j4096(loops['L2'])
    fm = np.round(m2['f_MHz'], 1).tolist()
    assert intervals(fm, (m2['kP'] < -1e-2).tolist()) == [[29.3, 124.0]]
    b3 = intervals(fm, (m2['kP'] < -1e-3).tolist())
    assert b3 == [[12.7, 19.5], [22.5, 125.0], [980.5, 987.3], [1012.7, 1019.5], [1960.0, 1974.6], [1980.5, 1987.3]]
    assert m2['kP'].min() == pytest.approx(-0.1397, abs=1e-4)
    assert m2['f_MHz'][np.argmin(m2['kP'])] == pytest.approx(83.0, abs=0.01)
    assert np.nanmin(m2['kG']) > 0
    m3 = sign_map_j4096(loops['L3'])
    fm3 = np.round(m3['f_MHz'], 1).tolist()
    assert intervals(fm3, (m3['kP'] < -1e-2).tolist()) == [[23.4, 103.5]]
    assert intervals(fm3, (m3['kP'] < -1e-3).tolist()) == [[14.6, 105.5]]
    assert m3['kP'].min() == pytest.approx(-0.0957, abs=1e-4)


def test_SSPLL_alias_zone_is_only_a_dead_zone(loops):
    """Near 1/4 the m4 regressor is a square wave (81 % fundamental): 0.81 min Re H + 0.19 max Re H > 0, so
    alias-zone inversion is never guaranteed; worst 8-not-dividing-Q rational near 1/4 (Q <= 60): 15/59 -> -0.0085."""
    for name in ('L2', 'L3'):
        f = np.linspace(1e-6, 0.5, 200001)
        h = loops[name].H(f).real
        assert W_SQUARE * h.min() + (1 - W_SQUARE) * h.max() > 0
    assert kappa_rational(loops['L2'], 15, 59)['kP'] == pytest.approx(-0.0085, abs=1e-4)


# ----------------------------------------------------------------------------------- joint 9x9
def test_SSPLL_gos_phos_decoupling(loops):
    """C[0,1:] = C[1:,0] = 0 exactly for 8 | Q (rho has lines only at l = 0 mod 8, where the indicators have no
    weight except l = 0 and Gamma(0) = 0); coupling exists only for 8 not dividing Q."""
    L2 = loops['L2']
    for P, Q in ((85, 4096), (13, 1000), (7, 120)):
        C = C_periodic(P, Q, gamma_eff(L2))
        assert max(np.abs(C[0, 1:]).max(), np.abs(C[1:, 0]).max()) < 1e-15
    assert np.abs(C_periodic(1, 50, gamma_eff(L2))[0, 1:]).max() == pytest.approx(7.8e-3, abs=1e-4)
    assert np.abs(C_periodic(12, 383, gamma_eff(L2))[0, 1:]).max() == pytest.approx(1.0e-3, abs=1e-4)


def test_SSPLL_no_joint_only_inversion(loops):
    """Every reduced P/Q with Q <= 80: the joint 9x9 is inverted only if GOS or PHOS alone is inverted."""
    for name, lp in loops.items():
        nj = 0
        for Q in range(2, 81):
            for P in range(1, Q // 2 + 1):
                if math.gcd(P, Q) != 1:
                    continue
                C, cov, mu = C_periodic(P, Q, gamma_eff(lp), 'right', True)
                a = analyse_C(C, cov)
                inv_j = a['joint_min_re'] < -1e-6
                inv_sep = a['phos_min_re'] < -1e-6 or (a['gos_observable'] and a['gos'] < -1e-6)
                assert not (inv_j and not inv_sep), (name, P, Q)
                nj += inv_j
        assert (nj == 0) == (name == 'L1')


def test_SSPLL_psd_theorem_random_kernel():
    """THEOREM: Re Gamma_eff(f) >= 0 for all f  =>  Re eig(C) >= 0 for the joint 9x9 at ANY alpha (any Q)."""
    rng = np.random.default_rng(1)
    G = lambda f: np.abs(1 + 0.9 * np.exp(-2j * np.pi * f * 3)) ** 2 + 5j * np.sin(14 * np.pi * f)  # noqa: E731
    worst = np.inf
    for _ in range(200):
        Q = int(rng.integers(9, 300))
        P = int(rng.integers(1, Q))
        if math.gcd(P, Q) != 1:
            continue
        worst = min(worst, np.linalg.eigvals(C_periodic(P, Q, G)).real.min())
    assert worst >= -1e-12


def test_SSPLL_sign_independent_of_fvco(loops):
    """f_vco only enters through the physical eps/Delta coupling of the GOS column: exactly f_vco-independent for
    8 | Q (block-triangular), ~1 % (4th-5th digit) for 8 not dividing Q, never a sign change."""
    L2 = loops['L2']
    for P, Q, exact in ((21, 1000, True), (12, 383, False), (5, 163, False)):
        C, cov, mu = C_periodic(P, Q, gamma_eff(L2), 'right', True)
        vals = [analyse_C(C @ physical_mix(sim_cfg(f_vco=fv)), cov)['joint_min_re'] for fv in (12e9, 16e9, 24e9)]
        assert all(v < 0 for v in vals)
        if exact:
            assert max(vals) - min(vals) < 1e-12
            assert vals[0] == pytest.approx(-0.0174408, abs=1e-7)
        else:
            assert (max(vals) - min(vals)) / abs(vals[1]) < 0.02
