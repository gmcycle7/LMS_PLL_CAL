import math, numpy as np
from math import gcd
from mloops import *
from mreg import *
L2n=L2(60); L3n=L3(60)
for lp,edge in ((L2n,136.4),(L3n,118.8)):
    hits=[]
    for Q in range(2,401):
        for P in range(1,Q//2+1):
            if gcd(P,Q)!=1: continue
            a=P/Q
            if a*4e3<=edge: continue
            C,X=C_time(lp,P,Q)
            Xc=X[:,1:]-X[:,1:].mean(0); cov=Xc.T@Xc/Q
            w,V=np.linalg.eigh(cov); V=V[:,w>1e-9]
            if V.shape[1]==0: continue
            ev=np.linalg.eigvals(V.T@C[1:,1:]@V)
            ref=np.linalg.eigvalsh(V.T@(X[:,1:].T@X[:,1:]/Q)@V).min()
            k=ev.real.min()/ref
            if k<-1e-3: hits.append((P,Q,round(a*4e3,1),round(k,4)))
    print(lp.name,'PHOS-inverted rationals (Q<=400, kappa<-1e-3) above mode-1 edge %.1f MHz: %d'%(edge,len(hits)))
    # group by proximity to 1/4 or 1/2
    far=[h for h in hits if min(abs(h[0]/h[1]-0.25),abs(h[0]/h[1]-0.5))>0.02]
    print('   of which farther than 0.02 from 1/4,1/2:',len(far),far[:20])
    print('   sample near-alias:',sorted(hits,key=lambda h:h[3])[:8])
