import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  batchOptima,
  classifyPole,
  conventionalStep,
  fixedXMuMax,
  fixedXPole,
  gaussianAlmostSureMuMax,
  gaussianLyapunov,
  meanSquareFactor,
  meanSquareMuMax,
  runScalarLms,
  sgn,
  signErrorStep,
  signSignStep,
} from './lms'

const golden = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))

describe('lms：單步更新', () => {
  it('T01: a=3, w0=1, x=2, μ=0.1 ⇒ w1=1.8, w2=2.28（含 golden vector）', () => {
    const s1 = conventionalStep({ w: 1, x: 2, y: 6, mu: 0.1 })
    const s2 = conventionalStep({ w: s1.w, x: 2, y: 6, mu: 0.1 })
    expect(s1.e).toBeCloseTo(4, 14)
    expect(s1.w).toBeCloseTo(1.8, 14)
    expect(s2.e).toBeCloseTo(2.4, 14)
    expect(s2.w).toBeCloseTo(2.28, 14)
    const v = golden('T01')
    const flat = JSON.stringify(v.expected)
    expect(flat).toContain('1.8')
    expect(flat).toContain('2.28')
  })

  it('sign 慣例明定（E40）', () => {
    expect(sgn(0, 'zero')).toBe(0)
    expect(sgn(0, 'plus')).toBe(1)
    expect(sgn(0, 'minus')).toBe(-1)
    expect(sgn(-2)).toBe(-1)
  })

  it('三種演算法的更新量差異（a=3, x=1, w=1, μ=0.2）', () => {
    expect(conventionalStep({ w: 1, x: 1, y: 3, mu: 0.2 }).w).toBeCloseTo(1.4, 14)
    expect(signErrorStep({ w: 1, x: 1, y: 3, mu: 0.2 }).w).toBeCloseTo(1.2, 14)
    // e = −6 − 1·(−2) = −4，sign(e)·sign(x) = (−1)(−1) = +1 ⇒ w = 1 + 0.2 = 1.2
    expect(signSignStep({ w: 1, x: -2, y: -6, mu: 0.2 }).w).toBeCloseTo(1.2, 14)
  })
})

describe('lms：穩定性', () => {
  it('T02: 固定 x=2 ⇒ 0 < μ < 0.5；μ=0.25 一步到位', () => {
    expect(fixedXMuMax(2)).toBeCloseTo(0.5, 15)
    expect(classifyPole(fixedXPole(0.25, 2))).toBe('deadbeat')
    expect(classifyPole(fixedXPole(0.1, 2))).toBe('monotone')
    expect(classifyPole(fixedXPole(0.4, 2))).toBe('oscillating')
    expect(classifyPole(fixedXPole(0.5, 2))).toBe('boundary')
    expect(classifyPole(fixedXPole(0.6, 2))).toBe('divergent')
    const r = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.6, steps: 40, x: { kind: 'fixed', value: 2 } })
    expect(Math.abs(r.delta[40])).toBeGreaterThan(1e3)
  })

  it('T03: Gaussian x ⇒ mean-square 上限 2/3（封閉式 g(2/3)=1，勘誤 E14）', () => {
    expect(meanSquareMuMax(1, 3)).toBeCloseTo(2 / 3, 15)
    expect(meanSquareFactor(2 / 3, 1, 3)).toBeCloseTo(1, 14)
    expect(meanSquareFactor(0.5, 1, 3)).toBeLessThan(1)
    expect(meanSquareFactor(0.8, 1, 3)).toBeGreaterThan(1)
  })

  it('almost-sure 上限 ≈ 2.4212（E14，scipy 數值積分 2.421249521）', () => {
    expect(gaussianLyapunov(2 / 3)).toBeCloseTo(-0.48644, 3)
    expect(gaussianLyapunov(2)).toBeCloseTo(-0.116247, 3)
    expect(gaussianLyapunov(2.5)).toBeCloseTo(0.020625, 3)
    expect(gaussianAlmostSureMuMax()).toBeCloseTo(2.42125, 3)
  })
})

describe('lms：批次最佳解與決定性', () => {
  it('y=[0,0,0,10] ⇒ MSE 2.5、MAE 0', () => {
    expect(batchOptima([0, 0, 0, 10])).toEqual({ mse: 2.5, maeLow: 0, maeHigh: 0 })
  })
  it('同 seed 可重現', () => {
    const p = { variant: 'sign_error' as const, a: 3, w0: 0, mu: 0.05, steps: 200, x: { kind: 'gaussian' as const, sigma: 1 }, noiseSigma: 0.5, seed: 7 }
    expect(Array.from(runScalarLms(p).w)).toEqual(Array.from(runScalarLms(p).w))
  })
})
