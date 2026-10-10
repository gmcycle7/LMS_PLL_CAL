#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Figures for README.md, drawn ONLY from results.json (no recomputation).
Palette: reference categorical slots 1-3 (blue / orange / aqua), validated all-pairs."""
import json
import os
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
FN = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else 'results.json')
R = json.load(open(FN))
OUT = os.path.join(HERE, 'fig')
os.makedirs(OUT, exist_ok=True)

C = dict(s1='#2a78d6', s2='#eb6834', s3='#1baf7a', s4='#eda100', s5='#e87ba4', s6='#008300',
         grid='#e4e3df', axis='#8c8b86', text='#0b0b0b', text2='#52514e', surface='#fcfcfb',
         zero='#52514e')
plt.rcParams.update({
    'figure.facecolor': C['surface'], 'axes.facecolor': C['surface'], 'savefig.facecolor': C['surface'],
    'axes.edgecolor': C['axis'], 'axes.linewidth': 0.8, 'axes.grid': True, 'grid.color': C['grid'],
    'grid.linewidth': 0.8, 'grid.linestyle': '-', 'axes.spines.top': False, 'axes.spines.right': False,
    'xtick.color': C['text2'], 'ytick.color': C['text2'], 'axes.labelcolor': C['text2'],
    'axes.titlecolor': C['text'], 'axes.titlesize': 11, 'axes.labelsize': 9.5, 'xtick.labelsize': 8.5,
    'ytick.labelsize': 8.5, 'legend.fontsize': 8.5, 'legend.frameon': False, 'lines.linewidth': 2.0,
    'lines.solid_capstyle': 'round', 'font.family': 'DejaVu Sans'})
LOOPS = [('L1', 'Type-I SSPLL (L1)', C['s1']), ('L2_pm60', 'Type-II SSPLL, PM 60° (L2)', C['s2']),
         ('L3_imp_pm60', 'CPPLL, impulse-invariant (L3)', C['s3'])]


def arr(x):
    return np.array([np.nan if v is None else v for v in x], float)


# 1. measured Re{H_PD}
fig, ax = plt.subplots(figsize=(7.2, 3.6))
for key, lab, col in LOOPS:
    v = R['loops'][key]['td_verify']
    f = np.array(v['freq_Hz']) / 1e6
    ax.semilogx(f, v['ReH_td'], color=col, label=lab)
ax.axhline(0, color=C['zero'], lw=1)
ax.axvline(320, color=C['axis'], lw=1)
ax.text(330, ax.get_ylim()[1] * 0.92, '320 MHz', color=C['text2'], fontsize=8.5, va='top')
ax.set_xlabel('frequency (MHz)')
ax.set_ylabel(r'Re$\{H_{PD}\}$  (time-domain lock-in)')
ax.set_title(r'Measured Re$\{H_{PD}(e^{j\omega})\}$: negative band = where LMS sees an inverted sign', loc='left')
ax.legend(loc='lower right')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig1_ReH_td.png'), dpi=150)
plt.close(fig)

# 2. keep-out map: PHOS and GOS normalised slopes vs alpha (small signal) + large-signal worst direction
fig, axs = plt.subplots(3, 1, figsize=(7.2, 8.4), sharex=True)
for key, lab, col in LOOPS:
    f = R['fine'][key]
    a = np.array(f['alpha'])
    pref = np.abs(arr(f['open_loop_H1']['phos_min_re']))
    gref = np.abs(arr(f['open_loop_H1']['mS_gg']))
    p = arr(f['variants']['raw']['erf']['phos_min_re']) / pref
    g = arr(f['variants']['raw']['erf']['mS_gg']) / gref
    axs[0].plot(a, np.clip(p, -0.5, 1.5), color=col, lw=1.3, label=lab)
    axs[1].plot(a, g, color=col, lw=1.3, label=lab)
    if 'large_signal_fine' in R and key in R['large_signal_fine']:
        r = R['large_signal_fine'][key]
        gl = np.array([[[np.nan if v is None else v for v in r2] for r2 in r1] for r1 in r['g']['raw']['erf']], float)
        go = np.abs(np.array([[[np.nan if v is None else v for v in r2] for r2 in r1] for r1 in r['g_open_loop']['erf']], float))
        ia = r['amps_ps'].index(1.0)
        gn = np.where(go > 1e-6 * np.nanmax(go), gl / go, np.nan)[:, :, ia]
        axs[2].plot(np.array(r['alphas']), np.nanmin(gn, axis=1), color=col, lw=1.3, label=lab)
for ax in axs:
    ax.axhline(0, color=C['zero'], lw=1)
axs[0].set_ylabel('PHOS min Re eig$(-S)$\n/ ($H\\equiv1$), small signal')
axs[1].set_ylabel('GOS $-S_{gg}$ / ($H\\equiv1$)\nsmall signal')
axs[2].set_ylabel('worst DFT direction\nsecant slope, $A$=1 ps')
axs[2].set_xlabel(r'fractional FCW  $\alpha$')
axs[0].set_title('Averaged sign-LMS slope (time-domain, LMS frozen); < 0 = diverges', loc='left')
axs[0].legend(loc='upper center', bbox_to_anchor=(0.5, -0.02), ncol=3, fontsize=7.5)
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig2_keepout_raw.png'), dpi=150)
plt.close(fig)

# 3. zoom near-integer for PHOS incl. remedies (L2)
fig, axs = plt.subplots(1, 2, figsize=(9.0, 3.6), sharey=False)
for ax, key, ttl in ((axs[0], 'L2_pm60', 'Type-II SSPLL (L2, PM 60°)'),
                     (axs[1], 'L3_imp_pm60', 'CPPLL (L3, impulse-invariant)')):
    f = R['fine'][key]
    a = np.array(f['alpha'])
    ref = np.nanmedian(np.abs(arr(f['open_loop_H1']['phos_min_re'])))
    sel = a <= 0.06
    for v, lab, col in (('raw', 'raw indicator', C['s2']), ('fx:exact', r'filtered-x, exact $\hat H$', C['s1']),
                        ('fx:bw0.8', r'filtered-x, $\hat H$ BW $-20\%$', C['s3']),
                        ('1diff', r'$x[n]-x[n-1]$', C['s4']), ('2diff', r'$x[n]-2x[n-1]+x[n-2]$', C['s5'])):
        if v not in f['variants']:
            continue
        y = arr(f['variants'][v]['erf']['phos_min_re']) / ref
        ax.plot(a[sel], y[sel], color=col, lw=1.6, label=lab)
    ax.axhline(0, color=C['zero'], lw=1)
    ax.set_title(ttl, loc='left')
    ax.set_xlabel(r'$\alpha$ (near-integer)')
axs[0].set_ylabel(r'PHOS min Re eig$(-S)$ / ($H\equiv1$)')
axs[1].legend(loc='lower right', fontsize=7.5)
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig3_phos_nearint_remedies.png'), dpi=150)
plt.close(fig)

# 4. closed-loop LMS trajectories
fig, axs = plt.subplots(1, 3, figsize=(10.5, 3.6), sharey=True)
for ax, (key, ttl) in zip(axs, (('L1', 'Type-I (L1)'), ('L2_pm60', 'Type-II (L2)'), ('L3_imp_pm60', 'CPPLL (L3)'))):
    L = R['lms']['%s|acc1' % key]
    Lm = R['lms']['%s|mash' % key]
    b = np.array(L['block'])
    for lane, lab, col, src in (('0.01|raw', r'$\alpha$=0.01 raw', C['s2'], L),
                                ('0.03|raw', r'$\alpha$=0.03 raw', C['s5'], L),
                                ('0.01|fx:exact', r'$\alpha$=0.01 filtered-x', C['s1'], L),
                                ('0.01|1diff', r'$\alpha$=0.01 $x[n]-x[n-1]$', C['s4'], L),
                                ('0.01|raw', r'$\alpha$=0.01 MASH-1-1-1', C['s3'], Lm),
                                ('0.137|raw', r'$\alpha$=0.137 raw', C['s6'], L)):
        if lane not in src['lanes']:
            continue
        ax.semilogy(np.array(src['block']), src['lanes'][lane]['phos_err_rms_fs'], color=col, lw=1.4, label=lab)
    ax.set_title(ttl, loc='left')
    ax.set_xlabel('LMS block (512 samples)')
axs[0].set_ylabel('PHOS residual, rms over 8 phases (fs)')
axs[2].legend(loc='lower left', fontsize=7.2)
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig4_lms_phos.png'), dpi=150)
plt.close(fig)
print('figures written to', OUT)

# 5. large-signal secant slopes vs amplitude (worst DFT direction)
def nz(x):
    return np.array([[[np.nan if v is None else v for v in r2] for r2 in r1] for r1 in x], float)


fig, axs = plt.subplots(1, 3, figsize=(10.5, 3.6), sharey=True)
sig = R['config']['sigma_v_ps']
for ax, (key, ttl) in zip(axs, (('L1', 'Type-I (L1)'), ('L2_pm60', 'Type-II (L2)'), ('L3_imp_pm60', 'CPPLL (L3)'))):
    r = R['large_signal'][key]
    amps = np.array(r['amps_ps']) / sig
    go = np.abs(nz(r['g_open_loop']['erf']))
    al = r['alphas']
    for a, vn, lab, col in ((0.002, 'raw', r'$\alpha$=0.002 raw', C['s1']), (0.021, 'raw', r'$\alpha$=0.021 raw', C['s2']),
                            (0.496, 'raw', r'$\alpha$=0.496 raw', C['s3']),
                            (0.021, '1diff', r'$\alpha$=0.021 $x[n]-x[n-1]$', C['s4']),
                            (0.021, 'fx:exact', r'$\alpha$=0.021 filtered-x', C['s5'])):
        ai = int(np.argmin(np.abs(np.array(al) - a)))
        g = nz(r['g'][vn]['erf'])[ai] / go[ai]
        g = np.where(go[ai] > 1e-9, g, np.nan)
        ax.semilogx(amps, np.nanmin(g, axis=0), color=col, lw=1.6, marker='o', ms=3.5, label=lab)
    ax.axhline(0, color=C['zero'], lw=1)
    ax.set_title(ttl, loc='left')
    ax.set_xlabel(r'perturbation amplitude $A/\sigma_v$')
axs[0].set_ylabel('worst-direction secant slope / ($H\\equiv1$)')
axs[2].legend(loc='lower left', fontsize=7.2)
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig5_large_signal.png'), dpi=150)
plt.close(fig)

# 6. LMS started at the calibrated point (Type-II): raw vs first-difference regressor
if 'lms_extra' in R:
    fig, axs = plt.subplots(1, 2, figsize=(9.0, 3.6), sharey=True)
    L = R['lms_extra']['L2_pm60|from_cal']
    b = np.array(L['block'])
    for ax, vn, ttl in ((axs[0], 'raw', 'Type-II (L2): raw regressor'), (axs[1], '1diff', r'Type-II (L2): $x[n]-x[n-1]$')):
        for a, col in ((0.002, C['s1']), (0.021, C['s2']), (0.253, C['s3']), (0.496, C['s4'])):
            ax.semilogy(b, L['lanes']['%.6g|%s' % (a, vn)]['phos_err_rms_fs'], color=col, lw=1.4,
                        label=r'$\alpha$=%g' % a)
        ax.set_title(ttl, loc='left')
        ax.set_xlabel('LMS block (512 samples)')
    axs[0].set_ylabel('PHOS residual, rms (fs)')
    axs[1].legend(loc='upper right')
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'fig6_lms_from_calibrated.png'), dpi=150)
    plt.close(fig)
print('figures 5-6 written')
