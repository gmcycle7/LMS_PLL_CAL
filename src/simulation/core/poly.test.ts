import { describe, expect, it } from 'vitest'
import { cAbs, type Complex } from '@/simulation/core/complex'
import { eigvals } from '@/simulation/core/linalg'
import {
  polyAdd,
  polyDer,
  polyFromRoots,
  polyMul,
  polyResidual,
  polyRoots,
  polyTrim,
  polyval,
  polyvalC,
  ratvalC,
} from '@/simulation/core/poly'

const expectRootsClose = (got: Complex[], ref: Complex[], tol: number): void => {
  expect(got.length).toBe(ref.length)
  got.forEach((z, i) => {
    expect(Math.abs(z.re - ref[i].re)).toBeLessThan(tol)
    expect(Math.abs(z.im - ref[i].im)).toBeLessThan(tol)
  })
}

describe('poly：求值與代數運算', () => {
  it('polyval / polyvalC（降冪係數）', () => {
    expect(polyval([1, -1.8, 1.04], 2)).toBeCloseTo(4 - 3.6 + 1.04, 15)
    expect(polyval([], 3)).toBe(0)
    // p(z) = z² + 1 在 z = j → 0
    const v = polyvalC([1, 0, 1], { re: 0, im: 1 })
    expect(v.re).toBe(0)
    expect(v.im).toBe(0)
    // p(z) = 2z³ − z + 5 在 z = 1 + 2j：2(1+2j)³ − (1+2j) + 5 = 2(−11 − 2j) + 4 − 2j = −18 − 6j
    const w = polyvalC([2, 0, -1, 5], { re: 1, im: 2 })
    expect(w.re).toBeCloseTo(-18, 13)
    expect(w.im).toBeCloseTo(-6, 13)
    const r = ratvalC([1], [1, -0.5], { re: 1, im: 0 })
    expect(r.re).toBeCloseTo(2, 15)
  })

  it('polyMul / polyAdd / polyDer / polyTrim / polyFromRoots', () => {
    expect(polyMul([1, -1], [1, 1])).toEqual([1, 0, -1])
    expect(polyAdd([1, 2, 3], [10])).toEqual([1, 2, 13])
    expect(polyDer([3, 2, 1])).toEqual([6, 2])
    expect(polyDer([5])).toEqual([0])
    expect(polyTrim([0, 0, 1, 2])).toEqual([1, 2])
    expect(polyTrim([0, 0])).toEqual([])
    const p = polyFromRoots([
      { re: 0.9, im: 0.4 },
      { re: 0.9, im: -0.4 },
    ])
    expect(p[0]).toBe(1)
    expect(p[1]).toBeCloseTo(-1.8, 15)
    expect(p[2]).toBeCloseTo(0.97, 15)
  })
})

describe('poly：polyRoots', () => {
  it('T09: z² − 1.8z + 0.8 + 0.2μ（μ = 1.2）→ 0.9 ± j0.47958，|z| = √1.04 = 1.019803902718557', () => {
    const r = polyRoots([1, -1.8, 0.8 + 0.2 * 1.2])
    // √0.92/2 = 0.47958315233127197（mpmath）
    expectRootsClose(
      r,
      [
        { re: 0.9, im: 0.47958315233127197 },
        { re: 0.9, im: -0.47958315233127197 },
      ],
      1e-15,
    )
    expect(Math.abs(cAbs(r[0]) - 1.019803902718557)).toBeLessThan(1e-15)
    // 直接以 z² − 1.8z + 1.04 亦同
    expectRootsClose(polyRoots([1, -1.8, 1.04]), r, 1e-15)
  })

  it('延遲 d = 2：z³ − z² + 0.618 = 0（mpmath polyroots），|z|max = 0.99998405 < 1', () => {
    const r = polyRoots([1, -1, 0, 0.618])
    expectRootsClose(
      r,
      [
        { re: 0.8090098596528575, im: 0.5877679301738856 },
        { re: 0.8090098596528575, im: -0.5877679301738856 },
        { re: -0.6180197193057151, im: 0 },
      ],
      1e-14,
    )
    expect(Math.abs(cAbs(r[0]) - 0.9999840462509538)).toBeLessThan(1e-14)
    // 臨界增益 g = 2 sin(π/10)：主極點恰在單位圓上
    const rc = polyRoots([1, -1, 0, 2 * Math.sin(Math.PI / 10)])
    expect(Math.abs(cAbs(rc[0]) - 1)).toBeLessThan(1e-14)
  })

  it('一次、去除前導零、尾端零（z = 0 根）、常數與空多項式', () => {
    expect(polyRoots([2, -1])).toEqual([{ re: 0.5, im: 0 }])
    // 0·z⁴ + 0·z³ + z² − 3z + 2 → 根 2、1
    expectRootsClose(
      polyRoots([0, 0, 1, -3, 2]),
      [
        { re: 2, im: 0 },
        { re: 1, im: 0 },
      ],
      1e-15,
    )
    // z³ − z² = z²(z − 1)
    const r = polyRoots([1, -1, 0, 0])
    expectRootsClose(
      r,
      [
        { re: 1, im: 0 },
        { re: 0, im: 0 },
        { re: 0, im: 0 },
      ],
      1e-15,
    )
    expect(polyRoots([5])).toEqual([])
    expect(polyRoots([0, 0])).toEqual([])
    expect(polyRoots([])).toEqual([])
    expect(() => polyRoots([1, NaN])).toThrow()
  })

  it('重根（repeated roots）：誤差 ~ε^{1/m}', () => {
    // (z − 1)³：三重根，誤差約 ε^{1/3} ≈ 6e-6
    const r3 = polyRoots([1, -3, 3, -1])
    expect(r3.length).toBe(3)
    for (const z of r3) expect(cAbs({ re: z.re - 1, im: z.im })).toBeLessThan(1e-4)
    // (z − 1)²(z + 2) = z³ − 3z + 2：二重根誤差約 √ε ≈ 1.5e-8
    const r2 = polyRoots([1, 0, -3, 2])
    expect(r2[0].re).toBeCloseTo(-2, 13)
    expect(Math.abs(r2[0].im)).toBeLessThan(1e-13)
    for (const z of r2.slice(1)) expect(cAbs({ re: z.re - 1, im: z.im })).toBeLessThan(1e-6)
    // 二次重根 (z − 0.5)² 封閉式為精確值
    expectRootsClose(
      polyRoots([1, -1, 0.25]),
      [
        { re: 0.5, im: 0 },
        { re: 0.5, im: 0 },
      ],
      1e-15,
    )
  })

  it('z⁵ − 1：單位根，結果為精確共軛對且依 |z|、實部排序', () => {
    const r = polyRoots([1, 0, 0, 0, 0, -1])
    expect(r[0].re).toBeCloseTo(1, 14)
    expect(r[0].im).toBe(0)
    for (const z of r) expect(Math.abs(cAbs(z) - 1)).toBeLessThan(1e-14)
    expect(r[1].im).toBe(-r[2].im)
    expect(r[1].re).toBeCloseTo(Math.cos((2 * Math.PI) / 5), 14)
    expect(r[1].im).toBeCloseTo(Math.sin((2 * Math.PI) / 5), 14)
  })

  it('8 次隨機係數（首項 0.00123，根跨 4 個數量級）對照 mpmath polyroots', () => {
    const p = [0.00123, 0.298746, -0.274138, -0.890592, -0.454671, -0.991647, 0.060144, 1.340215, -0.492207]
    const ref: Complex[] = [
      { re: -243.7850024886721, im: 0 },
      { re: 2.4978232223732224, im: 0 },
      { re: -1.2511768293406003, im: 0.31323546308535066 },
      { re: -1.2511768293406003, im: -0.31323546308535066 },
      { re: -0.0640098478666969, im: 1.221171322224813 },
      { re: -0.0640098478666969, im: -1.221171322224813 },
      { re: 0.5759492037088831, im: 0 },
      { re: 0.45867658773626174, im: 0 },
    ]
    const r = polyRoots(p)
    r.forEach((z, i) => {
      const tol = 1e-13 * Math.max(1, cAbs(ref[i]))
      expect(Math.abs(z.re - ref[i].re)).toBeLessThan(tol)
      expect(Math.abs(z.im - ref[i].im)).toBeLessThan(tol)
    })
  })

  it('Wilkinson 10 次 ∏(z − k)：根 1…10（病態，相對 1e-9）', () => {
    const w = [1, -55, 1320, -18150, 157773, -902055, 3416930, -8409500, 12753576, -10628640, 3628800]
    const r = polyRoots(w)
    expect(r.length).toBe(10)
    r.forEach((z, i) => {
      expect(Math.abs(z.re - (10 - i)) / (10 - i)).toBeLessThan(1e-9)
      expect(Math.abs(z.im)).toBeLessThan(1e-9)
    })
  })

  it('與 polyFromRoots 往返，且殘差小', () => {
    const roots: Complex[] = [
      { re: 0.95, im: 0.2 },
      { re: 0.95, im: -0.2 },
      { re: -0.3, im: 0 },
      { re: 0.5, im: 0.5 },
      { re: 0.5, im: -0.5 },
    ]
    const p = polyFromRoots(roots)
    const r = polyRoots(p)
    for (const z of r) expect(polyResidual(p, z)).toBeLessThan(1e-14)
    // 與 companion matrix 特徵值一致
    const n = p.length - 1
    const C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === 0 ? -p[j + 1] : i === j + 1 ? 1 : 0)))
    expectRootsClose(r, eigvals(C), 1e-12)
    expect(polyvalC(p, roots[0]).re).toBeCloseTo(0, 14)
  })
})
