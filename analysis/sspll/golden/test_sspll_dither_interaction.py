#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_sspll_dither_interaction.py -- code source (DSM dither / MASH / PMUX random rotation) x sign-LMS (case page section 10b).

Checks the closed forms of sspll_golden/dither_interaction.py against (1) their own Parseval / symmetry properties,
(2) the linear correlation measured on the actual sequences, (3) the time-domain simulator's stored kappa_PHOS
(results/sim_dither_extract.json), (4) the stored sweep results/dither_interaction.json, and (5) a short closed-loop
run of the headline case (L2 PM 45 deg, MASH, alpha = 0.03: dead zone -- the linear model makes no prediction -- and the MC grows;
PM 60 deg converges).  (6) the candidate dead-zone rules are scored on the stored MC: the two-stage rule "dead zone -> sign of
kappa_inf" is contradicted by 8 of the 18 dead-zone rows (so it is only a research-hypothesis hint on the page), the window rule
(linear e-folding over the MC length) has no mismatch.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from sspll_golden import dither_interaction as di
from sspll_golden.loops import make_L2
from sspll_golden.predictions import gamma_eff, phos_lambda_harmonic

HERE = Path(__file__).resolve().parent
SOURCES = list(di.CODE_SOURCES)


@pytest.fixture(scope='module')
def sweep():
    path = HERE / 'results' / 'dither_interaction.json'
    if not path.exists():
        pytest.skip('results/dither_interaction.json missing (run tools/dither_sweep.py)')
    return json.load(open(path))


@pytest.fixture(scope='module')
def sim_dither():
    return json.load(open(HERE / 'results' / 'sim_dither_extract.json'))


@pytest.fixture(scope='module')
def pm45():
    return make_L2(45.0)


def test_SSPLL_dither_factors_parseval_and_symmetry():
    """Spectral factors: power conservation per mode, mode m and 8-m equal, rot8 kills every line, MASH |phi_1|^2 = 0.731."""
    for m in range(1, 8):
        for src in SOURCES:
            sm = di.code_spectral_model(src, m)
            tot = sum(sm['lines'].values())
            assert tot <= sm['total'] + 1e-12
            if src != 'acc1':
                assert tot > sm['total'] - 1e-4                      # |k| > 1024 tail < 1e-4
            spread = sm['rtilde'][0] if src != 'mash' else 0.0
            assert abs(sm['total'] + spread - (di.mash_factors(m)['phi2'] if src == 'mash' else 1.0)) < 1e-12
        assert abs(di.rot_factor(8, m)) < 1e-28
        assert abs(di.dq_white(m) - di.dq_white(8 - m)) < 1e-12
        assert abs(di.mash_factors(m)['phi2'] - di.mash_factors(8 - m)['phi2']) < 1e-12   # m folded to [-4, 4]
    assert [di.mode_fold(m) for m in range(8)] == [0, 1, 2, 3, -4, -3, -2, -1]
    f1 = di.mash_factors(1)
    assert abs(f1['phi2'] - 0.730986) < 1e-6
    assert abs(f1['rtilde'][1] + 0.146966) < 1e-6
    assert abs(di.dq_white(1) - (1 - math.cos(math.pi / 4)) / 3) < 1e-15
    assert abs(di.dq_line_weight(1, 0) - (2 * (1 - math.cos(math.pi / 4)) / (math.pi / 4) ** 2) ** 2) < 1e-12   # |v_0|^2 = W1^2
    assert abs(di.rot_factor(4, 1) - 1 / (16 * math.sin(math.pi / 8) ** 2)) < 1e-12
    # acc1 line weights are the section-8 weights (sum to 1 per mode)
    w = sum(di.acc1_line_weight(1 + 8 * k) for k in range(-20000, 20001))
    assert abs(w - 1) < 2e-5


def test_SSPLL_dither_closed_form_reduces_to_section8_for_acc1(loops, pm45):
    """acc1 closed form == phos_lambda_harmonic (different truncation / tail handling): within 1e-4; every source has
    Re kappa_m = Re kappa_{8-m} (conjugate modes), and the closed form matches the exact-sequence correlation mode by mode for mash."""
    for a in (0.002, 0.01, 0.03, 0.137, 0.253, 0.496):
        lam = phos_lambda_harmonic(a, gamma_eff(loops['L2']))
        for m in range(1, 8):
            assert abs(di.kappa_mode_closed(loops['L2'], a, 'acc1', m) - 8 * lam[m].real) < 1e-4
        for src in SOURCES:
            km = di.kappa_phos_closed(pm45, a, src)['kappa_m']
            for m in range(1, 4):
                assert abs(km[m - 1] - km[7 - m]) < 1e-12, (src, a, m)
    nu = di.kappa_numeric(pm45, 0.03, 'mash')['kappa_m']
    cl = di.kappa_phos_closed(pm45, 0.03, 'mash')['kappa_m']
    assert np.max(np.abs(np.array(nu) - np.array(cl))) < 0.03


def test_SSPLL_dither_sequences_keep_total_compensation():
    """Every source satisfies P + c = Phi + const (mod 8) and stays inside its DTC range; acc1 / mash are deterministic."""
    n = np.arange(-64, 3000)
    ai = di.alpha_word(0.137)
    for src in SOURCES:
        c, p = di.code_sequence(0.137, src, n)
        off = {'acc1': 0, 'dq': 1, 'mash': 2, 'rot4': 3, 'rot8': 7}[src]
        assert c.min() >= 0 and c.max() < di.CODE_RANGE[src] + 1e-12
        nn = n + 65 if src == 'mash' else n                      # MASH state starts at n[0] with S1 = (k+1)F
        phi = (((nn * ai) & di.M32) / 2.0 ** 29) % 8
        lhs = ((p + c - off) % 8)
        d = np.abs(lhs - phi)
        assert np.all((d < 1e-9) | (np.abs(d - 8) < 1e-9)), src
        c2, p2 = di.code_sequence(0.137, src, n)
        assert np.array_equal(c, c2) and np.array_equal(p, p2)


def test_SSPLL_dither_closed_vs_numeric_vs_sim(loops, pm45, sim_dither):
    """Closed form vs linear correlation on the actual sequence (abs 0.03) and vs the simulator's kappa_PHOS (abs 0.03)."""
    L = {'L2': loops['L2'], 'L3': loops['L3'], 'L2_pm45': pm45}
    simkey = {'L2': 'L2_pm60', 'L3': 'L3_imp_pm60'}
    worst_cn = worst_cs = 0.0
    for lk, lp in L.items():
        for src in SOURCES:
            for a in (0.01, 0.03, 0.253):
                cl = di.kappa_phos_closed(lp, a, src)['kappa_min']
                nu = di.kappa_numeric(lp, a, src)['kappa_min']
                worst_cn = max(worst_cn, abs(cl - nu))
                assert abs(cl - nu) < 0.03, (lk, src, a, cl, nu)
                if lk in simkey and src != 'acc1':
                    sim = sim_dither['dither'][f'{simkey[lk]}|{src}'][str(a)]['kP']
                    worst_cs = max(worst_cs, abs(cl - sim))
                    assert abs(cl - sim) < 0.03, (lk, src, a, cl, sim)
    assert worst_cn < 0.025 and worst_cs < 0.01


def test_SSPLL_dither_gos_closed_forms(loops, sim_dither):
    """GOS: dq is white (kappa = 1, C = h[0]/6), MASH C = (6 - 4 h1 + h2)/12 independent of alpha; C/E[c^2] within 8 % of the simulator's kG."""
    lp = loops['L2']
    h = lp.impulse(3)
    for a in (0.01, 0.03, 0.253):
        g = di.gos_closed(lp, a, 'dq')
        assert abs(g['kappa'] - 1) < 1e-12 and abs(g['C'] - 1 / 6) < 1e-12
        m = di.gos_closed(lp, a, 'mash')
        assert abs(m['C'] - (6 * h[0] - 4 * h[1] + h[2]) / 12) < 1e-12
        nu = di.kappa_numeric(lp, a, 'mash')
        assert abs(nu['gos_C'] - m['C']) < 0.05 and abs(nu['gos_var'] - 0.5) < 0.04
        for src in ('dq', 'mash', 'rot4', 'rot8'):
            sim_kG = sim_dither['dither'][f'L2_pm60|{src}'][str(a)]['kG']
            assert abs(di.gos_closed(lp, a, src)['kappa_e2'] / sim_kG - 1) < 0.09, (src, a)


def test_SSPLL_dither_headline_pm45_mash_dead_zone_and_large_signal(loops, pm45):
    """L2 PM 45 deg, MASH, alpha = 0.03: kappa_1 = 0.731 Re H(120 MHz) + 0.30 = +0.0206 (dead), kappa_inf = -0.258; PM 60 deg: +0.238 / +0.180."""
    f1 = di.mash_factors(1)
    h = pm45.impulse(3)
    reh = float(np.real(pm45.H(0.03)))
    assert abs(reh + 0.3825) < 1e-4
    terms = [f1['phi2'] * reh, h[0] * f1['rtilde'][0], h[1] * math.cos(2 * math.pi * 0.03) * f1['rtilde'][1], h[2] * math.cos(4 * math.pi * 0.03) * f1['rtilde'][2]]
    k1 = sum(terms)
    assert abs(k1 - di.kappa_mode_closed(pm45, 0.03, 'mash', 1)) < 1e-12
    assert abs(k1 - 0.0206) < 2e-4
    assert di.verdict_closed(pm45, 0.03, 'mash')['verdict'] == 'dead'
    assert di.verdict_closed(loops['L2'], 0.03, 'mash')['verdict'] == 'restoring'
    assert abs(di.kappa_mode_closed(loops['L2'], 0.03, 'mash', 1) - 0.2377) < 2e-4
    ls45 = di.large_signal_code(pm45, 0.03, 'mash', 1)
    ls60 = di.large_signal_code(loops['L2'], 0.03, 'mash', 1)
    assert ls45['kappa_inf'] < -0.2 and abs(ls45['lin']) < 0.01
    assert ls60['kappa_inf'] > 0.15
    # the other sources at the same point: dq inverted, rot4 restoring, rot8 exactly 1
    assert di.verdict_closed(pm45, 0.03, 'dq')['verdict'] == 'inverted'
    assert di.verdict_closed(pm45, 0.03, 'rot4')['verdict'] == 'restoring'
    assert abs(di.kappa_mode_closed(pm45, 0.03, 'rot8', 1) - 1) < 1e-12


def test_SSPLL_dither_closed_loop_headline_short_run(loops, pm45):
    """Closed-loop sign-LMS (600 blocks, 3 seeds): PM 45 deg + MASH grows from 173 fs, PM 60 deg + MASH shrinks below 1/4; rot8 at 80 MHz converges."""
    bad = di.divergence_mc(pm45, 0.03, 'mash', seeds=(0, 1, 2), n_blocks=600)
    assert abs(bad['init_fs'] - 173.29) < 0.01
    assert all(f > bad['init_fs'] for f in bad['final_fs'])
    good = di.divergence_mc(loops['L2'], 0.03, 'mash', seeds=(0, 1, 2), n_blocks=600)
    assert good['n_conv'] == 3
    rot = di.run_sign_lms_code(loops['L2'], 0.02, 'rot8', n_blocks=600, seed=1)
    raw = di.run_sign_lms_code(loops['L2'], 0.02, 'acc1', n_blocks=600, seed=1)
    assert rot['phos_rms_fs'][-1][0] < 0.25 * rot['phos_rms_fs'][0][0]
    assert raw['phos_rms_fs'][-1][0] > 2 * raw['phos_rms_fs'][0][0]
    ci = di.wilson_ci(4, 4)
    assert 0.5 < ci[0] < 0.52 and ci[1] == 1.0
    assert di.crosscheck('restoring', good)['status'] == 'n/a'      # 3/3 has a Wilson lower bound of 0.44: not decisive
    assert di.crosscheck('dead', bad)['status'] == 'n/a'


def test_SSPLL_dither_stored_sweep_is_consistent(sweep, loops, pm45):
    """results/dither_interaction.json: closed forms reproducible, cross-check counts 87 / 0 / 18, headline rows present."""
    L = {'L2': loops['L2'], 'L3': loops['L3'], 'L2_pm45': pm45}
    for lk, lp in L.items():
        for src in SOURCES:
            for a in (0.01, 0.03, 0.137):
                row = sweep['closed'][f'{lk}|{src}'][str(a)]
                kp = di.kappa_phos_closed(lp, a, src)
                assert np.allclose(kp['kappa_m'], row['kappa_m'], rtol=1e-9, atol=1e-12)
                assert row['verdict'] == di.verdict_closed(lp, a, src)['verdict']
    s = sweep['mc']['_summary']
    assert (s['n_ok'], s['n_mismatch'], s['n_na']) == (87, 0, 18)
    hl = sweep['headline']
    assert hl['mc']['n_div'] == 8 and hl['mc']['verdict'] == 'dead' and hl['kappa_inf'] < -0.2
    assert sweep['mc']['L2|mash']['0.03']['n_conv'] == 8
    assert sweep['sim_compare']['_summary']['max_abs_diff_closed_sim'] < 0.01
    assert sweep['sim_compare']['_summary']['max_abs_diff_closed_numeric'] < 0.025
    # the page subset exists and matches the stored file on the headline
    page = HERE.parents[2] / 'src' / 'pages' / 'case-sspll' / 'ditherNumbers.json'
    if page.exists():
        sub = json.load(open(page))
        assert sub['headline'] == hl
        assert sub['mc']['_summary'] == s


# --------------------------------------------------------------------------------------
# alpha-uniform certificate (section 10b.7, F-CS.29; tools/dither_certificate.py -> results/dither_certificate.json)
# --------------------------------------------------------------------------------------
@pytest.fixture(scope='module')
def cert():
    path = HERE / 'results' / 'dither_certificate.json'
    if not path.exists():
        pytest.skip('results/dither_certificate.json missing (run tools/dither_certificate.py)')
    return json.load(open(path))


def test_SSPLL_dither_certificate_is_a_lower_bound_of_every_closed_form(cert, sweep):
    """LB_m <= Re kappa_m(alpha) for every loop, source, mode and every alpha stored in dither_interaction.json (107 alphas);
    acc1's bound is g_min itself, rot8's is exactly 1, and the bound is attained to within the carrier's slack for MASH."""
    n = 0
    for lk, row in cert['loops'].items():
        g_min = row['certificates']['acc1']['g_min']
        assert abs(row['certificates']['acc1']['lb_min'] - g_min) < 1e-15
        assert abs(row['certificates']['rot8']['lb_min'] - 1.0) < 1e-12
        for src in SOURCES:
            lbs = row['certificates'][src]['lb_modes']
            for a, cl in sweep['closed'][f'{lk}|{src}'].items():
                for m in range(7):
                    assert lbs[m] <= cl['kappa_m'][m] + 1e-12, (lk, src, a, m + 1, lbs[m], cl['kappa_m'][m])
                    n += 1
        # MASH: the scan minimum is above the bound (the bound replaces cos by its worst case and Re H by g_min)
        assert row['mash_scan']['min'] >= row['certificates']['mash']['lb_min'] - 1e-12
    assert n == 3 * 5 * 7 * len(sweep['closed']['L2|acc1'])


def test_SSPLL_dither_certificate_verdicts_and_pm_thresholds(cert, loops, pm45):
    """L2 (PM 60): MASH, rot4, rot8 restoring for every channel; PM 45: MASH inconclusive and the scan finds the 98-131 MHz dead zone;
    the PM sweep is monotone and the thresholds (certificate 58.5 deg, dead zone 47.9 deg) match the page's interpolation within 1.5 deg."""
    c = cert['loops']
    assert [c['L2']['certificates'][s]['status'] for s in SOURCES] == ['inconclusive', 'inconclusive', 'restoring-all', 'restoring-all', 'restoring-all']
    assert c['L2_pm45']['certificates']['mash']['status'] == 'inconclusive'
    assert c['L2_pm45']['mash_scan']['dead_MHz'] == [98.0, 131.0] and c['L2_pm45']['mash_scan']['inverted_MHz'] is None
    assert c['L2']['mash_scan']['dead_MHz'] is None and c['L2']['mash_scan']['min'] > 0.15
    # reproducible from the module (same nf, same Lipschitz constant)
    for lk, lp in (('L2', loops['L2']), ('L2_pm45', pm45), ('L3', loops['L3'])):
        for src in SOURCES:
            again = di.code_certificate(lp, src)
            assert np.allclose(again['lb_modes'], c[lk]['certificates'][src]['lb_modes'], rtol=1e-12, atol=1e-14)
    rows = cert['pm_sweep']
    for key in ('mash', 'rot4', 'dq'):
        lb = [r['lb'][key] for r in rows]
        assert all(b > a for a, b in zip(lb, lb[1:])), key            # more phase margin -> shallower band -> larger bound
    scan = [r['mash_scan']['min'] for r in rows]
    assert all(b > a for a, b in zip(scan, scan[1:]))
    th = cert['thresholds']
    assert 58.0 < th['pm_cert'] < 59.0 and 47.5 < th['pm_dead'] < 48.5
    assert abs(th['pm_cert_interp'] - th['pm_cert']) < 1.5 and abs(th['pm_dead_interp'] - th['pm_dead']) < 1.5
    # the bound for MASH at the threshold equals tau (bisection converged)
    assert abs(di.code_certificate(make_L2(th['pm_cert']), 'mash')['lb_min'] - 0.05) < 1e-6


# --------------------------------------------------------------------------------------
# dead zone: candidate rules scored against the stored MC (tools/dither_sweep.py score_candidates; case page section 10b.7)
# --------------------------------------------------------------------------------------
# the 8 dead-zone rows where "dead zone -> sign of kappa_inf (worst mode)" predicts divergence but the MC majority did not diverge
TWO_STAGE_MISMATCHES = {
    'L2|acc1|0.253', 'L2|acc1|0.496', 'L2|dq|0.01', 'L2|dq|0.03',
    'L2_pm45|acc1|0.253', 'L3|acc1|0.253', 'L3|acc1|0.496', 'L3|dq|0.01',
}


def test_SSPLL_dither_dead_zone_candidates_are_scored_and_two_stage_fails(sweep):
    """Per-row candidate verdicts recompute from the stored kappa_min / kappa_inf / window; totals: F-CS.28 (linear) 87/0/18,
    two-stage (kappa_inf worst mode) 93/8/4 with dead zone 6/8/4, two-stage (mode 1) dead zone 7/3/8, window rule 92/0/13."""
    tau = sweep['_meta']['tau_dead']
    tally = {c: [0, 0, 0] for c in ('two_stage', 'two_stage_m1', 'efold')}
    idx = {'ok': 0, 'mismatch': 1, 'n/a': 2}
    n_dead = 0
    for key, rows in sweep['mc'].items():
        if key.startswith('_'):
            continue
        for a, row in rows.items():
            ls = sweep['large_signal'][key][a]
            wm = row['worst_mode']
            assert row['kappa_inf_worst'] == ls.get(f'm{wm}', ls['m1'])['kappa_inf']
            if wm == 1:
                assert row['kappa_inf_worst'] == row['kappa_inf_m1']
            c = row['candidates']
            assert c['two_stage']['verdict'] == di.two_stage_verdict(row['kappa_min'], row['kappa_inf_worst'], tau)
            assert c['two_stage_m1']['verdict'] == di.two_stage_verdict(row['kappa_min'], row['kappa_inf_m1'], tau)
            ef = di.efold_verdict(row['kappa_min'], row['n_blocks'], row['tau_blocks'], row['grow'], row['shrink'])
            assert c['efold']['verdict'] == ef['verdict'] and abs(c['efold']['growth'] - ef['growth']) < 1e-12 * ef['growth']
            for name, v in c.items():
                assert v['status'] == di.crosscheck(v['verdict'], row)['status']
                tally[name][idx[v['status']]] += 1
            # outside the dead zone every candidate equals the linear verdict except the window rule, which can only decide more
            if row['verdict'] != 'dead':
                assert c['two_stage']['verdict'] == c['two_stage_m1']['verdict'] == row['verdict']
                assert c['efold']['verdict'] == row['verdict']
            else:
                n_dead += 1
                assert row['crosscheck']['status'] == 'n/a'
    s = sweep['mc']['_summary']
    assert n_dead == s['n_dead'] == 18
    assert (s['n_ok'], s['n_mismatch'], s['n_na']) == (87, 0, 18)
    cs = s['candidates']
    for name, t in tally.items():
        assert [cs[name]['n_ok'], cs[name]['n_mismatch'], cs[name]['n_na']] == t
    assert tally['two_stage'] == [93, 8, 4]
    assert [cs['two_stage']['dead_zone'][k] for k in ('n_ok', 'n_mismatch', 'n_na')] == [6, 8, 4]
    assert set(cs['two_stage']['mismatches']) == TWO_STAGE_MISMATCHES
    assert [cs['two_stage_m1']['dead_zone'][k] for k in ('n_ok', 'n_mismatch', 'n_na')] == [7, 3, 8]
    assert set(cs['two_stage_m1']['mismatches']) == {'L2|dq|0.01', 'L2|dq|0.03', 'L3|dq|0.01'}
    assert tally['efold'] == [92, 0, 13] and cs['efold']['mismatches'] == []
    # window thresholds: N_tau ln 2 / B and N_tau ln 4 / B for B = 1500, N_tau = 25
    assert abs(cs['efold']['kappa_div'] - 25 * math.log(2) / 1500) < 1e-15
    assert abs(cs['efold']['kappa_conv'] - 25 * math.log(4) / 1500) < 1e-15
    # the headline row: dead zone, the window rule predicts slow decay (G ~ 0.29) -- the MC grows 8/8: neither rule explains it
    hl = sweep['mc']['L2_pm45|mash']['0.03']
    assert hl['verdict'] == 'dead' and hl['n_div'] == 8
    assert hl['candidates']['efold']['verdict'] == 'dead' and 0.25 < hl['candidates']['efold']['growth'] < 0.3
    assert hl['candidates']['two_stage']['status'] == 'ok'
    # counterexamples of the kappa_inf rule quoted on the page: strongly negative kappa_inf, yet no seed diverges
    l3 = sweep['mc']['L3|acc1']['0.253']
    assert l3['worst_mode'] == 4 and l3['kappa_inf_worst'] < -0.7 and l3['n_div'] == 0 and l3['n_conv'] == 8
    dq = sweep['mc']['L3|dq']['0.01']
    assert dq['verdict'] == 'dead' and dq['kappa_inf_worst'] < -0.15 and dq['n_div'] == 0 and dq['n_conv'] == 0


def test_SSPLL_dither_kappa_inf_worst_mode_reproducible(sweep, loops, pm45):
    """kappa_inf_worst is large_signal_code along the closed form's worst mode (not mode 1) -- recomputed for the deterministic
    sources (acc1, mash: the same integer recursion, so exact) on the alpha where the worst mode is 2, 4 or 6."""
    L = {'L2': loops['L2'], 'L3': loops['L3'], 'L2_pm45': pm45}
    checked = 0
    for key in ('L2|acc1', 'L2_pm45|acc1', 'L3|acc1'):
        lk = key.split('|')[0]
        for a in ('0.253', '0.496'):
            row = sweep['mc'][key][a]
            wm = row['worst_mode']
            assert wm != 1
            ls = di.large_signal_code(L[lk], float(a), 'acc1', wm)
            assert abs(ls['kappa_inf'] - row['kappa_inf_worst']) < 1e-12
            assert abs(row['kappa_inf_m1'] - 1.0) < 1e-12        # mode 1 is far out of band at these alpha: kappa_inf_m1 = +1
            checked += 1
    assert checked == 6
