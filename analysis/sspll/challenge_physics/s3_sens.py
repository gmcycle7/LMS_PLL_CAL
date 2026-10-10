"""P2: robustness of the remedies' sign conditions to physical loop variations.
min_f Re Gamma_eff with Gamma_eff = Hc(f) conj(G(f)); Hc = comparator transfer (H or P*H).
variants: raw (G=1), 1diff (G=1-z^-1), P-only (integral path frozen -> Type-I with same Kp/latency/pole)."""
import numpy as np, math, json
from phys import *
f = np.concatenate([np.geomspace(1e-7, 1e-3, 3000), np.linspace(1e-3, 0.5, 200001)])
zi = np.exp(-2j*np.pi*f)

def stats(lp, cmp_on_hold=True):
    Hc = lp.H(f) * (lp.P(f) if (lp.P is not None and cmp_on_hold) else 1)
    raw = Hc.real
    d1 = (Hc * np.conj(1 - zi)).real
    bands = [(round(a*4e3,2), round(b*4e3,2)) for a,b,_,_ in lp.reH_bands()] if lp.P is None or True else None
    # raw negative band on Hc (comparator transfer) directly
    neg = raw < 0
    edges = []
    if neg.any():
        idx = np.nonzero(neg)[0]
        edges = [round(f[idx[0]]*4e3,2), round(f[idx[-1]]*4e3,2)]
    return dict(f3dB=round(lp.f3db()*4e3,2), PM=round(lp.pm()[1],2), stable=lp.stable(),
                raw_min=round(float(raw.min()),4), raw_neg_span_MHz=edges,
                d1_min=float(d1.min()), d1_min_at_MHz=round(float(f[np.argmin(d1)]*4e3),2))

out = {}
def rec(name, lp, **kw):
    s = stats(lp, **kw); out[name] = s
    print(f'{name:42s}', s, flush=True)

# nominal
rec('L1', L1()); l2 = L2(60); rec('L2 PM60', l2); l3 = L3(60,'impulse'); rec('L3 imp', l3)
# loop latency (redesigned for 320 MHz)
for lat in (1.5, 2.0, 2.5):
    rec(f'L1 lat{lat}', L1(lat=lat))
    rec(f'L2 PM60 lat{lat} (redesign)', L2(60, lat=lat))
    rec(f'L2 lat{lat} (Kp,Ki fixed)', L2(Kp=l2.params['Kp'], Ki=l2.params['Ki'], lat=lat))
# PM sweep
for pm in (45, 75):
    rec(f'L2 PM{pm}', L2(pm))
rec('L3 zoh', L3(60,'zoh'))
rec('L3 PM45 imp', L3(45,'impulse'))
# PVT loop-gain variation (SSPD amplitude / Kvco), NOT redesigned
for g in (0.6, 0.8, 1.25, 1.5):
    rec(f'L2 gain x{g}', L2(Kp=l2.params['Kp'], Ki=l2.params['Ki'], gain_scale=g))
    rec(f'L3 gain x{g}', L3(60,'impulse', wc=l3.params['wc'], gain_scale=g))
# parasitic pole on Type-I and on Type-II
for fp in (1e9, 0.5e9, 0.25e9):
    rec(f'L1 pole {fp/1e9:g}G', L1(f_pole=fp))
# P-only remedy variants
rec('P-only L2 (lat1)', L1(K=l2.params['Kp']))
rec('P-only L2 lat2', L1(K=l2.params['Kp'], lat=2.0))
rec('P-only L2 lat2.5', L1(K=l2.params['Kp'], lat=2.5))
rec('P-only L2 + pole 0.5G', L1(K=l2.params['Kp'], f_pole=0.5e9))
# sampler memory (charge sharing between sampling and hold caps): P(z) = (1-k)/(1-k z^-1)
for kap in (0.1, 0.3, 0.5):
    Pm = TF([1-kap], [1, -kap])
    rec(f'L2 PM60 + sampler mem k={kap} (cmp on hold)', L2(60, P=Pm), cmp_on_hold=True)
    rec(f'L2 PM60 + sampler mem k={kap} (cmp on sample)', L2(60, P=Pm), cmp_on_hold=False)
    rec(f'L1 + sampler mem k={kap} (cmp on hold)', L1(P=Pm), cmp_on_hold=True)
json.dump(out, open('s3_sens.json','w'), indent=1)
