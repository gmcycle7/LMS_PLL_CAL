"""
make_maps.py -- sign maps of the GOS / PHOS / joint LMS mean dynamics over alpha in [0,1)
for generic Type-I and Type-II SSPLL H_PD (closed-loop -3 dB = 320 MHz, f_ref = 4 GHz).

Grid: alpha_i = (2i+1)/4096, i = 0..2047  (2048 points, every point has period Q = 4096,
8 | Q -> PHOS matrix exactly circulant and GOS<->PHOS cross terms exactly zero, so the
"exact" DFT eigenvalues and the harmonic-sum eigenvalues must agree; both are computed).

Writes sign_maps.json.
"""
import json
import math
import sys
import time
from fractions import Fraction
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa: E402

F_REF = corr.F_REF
NG = 2048
QG = 2 * NG * 1            # 4096
ALPHA = (2 * np.arange(NG) + 1) / (2 * NG)
TOL = 1e-10                # |value| below this is treated as numerically zero

t0 = time.time()
models = corr.standard_models()
MAPS = []                  # (map_id, model_key, D)
for k in models:
    MAPS.append((f"{k}_D0", k, 0))
for k in ('T1_lat1', 'T2_pm60_lat1', 'T2_pm60_lat2', 'CP_pm55'):
    for D in (-1, 1, 2):
        MAPS.append((f"{k}_D{D:+d}".replace('+', 'p').replace('-', 'm'), k, D))

# Gamma on the Q-grid for each map
lgrid = np.arange(QG) / QG
GAM = np.array([np.real(models[k].Gamma(lgrid, D)) for _, k, D in MAPS])     # (nmaps, Q)  -- only Re needed for GOS
GAMc = np.array([models[k].Gamma(lgrid, D) for _, k, D in MAPS])            # complex, for PHOS modes

# ---------------- exact (DFT) evaluation ----------------
nmap = len(MAPS)
C_gos = np.zeros((nmap, NG))
LAM = np.zeros((nmap, NG, 8), complex)
n = np.arange(QG)
for i, a in enumerate(ALPHA):
    fr = Fraction(2 * i + 1, 2 * NG)
    R = corr.regressors(fr, n)
    rho = R[0]
    p = np.argmax(R[1:], axis=0)
    Pg = np.abs(np.fft.fft(rho) / QG) ** 2                                   # |c^rho_l|^2
    Y = np.exp(2j * np.pi * np.outer(np.arange(8), p) / 8)                  # y_m[n] = e^{j2pi m p[n]/8}
    Pm = np.abs(np.fft.fft(Y, axis=1) / QG) ** 2                             # (8, Q)
    C_gos[:, i] = GAM @ Pg                                                   # sum_l |c_l|^2 Re Gamma_l
    LAM[:, i, :] = (GAMc @ Pm.T) / 8.0                                       # lambda_m = v_m^H C v_m = (1/8) sum_l Gamma_l |DFT(y_m)/Q|^2
t_exact = time.time() - t0

# ---------------- harmonic-sum evaluation (independent) ----------------
C_gos_h = np.zeros((nmap, NG))
LAM_h = np.zeros((nmap, NG, 8), complex)
for j, (mid, k, D) in enumerate(MAPS):
    lp = models[k]
    for i, a in enumerate(ALPHA):
        C_gos_h[j, i] = corr.gos_harmonic(a, D, loop=lp, M=4096)
        LAM_h[j, i] = corr.phos_eigs_harmonic(a, D, loop=lp, M=4096)
t_harm = time.time() - t0 - t_exact

# ---------------- full 9x9 check (circulant / zero cross / eigenvalues) on one map ----------------
chk = dict(map='T2_pm60_lat1_D0', max_cross=0.0, max_circ_defect=0.0, max_eig_vs_modes=0.0)
lp = models['T2_pm60_lat1']
for i in range(0, NG, 7):
    fr = Fraction(2 * i + 1, 2 * NG)
    C = corr.C_exact(fr, 0, loop=lp)
    chk['max_cross'] = max(chk['max_cross'], float(np.max(np.abs(C[0, 1:])) + np.max(np.abs(C[1:, 0]))))
    chk['max_circ_defect'] = max(chk['max_circ_defect'], corr.circulant_defect(C[1:, 1:]) * float(np.max(np.abs(C[1:, 1:]))))  # absolute
    ev = np.linalg.eigvals(C[1:, 1:])
    md = LAM[MAPS.index(('T2_pm60_lat1_D0', 'T2_pm60_lat1', 0)), i]
    dmax = max(float(np.min(np.abs(md - e))) for e in ev)          # nearest-mode matching
    chk['max_eig_vs_modes'] = max(chk['max_eig_vs_modes'], dmax)
    chk['max_abs_C'] = max(chk.get('max_abs_C', 0.0), float(np.max(np.abs(C))))
print("full-matrix check:", chk)


# ---------------- summaries ----------------
def intervals(mask, x):
    """contiguous True runs of mask -> list of [x_start, x_end] (grid points)."""
    if not mask.any():
        return []
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    st, en = np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1
    return [[float(x[s]), float(x[e])] for s, e in zip(st, en)]


# fine 1-D curves (exact closed forms): GOS vs sawtooth line frequency beta, PHOS modes vs alpha (0..0.5)
NB = 2048
BETA = (2 * np.arange(NB) + 1) / (4 * NB)          # (0, 0.5)
QB = 4 * NB
rB = np.arange(1, QB)
wB = 1.0 / (4 * QB ** 2 * np.sin(np.pi * rB / QB) ** 2)
NZ = 400
QZ = 1 << 18
fz_target = np.geomspace(0.5e6, 500e6, NZ)
kz = np.round((fz_target / F_REF * QZ - 1) / 2).astype(int)
AZ_num = np.unique(2 * kz + 1)                       # odd numerators -> period exactly 2^18 (8 | Q)
AZ = AZ_num / QZ
NZ = len(AZ)
GZ = None
EPS_REL = 1e-3      # |value| < EPS_REL * (value for H_PD == 1) -> 'dead' (>1000x slower than ideal)
LAM_IDEAL, GOS_IDEAL = 1 / 8, 1 / 12

out = dict(
    description=("Sign maps of the mean dynamics of the sign-error LMS loops (GOS = DTC gain, PHOS = 8 PMUX "
                 "phase offsets) in a fractional-N SSPLL. Values are the eigenvalues of the regressor "
                 "correlation matrix C (time-averaged x_i[n-D] (h_PD * x_j)[n]); the mean update is "
                 "delta_{k+1} = (I - mu K_q C) delta_k, so Re(eig) < 0 => that mode diverges (sign flip)."),
    units=dict(alpha="fraction of FCW (VCO periods per ref cycle); f_offset = alpha*f_ref",
               C_gos="dimensionless (rho in units of T_vco/8); multiply by K_q*(T_vco/8)^2 for physical gain",
               lam="eigenvalues of the 8x8 PHOS matrix; lam_0 = 0 (common mode, unobservable)"),
    f_ref_Hz=F_REF, f_bw_Hz=corr.F_BW,
    grid=dict(alpha="(2i+1)/4096, i=0..2047 (period Q=4096 for every point, 8|Q -> exact circulant)",
              beta_curve="beta_j=(2j+1)/8192 in (0,0.5): GOS vs sawtooth line frequency beta*f_ref",
              alpha_zoom="odd/2^18 near geomspace(0.5,500 MHz)/f_ref: exact PHOS modes (DFT, period 2^18)"),
    conventions=dict(
        rho="rho[n] = frac(8 n alpha) = DTC residue in units of T_vco/8 (non-negative; mean drops out since H_PD(1)=0)",
        x_k="x_k[n] = 1{floor(8 frac(n alpha)) = k}",
        D="correlator code delay: G_i = mean q[n] x_i[n-D]; D=0 is aligned (h_PD[0]=1 direct feed-through)",
        lam_m="lam_m = v_m^H C v_m with v_m[k] = e^{j2pi m k/8}/sqrt(8) (eigenvalues when C is circulant)",
        inverted="value < -1e-10"),
    alpha=np.round(ALPHA, 9).tolist(),
    beta_curve=np.round(BETA, 9).tolist(),
    alpha_zoom=np.round(AZ, 12).tolist(), offset_zoom_MHz=np.round(AZ * F_REF / 1e6, 6).tolist(),
    full_matrix_check=chk,
    timing_s=dict(exact=t_exact, harmonic=t_harm),
    models={k: {kk: (v if not isinstance(v, np.ndarray) else v.tolist()) for kk, v in lp.params.items()
                if kk in ('type', 'K', 'Kp', 'Ki', 'r', 'lat', 'f_pole', 'f3dB_Hz', 'fc_Hz', 'PM_deg', 'peaking_dB',
                          'ReH_negative_bands_MHz', 'ReH_min', 'ReH_min_at_MHz', 'S_inf', 'max_pole_mag')}
            | dict(bL=lp.bL.tolist(), aL=lp.aL.tolist()) for k, lp in models.items()},
    maps={},
)


def r5(x):
    return [float(f"{v:.5g}") for v in np.asarray(x, float)]


for j, (mid, k, D) in enumerate(MAPS):
    lp = models[k]
    cg = C_gos[j]
    lam = LAM[j]
    re = lam.real
    # numerical sanity: exact vs harmonic
    err_g = float(np.max(np.abs(cg - C_gos_h[j])))
    err_l = float(np.max(np.abs(lam - LAM_h[j])))
    joint_min = np.minimum(cg, np.min(re[:, 1:], axis=1))
    # 1-D curves
    Gb = np.real(lp.Gamma(np.arange(QB) / QB, D))
    gos_beta = np.array([np.sum(Gb[(rB * (2 * jj + 1)) % QB] * wB) for jj in range(NB)])
    # exact closed form (corr.phos_modes_rational) with Gamma pre-tabulated on the Q-grid
    Gz = lp.Gamma(np.arange(QZ) / QZ, D)
    lamz = np.zeros((NZ, 8), complex)
    for m in range(1, 8):
        kk = np.arange(m, QZ, 8)
        wk = 8 * math.sin(math.pi * m / 8) ** 2 / QZ ** 2 / np.sin(np.pi * kk / QZ) ** 2
        for ii, num in enumerate(AZ_num):
            lamz[ii, m] = np.sum(Gz[(kk * int(num)) % QZ] * wk)
    inv = lambda v: v < -TOL
    sig_g = lambda v: v < -EPS_REL * GOS_IDEAL
    sig_l = lambda v: v < -EPS_REL * LAM_IDEAL
    dead_g = lambda v: np.abs(v) <= EPS_REL * GOS_IDEAL
    dead_l = lambda v: np.abs(v) <= EPS_REL * LAM_IDEAL
    half = ALPHA < 0.5
    summ = dict(
        model=k, D=D, max_abs_err_exact_vs_harmonic=dict(C_gos=err_g, lam=err_l),
        n_points=NG,
        frac_alpha_inverted=dict(
            gos=float(np.mean(inv(cg))),
            **{f"phos_m{m}": float(np.mean(inv(re[:, m]))) for m in range(1, 5)},
            any=float(np.mean(inv(joint_min)))),
        gos_inverted_alpha_intervals=intervals(inv(cg), ALPHA),
        gos_inverted_beta_MHz_intervals=intervals(inv(gos_beta), BETA * F_REF / 1e6),
        significant_inversion=dict(
            rule=f"value < -{EPS_REL} x ideal (ideal: C_gos=1/12, lam=1/8 for H_PD==1)",
            gos_beta_MHz=intervals(sig_g(gos_beta), BETA * F_REF / 1e6),
            **{f"phos_m{m}_offset_MHz": intervals(sig_l(lamz[:, m].real), AZ * F_REF / 1e6) for m in range(1, 5)},
            frac_alpha=dict(gos=float(np.mean(sig_g(cg))),
                            **{f"phos_m{m}": float(np.mean(sig_l(re[:, m]))) for m in range(1, 5)})),
        dead_zone=dict(
            rule=f"|value| <= {EPS_REL} x ideal",
            gos_beta_MHz=intervals(dead_g(gos_beta), BETA * F_REF / 1e6),
            **{f"phos_m{m}_offset_MHz": intervals(dead_l(lamz[:, m].real), AZ * F_REF / 1e6) for m in range(1, 5)}),
        gos_min=float(cg.min()), gos_min_at_alpha=float(ALPHA[np.argmin(cg)]),
        gos_beta_min=float(gos_beta.min()), gos_beta_min_at_MHz=float(BETA[np.argmin(gos_beta)] * F_REF / 1e6),
        phos_inverted_offset_MHz_intervals={
            f"m{m}": intervals(inv(lamz[:, m].real), AZ * F_REF / 1e6) for m in range(1, 5)},
        phos_inverted_alpha_intervals_halfrange={
            f"m{m}": intervals(inv(re[half, m]), ALPHA[half]) for m in range(1, 5)},
        phos_min={f"m{m}": float(re[:, m].min()) for m in range(1, 5)},
        phos_min_at_offset_MHz={f"m{m}": float(AZ[np.argmin(lamz[:, m].real)] * F_REF / 1e6) for m in range(1, 5)},
        phos_max={f"m{m}": float(re[:, m].max()) for m in range(1, 5)},
    )
    out['maps'][mid] = dict(
        summary=summ,
        C_gos=r5(cg),
        re_lam=[r5(re[:, m]) for m in range(1, 5)],         # m=1..4 (Re lam_{8-m} = Re lam_m)
        im_lam=[r5(lam.imag[:, m]) for m in range(1, 4)],   # m=1..3 (Im lam_{8-m} = -Im lam_m, Im lam_4 = 0)
        joint_min_re=r5(joint_min),
        gos_vs_beta=r5(gos_beta),
        lam_zoom_re=[r5(lamz[:, m].real) for m in range(1, 5)],
    )
    print(f"{mid:28s} err(ex-h) gos={err_g:.1e} lam={err_l:.1e} | inverted frac: gos={summ['frac_alpha_inverted']['gos']:.3f} "
          f"m1={summ['frac_alpha_inverted']['phos_m1']:.3f} m2={summ['frac_alpha_inverted']['phos_m2']:.3f} "
          f"m3={summ['frac_alpha_inverted']['phos_m3']:.3f} m4={summ['frac_alpha_inverted']['phos_m4']:.3f}")
    print(f"     GOS inv beta(MHz)={[[round(a,1),round(b,1)] for a,b in summ['gos_inverted_beta_MHz_intervals']]}")
    si, dz = summ['significant_inversion'], summ['dead_zone']
    print(f"     GOS significant inv beta(MHz)={[[round(a,1),round(b,1)] for a,b in si['gos_beta_MHz']]}  dead={[[round(a,1),round(b,1)] for a,b in dz['gos_beta_MHz']]}")
    for m in range(1, 5):
        iv = si[f'phos_m{m}_offset_MHz']
        print(f"     PHOS m{m} signif. inv offset(MHz)={[[round(a,2),round(b,2)] for a,b in iv]} dead={[[round(a,2),round(b,2)] for a,b in dz[f'phos_m{m}_offset_MHz']]} min={summ['phos_min'][f'm{m}']:.4g}")

# ---------------- exact rational table (small Q, incl. 8 not dividing Q) ----------------
rat = []
fare = sorted({Fraction(P, Q) for Q in range(1, 25) for P in range(0, Q)})
for k in ('T1_lat1', 'T2_pm60_lat1'):
    lp = models[k]
    for a in fare:
        C = corr.C_exact(a, 0, loop=lp)
        visited = int(np.sum(np.diag(corr.C_exact(a, 0, h=np.array([1.0]))[1:, 1:]) > 0))
        evp = np.linalg.eigvals(C[1:, 1:])
        evj = np.linalg.eigvals(C)
        sc = max(np.max(np.abs(evj)), 1e-300)
        nzj = evj[np.abs(evj) > 1e-9 * sc]
        modes = corr.phos_modes_from_C(C[1:, 1:])
        rat.append(dict(model=k, alpha=str(a), Q=a.denominator, phases_visited=visited,
                        C_gos=float(C[0, 0]), cross_norm=float(np.linalg.norm(C[0, 1:]) + np.linalg.norm(C[1:, 0])),
                        circ_defect=corr.circulant_defect(C[1:, 1:]),
                        n_zero_eigs_joint=int(len(evj) - len(nzj)),
                        min_re_eig_joint_nonzero=float(nzj.real.min()) if len(nzj) else 0.0,
                        min_re_dft_mode_diag=float(modes.real[1:].min()),
                        eig_joint=[[float(z.real), float(z.imag)] for z in evj]))
out['rational_small_Q'] = rat
out['runtime_s'] = time.time() - t0
(HERE / 'sign_maps.json').write_text(json.dumps(out, separators=(',', ':')))
print(f"wrote sign_maps.json  ({(HERE/'sign_maps.json').stat().st_size/1e6:.2f} MB, {out['runtime_s']:.1f} s)")
