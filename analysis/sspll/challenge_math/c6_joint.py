import math, numpy as np
from math import gcd
from mloops import *
from mreg import *
L2n=L2(60); L3n=L3(60); L1n=L1()
for lp in (L1n,L2n,L3n):
    nj=0; n_only_joint=[]; ntot=0; worst_cross=0
    for Q in range(2,401):
        for P in range(1,Q//2+1):
            if gcd(P,Q)!=1: continue
            C,X=C_time(lp,P,Q)
            mp,_=obs_min_eig(C,X,list(range(1,9)))
            mj,_=obs_min_eig(C,X,list(range(0,9)))
            # gos scalar
            vg=X[:,0].var()
            cg=C[0,0] if vg>1e-12 else np.nan
            ntot+=1
            inv_sep=(mp< -1e-6) or (cg< -1e-6)
            inv_j=mj< -1e-6
            if inv_j: nj+=1
            if inv_j and not inv_sep: n_only_joint.append((P,Q,mp,cg,mj))
            worst_cross=max(worst_cross,np.max(np.abs(C[0,1:]))+np.max(np.abs(C[1:,0])))
    print(lp.name,'rationals Q<=400:',ntot,'joint-inverted',nj,' inverted ONLY jointly (GOS & PHOS separately ok):',len(n_only_joint),n_only_joint[:8])
