"""
make_figs.py -- static figures for README.md (reads sign_maps.json; recomputes Re H_PD from corr.py).
fig_ReH.png, fig_phos_modes.png, fig_gos_beta.png, fig_signmap.png
"""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corr  # noqa: E402

SURF, INK, INK2, GRID = '#fcfcfb', '#0b0b0b', '#52514e', '#e4e3df'
S = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']          # validated categorical slots 1-4 (light)
DIV = LinearSegmentedColormap.from_list('div', ['#e34948', '#f0efec', '#2a78d6'])   # red (inverted) - gray - blue (ok)

plt.rcParams.update({
    'figure.facecolor': SURF, 'axes.facecolor': SURF, 'savefig.facecolor': SURF,
    'axes.edgecolor': GRID, 'axes.labelcolor': INK2, 'xtick.color': INK2, 'ytick.color': INK2,
    'text.color': INK, 'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': 0.8, 'grid.linestyle': '-',
    'axes.spines.top': False, 'axes.spines.right': False, 'font.size': 9, 'axes.titlesize': 10,
    'axes.titleweight': 'bold', 'legend.frameon': False, 'lines.linewidth': 1.6,
    'lines.solid_capstyle': 'round', 'lines.solid_joinstyle': 'round'})

d = json.loads((HERE / 'sign_maps.json').read_text())
F_REF = d['f_ref_Hz']
models = corr.standard_models()

# ---------- 1. Re H_PD ----------
fig, ax = plt.subplots(figsize=(7.2, 3.6))
f = np.geomspace(1e6, 2e9, 2000)
for c, (k, lab) in zip(S, [('T1_lat1', 'Type-I (lat 1)'), ('T2_pm45_lat1', 'Type-II PM 45°'),
                           ('T2_pm60_lat1', 'Type-II PM 60°'), ('CP_pm55', 'CPPLL PM 55° (imp.-inv.)')]):
    ax.plot(f / 1e6, np.real(models[k].H(f / F_REF)), color=c, label=lab)
ax.axhline(0, color=INK2, lw=0.9)
ax.set_xscale('log')
ax.set_xlabel('frequency [MHz]  (f_ref = 4 GHz, closed-loop BW = 320 MHz)')
ax.set_ylabel(r'Re $H_{PD}(e^{j2\pi f/f_{ref}})$')
ax.set_title('Re H_PD: the sign of the LMS gain for a single spectral line')
ax.legend(loc='upper left', ncol=2)
fig.tight_layout()
fig.savefig(HERE / 'fig_ReH.png', dpi=150)
plt.close(fig)

# ---------- 2. PHOS modes vs offset (small multiples) ----------
fz = np.array(d['offset_zoom_MHz'])
panels = [('T1_lat1_D0', 'Type-I (lat 1)'), ('T2_pm45_lat1_D0', 'Type-II PM 45°'),
          ('T2_pm60_lat1_D0', 'Type-II PM 60°'), ('CP_pm55_D0', 'CPPLL PM 55°')]
fig, axs = plt.subplots(2, 2, figsize=(8.4, 5.6), sharex=True, sharey=True)
for ax, (mid, ttl) in zip(axs.flat, panels):
    mp = d['maps'][mid]
    for m in range(4):
        ax.plot(fz, 8 * np.array(mp['lam_zoom_re'][m]), color=S[m], label=f'mode m={m+1}' + (' (& 7)' if m == 0 else f' (& {7-m})' if m < 3 else ''))
    ax.axhline(0, color=INK2, lw=0.9)
    ax.set_xscale('log')
    ax.set_title(ttl)
    ax.set_ylim(-0.4, 1.3)
fig.supxlabel(r'PMUX fundamental  $\alpha f_{ref}$ [MHz]  (distance of the FCW from an integer)', color=INK2, fontsize=9)
for ax in axs[:, 0]:
    ax.set_ylabel(r'$8\,\mathrm{Re}\,\lambda_m$  (1 = ideal, $H_{PD}\equiv1$)')
axs[0, 0].legend(loc='upper left')
fig.suptitle('PHOS eigen-modes, D = 0: negative = LMS mode diverges', fontweight='bold', color=INK)
fig.tight_layout()
fig.savefig(HERE / 'fig_phos_modes.png', dpi=150)
plt.close(fig)

# ---------- 3. GOS vs sawtooth line frequency ----------
fb = np.array(d['beta_curve']) * F_REF / 1e6
fig, axs = plt.subplots(1, 2, figsize=(8.4, 3.4), sharey=True)
for ax, base, ttl in [(axs[0], 'T1_lat1', 'Type-I (lat 1)'), (axs[1], 'T2_pm60_lat1', 'Type-II PM 60°')]:
    for c, D in zip(S, (0, 1, -1, 2)):
        mid = f"{base}_D0" if D == 0 else f"{base}_D{'p' if D > 0 else 'm'}{abs(D)}"
        ax.plot(fb, 12 * np.array(d['maps'][mid]['gos_vs_beta']), color=c, label=('D = 0' if D == 0 else f'D = {D:+d}'))
    ax.axhline(0, color=INK2, lw=0.9)
    ax.set_xscale('log')
    ax.set_title(ttl)
    ax.set_xlabel(r'DTC-residue sawtooth line  $\beta f_{ref}$ [MHz],  $\beta=\|8\alpha\|$')
axs[0].set_ylabel(r'$12\,C_{GOS}$  (1 = ideal)')
axs[0].legend(loc='lower left')
fig.suptitle('GOS (DTC gain) loop gain vs correlator delay D', fontweight='bold', color=INK)
fig.tight_layout()
fig.savefig(HERE / 'fig_gos_beta.png', dpi=150)
plt.close(fig)

# ---------- 4. sign map strips over alpha ----------
A = np.array(d['alpha'])
rows = ['GOS', 'PHOS m1', 'PHOS m2', 'PHOS m3', 'PHOS m4']
pan = [('T1_lat1_D0', 'Type-I lat 1, D = 0'), ('T2_pm60_lat1_D0', 'Type-II PM 60°, D = 0'),
       ('CP_pm55_D0', 'CPPLL PM 55°, D = 0'), ('T2_pm60_lat1_Dp1', 'Type-II PM 60°, D = +1')]
fig, axs = plt.subplots(len(pan), 1, figsize=(8.4, 6.4), sharex=True)
VC = 0.15
for ax, (mid, ttl) in zip(axs, pan):
    mp = d['maps'][mid]
    Z = np.vstack([12 * np.array(mp['C_gos'])] + [8 * np.array(mp['re_lam'][m]) for m in range(4)])
    im = ax.imshow(Z, aspect='auto', cmap=DIV, vmin=-VC, vmax=VC, extent=[0, 1, len(rows) - 0.5, -0.5],
                   interpolation='nearest')
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels(rows)
    ax.set_title(ttl, loc='left')
    ax.grid(False)
axs[-1].set_xlabel(r'fractional FCW  $\alpha$')
cb = fig.colorbar(im, ax=axs, shrink=0.8, pad=0.02)
cb.set_label('normalised gain (clipped at ±0.15)\nred < 0: inverted   blue > 0: converges', color=INK2)
fig.suptitle('Sign map over α ∈ [0,1): GOS (12·C) and PHOS modes (8·Re λ)', fontweight='bold', color=INK)
fig.savefig(HERE / 'fig_signmap.png', dpi=150, bbox_inches='tight')
plt.close(fig)
print('figures written')
