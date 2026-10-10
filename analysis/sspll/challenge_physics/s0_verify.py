import numpy as np, math
from phys import *
l1=L1(); l2=L2(60); l3=L3(60,'impulse')
for lp in (l1,l2,l3):
    fc,pm=lp.pm()
    print(lp.name, {k:round(v,7) for k,v in lp.params.items() if isinstance(v,float)}, 'f3dB=%.6f MHz'%(lp.f3db()*4e3),'fc=%.2f MHz PM=%.2f'%(fc*4e3,pm),
          'bands', [(round(a*4e3,3),round(b*4e3,3),round(c,4),round(d*4e3,1)) for a,b,c,d in lp.reH_bands()])
# PHOS 8*min Re eig at alpha=1/50 (L2) vs consolidated -0.1385
for lp in (l1,l2,l3):
    C,occ,_=C_periodic(lp,1,50)
    print(lp.name,'alpha=1/50 PHOS 8*minRe eig', 8*phos_eigs(C).real.min(), 'GOS 12C', 12*(C[0,0]))
