"""sspll_golden -- golden model for the DTC-GOS / PMUX-PHOS sign-error-LMS polarity study
(f_ref = 4 GHz, closed-loop |T| -3 dB = 320 MHz, 8-phase PMUX + input DTC).

Modules
  loops        L1 Type-I SSPLL, L2 Type-II SSPLL, L3 CPPLL (+ P-only remedies), closed forms
  regressors   fractional-phase sequences, GOS / PHOS regressors, GMAC pre-filter variants
  predictions  mean-GMAC theory: exact periodic, ergodic harmonic sums, bounds, large signal, offsets
  simulator    replica of the time-domain slope measurement, closed-loop sign-error block LMS
"""
from .loops import (BW, F_REF, NPH, Loop, make_L1, make_L2, make_L3, make_P_only_L2, make_P_only_L3,
                    nominal_loops)

__all__ = ['BW', 'F_REF', 'NPH', 'Loop', 'make_L1', 'make_L2', 'make_L3', 'make_P_only_L2',
           'make_P_only_L3', 'nominal_loops']
__version__ = '1.0.0'
