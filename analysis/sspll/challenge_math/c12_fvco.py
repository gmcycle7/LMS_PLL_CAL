import math, numpy as np
from mloops import *
from mreg import *
L2n=L2(60)
rng=np.random.default_rng(7); eps=rng.normal(0,0.25,8); eps-=eps.mean(); a=0.03
for (P,Q) in ((21,1000),(1,50),(12,383),(3,37),(5,163)):
    C,X=C_time(L2n,P,Q)
    out=[]
    for fv in (12e9,16e9,24e9):
        D=1e12/fv/8
        Mx=np.eye(9); Mx[0,0]=1-a; Mx[1:,0]=(1-a)*eps/D
        Cp=C@Mx
        Xc=X-X.mean(0); cov=Xc.T@Xc/Q; w,V=np.linalg.eigh(cov); V=V[:,w>1e-9]
        ev=np.linalg.eigvals(V.T@Cp@V)
        out.append((round(ev.real.min(),7),round(Cp[0,0],7)))
    print('alpha=%d/%d 8|Q=%s joint min Re eig / C00 for fvco 12,16,24 GHz:'%(P,Q,Q%8==0),out)
