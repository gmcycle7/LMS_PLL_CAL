import { describe, expect, it } from 'vitest'
import {
  c,
  cAbs,
  cAbs2,
  cAdd,
  cArg,
  cConj,
  cDiv,
  cExp,
  cExpj,
  cInv,
  cIsClose,
  cLog,
  cMul,
  cNeg,
  cPolar,
  cScale,
  cSqrt,
  cSub,
  cToString,
} from '@/simulation/core/complex'

describe('complex', () => {
  it('四則運算、共軛、模與幅角', () => {
    const a = c(1, 2)
    const b = c(3, -4)
    expect(cAdd(a, b)).toEqual(c(4, -2))
    expect(cSub(a, b)).toEqual(c(-2, 6))
    expect(cMul(a, b)).toEqual(c(11, 2))
    // (1+2j)/(3−4j) = (−5 + 10j)/25 = −0.2 + 0.4j
    const q = cDiv(a, b)
    expect(q.re).toBeCloseTo(-0.2, 15)
    expect(q.im).toBeCloseTo(0.4, 15)
    expect(cAbs(b)).toBe(5)
    expect(cAbs2(b)).toBe(25)
    expect(cArg(c(0, 1))).toBe(Math.PI / 2)
    expect(cConj(a)).toEqual(c(1, -2))
    expect(cNeg(a)).toEqual(c(-1, -2))
    expect(cScale(a, 2)).toEqual(c(2, 4))
    expect(cIsClose(cMul(cInv(b), b), c(1), 1e-15)).toBe(true)
    // Smith 演算法：極大／極小數值不 overflow
    const big = cDiv(c(1e300, 1e300), c(1e300, 1e300))
    expect(cIsClose(big, c(1), 1e-15)).toBe(true)
  })

  it('cExpj / cPolar / cExp / cLog', () => {
    expect(cIsClose(cExpj(Math.PI / 2), c(0, 1), 0, 1e-16)).toBe(true)
    expect(cIsClose(cPolar(2, Math.PI), c(-2, 0), 0, 1e-15)).toBe(true)
    // e^{1 + jπ/3} = e(0.5 + j√3/2)
    expect(cIsClose(cExp(c(1, Math.PI / 3)), c(Math.E * 0.5, (Math.E * Math.sqrt(3)) / 2), 1e-15)).toBe(true)
    expect(cIsClose(cLog(cExp(c(0.3, -2))), c(0.3, -2), 1e-15)).toBe(true)
  })

  it('cSqrt 主值：√(−4) = 2j、√(3+4j) = 2+j、√(−3−4j) = 1−2j、√(0.92 j²)', () => {
    expect(cSqrt(c(-4))).toEqual(c(0, 2))
    expect(cSqrt(c(3, 4))).toEqual(c(2, 1))
    expect(cSqrt(c(-3, -4))).toEqual(c(1, -2))
    expect(cSqrt(c(0))).toEqual(c(0))
    const s = cSqrt(c(-0.92))
    expect(s.re).toBe(0)
    expect(s.im / 2).toBeCloseTo(0.47958315233127197, 16)
  })

  it('cToString', () => {
    expect(cToString(c(0.9, 0.47958315233127197))).toBe('0.9 + j0.4796')
    expect(cToString(c(0.9, -0.47958315233127197))).toBe('0.9 - j0.4796')
    expect(cToString(c(-0.618))).toBe('-0.618')
    expect(cToString(c(0, -1))).toBe('-j1')
  })
})
