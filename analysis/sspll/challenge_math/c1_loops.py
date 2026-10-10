import math, numpy as np
from mloops import *
L1n=L1(); L2n=L2(60); L3n=L3(60)
for lp in (L1n,L2n,L3n):
    st,zp=lp.stable()
    fc,pm=lp.pm()
    print(lp.name, {k:(round(v,7) if isinstance(v,float) else v) for k,v in lp.p.items()}, 'stable',st,'f3dB MHz %.6f'%(lp.f3db()*FREF/1e6),'fc %.3f PM %.3f'%(fc*FREF/1e6,pm))
    print('   band(MHz):',[(lo*4e3,hi*4e3,mh,fm*4e3) for lo,hi,mh,fm in neg_band(lp)])
    f=np.linspace(0,0.5,200001); h=lp.H(f).real
    print('   max Re H %.5f at %.1f MHz; H(0.5)=%s'%(h.max(),f[h.argmax()]*4e3, lp.H(0.5)))
# closed forms
K=L1n.p['K']; W3=TP*BWN; c=2-math.cos(W3); print('L1 K closed', 1-(c-math.sqrt(c*c-1)), 'mine',K)
Kp,Ki=L2n.p['Kp'],L2n.p['Ki']
print('L2 finv closed MHz', math.asin(math.sqrt(Ki/(2*(2-Kp))))/math.pi*4e3)
# Type II ReL identity check: Re L = -Kp/2 - Ki/(4 sin^2(pi f))
f=np.linspace(1e-4,0.5,10001)
print('L2 ReL identity err', np.max(np.abs(L2n.L(f).real-(-Kp/2-Ki/(4*np.sin(np.pi*f)**2)))))
# L1 ReH
W=TP*f
print('L1 ReH closed err', np.max(np.abs(L1n.H(f).real-(2-K)*(1-np.cos(W))/np.abs(1-(1-K)*np.exp(-1j*W))**2)))
# L3 closed: -ReL = K/(4 s^2) + B(1-p^2)/(2|1-p e^{-jW}|^2), B=A1
p3=L3n.p; Bc=p3['A1']; pp=p3['p']
cf=p3['K']/(4*np.sin(np.pi*f)**2)+Bc*(1-pp**2)/(2*np.abs(1-pp*np.exp(-1j*W))**2)
print('L3 closed rel err', np.max(np.abs(-L3n.L(f).real-cf)/np.abs(cf)), 'B=',Bc,'b',p3['b'],'wc',p3['wc'])
# low-freq expansions of Re H
for lp,lab,pred in ((L1n,'L1',lambda f:(2-K)*(TP*f)**2/(2*K**2)),(L2n,'L2',lambda f:-(TP*f)**2/Ki),(L3n,'L3',lambda f:-(TP*f)**2/p3['K'])):
    for ff in (1e-4,1e-3,5e-3):
        print('  lowf',lab,ff, lp.H(ff).real, pred(ff), lp.H(ff).real/pred(ff))
# other mappings for L3
for mp in ('halfT',):
    lp=L3(60,mp); print('L3',mp,'f3dB',lp.f3db()*4e3,'PM',lp.pm()[1],'band',[(lo*4e3,hi*4e3,mh) for lo,hi,mh,_ in neg_band(lp)])
