import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  analyzeBias,
  biasSigmaSweep,
  buildCodeDistribution,
  codeMoments,
  comparatorMean,
  cubicReferenceTable,
  eDet,
  expectation,
  finiteStepBias,
  fixedPoint,
  gmacSlope,
  linearizedFixedPoint,
  mcAgreement,
  meanGmacSign,
  mseFixedPoint,
  mseWeightedMean,
  nearIntegerSweep,
  runDcNullComparison,
  sigmaAt,
  signFixedPoint,
  signSecondOrder,
  signWeightedMedian,
  simulateBiasLms,
  type BiasMcResult,
  type ErrorModel,
} from './bias'

interface GoldenVector {
  inputs: { x_values: number[]; x_probs: number[]; a: number; c3: number; sigma_list: number[] }
  expected: { Ex2: number; Ex4: number; w_star: number; sign_lms_w_star_list: number[] }
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

const golden = JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors/T12.json'), 'utf8')) as GoldenVector

function withinTol(actual: number, expected: number, key: string): boolean {
  const tol = golden.tolerance_overrides?.[key] ?? golden.tolerance
  return Math.abs(actual - expected) <= (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
}

const CUBIC: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 1 }
const five = buildCodeDistribution({ kind: 'five_level' })

describe('bias.ts — §11 固定點（T12 拆成 T12a / T12b / T12c，勘誤 E01）', () => {
  it('T12: (T12a) MSE-LMS 固定點 = a + c₃E[x⁴]/E[x²] = 1.34，E[x²] = 2、E[x⁴] = 6.8（golden vector）', () => {
    const dist = buildCodeDistribution({ kind: 'five_level' })
    expect(dist.values).toEqual(golden.inputs.x_values)
    const mo = codeMoments(dist)
    expect(withinTol(mo.Ex2, golden.expected.Ex2, 'Ex2')).toBe(true)
    expect(withinTol(mo.Ex4, golden.expected.Ex4, 'Ex4')).toBe(true)
    const m: ErrorModel = { ...CUBIC, a: golden.inputs.a, c3: golden.inputs.c3 }
    const w = mseFixedPoint(m, dist)
    expect(withinTol(w, golden.expected.w_star, 'w_star')).toBe(true)
    // 兩條獨立的計算路徑：直線零點 vs x² 加權平均的 per-code gain
    expect(mseWeightedMean(m, dist.values, dist.probs)).toBeCloseTo(1.34, 14)
    // 67/50 的有理數驗算：1 + 0.1 × 6.8/2
    expect(Math.abs(w - 67 / 50)).toBeLessThan(1e-14)
  })

  it('T12: (T12a) 殘差表 e_det(x; 1.34) = (−0.12, +0.24, 0, −0.24, +0.12)，且 E[x·e] = 0 但 e ≠ 0', () => {
    const res = [-2, -1, 0, 1, 2].map((x) => eDet(x, 1.34, CUBIC))
    const want = [-0.12, 0.24, 0, -0.24, 0.12]
    res.forEach((r, i) => expect(r).toBeCloseTo(want[i], 12))
    expect(expectation(five, (x) => x * eDet(x, 1.34, CUBIC))).toBeCloseTo(0, 14)
    expect(Math.max(...res.map(Math.abs))).toBeCloseTo(0.24, 12)
  })

  it('T12: golden sign_lms_w_star_list（σ = 10、100 的 mean-field 根）', () => {
    golden.inputs.sigma_list.forEach((s, i) => {
      const fp = signFixedPoint({ ...CUBIC, sigmaV: s }, five)
      expect(fp.status).toBe('ok')
      expect(withinTol(fp.w, golden.expected.sign_lms_w_star_list[i], 'sign_lms_w_star_list')).toBe(true)
    })
  })

  it('T12: (T12b) Sign-LMS σ_v 參考表 1.38314 / 1.36658 / 1.34385 / 1.34035（勘誤 E01，mpmath 40 位）', () => {
    const rows = cubicReferenceTable({ sigmas: [0.05, 0.1, 0.3, 1] })
    const ref = [1.383138, 1.366577, 1.34385, 1.340346]
    rows.forEach((r, i) => expect(Math.abs(r.exact - ref[i])).toBeLessThan(1.5e-6))
    // 二階近似 1.34 + 3.456e−4/σ_v²：σ_v ≥ 0.3 時準，σ_v = 0.05 時嚴重失準（甚至 > 1.4）
    expect(rows[3].secondOrder).toBeCloseTo(1.34 + 3.456e-4, 12)
    expect(Math.abs(rows[2].secondOrder - rows[2].exact)).toBeLessThan(2e-5)
    expect(rows[0].secondOrder).toBeGreaterThan(1.4)
  })

  it('T12: (T12b) 二階修正係數：−E[x e₀³]/(6E[x²]) = 3.456e−4', () => {
    const e0 = (x: number) => eDet(x, 1.34, CUBIC)
    const exe3 = expectation(five, (x) => x * e0(x) ** 3)
    expect(exe3).toBeCloseTo(-0.0041472, 12)
    expect(-exe3 / (6 * 2)).toBeCloseTo(3.456e-4, 12)
    expect(signSecondOrder({ ...CUBIC, sigmaV: 2 }, five)).toBeCloseTo(1.34 + 3.456e-4 / 4, 12)
  })

  it('T12: (T12b) Sign-LMS σ_v = 1 的 block MC（多 seeds，95% CI）包含 mean-field 1.340346', () => {
    const mf = signFixedPoint(CUBIC, five).w
    expect(mf).toBeCloseTo(1.3403458341, 9)
    const mc = simulateBiasLms({
      model: CUBIC,
      code: { kind: 'five_level' },
      algorithm: 'sign',
      dcMode: 'none',
      mu: 0.0125,
      N: 32,
      blocks: 6000,
      chains: 16,
      w0: 1.34,
      seed: 20261012,
      traceChains: 1,
    })
    expect(mc.lo).toBeLessThanOrEqual(mf)
    expect(mc.hi).toBeGreaterThanOrEqual(mf)
    expect(mc.halfWidth).toBeLessThan(2e-3)
    expect(mc.driftCheck.settled).toBe(true)
  })

  it('T12: (T12c) 無雜訊 Sign-LMS → 1.4 = |x| 加權中位數（不是 1.34）', () => {
    const m = { ...CUBIC, sigmaV: 0 }
    const med = signWeightedMedian(m, five.values, five.probs)
    expect(med.lo).toBeCloseTo(1.4, 14)
    expect(med.hi).toBeCloseTo(1.4, 14)
    expect(signFixedPoint(m, five).w).toBeCloseTo(1.4, 10)
    // 無雜訊 GMAC 的階梯：(1.1, 1.4) 內 +0.4、> 1.4 為 −1.2（勘誤 E01 數值證據）
    expect(meanGmacSign(1.25, m, five)).toBeCloseTo(0.4, 14)
    expect(meanGmacSign(1.5, m, five)).toBeCloseTo(-1.2, 14)
    expect(meanGmacSign(1.0, m, five)).toBeCloseTo(1.2, 14)
    const mc = simulateBiasLms({
      model: m,
      code: { kind: 'five_level' },
      algorithm: 'sign',
      dcMode: 'none',
      mu: 5e-4,
      N: 16,
      blocks: 4000,
      chains: 8,
      w0: 1.3,
      seed: 7,
      traceChains: 0,
    })
    expect(Math.abs(mc.mean - 1.4)).toBeLessThan(2e-3) // O(μ) 的 limit cycle 偏差
  })

  it('T12: MSE / MAE 成本在 w = 1、1.34、1.4（1.34 最小化 MSE，1.4 最小化 MAE）', () => {
    const mse = (w: number) => expectation(five, (x) => eDet(x, w, CUBIC) ** 2)
    const mae = (w: number) => expectation(five, (x) => Math.abs(eDet(x, w, CUBIC)))
    expect(mse(1)).toBeCloseTo(0.26, 12)
    expect(mse(1.34)).toBeCloseTo(0.0288, 12)
    expect(mse(1.4)).toBeCloseTo(0.036, 12)
    expect(mae(1.34)).toBeCloseTo(0.144, 12)
    expect(mae(1.4)).toBeCloseTo(0.12, 12)
  })

  it('T12: 勘誤 E11 —— 其他 code 分布的 MSE 固定點：±1 → 1.10、unit Gaussian → 1.30', () => {
    expect(mseFixedPoint(CUBIC, buildCodeDistribution({ kind: 'pm_one' }))).toBeCloseTo(1.1, 13)
    expect(mseFixedPoint(CUBIC, buildCodeDistribution({ kind: 'gaussian' }))).toBeCloseTo(1.3, 10)
  })
})

describe('bias.ts — 反面測試（failure modes）', () => {
  it('NEG: 無雜訊或中等雜訊的 Sign-LMS 不會收斂到 1.34（若 UI 以 1.34 判定成功就是錯的）', () => {
    expect(Math.abs(signFixedPoint({ ...CUBIC, sigmaV: 0 }, five).w - 1.34)).toBeGreaterThan(0.05)
    const mc = simulateBiasLms({
      model: { ...CUBIC, sigmaV: 0.1 },
      code: { kind: 'five_level' },
      algorithm: 'sign',
      dcMode: 'none',
      mu: 2e-3,
      N: 32,
      blocks: 3000,
      chains: 8,
      w0: 1.34,
      seed: 99,
      traceChains: 0,
    })
    expect(mc.lo).toBeGreaterThan(1.34 + 0.02) // CI 完全不含 1.34
    expect(Math.abs(mc.mean - 1.366577)).toBeLessThan(3 * mc.halfWidth + 2e-3)
  })

  it('NEG: 勘誤 E03 —— 共用 BBPD（E[q] = 0）時 offset 不造成 gain bias；linear PD + 獨立 comparator 反而更大（三種公式各以 MC 驗證）', () => {
    const m: ErrorModel = { a: 1, b: 0.5, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    expect(linearizedFixedPoint(m, u4, 'none', false).w).toBeCloseTo(1 + (0.5 * 1.5) / 3.5, 12)
    expect(linearizedFixedPoint(m, u4, 'shared_bbpd', false).w).toBeCloseTo(1, 12)
    expect(linearizedFixedPoint(m, u4, 'linear_pd', false).w).toBeCloseTo(1 + (0.5 * 1.5) / 1.25, 12)
    expect(signFixedPoint(m, u4, 'none').w).toBeCloseTo(1.2141047279, 8)
    expect(signFixedPoint(m, u4, 'shared_bbpd').w).toBeCloseTo(1, 10)
    expect(signFixedPoint(m, u4, 'linear_pd').w).toBeCloseTo(1.5897266426, 8)
    const cmp = runDcNullComparison({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', N: 32, blocks: 2000, chains: 8, w0: 1, seed: 3 })
    for (const r of cmp.rows) {
      expect(r.settled).toBe(true)
      expect(Math.abs(r.mc.mean - r.meanField)).toBeLessThan(r.mc.halfWidth + 3e-3)
      // 與 Lab 相同的判定（4·SE + 有限步長 + servo 修正的 25%）
      expect(r.agreement?.pass, r.mode).toBe(true)
    }
    // mode none 沒有 servo；(B)(C) 的 φ 會抖動
    expect(cmp.rows[0].phiStd).toBe(0)
    expect(cmp.rows[1].phiStd).toBeGreaterThan(0.03)
    expect(cmp.rows[2].phiStd).toBeGreaterThan(0.03)
  })

  it('NEG: 勘誤 E03 —— 共用 BBPD 下 INL bias 的分母是 Var(x)：a + c₂Cov(x,x²)/Var(x) = 1.3（靜態式給 1.2571）', () => {
    const m: ErrorModel = { a: 1, b: 0, c2: 0.1, c3: 0, kappa: 0, sigmaV: 1 }
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    expect(mseFixedPoint(m, u4, 'none')).toBeCloseTo(1 + (0.1 * 9) / 3.5, 12)
    expect(mseFixedPoint(m, u4, 'shared_bbpd')).toBeCloseTo(1.3, 12)
    expect(signFixedPoint(m, u4, 'shared_bbpd').w).toBeCloseTo(1.3, 8)
    // uniform [0,1) residue：E[x²] = 1/3、Var(x) = 1/12（差 4 倍）
    const mo = codeMoments(buildCodeDistribution({ kind: 'uniform_residue' }))
    expect(mo.Ex2).toBeCloseTo(1 / 3, 13)
    expect(mo.varX).toBeCloseTo(1 / 12, 13)
  })

  it('NEG: 勘誤 E17 —— code-dependent σ_v(x) 讓 centering 失效（0.9601），MSE-LMS 不受影響（1.0）', () => {
    const m: ErrorModel = { a: 1, b: 0.2, c2: 0, c3: 0, kappa: 0, sigmaV: 1, jitterSlope: 0.25, jitterRef: -2 }
    expect(signFixedPoint(m, five).w).toBeCloseTo(0.96006627, 7)
    expect(linearizedFixedPoint(m, five, 'none', true).w).toBeCloseTo(0.9601, 4)
    expect(mseFixedPoint(m, five)).toBeCloseTo(1, 13)
    expect(signFixedPoint({ ...m, jitterSlope: 0 }, five).w).toBeCloseTo(1, 12) // σ_v 常數：w = a 精確
    expect(signFixedPoint({ ...m, c3: 0.1 }, five).w).toBeCloseTo(1.30078124, 7)
  })

  it('NEG: 無雜訊 + offset 的 dead zone：x ∈ {0,1,2,3}、b = 1 ⇒ G(w) = 0 於 (a + b/3, a + b/2)', () => {
    const m: ErrorModel = { a: 1, b: 1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    const z = signWeightedMedian(m, u4.values, u4.probs)
    expect(z.lo).toBeCloseTo(1 + 1 / 3, 13)
    expect(z.hi).toBeCloseTo(1.5, 13)
    expect(meanGmacSign(1.4, m, u4)).toBe(0)
    expect(meanGmacSign(1.45, m, u4)).toBe(0)
    const an = analyzeBias({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'none' })
    expect(an.warnings.some((w) => w.includes('dead zone'))).toBe(true)
  })

  it('NEG: ε_cc = κx ⇒ w* = a + κ（不可辨識，必須給警告）', () => {
    const m: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0, kappa: 0.1, sigmaV: 1 }
    for (const kind of ['five_level', 'gaussian', 'uniform_residue'] as const) {
      const d = buildCodeDistribution({ kind })
      expect(mseFixedPoint(m, d)).toBeCloseTo(1.1, 10)
      expect(signFixedPoint(m, d).w).toBeCloseTo(1.1, 9)
    }
    // (a, κ) = (1, 0.1) 與 (1.1, 0) 的 comparator 統計完全相同
    const m2: ErrorModel = { ...m, a: 1.1, kappa: 0 }
    for (const w of [0.8, 1.0, 1.3]) expect(meanGmacSign(w, m, five)).toBeCloseTo(meanGmacSign(w, m2, five), 14)
    const an = analyzeBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(an.warnings.some((w) => w.includes('不可辨識'))).toBe(true)
  })

  it('NEG: Var(x) = 0（常數 code）在 DC null 模式下不可辨識；E[x²] = 0 時 MSE 固定點為 NaN', () => {
    const m: ErrorModel = { a: 1, b: 0.1, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
    const an = analyzeBias({ model: m, code: { kind: 'dsm', dsmFrac: 0 }, algorithm: 'sign', dcMode: 'shared_bbpd' })
    expect(an.status).not.toBe('ok')
    expect(an.warnings.some((w) => w.includes('不可辨識'))).toBe(true)
    expect(Number.isNaN(fixedPoint('mse', m, buildCodeDistribution({ kind: 'dsm', dsmFrac: 0 }), 'none').w)).toBe(true)
  })

  it('NEG: σ_v = 0.05 時不是「全部飽和」：x = ±1 的 E[q|x] → ∓1，x = ±2 停在 ±0.5（平衡條件 E[q|2] = −E[q|1]/2）', () => {
    const m = { ...CUBIC, sigmaV: 0.05 }
    const w = signFixedPoint(m, five).w
    expect(w).toBeCloseTo(1.3831378, 6)
    const q1 = comparatorMean(eDet(1, w, m), 0.05)
    const q2 = comparatorMean(eDet(2, w, m), 0.05)
    expect(q1).toBeCloseTo(-1, 6)
    expect(q2).toBeCloseTo(0.5, 6)
    expect(q1 + 2 * q2).toBeCloseTo(0, 10)
  })

  it('NEG: 置中 code 的 centering 需要雜訊 —— σ_v = 0 時 offset 造成 dead zone (a − b/2, a + b/2)；σ_v > 0 時唯一根 = a', () => {
    const m: ErrorModel = { a: 1, b: 0.1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }
    const z = signWeightedMedian(m, five.values, five.probs)
    expect(z.lo).toBeCloseTo(0.95, 13)
    expect(z.hi).toBeCloseTo(1.05, 13)
    expect(Math.abs(meanGmacSign(1.03, m, five))).toBeLessThan(1e-15)
    expect(meanGmacSign(1.06, m, five)).toBeLessThan(-0.5)
    const an = analyzeBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(an.warnings.some((w) => w.includes('dead zone'))).toBe(true)
    expect(signFixedPoint({ ...m, sigmaV: 0.05 }, five).w).toBeCloseTo(1, 12)
  })

  it('NEG: 勘誤 E03 —— 共用 BBPD 在 w* = a 處的 φ* = −b（精確，不需線性化），MC 量到的 E[q] ≈ 0', () => {
    const m: ErrorModel = { a: 1, b: 0.5, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
    const an = analyzeBias({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'shared_bbpd' })
    expect(an.wStar).toBeCloseTo(1, 10)
    expect(an.phiStar).toBeCloseTo(-0.5, 10)
    const mc = simulateBiasLms({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'shared_bbpd', mu: 0.025, N: 32, blocks: 1500, chains: 4, w0: 1, seed: 21, traceChains: 0 })
    expect(Math.abs(mc.qMean)).toBeLessThan(0.01)
    expect(mc.phiMean).toBeCloseTo(-0.5, 1)
  })

  it('NEG: Sign-LMS 的固定點上 E[x·e] ≠ 0，歸零的是 E[x·E[q|x]]（殘差表 xg 欄）', () => {
    const an = analyzeBias({ model: { ...CUBIC, sigmaV: 0.3 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    const rows = an.residual ?? []
    const avg = (f: (r: (typeof rows)[number]) => number) => rows.reduce((acc, r) => acc + r.p * f(r), 0)
    expect(Math.abs(avg((r) => r.xg))).toBeLessThan(1e-12)
    expect(Math.abs(avg((r) => r.xe))).toBeGreaterThan(1e-4)
    const mse = analyzeBias({ model: CUBIC, code: { kind: 'five_level' }, algorithm: 'mse', dcMode: 'none' })
    expect(Math.abs((mse.residual ?? []).reduce((acc, r) => acc + r.p * r.xg, 0))).toBeLessThan(1e-14)
  })

  it('NEG: ±1 code 時 x³ = x，三階 INL 與 gain 共線（勘誤 E11 的 1.10），必須給警告', () => {
    const an = analyzeBias({ model: CUBIC, code: { kind: 'pm_one' }, algorithm: 'mse', dcMode: 'none' })
    expect(an.wStar).toBeCloseTo(1.1, 13)
    expect(an.warnings.some((w) => w.includes('共線'))).toBe(true)
    // 5-level 不應觸發
    expect(analyzeBias({ model: CUBIC, code: { kind: 'five_level' }, algorithm: 'mse', dcMode: 'none' }).warnings.some((w) => w.includes('共線'))).toBe(false)
  })

  it('NEG: 線性化失效時必須給出解釋性警告（σ_v = 0.1 時 max|e_det|/σ_v ≈ 2.7）', () => {
    const an = analyzeBias({ model: { ...CUBIC, sigmaV: 0.1 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(an.validityRatio).toBeCloseTo(2.66577, 4)
    expect(an.warnings.some((w) => w.includes('線性化失效'))).toBe(true)
    const ok = analyzeBias({ model: CUBIC, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(ok.warnings).toHaveLength(0)
  })
})

describe('bias.ts — Monte Carlo 與 mean-field 的差距（有限步長、servo 抖動、servo 落後、dead zone）', () => {
  it('T12: Lab 預設（Gallery #7：Sign σ_v = 1）與 Case B（MSE）、Case C（σ_v = 0）的 MC 都通過 mcAgreement（同一個 seed 的 paired simulation）', () => {
    const cases: [ErrorModel, 'sign' | 'mse', number][] = [
      [CUBIC, 'sign', 1.3403458341],
      [CUBIC, 'mse', 1.34],
      [{ ...CUBIC, sigmaV: 0 }, 'sign', 1.4],
    ]
    for (const [m, alg, want] of cases) {
      const an = analyzeBias({ model: m, code: { kind: 'five_level' }, algorithm: alg, dcMode: 'none', w0: 1 })
      expect(an.wStar).toBeCloseTo(want, 9)
      const mc = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: alg, dcMode: 'none', mu: 0.02 / an.slope, N: 64, blocks: 3000, chains: 16, w0: 1, seed: 20261012, traceChains: 0 })
      const ag = mcAgreement(mc, an.zeroSet)
      expect(ag.kind).toBe('point')
      expect(ag.pass, `${alg} σ_v=${m.sigmaV}: Δ=${ag.delta} tol=${ag.tolerance}`).toBe(true)
      expect(mc.reference.wMeanField).toBeCloseTo(want, 9)
      expect(mc.reference.wServoAware).toBe(mc.reference.wMeanField) // mode none：沒有 servo
      expect(mc.blocksUsed).toBe(3000)
    }
  })

  it('NEG: mcAgreement 抓得到錯的解析值 —— σ_v = 0.1 的 Sign-LMS 若以 1.34 當參考值必須判定為 mismatch', () => {
    const m = { ...CUBIC, sigmaV: 0.1 }
    const an = analyzeBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', w0: 1 })
    const mc = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu: 0.02 / an.slope, N: 64, blocks: 3000, chains: 16, w0: 1, seed: 20261012, traceChains: 0 })
    expect(mcAgreement(mc, an.zeroSet).pass).toBe(true)
    const wrong: Pick<BiasMcResult, 'mean' | 'se' | 'reference'> = { mean: mc.mean, se: mc.se, reference: { ...mc.reference, wMeanField: 1.34, wServoAware: 1.34 } }
    const bad = mcAgreement(wrong, null)
    expect(bad.pass).toBe(false)
    expect(Math.abs(bad.delta)).toBeGreaterThan(10 * bad.tolerance) // 0.0266 vs 容許量 ~5e-4
    // 容許量由 4·SE 主導，沒有「μ/2」之類的寬鬆項
    expect(bad.tolerance).toBeLessThan(1e-3)
  })

  it('finiteStepBias：G″·Var(w)/(2S) 的預測與 MC 一致（σ_v = 0.1、g = 0.2、N = 4 ⇒ 約 −3.4e−3）；MSE-LMS 沒有這個偏移', () => {
    const m = { ...CUBIC, sigmaV: 0.1 }
    const S = gmacSlope('sign', signFixedPoint(m, five).w, m, five, 'none')
    expect(S).toBeCloseTo(10.3015, 3)
    const mu = 0.2 / S
    const est = finiteStepBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu, N: 4 })
    expect(est.smooth).toBe(true)
    expect(est.g).toBeCloseTo(0.2, 6)
    // Var(w) = μ²E[x²]/(N·g(2 − g))
    expect(est.sdW).toBeCloseTo(Math.sqrt((mu * mu * 2) / (4 * 0.2 * 1.8)), 12)
    expect(est.bias).toBeGreaterThan(-3.8e-3)
    expect(est.bias).toBeLessThan(-3.0e-3)
    expect(est.lagBias).toBe(0)
    const mc = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu, N: 4, blocks: 12000, chains: 24, w0: 1.3666, seed: 9, traceChains: 0 })
    const d = mc.mean - mc.reference.wMeanField
    expect(d).toBeLessThan(-2e-3) // 偏移是真的（遠大於 SE）
    expect(Math.abs(d - est.bias)).toBeLessThan(4 * mc.se + 0.5 * Math.abs(est.bias))
    expect(mcAgreement(mc, null).pass).toBe(true)
    // N 加大 16 倍 ⇒ Var(w) 與偏移都縮小 16 倍
    const est64 = finiteStepBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu, N: 64 })
    expect(est64.bias / est.bias).toBeCloseTo(1 / 16, 6)
    const mse = finiteStepBias({ model: m, code: { kind: 'five_level' }, algorithm: 'mse', dcMode: 'none', mu: 0.01, N: 4 })
    expect(mse.bias).toBe(0)
    expect(mse.allowance).toBe(0)
  })

  it('無雜訊 limit cycle：時間平均偏移是 O(μ)（N = 64 約 −0.4μ；N = 1 約 −1.4μ），容許量 μE|x| + 不對稱項涵蓋兩者', () => {
    const m = { ...CUBIC, sigmaV: 0 }
    const mu = 0.0012
    for (const [N, blocks, lo, hi] of [[64, 3000, -0.6, -0.25], [1, 20000, -1.8, -0.9]] as const) {
      const est = finiteStepBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu, N })
      expect(est.smooth).toBe(false)
      expect(Number.isNaN(est.bias)).toBe(true)
      expect(est.bound).toBeCloseTo(mu * 1.2, 12) // μ·E|x|
      // 不對稱項 μE[x²]/(2N)·|1/G₋ − 1/G₊|，G₋ = 0.4、G₊ = 1.2
      expect(est.allowance).toBeCloseTo(mu * 1.2 + ((mu * 2) / (2 * N)) * Math.abs(1 / 0.4 - 1 / 1.2), 10)
      const mc = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu, N, blocks, chains: 8, w0: 1.4, seed: 777, traceChains: 0 })
      const r = (mc.mean - 1.4) / mu
      expect(r, `N=${N}`).toBeGreaterThan(lo)
      expect(r, `N=${N}`).toBeLessThan(hi)
      expect(mcAgreement(mc, signWeightedMedian(m, five.values, five.probs)).pass, `N=${N}`).toBe(true)
    }
  })

  it('servo 抖動 = 額外 dither：shared BBPD、σ_v = 0.1 時 MC 偏離理想 DC null 的 mean-field，但與 w*(σ_eff) 一致（F-11.17）', () => {
    const m: ErrorModel = { a: 1, b: 0.3, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0.1 }
    const an = analyzeBias({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'shared_bbpd', w0: 1 })
    expect(an.wStar).toBeCloseTo(1.366577, 5) // offset 被吸收：與 b = 0 的靜態 mean-field 相同
    const mc = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'shared_bbpd', mu: 0.02 / an.slope, N: 64, blocks: 4000, chains: 16, w0: 1.3666, seed: 4242, traceChains: 0, servoGain: 0.01 })
    expect(mc.phiStd).toBeGreaterThan(0.025)
    expect(mc.phiStd).toBeLessThan(0.045)
    expect(Math.abs(mc.qMean)).toBeLessThan(0.01)
    const dIdeal = mc.mean - mc.reference.wMeanField
    expect(dIdeal).toBeLessThan(-1.2e-3) // 理想 mean-field 高估（servo 的 dither 把固定點往 1.34 推）
    expect(Math.abs(dIdeal)).toBeGreaterThan(8 * mc.se)
    // servo-aware：σ_eff = √(σ_v² + Var φ)
    const sEff = Math.hypot(0.1, mc.phiStd)
    expect(mc.reference.wServoAware).toBeCloseTo(signFixedPoint({ ...m, sigmaV: sEff }, five, 'shared_bbpd').w, 10)
    expect(Math.abs(mc.mean - mc.reference.wServoAware)).toBeLessThan(4 * mc.se + 2e-4)
    const ag = mcAgreement(mc, an.zeroSet)
    expect(ag.pass).toBe(true)
    expect(ag.parts.servo).toBeCloseTo(0.25 * Math.abs(mc.reference.wServoAware - mc.reference.wMeanField), 12)
    // k_φ 加大 10 倍 ⇒ 抖動更大、偏移更大（仍與 servo-aware 一致）
    const mc2 = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'shared_bbpd', mu: 0.02 / an.slope, N: 64, blocks: 4000, chains: 16, w0: 1.3666, seed: 4242, traceChains: 0, servoGain: 0.1 })
    expect(mc2.phiStd).toBeGreaterThan(2 * mc.phiStd)
    expect(mc2.mean).toBeLessThan(mc.mean - 5e-3)
    expect(mcAgreement(mc2, an.zeroSet).pass).toBe(true)
  })

  it('sigmaExtra：與 σ_v(x) 平方相加；常數 σ 時 (σ_v, σ_extra) = (0.06, 0.08) 等同 σ_v = 0.1；負值丟錯', () => {
    const m: ErrorModel = { ...CUBIC, sigmaV: 0.06, sigmaExtra: 0.08 }
    expect(sigmaAt(1.7, m)).toBeCloseTo(0.1, 14)
    expect(signFixedPoint(m, five).w).toBeCloseTo(signFixedPoint({ ...CUBIC, sigmaV: 0.1 }, five).w, 12)
    expect(signSecondOrder(m, five)).toBeCloseTo(1.34 + 3.456e-4 / 0.01, 10)
    const jit: ErrorModel = { ...CUBIC, sigmaV: 1, jitterSlope: 0.25, jitterRef: -2, sigmaExtra: 0.5 }
    expect(sigmaAt(2, jit)).toBeCloseTo(Math.hypot(Math.sqrt(5), 0.5), 13)
    expect(() => analyzeBias({ model: { ...CUBIC, sigmaExtra: -0.1 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })).toThrow(/σ_extra/)
    // 只有 σ_extra（σ_v = 0）也算有 dither：不是階梯、沒有「σ_v = 0」警告
    const an = analyzeBias({ model: { ...CUBIC, sigmaV: 0, sigmaExtra: 0.1 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(an.wStar).toBeCloseTo(1.366577, 5)
    expect(an.zeroSet).toBeNull()
  })

  it('servo 落後（lagBias）：shared BBPD、σ_v = 0.05、N = 32 時 MC 比 servo-aware 固定點低；N 加大到 256 後消失（估計式給出正確的正負號與量級）', () => {
    const m: ErrorModel = { a: 1, b: 0.5, c2: 0.1, c3: 0, kappa: 0, sigmaV: 0.05 }
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    const w = signFixedPoint(m, u4, 'shared_bbpd').w
    expect(w).toBeCloseTo(1.3, 9) // 對稱性：任何 σ 都是 1.3，servo-aware 修正為 0
    const mu = 0.02 / gmacSlope('sign', w, m, u4, 'shared_bbpd')
    const run = (N: number, blocks: number) =>
      simulateBiasLms({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'shared_bbpd', mu, N, blocks, chains: 24, w0: 1.3, seed: 3, traceChains: 0, servoGain: 0.01 })
    const a = run(32, 6000)
    expect(a.reference.wServoAware).toBeCloseTo(1.3, 8)
    expect(Math.abs(a.reference.step.bias)).toBeLessThan(1e-9) // 理想 servo 下 G 對 w* 反對稱 ⇒ G″ = 0
    expect(a.reference.step.lagBias).toBeLessThan(-5e-5) // φ 凍結時的曲率不為 0
    expect(a.reference.step.servoTau).toBeGreaterThan(10)
    const d = a.mean - 1.3
    expect(d).toBeLessThan(-3e-4)
    expect(d / a.reference.step.lagBias).toBeGreaterThan(0.3) // 同號，量級在 0.3–4 倍內
    expect(d / a.reference.step.lagBias).toBeLessThan(4)
    expect(mcAgreement(a, null).pass).toBe(true)
    const b = run(256, 2500)
    expect(Math.abs(b.mean - 1.3)).toBeLessThan(4 * b.se + 5e-5)
    expect(Math.abs(b.reference.step.lagBias)).toBeLessThan(Math.abs(a.reference.step.lagBias) / 30)
  })

  it('dead zone：auto μ 用跨區間的割線斜率；MC 停在區間內（w₀ 從哪一側進來就停在哪一側），mcAgreement 以區間判定', () => {
    const m: ErrorModel = { a: 1, b: 1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }
    const an = analyzeBias({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'none', w0: 1 })
    expect(an.zeroSet?.lo).toBeCloseTo(4 / 3, 12)
    expect(an.zeroSet?.hi).toBeCloseTo(1.5, 12)
    expect(an.slope).toBeGreaterThan(1) // 不是 0：G(lo − h) = +1.5、G(hi + h) = −1
    const mu = 0.02 / an.slope
    const lowSide = simulateBiasLms({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'none', mu, N: 64, blocks: 3000, chains: 12, w0: 1, seed: 20261012, traceChains: 0 })
    const highSide = simulateBiasLms({ model: m, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'none', mu, N: 64, blocks: 3000, chains: 12, w0: 2, seed: 20261012, traceChains: 0 })
    for (const mc of [lowSide, highSide]) {
      const ag = mcAgreement(mc, an.zeroSet)
      expect(ag.kind).toBe('dead-zone')
      expect(ag.pass).toBe(true)
      expect(ag.delta).toBe(0)
    }
    expect(lowSide.mean).toBeLessThan(1.39)
    expect(highSide.mean).toBeGreaterThan(1.44)
    // NEG：落在區間外很遠的「MC」必須判定為 mismatch
    expect(mcAgreement({ ...lowSide, mean: 1.2 }, an.zeroSet).pass).toBe(false)
    expect(mcAgreement({ ...lowSide, mean: 1.7 }, an.zeroSet).pass).toBe(false)
  })

  it('規格 §11.4 的量測：凍結 gain、w* ± Δ 的 GMAC 斜率 Ŝ 與同一個 Δ 的 mean-field 割線斜率一致；Δ 大時割線 < 切線', () => {
    const m = { ...CUBIC, sigmaV: 0.1 }
    const w = signFixedPoint(m, five).w
    const S = gmacSlope('sign', w, m, five, 'none')
    const mc = simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu: 0.02 / S, N: 16, blocks: 40, chains: 2, w0: w, seed: 20261012, traceChains: 0, gmacSamples: 40000, slopeProbe: { center: w, delta: 0.05 } })
    const p = mc.slopeProbe
    expect(p).not.toBeNull()
    if (!p) return
    expect(p.meanFieldTangent).toBeCloseTo(S, 10)
    // 解析的割線斜率：(G(w − Δ) − G(w + Δ))/(2Δ)
    expect(p.meanFieldSecant).toBeCloseTo((meanGmacSign(w - 0.05, m, five) - meanGmacSign(w + 0.05, m, five)) / 0.1, 12)
    expect(p.meanFieldSecant).toBeLessThan(0.95 * p.meanFieldTangent) // erf 的非線性：Δ = 0.05 已不小
    expect(p.slope).toBeCloseTo((p.gMinus - p.gPlus) / 0.1, 12)
    expect(p.gMinus).toBeGreaterThan(0)
    expect(p.gPlus).toBeLessThan(0)
    expect(Math.abs(p.slope - p.meanFieldSecant)).toBeLessThan(4 * p.se)
    expect(p.se).toBeGreaterThan(0)
    expect(p.slope - 4 * p.se).toBeGreaterThan(0) // 極性正確：Ŝ > 0（Ŝ_GMAC < 0）
    // 沒有要求時不量
    expect(simulateBiasLms({ model: m, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu: 0.002, N: 16, blocks: 40, chains: 2, w0: w, seed: 1, traceChains: 0 }).slopeProbe).toBeNull()
  })

  it('Run-to-Convergence：blocks 太短時自動加倍，直到漂移不顯著且 g·burn ≥ 7', () => {
    const an = analyzeBias({ model: CUBIC, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', w0: 1 })
    const base = { model: CUBIC, code: { kind: 'five_level' as const }, algorithm: 'sign' as const, dcMode: 'none' as const, mu: 0.02 / an.slope, N: 64, blocks: 100, chains: 16, w0: 1, seed: 20261012, traceChains: 0 }
    const short = simulateBiasLms(base)
    expect(short.blocksUsed).toBe(100)
    expect(short.driftCheck.settled).toBe(false)
    expect(mcAgreement(short, null).pass).toBe(false) // burn-in 只有 1 個時間常數：偏向 w₀
    const long = simulateBiasLms({ ...base, untilSettled: true, loopGain: 0.02 })
    expect(long.blocksUsed).toBe(800) // burn-in 400 blocks = 8 個時間常數
    expect(long.driftCheck.settled).toBe(true)
    expect(mcAgreement(long, null).pass).toBe(true)
  })

  it('NEG: DSM 接近整數 FCW + DC null —— servo 跟著 code pattern 走，iid mean-field 不適用：必須警告，且 MC 確實偏離', () => {
    const m: ErrorModel = { a: 1, b: 0.05, c2: 0.1, c3: 0, kappa: 0, sigmaV: 0.5 }
    const slow = analyzeBias({ model: m, code: { kind: 'dsm', dsmFrac: 1 / 256 }, algorithm: 'sign', dcMode: 'shared_bbpd', w0: 1, servoGain: 0.01 })
    expect(slow.warnings.some((w) => w.includes('servo 會跟著 code pattern'))).toBe(true)
    const fast = analyzeBias({ model: m, code: { kind: 'dsm', dsmFrac: 0.3 }, algorithm: 'sign', dcMode: 'shared_bbpd', w0: 1, servoGain: 0.01 })
    expect(fast.warnings.some((w) => w.includes('servo 會跟著 code pattern'))).toBe(false)
    // mode none 不需要這個警告
    expect(analyzeBias({ model: m, code: { kind: 'dsm', dsmFrac: 1 / 256 }, algorithm: 'sign', dcMode: 'none', w0: 1 }).warnings.some((w) => w.includes('servo 會跟著'))).toBe(false)
    const mc = simulateBiasLms({ model: m, code: { kind: 'dsm', dsmFrac: 1 / 256 }, algorithm: 'sign', dcMode: 'shared_bbpd', mu: 0.02 / slow.slope, N: 64, blocks: 3000, chains: 16, w0: 1.1, seed: 20261012, traceChains: 0 })
    expect(mc.mean - slow.wStar).toBeGreaterThan(8e-3) // 約 +0.014：不是統計誤差
    expect(mcAgreement(mc, slow.zeroSet).pass).toBe(false)
    const mcFast = simulateBiasLms({ model: m, code: { kind: 'dsm', dsmFrac: 0.3 }, algorithm: 'sign', dcMode: 'shared_bbpd', mu: 0.02 / fast.slope, N: 64, blocks: 3000, chains: 16, w0: 1.1, seed: 20261012, traceChains: 0 })
    expect(mcAgreement(mcFast, fast.zeroSet).pass).toBe(true)
  })
})

describe('bias.ts — 數值核心', () => {
  it('comparatorMean = erf(s/(√2σ))，σ = 0 退化為 sign', () => {
    expect(comparatorMean(1, 100)).toBeCloseTo(0.0079787126, 9)
    expect(comparatorMean(0.3, 0)).toBe(1)
    expect(comparatorMean(-0.3, 0)).toBe(-1)
  })

  it('連續分布的 quadrature：Gaussian 動差 1, 3, 15；uniform [0,1) 的 1/2, 1/3', () => {
    const g = codeMoments(buildCodeDistribution({ kind: 'gaussian' }))
    expect(g.Ex).toBeCloseTo(0, 13)
    expect(g.Ex2).toBeCloseTo(1, 12)
    expect(g.Ex4).toBeCloseTo(3, 11)
    expect(g.Ex6).toBeCloseTo(15, 9)
    const u = codeMoments(buildCodeDistribution({ kind: 'uniform_residue' }))
    expect(u.Ex).toBeCloseTo(0.5, 14)
  })

  it('連續 code 在 σ_v = 0 的 sign GMAC：斷點使積分精確（uniform、e = (1 − w)x + 0.1 ⇒ 解析值）', () => {
    // x ~ U[0,1)、b = 0.1、a = 1：e = (1 − w)x + 0.1，w > 1.1 時在 x₀ = 0.1/(w − 1) 變號
    // E[x·sign(e)] = ∫₀^{x₀} x dx − ∫_{x₀}^1 x dx = x₀² − 1/2 = 0 ⇒ x₀ = 1/√2 ⇒ w = 1 + 0.1√2
    const m: ErrorModel = { a: 1, b: 0.1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }
    const u = buildCodeDistribution({ kind: 'uniform_residue' })
    expect(signFixedPoint(m, u).w).toBeCloseTo(1 + 0.1 * Math.SQRT2, 11)
  })

  it('σ_v sweep 的漸近行為：σ_v → ∞ 趨近 MSE 解，σ_v → 0 趨近 |x| 加權中位數', () => {
    const sw = biasSigmaSweep({ model: CUBIC, code: { kind: 'five_level' }, dcMode: 'none', sigmas: [0.01, 0.1, 1, 10] })
    expect(sw.wMse).toBeCloseTo(1.34, 13)
    expect(sw.wNoiseFree).toBeCloseTo(1.4, 10)
    for (let i = 1; i < sw.wSign.length; i++) expect(sw.wSign[i]).toBeLessThan(sw.wSign[i - 1]) // 單調
    expect(sw.wSign[3]).toBeCloseTo(1.3400034560, 9)
  })

  it('MC 可重現：同 seed 同結果、不同 seed 不同', () => {
    const base = { model: CUBIC, code: { kind: 'five_level' as const }, algorithm: 'sign' as const, dcMode: 'none' as const, mu: 0.01, N: 16, blocks: 200, chains: 3, w0: 1, seed: 5, traceChains: 1 }
    const a = simulateBiasLms(base)
    const b = simulateBiasLms(base)
    const c = simulateBiasLms({ ...base, seed: 6 })
    expect(a.chainMeans).toEqual(b.chainMeans)
    expect(a.chainMeans).not.toEqual(c.chainMeans)
    expect(a.traces.w[0].length).toBe(a.traces.k.length)
  })

  it('MC 參數檢查：μ ≤ 0、chains < 2 時丟出說明錯誤', () => {
    const base = { model: CUBIC, code: { kind: 'five_level' as const }, algorithm: 'sign' as const, dcMode: 'none' as const, mu: 0.01, N: 16, blocks: 200, chains: 3, w0: 1, seed: 5 }
    expect(() => simulateBiasLms({ ...base, mu: 0 })).toThrow(/μ/)
    expect(() => simulateBiasLms({ ...base, chains: 1 })).toThrow(/chains/)
  })

  it('凍結 w 的 MC 平均 GMAC（batch-means 95% CI）與 mean-field E[G](w) 一致（5-level 與 DSM code、shared BBPD）', () => {
    const mc = simulateBiasLms({
      model: CUBIC,
      code: { kind: 'five_level' },
      algorithm: 'sign',
      dcMode: 'none',
      mu: 0.01,
      N: 16,
      blocks: 40,
      chains: 2,
      w0: 1.34,
      seed: 31,
      traceChains: 0,
      gmacPoints: [1.1, 1.34, 1.6],
      gmacSamples: 40000,
    })
    mc.gmac.w.forEach((w, i) => {
      const mf = meanGmacSign(w, CUBIC, five)
      expect(Math.abs(mc.gmac.mean[i] - mf), `w=${w}`).toBeLessThan(2 * mc.gmac.halfWidth[i] + 1e-3)
      expect(mc.gmac.halfWidth[i]).toBeGreaterThan(0)
    })
    const dm: ErrorModel = { a: 1, b: 0.05, c2: 0.1, c3: 0, kappa: 0, sigmaV: 0.5 }
    const dsm = buildCodeDistribution({ kind: 'dsm', dsmFrac: 0.3 })
    const mc2 = simulateBiasLms({ model: dm, code: { kind: 'dsm', dsmFrac: 0.3 }, algorithm: 'sign', dcMode: 'shared_bbpd', mu: 0.01, N: 16, blocks: 40, chains: 2, w0: 1.1, seed: 32, traceChains: 0, gmacPoints: [0.9, 1.3], gmacSamples: 40000 })
    mc2.gmac.w.forEach((w, i) => {
      const mf = meanGmacSign(w, dm, dsm, 'shared_bbpd')
      expect(Math.abs(mc2.gmac.mean[i] - mf), `dsm w=${w}`).toBeLessThan(2 * mc2.gmac.halfWidth[i] + 2e-3)
    })
  })

  it('MSE-LMS 的 MC（多位元 e）收斂到 1.34', () => {
    const mc = simulateBiasLms({ model: CUBIC, code: { kind: 'five_level' }, algorithm: 'mse', dcMode: 'none', mu: 0.01, N: 32, blocks: 2000, chains: 8, w0: 1, seed: 11, traceChains: 0 })
    expect(mc.lo).toBeLessThanOrEqual(1.34)
    expect(mc.hi).toBeGreaterThanOrEqual(1.34)
  })

  it('DSM code：first-order residue 的支撐點 ≤ 256，並可用於固定點', () => {
    const d = buildCodeDistribution({ kind: 'dsm', dsmFrac: 0.3 })
    expect(d.values.length).toBeLessThanOrEqual(256)
    expect(Math.min(...d.values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...d.values)).toBeLessThan(1)
    expect(d.probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12)
    const fp = fixedPoint('sign', { a: 1, b: 0.1, c2: 0.05, c3: 0, kappa: 0, sigmaV: 0.5 }, d, 'shared_bbpd')
    expect(fp.status).toBe('ok')
  })

  it('§11.4 near-integer：FCW → 整數時 C → 0，w* − a = B/C 放大', () => {
    const r = nearIntegerSweep({ fracs: [0.0005, 0.002, 0.05], wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 })
    expect(r.C[0]).toBeLessThan(0.01)
    expect(r.C[2]).toBeGreaterThan(0.9)
    expect(r.bias[0]).toBeGreaterThan(100 * r.bias[2])
  })

  it('§11.4 near-integer：時域（整數週期）與頻域（Parseval）兩條獨立路徑的 C 一致；低 frac 冪次 ≈ 2', () => {
    const fr = [3e-4, 4e-4, 5e-4, 6e-4, 8e-4, 1e-3, 0.01, 0.3]
    const r = nearIntegerSweep({ fracs: fr, wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 })
    expect(r.frac.length).toBe(fr.length)
    expect(r.maxRelDiff).toBeLessThan(1e-8)
    r.C.forEach((c, i) => expect(Math.abs(c - r.Cfreq[i])).toBeLessThan(1e-9 + 1e-8 * Math.abs(r.Cfreq[i])))
    // 週期：P = 2^16/gcd(K, 2^16)
    r.frac.forEach((f, i) => {
      const K = Math.round(f * 65536)
      let g = 65536
      let k = K
      while (k) [g, k] = [k, g % k]
      expect(r.period[i]).toBe(65536 / g)
    })
    expect(r.lowFracExponent).toBeGreaterThan(1.9)
    expect(r.lowFracExponent).toBeLessThan(2.1)
    // 頻寬內諧波 Re H_PD < 0：貢獻為負，且與頻寬外的正貢獻幾乎抵銷
    expect(r.CinBand[0]).toBeLessThan(0)
    expect(Math.abs(r.CinBand[0])).toBeGreaterThan(5 * r.Cfreq[0])
    // 回歸值（Python scipy 獨立計算：frac 3e-4 → C = 0.00279397，頻寬內 −0.0341816）
    expect(r.Cfreq[0]).toBeCloseTo(0.002793967734, 9)
    expect(r.CinBand[0]).toBeCloseTo(-0.0341815738, 8)
  })

  it('NEG: §11.4 主 PLL 不穩定時不輸出 C，並給出原因', () => {
    const r = nearIntegerSweep({ fracs: [0.01, 0.1], wnTs: 1.5, zeta: 0.3, loopDelay: 4, kappaDirect: 0.01, sigmaV: 1 })
    expect(r.frac.length).toBe(0)
    expect(r.warnings.some((w) => w.includes('不穩定'))).toBe(true)
  })
})
