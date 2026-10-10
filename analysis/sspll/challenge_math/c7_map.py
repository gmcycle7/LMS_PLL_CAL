import math, numpy as np
from mloops import *
from mreg import *
L2n=L2(60); L3n=L3(60)
def bands(js,mask):
    out=[];i=0
    while i<len(js):
        if mask[i]:
            j=i
            while j+1<len(js) and mask[j+1]: j+=1
            out.append((round(js[i]*4e3/4096,1),round(js[j]*4e3/4096,1))); i=j+1
        else: i+=1
    return out
for lp in (L2n,L3n):
    js=np.arange(1,2049)
    kap=[];kapm=[]
    for j in js:
        g=math.gcd(j,4096); P,Q=j//g,4096//g
        C,X=C_time(lp,P,Q)
        mp,nob=obs_min_eig(C,X,list(range(1,9)))
        # normalise by open-loop min eig (=1/8 for uniform occupancy)
        C0=(X-X.mean(0)).T@(X)/Q
        m0,_=obs_min_eig(C0,X,list(range(1,9)))
        kap.append(mp/m0)
        k=np.arange(8)
        Cp=C[1:,1:]
        kapm.append([8*np.real(np.exp(-2j*np.pi*m*k/8)@Cp@np.exp(2j*np.pi*m*k/8)/8) for m in range(1,5)])
    kap=np.array(kap); kapm=np.array(kapm)
    for tau in (1e-3,1e-2):
        print(lp.name,'tau',tau,bands(js,kap<-tau))
    i=np.argmin(kap); print('  worst kappa %.4f at %.1f MHz'%(kap[i],js[i]*4e3/4096))
    for a in (0.245,0.247,0.249,0.251,0.253,0.255,0.49,0.492,0.494,0.495,0.496,0.497):
        j=int(round(a*4096)); print('   alpha~%.4f (%.1f MHz) kappa=%.5f  modes1-4=%s'%(j/4096,j*4e3/4096,kap[j-1],np.round(kapm[j-1],5)))
    np.save('kappa_map_%s.npy'%lp.name,np.c_[js,kap,kapm])
