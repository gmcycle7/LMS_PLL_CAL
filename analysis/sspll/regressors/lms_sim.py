"""
lms_sim.py -- behavioural sign-error block-LMS simulation (1-bit comparator + Gaussian dither)
on top of the LINEAR H_PD model, to check that the mean-dynamics eigenvalues of corr.py predict
convergence / divergence of the GOS and PHOS loops.

Units: timing in units of T_vco/8.  Illustrative f_vco = 16 GHz -> T_vco/8 = 7.8125 ps
(only used to translate fs <-> units; the sign predictions do not depend on it).
Writes lms_sim_results.json.
"""
import json
import math
import sys
import time
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy import signal

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa: E402

F_VCO = 16e9                      # illustrative
UNIT = 1 / F_VCO / 8              # seconds per unit (T_vco/8)
FS = 1e-15
SIGMA_V = 250 * FS / UNIT         # comparator-input Gaussian noise, 250 fs rms (illustrative)
KQ = corr.K_q(SIGMA_V)

V8 = np.exp(-2j * np.pi * np.outer(np.arange(8), np.arange(8)) / 8) / np.sqrt(8)   # DFT (modes)


def to_frac(alpha_float, Qbits=20):
    num = int(round(alpha_float * (1 << Qbits)))
    if num % 2 == 0:
        num += 1                  # odd numerator -> period 2^Qbits (8 | Q, exactly circulant PHOS)
    return Fraction(num, 1 << Qbits)


def run(loop, alpha, D, a_g, eps, mu_g, mu_p, N=256, nblk=20000, seed=1, rec=50):
    rng = np.random.default_rng(seed)
    zi = np.zeros(max(len(loop.aH), len(loop.bH)) - 1)
    wg, w = 0.0, np.zeros(8)
    n0 = 0
    hist = []
    for b in range(nblk):
        idx = np.arange(n0, n0 + N)
        R = corr.regressors(alpha, idx)
        inj = (a_g - wg) * R[0] + (eps - w) @ R[1:]
        y, zi = signal.lfilter(loop.bH, loop.aH, inj, zi=zi)
        q = np.sign(y + SIGMA_V * rng.standard_normal(N))
        Rd = corr.regressors(alpha, idx - D) if D else R
        wg += mu_g * float(np.mean(q * Rd[0]))
        w += mu_p * (Rd[1:] @ q) / N
        n0 += N
        if b % rec == 0 or b == nblk - 1:
            d = eps - w
            dm = V8 @ d
            hist.append([b, a_g - wg] + np.abs(dm).tolist() + [float(np.std(y))])
    return np.array(hist)


def fit_rate(t, v, upto=None):
    """slope of log|v| per block over the first part (linear regime)."""
    m = (v > 1e-12)
    if upto is not None:
        m &= t <= upto
    if m.sum() < 5:
        return float('nan')
    return float(np.polyfit(t[m], np.log(v[m]), 1)[0])


def run_modes(loop, alpha, D, a_g, eps, mu_g, mu_p, N=256, nblk=6000, seed=1, rec=20):
    """same as run() but records the complex mode coordinates (for ensemble averaging)."""
    rng = np.random.default_rng(seed)
    zi = np.zeros(max(len(loop.aH), len(loop.bH)) - 1)
    wg, w = 0.0, np.zeros(8)
    n0 = 0
    T, G, Mo = [], [], []
    for b in range(nblk):
        idx = np.arange(n0, n0 + N)
        R = corr.regressors(alpha, idx)
        inj = (a_g - wg) * R[0] + (eps - w) @ R[1:]
        y, zi = signal.lfilter(loop.bH, loop.aH, inj, zi=zi)
        q = np.sign(y + SIGMA_V * rng.standard_normal(N))
        Rd = corr.regressors(alpha, idx - D) if D else R
        wg += mu_g * float(np.mean(q * Rd[0]))
        w += mu_p * (Rd[1:] @ q) / N
        n0 += N
        if b % rec == 0:
            T.append(b); G.append(a_g - wg); Mo.append(V8 @ (eps - w))
    return np.array(T), np.array(G), np.array(Mo)


def slope_window(t, v, lo=0.35, hi=2.5):
    """log-slope of |v| fitted while |v|/|v0| stays inside [lo, hi] (linear regime, above noise floor)."""
    v = np.abs(v)
    r = v / v[0]
    stop = np.flatnonzero((r < lo) | (r > hi))
    end = stop[0] if len(stop) else len(v)
    if end < 6:
        return float('nan')
    return float(np.polyfit(t[:end], np.log(v[:end]), 1)[0])


t0 = time.time()
T1 = corr.make_type1(lat=1.0)
T2 = corr.make_type2(lat=1.0, pm_target=60.0)

rng0 = np.random.default_rng(7)
A = 150 * FS / UNIT                        # 150 fs amplitude per mode-1 pattern
k = np.arange(8)
eps0 = A * np.cos(2 * np.pi * k / 8 + 0.4) + 0.3 * A * np.cos(4 * np.pi * k / 8 + 1.1) \
    + 0.3 * A * np.cos(np.pi * k + 0.0) + 0.2 * A * rng0.standard_normal(8)
eps0 -= eps0.mean()                         # common mode is unobservable anyway
a_g0 = 0.02                                 # 2 % DTC gain error -> up to 156 fs

cases = [
    # (label, loop, alpha_target, D, mu_g, mu_p, nblk)
    ("T2_pm60 D0 offset 70MHz (PHOS m1 predicted inverted)", T2, 70e6 / 4e9, 0, 4e-4, 4e-4, 30000),
    ("T1_lat1 D0 offset 70MHz (all predicted OK)", T1, 70e6 / 4e9, 0, 4e-4, 4e-4, 30000),
    ("T2_pm60 D0 offset 1.2GHz (all predicted OK)", T2, 0.3 + 1e-4, 0, 4e-4, 4e-4, 30000),
    ("T2_pm60 D+1 near 1/8 grid, beta*f_ref=80MHz (GOS predicted inverted)", T2, (1 + 80e6 / 4e9) / 8, 1, 4e-4,
     4e-4, 30000),
    ("T2_pm60 D0 near 1/8 grid, beta*f_ref=80MHz (GOS predicted OK)", T2, (1 + 80e6 / 4e9) / 8, 0, 4e-4, 4e-4,
     30000),
]
results = dict(f_vco_illustrative=F_VCO, unit_s=UNIT, sigma_v_fs=SIGMA_V * UNIT / FS, K_q_per_unit=KQ,
               eps0_fs=(eps0 * UNIT / FS).tolist(), a_g0=a_g0, block_N=256, cases=[])
for label, lp, at, D, mug, mup, nblk in cases:
    a = to_frac(at)
    cg = corr.gos_rational_closed_form((8 * a) % 1, D, loop=lp)
    lam = corr.phos_modes_rational(a, D, loop=lp)
    H = run(lp, a, D, a_g0, eps0, mug, mup, nblk=nblk)
    t = H[:, 0]
    pred_g = -mug * KQ * cg                          # predicted log-slope per block (linear regime)
    pred_l = -mup * KQ * lam.real
    # single-run fit while the amplitude stays within [0.35, 2.5] x initial (large-signal: indicative only)
    obs_g = slope_window(t, H[:, 1])
    obs_l = [slope_window(t, H[:, 2 + m]) for m in range(8)]
    rec = dict(label=label, loop=lp.name, alpha=str(a), alpha_float=float(a), offset_MHz=float(a) * 4e3,
               beta_MHz=float((8 * a) % 1) * 4e3, D=D, mu_g=mug, mu_p=mup, nblk=nblk,
               C_gos=cg, lam_re=lam.real.tolist(), lam_im=lam.imag.tolist(),
               pred_logslope_gos=pred_g, obs_logslope_gos=obs_g,
               pred_logslope_modes=pred_l.tolist(), obs_logslope_modes=obs_l,
               gos_rel_err_start_end=[float(abs(H[0, 1])), float(abs(H[-1, 1]))],
               mode_abs_start_end_fs=[(H[0, 2:10] * UNIT / FS).tolist(), (H[-1, 2:10] * UNIT / FS).tolist()],
               pd_rms_start_end_fs=[float(H[1, 10] * UNIT / FS), float(H[-1, 10] * UNIT / FS)],
               trace_blocks=t[::6].tolist(), trace_gos=H[::6, 1].tolist(),
               trace_modes_fs=(H[::6, 2:6] * UNIT / FS).tolist())
    results['cases'].append(rec)
    print(f"\n{label}\n  alpha={float(a):.6f} D={D}  C_gos={cg:+.4e}  Re lam1..4={np.round(lam.real[1:5], 5)}")
    print(f"  GOS  : |delta_g| {abs(H[0,1]):.4f} -> {abs(H[-1,1]):.4f}   log-slope pred {pred_g:+.3e} obs {obs_g:+.3e}")
    for m in (1, 2, 3, 4):
        print(f"  mode {m}: |d_m| {H[0,2+m]*UNIT/FS:7.1f} fs -> {H[-1,2+m]*UNIT/FS:8.1f} fs   "
              f"log-slope pred {pred_l[m]:+.3e} obs {obs_l[m]:+.3e}")
# ---------- Part A: small-signal ensemble check of the predicted log-slopes ----------
print("\n=== Part A: small-signal (|e_PD| << sigma_v) ensemble-mean slopes ===")
small = 40 * FS / UNIT
eps_s = small * (np.cos(2 * np.pi * k / 8 + 0.4) + np.cos(4 * np.pi * k / 8 + 1.0) + np.cos(6 * np.pi * k / 8 + 2.0)
                 + np.cos(np.pi * k))
eps_s -= eps_s.mean()
ag_s = 20 * FS / UNIT                     # GOS error amplitude: delta_g * rho, rho in [0,1) units of T_vco/8
results['partA'] = []
for label, lp, at, D, mu in [("T2_pm60 D0 70MHz", T2, 70e6 / 4e9, 0, 1e-3), ("T1_lat1 D0 70MHz", T1, 70e6 / 4e9, 0, 1e-3),
                             ("T2_pm60 D+1 1/8-grid beta 80MHz", T2, (1 + 80e6 / 4e9) / 8, 1, 1e-3),
                             ("T2_pm45 D0 100MHz", corr.make_type2(lat=1.0, pm_target=45.0), 100e6 / 4e9, 0, 1e-3)]:
    a = to_frac(at)
    cg = corr.gos_rational_closed_form((8 * a) % 1, D, loop=lp)
    lam = corr.phos_modes_rational(a, D, loop=lp)
    mu_abs = mu * small                       # step in units per block
    Gs, Ms = [], []
    for sd in range(8):
        tt, g, mo = run_modes(lp, a, D, ag_s, eps_s, mu_abs, mu_abs, nblk=4000, seed=100 + sd)
        Gs.append(g); Ms.append(mo)
    gm = np.mean(Gs, axis=0); mm = np.mean(Ms, axis=0)
    obs_g = slope_window(tt, gm)
    obs_m = [slope_window(tt, mm[:, m]) for m in range(8)]
    # Bussgang gain with the actual comparator-input spread: sqrt(2/pi)/sqrt(sigma_v^2 + sigma_e^2) ~ K_q (sigma_e << sigma_v)
    pred_g = -mu_abs * KQ * cg
    pred_m = (-mu_abs * KQ * lam.real).tolist()
    row = dict(label=label, alpha=str(a), D=D, mu_units_per_block=mu_abs, C_gos=cg, lam_re=lam.real.tolist(),
               pred_slope_gos=pred_g, obs_slope_gos=obs_g, pred_slope_modes=pred_m, obs_slope_modes=obs_m)
    results['partA'].append(row)
    print(f"{label:34s} GOS pred {pred_g:+.3e} obs {obs_g:+.3e} | " +
          " ".join(f"m{m}: {pred_m[m]:+.2e}/{obs_m[m]:+.2e}" for m in (1, 2, 3, 4)))
# GOS-only long run for the slow inverted case (T2, D=+1, beta*f_ref = 80 MHz)
a = to_frac((1 + 80e6 / 4e9) / 8)
cg = corr.gos_rational_closed_form((8 * a) % 1, 1, loop=T2)
mu_g = 5e-3 * small
Gs = []
for sd in range(8):
    tt, g, mo = run_modes(T2, a, 1, ag_s, np.zeros(8), mu_g, 0.0, nblk=40000, seed=300 + sd, rec=100)
    Gs.append(g)
gm = np.mean(Gs, axis=0)
obs = slope_window(tt, gm, lo=0.35, hi=5.0)
results['partA_gos_long'] = dict(label="T2_pm60 D+1 1/8-grid beta 80MHz, GOS only, PHOS frozen", alpha=str(a), D=1,
                                 mu_g=mu_g, C_gos=cg, pred_slope=-mu_g * KQ * cg, obs_slope=obs,
                                 delta_g_start_end=[float(gm[0]), float(gm[-1])])
print("GOS-only long run (T2 D+1, beta 80 MHz):", results['partA_gos_long'])
results['runtime_s'] = time.time() - t0
(HERE / 'lms_sim_results.json').write_text(json.dumps(results, indent=1))
print(f"\nwrote lms_sim_results.json ({results['runtime_s']:.1f}s)")
