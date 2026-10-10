"""P2b: 1st-diff remedy when the comparator sees a filtered version of the PD residual that the loop
does NOT see (comparator pre-amp / sampling-node RC): Hc = Pc*H, Pc = (1-p)/(1-p z^-1), p = exp(-2pi fp/fref).
Also low-PM designs to locate where the 1diff condition Ki <= 2Kp breaks."""
import numpy as np, math, json
from phys import *
f = np.concatenate([np.geomspace(1e-7, 1e-3, 3000), np.linspace(1e-3, 0.5, 200001)])
zi = np.exp(-2j*np.pi*f)
out = {}
loops = {'L1': L1(), 'L2': L2(60), 'L3': L3(60, 'impulse'), 'P-only(L2)': L1(K=0.287717)}
for fp in (4e9, 2e9, 1e9, 0.5e9, 0.25e9):
    p = math.exp(-2*np.pi*fp/4e9); Pc = (1-p)/(1-p*zi)
    for ln, lp in loops.items():
        H = lp.H(f)
        for vn, G in (('raw', np.ones_like(zi)), ('1diff', 1-zi)):
            g = (Pc*H*np.conj(G)).real
            i = np.argmin(g)
            neg = np.nonzero(g < 0)[0]
            span = [round(f[neg[0]]*4e3,1), round(f[neg[-1]]*4e3,1)] if len(neg) else []
            out[f'{ln}|{vn}|cmp pole {fp/1e9:g}GHz'] = dict(min=float(g[i]), at_MHz=float(f[i]*4e3), neg_span_MHz=span, h_c0=1-p)
            print(f'{ln:10s} {vn:6s} cmp-pole {fp/1e9:5g} GHz (h_c[0]={1-p:.3f}): min Re Gamma {g[i]:+.4f} @ {f[i]*4e3:7.1f} MHz, neg span {span}')
for pm in (40, 35, 30):
    try:
        lp = L2(pm)
        Kp, Ki = lp.params['Kp'], lp.params['Ki']
        H = lp.H(f); g = (H*np.conj(1-zi)).real
        print(f'L2 PM{pm}: Kp={Kp:.4f} Ki={Ki:.4f} Ki/Kp={Ki/Kp:.3f} 1diff min Re {g.min():+.3e}  (closed-form margin Kp-Ki/2={Kp-Ki/2:+.4f})')
        out[f'L2 PM{pm} 1diff'] = dict(Kp=Kp, Ki=Ki, min=float(g.min()))
    except Exception as e:
        print('PM', pm, 'fail', e)
json.dump(out, open('s3b_cmpfilter.json','w'), indent=1)
