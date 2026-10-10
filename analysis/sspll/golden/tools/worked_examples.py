#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hand-calculation style worked examples quoted in the teaching document (every number printed here).
Run from analysis/sspll/golden:  python3 tools/worked_examples.py  -> results/worked_examples.json"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from sspll_golden.loops import nominal_loops, typeII_f_inv  # noqa: E402
from sspll_golden.predictions import C_periodic, gamma_eff, gos_harmonic, phos_lambda_harmonic  # noqa: E402
from sspll_golden.regressors import W1, seq_rational  # noqa: E402

OUT = {}


def show(k, v):
    OUT[k] = v
    print(f'{k}: {v}')


L = nominal_loops()
L1, L2, L3 = L['L1'], L['L2'], L['L3']
Kp, Ki, K = L2.params['Kp'], L2.params['Ki'], L1.params['K']

# (a) Re H of L2 at 83.8 MHz, step by step
f_MHz = 83.8
f = f_MHz / 4000
W = 2 * math.pi * f
s2 = math.sin(W / 2) ** 2
ReL = -Kp / 2 - Ki / (4 * s2)
Lc = complex(L2.L(f))
show('a_Omega', W)
show('a_sin2', s2)
show('a_ReL_closed', ReL)
show('a_L_complex', [Lc.real, Lc.imag])
show('a_abs_1plusL_sq', abs(1 + Lc) ** 2)
show('a_ReH', (1 + Lc.real) / abs(1 + Lc) ** 2)
show('a_ReH_direct', float(L2.H(f).real))
# (b) band edge
x = Ki / (2 * (2 - Kp))
show('b_ratio', x)
show('b_sqrt', math.sqrt(x))
show('b_asin', math.asin(math.sqrt(x)))
show('b_f_inv_MHz', typeII_f_inv(Kp, Ki) * 4000)
# (c) PHOS mode 1 at alpha = 21/1000
a = 0.021
ReH_a = float(L2.H(a).real)
lam = phos_lambda_harmonic(a, gamma_eff(L2))
show('c_ReH_84MHz', ReH_a)
show('c_W1_ReH', W1 * ReH_a)
show('c_8Relam1', float(8 * lam[1].real))
show('c_rest', float(8 * lam[1].real - W1 * ReH_a))
ell = np.array([1, -7, 9, -15, 17])
w = 64 * np.sin(np.pi * ell / 8) ** 2 / (np.pi * ell) ** 2
show('c_lines', [dict(l=int(l), f_MHz=float((l * a % 1) * 4000), w=float(wi), ReH=float(L2.H((l * a) % 1).real))
                 for l, wi in zip(ell, w)])
show('c_8lam_all', [float(8 * lam[m].real) for m in range(1, 8)])
# (d) GOS at alpha = 0.137: beta = frac(8 alpha)
a = 0.137
beta = (8 * a) % 1
show('d_beta', beta)
terms = []
for m in range(1, 6):
    fm = (m * beta) % 1
    terms.append(dict(m=m, f_MHz=float(min(fm, 1 - fm) * 4000), w=1 / (2 * math.pi ** 2 * m ** 2), ReH=float(L2.H(fm).real),
                      contrib=float(L2.H(fm).real / (2 * math.pi ** 2 * m ** 2))))
show('d_terms', terms)
show('d_partial5_12C', 12 * sum(t['contrib'] for t in terms))
show('d_12C', 12 * gos_harmonic(a, gamma_eff(L2)))
# (e) toy scalar sign-error LMS with H == 1 and H == -0.2 (one-tap model of an inverted kernel)
mu, a_true = 0.1, 1.0
for tag, h in (('H=+1', 1.0), ('H=-0.2', -0.2)):
    wv = 0.0
    hist = [wv]
    for n in range(4):
        x = 1.0
        e = h * (a_true - wv) * x
        q = np.sign(e)
        wv = wv + mu * q * x
        hist.append(round(wv, 4))
    show(f'e_{tag}', hist)
# (f) derivative intuition at 20 MHz
fx = 20 / 4000
W = 2 * math.pi * fx
show('f_corr_x_d1', (1 - math.cos(W)) / 2)                 # <x[n](x[n]-x[n-1])>
show('f_corr_x_d2c', math.cos(W) - 1)                       # <x[n](x[n+1]-2x[n]+x[n-1])>
show('f_ReH_L2_20MHz', float(L2.H(fx).real))
show('f_minusW2_over_Ki', -W ** 2 / Ki)
show('f_ReH_L1_20MHz', float(L1.H(fx).real))
show('f_typeI_lowf', (2 - K) * W ** 2 / (2 * K ** 2))
# (g) Bussgang gain
sig = 200.0
show('g_Kq_per_fs', math.sqrt(2 / math.pi) / sig)
# (h) sawtooth weights
m = np.arange(1, 6)
show('h_weights', (1 / (2 * math.pi ** 2 * m ** 2)).tolist())
show('h_sum_first5', float(np.sum(1 / (2 * math.pi ** 2 * m ** 2))))
# (i) a few samples of the regressors at alpha = 0.137 (and 21/1000)
c, p = seq_rational(137, 1000, np.arange(10))
show('i_rho_0137', [round(float(v), 3) for v in c])
show('i_p_0137', p.tolist())
c, p = seq_rational(21, 1000, np.arange(0, 60, 6))
show('i_rho_0021_every6', [round(float(v), 3) for v in c])
show('i_p_0021_every6', p.tolist())
# (j) impulse response of H_PD (first samples)
for k_, lp in L.items():
    show(f'j_hPD_{k_}', [round(float(v), 5) for v in lp.impulse(6)])
# (k) GOS-PHOS block at alpha = 1/50 (8 does not divide 50)
C = C_periodic(1, 50, gamma_eff(L2))
show('k_C00', float(C[0, 0]))
show('k_max_cross', float(np.abs(C[0, 1:]).max()))
with open(os.path.join(ROOT, 'results', 'worked_examples.json'), 'w') as fh:
    json.dump(OUT, fh, indent=1)

# (l) H_PD table for the document (figure described by data)
tab = {}
for fM in (1, 10, 20, 40, 60, 83.8, 100, 120, 134.82, 150, 200, 320, 500, 1000, 2000):
    f = fM / 4000
    row = {}
    for k_, lp in L.items():
        H = complex(lp.H(f))
        Lf = complex(lp.L(f))
        row[k_] = dict(ReH=round(H.real, 5), absH=round(abs(H), 4), absT=round(abs(Lf / (1 + Lf)), 4))
    tab[str(fM)] = row
show('l_hpd_table', tab)
# (m) low-frequency slopes of Re Gamma for raw / 1diff (log-log slope between f = 1e-4 and 1e-3)
sl = {}
for k_, lp in L.items():
    for v in ('raw', '1diff'):
        g = [float(np.real(gamma_eff(lp, v)(np.array([x])))[0]) for x in (1e-4, 1e-3)]
        sl[f'{k_}|{v}'] = dict(values=g, loglog_slope=math.log(abs(g[1]) / abs(g[0])) / math.log(10))
show('m_lowf_slopes', sl)
with open(os.path.join(ROOT, 'results', 'worked_examples.json'), 'w') as fh:
    json.dump(OUT, fh, indent=1)
