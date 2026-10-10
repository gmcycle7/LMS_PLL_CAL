import math, numpy as np
from mloops import *
print('L1 with discrete parasitic pole (1-p)/(1-p z^-1), retuned to 320 MHz; closed-form criterion K(1/2+p/(1-p))<1')
for fp in (4000e6,2000e6,1000e6,640e6,480e6,400e6,320e6,250e6,200e6):
    try:
        lp=L1(fpole=fp)
    except Exception as e:
        print(fp/1e6,'fail',e); continue
    K=lp.p['K']; p=math.exp(-TP*fp/FREF)
    st,_=lp.stable()
    print('  fpole %5.0f MHz K=%.4f crit=%.3f PM=%.1f stable=%s band(MHz)=%s'%(fp/1e6,K,K*(0.5+p/(1-p)),lp.pm()[1],st,[(round(a*4e3,2),round(b*4e3,2),round(c,4)) for a,b,c,_ in neg_band(lp)]))
for lat in (1,2,3):
    lp=L1(lat=lat); K=lp.p['K']
    print('  L1 lat=%d K=%.4f  K(d-1/2)=%.3f  PM=%.1f band=%s'%(lat,K,K*(lat-0.5),lp.pm()[1],neg_band(lp)))
# L3 P-only closed form
L3n=L3(60); A=L3n.p['K']/L3n.p['wz']; p=L3n.p['p']
print('L3 P-only A=K/wz=%.5f p=%.4f  criterion A(1/2+p/(1-p))=%.4f (<1 => Re H>=0 for all f, exact)'%(A,p,A*(0.5+p/(1-p))))
# exact R||C2 (no C1>>C2 assumption): gain *b/(b-1), wp *(b-1)/b
b=L3n.p['b']; A2=A*b/(b-1); wp2=L3n.p['wp']*(b-1)/b; p2=math.exp(-wp2)
print('   exact-hold variant A=%.5f p=%.4f criterion %.4f'%(A2,p2,A2*(0.5+p2/(1-p2))))
for AA,pp,lab in ((A,p,'C1>>C2'),(A2,p2,'exact R||C2')):
    lp=LP(conv([0,AA*(1-pp)]),conv([1,-1],[1,-pp]),'P')
    print('   ',lab,'f3dB %.1f MHz PM %.1f band %s'%(lp.f3db()*4e3,lp.pm()[1],neg_band(lp)))
