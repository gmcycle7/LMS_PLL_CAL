import math, numpy as np
from mloops import *
from mreg import *
L1n=L1(); L2n=L2(60); L3n=L3(60)
f=np.concatenate([np.geomspace(1e-7,1e-3,4000,endpoint=False),np.linspace(1e-3,0.5,200001)])
x=np.exp(-1j*TP*f)
# --- 1diff closed form margins and disc constant c = min Re G/|G|^2
for lp in (L1n,L2n,L3n):
    g=1-np.cos(TP*f)+np.real((1-x)*lp.L(f))
    G=lp.H(f)*(1-np.conj(x))
    print(lp.name,'1diff margin min g=%.4f ; disc const min ReG/|G|^2=%.4f ; min ReG=%.3e'%(g.min(),(G.real/np.abs(G)**2).min(),G.real.min()))
# --- filtered-x phase mismatch: min cos(angle H - angle Hhat)
def bwscale(build,s):
    pass
cands={'exact':L2n,'L1model':L1n,'L2pm45':L2(45),'L2pm75':L2(75),'L2lat2':L2(60,lat=2),
       'L2Ki*0.5':L2(Kp=L2n.p['Kp'],Ki=0.5*L2n.p['Ki']),'L2Ki*2':L2(Kp=L2n.p['Kp'],Ki=2*L2n.p['Ki']),
       'L2Kp*0.5':L2(Kp=0.5*L2n.p['Kp'],Ki=L2n.p['Ki']),'L2Kp*2':L2(Kp=2*L2n.p['Kp'],Ki=L2n.p['Ki']),
       'L2gain*0.5':L2(Kp=0.5*L2n.p['Kp'],Ki=0.5*L2n.p['Ki']),'L2gain*2':L2(Kp=2*L2n.p['Kp'],Ki=2*L2n.p['Ki']),
       'L2gain*3':L2(Kp=3*L2n.p['Kp'],Ki=3*L2n.p['Ki'])}
for real_name,real in (('L2',L2n),('L3',L3n)):
    H=real.H(f)
    for nm,m in cands.items():
        Hh=m.H(f)
        c=np.real(H*np.conj(Hh))/(np.abs(H)*np.abs(Hh))
        print('  fx real=%s model=%-10s min cos(dphi)=%+.4f at %.2f MHz  min Re=%.2e'%(real_name,nm,c.min(),f[c.argmin()]*4e3,np.real(H*np.conj(Hh)).min()))
# --- finite-mu discrete mean stability: per-block multiplier 1 - kappa/tau (sim normalisation: tau=25 blocks for kappa=1)
for lp in (L2n,L3n):
    for tau in (25,10,5):
        nflip=0;ex=[]
        for j in range(1,2049):
            g=math.gcd(j,4096);P,Q=j//g,4096//g
            C,X=C_time(lp,P,Q)
            Xc=X[:,1:]-X[:,1:].mean(0);cov=Xc.T@Xc/Q
            w,V=np.linalg.eigh(cov);V=V[:,w>1e-9]
            ev=8*np.linalg.eigvals(V.T@C[1:,1:]@V)
            ok_ct=np.all(ev.real>0)
            ok_dt=np.all(np.abs(1-ev/tau)<1)
            if ok_ct and not ok_dt:
                nflip+=1; k=np.argmax(np.abs(1-ev/tau)); ex.append((round(j*4e3/4096,1),complex(np.round(ev[k],4))))
        print(lp.name,'tau=%d blocks: alpha with Re eig>0 but |1-mu K_q lambda|>=1: %d'%(tau,nflip),ex[:6])
