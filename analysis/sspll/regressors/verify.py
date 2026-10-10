"""
verify.py -- numerical verification of every analytic claim used in README.md.
Run:  python3 verify.py      -> prints a report and writes verify_results.json
"""
import json
import math
import sys
import time
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy import signal, special

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa: E402

rng = np.random.default_rng(20261010)
OUT = {}


def rel(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float(np.max(np.abs(a - b)) / max(np.max(np.abs(b)), 1e-300))


def section(t):
    print("\n" + "=" * 78 + "\n" + t + "\n" + "=" * 78)


t0 = time.time()
# ---------------------------------------------------------------------------
section("0. loop models (generic Type-I / Type-II, closed-loop -3 dB = 320 MHz @ f_ref = 4 GHz)")
models = corr.standard_models()
OUT['models'] = {}
for k, lp in models.items():
    p = lp.params
    keep = {kk: p[kk] for kk in ('type', 'K', 'Kp', 'Ki', 'r', 'lat', 'f_pole', 'f3dB_Hz', 'fc_Hz', 'PM_deg',
                                  'peaking_dB', 'stable', 'max_pole_mag', 'ReH_negative_bands_MHz', 'ReH_min',
                                  'ReH_min_at_MHz', 'h0', 'S_inf') if kk in p}
    keep['bL'] = lp.bL.tolist()
    keep['aL'] = lp.aL.tolist()
    OUT['models'][k] = keep
    print(f"{k:22s} f3dB={p['f3dB_Hz']/1e6:7.2f}MHz PM={p['PM_deg']:6.2f}deg pk={p['peaking_dB']:5.2f}dB "
          f"|pole|max={p['max_pole_mag']:.4f}  Re H<0 bands(MHz)={[(round(a,1),round(b,1)) for a,b in p['ReH_negative_bands_MHz']]}"
          f"  minReH={p['ReH_min']:.4f}@{p['ReH_min_at_MHz']:.1f}MHz  S_inf={p['S_inf']:.4f}")
T1 = models['T1_lat1']
T2 = models['T2_pm60_lat1']

# exact closed form for the Type-I / lat=1 loop:  Re H = (2-K)(1-cos W)/|1+(K-1)e^{-jW}|^2 >= 0
K = T1.params['K']
W = np.linspace(0, np.pi, 10001)
reH_closed = (2 - K) * (1 - np.cos(W)) / np.abs(1 + (K - 1) * np.exp(-1j * W)) ** 2
OUT['type1_lat1_ReH_closed_form_err'] = rel(np.real(T1.H(W / (2 * np.pi))), reH_closed)
print("Type-I lat=1: max rel err of Re H vs (2-K)(1-cosW)/|1+(K-1)e^{-jW}|^2 :",
      OUT['type1_lat1_ReH_closed_form_err'])

# ---------------------------------------------------------------------------
section("1. general formula and conjugation convention (random FIR h, random sequences)")
# (a) circular / periodic: exact identity
Nc, Lh = 4096, 24
h = rng.standard_normal(Lh) * np.exp(-np.arange(Lh) / 6)
xi = 0.7 + signal.lfilter([1], [1, -0.8], rng.standard_normal(Nc))       # coloured, non-zero mean
xj = -0.3 + signal.lfilter([1, 0.5], [1, -0.3], rng.standard_normal(Nc)) + 0.4 * np.roll(xi, 3)
res1 = {}
for D in (-2, 0, 1, 3):
    # time domain: C = <x_i[n-D] (h (*) x_j)[n]>, circular
    hp = np.zeros(Nc); hp[:Lh] = h
    yj = np.real(np.fft.ifft(np.fft.fft(hp) * np.fft.fft(xj)))
    C_td = np.mean(np.roll(xi, D) * yj)
    # lag form: sum_k h[k] R_{xi xj}[k-D],  R_xy[m] = <x[n+m] y[n]>
    Rij = lambda m: np.mean(np.roll(xi, -m) * xj)
    C_lag = sum(h[k] * Rij(k - D) for k in range(Lh))
    # frequency form: (1/N) sum_l S_{xj xi}[l] H(e^{jW_l}) e^{jW_l D},  S_xy = X conj(Y)/N
    Xi, Xj = np.fft.fft(xi), np.fft.fft(xj)
    Wl = 2 * np.pi * np.arange(Nc) / Nc
    Hl = np.fft.fft(hp)                                   # = H(e^{jW_l}) = sum h[k] e^{-jW_l k}
    S_ji = Xj * np.conj(Xi) / Nc
    S_ij = Xi * np.conj(Xj) / Nc
    C_f = np.sum(S_ji * Hl * np.exp(1j * Wl * D)) / Nc
    C_wrong1 = np.sum(S_ij * Hl * np.exp(1j * Wl * D)) / Nc            # wrong cross-spectrum order
    C_wrong2 = np.sum(S_ji * Hl * np.exp(-1j * Wl * D)) / Nc           # wrong sign of the delay
    res1[D] = dict(C_time=float(C_td), C_lag=float(C_lag), C_freq_re=float(C_f.real), C_freq_im=float(C_f.imag),
                   err_lag=abs(C_lag - C_td), err_freq=abs(C_f - C_td),
                   C_wrong_order=float(C_wrong1.real), C_wrong_delay=float(C_wrong2.real))
    print(f"D={D:+d}: time {C_td:+.12f}  lag {C_lag:+.12f}  freq {C_f.real:+.12f}{C_f.imag:+.1e}j  | "
          f"wrong S_ij: {C_wrong1.real:+.6f}   wrong e^-jWD: {C_wrong2.real:+.6f}")
OUT['conjugation_check_circular'] = res1

# (b) linear convolution, long record (what the hardware does), and the mean drop-out
Nl = 1 << 20
xa = 0.5 + signal.lfilter([1], [1, -0.9], rng.standard_normal(Nl + 200)) * 0.1
xb = 0.25 + signal.lfilter([1, -0.4], [1, -0.5], rng.standard_normal(Nl + 200)) * 0.1
h0sum = h - h.sum() / Lh                          # same shape, forced H(1)=0
res2 = {}
for tag, hh in (('H(1)!=0', h), ('H(1)=0', h0sum)):
    D = 1
    yb = signal.lfilter(hh, [1], xb)
    idx = np.arange(200, 200 + Nl)
    C_raw = np.mean(xa[idx - D] * yb[idx])
    xa_c, xb_c = xa - xa.mean(), xb - xb.mean()
    yb_c = signal.lfilter(hh, [1], xb_c)
    C_cent = np.mean(xa_c[idx - D] * yb_c[idx])
    pred_diff = xa.mean() * xb.mean() * hh.sum()
    res2[tag] = dict(H1=float(hh.sum()), C_raw=float(C_raw), C_centered=float(C_cent),
                     diff=float(C_raw - C_cent), predicted_mu_i_mu_j_H1=float(pred_diff))
    print(f"{tag:8s}: H(1)={hh.sum():+.4f}  C(raw x)={C_raw:+.6f}  C(centered)={C_cent:+.6f}  "
          f"diff={C_raw-C_cent:+.6f}  mu_i mu_j H(1)={pred_diff:+.6f}")
OUT['mean_dropout_linear'] = res2

# ---------------------------------------------------------------------------
section("2. exact periodic C (DFT) vs brute-force time domain (lfilter, raw regressors)")
res3 = []
for lp in (T1, T2, models['T2_pm60_lat2']):
    for a in (Fraction(1001, 4096), Fraction(37, 1024), Fraction(1, 3), Fraction(3, 16), Fraction(7, 40),
              Fraction(5, 12), Fraction(1, 4)):
        for D in (0, 1):
            Q = a.denominator
            N = Q * max(1, (1 << 16) // Q)
            Ce = corr.C_exact(a, D, loop=lp)
            Ct = corr.C_time(a, D, N=N, burn=60 * Q + 6000, loop=lp)
            e = float(np.max(np.abs(Ce - Ct)))
            res3.append(dict(loop=lp.name, alpha=str(a), D=D, max_abs_err=e, max_abs_C=float(np.max(np.abs(Ce)))))
print("max |C_exact - C_time| over all cases:", max(r['max_abs_err'] for r in res3),
      " (max |C| ~", max(r['max_abs_C'] for r in res3), ")")
OUT['exact_vs_time_rational'] = res3

# irrational alpha: long-record time domain vs harmonic (ergodic) prediction
res4 = []
irr = [(math.sqrt(5) - 1) / 2 * 0.05, 0.0123456789 * math.pi, 1 / math.e, math.sqrt(2) - 1, 0.987654321 + 1e-3 / math.pi,
       0.125 + 0.0021 * math.sqrt(3)]
for lp in (T1, T2):
    for a in irr:
        for D in (0, 1):
            Ct = corr.C_time(a, D, N=1 << 21, burn=40000, loop=lp)
            Ch, cg, lam = corr.joint_harmonic(a, D, loop=lp, M=1 << 14)
            lam_t = corr.phos_modes_from_C(Ct[1:, 1:])
            res4.append(dict(loop=lp.name, alpha=a, D=D,
                             C_gos_time=float(Ct[0, 0]), C_gos_harm=cg,
                             reLam_time=lam_t.real[1:5].tolist(), reLam_harm=lam.real[1:5].tolist(),
                             max_abs_err_matrix=float(np.max(np.abs(Ct - Ch))),
                             cross_gos_phos_time=float(np.max(np.abs(Ct[0, 1:]))),
                             circ_defect_time=corr.circulant_defect(Ct[1:, 1:])))
            r = res4[-1]
            print(f"{lp.name:14s} a={a:.6f} D={D}: C_gos t/h = {r['C_gos_time']:+.5e}/{r['C_gos_harm']:+.5e}  "
                  f"Re lam1 t/h = {r['reLam_time'][0]:+.5e}/{r['reLam_harm'][0]:+.5e}  "
                  f"max|dC|={r['max_abs_err_matrix']:.1e}  max|cross|={r['cross_gos_phos_time']:.1e}")
OUT['time_vs_harmonic_irrational'] = res4

# ---------------------------------------------------------------------------
section("3. exactness of the harmonic sums for rational alpha (GOS: always; PHOS: iff 8 | Q)")
res5 = []
for a in (Fraction(1, 3), Fraction(2, 5), Fraction(3, 7), Fraction(1, 12), Fraction(5, 12), Fraction(3, 16),
          Fraction(5, 24), Fraction(7, 40), Fraction(9, 64), Fraction(1001, 4096), Fraction(1, 16), Fraction(1, 8),
          Fraction(3, 8), Fraction(1, 4), Fraction(1, 2), Fraction(11, 100)):
    for lp in (T1, T2):
        D = 0
        Ce = corr.C_exact(a, D, loop=lp)
        beta = (8 * a) % 1
        cg_cf = corr.gos_rational_closed_form(beta, D, loop=lp)
        cg_h = corr.gos_harmonic(float(a), D, loop=lp, M=1 << 20)
        lam_h = corr.phos_eigs_harmonic(float(a), D, loop=lp, M=1 << 18)
        lam_e = corr.phos_modes_from_C(Ce[1:, 1:])
        ev = np.linalg.eigvals(Ce[1:, 1:])
        Q = a.denominator
        visited = int(np.sum(np.diag(corr.C_exact(a, D, h=np.array([1.0]))[1:, 1:]) > 0))   # h=delta -> <x_k^2>
        res5.append(dict(alpha=str(a), Q=Q, eight_divides_Q=(Q % 8 == 0), loop=lp.name,
                         C_gos_exact=float(Ce[0, 0]), C_gos_closed_form=cg_cf, C_gos_harmonic=cg_h,
                         reLam_exact_modes=lam_e.real.tolist(), reLam_harmonic=lam_h.real.tolist(),
                         lam_mode_err=float(np.max(np.abs(lam_e - lam_h))),
                         circulant_defect=corr.circulant_defect(Ce[1:, 1:]),
                         cross_gos_phos=float(np.max(np.abs(Ce[0, 1:]) + np.abs(Ce[1:, 0]))),
                         phases_visited=visited, rank_phos=int(np.linalg.matrix_rank(Ce[1:, 1:], tol=1e-12)),
                         eig_phos_exact=[[float(z.real), float(z.imag)] for z in ev]))
        r = res5[-1]
        print(f"a={str(a):9s} Q={Q:5d} 8|Q={str(r['eight_divides_Q']):5s} {lp.name:10s} "
              f"GOS ex/cf/harm = {r['C_gos_exact']:+.6e}/{cg_cf:+.6e}/{cg_h:+.6e}  "
              f"|lam_ex-lam_h|={r['lam_mode_err']:.1e} circ.def={r['circulant_defect']:.1e} "
              f"|cross|={r['cross_gos_phos']:.1e} visited={visited} rankPHOS={r['rank_phos']}")
OUT['rational_exactness'] = res5

# ---------------------------------------------------------------------------
section("4. small-frequency asymptotics (time-domain step-response argument)")
res6 = {}
for lp in (T1, models['T1_lat2'], T2, models['T2_pm60_lat2'], models['T2_pm45_lat1']):
    hh = lp.impulse(200000)
    s1 = np.cumsum(hh)
    Sinf = s1.sum() if lp.params['type'] == 1 else 0.0
    rows = []
    for D in (0, 1, 2):
        SD = float(np.sum(s1[:D]))
        for beta in (1 / 512, 1 / 2048, 1 / 8192):
            a = Fraction(1, 8) * 0 + Fraction(beta).limit_denominator(1 << 20) / 8   # 8 alpha = beta
            cg = corr.gos_rational_closed_form(Fraction(beta).limit_denominator(1 << 20), D, loop=lp)
            pred1 = beta * (Sinf - 2 * SD) / 2
            pred2 = beta ** 2 / lp.params['Ki'] if (lp.params['type'] == 2 and D == 0) else None
            al = beta / 8                                    # PHOS: use alpha small; theory lam ~ alpha(Sinf-2SD)(1-cos)
            lam = corr.phos_eigs_harmonic(al, D, loop=lp, M=1 << 16)
            pred_lam = [al * (Sinf - 2 * SD) * (1 - math.cos(2 * math.pi * m / 8)) for m in range(1, 5)]
            rows.append(dict(D=D, beta=beta, C_gos=cg, pred_order1=pred1, pred_typeII_D0=pred2,
                             alpha=al, reLam=lam.real[1:5].tolist(), pred_reLam=pred_lam))
            print(f"{lp.name:14s} D={D} beta={beta:.6f}: C_gos={cg:+.4e}  (beta/2)(S_inf-2S_D)={pred1:+.4e}"
                  + (f"  beta^2/Ki={pred2:+.4e}" if pred2 is not None else "")
                  + f" | alpha={al:.6f} Re lam1={lam.real[1]:+.3e} pred {pred_lam[0]:+.3e}")
    res6[lp.name] = dict(S_inf=float(Sinf), Ki=lp.params.get('Ki'), rows=rows)
OUT['small_frequency_asymptotics'] = res6

# ---------------------------------------------------------------------------
section("5. comparator gain K_q (Bussgang / small-signal) and f_vco independence")
sig = 0.0256          # 200 fs in units of T_vco/8 = 7.8125 ps (f_vco = 16 GHz, illustrative)
e = np.linspace(-0.3, 0.3, 13) * sig
Esign = special.erf(e / (math.sqrt(2) * sig))
OUT['Kq_check'] = dict(sigma=sig, max_rel_err_lin_vs_erf_abs_e_le_0p3sigma=rel(corr.K_q(sig) * e, Esign))
print("K_q linearisation error for |e| <= 0.3 sigma_v:", OUT['Kq_check'])
fv = {}
a = Fraction(77, 4096)
Ce = corr.C_exact(a, 0, loop=T2)
for f_vco in (12e9, 16e9, 20e9):
    unit = 1 / f_vco / 8                       # seconds per unit of rho
    # GOS gain error in relative units -> timing error = delta_g * rho * T_vco/8 ; PHOS error in seconds
    Cphys = Ce.copy()
    Cphys[:, 0] *= unit                        # column of GOS error scaled by T_vco/8
    ev = np.linalg.eigvals(Cphys[1:, 1:])
    fv[f"{f_vco/1e9:g}GHz"] = dict(C_gos_phys=float(Cphys[0, 0]), sign_gos=int(np.sign(Cphys[0, 0])),
                                   n_phos_eig_negative_real=int(np.sum(ev.real < -1e-15)))
print("f_vco scaling (alpha=77/4096, T2):", fv)
OUT['fvco_independence'] = fv

OUT['runtime_s'] = time.time() - t0
(HERE / 'verify_results.json').write_text(json.dumps(OUT, indent=1, default=float))
print(f"\nwrote verify_results.json  ({OUT['runtime_s']:.1f} s)")
