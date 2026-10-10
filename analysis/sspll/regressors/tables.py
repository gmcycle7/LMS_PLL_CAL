"""
tables.py -- the numeric tables quoted in README.md (all from exact closed forms):
  * loop-model table
  * normalised GOS gain  12*C_gos   vs sawtooth line frequency beta*f_ref
  * normalised PHOS gain 8*Re(lam_m) vs PMUX fundamental alpha*f_ref
  * joint 9x9 for in-band rationals alpha = 1/Q with 8 not dividing Q (non-circulant, GOS<->PHOS coupled)
Writes tables.json.
"""
import json
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa: E402

F_REF = corr.F_REF
models = corr.standard_models()
OUT = {}


def frac_at(f_hz, bits=20):
    num = int(round(f_hz / F_REF * (1 << bits)))
    num += (num % 2 == 0)
    return Fraction(num, 1 << bits)


# ---------------- model table ----------------
print("model table")
rows = []
for k, lp in models.items():
    p = lp.params
    rows.append(dict(model=k, K=p.get('K'), Kp=p.get('Kp'), Ki=p.get('Ki'), PM=p['PM_deg'], fc_MHz=p['fc_Hz'] / 1e6,
                     peaking_dB=p['peaking_dB'], ReH_neg_band_MHz=p['ReH_negative_bands_MHz'],
                     ReH_min=p['ReH_min'], ReH_min_at_MHz=p['ReH_min_at_MHz'], S_inf=p['S_inf'],
                     max_pole=p['max_pole_mag']))
    print(f"| {k} | {p.get('K') or 0:.4g} | {p.get('Kp') or 0:.4f} | {p.get('Ki') or 0:.5f} | {p['PM_deg']:.1f} | "
          f"{p['fc_Hz']/1e6:.1f} | {p['peaking_dB']:.2f} | "
          f"{'none' if not p['ReH_negative_bands_MHz'] else '0-%.1f' % p['ReH_negative_bands_MHz'][0][1]} | "
          f"{p['ReH_min']:.3f} @ {p['ReH_min_at_MHz']:.0f} | {p['S_inf']:.3f} |")
OUT['models'] = rows

# ---------------- GOS vs beta ----------------
fb = [1, 2, 5, 10, 20, 40, 60, 84, 100, 150, 200, 300, 500, 1000, 1500, 2000 - 1]
print("\n12*C_gos vs beta*f_ref [MHz] (D=0 unless noted)")
gos_tab = {}
for k, D in [('T1_lat1', 0), ('T1_lat2', 0), ('T2_pm45_lat1', 0), ('T2_pm60_lat1', 0), ('T2_pm75_lat1', 0),
             ('T2_pm60_lat2', 0), ('CP_pm55', 0), ('CP_pm55_tauHalf', 0), ('T2_pm60_lat1', 1), ('T2_pm60_lat1', -1), ('T1_lat1', 1), ('T2_pm60_lat1', 2)]:
    lp = models[k]
    vals = [12 * corr.gos_rational_closed_form(frac_at(f * 1e6, 22), D, loop=lp) for f in fb]
    gos_tab[f"{k}_D{D}"] = dict(beta_MHz=fb, gos_norm=vals,
                                small_beta_theory=None)
    print(f"{k+'_D'+str(D):18s} " + " ".join(f"{v:+.3f}" for v in vals))
print("beta(MHz):         " + " ".join(f"{f:6d}" for f in fb))
OUT['gos_vs_beta'] = gos_tab

# ---------------- PHOS vs offset ----------------
fo = [2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 84, 100, 115, 125, 135, 150, 175, 200, 300, 500]
print("\n8*Re(lam_m) vs offset alpha*f_ref [MHz]")
ph_tab = {}
for k, D in [('T1_lat1', 0), ('T2_pm45_lat1', 0), ('T2_pm60_lat1', 0), ('T2_pm75_lat1', 0), ('T2_pm60_lat2', 0),
             ('T2_pm60_lat1_pole1G', 0), ('CP_pm55', 0), ('CP_pm55_tauHalf', 0), ('T2_pm60_lat1', 1)]:
    lp = models[k]
    L = np.array([corr.phos_modes_rational(frac_at(f * 1e6), D, loop=lp) for f in fo])
    ph_tab[f"{k}_D{D}"] = dict(offset_MHz=fo, **{f"m{m}": (8 * L[:, m].real).tolist() for m in range(1, 5)},
                               **{f"im_m{m}": (8 * L[:, m].imag).tolist() for m in range(1, 4)})
    for m in range(1, 5):
        print(f"{k+'_D'+str(D):22s} m{m}: " + " ".join(f"{v:+.3f}" for v in 8 * L[:, m].real))
print("offset(MHz):              " + " ".join(f"{f:6d}" for f in fo))
OUT['phos_vs_offset'] = ph_tab

# ---------------- joint 9x9 for in-band rationals with 8 not dividing Q ----------------
print("\njoint 9x9, alpha = 1/Q (8 does not divide Q), T2_pm60_lat1, D=0")
jt = []
lp = models['T2_pm60_lat1']
for Q in [25, 27, 30, 33, 35, 37, 40, 45, 50, 57, 63, 70, 75, 99, 100, 125, 150, 175, 199, 200, 250]:
    a = Fraction(1, Q)
    C = corr.C_exact(a, 0, loop=lp)
    evj = np.linalg.eigvals(C)
    evj = evj[np.argsort(evj.real)]
    modes = corr.phos_modes_rational(a, 0, loop=lp)
    cg = C[0, 0]
    nz = evj[np.abs(evj) > 1e-9]
    jt.append(dict(alpha=f"1/{Q}", offset_MHz=F_REF / Q / 1e6, eight_divides_Q=(Q % 8 == 0),
                   C_gos=float(cg), cross_norm=float(np.linalg.norm(C[0, 1:]) + np.linalg.norm(C[1:, 0])),
                   circ_defect=corr.circulant_defect(C[1:, 1:]),
                   min_re_joint=float(nz.real.min()), min_re_circulant_pred=float(min(cg, modes.real[1:].min())),
                   eig_joint=[[float(z.real), float(z.imag)] for z in evj]))
    r = jt[-1]
    print(f"1/{Q:<4d} {r['offset_MHz']:7.1f}MHz 8|Q={str(r['eight_divides_Q']):5s} cross={r['cross_norm']:.4f} "
          f"circdef={r['circ_defect']:.3f}  min Re eig: exact 9x9 {r['min_re_joint']:+.5f} | circulant/harmonic "
          f"{r['min_re_circulant_pred']:+.5f}")
OUT['joint_inband_rationals'] = jt

(HERE / 'tables.json').write_text(json.dumps(OUT, indent=1, default=float))
print("\nwrote tables.json")
