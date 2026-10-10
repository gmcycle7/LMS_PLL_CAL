"""Self-consistency checks for loops.py (run: python3 selftest.py)."""
import math
import numpy as np
from scipy import signal
import loops as LP

F = LP.F_REF
TP = 2 * np.pi
W = np.linspace(0.01, np.pi - 0.01, 777)
ok = True


def check(name, err, tol):
    global ok
    flag = err < tol
    ok &= flag
    print(f"[{'PASS' if flag else 'FAIL'}] {name}: err={err:.3e} (tol {tol:g})")


def rat_vs_closed(lp):
    num, den = lp.b, lp.a
    Lr = LP._freqz_zinv(num, W) / LP._freqz_zinv(den, W)
    return np.max(np.abs(Lr - lp.Lw(W)) / np.abs(lp.Lw(W)))


# 1. rational (b,a) == closed-form frequency response
models = [LP.L1_typeI(), LP.L1_typeI(latency=2), LP.L1_typeI(latency=1.5, latency_mode="modz"),
          LP.L1_typeI(f_pole=1e9), LP.L2_typeII(zeta=0.6), LP.L2_typeII(zeta=0.6, latency=2),
          LP.L2_typeII(zeta=0.6, latency=1.5, latency_mode="modz"),
          LP.L3_cppll(mapping="impulse"), LP.L3_cppll(mapping="impulse", latency=1.5, latency_mode="modz"),
          LP.L3_cppll(mapping="zoh"), LP.L3_cppll(mapping="impulse", latency=2)]
for lp in models:
    check(f"rational==closed-form {lp.name}", rat_vs_closed(lp), 1e-9)

# 2. ZOH parasitic-pole closed form == scipy cont2discrete(zoh) of K wp/(s(s+wp))
lp = LP.L1_typeI(f_pole=1e9)
K = lp.params["K"]; wp = TP * 1e9 / F
nd, dd, _ = signal.cont2discrete(([K * wp], [1, wp, 0]), 1.0, method="zoh")
Lc = LP._freqz_zinv(np.ravel(nd), W) / LP._freqz_zinv(np.ravel(dd), W)
check("L1 pole ZOH closed-form vs cont2discrete", np.max(np.abs(Lc - lp.Lw(W)) / np.abs(Lc)), 1e-9)

# 3. impulse-invariant L3 == T*sum_k h(kT) z^-k (brute force, h(t) = K t + B + C e^{-wp t})
for D, mode in [(1.0, "fd"), (1.5, "modz"), (1.3, "modz")]:
    lp = LP.L3_cppll(mapping="impulse", latency=D, latency_mode=mode)
    P = lp.params
    K, wz, wp = P["K_norm"], P["wz_norm"], P["wp_norm"]
    B = K * (1 / wz - 1 / wp); C = -B
    m, dl = LP._split_latency(D)
    k = np.arange(1, 200000)
    t = k - dl
    # remove the K*t ramp analytically (sum diverges at DC); compare at W > 0 via the
    # convergent pieces: K*sum t z^-k = K[z^-1/(1-z^-1)^2 - dl z^-1/(1-z^-1)]  (exact identity)
    h_rest = B + C * np.exp(-wp * t)
    Wt = W[::37]
    zz = np.exp(-1j * np.outer(Wt, k))
    rest = zz @ h_rest
    u = LP._u(Wt); zi = np.exp(-1j * Wt)
    Lbf = (K * (zi / u ** 2 - dl * zi / u) + 0) + rest  # B-part sum is conditionally convergent; use exact below
    # exact B-part: B z^-1/(1-z^-1); recompute rest with C-part only
    restC = zz @ (C * np.exp(-wp * t))
    Lbf = K * (zi / u ** 2 - dl * zi / u) + B * zi / u + restC
    check(f"L3 impulse-invariant vs brute-force sum D={D}", np.max(np.abs(Lbf * zi ** m - lp.Lw(Wt)) / np.abs(lp.Lw(Wt))), 1e-8)

# 4. time-domain: lfilter(H_PD) on a sinusoid reproduces |H|, angle(H)
for lp in [LP.L1_typeI(), LP.L2_typeII(), LP.L3_cppll()]:
    f0 = 80e6
    n = np.arange(200000)
    x = np.cos(TP * f0 / F * n)
    y = lp.filter_hpd(x)
    seg = slice(100000, None)
    ref = np.exp(1j * TP * f0 / F * n[seg])
    Hest = 2 * np.mean(y[seg] * np.conj(ref))
    check(f"time-domain H_PD@80MHz {lp.name}", abs(Hest - lp.Hpd(f0)) / abs(lp.Hpd(f0)), 1e-3)

# 5. identity Re{H}<0 <=> Re{L}<-1 and Re{T} = 1 - Re{H}
for lp in [LP.L2_typeII(), LP.L3_cppll(), LP.L1_typeI(f_pole=0.5e9)]:
    L = lp.Lw(W); H = 1 / (1 + L)
    check(f"sign identity {lp.name}", float(np.sum((H.real < 0) != (L.real < -1))), 0.5)

# 6. L1 D=1 exact: Re{H} = (2-K)(1-cos W)/|1-(1-K)e^{-jW}|^2 >= 0
lp = LP.L1_typeI(); K = lp.params["K"]
re_ex = (2 - K) * (1 - np.cos(W)) / np.abs(1 - (1 - K) * np.exp(-1j * W)) ** 2
check("L1 exact Re{H} formula", np.max(np.abs(re_ex - lp.Hpd_w(W).real)), 1e-12)
ph_ex = np.arctan(K / (2 - K) / np.tan(W / 2))
check("L1 exact phase formula", np.max(np.abs(ph_ex - np.angle(lp.Hpd_w(W)))), 1e-12)

# 7. L1 general D (fd): Re{H}<0 <=> K sin((D-1/2)W) > 2 sin(W/2)
for D in [0.5, 1.5, 2, 3, 4]:
    lp = LP.L1_typeI(latency=D)
    K = lp.params["K"]
    pred = K * np.sin((D - 0.5) * W) > 2 * np.sin(W / 2)
    check(f"L1 D={D} band condition", float(np.sum(pred != (lp.Hpd_w(W).real < 0))), 0.5)

# 8. L2 general D: Re{H}<0 <=> 4 s^2 < Ki cos((D-1)W) + 2 Kp s sin((D-1/2)W)
for D in [0.5, 1, 1.5, 2, 3]:
    lp = LP.L2_typeII(latency=D, zeta=0.72)
    Kp, Ki = lp.params["Kp"], lp.params["Ki"]
    s = np.sin(W / 2)
    pred = 4 * s * s < Ki * np.cos((D - 1) * W) + 2 * Kp * s * np.sin((D - 0.5) * W)
    check(f"L2 D={D} band condition", float(np.sum(pred != (lp.Hpd_w(W).real < 0))), 0.5)
lp = LP.L2_typeII()
Kp, Ki = lp.params["Kp"], lp.params["Ki"]
Winv = 2 * math.asin(math.sqrt(Ki / (2 * (2 - Kp))))
check("L2 D=1 closed-form band edge", abs(Winv * F / TP - LP.inversion_bands(lp)[0]["f_hi_Hz"]) / 1e6, 1e-6)

# 9. L3 impulse closed-form Re{L}
lp = LP.L3_cppll()
P = lp.params; K, wz, wp = P["K_norm"], P["wz_norm"], P["wp_norm"]
p = math.exp(-wp); B = K * (1 / wz - 1 / wp)
reL = -K / (4 * np.sin(W / 2) ** 2) - B * (1 - p * p) / (2 * np.abs(1 - p * np.exp(-1j * W)) ** 2)
check("L3 impulse closed-form Re{L}", np.max(np.abs(reL - lp.Lw(W).real) / np.abs(reL)), 1e-10)

# 10. CT 2nd-order references
check("ct_g_zeta(0.7071)=sqrt(2+sqrt5)", abs(LP.ct_g_zeta(1 / math.sqrt(2)) - math.sqrt(2 + math.sqrt(5))), 1e-12)

print("ALL PASS" if ok else "SOME FAILED")
