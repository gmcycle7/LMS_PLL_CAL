"""make_figures.py -- figures for README (needs loops_summary.json from run_analysis.py)."""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import loops as LP

# reference palette (dataviz skill, light mode): first three categorical slots
C = {"L1": "#2a78d6", "L2": "#eb6834", "L3": "#1baf7a"}
INK, INK2, MUTED, GRID, SURF = "#0b0b0b", "#52514e", "#8a8984", "#e4e3df", "#fcfcfb"
plt.rcParams.update({
    "figure.facecolor": SURF, "axes.facecolor": SURF, "savefig.facecolor": SURF,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.spines.top": False,
    "axes.spines.right": False, "font.size": 10, "legend.frameon": False, "lines.linewidth": 2,
    "text.color": INK,
})

nom = LP.nominal_models()
LBL = {"L1": "L1 SSPLL Type-I (D=1)", "L2": "L2 SSPLL Type-II (PM 60°)", "L3": "L3 CPPLL impulse (PM$_{ct}$ 60°)"}
f = np.geomspace(1e6, 2e9, 3000)

# ---------------------------------------------------------------- figure 1
fig, ax = plt.subplots(3, 1, figsize=(8.2, 9.2), sharex=True)
for k, lp in nom.items():
    H = lp.Hpd(f)
    T = lp.T(f)
    ax[0].semilogx(f / 1e6, H.real, color=C[k], label=LBL[k])
    ax[1].semilogx(f / 1e6, np.degrees(np.angle(H)), color=C[k], label=LBL[k])
    ax[2].semilogx(f / 1e6, 20 * np.log10(np.abs(T)), color=C[k], label=LBL[k])
    for b in LP.inversion_bands(lp):
        for a_ in ax:
            a_.axvline(b["f_hi_Hz"] / 1e6, color=C[k], lw=1, ls=(0, (4, 3)))
        ax[0].annotate(f"f_inv = {b['f_hi_Hz']/1e6:.1f} MHz", (b["f_hi_Hz"] / 1e6, -0.16 if k == "L2" else 0.78),
                       color=INK2, fontsize=8.5, ha=("left" if k == "L2" else "right"),
                       xytext=((4 if k == "L2" else -4), 0), textcoords="offset points")
ax[0].axhline(0, color=INK2, lw=1)
ax[0].set_ylabel(r"Re{$H_{PD}$}")
ax[0].set_title(r"PD-residual transfer $H_{PD}=1/(1+L)$, closed-loop $-3$ dB = 320 MHz, $f_{ref}$ = 4 GHz",
                fontsize=10.5, color=INK, loc="left")
ax[0].text(1.2, -0.17, r"Re{$H_{PD}$}<0 : LMS gradient sign inverted", color=INK2, fontsize=8.5)
ax[1].axhline(90, color=INK2, lw=1)
ax[1].axhline(180, color=MUTED, lw=0.8)
ax[1].set_ylabel(r"$\angle H_{PD}$ [deg]")
ax[1].set_yticks([0, 45, 90, 135, 180])
ax[2].axhline(0, color=INK2, lw=1)
ax[2].axhline(-3, color=MUTED, lw=0.8, ls=":")
ax[2].set_ylabel(r"$|T|$ [dB]")
ax[2].set_ylim(-12, 4)
ax[2].set_xlabel("frequency [MHz]  (sampled at f_ref = 4 GHz; Nyquist 2 GHz)")
ax[0].legend(loc="upper left", fontsize=8.5)
fig.tight_layout()
fig.savefig("fig_hpd.png", dpi=150)
plt.close(fig)

# ---------------------------------------------------------------- figure 2: Nyquist
fig, ax = plt.subplots(figsize=(6.6, 5.6))
W = np.geomspace(2 * np.pi * 20e6 / 4e9, np.pi, 4000)
for k, lp in nom.items():
    L = lp.Lw(W)
    ax.plot(L.real, L.imag, color=C[k], label=LBL[k])
ax.axvspan(-6, -1, color="#f0efec", zorder=0)
ax.axvline(-1, color=INK2, lw=1)
ax.axvline(-0.5, color=MUTED, lw=0.8, ls=":")
th = np.linspace(0, 2 * np.pi, 400)
ax.plot(1 + np.sqrt(2) * np.cos(th), np.sqrt(2) * np.sin(th), color=MUTED, lw=0.8, ls="--")
ax.plot([-1], [0], marker="+", color=INK, ms=10)
ax.text(-5.8, 0.6, r"Re{L} < -1  $\Leftrightarrow$  Re{$H_{PD}$} < 0", color=INK2, fontsize=9)
ax.text(0.15, -5.6, r"dotted: Re{L} = -1/2  ($|T|$ = 1)", color=MUTED, fontsize=8, ha="left")
ax.text(-0.15, -5.0, "L1: Re{L} = -K/2 (exact)", color=INK2, fontsize=8, rotation=90, ha="left")
ax.text(0.2, 1.55, r"$|T|=-3$ dB circle $|L-1|=\sqrt{2}$", color=MUTED, fontsize=8)
ax.set_xlim(-6, 3)
ax.set_ylim(-6, 2)
ax.set_aspect("equal")
ax.set_xlabel("Re{L}")
ax.set_ylabel("Im{L}")
ax.set_title("Nyquist plot of L (20 MHz to 2 GHz)", fontsize=10.5, loc="left")
ax.legend(loc="lower left", fontsize=8.5)
fig.tight_layout()
fig.savefig("fig_nyquist.png", dpi=150)
plt.close(fig)

# ---------------------------------------------------------------- figure 3: sweeps
S = json.load(open("loops_summary.json"))["sweeps"]
fig, ax = plt.subplots(1, 2, figsize=(10.5, 4.3))
pm = [d["PM_deg"] for d in S["L2_PM"]]
ax[0].plot(pm, [d["f_inv_dc_Hz"] / 1e6 for d in S["L2_PM"]], color=C["L2"], marker="o", ms=5, label="L2 Type-II SSPLL")
ok = [d for d in S["L3_PM_dt"] if "infeasible" not in d]
ax[0].plot([d["PM_deg"] for d in ok], [d["f_inv_dc_Hz"] / 1e6 for d in ok], color=C["L3"], marker="o", ms=5,
           label="L3 CPPLL impulse (PM in sampled domain)")
ok = [d for d in S["L3_PM_ct"] if "infeasible" not in d]
ax[0].plot([d["PM_deg"] for d in ok], [d["f_inv_dc_Hz"] / 1e6 for d in ok], color=C["L3"], marker="s", ms=4,
           ls=(0, (4, 2)), label="L3 CPPLL impulse (b from CT PM; x = actual PM)")
ax[0].plot(pm, [d["ct_samePM_f_inv_Hz"] / 1e6 for d in S["L2_PM"]], color=MUTED, ls=":",
           label="CT 2nd-order ref: f3dB/g(zeta(PM))")
ax[0].set_xlabel("phase margin of the sampled loop [deg]")
ax[0].set_ylabel("inversion band edge f_inv [MHz]  (band = 0 ... f_inv)")
ax[0].set_title("(a) band edge vs PM, D = 1", fontsize=10.5, loc="left")
ax[0].legend(fontsize=8)
lat = S["latency"]
for key, col, ls, lab in [("L2_PM60", C["L2"], "-", "L2 re-designed to PM 60°"),
                          ("L2_fixed_zeta", C["L2"], (0, (4, 2)), "L2 zeta fixed (PM drops)"),
                          ("L3_dtPM60", C["L3"], "-", "L3 re-designed to PM 60°"),
                          ("L3_fixed_b", C["L3"], (0, (4, 2)), "L3 b fixed (PM drops)"),
                          ("L1", C["L1"], "-", "L1 Type-I (no band)")]:
    ok = [d for d in lat[key] if "infeasible" not in d]
    ax[1].plot([d["D"] for d in ok], [d["f_inv_dc_Hz"] / 1e6 for d in ok], color=col, ls=ls, marker="o", ms=4, label=lab)
ax[1].set_xlabel("loop latency D [samples]  (D = 1 baseline)")
ax[1].set_ylabel("f_inv [MHz]")
ax[1].set_title("(b) band edge vs latency, BW held at 320 MHz", fontsize=10.5, loc="left")
ax[1].legend(fontsize=8)
fig.tight_layout()
fig.savefig("fig_sweeps.png", dpi=150)
plt.close(fig)
print("figures written")
