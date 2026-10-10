"""Re-check of the near-grid (alpha=0.123, beta f_ref = 64 MHz) GOS runaway under comparator offset,
other noise seeds.  Re-uses run() from s2_lms_offset.py (module top part only)."""
import numpy as np, json
src = open('s2_lms_offset.py').read().split('res = {}')[0]
ns = {}; exec(src, ns)
from phys import L2
lp = L2(60); out = {}
for uos in (50.0, 100.0):
    for var in ('ac', '1diff'):
        for sd in (5, 9):
            h = ns['run'](lp, 123, 1000, var, uos, seed=sd)
            v = float(np.median(h[-1]['gos_pp_fs'])); out[f'L2|123/1000|u={uos}|{var}|seed{sd}'] = v
            print(f'L2 a=0.123 u={uos} {var} seed{sd}: GOS p-p err {v:.1f} fs')
json.dump(out, open('s2b_check.json', 'w'), indent=1)
