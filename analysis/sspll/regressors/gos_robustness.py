"""
gos_robustness.py -- is C_GOS(beta) > 0 for D = 0 a general property?  Sweep loops well outside the
nominal design (low PM, large latency, type-I with large excess delay) and report min_beta 12*C_GOS
and min_alpha 8*Re(lam_1).  Also scans the PHOS m1 inversion band.  Writes gos_robustness.json.
"""
import json, sys
from fractions import Fraction
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa

Q = 8192
beta_idx = 2 * np.arange(Q // 4) + 1           # beta = odd/8192 in (0, 0.5)
r = np.arange(1, Q)
w = 1.0 / (4 * Q ** 2 * np.sin(np.pi * r / Q) ** 2)
QZ = 1 << 16
az = 2 * np.arange(1, 2048) + 1                # alpha = odd/65536, offsets 0.18 .. 250 MHz


def scan(lp, D=0):
    G = np.real(lp.Gamma(np.arange(Q) / Q, D))
    cg = np.array([np.sum(G[(r * b) % Q] * w) for b in beta_idx])
    Gz = lp.Gamma(np.arange(QZ) / QZ, D)
    kk = np.arange(1, QZ, 8)
    wk = 8 * np.sin(np.pi / 8) ** 2 / QZ ** 2 / np.sin(np.pi * kk / QZ) ** 2
    l1 = np.array([np.sum(Gz[(kk * a) % QZ] * wk).real for a in az])
    neg = l1 < -1e-3 / 8
    band = (float(az[neg][0] / QZ * 4e3), float(az[neg][-1] / QZ * 4e3)) if neg.any() else None
    return float(12 * cg.min()), float(beta_idx[np.argmin(cg)] / Q * 4e3), float(8 * l1.min()), \
        float(az[np.argmin(l1)] / QZ * 4e3), band


out = []
cfg = [('T1', dict(lat=l)) for l in (1, 2, 3, 4, 5)] + \
      [('T2', dict(lat=1, pm_target=p)) for p in (20, 25, 30, 35, 40, 45, 60, 75)] + \
      [('T2', dict(lat=2, pm_target=p)) for p in (30, 45)] + [('T2', dict(lat=3, pm_target=p)) for p in (30, 45)] + \
      [('T2', dict(lat=1, pm_target=45, f_pole=fp)) for fp in (400e6, 800e6)] + \
      [('CP', dict(pm_target=p, tau=t)) for p in (40, 55, 65) for t in (0.0, 0.5 / 4e9)]
for typ, kw in cfg:
    try:
        lp = {'T1': corr.make_type1, 'T2': corr.make_type2, 'CP': corr.make_cppll}[typ](**kw)
    except Exception as e:  # noqa
        print(typ, kw, 'FAILED', e)
        continue
    st = lp.params
    g, gb, l, la, band = scan(lp)
    rec = dict(type=typ, **{k: v for k, v in kw.items()}, PM=st['PM_deg'], peaking_dB=st['peaking_dB'],
               ReH_neg_band_MHz=st['ReH_negative_bands_MHz'], ReH_min=st['ReH_min'],
               min_12Cgos=g, at_beta_MHz=gb, min_8ReLam1=l, at_offset_MHz=la, lam1_signif_inverted_span_MHz=band,
               stable=st['stable'])
    out.append(rec)
    print(f"{typ} {kw} PM={st['PM_deg']:.1f} pk={st['peaking_dB']:.2f}dB ReH<0={[(round(a,1),round(b,1)) for a,b in st['ReH_negative_bands_MHz']]}"
          f"  min12Cgos={g:+.4f}@{gb:.1f}MHz  min8ReLam1={l:+.4f}@{la:.1f}MHz  m1 band={band}")
(HERE / 'gos_robustness.json').write_text(json.dumps(out, indent=1, default=float))
