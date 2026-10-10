"""
fxlms_check.py -- remedy check: filtered-x (FxLMS) regressor  x_f = h_hat * x.
Then C_ij = sum_l conj(c^i_l) c^j_l * H(f_l) conj(H_hat(f_l)) e^{j2pi f_l D}: the sign function becomes
Re{ H(f) conj(H_hat(f)) e^{j 2 pi f D} }  (>= 0 everywhere when H_hat = H, D = 0 -> Gram matrix, PSD).
Writes fxlms_results.json.
"""
import json
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa: E402

models = corr.standard_models()
T2 = models['T2_pm60_lat1']
QZ = 1 << 16
az = 2 * np.arange(1, 2048) + 1          # alpha = odd/2^16 -> offsets 0.18 .. 250 MHz (8 | Q, circulant)
QG = 4096
ag = 2 * np.arange(QG // 2) + 1          # alpha = odd/4096 over [0,1)


def min_modes(lp, hat, D=0):
    """min over alpha (zoom + full grid) of 8 Re lam_m (m=1..7) and 12 C_gos with the effective Gamma."""
    def gam(f):
        g = lp.Gamma(f, D)
        return g if hat is None else g * np.conj(hat.H(f))
    res = {}
    # PHOS (exact closed form, 8 | Q)
    for Q, A in ((QZ, az), (QG, ag)):
        Gq = gam(np.arange(Q) / Q)
        lam = np.zeros((len(A), 8))
        for m in range(1, 8):
            kk = np.arange(m, Q, 8)
            wk = 8 * np.sin(np.pi * m / 8) ** 2 / Q ** 2 / np.sin(np.pi * kk / Q) ** 2
            for i, a in enumerate(A):
                lam[i, m] = np.sum(Gq[(kk * int(a)) % Q] * wk).real
        res[f'Q{Q}'] = float(8 * lam[:, 1:].min())
    # GOS
    Q = 8192
    r = np.arange(1, Q)
    w = 1.0 / (4 * Q ** 2 * np.sin(np.pi * r / Q) ** 2)
    Gq = np.real(gam(np.arange(Q) / Q))
    cg = np.array([np.sum(Gq[(r * b) % Q] * w) for b in 2 * np.arange(Q // 4) + 1])
    return dict(min_8ReLam_zoom=res[f'Q{QZ}'], min_8ReLam_full=res[f'Q{QG}'], min_12Cgos=float(12 * cg.min()))


cases = [('plain LMS (no filter)', None),
         ('FxLMS, H_hat = H (exact model)', T2),
         ('FxLMS, H_hat = Type-II PM45 model', models['T2_pm45_lat1']),
         ('FxLMS, H_hat = Type-II PM75 model', models['T2_pm75_lat1']),
         ('FxLMS, H_hat = Type-II lat 2 model', models['T2_pm60_lat2']),
         ('FxLMS, H_hat = Type-I model', models['T1_lat1']),
         ('FxLMS, H_hat = CPPLL PM55 model', models['CP_pm55'])]
out = dict(true_loop='T2_pm60_lat1', D=0, rows=[])
f = np.linspace(1e-5, 0.5, 20001)
for lab, hat in cases:
    r = min_modes(T2, hat)
    if hat is not None:
        ph = np.degrees(np.angle(T2.H(f) * np.conj(hat.H(f))))
        r['max_phase_mismatch_deg'] = float(np.max(np.abs(ph)))
    r['label'] = lab
    out['rows'].append(r)
    print(f"{lab:38s} min 8Re(lam) zoom={r['min_8ReLam_zoom']:+.4f} full={r['min_8ReLam_full']:+.4f}  "
          f"min 12C_gos={r['min_12Cgos']:+.4f}  " + (f"max|angle(H Hhat*)|={r['max_phase_mismatch_deg']:.1f} deg" if hat else ''))
(HERE / 'fxlms_results.json').write_text(json.dumps(out, indent=1))
