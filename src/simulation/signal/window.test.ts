import { describe, expect, it } from 'vitest'
import { blackmanHarris, getWindow, hann, rectangular, windowStats } from '@/simulation/signal/window'

// 參考值：scipy 1.17 —— get_window(name, 8)（periodic）與 windows.<name>(8)（symmetric）
const HANN8 = [0.0, 0.14644660940672627, 0.5, 0.8535533905932737, 1.0, 0.8535533905932737, 0.5, 0.14644660940672627]
const HANN8_SYM = [0.0, 0.18825509907063326, 0.6112604669781572, 0.9504844339512095, 0.9504844339512095, 0.6112604669781572, 0.18825509907063326, 0.0]
const BH8 = [6.0000000000001025e-5, 0.021735837018679628, 0.21747000000000008, 0.6957641629813204, 1.0, 0.6957641629813204, 0.21747000000000008, 0.021735837018679628]
const BH8_SYM = [6.0000000000001025e-5, 0.0333917234781512, 0.33283350429856506, 0.8893697722232838, 0.8893697722232838, 0.33283350429856506, 0.0333917234781512, 6.0000000000001025e-5]

function expectArrayClose(a: ArrayLike<number>, b: readonly number[], digits = 14): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], digits)
}

describe('window 係數 vs scipy.signal', () => {
  it('hann：periodic（預設）與 symmetric', () => {
    expectArrayClose(hann(8), HANN8)
    expectArrayClose(hann(8, true), HANN8_SYM)
    expectArrayClose(getWindow('hann', 8), HANN8)
  })

  it('blackmanHarris：periodic（預設）與 symmetric', () => {
    expectArrayClose(blackmanHarris(8), BH8)
    expectArrayClose(blackmanHarris(8, true), BH8_SYM)
  })

  it('rectangular 與退化長度', () => {
    expect(Array.from(rectangular(4))).toEqual([1, 1, 1, 1])
    expect(Array.from(hann(1))).toEqual([1])
    expect(hann(0).length).toBe(0)
    expect(() => hann(2.5)).toThrow()
  })
})

describe('windowStats', () => {
  it('periodic Hann：coherent gain = 0.5、ENBW = 1.5 bins（精確）', () => {
    const s = windowStats(hann(1024))
    expect(s.coherentGain).toBeCloseTo(0.5, 14)
    expect(s.enbwBins).toBeCloseTo(1.5, 13)
  })

  it('symmetric Hann N=1000：scipy 參考 ENBW = 1.5015015015015016，CG = 0.4995', () => {
    const s = windowStats(hann(1000, true))
    expect(s.enbwBins).toBeCloseTo(1.5015015015015016, 12)
    expect(s.coherentGain).toBeCloseTo(0.4995, 13)
  })

  it('periodic Blackman–Harris：ENBW = (a0² + (a1²+a2²+a3²)/2)/a0² = 2.0043529382170475，CG = a0', () => {
    const s = windowStats(blackmanHarris(1024))
    expect(s.enbwBins).toBeCloseTo(2.0043529382170475, 12)
    expect(s.coherentGain).toBeCloseTo(0.35875, 14)
  })

  it('rectangular：CG = 1、ENBW = 1', () => {
    const s = windowStats(rectangular(37))
    expect(s.coherentGain).toBe(1)
    expect(s.enbwBins).toBe(1)
    expect(s.sumW).toBe(37)
    expect(s.sumW2).toBe(37)
  })
})
