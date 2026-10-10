import { renderTex } from '@/components'
import { db10, db20, normCdf, normSf } from '@/simulation/core'
import { kq, linearizationRelError } from '@/simulation/models/comparator'
import {
  DB_POINTS,
  HAND_CONSTANTS,
  PHI_APPROX_POINTS,
  PHI_SLOPE_0,
  dbConvert,
  dbRows,
  handConstant,
  phiApproxRows,
  phiCubic,
  phiGrid,
  phiLinear,
  phiLinearLimit,
  phiLookup,
  phiLookupSteps,
  phiTable,
  quantileRows,
  ratioRows,
  slopeOverestimateLimit,
} from './tools'

const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
const texOk = (tex: string, display = false): boolean => !/katex-error|c-tex-error/.test(renderTex(tex, display))

describe('Φ(z) 表', () => {
  const table = phiTable()

  it('z = 0 … 3 每 0.1 一格，共 31 格，每一格都是 normCdf(z)', () => {
    expect(table).toHaveLength(31)
    table.forEach((e, i) => {
      expect(e.index).toBe(i)
      expect(e.z).toBe(i / 10)
      expect(e.phi).toBe(normCdf(i / 10))
      expect(Math.abs(e.shown - e.phi)).toBeLessThanOrEqual(0.5e-4 + 1e-12)
    })
    expect(table[0].shown).toBe(0.5)
    expect(table[30].z).toBe(3)
  })

  it('與教科書的標準常態表一致（4 位小數）', () => {
    const at = (z: number) => table[Math.round(z * 10)].shown
    expect(at(0.5)).toBe(0.6915)
    expect(at(1)).toBe(0.8413)
    expect(at(1.5)).toBe(0.9332)
    expect(at(2)).toBe(0.9772)
    expect(at(2.5)).toBe(0.9938)
    expect(at(3)).toBe(0.9987)
  })

  it('單調遞增', () => {
    for (let i = 1; i < table.length; i++) expect(table[i].phi).toBeGreaterThan(table[i - 1].phi)
  })

  it('排版格線：10 列 × 4 欄，「3」那一欄只有 3.0', () => {
    const grid = phiGrid()
    expect(grid).toHaveLength(10)
    grid.forEach((row, t) => {
      expect(row.cells).toHaveLength(4)
      row.cells.slice(0, 3).forEach((c, u) => expect(c?.z).toBe((u * 10 + t) / 10))
      if (t === 0) expect(row.cells[3]?.z).toBe(3)
      else expect(row.cells[3]).toBeNull()
    })
    expect(grid.flatMap((r) => r.cells).filter(Boolean)).toHaveLength(31)
  })
})

describe('查表＋線性內插', () => {
  it('格點上直接讀表；兩格之間的內插重現手算的每個中間量', () => {
    const g = phiLookup(1.3)
    expect(g.onGrid).toBe(true)
    expect(g.phi).toBe(0.9032)

    const l = phiLookup(0.37)
    expect(l.onGrid).toBe(false)
    expect([l.z0, l.z1]).toEqual([0.3, 0.4])
    expect([l.phi0, l.phi1]).toEqual([0.6179, 0.6554])
    expect(l.t).toBeCloseTo(0.7, 12)
    expect(l.diff).toBeCloseTo(0.0375, 12)
    expect(l.increment).toBeCloseTo(0.02625, 12)
    expect(l.phi).toBe(0.6442) // 0.6179 + 0.02625 = 0.64415 → 進位
    expect(l.exact).toBe(normCdf(0.37))
  })

  it('負的 z 用 Φ(−z) = 1 − Φ(z)', () => {
    const p = phiLookup(1.25)
    const n = phiLookup(-1.25)
    expect(n.negative).toBe(true)
    expect(n.phi).toBeCloseTo(1 - p.phi, 12)
    expect(n.exact).toBeCloseTo(normSf(1.25), 15)
  })

  it('整張表掃一遍：內插誤差不超過 4.5×10⁻⁴（h²/8·max|φ′| ≈ 3×10⁻⁴，加上表值與結果各半格的捨入）', () => {
    let worst = 0
    for (let k = -300; k <= 300; k++) {
      const z = k / 100 + 0.003
      if (Math.abs(z) > 3) continue
      const l = phiLookup(z)
      expect(l.outOfTable).toBe(false)
      worst = Math.max(worst, Math.abs(l.error))
    }
    expect(worst).toBeLessThan(4.5e-4)
    expect(worst).toBeGreaterThan(1e-5) // 內插不是精確的：誤差真的被算出來了
  })

  it('|z| > 3 標示為超出表格', () => {
    const l = phiLookup(3.5)
    expect(l.outOfTable).toBe(true)
    expect(l.phi1).toBe(0.9987)
    expect(phiLookup(3).outOfTable).toBe(false)
    expect(phiLookup(3).onGrid).toBe(true)
  })

  it('逐步 TeX 都能渲染，而且顯示的數字自己算得出下一個等號', () => {
    for (const z of [0, 0.05, 0.37, -0.37, 1.3, -2.96, 3, 3.5, -4]) {
      const steps = phiLookupSteps(phiLookup(z))
      expect(steps.length, `z = ${z}`).toBeGreaterThan(0)
      for (const s of steps) {
        expect(texOk(s.tex, true), s.tex).toBe(true)
        expect(s.tex).not.toMatch(/NaN|undefined/)
        for (const m of s.why.matchAll(INLINE_MATH)) expect(texOk(m[1]), m[1]).toBe(true)
      }
    }
    const tex = phiLookupSteps(phiLookup(0.37)).map((s) => s.tex)
    expect(tex[0]).toContain('= 0.7')
    expect(tex[1]).toContain('0.6554 - 0.6179 = 0.0375')
    expect(tex[2]).toContain('0.6179 + 0.7\\times0.0375 = 0.6179 + 0.02625 = 0.6442')
    const neg = phiLookupSteps(phiLookup(-0.37)).map((s) => s.tex)
    expect(neg[neg.length - 1]).toContain('1 - 0.6442 = 0.3558')
  })
})

describe('小 |z| 近似 Φ(z) ≈ 0.5 + z/√(2π)', () => {
  it('z = 0.1、0.3、0.5 的誤差：切線高估，量級是 z³/(6√(2π))', () => {
    const rows = phiApproxRows()
    expect(rows.map((r) => r.z)).toEqual([...PHI_APPROX_POINTS])
    for (const r of rows) {
      expect(r.exact).toBe(normCdf(r.z))
      expect(r.linear).toBe(phiLinear(r.z))
      expect(r.linearError).toBeGreaterThan(0)
      const leading = (r.z ** 3 / 6) * PHI_SLOPE_0
      expect(r.linearError / leading).toBeGreaterThan(0.9)
      expect(r.linearError / leading).toBeLessThan(1)
      // 多留一項之後誤差小得多，而且變成低估
      expect(r.cubic).toBe(phiCubic(r.z))
      expect(Math.abs(r.cubicError)).toBeLessThan(r.linearError / 10)
      expect(r.cubicError).toBeLessThan(0)
      // 2Φ − 1 被高估的比例就是 comparator 線性化誤差（comparator.ts 的 linearizationRelError）
      expect(r.slopeOverestimate).toBeCloseTo(linearizationRelError(r.z), 12)
    }
    // 獨立的數值：Φ(0.1) = 0.539828、切線 0.539894
    expect(rows[0].exact).toBeCloseTo(0.539828, 6)
    expect(rows[0].linear).toBeCloseTo(0.539894, 6)
    expect(rows[2].linearError).toBeCloseTo(0.0080086, 6)
  })

  it('適用範圍：絕對誤差 10⁻³ ↔ |z| ≈ 0.247；K_q 線性化（相對於真值）高估 1% ↔ 約 0.245、5% ↔ 約 0.55', () => {
    const zAbs = phiLinearLimit(1e-3)
    expect(phiLinear(zAbs) - normCdf(zAbs)).toBeCloseTo(1e-3, 10)
    expect(zAbs).toBeGreaterThan(0.24)
    expect(zAbs).toBeLessThan(0.255)
    const z1 = slopeOverestimateLimit(0.01)
    const z5 = slopeOverestimateLimit(0.05)
    expect(linearizationRelError(z1)).toBeCloseTo(0.01, 9)
    expect(linearizationRelError(z5)).toBeCloseTo(0.05, 9)
    // 首項近似：高估 ≈ z²/6 ⇒ z ≈ √(6·rel)
    expect(z1).toBeGreaterThan(0.24)
    expect(z1).toBeLessThan(Math.sqrt(0.06))
    expect(z5).toBeGreaterThan(0.54)
    expect(z5).toBeLessThan(Math.sqrt(0.3))
  })

  it('切線斜率 1/√(2π) 的兩倍就是 σ_v = 1 時的 K_q', () => {
    expect(2 * PHI_SLOPE_0).toBeCloseTo(kq(1), 15)
    expect(handConstant('sqrt2overPi').value).toBeCloseTo(kq(1), 15)
  })
})

describe('反查、常數與 dB', () => {
  it('反查表：Φ(z_p) = p', () => {
    for (const r of quantileRows()) expect(normCdf(r.z)).toBeCloseTo(r.p, 10)
    expect(quantileRows([0.975])[0].z).toBeCloseTo(1.959964, 5)
  })

  it('常數：key 唯一、數值有限且與定義一致、說明文字的 TeX 可渲染且不含 NaN', () => {
    const keys = HAND_CONSTANTS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of HAND_CONSTANTS) {
      expect(Number.isFinite(c.value), c.key).toBe(true)
      expect(texOk(c.tex), c.tex).toBe(true)
      expect((c.use.match(/(?<!\\)\$/g) ?? []).length % 2, c.use).toBe(0)
      for (const m of c.use.matchAll(INLINE_MATH)) expect(texOk(m[1]), m[1]).toBe(true)
      expect(c.use).not.toMatch(/NaN|undefined/)
    }
    expect(handConstant('invSqrt2Pi').value * handConstant('sqrt2Pi').value).toBeCloseTo(1, 15)
    expect(handConstant('ln10').value * handConstant('log10e').value).toBeCloseTo(1, 15)
    expect(handConstant('radToDeg').value * handConstant('degToRad').value).toBeCloseTo(1, 15)
    expect(handConstant('sqrt2overPi').value).toBeCloseTo(0.797885, 6)
    expect(handConstant('ln2').value).toBeCloseTo(0.693147, 6)
    expect(() => handConstant('nope')).toThrow()
  })

  it('dB 表：功率比與振幅比互為平方關係，倍數表用 db10／db20', () => {
    const rows = dbRows()
    expect(rows.map((r) => r.db)).toEqual([...DB_POINTS])
    for (const r of rows) {
      expect(db10(r.power)).toBeCloseTo(r.db, 12)
      expect(db20(r.amplitude)).toBeCloseTo(r.db, 12)
      expect(r.amplitude ** 2).toBeCloseTo(r.power, 12)
    }
    const two = ratioRows().find((r) => r.ratio === 2)
    expect(two?.db10).toBeCloseTo(3.0103, 4)
    expect(two?.db20).toBeCloseTo(6.0206, 4)
    for (const r of ratioRows()) {
      expect(r.db20).toBeCloseTo(2 * r.db10, 12)
      expect(texOk(r.tex)).toBe(true)
    }
    expect(dbConvert(-3).power).toBeCloseTo(0.501187, 6)
    expect(dbConvert(-3).amplitude).toBeCloseTo(0.707946, 6)
  })
})
