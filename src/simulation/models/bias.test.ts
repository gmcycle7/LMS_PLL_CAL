import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lfilter } from '@/simulation/signal'
import {
  KQ_FACTOR,
  LIN_RATIO_LIMIT,
  LIN_RESIDUAL_LIMIT,
  RESIDUAL_DUST_REL,
  analyzeBias,
  biasSigmaSweep,
  brentRoot,
  buildCodeDistribution,
  codeMoments,
  comparatorMean,
  cubicReferenceTable,
  eDet,
  eDetScale,
  expectation,
  finiteStepBias,
  fixedPoint,
  gmacSlope,
  linearizedFixedPoint,
  mcAgreement,
  meanGmacSign,
  mseFixedPoint,
  mseWeightedMean,
  nearIntegerLinearCheck,
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
import { runDsm } from './dsm'
import { designDtLoop } from './pll'
import { meanFieldCurve } from './polarity'

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

describe('bias.ts — 審查 R05 / C05：無雜訊 Sign-LMS 的固定點是 E[G] 的變號點；F-11.9 失準是因為低階截斷', () => {
  const M0: ErrorModel = { ...CUBIC, sigmaV: 0 }
  const avgXg = (an: ReturnType<typeof analyzeBias>) => (an.residual ?? []).reduce((acc, r) => acc + r.p * r.xg, 0)

  it('R05 反例（整數運算，浮點不會把 tie 翻成正負）：w = 7/5 時 E[x·sign(e)] = −2/5，三種 sign(0) 慣例都一樣，不是 0', () => {
    // 放大 10 倍：10·e(x; 7/5) = (10 − 14)·x + x³
    const xs = [-2, -1, 0, 1, 2]
    const e10 = xs.map((x) => (10 - 14) * x + x ** 3)
    expect(e10).toEqual([0, 3, 0, -3, 0])
    for (const s0 of [0, 1, -1]) {
      const sum = xs.reduce((acc, x, i) => acc + x * (e10[i] > 0 ? 1 : e10[i] < 0 ? -1 : s0), 0)
      expect(sum).toBe(-2) // ÷5 ⇒ E[G](7/5) = −2/5
    }
    // tie：e = 0 的 code 有 3 個（機率 3/5），其中票重不為 0 的是 x = ±2（機率 2/5 = 0.4）
    expect(e10.filter((e) => e === 0)).toHaveLength(3)
    expect(xs.filter((x, i) => e10[i] === 0 && x !== 0)).toEqual([-2, 2])
  })

  it('R05 網站函式：E[G] 在 1.4 的兩側是 +0.4 與 −1.2，附近沒有任何 w 讓 E[G] = 0（階梯跳過 0）', () => {
    // 不直接檢查 meanGmacSign(1.4)：IEEE double 裡 e_det(±2; 1.4) = ∓2.2e−16，tie 會被捨入誤差翻成正負
    expect(meanGmacSign(1.4 - 1e-9, M0, five)).toBeCloseTo(0.4, 14)
    expect(meanGmacSign(1.4 + 1e-9, M0, five)).toBeCloseTo(-1.2, 14)
    for (let i = 0; i <= 1000; i++) expect(Math.abs(meanGmacSign(1.35 + i * 1e-4, M0, five))).toBeGreaterThanOrEqual(0.4 - 1e-12)
  })

  it('R05 求解器與描述：signFixedPoint 回傳變號點（status ok、那一點的 G 不是 0）；analyzeBias.crossing = jump（+0.4 → −1.2）', () => {
    const fp = signFixedPoint(M0, five)
    expect(fp.status).toBe('ok')
    expect(fp.w).toBeCloseTo(1.4, 10)
    expect(Math.abs(meanGmacSign(fp.w, M0, five))).toBeGreaterThanOrEqual(0.4 - 1e-12)
    const an = analyzeBias({ model: M0, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(an.crossing?.kind).toBe('jump')
    expect(an.crossing?.gLeft).toBeCloseTo(0.4, 14)
    expect(an.crossing?.gRight).toBeCloseTo(-1.2, 14)
    expect(an.zeroSet?.lo).toBeCloseTo(1.4, 14)
    expect(an.zeroSet?.hi).toBeCloseTo(1.4, 14)
    // 殘差表最後一欄的機率加權平均不是 0：它是數值解那一側的階梯值（目前落在左側：+0.4）
    const s = avgXg(an)
    expect(Math.min(Math.abs(s - 0.4), Math.abs(s + 1.2))).toBeLessThan(1e-12)
  })

  it('R05 文字的界線：jump 不代表「那一點的 E[G] 一定不是 0」，數值解也可能落在右側（UI 不可寫死）', () => {
    // 沒有 INL：所有 code 想要同一個 gain，階梯由 +1.2 直接跳到 −1.2，而且 w* = 1 那一點（全部 tie）E[G] = 0
    const flat = analyzeBias({ model: { ...M0, c3: 0 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(flat.wStar).toBe(1)
    expect(flat.crossing?.kind).toBe('jump')
    expect(flat.crossing?.gLeft).toBeCloseTo(1.2, 14)
    expect(flat.crossing?.gRight).toBeCloseTo(-1.2, 14)
    expect(avgXg(flat)).toBe(0)
    // code 平移 0.5：數值解落在跳變的右側，最後一欄的平均是 −0.3
    const shifted = analyzeBias({ model: M0, code: { kind: 'five_level', shift: 0.5 }, algorithm: 'sign', dcMode: 'none' })
    expect(shifted.crossing?.kind).toBe('jump')
    expect(shifted.crossing?.gLeft).toBeCloseTo(0.9, 12)
    expect(shifted.crossing?.gRight).toBeCloseTo(-0.3, 12)
    expect(avgXg(shifted)).toBeCloseTo(-0.3, 12)
  })

  it('R05 次梯度：1.4 是 MAE J(w) = E|e| 的最小點，左右斜率 −0.4 與 +1.2（0 ∈ ∂J），不是 J′ = 0', () => {
    const J = (w: number) => expectation(five, (x) => Math.abs(eDet(x, w, M0)))
    expect(J(1.4)).toBeCloseTo(0.12, 12)
    expect(J(1.34)).toBeCloseTo(0.144, 12)
    expect((J(1.4) - J(1.4 - 1e-6)) / 1e-6).toBeCloseTo(-0.4, 6)
    expect((J(1.4 + 1e-6) - J(1.4)) / 1e-6).toBeCloseTo(1.2, 6)
    for (const w of [1.3, 1.34, 1.39, 1.41, 1.5]) expect(J(1.4)).toBeLessThan(J(w))
  })

  it('R05 時間平均：w ← w + μE[G](w) 有 3/4 的步數在 1.4 下方、1/4 在上方，E[G] 的時間平均是 0（雖然沒有任何 w 讓 E[G] = 0）；剛好踩到 tie 的格點是例外', () => {
    // 三組 (w0, μ) 都讓 (1.4 − w0)/(0.4μ) 不是整數：w 永遠踩不到 1.4 這個 tie 點，結果不靠浮點捨入決定。
    // 以 0.4μ 為單位，w − 1.4 依序走過 φ−3、φ−2、φ−1（下方，各 +1）、φ（上方，−3），0 < φ < 1：週期 4、三下一上。
    for (const [w0, mu] of [
      [1.3, 1.07e-3],
      [1, 7.3e-4],
      [1.55, 4.1e-4],
    ]) {
      const phase = (1.4 - w0) / (0.4 * mu)
      expect(Math.abs(phase - Math.round(phase))).toBeGreaterThan(0.05)
      let w = w0
      let below = 0
      let sum = 0
      let maxDev = 0
      for (let k = 0; k < 4000; k++) {
        const g = meanGmacSign(w, M0, five)
        if (k >= 2000) {
          expect(w).not.toBe(1.4)
          if (w < 1.4) below++
          sum += g
          maxDev = Math.max(maxDev, Math.abs(w - 1.4))
        }
        w += mu * g
      }
      expect(below).toBe(1500) // ¾ × 0.4 = ¼ × 1.2
      expect(Math.abs(sum / 2000)).toBeLessThan(1e-12)
      expect(maxDev).toBeLessThanOrEqual(1.2 * mu + 1e-12) // O(μ) 的 limit cycle
    }
    // 內文寫「大約 ¾」而不是「恰好」的原因（整數格點、精確運算）：w 若剛好能踩到 1.4，那一步是 tie（E[G] = −0.4），
    // 循環變成 1.4 ↔ 1.4 − 0.4μ 各佔一半；GMAC 的時間平均仍然是 0。以 0.4μ 為單位：n < 0 ⇒ +1、n = 0 ⇒ −1、n > 0 ⇒ −3。
    let n = -5
    let acc = 0
    const visited = new Set<number>()
    for (let k = 0; k < 40; k++) {
      const g = n < 0 ? 1 : n === 0 ? -1 : -3
      if (k >= 20) {
        visited.add(n)
        acc += g
      }
      n += g
    }
    expect([...visited].sort((p, q) => p - q)).toEqual([-1, 0])
    expect(acc).toBe(0)
  })

  it('R05 對照組：真正的根仍然是 root（σ_v > 0、MSE、連續 code）；dead zone 與 DC null 模式各有正確的描述', () => {
    const noisy = analyzeBias({ model: { ...CUBIC, sigmaV: 0.3 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
    expect(noisy.crossing?.kind).toBe('root')
    expect(noisy.wStar).toBeCloseTo(1.3438500804, 8)
    expect(Math.abs(meanGmacSign(noisy.wStar, { ...CUBIC, sigmaV: 0.3 }, five))).toBeLessThan(1e-12)
    expect(Math.abs(noisy.crossing?.gLeft ?? 1)).toBeLessThan(1e-5)
    expect(Math.abs(noisy.crossing?.gRight ?? 1)).toBeLessThan(1e-5)
    expect(Math.abs(avgXg(noisy))).toBeLessThan(1e-12)
    const mse = analyzeBias({ model: M0, code: { kind: 'five_level' }, algorithm: 'mse', dcMode: 'none' })
    expect(mse.crossing?.kind).toBe('root')
    expect(mse.wStar).toBeCloseTo(1.34, 12)
    const gauss = analyzeBias({ model: M0, code: { kind: 'gaussian' }, algorithm: 'sign', dcMode: 'none' })
    expect(gauss.crossing?.kind).toBe('root')
    expect(gauss.wStar).toBeCloseTo(1 + 0.2 * Math.LN2, 9)
    const dead = analyzeBias({ model: { a: 1, b: 1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'none' })
    expect(dead.crossing?.kind).toBe('dead-zone')
    expect(dead.crossing?.gLeft).toBeCloseTo(1.5, 12)
    expect(dead.crossing?.gRight).toBeCloseTo(-1, 12)
    expect(meanGmacSign(1.4, { a: 1, b: 1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }, buildCodeDistribution({ kind: 'unipolar4' }))).toBe(0) // 區間內真的是 0
    for (const dcMode of ['shared_bbpd', 'linear_pd'] as const) {
      const an = analyzeBias({ model: M0, code: { kind: 'five_level' }, algorithm: 'sign', dcMode })
      expect(an.crossing?.kind, dcMode).toBe('jump')
      expect(an.crossing?.gLeft, dcMode).toBeCloseTo(0.4, 12)
      expect(an.crossing?.gRight, dcMode).toBeCloseTo(-1.2, 12)
    }
    // 整數 FCW：沒有激勵，w* 不是有限值 ⇒ 沒有可描述的零交越
    expect(analyzeBias({ model: M0, code: { kind: 'dsm', dsmFrac: 0 }, algorithm: 'sign', dcMode: 'none' }).crossing).toBeNull()
  })

  it('F-11.9 在小 σ_v 失準的原因是 erf 的三次截斷，不是級數發散（C05）', () => {
    // erf 的 Maclaurin 部分和 (2/√π) Σ_{n<N} (−1)^n u^{2n+1}/(n!(2n+1))；N = 2 就是推導用的三次截斷
    const erfPartial = (u: number, N: number) => {
      let term = u
      let s = 0
      for (let n = 0; n < N; n++) {
        s += ((n % 2 ? -1 : 1) * term) / (2 * n + 1)
        term = (term * u * u) / (n + 1)
      }
      return (2 / Math.sqrt(Math.PI)) * s
    }
    const [bad, ok] = cubicReferenceTable({ sigmas: [0.05, 1] })
    // 反例 σ_v = 0.05
    expect(bad.ratio).toBeCloseTo(5.6628, 3) // 5.662755
    expect(bad.secondOrder).toBeCloseTo(1.47824, 10)
    expect(bad.exact).toBeCloseTo(1.3831378, 6) // 1.3831377565
    const exact = comparatorMean(bad.ratio, 1) // erf(5.6628/√2) = 0.99999998510
    const u = bad.ratio / Math.SQRT2 // 4.004173
    expect(exact).toBeGreaterThan(0.9999999)
    expect(erfPartial(u, 2)).toBeLessThan(-19) // −19.629274：三次截斷連正負號都錯
    expect(Math.abs(erfPartial(u, 10) - exact)).toBeGreaterThan(1e4) // 2.777e4：部分和先暴衝…
    expect(Math.abs(erfPartial(u, 80) - exact)).toBeLessThan(1e-9) // …再收斂（1.13e−11）：級數本身是收斂的
    // 截斷 r − r³/6 的形狀：r = √2 最大、r = √6 過零（內文引用的兩個數）
    const f = (r: number) => r - r ** 3 / 6
    expect(f(Math.SQRT2)).toBeGreaterThan(f(1.3)) // 0.94281 > 0.93383
    expect(f(Math.SQRT2)).toBeGreaterThan(f(1.5)) // 0.94281 > 0.93750
    expect(f(Math.sqrt(6))).toBeCloseTo(0, 12)
    expect(f(bad.ratio)).toBeLessThan(0) // −24.60
    // 適用上限 r = 1.2：三次截斷低 5.48%
    expect(erfPartial(1.2 / Math.SQRT2, 2) / comparatorMean(1.2, 1) - 1).toBeCloseTo(-0.0548, 3) // −0.054802
    // 對照 σ_v = 1
    expect(ok.ratio).toBeCloseTo(0.2403, 3) // 0.240346
    expect(Math.abs(erfPartial(ok.ratio / Math.SQRT2, 2) / comparatorMean(ok.ratio, 1) - 1)).toBeLessThan(1e-4) // 8.37e−5
    expect(Math.abs(ok.secondOrder - ok.exact)).toBeLessThan(1e-6) // 2.34e−7（1.3403456 vs 1.3403458）
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

  it('線性化失效的警告用語跟著比值走：0.3 < max|e_det|/σ_v ≤ 1.5 只說「離開線性區」，超過 1.5 才說「飽和區」（Ch05 的分區）', () => {
    const at = (sigmaV: number) => {
      const an = analyzeBias({ model: { ...CUBIC, sigmaV }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' })
      return { ratio: an.validityRatio, warn: an.warnings.find((w) => w.includes('線性化失效風險')) ?? '' }
    }
    // σ_v = 0.5：比值 0.483。這裡 erf 只比切線 K_q·e 低 3.8%（還沒有飽和），舊的警告卻寫「已進入 erf 的飽和區」
    const mid = at(0.5)
    expect(mid.ratio).toBeCloseTo(0.482771, 5)
    expect(comparatorMean(mid.ratio, 1) / (KQ_FACTOR * mid.ratio)).toBeGreaterThan(0.96)
    expect(mid.warn).toContain('已離開 erf 的線性區')
    expect(mid.warn).toContain('比值超過 1.5 才是飽和區')
    expect(mid.warn).not.toContain('已進入 erf 的飽和區')
    // σ_v = 0.1：比值 2.666，E[q|x] = 0.992（真的飽和）——用語不變
    const sat = at(0.1)
    expect(sat.ratio).toBeCloseTo(2.66577, 4)
    expect(comparatorMean(sat.ratio, 1)).toBeGreaterThan(0.99)
    expect(sat.warn).toContain('已進入 erf 的飽和區')
    expect(sat.warn).not.toContain('已離開 erf 的線性區')
    // 兩種用語的界線就是 1.5：σ_v = 0.16 時比值 1.581
    expect(at(0.16).ratio).toBeGreaterThan(1.5)
    expect(at(0.16).warn).toContain('已進入 erf 的飽和區')
    // 兩句其餘的部分相同（門檻 0.3、以 mean-field root 為準、勘誤 E01）
    for (const w of [mid.warn, sat.warn]) for (const t of ['>0.3$', '固定點應以 mean-field root', '不適用（勘誤 E01）']) expect(w, t).toContain(t)
  })

  it('審查 C04：residualScale 是殘差各項絕對值的和（只給顯示用）——κ ≠ 0、沒有 INL 時每個 code 的殘差數學上是 0，模型回傳的 1e-16 是捨入殘渣', () => {
    expect(RESIDUAL_DUST_REL).toBe(1e-9)
    // e_det 各項絕對值的和：(|a| + |w| + |κ|)·|x| + |b| + |c_2|·x² + |c_3|·|x|³
    expect(eDetScale(2, 1.1, { a: 1, b: 0, c2: 0, c3: 0, kappa: 0.1, sigmaV: 1 })).toBeCloseTo(4.4, 12)
    expect(eDetScale(-2, 1.34, { a: 1, b: 0.3, c2: -0.05, c3: 0.1, kappa: 0, sigmaV: 1 })).toBeCloseTo(2.34 * 2 + 0.3 + 0.05 * 4 + 0.1 * 8, 12)
    // preset bias-kappa-identifiability：w* = a + κ = 1.1，e(x; w*) = (a + κ − w*)·x ≡ 0
    for (const algorithm of ['sign', 'mse'] as const) {
      const kap = analyzeBias({ model: { ...CUBIC, c3: 0, kappa: 0.1 }, code: { kind: 'five_level' }, algorithm, dcMode: 'none', w0: 1 })
      expect(kap.wStar).toBeCloseTo(1.1, 12)
      expect(kap.residualScale).toBeCloseTo(4.4, 9) // (1 + 1.1 + 0.1)·2，在 w ∈ {w_0, a, w*} 上取最大
      const dust = RESIDUAL_DUST_REL * kap.residualScale
      for (const r of kap.residual ?? []) expect(Math.abs(r.eStar)).toBeLessThan(1e-12) // 模型的數值照舊（不在模型裡歸零）
      expect(Math.max(...kap.residualCurve.eStar.map(Math.abs))).toBeLessThan(dust)
      expect(kap.costs[2].mse).toBeLessThan(dust * dust)
      expect(Math.min(...kap.residualCurve.eAtA.filter((e) => e !== 0).map(Math.abs))).toBeGreaterThan(1e6 * dust) // w = a 處的殘差 ±0.1、±0.2 是真的
    }
    // 對照：三階 INL 的殘差（±0.24、∓0.12）是真的，比門檻大 7 個數量級以上
    const cub = analyzeBias({ model: CUBIC, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', w0: 1 })
    expect(cub.residualScale).toBeCloseTo((1 + cub.wStar) * 2 + 0.1 * 8, 9)
    expect(Math.min(...(cub.residual ?? []).filter((r) => r.x !== 0).map((r) => Math.abs(r.eStar)))).toBeGreaterThan(1e7 * RESIDUAL_DUST_REL * cub.residualScale)
    // 無雜訊的階梯（jump）：tie code（x = ±2）的殘差是二分法留下的 1e-13 量級，也在門檻以下；x = ±1 的 ∓0.3 是真的
    const step = analyzeBias({ model: { ...CUBIC, sigmaV: 0 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', w0: 1 })
    const stepDust = RESIDUAL_DUST_REL * step.residualScale
    expect((step.residual ?? []).map((r) => (Math.abs(r.eStar) <= stepDust ? 0 : Number(r.eStar.toFixed(9))))).toEqual([0, 0.3, 0, -0.3, 0])
    // DC null：|φ| 也算進去。shared BBPD、b = 0.5、x ∈ {0,1,2,3}、w* = a：(1 + 1)·3 + 0.5 + |φ*| = 7，殘差 b + φ* = 0
    const sh = analyzeBias({ model: { ...CUBIC, c3: 0, b: 0.5 }, code: { kind: 'unipolar4' }, algorithm: 'sign', dcMode: 'shared_bbpd', w0: 1 })
    expect(sh.phiStar).toBeCloseTo(-0.5, 9)
    expect(sh.residualScale).toBeCloseTo(7, 8)
    // 沒有固定點（x ≡ 0）時仍是有限值：只剩 |b|
    const none = analyzeBias({ model: { ...CUBIC, c3: 0, b: 0.1 }, code: { kind: 'dsm', dsmFrac: 0 }, algorithm: 'mse', dcMode: 'none' })
    expect(Number.isFinite(none.wStar)).toBe(false)
    expect(none.residualScale).toBeCloseTo(0.1, 12)
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

  it('§11.4 near-integer：FCW → 整數時 C → 0，線性候選 B/C 放大', () => {
    const r = nearIntegerSweep({ fracs: [0.0005, 0.002, 0.05], wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 })
    expect(r.C[0]).toBeLessThan(0.01)
    expect(r.C[2]).toBeGreaterThan(0.9)
    expect(r.bias[0]).toBeGreaterThan(100 * r.bias[2])
    // 放大最多的那一點（B/C = 1.31）恰好不是固定點：max|e_det|/σ_v = 4.54、γ_lin = 3.90
    expect(r.linValid).toEqual([false, true, true])
    expect(r.linRatio[0]).toBeCloseTo(4.536801, 5)
    expect(r.linResidual[0]).toBeCloseTo(3.899034, 5)
    expect(r.linRatio[1]).toBeCloseTo(0.274044, 5)
    expect(r.linResidual[1]).toBeCloseTo(0.0111498, 6)
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

  // ── 審查 R01：線性候選 a + B/C 要代回完整的 erf 平均才知道是不是固定點 ──
  const NI = { wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 }
  const niLogspace = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => 10 ** (Math.log10(lo) + ((Math.log10(hi) - Math.log10(lo)) * i) / (n - 1)))
  /** 不經過 nearIntegerSweep，直接重建「標準化的 residue x」與「u = h_PD * x」的最後一個週期（16-bit first-order DSM） */
  const sawtoothThroughLoop = (frac: number, skip: number, P: number) => {
    const res = runDsm({ kind: 'first_order', frac, bits: 16, length: skip + P })
    const last = res.residue.subarray(skip)
    const mean = last.reduce((acc, v) => acc + v, 0) / P
    const sd = Math.sqrt(last.reduce((acc, v) => acc + (v - mean) ** 2, 0) / P)
    const x = Float64Array.from(res.residue, (v) => (v - mean) / sd)
    const hpd = designDtLoop({ wnTs: NI.wnTs, zeta: NI.zeta, loopDelay: NI.loopDelay }).Hpd
    const u = lfilter(hpd.b, hpd.a, x).y
    const xs = x.subarray(skip)
    const us = u.subarray(skip)
    /** 平均 GMAC：w − a = d 時 mean_n x·erf((−d·u + κ_d·x)/(√2σ_v)) */
    const G = (d: number, kd = NI.kappaDirect, sigma = NI.sigmaV) => {
      let acc = 0
      for (let n = 0; n < P; n++) acc += xs[n] * comparatorMean(-d * us[n] + kd * xs[n], sigma)
      return acc / P
    }
    return { x: xs, u: us, G }
  }

  it('R01 反例（實驗的預設第一點 frac = 20/65536）：C 沒有錯，但 a + B/C 代回完整的 erf 平均後 GMAC = +0.0488，不是固定點', () => {
    const r = nearIntegerSweep({ fracs: [3e-4, 0.05], ...NI })
    expect(r.frac[0]).toBe(20 / 65536)
    expect(r.Cfreq[0]).toBeCloseTo(0.002793967734, 9)
    expect(r.bias[0]).toBeCloseTo(3.5791394, 6)
    expect(r.uMax[0]).toBeCloseTo(2 * Math.sqrt(3), 6) // sawtooth 的跳變原封不動通過 H_PD：3.4641016
    expect(r.linRatio[0]).toBeCloseTo(12.381202, 5) // max|e_det|/σ_v：門檻 0.3 的 41 倍
    expect(r.gAtLinear[0]).toBeCloseTo(0.04881877, 7)
    expect(r.linResidual[0]).toBeCloseTo(6.118526, 5) // 是 w = a 時（K_q·B）的 6 倍，而不是 0
    expect(r.linValid[0]).toBe(false)
    // 對照（frac = 3277/65536）：同一個檢查接受它
    expect(r.frac[1]).toBe(3277 / 65536)
    expect(r.Cfreq[1]).toBeCloseTo(1.0313861671, 9)
    expect(r.bias[1]).toBeCloseTo(0.00969568947, 10)
    expect(r.linRatio[1]).toBeCloseTo(0.0021539149, 9)
    expect(Math.abs(r.gAtLinear[1])).toBeLessThan(1e-10) // −8.55e−12
    expect(Math.abs(r.linResidual[1])).toBeLessThan(1e-8) // −1.07e−9
    expect(r.linValid[1]).toBe(true)
  })

  it('R01 實驗的預設掃描（32 點）：最小的 8 個 frac 只是線性外推，其餘 24 個通過；C 的回歸值不變', () => {
    const r = nearIntegerSweep({ fracs: niLogspace(3e-4, 0.5, 32), ...NI })
    expect(r.frac).toHaveLength(32)
    expect(r.linValid).toEqual([...Array<boolean>(8).fill(false), ...Array<boolean>(24).fill(true)])
    // 第一個通過的點：frac = 133/65536
    expect(r.frac[8]).toBe(133 / 65536)
    expect(r.bias[8]).toBeCloseTo(0.0815712, 6)
    expect(r.linRatio[8]).toBeCloseTo(0.265379, 5)
    expect(r.linResidual[8]).toBeCloseTo(0.0102614, 6)
    // 最後一個沒通過的點只輸在 ratio 門檻（γ_lin = 0.0358 < 0.05）
    expect(r.linRatio[7]).toBeCloseTo(0.43297, 4)
    expect(r.linRatio[7]).toBeGreaterThan(LIN_RATIO_LIMIT)
    expect(r.linResidual[7]).toBeCloseTo(0.03582, 4)
    expect(r.linResidual[7]).toBeLessThan(LIN_RESIDUAL_LIMIT)
    expect(Math.max(...r.linResidual.slice(8).map(Math.abs))).toBeLessThan(0.011)
    // C 的數值核心沒有被動到
    expect(r.Cfreq[0]).toBeCloseTo(0.002793967734, 9)
    expect(r.CinBand[0]).toBeCloseTo(-0.0341815738, 8)
    expect(r.maxRelDiff).toBeLessThan(1e-8)
    expect(r.lowFracExponent).toBeGreaterThan(1.9)
    expect(r.lowFracExponent).toBeLessThan(2.1)
    r.frac.forEach((_, i) => expect(r.bias[i]).toBe(r.B / r.Cfreq[i]))
  })

  it('R01 只看 max|e_det|/σ_v 不夠：κ_d = 2.4e−4 時 ratio = 0.297 ≤ 0.3，但 γ_lin = 0.099 > 0.05（真正的零點偏 15%）', () => {
    const tight = nearIntegerSweep({ fracs: [3e-4], ...NI, kappaDirect: 2.4e-4 })
    expect(tight.linRatio[0]).toBeCloseTo(0.297149, 5)
    expect(tight.linRatio[0]).toBeLessThanOrEqual(LIN_RATIO_LIMIT)
    expect(tight.linResidual[0]).toBeCloseTo(0.098967, 5)
    expect(tight.linValid).toEqual([false])
    const small = nearIntegerSweep({ fracs: [3e-4], ...NI, kappaDirect: 5e-5 })
    expect(small.linRatio[0]).toBeCloseTo(0.061906, 6)
    expect(small.linResidual[0]).toBeCloseTo(0.0043353, 6)
    expect(small.linValid).toEqual([true])
    // σ_v 夠大時整條曲線都回到線性範圍
    const noisy = nearIntegerSweep({ fracs: niLogspace(3e-4, 0.5, 32), ...NI, sigmaV: 100 })
    expect(noisy.linValid.every((v, i) => v === noisy.Cfreq[i] > 0)).toBe(true)
    expect(Math.max(...noisy.linRatio)).toBeCloseTo(0.12381, 4)
    expect(Math.max(...noisy.linResidual.map(Math.abs))).toBeCloseTo(0.01732, 4)
    // 對稱：κ_d 變號，候選點與平均 GMAC 跟著變號，γ_lin 與 ratio 不變
    const neg = nearIntegerSweep({ fracs: [3e-4, 0.05], ...NI, kappaDirect: -0.01 })
    expect(neg.bias[0]).toBeCloseTo(-3.5791394, 6)
    expect(neg.gAtLinear[0]).toBeCloseTo(-0.04881877, 7)
    expect(neg.linResidual[0]).toBeCloseTo(6.118526, 5)
    expect(neg.linRatio[0]).toBeCloseTo(12.381202, 5)
    expect(neg.linValid).toEqual([false, true])
  })

  it('R01 定義檢查（不經過 helper）：w > a 那一側的平均更新不變號（沒有可以停下來的零點）；w < a 的零點是 repelling', () => {
    const r = nearIntegerSweep({ fracs: [3e-4], ...NI })
    const { x, u, G } = sawtoothThroughLoop(3e-4, r.skip, 16384)
    expect(Math.abs(G(r.bias[0]) - r.gAtLinear[0])).toBeLessThan(1e-10)
    expect(G(0)).toBeCloseTo(0.0079786, 6) // ≈ K_q·B = 0.0079788
    for (const d of niLogspace(1e-3, 1e2, 200)) expect(G(d)).toBeGreaterThan(0.007) // 最小值 0.00772（d ≈ 0.17）
    // 另一側有一個零點，但平均更新把 w 往兩邊推開（左邊 G < 0、右邊 G > 0）
    expect(brentRoot(G, -2, -0.1)).toBeCloseTo(-0.8706, 3)
    expect(G(-0.5)).toBeGreaterThan(0)
    expect(G(-1.5)).toBeLessThan(0)
    // 與 Ch06 的 mean-field 特性一致（B = 0）：basin 半徑 δ_c = 0.285，線性候選在它的 12 倍之外
    const cross = meanFieldCurve(x, u, 1, { samples: 16384, points: 60 }).cross
    expect(cross).toBeCloseTo(0.285, 3)
    expect(r.bias[0]).toBeGreaterThan(10 * (cross ?? Infinity))
  })

  it('R01 第一個通過的點（frac = 133/65536）：真正的零點 0.0824378，比 B/C 遠 1.06%，與 γ_lin/(1 − 3γ_lin) 的估計一致', () => {
    const r = nearIntegerSweep({ fracs: [133 / 65536], ...NI })
    expect(r.linValid).toEqual([true])
    const { G } = sawtoothThroughLoop(133 / 65536, r.skip, 65536)
    expect(Math.abs(G(r.bias[0]) - r.gAtLinear[0])).toBeLessThan(1e-12)
    const root = brentRoot(G, 0.05, 0.12)
    expect(root).toBeCloseTo(0.08243783, 7)
    expect(Math.abs(G(root))).toBeLessThan(1e-12) // 檢查 G(root) 本身，不只是 bracket 變號
    const shift = root / r.bias[0] - 1
    expect(shift).toBeCloseTo(0.010624, 5)
    const g = r.linResidual[0]
    expect(Math.abs(shift - g / (1 - 3 * g))).toBeLessThan(5e-4) // 0.010587
  })

  it('R01 nearIntegerLinearCheck：可以手算的兩點序列（x = ±1、u = ±0.5）', () => {
    // bias = 0.02、κ_d = 0.01：e_det = −0.02·0.5·x + 0.01·x = 0 ⇒ 真正的固定點
    expect(nearIntegerLinearCheck([1, -1], [0.5, -0.5], 0.02, 0.01, 1)).toEqual({ uMax: 0.5, ratio: 0, gmac: 0, residual: 0, valid: true })
    // bias = 4：e_det = (−2 + 0.01)·x ⇒ ratio 1.99、gmac = erf(−1.99/√2) = −0.953409、γ_lin = gmac/(K_q·0.01) = −119.49
    const far = nearIntegerLinearCheck([1, -1], [0.5, -0.5], 4, 0.01, 1)
    expect(far.ratio).toBeCloseTo(1.99, 12)
    expect(far.gmac).toBeCloseTo(-0.953409, 6)
    expect(far.gmac).toBeCloseTo(comparatorMean(-1.99, 1), 14)
    expect(far.residual).toBeCloseTo(far.gmac / (KQ_FACTOR * 0.01), 9)
    expect(far.residual).toBeCloseTo(-119.492, 3)
    expect(far.valid).toBe(false)
    // 沒有干擾：候選點就是 w = a
    expect(nearIntegerLinearCheck([1, -1], [0.5, -0.5], 0, 0, 1)).toMatchObject({ ratio: 0, gmac: 0, residual: 0, valid: true })
    // 非有限的候選點（C = 0）與 σ_v = 0：不丟例外，直接判定不成立
    expect(nearIntegerLinearCheck([1, -1], [0.5, -0.5], Infinity, 0.01, 1).valid).toBe(false)
    expect(nearIntegerLinearCheck([1, -1], [0.5, -0.5], 0.02, 0.01, 0).valid).toBe(false)
    expect(LIN_RATIO_LIMIT).toBe(0.3)
    expect(LIN_RESIDUAL_LIMIT).toBe(0.05)
  })

  it('NEG: §11.4 主 PLL 不穩定時不輸出 C，並給出原因', () => {
    const r = nearIntegerSweep({ fracs: [0.01, 0.1], wnTs: 1.5, zeta: 0.3, loopDelay: 4, kappaDirect: 0.01, sigmaV: 1 })
    expect(r.frac.length).toBe(0)
    expect(r.warnings.some((w) => w.includes('不穩定'))).toBe(true)
  })
})
