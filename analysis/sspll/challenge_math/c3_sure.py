import math, numpy as np
from math import gcd
from mloops import *
from mreg import *
L2n=L2(60); L3n=L3(60)
for lp,(lo,hi) in ((L2n,(32.680,125.328)),(L3n,(27.724,105.092))):
    a0,a1=lo/4e3,hi/4e3
    worst=(1e9,None); worst8n=(1e9,None); cnt=0; bad=[]; cnt8n=0
    for Q in range(2,1201):
        for P in range(math.ceil(a0*Q),math.floor(a1*Q)+1):
            if gcd(P,Q)!=1 or not (a0<=P/Q<=a1): continue
            C,X=C_time(lp,P,Q)
            mp,nob=obs_min_eig(C,X,list(range(1,9)))
            mj,_=obs_min_eig(C,X,list(range(0,9)))
            cnt+=1
            if Q%8: cnt8n+=1
            if not (mp<0): bad.append((P,Q,mp,mj))
            # normalised by open-loop min eig of PHOS (cov) to compare with kappa
            if mp>worst[0]: pass
            m=max(mp,-1e9)
            if Q%8 and mp>-1e9 and (worst8n[1] is None or mp>worst8n[0]): worst8n=(mp,(P,Q))
    print(lp.name,'rationals Q<=1200 in sure band:',cnt,'(8 not | Q:',cnt8n,') non-inverted PHOS:',len(bad), bad[:10], ' least-negative 8notdivQ min eig:',worst8n)
