"""Independent regressor / C-matrix machinery (time-domain periodic steady state)."""
import math, numpy as np
from fractions import Fraction
NPH=8
def seq(P,Q):
    n=np.arange(Q)
    s=(n*P)%Q              # phi = s/Q exactly
    t=NPH*s
    p=t//Q; rho=(t%Q)/Q
    return rho,p
def X_of(P,Q):
    rho,p=seq(P,Q)
    X=np.zeros((Q,1+NPH)); X[:,0]=rho; X[np.arange(Q),1+p]=1
    return X
def C_time(lp,P,Q,Gpre=None):
    """C_ij = <r_i[n] y_j[n]> over one period, y_j = periodic steady-state of h_PD * x_j.
    Computed via circular convolution with H sampled at k/Q (exact for periodic steady state)."""
    X=X_of(P,Q)
    f=np.arange(Q)/Q
    Hk=lp.H(np.where(f==0,1e-300,f)); Hk[0]=0.0   # H(1)=0 for type>=1
    Y=np.real(np.fft.ifft(np.fft.fft(X,axis=0)*Hk[:,None],axis=0))
    R=X if Gpre is None else np.real(np.fft.ifft(np.fft.fft(X,axis=0)*Gpre(f)[:,None],axis=0))
    return R.T@Y/Q, X
def obs_min_eig(C,X,idx):
    Xc=X[:,idx]-X[:,idx].mean(0)
    cov=Xc.T@Xc/len(X)
    w,V=np.linalg.eigh(cov)
    V=V[:,w>1e-9*max(np.trace(cov),1e-30)]
    if V.shape[1]==0: return np.nan,0
    ev=np.linalg.eigvals(V.T@C[np.ix_(idx,idx)]@V)
    return ev.real.min(),V.shape[1]
def lam_ergodic(Gf,alpha,m,M=200000):
    l=np.concatenate([m+8*np.arange(0,M),m-8*np.arange(1,M+1)]).astype(float)
    w=np.sin(np.pi*l/8)**2/(np.pi*l)**2
    return 8*np.sum(w*Gf((l*alpha)%1.0))
