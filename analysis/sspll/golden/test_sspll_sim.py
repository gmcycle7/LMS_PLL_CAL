"""Time-domain evidence: replica of the simulator's slope measurement vs the stored simulator results, exact
periodic theory vs simulator on the 500-point fine grid, large-signal (1-bit) counts, closed-loop sign-error LMS,
comparator DC offset."""
from __future__ import annotations

import numpy as np
import pytest

from sspll_golden.predictions import (C_periodic, gamma_eff, gos_offset_bias, kappa_inf_worst, large_signal_periodic,
                                      sim_cfg, theory_point)
from sspll_golden.simulator import final_stats, replica_kappa, replica_S, run_sign_lms

FINE = [round(0.001 * i, 3) for i in range(1, 501)]


def test_SSPLL_sim_config_reproduced(sim_ref):
    """The simulator's PMUX offsets eps (seed 7, rms 0.25 ps, mean removed) and Delta = T_vco/8 are reproduced."""
    cfg = sim_cfg()
    assert np.allclose(cfg['eps'], sim_ref['config']['eps_ps'], atol=1e-6)
    assert cfg['Delta'] == pytest.approx(sim_ref['config']['Delta_ps'])


@pytest.mark.parametrize('name', ['L1', 'L2', 'L3'])
def test_SSPLL_replica_matches_stored_sim(models, sim_ref, name):
    """Deterministic replica of sim.measure_S (2^16 samples, erf estimator) reproduces the stored kappa to 1e-5."""
    d = models[name]
    sim = sim_ref['loops'][name]
    for a in (0.004, 0.02, 0.137, 0.247, 0.496):
        i = FINE.index(a)
        rk = replica_kappa(replica_S(d['loop'], a, ('raw',), models=d['models']))
        assert rk['kP'] == pytest.approx(sim['kP']['raw'][i], abs=1e-5)
        assert rk['kG'] == pytest.approx(sim['kG']['raw'][i], abs=1e-5)


@pytest.mark.parametrize('name,n_sim,n_th', [('L1', 0, 0), ('L2', 44, 38), ('L3', 27, 23)])
def test_SSPLL_theory_vs_sim_fine_grid(models, sim_ref, name, n_sim, n_th):
    """Exact periodic theory (sim physics, accumulator side) vs sim on alpha = i/1000: max |dkappa| <= 3.2e-3,
    0 classification disagreements at tau = 1e-2; at tau = 1e-3 the only disagreements (L2: 6, L3: 4) are the
    alpha ~ 1/4 points where the erf estimator (comparator non-linearity under the +-30 fs probe) differs."""
    d = models[name]
    cfg = sim_cfg()
    th = np.array([theory_point(d['loop'], a, 'raw', d['models'], cfg, side='auto')['kP_simnorm'] for a in FINE])
    sp = np.array(sim_ref['loops'][name]['kP']['raw'], float)
    spl = np.array(sim_ref['loops'][name]['kP']['raw|lin'], float)
    assert np.max(np.abs(sp - th)) < 3.2e-3
    assert int(np.sum(sp < -1e-3)) == n_sim and int(np.sum(th < -1e-3)) == n_th
    assert int(np.sum((sp < -1e-2) != (th < -1e-2))) == 0
    assert int(np.sum((spl < -1e-3) != (th < -1e-3))) == 0          # linear estimator agrees exactly
    dis = [FINE[i] for i in np.nonzero((sp < -1e-3) != (th < -1e-3))[0]]
    assert all(abs(a - 0.25) < 0.006 for a in dis)
    if name == 'L2':
        assert sp.min() == pytest.approx(-0.1447, abs=1e-4) and th.min() == pytest.approx(-0.1443, abs=1e-4)


def test_SSPLL_gos_normalisation_factor_four(models, sim_ref):
    """The sim's GOS kappa keeps the regressor DC ((1-a)<c^2> ~ 0.97/3); theory uses var(rho) = 1/12:
    12 C_GOS / kappa_sim has median ~ 3.96-3.98."""
    from sspll_golden.predictions import gos_harmonic
    d = models['L2']
    h12 = np.array([12 * gos_harmonic(a, gamma_eff(d['loop'])) for a in FINE])
    sg = np.array(sim_ref['loops']['L2']['kG']['raw'], float)
    ok = np.abs(sg) > 1e-6
    assert np.median(h12[ok] / sg[ok]) == pytest.approx(3.982, abs=2e-3)


@pytest.mark.parametrize('name,n1,n5,ninf', [('L1', 0, 36, 34), ('L2', 70, 81, 83), ('L3', 58, 72, 75)])
def test_SSPLL_large_signal_counts(models, sim_ref, name, n1, n5, ninf):
    """1-bit comparator, large error amplitude A: periodic theory reproduces the sim's inverted-alpha counts exactly
    (A = 1 ps, 5 ps) and gives the A -> inf limit; the 1st-difference regressor has 0 at every A."""
    d = models[name]
    cfg = sim_cfg()
    w1, w5, wi, wd = [], [], [], []
    for a in FINE:
        ls = large_signal_periodic(d['loop'], a, (1.0, 5.0), cfg, 'raw', d['models'])
        g = [(ls[q]['g'][0] / ls[q]['g_open_loop'][0], ls[q]['g'][1] / ls[q]['g_open_loop'][1])
             for q in ls if not q.startswith('_') and abs(ls[q]['g_open_loop'][0]) > 1e-9]
        w1.append(min(x[0] for x in g))
        w5.append(min(x[1] for x in g))
        wi.append(kappa_inf_worst(ls))
        wd.append(kappa_inf_worst(large_signal_periodic(d['loop'], a, (), cfg, '1diff', d['models'])))
    w1, w5, wi, wd = map(np.array, (w1, w5, wi, wd))
    assert int(np.sum(w1 < -1e-3)) == n1 == sim_ref['loops'][name]['LS_summary']['raw']['A=1ps']['n_inverted']
    assert int(np.sum(w5 < -1e-3)) == n5 == sim_ref['loops'][name]['LS_summary']['raw']['A=5ps']['n_inverted']
    assert int(np.sum(wi < -1e-3)) == ninf
    assert int(np.sum(wd < -1e-3)) == 0


def test_SSPLL_large_signal_p_only_needs_ac(models):
    """P-only loop at A -> inf: raw GOS regressor still inverts 24 (L2) / 32 (L3) fine-grid alpha; with the
    mean-removed ('ac') GOS regressor L2 -> 0, L3 -> 8."""
    cfg = sim_cfg()
    for name, n_raw, n_ac in (('L2', 24, 0), ('L3', 32, 8)):
        p = models[name]['ponly']
        nr = sum(kappa_inf_worst(large_signal_periodic(p, a, (), cfg, 'raw')) < -1e-3 for a in FINE)
        na = sum(kappa_inf_worst(large_signal_periodic(p, a, (), cfg, 'ac')) < -1e-3 for a in FINE)
        assert (nr, na) == (n_raw, n_ac)


def test_SSPLL_lms_closed_loop_spot_checks(models):
    """Closed-loop sign-error LMS (real 1-bit comparator, sigma_v = 200 fs, N = 512, 2 lanes): raw diverges inside
    the L2 band (alpha = 0.02, PHOS rms 173 fs -> > 10 ps in the unbounded linear model); 1st difference,
    filtered-x and P-only converge to < 20 fs; L1 raw converges."""
    d = models['L2']
    raw = final_stats(run_sign_lms(d['loop'], 0.02, 'raw', n_blocks=3000, lanes=2, models=d['models']))
    assert raw['phos_rms_fs'] > 10000
    for v, lp in (('1diff', d['loop']), ('fx:exact', d['loop']), ('raw', d['ponly'])):
        st = final_stats(run_sign_lms(lp, 0.02, v, n_blocks=3000, lanes=2, models=d['models']))
        assert st['phos_rms_fs'] < 20 and st['gos_fs'] < 30, v
    st = final_stats(run_sign_lms(models['L1']['loop'], 0.02, 'raw', n_blocks=3000, lanes=2))
    assert st['phos_rms_fs'] < 20
    st = final_stats(run_sign_lms(d['loop'], 0.137, 'D:1', n_blocks=3000, lanes=2))
    assert st['phos_rms_fs'] > 500


def test_SSPLL_comparator_offset_needs_zero_mean_regressor(loops):
    """A comparator DC offset u_os is a forcing term outside eig(C).  Raw GOS bias = -E[q]<rho>/(K_q(u) C_GOS):
    u_os = 25 fs, L2 alpha = 0.137 -> -145.8 fs (formula); LMS: raw GOS > 80 fs and PHOS common mode drifts
    (> 1 ps), zero-mean ('zm') and 1st-difference regressors stay < 20 fs with no common-mode drift."""
    L2 = loops['L2']
    C, cov, mu = C_periodic(137, 1000, gamma_eff(L2), 'right', True)
    assert gos_offset_bias(C[0, 0], mu[0], 25.0, 200.0) == pytest.approx(-145.8, abs=0.1)
    raw = final_stats(run_sign_lms(L2, 0.137, 'raw', n_blocks=3000, lanes=2, seed=1, u_os=0.025))
    assert raw['gos_fs'] > 80 and raw['phos_cm_fs'] > 1000
    for v in ('zm', '1diff'):
        st = final_stats(run_sign_lms(L2, 0.137, v, n_blocks=3000, lanes=2, seed=1, u_os=0.025))
        assert st['gos_fs'] < 20 and st['phos_cm_fs'] < 1e-6 and st['phos_rms_fs'] < 20, v
