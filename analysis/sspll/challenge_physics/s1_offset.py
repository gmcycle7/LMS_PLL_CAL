"""P1: comparator DC offset / static phase offset u_os at the comparator input.
Bussgang about the operating point:  E[q | c] ~ erf(u/(sqrt2 sig)) + Kq(u) (c - u),
Kq(u) = sqrt(2/pi)/sig * exp(-u^2/(2 sig^2)).
GOS stationary point (raw regressor, <rho> = mean of code):
   Delta*(a-w) = - erf(u/sqrt2 sig) <rho> / (Kq(u) C_GOS)        [fs, p-p of the residual sawtooth]
PHOS: sum_k of the update = E[q] (since 1^T C = 0) -> common-mode drift  mu_p E[q]/8 per block per phase;
      differential bias = E[q] (occ_k - 1/8) when occupancy is non-uniform (8 does not divide Q)."""
import numpy as np, math, json
from scipy import special
from phys import *
sig = 200.0  # fs, illustrative (same as consolidated)
loops = {'L1': L1(), 'L2': L2(60), 'L3': L3(60, 'impulse')}
out = {}
cases = [(1, 500), (1, 50), (21, 1000), (137, 1000), (123, 1000), (1, 8 * 64 + 1)]
for uos in (5.0, 25.0, 100.0):
    Eq = special.erf(uos / (math.sqrt(2) * sig))
    Kq = math.sqrt(2 / math.pi) / sig * math.exp(-uos ** 2 / (2 * sig ** 2))
    for ln, lp in loops.items():
        for P, Q in cases:
            C, occ, rmean = C_periodic(lp, P, Q)
            Cg = C[0, 0]
            bias_fs = Eq * rmean / (Kq * Cg) if Cg > 0 else float('nan')
            # PHOS differential bias from non-uniform occupancy: solve C_pp d = -Eq (occ - mean)/Kq on observable subspace
            Cpp = C[1:, 1:]
            v = np.ones(8) / math.sqrt(8)
            Bm = np.linalg.svd(np.eye(8) - np.outer(v, v))[0][:, :7]
            rhs = -(Eq / Kq) * (Bm.T @ (occ - occ.mean()))
            try:
                d = Bm @ np.linalg.solve(Bm.T @ Cpp @ Bm, rhs)
                phos_bias = float(np.sqrt(np.mean(d ** 2)))
            except np.linalg.LinAlgError:
                phos_bias = float('nan')
            key = f'{ln}|a={P}/{Q}|u={uos:g}fs'
            out[key] = dict(alpha_MHz=min(P / Q, 1 - P / Q) * 4e3, Eq=Eq, Kq_rel=Kq / (math.sqrt(2 / math.pi) / sig),
                            twelveC=12 * Cg, rho_mean=rmean, GOS_bias_pp_fs=bias_fs,
                            GOS_bias_pp_fs_ac=Eq * (rmean - 0.5) / (Kq * Cg) if Cg > 0 else float('nan'),
                            PHOS_occ_spread=float(occ.max() - occ.min()), PHOS_diff_bias_rms_fs=phos_bias,
                            CM_drift_fs_per_block_sim_mu=Eq / (25 * math.sqrt(2 / math.pi) / sig))
for k, v in out.items():
    if 'u=25fs' in k or 'u=100fs' in k:
        print(k, ' '.join(f'{a}={b:.4g}' for a, b in v.items()))
json.dump(out, open('s1_offset.json', 'w'), indent=1)
# static phase error of a pure Type-I SSPLL (L1) vs residual VCO frequency offset (normalised model)
K = loops['L1'].params['K']
for ppm in (10, 100, 1000, 3000):
    e_ss = ppm * 1e-6 * 250e3 / K   # fs  (T_ref = 250 ps = 250e3 fs)
    print(f'L1 Type-I static phase error for df/f={ppm} ppm: {e_ss:.1f} fs  -> E[q]={special.erf(e_ss/(math.sqrt(2)*sig)):.3f}, Kq/Kq0={math.exp(-e_ss**2/(2*sig**2)):.3g}')
