"""P1c: fraction of channels alpha = j/4096 whose raw-GOS stationary bias (comparator / static offset
u_os) exceeds a threshold, using the exact periodic LTI C_GOS (D=0) and Bussgang about u_os.
bias_pp[fs] = erf(u/sqrt2 sig) <rho> / (Kq(u) C_GOS);  'ac' uses <rho>-1/2 (rational residual mean).
Also the static offsets implied by typical CPPLL/SSPLL non-idealities (illustrative numbers, labelled)."""
import numpy as np, math, json
from scipy import special
from phys import *
sig = 200.0
loops = {'L1': L1(), 'L2': L2(60), 'L3': L3(60, 'impulse')}
J = np.arange(1, 2048)
res = {}
for ln, lp in loops.items():
    Cg = np.zeros(len(J)); rm = np.zeros(len(J))
    for i, j in enumerate(J):
        g = math.gcd(int(j), 4096); P, Q = j // g, 4096 // g
        C, occ, rmean = C_periodic(lp, P, Q)
        Cg[i] = C[0, 0]; rm[i] = rmean
    for uos in (5.0, 25.0, 100.0):
        Eq = special.erf(uos / (math.sqrt(2) * sig)); Kq = math.sqrt(2/math.pi)/sig*math.exp(-uos**2/(2*sig**2))
        valid = Cg > 1e-12
        b_raw = np.where(valid, Eq * rm / (Kq * np.where(valid, Cg, 1)), np.inf)
        b_ac = np.where(valid, Eq * np.abs(rm - 0.5) / (Kq * np.where(valid, Cg, 1)), np.inf)
        r = {}
        for thr in (20, 50, 200, 1000):
            r[f'raw>{thr}fs'] = float(np.mean(b_raw > thr)); r[f'ac>{thr}fs'] = float(np.mean(b_ac > thr))
        r['raw_median_fs'] = float(np.median(b_raw[valid])); r['ac_median_fs'] = float(np.median(b_ac[valid]))
        res[f'{ln}|u={uos:g}'] = r
        print(ln, f'u_os={uos:g} fs', {k: round(v, 3) for k, v in r.items()})
# illustrative static offsets
print('\nillustrative static offsets at the 1-bit comparator (sigma_v = 200 fs):')
for name, t in (('SSPD/comparator voltage offset 1 mV, SSPD slope 2*pi*f_vco*A, A=0.4 V, f_vco=16 GHz', 1e-3/(2*np.pi*16e9*0.4)*1e15),
                ('same, 5 mV', 5e-3/(2*np.pi*16e9*0.4)*1e15),
                ('CPPLL: 5% UP/DN mismatch x 50 ps PFD reset pulse', 0.05*50e3),
                ('CPPLL: 5% bleeder (offset) current x T_ref', 0.05*250e3),
                ('Type-I SSPLL static phase error, df/f = 100 ppm', 100e-6*250e3/loops['L1'].params['K'])):
    Eq = special.erf(t/(math.sqrt(2)*sig)); kr = math.exp(-t**2/(2*sig**2))
    print(f'  {name}: u_os = {t:.1f} fs -> E[q] = {Eq:.3f}, Kq/Kq0 = {kr:.3g}')
    res['illus|'+name] = dict(u_fs=t, Eq=Eq, Kq_ratio=kr)
json.dump(res, open('s5_offset_map.json', 'w'), indent=1)
