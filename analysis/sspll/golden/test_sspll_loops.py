"""Loop models, H_PD = 1/(1+L), inversion bands and their closed forms (L1 / L2 / L3 at f_ref 4 GHz, BW 320 MHz)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from sspll_golden.loops import (TWO_PI, cppll_minus_ReL, make_L1, make_L2, make_L3, make_P_only_L3,
                                typeI_K_closed_form, typeI_latency_criterion, typeI_pole_criterion, typeI_ReH,
                                typeII_f_inv, typeII_ReL)

F_REF = 4e9


def MHz(f):
    return f * F_REF / 1e6


def test_SSPLL_loop_design_parameters(loops):
    """All three loops: |T| -3 dB = 320.000000 MHz, stable, h_PD[0] = 1; parameters as reconciled."""
    L1, L2, L3 = loops['L1'], loops['L2'], loops['L3']
    assert L1.params['K'] == pytest.approx(0.388836, abs=1e-6)
    assert L1.params['K'] == pytest.approx(typeI_K_closed_form(), rel=1e-14)
    assert L2.params['Kp'] == pytest.approx(0.287717, abs=1e-6)
    assert L2.params['Ki'] == pytest.approx(0.0382535, abs=1e-7)
    assert L3.params['b'] == pytest.approx(13.928, abs=1e-3)
    assert L3.params['wc'] == pytest.approx(0.303955, abs=1e-6)
    for lp, pm in ((L1, 78.789), (L2, 60.000), (L3, 58.581)):
        s = lp.summary()
        assert s['f3dB_MHz'] == pytest.approx(320.0, abs=1e-6)
        assert s['PM_deg'] == pytest.approx(pm, abs=2e-3)
        assert s['stable'] and s['h0'] == 1.0


def test_SSPLL_inversion_identity_and_peaking(loops):
    """Re H < 0  <=>  Re L < -1  <=>  Re T > 1 (exact for any L), and Re H < 0 implies |T| > 1."""
    f = np.concatenate([np.geomspace(1e-8, 1e-3, 2000, endpoint=False), np.linspace(1e-3, 0.5, 200001)])
    for lp in loops.values():
        Lf, Hf = lp.L(f), lp.H(f)
        Tf = Lf / (1 + Lf)
        assert np.all((Hf.real < 0) == (Lf.real < -1))
        assert np.all((Hf.real < 0) == (Tf.real > 1))
        assert not np.any((Hf.real < 0) & (np.abs(Tf) <= 1))
        assert np.allclose(Hf.real, (1 + Lf.real) / np.abs(1 + Lf) ** 2, rtol=1e-9, atol=1e-15)


def test_SSPLL_typeI_ReH_closed_form_nonnegative(loops):
    """L1: Re H = (2-K)(1-cos W)/|1-(1-K)e^{-jW}|^2 >= 0 -> no inversion band (nominal model)."""
    L1 = loops['L1']
    f = np.linspace(1e-6, 0.5, 100001)
    assert np.max(np.abs(L1.H(f).real - typeI_ReH(L1.params['K'], f))) < 1e-13
    assert L1.H(f).real.min() >= 0
    assert L1.inversion_bands() == []


def test_SSPLL_typeII_band_edge_closed_form(loops):
    """L2: Re L = -Kp/2 - Ki/(4 sin^2(W/2)); band 0 .. f_inv = (f_ref/pi) asin sqrt(Ki/(2(2-Kp))) = 134.820 MHz."""
    L2 = loops['L2']
    Kp, Ki = L2.params['Kp'], L2.params['Ki']
    f = np.linspace(1e-4, 0.5, 20001)
    assert np.max(np.abs(L2.L(f).real / typeII_ReL(Kp, Ki, f) - 1)) < 1e-8
    b = L2.inversion_bands()
    assert len(b) == 1 and b[0]['f_lo'] == 0.0
    assert MHz(b[0]['f_hi']) == pytest.approx(MHz(typeII_f_inv(Kp, Ki)), abs=1e-6)
    assert MHz(b[0]['f_hi']) == pytest.approx(134.820, abs=1e-3)
    assert b[0]['min_ReH'] == pytest.approx(-0.2053, abs=1e-4)
    assert MHz(b[0]['f_min']) == pytest.approx(83.8, abs=0.1)


def test_SSPLL_cppll_closed_form_and_mappings(loops):
    """L3 impulse-invariant: -Re L = K/(4 sin^2) + B(1-p^2)/(2|1-p e^{-jW}|^2); band 0-117.278 MHz.
    The band edge depends on the sampling mapping: halfT 115.64 MHz (PM 52.56), zoh 115.10 MHz (PM 52.04)."""
    L3 = loops['L3']
    f = np.linspace(1e-4, 0.5, 20001)
    cf = cppll_minus_ReL(L3, f)
    assert np.max(np.abs(-L3.L(f).real - cf) / cf) < 1e-8
    b = L3.inversion_bands()
    assert len(b) == 1 and MHz(b[0]['f_hi']) == pytest.approx(117.278, abs=1e-3)
    assert b[0]['min_ReH'] == pytest.approx(-0.1616, abs=1e-4)
    h = make_L3(60, 'halfT')
    assert h.summary()['PM_deg'] == pytest.approx(52.56, abs=0.01)
    assert MHz(h.inversion_bands()[0]['f_hi']) == pytest.approx(115.64, abs=0.01)
    z = make_L3(60, 'zoh')
    assert MHz(z.inversion_bands()[0]['f_hi']) == pytest.approx(115.10, abs=0.01)


def test_SSPLL_low_frequency_derivative_law(loops):
    """Near DC: Type-II Re H ~ -Omega^2/Ki (L2) and -Omega^2/K (L3, K = (wc T)^2/sqrt b = 0.0247554);
    Type-I Re H ~ +(2-K) Omega^2/(2K^2) > 0."""
    L1, L2, L3 = loops['L1'], loops['L2'], loops['L3']
    fl = 1e-4
    W = TWO_PI * fl
    assert L2.H(fl).real / (-W ** 2 / L2.params['Ki']) == pytest.approx(1, abs=1e-4)
    assert L3.params['K'] == pytest.approx(0.0247554, abs=1e-7)
    assert L3.H(fl).real / (-W ** 2 / L3.params['K']) == pytest.approx(1, abs=1e-4)
    K = L1.params['K']
    assert L1.H(fl).real / ((2 - K) * W ** 2 / (2 * K ** 2)) == pytest.approx(1, abs=1e-4)


@pytest.mark.parametrize('lat,has_band', [(2, False), (4, False), (5, True)])
def test_SSPLL_typeI_latency_criterion(lat, has_band):
    """Type-I is NOT immune in general: L = K z^-d/(1-z^-1) has a band iff K(d-1/2) > 1 (d = 5: band 0-107.1 MHz)."""
    lp = make_L1(lat=lat)
    crit = typeI_latency_criterion(lp.params['K'], lat)
    b = lp.inversion_bands()
    assert (crit > 1) == has_band == bool(b)
    if lat == 5:
        assert crit == pytest.approx(1.101, abs=1e-3)
        assert MHz(b[0]['f_hi']) == pytest.approx(107.08, abs=0.01)


@pytest.mark.parametrize('f_pole,has_band', [(500e6, False), (250e6, False), (200e6, True)])
def test_SSPLL_typeI_pole_criterion(f_pole, has_band):
    """Type-I + discrete parasitic pole: band iff K(1/2 + p/(1-p)) > 1 (250 MHz: 0.993 none; 200 MHz: 1.373, 0-122.85 MHz)."""
    lp = make_L1(f_pole=f_pole)
    p = math.exp(-TWO_PI * f_pole / F_REF)
    crit = typeI_pole_criterion(lp.params['K'], p)
    b = lp.inversion_bands()
    assert (crit > 1) == has_band == bool(b)
    if f_pole == 200e6:
        assert crit == pytest.approx(1.373, abs=1e-3)
        assert MHz(b[0]['f_hi']) == pytest.approx(122.85, abs=0.01)


def test_SSPLL_p_only_loops(models, loops):
    """P-only remedy loops have no Re H < 0 band: L2 -> Type-I K = Kp (218.1 MHz); L3 C1 >> C2 model (267.8 MHz,
    PM 73.8, criterion A(1/2+p/(1-p)) = 0.296); exact R || C2 hold (298.0 MHz, PM 71.7, criterion 0.339)."""
    p2 = models['L2']['ponly']
    assert p2.f3db() * 4e3 == pytest.approx(218.09, abs=0.01)
    assert p2.inversion_bands() == []
    p3 = models['L3']['ponly']
    s3 = p3.summary()
    assert s3['f3dB_MHz'] == pytest.approx(267.84, abs=0.01) and s3['PM_deg'] == pytest.approx(73.79, abs=0.01)
    assert typeI_pole_criterion(p3.params['A'], p3.params['p']) == pytest.approx(0.2961, abs=1e-4)
    assert p3.inversion_bands() == []
    pe = make_P_only_L3(loops['L3'], exact_hold=True)
    se = pe.summary()
    assert se['f3dB_MHz'] == pytest.approx(297.95, abs=0.01) and se['PM_deg'] == pytest.approx(71.72, abs=0.01)
    assert typeI_pole_criterion(pe.params['A'], pe.params['p']) == pytest.approx(0.3392, abs=1e-4)
    assert pe.inversion_bands() == []


@pytest.mark.parametrize('g,edge_L2,edge_L3', [(0.6, 101.01, 84.86), (0.8, 118.56, 101.29), (1.25, 154.09, 137.36),
                                               (1.5, 172.73, 158.16)])
def test_SSPLL_pvt_loop_gain_moves_band_edge(loops, g, edge_L2, edge_L3):
    """PVT loop-gain scaling (not re-designed) moves the inversion band edge: keep-out lists need margin."""
    L2, L3 = loops['L2'], loops['L3']
    l2 = make_L2(Kp=L2.params['Kp'], Ki=L2.params['Ki'], gain_scale=g)
    l3 = make_L3(60, 'impulse', wc=L3.params['wc'], gain_scale=g)
    assert MHz(l2.inversion_bands()[0]['f_hi']) == pytest.approx(edge_L2, abs=0.01)
    assert MHz(l3.inversion_bands()[0]['f_hi']) == pytest.approx(edge_L3, abs=0.01)


def test_SSPLL_type_II_band_always_starts_at_DC():
    """Every Type-II design (PM 45 / 60 / 75, latency 2) has a band starting at DC; it only gets narrower."""
    edges = {}
    for nm, lp in (('pm45', make_L2(45)), ('pm75', make_L2(75)), ('lat2', make_L2(60, lat=2))):
        b = lp.inversion_bands()
        assert b and b[0]['f_lo'] == 0.0
        edges[nm] = MHz(b[0]['f_hi'])
    assert edges['pm45'] == pytest.approx(162.99, abs=0.01)
    assert edges['pm75'] == pytest.approx(72.30, abs=0.01)
    assert edges['lat2'] == pytest.approx(76.52, abs=0.01)
