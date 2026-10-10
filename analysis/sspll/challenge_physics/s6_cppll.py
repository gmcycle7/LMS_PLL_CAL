"""P4: CPPLL sampled-data validity at BW/f_ref = 0.08 and Type-II inherent low-f inversion.
CT model L(jw) (no sampling) rescaled to |T|-3dB = 320 MHz vs impulse-invariant; gain margins."""
import numpy as np, math
from scipy import optimize
from phys import *
ph = math.radians(60); b = ((1+math.sin(ph))/math.cos(ph))**2
def Lct(w, wc):
    sb = math.sqrt(b); wz, wp, K = wc/sb, wc*sb, wc*wc/sb
    s = 1j*w
    return K*(1+s/wz)/(s**2*(1+s/wp))
def f3_ct(wc):
    w = np.linspace(1e-5, np.pi, 200001); L = Lct(w, wc); T = np.abs(L/(1+L))
    i = np.nonzero(T < 1/math.sqrt(2))[0][0]; return w[i]/(2*np.pi)
wc = optimize.brentq(lambda x: f3_ct(x) - 0.08, 0.05, 1.0, xtol=1e-12)
w = np.concatenate([np.geomspace(1e-7, 1e-2, 2000), np.linspace(1e-2, np.pi, 200001)])
g = Lct(w, wc).real + 1
edge = w[np.nonzero(g < 0)[0][-1]]/(2*np.pi)*4e3
print(f'CT model: wcT={wc:.6f}, Re H<0 band 0-{edge:.2f} MHz')
l3 = L3(60, 'impulse')
for lp in (l3, L2(60), L1()):
    f = np.linspace(1e-6, 0.5, 400001); L = lp.L(f); ph_ = np.unwrap(np.angle(L))
    i = np.nonzero(ph_ < -np.pi)[0]
    gm = -20*np.log10(abs(L[i[0]])) if len(i) else float('inf')
    print(lp.name, 'PM %.2f' % lp.pm()[1], 'GM %.2f dB' % gm, 'fc/fref %.4f' % lp.pm()[0])
# Type-II: Re L -> -inf as f -> 0 for any latency/PM: check -Re L at f = 1 MHz for several designs
for name, lp in (('L2 PM75', L2(75)), ('L2 PM60 lat2.5', L2(60, lat=2.5)), ('L3 PM75', L3(75, 'impulse'))):
    print(name, '-Re L(1 MHz) = %.1f' % (-lp.L(1e6/4e9).real), ' Re H(1 MHz) = %.3e' % lp.H(1e6/4e9).real)
