"""P1b: closed-loop sign-error block LMS with a comparator DC offset u_os (own simulator).
Injection (time unit fs): u[n] = Delta*(a - w_g)*rho[n] + (eps_p[n] - w_p[n]).
q = sign(e_PD + v + u_os), v ~ N(0, sig).  Regressor variants: raw, ac (rho - mean, one-hot - 1/8), 1diff.
Step sizes as the consolidated simulator: time constant tau = 25 blocks for H == 1 (raw)."""
import numpy as np, math, json, sys
from scipy import signal
from phys import *
sig, Delta, a = 200.0, 62500.0 / 8, 0.03
rng0 = np.random.default_rng(7)
eps = rng0.normal(0, 250, 8); eps -= eps.mean()

def run(loop, P, Q, variant, uos, nblk=4000, N=512, tau=25.0, seed=1, lanes=2):
    rng = np.random.default_rng(seed)
    Kq0 = math.sqrt(2 / math.pi) / sig
    mu_p = 8 / (tau * Kq0); mu_g = 12 / (tau * Kq0 * Delta)
    if variant == '1diff':   # power normalisation as consolidated (NLMS-style)
        nn = np.arange(1 << 14); X = X_of(P, Q, nn); R = X[1:] - X[:-1]
        mu_g *= (1 / 12) / R[:, 0].var(); mu_p *= (1 / 8) / (R[:, 1:] ** 2).mean()
    wg = np.zeros(lanes); W = np.zeros((lanes, 8))
    bH = loop.Ld; aH = padd(loop.Ld, loop.Ln)
    zi = np.zeros((max(len(aH), len(bH)) - 1, lanes))
    n0 = 0; xprev = X_of(P, Q, np.array([-1]))[0]
    hist = []
    for b in range(nblk + 8):
        nn = np.arange(n0, n0 + N); X = X_of(P, Q, nn); n0 += N
        rho = X[:, 0]; P1 = X[:, 1:]
        u = Delta * (a - wg)[None, :] * rho[:, None] + (P1 @ eps)[:, None] - P1 @ W.T
        e, zi = signal.lfilter(bH, aH, u, axis=0, zi=zi)
        if b < 8:            # settle
            xprev = X[-1]; continue
        if variant == 'raw':
            R = X
        elif variant == 'ac':
            R = X.copy(); R[:, 0] -= 0.5; R[:, 1:] -= 1 / 8
        else:
            R = np.vstack([X[:1] - xprev, X[1:] - X[:-1]])
        xprev = X[-1]
        q = np.sign(e + rng.normal(0, sig, e.shape) + uos)
        G = q.T @ R / N
        wg += mu_g * G[:, 0]; W += mu_p * G[:, 1:]
        if b % 200 == 0 or b == nblk + 7:
            perr = W - eps[None, :]
            cm = perr.mean(1)
            hist.append(dict(b=b, gos_pp_fs=(Delta * np.abs(a - wg)).tolist(),
                             phos_diff_rms_fs=np.sqrt(((perr - cm[:, None]) ** 2).mean(1)).tolist(),
                             phos_cm_fs=cm.tolist()))
    return hist

res = {}
lp = {'L1': L1(), 'L2': L2(60), 'L3': L3(60, 'impulse')}
for ln, P, Q in (('L2', 137, 1000), ('L1', 137, 1000), ('L3', 137, 1000), ('L2', 123, 1000)):
    for uos in (0.0, 25.0, 100.0):
        for var in ('raw', 'ac', '1diff'):
            h = run(lp[ln], P, Q, var, uos)
            last = h[-1]
            key = f'{ln}|a={P}/{Q}|u={uos:g}|{var}'
            res[key] = h
            print(f'{key:28s} GOS |err| p-p {np.median(last["gos_pp_fs"]):8.1f} fs | PHOS diff rms {np.median(last["phos_diff_rms_fs"]):8.1f} fs | PHOS CM {np.median(last["phos_cm_fs"]):9.1f} fs', flush=True)
json.dump(res, open('s2_lms_offset.json', 'w'))
