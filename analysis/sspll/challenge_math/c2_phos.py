import math, numpy as np
from mloops import *
from mreg import *
L1n=L1(); L2n=L2(60); L3n=L3(60)
w1=64*math.sin(math.pi/8)**2/math.pi**2
print('w1',w1)
# sum of mode-1 weights
l=np.concatenate([1+8*np.arange(0,10**6),1-8*np.arange(1,10**6+1)]).astype(float)
print('sum w_l (m=1)', np.sum(64*np.sin(np.pi*l/8)**2/(np.pi*l)**2))
# ergodic formula vs exact periodic, 8|Q, large Q
Hf=lambda lp: (lambda f: lp.H(np.where(f==0,1e-300,f)))
for lp in (L2n,L3n):
    for (P,Q) in ((85,4096),(171,8192),(1013,8192),(3,512*3*8)):
        C,X=C_time(lp,P,Q)
        Cp=C[1:,1:]
        ev=np.linalg.eigvals(Cp)
        k=np.arange(8)
        lam_ex=[np.exp(-2j*np.pi*m*k/8)@Cp@np.exp(2j*np.pi*m*k/8)/8 for m in range(8)]
        lam_er=[lam_ergodic(Hf(lp),P/Q,m) for m in range(1,8)]
        print(lp.name,P,Q,'circulant err',np.max(np.abs(Cp-np.roll(np.roll(Cp,1,0),1,1))),' lam1 exact %.6f%+.6fj ergodic %.6f%+.6fj'%(lam_ex[1].real,lam_ex[1].imag,lam_er[0].real,lam_er[0].imag),
              'lam0 exact %.2e'%abs(lam_ex[0]), 'lam4 ex %.6f er %.6f'%(lam_ex[4].real,lam_er[3].real))
# max Re H for each loop (exclude f=0)
f=np.linspace(1e-6,0.5,500001)
for lp in (L2n,L3n):
    h=lp.H(f).real
    thr=-(1-w1)*h.max()/w1
    sure=f[(h<thr)]
    # impossible: w1 ReH + (1-w1) min >= 0
    imp=f[(w1*h+(1-w1)*h.min())<0]
    print(lp.name,'maxReH %.5f minReH %.5f thr %.5f sure band MHz [%.3f, %.3f]  m1-inversion possible only below %.2f MHz'%(h.max(),h.min(),thr,sure.min()*4e3,sure.max()*4e3,imp.max()*4e3))
