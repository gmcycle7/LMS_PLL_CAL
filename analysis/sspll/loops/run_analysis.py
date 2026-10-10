"""run_analysis.py -- produce every number in README.md.
Outputs (this folder): loops_summary.json, hpd_grid.json, analysis_log.txt
"""
import json
import math
import sys
import numpy as np
import loops as LP

F = LP.F_REF
BWt = LP.BW
TP = 2 * np.pi
OUT = {}
log_lines = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    log_lines.append(s)


def r(x, n=6):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        if not np.isfinite(x):
            return str(x)
        return float(f"{x:.{n}g}")
    return x


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return r(float(o), 8)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    return o


def band_str(bands):
    if not bands:
        return "none"
    return "; ".join(f"[{b['f_lo_Hz']/1e6:.2f}, {b['f_hi_Hz']/1e6:.2f}] MHz" for b in bands)


def bstr(d):
    if not d["bands"]:
        return "none"
    return "; ".join(f"[{b[0]/1e6:.2f}, {b[1]/1e6:.2f}] MHz (min Re H={b[2]:+.4f})" for b in d["bands"])


def fband(bands):
    """upper edge of the DC-touching band (0 if none)."""
    for b in bands:
        if b["touches_dc"]:
            return b["f_hi_Hz"]
    return 0.0


FSEL = np.array([1, 5, 20, 50, 100, 150, 200, 250, 320, 500, 1000, 2000]) * 1e6


def describe(lp, label):
    s = LP.summarize(lp)
    H = lp.Hpd(FSEL)
    s["Hpd_at_fsel"] = {f"{f/1e6:g}MHz": {"re": H[i].real, "im": H[i].imag,
                                          "phase_deg": math.degrees(np.angle(H[i])),
                                          "cos_phase": math.cos(np.angle(H[i])),
                                          "mag_dB": 20 * math.log10(abs(H[i]))}
                        for i, f in enumerate(FSEL)}
    # dominant closed-loop pole pair
    if s["poles"]:
        cx = [p for p in s["poles"] if abs(p["s_norm"][1]) > 1e-12] if s["poles"] else []
        s["dominant_pair"] = min(cx, key=lambda p: p["fn_Hz"]) if cx else None
    log(f"--- {label}: {lp.name}")
    log(f"  params: " + ", ".join(f"{k}={r(v)}" for k, v in lp.params.items()))
    log(f"  f3dB={s['f3dB_Hz']/1e6:.4f} MHz (unique={s['f3dB_unique']}), fc={s['fc_Hz']/1e6:.2f} MHz, "
        f"PM={s['PM_deg']:.2f} deg, GM={s['GM_dB']:.2f} dB @ {s['f180_Hz']/1e6:.1f} MHz, "
        f"delay margin={s.get('delay_margin_cycles', float('nan')):.3f} cyc, modulus margin={s['modulus_margin']:.3f}")
    log(f"  |T| peak={s['T_peak_dB']:.3f} dB @ {s['T_peak_f_Hz']/1e6:.1f} MHz; |H_PD| peak={s['Hpd_peak_dB']:.3f} dB "
        f"@ {s['Hpd_peak_f_Hz']/1e6:.1f} MHz; stable={s['stable']}")
    log(f"  inversion band(s) Re{{H_PD}}<0: {band_str(s['inversion_bands'])};  |T|>0dB band(s): "
        + ("none" if not s['T_gt_1_bands'] else "; ".join(f"[{a/1e6:.2f}, {b/1e6:.2f}]" for a, b in s['T_gt_1_bands'])) + " MHz")
    for b in s["inversion_bands"]:
        log(f"     min Re{{H}}={b['min_ReH']:.4f} @ {b['f_at_min_Hz']/1e6:.1f} MHz")
    if s["poles"]:
        for p in s["poles"]:
            log(f"  pole: z={p['z']}, |z|={r(p['abs_z'])}, fn={p['fn_Hz']/1e6:.2f} MHz, zeta={p['zeta']:.4f}")
    log("  angle(H_PD) [deg] @ " + ", ".join(f"{f/1e6:g}:{math.degrees(np.angle(h)):.1f}" for f, h in zip(FSEL, H)))
    return s


# ============================================================================
# 1. nominal designs
# ============================================================================
log("=" * 78)
log("1. NOMINAL DESIGNS  (f_ref = 4 GHz, closed-loop |T| -3 dB = 320 MHz)")
log("=" * 78)
nom = {
    "L1_typeI": LP.L1_typeI(),
    "L2_typeII_PM60": LP.L2_typeII(pm_deg=60),
    "L3_cppll_impulse_PMct60": LP.L3_cppll(pm_deg=60, mapping="impulse", pm_domain="ct"),
    "L3_cppll_impulse_PMct55": LP.L3_cppll(pm_deg=55, mapping="impulse", pm_domain="ct"),
    "L3_cppll_impulse_PMdt60": LP.L3_cppll(pm_deg=60, mapping="impulse", pm_domain="dt"),
    "L3_cppll_zoh_PMct60": LP.L3_cppll(pm_deg=60, mapping="zoh", pm_domain="ct"),
    "L3_cppll_ct_PMct60": LP.L3_cppll(pm_deg=60, mapping="ct", pm_domain="ct"),
    "L3_cppll_ctdelay_PMct60": LP.L3_cppll(pm_deg=60, mapping="ct_delay", pm_domain="ct"),
}
OUT["nominal"] = {k: describe(v, k) for k, v in nom.items()}

# ============================================================================
# 2. analytic checks
# ============================================================================
log("=" * 78)
log("2. ANALYTIC CHECKS")
log("=" * 78)
an = {}
# 2a low-frequency expansions
Wsmall = np.array([1e-4, 1e-3, 1e-2])
l1 = nom["L1_typeI"]
K = l1.params["K"]
pred = (1 - K / 2) / K ** 2
meas = l1.Hpd_w(Wsmall).real / Wsmall ** 2
an["L1_lowfreq_ReH_over_W2"] = {"pred": pred, "meas": meas.tolist()}
log(f"L1: Re{{H}}/W^2 -> (1-K/2)/K^2 = {pred:.5f}; measured {meas}")
l2 = nom["L2_typeII_PM60"]
Kp, Ki = l2.params["Kp"], l2.params["Ki"]
meas = l2.Hpd_w(Wsmall).real / Wsmall ** 2
an["L2_lowfreq_ReH_over_W2"] = {"pred": -1 / Ki, "meas": meas.tolist()}
log(f"L2: Re{{H}}/W^2 -> -1/Ki = {-1/Ki:.5f}; measured {meas}")
l3 = nom["L3_cppll_impulse_PMct60"]
K3 = l3.params["K_norm"]
meas = l3.Hpd_w(Wsmall).real / Wsmall ** 2
an["L3_lowfreq_ReH_over_W2"] = {"pred": -1 / K3, "meas": meas.tolist()}
log(f"L3: Re{{H}}/W^2 -> -1/K = {-1/K3:.5f}; measured {meas}")
for k in ["L1_typeI", "L2_typeII_PM60", "L3_cppll_impulse_PMct60"]:
    ph = np.degrees(np.angle(nom[k].Hpd_w(Wsmall)))
    log(f"  {k}: angle(H_PD) at W={Wsmall} -> {ph}")

# 2b L2 exact band edge and approximations
Winv = 2 * math.asin(math.sqrt(Ki / (2 * (2 - Kp))))
zeta = l2.params["zeta_ct_equiv"]
wn = l2.params["wn_norm"]
W3 = TP * BWt / F
g = LP.ct_g_zeta(zeta)
approx_ct = W3 / g                             # CT: f_inv = f_n = f3dB/g(zeta)
wn_from_bw = W3 / g
approx_dt = 2 * math.asin((wn_from_bw / 2) / math.sqrt(1 - zeta * wn_from_bw))
an["L2_band_edge"] = {
    "exact_closed_form_Hz": Winv * F / TP,
    "numeric_Hz": fband(OUT["nominal"]["L2_typeII_PM60"]["inversion_bands"]),
    "ct_fn_from_design_Hz": wn * F / TP,
    "ct_approx_f3dB_over_g_Hz": approx_ct * F / TP,
    "dt_corrected_approx_Hz": approx_dt * F / TP,
    "zeta": zeta, "g_zeta": g, "ct_PM_of_zeta_deg": LP.ct_pm_from_zeta(zeta),
}
log(f"L2 band edge: exact closed form {Winv*F/TP/1e6:.3f} MHz | CT f_n(design) {wn*F/TP/1e6:.3f} | "
    f"CT f3dB/g(zeta) {approx_ct*F/TP/1e6:.3f} | DT-corrected {approx_dt*F/TP/1e6:.3f} MHz "
    f"(zeta={zeta:.4f}, g={g:.4f}, PM_ct(zeta)={LP.ct_pm_from_zeta(zeta):.2f})")
# CT-only f3dB / f_n for the discrete design
lp_ct_eq = LP.Loop("ct_eq", F, lambda W: (2 * zeta * wn * 1j * W + wn * wn) / (1j * W) ** 2, 2)
an["L2_ct_equivalent_f3dB_Hz"] = LP.f3db_w(lp_ct_eq.Lw)[0] * F / TP
log(f"   CT-equivalent loop (same Kp,Ki, no sampling) would have f3dB = {an['L2_ct_equivalent_f3dB_Hz']/1e6:.2f} MHz")

# 2c L3 CT closed form (quadratic in w^2)
l3ct = nom["L3_cppll_ct_PMct60"]
P = l3ct.params
Kc, wz, wp = P["K_norm"], P["wz_norm"], P["wp_norm"]
A = -1 / wp ** 2
Bq = Kc / (wz * wp) - 1
x = (-Bq - math.sqrt(Bq * Bq - 4 * A * Kc)) / (2 * A)
an["L3_ct_band_edge"] = {"closed_form_Hz": math.sqrt(x) * F / TP,
                         "numeric_Hz": fband(OUT["nominal"]["L3_cppll_ct_PMct60"]["inversion_bands"]),
                         "ratio_to_wc": math.sqrt(x) / P["wc_norm"]}
log(f"L3 CT band edge closed form {math.sqrt(x)*F/TP/1e6:.3f} MHz vs numeric "
    f"{an['L3_ct_band_edge']['numeric_Hz']/1e6:.3f} MHz; w_inv/w_c = {math.sqrt(x)/P['wc_norm']:.4f}")
# 2d L3 impulse closed-form Re{L} band edge
l3i = nom["L3_cppll_impulse_PMct60"]
P = l3i.params
Kc, wz, wp = P["K_norm"], P["wz_norm"], P["wp_norm"]
p = math.exp(-wp)
Bc = Kc * (1 / wz - 1 / wp)
from scipy import optimize as _opt
fun = lambda W: Kc / (4 * math.sin(W / 2) ** 2) + Bc * (1 - p * p) / (2 * abs(1 - p * np.exp(-1j * W)) ** 2) - 1
We = _opt.brentq(fun, 1e-4, math.pi)
an["L3_impulse_band_edge"] = {"closed_form_eq_Hz": We * F / TP,
                              "numeric_Hz": fband(OUT["nominal"]["L3_cppll_impulse_PMct60"]["inversion_bands"]),
                              "Kp_equiv_dc": Bc * (1 + p) / (1 - p), "Kp_equiv_nopole": Bc}
log(f"L3 impulse band edge from closed-form Re{{L}}=-1: {We*F/TP/1e6:.3f} MHz vs numeric "
    f"{an['L3_impulse_band_edge']['numeric_Hz']/1e6:.3f} MHz")
OUT["analytic"] = an

# ============================================================================
# 3. sweeps
# ============================================================================
log("=" * 78)
log("3. SWEEPS")
log("=" * 78)
sw = {}


def row(lp, extra=None):
    s = LP.summarize(lp)
    dp = None
    if s["poles"]:
        cx = [p for p in s["poles"] if abs(p["s_norm"][1]) > 1e-12]
        dp = min(cx, key=lambda p: p["fn_Hz"]) if cx else min(s["poles"], key=lambda p: p["fn_Hz"])
    d = {"name": lp.name, "params": lp.params, "f3dB_Hz": s["f3dB_Hz"], "fc_Hz": s["fc_Hz"],
         "PM_deg": s["PM_deg"], "GM_dB": s["GM_dB"], "T_peak_dB": s["T_peak_dB"],
         "Hpd_peak_dB": s["Hpd_peak_dB"], "modulus_margin": s["modulus_margin"],
         "bands": [(b["f_lo_Hz"], b["f_hi_Hz"], b["min_ReH"]) for b in s["inversion_bands"]],
         "f_inv_dc_Hz": fband(s["inversion_bands"]), "stable": s["stable"],
         "dom_pole_fn_Hz": dp["fn_Hz"] if dp else float("nan"), "dom_pole_zeta": dp["zeta"] if dp else float("nan"),
         "all_poles_fn_zeta": [(p["fn_Hz"], p["zeta"]) for p in s["poles"]] if s["poles"] else None,
         "T_gt_1_bands": s["T_gt_1_bands"]}
    if extra:
        d.update(extra)
    return d


def optimize_zeta_ct(pm):
    from scipy.optimize import brentq
    return brentq(lambda z: LP.ct_pm_from_zeta(z) - pm, 0.05, 20)


# 3a L2 PM sweep
log("3a. L2 Type-II SSPLL, PM sweep (D=1)")
log(f"{'PM':>4} {'zeta':>7} {'Kp':>8} {'Ki':>9} {'fz MHz':>8} {'fc MHz':>8} {'GM dB':>6} {'Tpk dB':>7} "
    f"{'Hpk dB':>7} {'f_inv MHz':>9} {'f_inv/f3dB':>10} {'CT f3dB/g':>9} {'pole fn':>8} {'pole z':>7}")
sw["L2_PM"] = []
for pm in [45, 50, 55, 60, 65, 70, 75]:
    lp = LP.L2_typeII(pm_deg=pm)
    z = lp.params["zeta_ct_equiv"]
    # CT 2nd-order reference designed for the same PM: zeta_ct(PM), f_inv = f3dB/g(zeta_ct)
    zc = optimize_zeta_ct(pm)
    d = row(lp, {"ct_pred_Hz": BWt / LP.ct_g_zeta(z), "zeta_ct_samePM": zc,
                 "ct_samePM_f_inv_Hz": BWt / LP.ct_g_zeta(zc)})
    sw["L2_PM"].append(d)
    log(f"{pm:>4} {z:7.4f} {lp.params['Kp']:8.5f} {lp.params['Ki']:9.6f} {lp.params['f_zero_Hz']/1e6:8.2f} "
        f"{d['fc_Hz']/1e6:8.2f} {d['GM_dB']:6.2f} {d['T_peak_dB']:7.3f} {d['Hpd_peak_dB']:7.3f} "
        f"{d['f_inv_dc_Hz']/1e6:9.3f} {d['f_inv_dc_Hz']/BWt:10.4f} {d['ct_pred_Hz']/1e6:9.2f} "
        f"{d['dom_pole_fn_Hz']/1e6:8.2f} {d['dom_pole_zeta']:7.4f}  | CT2 same-PM: zeta={zc:.3f} f_inv={d['ct_samePM_f_inv_Hz']/1e6:.2f}"
        f"  minReH={d['bands'][0][2]:+.4f}")

# 3b L3 PM sweep: CT-PM design (classical) and DT-PM design, impulse mapping
for dom in ["ct", "dt"]:
    log(f"3b. L3 CPPLL impulse-invariant, PM sweep, pm_domain={dom}")
    log(f"{'PM':>4} {'b':>7} {'PMct':>6} {'PMdt':>6} {'fz MHz':>8} {'fp MHz':>8} {'fc MHz':>8} {'GM dB':>6} "
        f"{'Tpk dB':>7} {'Hpk dB':>7} {'f_inv MHz':>9} {'f_inv/f3dB':>10} {'pole fn':>8} {'pole z':>7}")
    key = f"L3_PM_{dom}"
    sw[key] = []
    for pm in [45, 50, 55, 60, 65, 70, 75]:
        try:
            lp = LP.L3_cppll(pm_deg=pm, mapping="impulse", pm_domain=dom)
        except ValueError as e:
            log(f"{pm:>4} infeasible: {e}")
            sw[key].append({"pm": pm, "infeasible": str(e)})
            continue
        d = row(lp)
        sw[key].append(d)
        P = lp.params
        log(f"{pm:>4} {P['b_ratio']:7.3f} {P['PM_ct_formula_deg']:6.2f} {d['PM_deg']:6.2f} {P['f_z_Hz']/1e6:8.2f} "
            f"{P['f_p_Hz']/1e6:8.1f} {d['fc_Hz']/1e6:8.2f} {d['GM_dB']:6.2f} {d['T_peak_dB']:7.3f} "
            f"{d['Hpd_peak_dB']:7.3f} {d['f_inv_dc_Hz']/1e6:9.3f} {d['f_inv_dc_Hz']/BWt:10.4f} "
            f"{d['dom_pole_fn_Hz']/1e6:8.2f} {d['dom_pole_zeta']:7.4f}")

# 3c L3 mapping comparison at PM_ct = 60
log("3c. L3 mapping comparison (b from CT PM=60 deg, wc rescaled to 320 MHz in each domain)")
sw["L3_mapping"] = []
for mp in ["ct", "ct_delay", "impulse", "zoh"]:
    lp = LP.L3_cppll(pm_deg=60, mapping=mp, pm_domain="ct")
    d = row(lp)
    sw["L3_mapping"].append(d)
    log(f"  {mp:9s} fc_design={lp.params['f_c_design_Hz']/1e6:7.2f} MHz  fc={d['fc_Hz']/1e6:7.2f}  PM={d['PM_deg']:6.2f}  "
        f"GM={d['GM_dB']:6.2f}  Tpk={d['T_peak_dB']:6.3f} dB  f_inv={d['f_inv_dc_Hz']/1e6:8.3f} MHz  "
        f"bands={bstr(d)}")

# 3d latency sweep
log("3d. Latency sweep  (D = total z-delay; D=1 baseline; tau_eq = D - 1/2 cycles CT-equivalent)")
Ds = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
sw["latency"] = {"L1": [], "L1_modz": [], "L2_PM60": [], "L2_fixed_zeta": [], "L3_fixed_b": [], "L3_dtPM60": []}
z_nom = nom["L2_typeII_PM60"].params["zeta_ct_equiv"]
log(f"  (L2 fixed-zeta rows use zeta = {z_nom:.4f} from the D=1, PM=60 design)")
for D in Ds:
    lp = LP.L1_typeI(latency=D)
    d = row(lp, {"D": D, "K_tau_eq": lp.params["K_tau_eq"]})
    sw["latency"]["L1"].append(d)
    log(f"  L1  D={D:<4} K={lp.params['K']:.5f} K*tau_eq={lp.params['K_tau_eq']:.4f} PM={d['PM_deg']:6.2f} "
        f"GM={d['GM_dB']:6.2f} Tpk={d['T_peak_dB']:6.3f} dB  bands={bstr(d)}")
for D in [1.5, 2.5]:
    lp = LP.L1_typeI(latency=D, latency_mode="modz")
    d = row(lp, {"D": D})
    sw["latency"]["L1_modz"].append(d)
    log(f"  L1(modz ZOH pulse) D={D:<4} K={lp.params['K']:.5f} PM={d['PM_deg']:6.2f} Tpk={d['T_peak_dB']:6.3f} "
        f"stable={d['stable']} bands={bstr(d)}")
for D in Ds:
    try:
        lp = LP.L2_typeII(pm_deg=60, latency=D)
        d = row(lp, {"D": D})
        sw["latency"]["L2_PM60"].append(d)
        log(f"  L2(PM60) D={D:<4} zeta={lp.params['zeta_ct_equiv']:.4f} Kp={lp.params['Kp']:.5f} Ki={lp.params['Ki']:.6f} "
            f"PM={d['PM_deg']:6.2f} GM={d['GM_dB']:6.2f} Tpk={d['T_peak_dB']:6.3f} f_inv={d['f_inv_dc_Hz']/1e6:8.3f} MHz "
            f"bands={bstr(d)}")
    except ValueError as e:
        sw["latency"]["L2_PM60"].append({"D": D, "infeasible": str(e)})
        log(f"  L2(PM60) D={D:<4} infeasible: {e}")
for D in Ds:
    lp = LP.L2_typeII(zeta=z_nom, latency=D)
    d = row(lp, {"D": D})
    sw["latency"]["L2_fixed_zeta"].append(d)
    log(f"  L2(zeta fixed) D={D:<4} Kp={lp.params['Kp']:.5f} Ki={lp.params['Ki']:.6f} PM={d['PM_deg']:6.2f} "
        f"GM={d['GM_dB']:6.2f} Tpk={d['T_peak_dB']:6.3f} f_inv={d['f_inv_dc_Hz']/1e6:8.3f} MHz "
        f"bands={bstr(d)}")
for D in Ds:
    lp = LP.L3_cppll(pm_deg=60, mapping="impulse", pm_domain="ct", latency=D)
    d = row(lp, {"D": D})
    sw["latency"]["L3_fixed_b"].append(d)
    log(f"  L3(b fixed, PMct60) D={D:<4} fc={d['fc_Hz']/1e6:7.2f} PM={d['PM_deg']:6.2f} GM={d['GM_dB']:6.2f} "
        f"Tpk={d['T_peak_dB']:6.3f} f_inv={d['f_inv_dc_Hz']/1e6:8.3f} MHz "
        f"bands={bstr(d)}")
for D in Ds:
    try:
        lp = LP.L3_cppll(pm_deg=60, mapping="impulse", pm_domain="dt", latency=D)
        d = row(lp, {"D": D})
        sw["latency"]["L3_dtPM60"].append(d)
        log(f"  L3(dt PM60) D={D:<4} b={lp.params['b_ratio']:.3f} PM={d['PM_deg']:6.2f} Tpk={d['T_peak_dB']:6.3f} "
            f"f_inv={d['f_inv_dc_Hz']/1e6:8.3f} MHz")
    except ValueError as e:
        sw["latency"]["L3_dtPM60"].append({"D": D, "infeasible": str(e)})
        log(f"  L3(dt PM60) D={D:<4} infeasible: {e}")
# modz cross-check for L2 / L3 at D=1.5
for lp in [LP.L2_typeII(pm_deg=60, latency=1.5, latency_mode="modz"),
           LP.L3_cppll(pm_deg=60, latency=1.5, latency_mode="modz")]:
    d = row(lp)
    sw["latency"].setdefault("modz_D1.5", []).append(d)
    log(f"  modz cross-check {lp.name}: PM={d['PM_deg']:6.2f} f_inv={d['f_inv_dc_Hz']/1e6:8.3f} MHz stable={d['stable']}")

# 3d' L1 large-latency threshold: band appears iff K (D - 1/2) > 1
log("3d'. L1 large-latency scan (fd): first D where Re{H_PD}<0 appears vs K*(D-1/2)")
sw["L1_largeD"] = []
for D in np.arange(3.0, 5.51, 0.25):   # beyond ~5.6 the BW-matched loop has PM<0 (unstable)
    lp = LP.L1_typeI(latency=float(D))
    d = row(lp, {"D": float(D), "K_tau_eq": lp.params["K_tau_eq"]})
    sw["L1_largeD"].append(d)
    log(f"  D={D:5.2f} K={lp.params['K']:.5f} K(D-1/2)={lp.params['K_tau_eq']:.4f} PM={d['PM_deg']:6.2f} "
        f"Tpk={d['T_peak_dB']:6.3f} dB bands={bstr(d)}")

# 3e L1 parasitic pole sweep
log("3e. L1 Type-I + parasitic pole (ZOH-exact), D=1")
sw["L1_pole"] = []
for fp in [None, 8e9, 4e9, 2e9, 1e9, 0.75e9, 0.5e9, 0.4e9, 0.3e9, 0.25e9, 0.2e9, 0.15e9, 0.1e9]:
    lp = LP.L1_typeI(f_pole=fp)
    K = lp.params["K"]
    if fp is None:
        zct, ct_edge = None, None
    else:
        wp_ = TP * fp / F
        zct = 0.5 * math.sqrt(wp_ / K)                   # CT: wn^2 = K wp, 2 zeta wn = wp
        wn_ = math.sqrt(K * wp_)
        ct_edge = wn_ * math.sqrt(1 - 4 * zct ** 2) * F / TP if zct < 0.5 else None
    d = row(lp, {"f_pole_Hz": fp, "zeta_ct": zct, "ct_band_edge_Hz": ct_edge})
    sw["L1_pole"].append(d)
    log(f"  fp={'inf' if fp is None else f'{fp/1e9:g} GHz':>8} K={K:.5f} zeta_ct={'-' if zct is None else f'{zct:.3f}':>6} "
        f"PM={d['PM_deg']:6.2f} GM={d['GM_dB']:6.2f} Tpk={d['T_peak_dB']:6.3f} dB  "
        f"bands={bstr(d)}  "
        f"CT-pred edge={'none (zeta_ct>=0.5)' if ct_edge is None else f'{ct_edge/1e6:.1f} MHz'}")
OUT["sweeps"] = sw

# ============================================================================
# 4. illustrative LMS effective gains (linearised comparator) for a few FCW fractions
# ============================================================================
log("=" * 78)
log("4. ILLUSTRATION (linearised / small-mu mean dynamics, first-order accumulator, correlator delay 0)")
log("   GOS: g_eff = <(h*rho)rho_ac>/<rho_ac^2>;  PHOS: min Re eig(R) and min eig(sym R) on the observable subspace")
log("=" * 78)
models3 = {"L1": nom["L1_typeI"], "L2": nom["L2_typeII_PM60"], "L3": nom["L3_cppll_impulse_PMct60"]}
M = 4096


def regressors(j):
    n = np.arange(M)
    phi = (n * j % M) / M
    pidx = np.floor(8 * phi).astype(int)
    rho = 8 * phi - pidx
    X = np.zeros((M, 8))
    X[n, pidx] = 1.0
    return rho, X


def phos_eigs(lp, X):
    R = LP.lms_effective_matrix(lp, X)
    used = np.nonzero(X.sum(0) > 0)[0]
    Ru = R[np.ix_(used, used)]
    q = len(used)
    if q <= 1:
        return float("nan"), float("nan")
    Q = np.linalg.qr(np.column_stack([np.ones(q), np.eye(q)[:, : q - 1]]))[0][:, 1:]
    Rs = Q.T @ Ru @ Q
    return float(np.min(np.linalg.eigvals(Rs).real)), float(np.min(np.linalg.eigvalsh(0.5 * (Rs + Rs.T))))


lmsd = []
alphas_j = [1, 8, 16, 64, 264, 410, 532, 1088, 1516, 2016]
log(f"{'alpha':>10} {'f(8a)MHz':>9} {'f(a)MHz':>8} | GOS g_eff L1 / L2 / L3      | PHOS min Re eig(R) L1 / L2 / L3")
for j in alphas_j:
    a = j / M
    rho, X = regressors(j)
    f8 = (8 * a % 1)
    f8 = min(f8, 1 - f8) * F
    f1 = min(a, 1 - a) * F
    rec = {"alpha": a, "f_rho_fund_Hz": f8, "f_p_fund_Hz": f1}
    gs, es = [], []
    for nm, lp in models3.items():
        g = LP.lms_effective_gain(lp, rho)
        mr, ms = phos_eigs(lp, X)
        rec[nm] = {"gos_geff": g, "phos_min_re_eig": mr, "phos_min_eig_sym": ms}
        gs.append(g)
        es.append(mr)
    lmsd.append(rec)
    log(f"{a:10.6f} {f8/1e6:9.2f} {f1/1e6:8.2f} | " + " ".join(f"{g:+.4f}" for g in gs) + " | "
        + " ".join(f"{e:+.2e}" for e in es))
# asymptotics for a slow sawtooth of period P = 1/frac(8 alpha): Type-I 6/(K P), Type-II 12/(K_i P^2)
log("  slow-sawtooth GOS asymptotics: Type-I g ~ 6/(K P);  Type-II g ~ 12/(K_i P^2)  (P = sawtooth period, samples)")
asym = []
for j in [1, 2, 4, 8]:
    rho, X = regressors(j)
    Pp = M / (8 * j)
    r_ = {"P": Pp}
    for nm, lp in models3.items():
        g = LP.lms_effective_gain(lp, rho)
        pred = 6 / (lp.params["K"] * Pp) if nm == "L1" else 12 / ((lp.params["Ki"] if nm == "L2" else lp.params["K_norm"]) * Pp ** 2)
        r_[nm] = (g, pred)
    asym.append(r_)
    log(f"   P={Pp:6.0f}: " + "  ".join(f"{nm}: g={r_[nm][0]:.5f} pred={r_[nm][1]:.5f}" for nm in models3))
# step-error area identity  sum_n e_step[n] = H(z)/(1-z^-1)|_{z=1}
for nm, lp in models3.items():
    num, den = lp.hpd_ba()
    from scipy.signal import lfilter
    e = lfilter(num, den, np.ones(20000))
    log(f"  {nm}: sum of PD error after a unit phase step = {np.sum(e):+.6e}  (Type-I theory 1/K = "
        f"{(1/lp.params['K']) if nm == 'L1' else 0.0:.6f})")
# fine alpha scan
log("  fine scan alpha = j/4096, j = 1..2047:")
scan = {nm: {"gos": [], "phos": []} for nm in models3}
for j in range(1, 2048):
    rho, X = regressors(j)
    for nm, lp in models3.items():
        scan[nm]["gos"].append(LP.lms_effective_gain(lp, rho))
        scan[nm]["phos"].append(phos_eigs(lp, X)[0])
scan_sum = {}
for nm in models3:
    g = np.array(scan[nm]["gos"])
    e = np.array(scan[nm]["phos"])
    jj = np.arange(1, 2048)
    valid = np.isfinite(g)          # alpha with 8*alpha integer -> rho == 0 (no GOS regressor)
    negj = jj[e < -1e-12]
    runs = []
    if len(negj):
        s0 = p0 = negj[0]
        for q in negj[1:]:
            if q != p0 + 1:
                runs.append([s0 / M * F, p0 / M * F])
                s0 = q
            p0 = q
        runs.append([s0 / M * F, p0 / M * F])
    scan_sum[nm] = {"gos_min": float(np.nanmin(g)), "gos_argmin_alpha": float(jj[np.nanargmin(g)] / M),
                    "gos_n_undefined": int(np.sum(~valid)),
                    "gos_frac_negative": float(np.mean(g[valid] < 0)),
                    "phos_negative_alpha_runs_alpha_times_fref_Hz": runs,
                    "phos_frac_negative": float(np.mean(e < -1e-12)),
                    "phos_min": float(np.nanmin(e)), "phos_argmin_alpha": float(jj[np.nanargmin(e)] / M),
                    "phos_negative_alpha_examples": (jj[e < -1e-12][:12] / M).tolist()}
    log(f"   {nm}: PHOS unstable-mode alpha*f_ref runs [MHz]: " + ", ".join(f"[{a/1e6:.1f},{b/1e6:.1f}]" for a, b in runs))
    log(f"   {nm}: GOS g_eff min={np.nanmin(g):+.4f} @ alpha={jj[np.nanargmin(g)]/M:.6f}, fraction<0 = {np.mean(g[valid]<0):.3f} "
        f"({np.sum(~valid)} alphas with rho==0 excluded) | "
        f"PHOS min Re eig<0 fraction = {np.mean(e < -1e-12):.3f}, min={np.nanmin(e):+.3e} @ alpha={jj[np.nanargmin(e)]/M:.6f}")
OUT["lms_illustration"] = {"table": lmsd, "slow_sawtooth_asymptotics": asym, "fine_scan_summary": scan_sum}
np.savez_compressed("lms_alpha_scan.npz", j=np.arange(1, 2048), M=M,
                    **{f"{nm}_{k}": np.array(v) for nm in scan for k, v in scan[nm].items()})

# ============================================================================
# 5. save
# ============================================================================
with open("loops_summary.json", "w") as fh:
    json.dump(clean(OUT), fh, indent=1)

fgrid = np.linspace(1e6, F / 2, 2000)
grid_models = {
    "L1_typeI_D1": nom["L1_typeI"],
    "L1_typeI_D1_fp0.5GHz": LP.L1_typeI(f_pole=0.5e9),
    "L1_typeI_D3": LP.L1_typeI(latency=3),
    "L2_typeII_PM60_D1": nom["L2_typeII_PM60"],
    "L2_typeII_PM45_D1": LP.L2_typeII(pm_deg=45),
    "L2_typeII_PM75_D1": LP.L2_typeII(pm_deg=75),
    "L2_typeII_PM60_D2": LP.L2_typeII(pm_deg=60, latency=2),
    "L3_cppll_impulse_PMct60_D1": nom["L3_cppll_impulse_PMct60"],
    "L3_cppll_impulse_PMdt60_D1": nom["L3_cppll_impulse_PMdt60"],
    "L3_cppll_zoh_PMct60_D1": nom["L3_cppll_zoh_PMct60"],
    "L3_cppll_ct_PMct60": nom["L3_cppll_ct_PMct60"],
    "L3_cppll_ctdelay_PMct60": nom["L3_cppll_ctdelay_PMct60"],
}
grid = {"f_ref_Hz": F, "bw_target_Hz": BWt,
        "convention": "H_PD = 1/(1+L); e_PD = h_PD * e_inj; Re{H_PD}<0 <=> Re{L}<-1",
        "f_Hz": [float(f"{f:.6g}") for f in fgrid], "models": {}}
for k, lp in grid_models.items():
    H = lp.Hpd(fgrid)
    bands = LP.inversion_bands(lp)
    grid["models"][k] = {
        "params": clean(lp.params),
        "rational": lp.rational,
        "b": clean(lp.b) if lp.rational else None, "a": clean(lp.a) if lp.rational else None,
        "inversion_bands_Hz": [[b["f_lo_Hz"], b["f_hi_Hz"]] for b in bands],
        "re": [float(f"{v:.7g}") for v in H.real],
        "im": [float(f"{v:.7g}") for v in H.imag],
    }
with open("hpd_grid.json", "w") as fh:
    json.dump(grid, fh)
with open("analysis_log.txt", "w") as fh:
    fh.write("\n".join(log_lines) + "\n")
log("saved loops_summary.json, hpd_grid.json, analysis_log.txt")
