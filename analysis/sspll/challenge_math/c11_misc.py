import math, numpy as np
from mloops import *
from mreg import *
L2n=L2(60); L3n=L3(60)
f=np.linspace(1e-6,0.5,400001); x=np.exp(-1j*TP*f)
for lp in (L2n,L3n):
    print(lp.name,'2diff min ReGamma %.4f ; D=1 min %.4f'%(np.real(lp.H(f)*(1-np.conj(x))**2).min(),np.real(lp.H(f)*np.conj(x)**-1).min()))
# GOS-PHOS block decoupling for 8|Q vs 8 not | Q
for (P,Q) in ((85,4096),(13,1000),(7,120),(12,383),(1,50)):
    C,X=C_time(L2n,P,Q)
    print('P/Q=%d/%d 8|Q=%s  max|C[0,1:]|=%.2e max|C[1:,0]|=%.2e  C00=%.3e'%(P,Q,Q%8==0,np.abs(C[0,1:]).max(),np.abs(C[1:,0]).max(),C[0,0]))
# theorem sanity: random Gamma with Re>=0 (random stable minimum-phase-ish filters as G with H) -> min Re eig >=0
rng=np.random.default_rng(1); worst=1
for t in range(300):
    Q=int(rng.integers(9,300)); P=int(rng.integers(1,Q))
    if math.gcd(P,Q)!=1: continue
    ff=np.arange(Q)/Q
    # arbitrary kernel with Re>=0: |A|^2 * (positive) + j*anything
    G=lambda fq: np.abs(1+0.9*np.exp(-2j*np.pi*fq*3))**2*(1+0.0)+1j*np.sin(7*2*np.pi*fq)*5
    X=X_of(P,Q)
    F=np.fft.fft(X,axis=0)/Q
    Cg=np.real(np.conj(F).T@(G(ff)[:,None]*F))
    ev=np.linalg.eigvals(Cg)
    worst=min(worst,ev.real.min())
print('theorem sanity: min Re eig over random alpha with Re Gamma>=0 kernel:',worst)
