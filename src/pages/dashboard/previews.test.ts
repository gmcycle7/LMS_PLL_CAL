import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computePreviews, evenNTie, exactOddN, handExample, signLmsNoiseFreeGain } from './previews'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function vec(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

function expectGolden(v: Vector, key: string, actual: number) {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
  expect(Math.abs(actual - e), `${key}: actual ${actual} vs expected ${e}`).toBeLessThanOrEqual(bound)
}

const P = computePreviews()

describe('Dashboard 預覽數字（15 個問題）', () => {
  it('T01: Hero 手算 w₁ = 1.8、w₂ = 2.28（直接用 runScalarLms）', () => {
    const v = vec('T01')
    const h = handExample()
    expectGolden(v, 'w1', h.w[1])
    expectGolden(v, 'w2', h.w[2])
    expectGolden(v, 'e0', h.e[0])
    expectGolden(v, 'e1', h.e[1])
    expectGolden(v, 'pole', h.pole)
  })

  it('T02: 固定 x = 2 ⇒ 0 < μ < 0.5，一步到位 μ = 0.25', () => {
    const v = vec('T02')
    expectGolden(v, 'mu_max', P.fixedX.muMax)
    expectGolden(v, 'mu_one_step', P.fixedX.muOneStep)
  })

  it('T03: Gaussian ⇒ mean 上限 2、mean-square 上限 2/3', () => {
    const v = vec('T03')
    expectGolden(v, 'mu_mean_max', P.meanSquare.meanMuMax)
    expectGolden(v, 'mu_ms_max', P.meanSquare.msMuMax)
    // 勘誤 E14：almost-sure 上限約 2.4212（數值積分）
    expect(P.meanSquare.asMuMax).toBeGreaterThan(2.42)
    expect(P.meanSquare.asMuMax).toBeLessThan(2.423)
  })

  it('T04: P(q = +1) = Φ(0.01) = 0.503989、E[q] = erf(0.01/√2)', () => {
    const v = vec('T04')
    expectGolden(v, 'p_plus', P.comparator.pPlus)
    expectGolden(v, 'mean_q', P.comparator.meanQ)
    expectGolden(v, 'kq_per_fs', P.comparator.Kq)
  })

  it('T05: CLT N ≈ 42497.29；精確奇數 N = 42499（勘誤 E02：偶數 N 有 tie）', () => {
    const v = vec('T05')
    expectGolden(v, 'm', P.comparator.meanQ)
    expectGolden(v, 'N_clt_95', P.n95.nClt95)
    expect(P.n95.nOdd95).toBe(v.expected.N_exact_odd_95)
    expect(exactOddN(P.comparator.pPlus, 0.99, v.expected.N_clt_99 as number)).toBe(v.expected.N_exact_odd_99)
    // 偶數 N = 100：嚴格 P(G > 0) 低於 50%；tie 平分後才等於 CLT 表格值
    const t = evenNTie(100)
    expect(Math.abs(t.strict - (v.expected.p_exact_strict_list as number[])[0])).toBeLessThan(1e-9)
    expect(Math.abs(t.split - (v.expected.p_exact_split_list as number[])[0])).toBeLessThan(1e-9)
    expect(t.strict).toBeLessThan(0.5)
  })

  it('T06 / T07: 極性預覽', () => {
    expectGolden(vec('T06'), 'C', P.t06.C)
    expectGolden(vec('T06'), 'pole', P.t06.pole)
    expectGolden(vec('T07'), 'theta_deg', P.t07.thetaDeg)
    expectGolden(vec('T07'), 'C_D', P.t07.C)
  })

  it('T08: g = 1 ⇒ PM 60°', () => {
    expectGolden(vec('T08'), 'pm_deg', P.pm.pmDeg)
  })

  it('T09: 雙迴路 |z| = 1.0198 > 1；簡化界 2、完整界 1', () => {
    const v = vec('T09')
    expectGolden(v, 'pole_abs', P.dual.absZ)
    expectGolden(v, 'mu_max_simplified', P.dual.muMaxSimplified)
    expectGolden(v, 'mu_max_full', P.dual.muMaxFull)
  })

  it('T12: MSE-LMS 固定點 1.34；無雜訊 Sign-LMS 為 |x| 加權中位數 1.4（勘誤 E01）', () => {
    const v = vec('T12')
    expectGolden(v, 'Ex2', P.inl.Ex2)
    expectGolden(v, 'Ex4', P.inl.Ex4)
    expectGolden(v, 'w_star', P.inl.wMse)
    expect(P.inl.wSign0).toBeCloseTo(1.4, 14)
    // 反面：若把 c3 設為 0（沒有 INL），兩種演算法都回到 a
    expect(signLmsNoiseFreeGain([-2, -1, 0, 1, 2], [0.2, 0.2, 0.2, 0.2, 0.2], 1, 0)).toBe(1)
  })

  it('T10 / T11: ρ = 0.99 ⇒ κ = 199、598 blocks；preconditioned 5 blocks、雜訊放大 √199', () => {
    expectGolden(vec('T10'), 'cond', P.pe.kappa)
    expectGolden(vec('T11'), 'slow_pole', P.pe.slowPole)
    expect(P.pe.slowBlocks).toBe(vec('T11').expected.blocks_95)
    expect(P.precond.blocks).toBe(vec('T11').expected.preconditioned_blocks_95)
    expect(P.precond.noiseAmp).toBeCloseTo(Math.sqrt(199), 9)
  })

  it('T13 / T15: σ_w = 0.3992 fs、spur −93.80 dBc', () => {
    expectGolden(vec('T13'), 'sigma_w_fs', P.noise.sigmaW)
    expectGolden(vec('T13'), 'p', P.noise.p)
    expectGolden(vec('T15'), 'spur_dbc', P.noise.spur)
  })

  it('T17: P(33) = 0.4 ⇒ 兩階無偏誤差功率 0.24 LSB²；對照 freeze 誤差 −0.4 LSB（0.16 LSB²，全在 DC；T16 的週期 5 不在此驗證）', () => {
    expectGolden(vec('T16'), 'freeze_error_lsb', P.quant.freezeErr)
    expectGolden(vec('T17'), 'variance', P.quant.twoLevelPower)
    expect(P.quant.freezePower).toBeCloseTo(0.16, 12)
  })

  it('MSE vs MAE：y = [0, 0, 0, 10] ⇒ 平均 2.5、中位數 0', () => {
    expect(P.q1.mse).toBe(2.5)
    expect(P.q1.maeLow).toBe(0)
    expect(P.q1.maeHigh).toBe(0)
  })
})
