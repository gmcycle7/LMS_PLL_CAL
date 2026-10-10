import math, numpy as np, time
from mloops import *
t0=time.time()
loops={'L1':L1(),'L2':L2(60),'L3':L3(60),'L2pm45':L2(45),'L2pm75':L2(75),'L2lat2':L2(60,lat=2),'L3pm45':L3(45),'L3pm55':L3(55),'L3halfT':L3(60,'halfT')}
print('built',time.time()-t0)
NG=1<<22
fg=np.arange(NG+1)/NG
res={}
for nm,lp in loops.items():
    st,_=lp.stable()
    ReH=lp.H(np.where(fg==0,1e-300,fg)).real; ReH[0]=0; ReH[-1]=0
    def reh(f):
        x=f*NG; i=np.floor(x).astype(np.int64); t=x-i
        return ReH[i]*(1-t)+ReH[np.minimum(i+1,NG)]*t
    meanRe=ReH[:-1].mean()
    # ergodic dense scan
    betas=np.unique(np.concatenate([np.geomspace(1e-4,0.5,6000),np.linspace(1e-3,0.5,6000)]))
    M=40000
    C=np.zeros(len(betas))
    m=np.arange(1,M+1)
    wm=1/(2*np.pi**2*m**2)
    for i0 in range(0,len(betas),200):
        b=betas[i0:i0+200]
        C[i0:i0+200]=(reh((np.outer(b,m))%1.0)*wm).sum(1)
    C+=meanRe*(1/(2*np.pi**2))*(1/M)   # ~tail sum 1/m^2 ~ 1/M (only accurate when M*beta>>1)
    ok=betas*M>50
    i=np.argmin(np.where(ok,12*C,np.inf))
    # rational exact scan b<=1000
    worst=(np.inf,None); nneg=0; ntot=0
    for bb in range(2,1001):
        k=np.arange(1,bb)
        w=1/(4*bb**2*np.sin(np.pi*k/bb)**2)
        Rb=lp.H(k/bb).real
        a=np.array([x for x in range(1,bb//2+1) if math.gcd(x,bb)==1])
        idx=(np.outer(a,k))%bb
        Rfull=np.r_[0.0,Rb]
        Ca=(Rfull[idx]*w).sum(1)
        ntot+=len(a); nneg+=int((Ca<0).sum())
        j=np.argmin(Ca)
        if 12*Ca[j]<worst[0]: worst=(12*Ca[j],(int(a[j]),bb))
    print('%-8s stable=%s  ergodic: min 12C=%.3e at beta=%.5f (%.2f MHz-equiv), #neg=%d/%d | rational b<=1000: #neg=%d/%d, min 12C=%.3e at %s'%(nm,st,12*C[i],betas[i],betas[i]*4e3,int(((C<0)&ok).sum()),int(ok.sum()),nneg,ntot,worst[0],worst[1]))
    res[nm]=(betas,C)
np.savez('gos_scan.npz',**{k:np.vstack(v) for k,v in res.items()})
print('time',time.time()-t0)
