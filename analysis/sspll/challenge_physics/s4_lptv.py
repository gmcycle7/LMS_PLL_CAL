"""P3: linear periodically time-varying (LPTV) effects that the LTI theory ignores.
 (a) per-PMUX-phase SSPD gain mismatch A_k (amplitude of the 8 VCO phases differs; SSPD gain ~ A_k*w_vco):
     both the loop and the comparator see v[n] = A_{p[n]} s[n].
 (b) DTC sampling-instant modulation: the held SSPD value of sample n acts for T + d[n+1]-d[n]
     (d = DTC delay = rho*Delta): loop-only gain g_L[n] = 1 + (rho[n+1]-rho[n]) Delta/T_ref.
Exact periodic steady state by time-domain iteration (state space), Bussgang-linear mean matrix
C_ij = <r_i c_j> over one period; eigenvalues on the observable (non-common-mode) subspace."""
import numpy as np, math, json
from scipy import signal
from phys import *

def ss_of(lp):
    n = max(len(lp.Ln), len(lp.Ld))
    A, B, Cm, D = signal.tf2ss(np.pad(lp.Ln, (0, n-len(lp.Ln))), np.pad(lp.Ld, (0, n-len(lp.Ld))))
    assert abs(D).max() < 1e-12
    return A, B, Cm

def C_lptv(lp, P, Q, Ak=None, gL_mode=None, Delta_over_T=1/32, nper=2, settle=6000):
    A, B, Cm = ss_of(lp)
    nn = np.arange(-settle - (settle % Q) - Q, nper * Q)   # start aligned so the last nper*Q are full periods
    X = X_of(P, Q, nn)
    rho = X[:, 0]; p = np.argmax(X[:, 1:], 1)
    gA = np.ones(len(nn)) if Ak is None else Ak[p]
    gL = np.ones(len(nn))
    if gL_mode == 'dtc':
        rho_next = X_of(P, Q, nn + 1)[:, 0]
        gL = 1 + (rho_next - rho) * Delta_over_T
    x = np.zeros((A.shape[0], 9))
    cmp = np.zeros((len(nn), 9))
    for i in range(len(nn)):
        phi = (Cm @ x)[0]
        s = X[i] - phi                       # unit error in each direction j: u = X[:, j]
        v = gA[i] * s
        cmp[i] = v
        x = A @ x + B @ (gL[i] * v)[None, :]
    keep = slice(len(nn) - nper * Q, len(nn))
    Xk = X[keep]; Xprev = X[keep.start - 1: keep.stop - 1]
    out = {}
    for vn, R in (('raw', Xk), ('1diff', Xk - Xprev)):
        Cmat = R.T @ cmp[keep] / (nper * Q)
        ev = obs_eigs(Cmat)
        out[vn] = float(ev.real.min())
    return out

rng = np.random.default_rng(11)
loops = {'L1': L1(), 'L2': L2(60), 'L3': L3(60, 'impulse')}
alphas = [(4, 4096), (8, 4096), (16, 4096), (41, 4096), (82, 4096), (128, 4096), (504, 4096), (560, 4096), (1016, 4096), (2040, 4096)]
res = {}
for ln, lp in loops.items():
    for P, Q in alphas:
        g = math.gcd(P, Q); Pn, Qn = P // g, Q // g
        base = C_lptv(lp, Pn, Qn)
        row = dict(alpha=P / Q, MHz=P / Q * 4e3, LTI=base)
        for gam in (0.05, 0.10):
            vals = {'raw': [], '1diff': []}
            for sd in range(3):
                Ak = 1 + gam * np.random.default_rng(100 + sd).standard_normal(8)
                r = C_lptv(lp, Pn, Qn, Ak=Ak)
                for k in vals: vals[k].append(r[k])
            row[f'Amis{gam}'] = {k: [min(v), max(v)] for k, v in vals.items()}
        if ln in ('L1', 'L2'):
            row['dtc_hold_mod'] = C_lptv(lp, Pn, Qn, gL_mode='dtc')
        res[f'{ln}|{P}/{Q}'] = row
        print(ln, f'{P}/{Q}', f'{P/Q*4e3:7.1f} MHz', 'LTI', {k: f'{v:+.5f}' for k, v in base.items()},
              '| Amis10%', {k: [f'{a:+.5f}' for a in v] for k, v in row['Amis0.1'].items()},
              '| dtc', {k: f'{v:+.5f}' for k, v in row.get('dtc_hold_mod', {}).items()}, flush=True)
json.dump(res, open('s4_lptv.json', 'w'), indent=1)
