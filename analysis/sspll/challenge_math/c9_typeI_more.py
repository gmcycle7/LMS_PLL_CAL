import math, numpy as np
from mloops import *
from mreg import *
for lat in (4,5):
    lp=L1(lat=lat); K=lp.p['K']
    b=neg_band(lp)
    print('L1 lat=%d K=%.4f K(d-1/2)=%.3f PM=%.1f band=%s'%(lat,K,K*(lat-0.5),lp.pm()[1],[(round(a*4e3,1),round(c*4e3,1),round(m,4)) for a,c,m,_ in b]))
lp=L1(fpole=200e6)
f=np.linspace(1e-6,0.5,200001)
print('L1 pole200M: min ReH %.4f maxReH %.4f'%(lp.H(f).real.min(),lp.H(f).real.max()))
worst=(9,None)
for j in range(1,2049):
    g=math.gcd(j,4096);P,Q=j//g,4096//g
    C,X=C_time(lp,P,Q)
    mp,_=obs_min_eig(C,X,list(range(1,9)))
    if 8*mp<worst[0]: worst=(8*mp,j*4e3/4096)
print('L1 pole200M PHOS worst kappa',worst)
# fx with a too-slow Type-I model: sign at DC predicted by 1/2 + Kp/Ki - 1/Khat
L2n=L2(60); Kp,Ki=L2n.p['Kp'],L2n.p['Ki']
print('critical Khat = 1/(Kp/Ki+1/2) =',1/(Kp/Ki+0.5))
for Kh in (0.39,0.2,0.13,0.12,0.1,0.05):
    m=L1(K=Kh)
    ff=np.geomspace(1e-7,0.5,200001)
    g=np.real(L2n.H(ff)*np.conj(m.H(ff)))
    neg=ff[g<0]
    print('  fx Type-I model Khat=%.3f: min Re{H Hhat*}=%.3e, neg band up to %s MHz'%(Kh,g.min(),(neg.max()*4e3 if len(neg) else None)))
